import type { Message, StreamOptions } from './providers/types'

export interface CacheWarmPolicy {
  refreshAfterMs: number
  maxRefreshes: number
}

export interface CacheWarmRequest {
  messages: Message[]
  model?: string
  provider?: StreamOptions['provider']
  temperature?: number
  reasoningEffort?: StreamOptions['reasoningEffort']
  maxTokens?: number
}

export interface CacheWarmCandidate {
  id: string
  estimatedInputTokens: number
  contentFingerprint: string
  request: CacheWarmRequest
}

export interface CacheWarmObservation {
  conversationKey: string
  observedAt: number
  cacheReadInputTokens: number
  candidates: CacheWarmCandidate[]
}

export type CacheWarmScheduleDecision =
  | {
      status: 'scheduled'
      conversationKey: string
      candidateId: string
      runAt: number
      refreshesRemaining: number
    }
  | {
      status: 'skipped'
      conversationKey: string
      reason: 'no-cache-read' | 'no-candidates'
    }

export interface CacheWarmPrepareInput {
  conversationKey: string
  now: number
  currentFingerprintsByCandidateId: Record<string, string>
}

export type CacheWarmPrepareResult =
  | {
      status: 'ready'
      conversationKey: string
      candidateId: string
      request: CacheWarmRequest
      attemptNumber: number
      refreshesRemaining: number
    }
  | {
      status: 'blocked'
      conversationKey: string
      reason: 'not-found' | 'not-due' | 'content-changed' | 'max-refreshes-reached'
    }

export interface CacheWarmCompleteInput {
  conversationKey: string
  completedAt: number
  cacheReadInputTokens: number
}

export type CacheWarmCompleteResult =
  | {
      status: 'rescheduled'
      conversationKey: string
      nextRunAt: number
      refreshesRemaining: number
    }
  | {
      status: 'stopped'
      conversationKey: string
      reason: 'no-cache-read' | 'max-refreshes-reached' | 'not-found'
    }

export interface CacheWarmConversationState {
  conversationKey: string
  candidateId: string
  nextRunAt: number
  refreshesCompleted: number
  refreshesRemaining: number
  contentFingerprint: string
}

export const WARM_REQUEST_MAX_TOKENS = 1

export const DEFAULT_CACHE_WARM_POLICY: CacheWarmPolicy = {
  refreshAfterMs: 295_000, // 4:55
  maxRefreshes: 3
}

/**
 * In-memory scheduler/state machine for Anthropic cache warming refreshes.
 */
export class CacheWarmManager {
  readonly policy: CacheWarmPolicy
  private readonly conversations = new Map<string, CacheWarmTrackedConversation>()

  constructor(policy: Partial<CacheWarmPolicy> = {}) {
    this.policy = {
      refreshAfterMs: normalizeNonNegativeInt(
        policy.refreshAfterMs,
        DEFAULT_CACHE_WARM_POLICY.refreshAfterMs
      ),
      maxRefreshes: normalizeNonNegativeInt(
        policy.maxRefreshes,
        DEFAULT_CACHE_WARM_POLICY.maxRefreshes
      )
    }
  }

  recordObservation(observation: CacheWarmObservation): CacheWarmScheduleDecision {
    const { conversationKey, observedAt, cacheReadInputTokens } = observation
    if (cacheReadInputTokens <= 0) {
      this.conversations.delete(conversationKey)
      return {
        status: 'skipped',
        conversationKey,
        reason: 'no-cache-read'
      }
    }

    const rankedCandidates = observation.candidates
      .slice()
      .filter(candidate => candidate.estimatedInputTokens > 0)
      .sort((a, b) => b.estimatedInputTokens - a.estimatedInputTokens)

    if (rankedCandidates.length === 0) {
      this.conversations.delete(conversationKey)
      return {
        status: 'skipped',
        conversationKey,
        reason: 'no-candidates'
      }
    }

    const nextRunAt = observedAt + this.policy.refreshAfterMs
    const selected = rankedCandidates[0]
    const tracked: CacheWarmTrackedConversation = {
      conversationKey,
      candidates: rankedCandidates,
      selectedCandidateId: selected.id,
      nextRunAt,
      refreshesCompleted: 0,
      refreshesRemaining: this.policy.maxRefreshes
    }
    this.conversations.set(conversationKey, tracked)

    return {
      status: 'scheduled',
      conversationKey,
      candidateId: selected.id,
      runAt: nextRunAt,
      refreshesRemaining: tracked.refreshesRemaining
    }
  }

