import type { CacheWarmCandidate, CacheWarmRequest } from './cache-warm-manager'
import { WARM_REQUEST_MAX_TOKENS } from './cache-warm-manager'
import type { Message, StreamOptions } from './providers/types'

export type WarmRequestOptions = Pick<
  StreamOptions,
  'model' | 'provider' | 'temperature' | 'reasoningEffort'
>

export function buildCacheWarmCandidates(
  messages: Message[],
  options: WarmRequestOptions
): CacheWarmCandidate[] {
  const candidateIndexes = collectCacheCandidateIndexes(messages)
  return candidateIndexes.map((messageIndex) => {
    const prefixMessages = messages.slice(0, messageIndex + 1).map(cloneMessage)
    const request: CacheWarmRequest = {
      ...options,
      maxTokens: WARM_REQUEST_MAX_TOKENS,
      messages: prefixMessages
    }
    return {
      id: `m${messageIndex}`,
      estimatedInputTokens: estimateTokens(prefixMessages),
      contentFingerprint: fingerprintRequest(request),
      request
    }
  })
}

export function buildCandidateFingerprintMap(
  candidates: CacheWarmCandidate[]
): Record<string, string> {
  const fingerprints: Record<string, string> = {}
  for (const candidate of candidates) {
    fingerprints[candidate.id] = candidate.contentFingerprint
  }
  return fingerprints
}

function collectCacheCandidateIndexes(messages: Message[]): number[] {
  const explicitIndexes = new Set<number>()
  const userIndexes: number[] = []

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    const content = message.content.trim()
    if (!content) continue
    if (message.role === 'user') {
      userIndexes.push(index)
    }
    if (hasOneHourCacheControl(message)) {
      explicitIndexes.add(index)
    }
  }

  const recentUserIndexes = userIndexes.slice(-4)
  const merged = new Set<number>()
  for (const index of Array.from(explicitIndexes)) {
    merged.add(index)
  }
  for (const index of recentUserIndexes) {
    merged.add(index)
  }

  return Array.from(merged).sort((a, b) => a - b)
}

function hasOneHourCacheControl(message: Message): boolean {
  const cacheControl = message.cacheControl
  return Boolean(
    cacheControl &&
    cacheControl.type === 'ephemeral' &&
    cacheControl.ttl === '1h'
  )
}

function estimateTokens(messages: Message[]): number {
  let totalChars = 0
  for (const message of messages) {
    totalChars += message.content.length
  }
  return Math.max(1, Math.ceil(totalChars / 4))
}

function fingerprintRequest(request: CacheWarmRequest): string {
  const payload = {
    model: request.model ?? null,
    provider: request.provider ?? null,
    temperature: request.temperature ?? null,
    reasoningEffort: request.reasoningEffort ?? null,
    messages: request.messages.map(message => ({
      role: message.role,
      content: message.content,
      cacheControl: message.cacheControl ?? null
    }))
  }
  return hashString(JSON.stringify(payload))
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function cloneMessage(message: Message): Message {
  return {
    role: message.role,
    content: message.content,
    cacheControl: message.cacheControl
      ? { ...message.cacheControl }
      : undefined
  }
}
