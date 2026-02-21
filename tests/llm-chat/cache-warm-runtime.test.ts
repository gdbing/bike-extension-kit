import * as assert from 'node:assert/strict'
import { CacheWarmManager } from '../../src/llm-chat.bkext/app/cache-warm-manager'
import {
  CacheWarmRuntime,
  CacheWarmRuntimeTarget
} from '../../src/llm-chat.bkext/app/cache-warm-runtime'
import type { CacheWarmCandidate } from '../../src/llm-chat.bkext/app/cache-warm-manager'
import { test } from './test-harness'

function candidate(id: string, fingerprint: string): CacheWarmCandidate {
  return {
    id,
    estimatedInputTokens: 100,
    contentFingerprint: fingerprint,
    request: {
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      maxTokens: 1,
      messages: [{ role: 'user', content: `${id}\n` }]
    }
  }
}

function target(conversationKey: string): CacheWarmRuntimeTarget {
  return {
    conversationKey,
    documentFileUrl: 'file:///test.bike',
    outlineRootId: 'root-1',
    stopMarkerRowId: 'row-1'
  }
}

test('observe replaces existing timer for same conversation key', () => {
  const callbacks = new Map<number, () => void>()
  const cleared: number[] = []
  let nextId = 0

  const runtime = new CacheWarmRuntime({
    manager: new CacheWarmManager({ refreshAfterMs: 10, maxRefreshes: 2 }),
    now: () => 100,
    setTimer: (callback) => {
      const id = ++nextId
      callbacks.set(id, () => {
        callbacks.delete(id)
        callback()
      })
      return id as any
    },
    clearTimer: (handle) => {
      const id = handle as unknown as number
      cleared.push(id)
      callbacks.delete(id)
    },
    getSnapshot: () => null,
    executeWarmRequest: async () => null
  })

  runtime.observe(target('doc::1'), {
    observedAt: 100,
    cacheReadInputTokens: 5,
    candidates: [candidate('m1', 'fp1')]
  })
  runtime.observe(target('doc::1'), {
    observedAt: 110,
    cacheReadInputTokens: 5,
    candidates: [candidate('m1', 'fp1')]
  })

  assert.deepEqual(cleared, [1])
  assert.equal(callbacks.size, 1)
})

test('scheduled refresh executes warm request and stops when cache read is zero', async () => {
  const callbacks = new Map<number, () => void>()
  let nextId = 0
  let executeCount = 0
  let now = 100

  const runtime = new CacheWarmRuntime({
    manager: new CacheWarmManager({ refreshAfterMs: 10, maxRefreshes: 2 }),
    now: () => now,
    setTimer: (callback) => {
      const id = ++nextId
      callbacks.set(id, () => {
        callbacks.delete(id)
        callback()
      })
      return id as any
    },
    clearTimer: (handle) => {
      callbacks.delete(handle as unknown as number)
    },
    getSnapshot: () => ({
      candidates: [candidate('m1', 'fp1')]
    }),
    executeWarmRequest: async () => {
      executeCount += 1
      return { cache_read_input_tokens: 0 }
    }
  })

  runtime.observe(target('doc::2'), {
    observedAt: 100,
    cacheReadInputTokens: 5,
    candidates: [candidate('m1', 'fp1')]
  })

  const callback = callbacks.get(1)
  assert.ok(callback)
  now = 120
  callback?.()
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(executeCount, 1)
  assert.equal(callbacks.size, 0)
})
