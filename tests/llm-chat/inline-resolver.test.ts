import * as assert from 'node:assert/strict'
import { collectInlineReferences } from '../../src/llm-chat.bkext/app/inline-resolver'
import { test } from './test-harness'

test('collectInlineReferences reads link attributes at run start', () => {
  const url = 'http://example.com'
  const text = {
    string: 'a',
    attributeAt(name: string, index: number, affinity?: 'upstream' | 'downstream') {
      if (name !== 'a') return null
      const start = 0
      const end = 1
      const inRange = affinity === 'downstream'
        ? index >= start && index < end
        : index > start && index <= end
      return inRange ? url : null
    }
  }

  const markerRow: any = { id: 'marker' }
  const childRow: any = {
    id: 'child',
    parent: markerRow,
    nextInOutline: undefined,
    type: 'body',
    text
  }
  markerRow.nextInOutline = childRow

  const references = collectInlineReferences(markerRow)

  assert.equal(references.length, 1)
  assert.equal(references[0].link, url)
})