  prepareRefresh(input: CacheWarmPrepareInput): CacheWarmPrepareResult {
    const tracked = this.conversations.get(input.conversationKey)
    if (!tracked) {
      return blocked(input.conversationKey, 'not-found')
    }

    if (tracked.refreshesRemaining <= 0) {
      this.conversations.delete(input.conversationKey)
      return blocked(input.conversationKey, 'max-refreshes-reached')
    }

    if (input.now < tracked.nextRunAt) {
      return blocked(input.conversationKey, 'not-due')
    }

    const candidate = selectUnchangedCandidate(
      tracked.candidates,
      input.currentFingerprintsByCandidateId
    )

    if (!candidate) {
      this.conversations.delete(input.conversationKey)
      return blocked(input.conversationKey, 'content-changed')
    }

    tracked.selectedCandidateId = candidate.id

    return {
      status: 'ready',
      conversationKey: input.conversationKey,
      candidateId: candidate.id,
      request: withWarmMaxTokens(candidate.request),
      attemptNumber: tracked.refreshesCompleted + 1,
      refreshesRemaining: tracked.refreshesRemaining
    }
  }

  completeRefresh(input: CacheWarmCompleteInput): CacheWarmCompleteResult {
    const tracked = this.conversations.get(input.conversationKey)
    if (!tracked) {
      return {
        status: 'stopped',
        conversationKey: input.conversationKey,
        reason: 'not-found'
      }
    }

    if (input.cacheReadInputTokens <= 0) {
      this.conversations.delete(input.conversationKey)
      return {
        status: 'stopped',
        conversationKey: input.conversationKey,
        reason: 'no-cache-read'
      }
    }

    tracked.refreshesCompleted += 1
    tracked.refreshesRemaining = Math.max(0, tracked.refreshesRemaining - 1)
    if (tracked.refreshesRemaining <= 0) {
      this.conversations.delete(input.conversationKey)
      return {
        status: 'stopped',
        conversationKey: input.conversationKey,
        reason: 'max-refreshes-reached'
      }
    }

    tracked.nextRunAt = input.completedAt + this.policy.refreshAfterMs
    return {
      status: 'rescheduled',
      conversationKey: input.conversationKey,
      nextRunAt: tracked.nextRunAt,
      refreshesRemaining: tracked.refreshesRemaining
    }
  }

  cancelConversation(conversationKey: string): boolean {
    return this.conversations.delete(conversationKey)
  }

  getConversationState(conversationKey: string): CacheWarmConversationState | null {
    const tracked = this.conversations.get(conversationKey)
    if (!tracked) return null
    const selected = tracked.candidates.find(candidate => candidate.id === tracked.selectedCandidateId)
    return {
      conversationKey: tracked.conversationKey,
      candidateId: tracked.selectedCandidateId,
      nextRunAt: tracked.nextRunAt,
      refreshesCompleted: tracked.refreshesCompleted,
      refreshesRemaining: tracked.refreshesRemaining,
      contentFingerprint: selected?.contentFingerprint ?? ''
    }
  }
}

type CacheWarmTrackedConversation = {
  conversationKey: string
  candidates: CacheWarmCandidate[]
  selectedCandidateId: string
  nextRunAt: number
  refreshesCompleted: number
  refreshesRemaining: number
}

function blocked(
  conversationKey: string,
  reason: Extract<CacheWarmPrepareResult, { status: 'blocked' }>['reason']
): Extract<CacheWarmPrepareResult, { status: 'blocked' }> {
  return {
    status: 'blocked',
    conversationKey,
    reason
  }
}

function selectUnchangedCandidate(
  candidates: CacheWarmCandidate[],
  fingerprintsByCandidateId: Record<string, string>
): CacheWarmCandidate | undefined {
  return candidates.find(candidate => {
    const currentFingerprint = fingerprintsByCandidateId[candidate.id]
    return currentFingerprint === candidate.contentFingerprint
  })
}

function cloneRequest(request: CacheWarmRequest): CacheWarmRequest {
  return {
    ...request,
    messages: request.messages.map(message => ({
      ...message,
      cacheControl: message.cacheControl
        ? { ...message.cacheControl }
        : undefined
    }))
  }
}

function withWarmMaxTokens(request: CacheWarmRequest): CacheWarmRequest {
  const cloned = cloneRequest(request)
  return {
    ...cloned,
    maxTokens: WARM_REQUEST_MAX_TOKENS
  }
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < 0) return 0
  return Math.floor(value)
}
