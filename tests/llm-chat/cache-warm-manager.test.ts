import * as assert from 'node:assert/strict'
import {
  CacheWarmCandidate,
  CacheWarmManager,
  DEFAULT_CACHE_WARM_POLICY,
  WARM_REQUEST_MAX_TOKENS
} from '../../src/llm-chat.bkext/app/cache-warm-manager'
import { test } from './test-harness'

function candidate(
  id: string,
  estimatedInputTokens: number,
  contentFingerprint: string
): CacheWarmCandidate {
  return {
    id,
    estimatedInputTokens,
    contentFingerprint,
    request: {
      messages: [{ role: 'user', content: `${id}\n` }],
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      maxTokens: 4096
    }
  }
}

test('uses default cache warm policy values', () => {
  const manager = new CacheWarmManager()
  assert.deepEqual(manager.policy, DEFAULT_CACHE_WARM_POLICY)
})

test('allows overriding cache warm policy values', () => {
  const manager = new CacheWarmManager({
    refreshAfterMs: 120_000,
    maxRefreshes: 5
  })

  assert.deepEqual(manager.policy, {
    refreshAfterMs: 120_000,
    maxRefreshes: 5
  })
})

test('recordObservation schedules when cache activity (read or write) was observed', () => {
  const manager = new CacheWarmManager()

  const skipped = manager.recordObservation({
    conversationKey: 'doc-1',
    observedAt: 1_000,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    candidates: [candidate('small', 200, 'fp-small')]
  })

  assert.deepEqual(skipped, {
    status: 'skipped',
    conversationKey: 'doc-1',
    reason: 'no-cache-activity'
  })

  const scheduledFromWrite = manager.recordObservation({
    conversationKey: 'doc-1',
    observedAt: 1_000,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 40,
    candidates: [candidate('small', 200, 'fp-small')]
  })

  assert.deepEqual(scheduledFromWrite, {
    status: 'scheduled',
    conversationKey: 'doc-1',
    candidateId: 'small',
    runAt: 1_000 + manager.policy.refreshAfterMs,
    refreshesRemaining: manager.policy.maxRefreshes
  })

  const scheduledFromRead = manager.recordObservation({
    conversationKey: 'doc-1',
    observedAt: 1_000,
    cacheReadInputTokens: 40,
    cacheWriteInputTokens: 0,
    candidates: [candidate('small', 200, 'fp-small')]
  })

  assert.deepEqual(scheduledFromRead, {
    status: 'scheduled',
    conversationKey: 'doc-1',
    candidateId: 'small',
    runAt: 1_000 + manager.policy.refreshAfterMs,
    refreshesRemaining: manager.policy.maxRefreshes
  })
})

test('recordObservation selects the longest candidate for warming', () => {
  const manager = new CacheWarmManager()

  const scheduled = manager.recordObservation({
    conversationKey: 'doc-2',
    observedAt: 1_000,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    candidates: [
      candidate('short', 100, 'fp-short'),
      candidate('long', 1_500, 'fp-long'),
      candidate('medium', 500, 'fp-medium')
    ]
  })

  assert.deepEqual(scheduled, {
    status: 'scheduled',
    conversationKey: 'doc-2',
    candidateId: 'long',
    runAt: 1_000 + manager.policy.refreshAfterMs,
    refreshesRemaining: manager.policy.maxRefreshes
  })
})

test('prepareRefresh verifies candidate fingerprint before warming', () => {
  const manager = new CacheWarmManager()
  manager.recordObservation({
    conversationKey: 'doc-3',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('long', 1_500, 'fp-long')]
  })

  const blocked = manager.prepareRefresh({
    conversationKey: 'doc-3',
    now: 1_000 + manager.policy.refreshAfterMs,
    currentFingerprintsByCandidateId: { long: 'fp-changed' }
  })

  assert.deepEqual(blocked, {
    status: 'blocked',
    conversationKey: 'doc-3',
    reason: 'content-changed'
  })
})

