import * as assert from 'node:assert/strict'
import { buildCacheWarmCandidates, buildCandidateFingerprintMap } from '../../src/llm-chat.bkext/app/cache-warm-candidates'
import { WARM_REQUEST_MAX_TOKENS } from '../../src/llm-chat.bkext/app/cache-warm-manager'
import type { Message } from '../../src/llm-chat.bkext/app/providers/types'
import { test } from './test-harness'

test('buildCacheWarmCandidates includes recent user turns and explicit one-hour markers', () => {
  const messages: Message[] = [
    { role: 'system', content: 'Rules\n' },
    { role: 'user', content: 'u1\n' },
    { role: 'assistant', content: 'a1\n' },
    { role: 'user', content: 'u2\n' },
    { role: 'assistant', content: 'a2\n', cacheControl: { type: 'ephemeral', ttl: '1h' } },
    { role: 'user', content: 'u3\n' },
    { role: 'user', content: 'u4\n' },
    { role: 'user', content: 'u5\n' }
  ]

  const candidates = buildCacheWarmCandidates(messages, {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic'
  })

  assert.deepEqual(candidates.map(candidate => candidate.id), ['m3', 'm4', 'm5', 'm6', 'm7'])
})

test('candidate warm requests are prefixes and hardcode maxTokens=1', () => {
  const messages: Message[] = [
    { role: 'user', content: 'short\n' },
    { role: 'assistant', content: 'reply\n' },
    { role: 'user', content: 'longer user line\n' }
  ]

  const candidates = buildCacheWarmCandidates(messages, { model: 'claude-haiku-4-5' })
  assert.equal(candidates.length, 2)

  const first = candidates[0]
  const second = candidates[1]
  assert.equal(first.request.messages.length, 1)
  assert.equal(second.request.messages.length, 3)
  assert.equal(first.request.maxTokens, WARM_REQUEST_MAX_TOKENS)
  assert.equal(second.request.maxTokens, WARM_REQUEST_MAX_TOKENS)
})

test('fingerprints change when candidate request content changes', () => {
  const base: Message[] = [
    { role: 'user', content: 'hello\n' },
    { role: 'assistant', content: 'world\n' },
    { role: 'user', content: 'follow-up\n' }
  ]

  const changed: Message[] = [
    { role: 'user', content: 'hello\n' },
    { role: 'assistant', content: 'WORLD\n' },
    { role: 'user', content: 'follow-up\n' }
  ]

  const baseMap = buildCandidateFingerprintMap(
    buildCacheWarmCandidates(base, { model: 'claude-haiku-4-5' })
  )
  const changedMap = buildCandidateFingerprintMap(
    buildCacheWarmCandidates(changed, { model: 'claude-haiku-4-5' })
  )

  assert.notEqual(baseMap['m2'], changedMap['m2'])
})

