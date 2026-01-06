import * as assert from 'node:assert/strict'
import { resolveRelativeFileUrl } from '../../src/llm-chat.bkext/app/inline-path'
import { test } from './test-harness'

test('resolveRelativeFileUrl handles dot segments and encoding', () => {
  const base = 'file:///Users/test/Notes/Main%20Doc.bike'
  const resolved = resolveRelativeFileUrl(base, 'sub/../shared/my doc.bike')

  assert.equal(resolved, 'file:///Users/test/Notes/shared/my%20doc.bike')
})

test('resolveRelativeFileUrl preserves encoded segments', () => {
  const base = 'file:///Users/test/Notes/Main%20Doc.bike'
  const resolved = resolveRelativeFileUrl(base, 'shared/my%20doc.bike')

  assert.equal(resolved, 'file:///Users/test/Notes/shared/my%20doc.bike')
})
