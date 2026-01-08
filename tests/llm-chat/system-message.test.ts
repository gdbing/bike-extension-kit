import * as assert from 'node:assert/strict'
import { applyDefaultSystemMessage } from '../../src/llm-chat.bkext/app/system-message'
import { test } from './test-harness'

test('prepends the default system message when no system marker exists', () => {
  const messages = [{ role: 'user', content: 'Hello\n' }]
  const result = applyDefaultSystemMessage(messages as any, 'Line one.\nLine two.')

  assert.deepEqual(result, [
    { role: 'system', content: 'Line one.\nLine two.' },
    { role: 'user', content: 'Hello\n' }
  ])
})

test('skips the default system message when a system message is already present', () => {
  const messages = [
    { role: 'system', content: 'Use short answers\n' },
    { role: 'user', content: 'Hi\n' }
  ]
  const result = applyDefaultSystemMessage(messages as any, 'Default system message.')

  assert.deepEqual(result, messages)
})

test('skips the default system message when it is empty', () => {
  const messages = [{ role: 'user', content: 'Hi\n' }]
  const result = applyDefaultSystemMessage(messages as any, '')

  assert.deepEqual(result, messages)
})