test('prepareRefresh hardcodes maxTokens=1 for warm refreshes', () => {
  const manager = new CacheWarmManager()
  manager.recordObservation({
    conversationKey: 'doc-4',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('long', 1_500, 'fp-long')]
  })

  const ready = manager.prepareRefresh({
    conversationKey: 'doc-4',
    now: 1_000 + manager.policy.refreshAfterMs,
    currentFingerprintsByCandidateId: { long: 'fp-long' }
  })

  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return
  assert.equal(ready.request.maxTokens, WARM_REQUEST_MAX_TOKENS)
  assert.equal(ready.candidateId, 'long')
  assert.equal(ready.attemptNumber, 1)
})

test('prepareRefresh falls back to a shorter unchanged candidate when longest changed', () => {
  const manager = new CacheWarmManager()
  manager.recordObservation({
    conversationKey: 'doc-4b',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [
      candidate('long', 2_000, 'fp-long'),
      candidate('short', 300, 'fp-short')
    ]
  })

  const ready = manager.prepareRefresh({
    conversationKey: 'doc-4b',
    now: 1_000 + manager.policy.refreshAfterMs,
    currentFingerprintsByCandidateId: {
      long: 'fp-long-changed',
      short: 'fp-short'
    }
  })

  assert.equal(ready.status, 'ready')
  if (ready.status !== 'ready') return
  assert.equal(ready.candidateId, 'short')
  assert.equal(ready.request.maxTokens, WARM_REQUEST_MAX_TOKENS)
})

test('completeRefresh reschedules while cache activity continues and attempts remain', () => {
  const manager = new CacheWarmManager({ maxRefreshes: 2 })
  manager.recordObservation({
    conversationKey: 'doc-5',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('long', 1_500, 'fp-long')]
  })

  const firstReady = manager.prepareRefresh({
    conversationKey: 'doc-5',
    now: 1_000 + manager.policy.refreshAfterMs,
    currentFingerprintsByCandidateId: { long: 'fp-long' }
  })
  assert.equal(firstReady.status, 'ready')

  const firstComplete = manager.completeRefresh({
    conversationKey: 'doc-5',
    completedAt: 2_000,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 5
  })

  assert.deepEqual(firstComplete, {
    status: 'rescheduled',
    conversationKey: 'doc-5',
    nextRunAt: 2_000 + manager.policy.refreshAfterMs,
    refreshesRemaining: 1
  })
})

test('completeRefresh stops when warmed response reports zero cache activity', () => {
  const manager = new CacheWarmManager({ maxRefreshes: 2 })
  manager.recordObservation({
    conversationKey: 'doc-6',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('long', 1_500, 'fp-long')]
  })

  const ready = manager.prepareRefresh({
    conversationKey: 'doc-6',
    now: 1_000 + manager.policy.refreshAfterMs,
    currentFingerprintsByCandidateId: { long: 'fp-long' }
  })
  assert.equal(ready.status, 'ready')

  const complete = manager.completeRefresh({
    conversationKey: 'doc-6',
    completedAt: 2_000,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0
  })

  assert.deepEqual(complete, {
    status: 'stopped',
    conversationKey: 'doc-6',
    reason: 'no-cache-activity'
  })
})

test('cancelConversation removes scheduled warming state', () => {
  const manager = new CacheWarmManager()
  manager.recordObservation({
    conversationKey: 'doc-7',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('long', 1_500, 'fp-long')]
  })

  const removed = manager.cancelConversation('doc-7')
  assert.equal(removed, true)
  assert.equal(manager.getConversationState('doc-7'), null)
})

test('recordObservation replaces prior schedule for same conversation', () => {
  const manager = new CacheWarmManager()

  manager.recordObservation({
    conversationKey: 'doc-8',
    observedAt: 1_000,
    cacheReadInputTokens: 10,
    cacheWriteInputTokens: 0,
    candidates: [candidate('first', 100, 'fp-first')]
  })

  const scheduled = manager.recordObservation({
    conversationKey: 'doc-8',
    observedAt: 3_000,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    candidates: [candidate('second', 200, 'fp-second')]
  })

  assert.deepEqual(scheduled, {
    status: 'scheduled',
    conversationKey: 'doc-8',
    candidateId: 'second',
    runAt: 3_000 + manager.policy.refreshAfterMs,
    refreshesRemaining: manager.policy.maxRefreshes
  })
})
