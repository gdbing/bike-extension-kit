import { CacheWarmCandidate, CacheWarmManager, CacheWarmRequest } from './cache-warm-manager'
import { buildCandidateFingerprintMap } from './cache-warm-candidates'
import type { CacheUsage } from './providers/types'

type TimerHandle = ReturnType<typeof setTimeout>

export interface CacheWarmRuntimeTarget {
  conversationKey: string
  documentFileUrl: string | null
  outlineRootId: string
  stopMarkerRowId: string
}

export interface CacheWarmRuntimeObservation {
  observedAt: number
  cacheReadInputTokens: number
  candidates: CacheWarmCandidate[]
}

export interface CacheWarmRuntimeSnapshot {
  candidates: CacheWarmCandidate[]
}

type CacheWarmRuntimeDependencies = {
  getSnapshot: (target: CacheWarmRuntimeTarget) => CacheWarmRuntimeSnapshot | null
  executeWarmRequest: (request: CacheWarmRequest) => Promise<CacheUsage | null | undefined>
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  manager?: CacheWarmManager
}

export class CacheWarmRuntime {
  private readonly manager: CacheWarmManager
  private readonly getSnapshot: CacheWarmRuntimeDependencies['getSnapshot']
  private readonly executeWarmRequest: CacheWarmRuntimeDependencies['executeWarmRequest']
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle
  private readonly clearTimer: (handle: TimerHandle) => void
  private readonly targets = new Map<string, CacheWarmRuntimeTarget>()
  private readonly timers = new Map<string, TimerHandle>()

  constructor(dependencies: CacheWarmRuntimeDependencies) {
    this.manager = dependencies.manager ?? new CacheWarmManager()
    this.getSnapshot = dependencies.getSnapshot
    this.executeWarmRequest = dependencies.executeWarmRequest
    this.now = dependencies.now ?? (() => Date.now())
    this.setTimer = dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = dependencies.clearTimer ?? ((handle) => clearTimeout(handle))
  }

  observe(
    target: CacheWarmRuntimeTarget,
    observation: CacheWarmRuntimeObservation
  ): void {
    this.targets.set(target.conversationKey, target)
    const decision = this.manager.recordObservation({
      conversationKey: target.conversationKey,
      observedAt: observation.observedAt,
      cacheReadInputTokens: observation.cacheReadInputTokens,
      candidates: observation.candidates
    })

    if (decision.status === 'scheduled') {
      this.schedule(decision.conversationKey, decision.runAt)
      return
    }

    this.clearConversation(target.conversationKey)
  }

  cancel(conversationKey: string): void {
    this.clearConversation(conversationKey)
  }

  dispose(): void {
    for (const handle of Array.from(this.timers.values())) {
      this.clearTimer(handle)
    }
    this.timers.clear()
    this.targets.clear()
  }

  private schedule(conversationKey: string, runAt: number): void {
    const previous = this.timers.get(conversationKey)
    if (previous) {
      this.clearTimer(previous)
      this.timers.delete(conversationKey)
    }

    const delayMs = Math.max(0, runAt - this.now())
    const handle = this.setTimer(() => {
      void this.runScheduledRefresh(conversationKey)
    }, delayMs)
    this.timers.set(conversationKey, handle)
  }

  private async runScheduledRefresh(conversationKey: string): Promise<void> {
    this.timers.delete(conversationKey)

    const target = this.targets.get(conversationKey)
    if (!target) {
      this.clearConversation(conversationKey)
      return
    }

    let snapshot: CacheWarmRuntimeSnapshot | null = null
    try {
      snapshot = this.getSnapshot(target)
    } catch (error) {
      console.warn('LLM Chat: Failed to build cache warm snapshot', error)
      this.clearConversation(conversationKey)
      return
    }
    if (!snapshot || snapshot.candidates.length === 0) {
      this.clearConversation(conversationKey)
      return
    }

    const prepare = this.manager.prepareRefresh({
      conversationKey,
      now: this.now(),
      currentFingerprintsByCandidateId: buildCandidateFingerprintMap(snapshot.candidates)
    })

    if (prepare.status !== 'ready') {
      if (prepare.reason === 'not-due') {
        const state = this.manager.getConversationState(conversationKey)
        if (state) {
          this.schedule(conversationKey, state.nextRunAt)
          return
        }
      }
      this.clearConversation(conversationKey)
      return
    }

    const candidate = snapshot.candidates.find(item => item.id === prepare.candidateId)
    if (!candidate) {
      this.clearConversation(conversationKey)
      return
    }

    let usage: CacheUsage | null | undefined = null
    try {
      usage = await this.executeWarmRequest(candidate.request)
    } catch (error) {
      console.warn('LLM Chat: Cache warm refresh failed', error)
      this.clearConversation(conversationKey)
      return
    }

    const cacheReadInputTokens = Number(usage?.cache_read_input_tokens ?? 0)
    const completion = this.manager.completeRefresh({
      conversationKey,
      completedAt: this.now(),
      cacheReadInputTokens
    })

    if (completion.status === 'rescheduled') {
      this.schedule(conversationKey, completion.nextRunAt)
      return
    }

    this.clearConversation(conversationKey)
  }

  private clearConversation(conversationKey: string): void {
    const timer = this.timers.get(conversationKey)
    if (timer) {
      this.clearTimer(timer)
      this.timers.delete(conversationKey)
    }
    this.targets.delete(conversationKey)
    this.manager.cancelConversation(conversationKey)
  }
}
