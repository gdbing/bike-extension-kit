import * as assert from 'assert'
import type { Row } from 'bike/app'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import { hasMissingInlineIds, mapInlineRowsById, mapRowsById } from '../../src/inlining.bkext/app/inline-sync-rows'
import { buildOutline, TestRow } from './test-outline'
import { test } from './test-harness'

function asRow(row: TestRow): Row {
  return row as unknown as Row
}

test('hasMissingInlineIds detects rows without inline ids', () => {
  const outline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        { key: 'alpha', text: 'Alpha', attributes: { [INLINE_ID_ATTR]: 'row-1' } },
        { key: 'beta', text: 'Beta' }
      ]
    }
  ])

  assert.strictEqual(hasMissingInlineIds(asRow(outline.byKey.inline)), true)

  outline.byKey.beta.attributes[INLINE_ID_ATTR] = 'row-2'
  assert.strictEqual(hasMissingInlineIds(asRow(outline.byKey.inline)), false)
})

test('mapInlineRowsById prefers the first occurrence', () => {
  const outline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        { key: 'alpha', text: 'Alpha', attributes: { [INLINE_ID_ATTR]: 'row-1' } },
        { key: 'beta', text: 'Beta', attributes: { [INLINE_ID_ATTR]: 'row-1' } }
      ]
    }
  ])

  const map = mapInlineRowsById(asRow(outline.byKey.inline))
  assert.strictEqual(map.size, 1)
  assert.strictEqual(map.get('row-1'), outline.byKey.alpha)
})

test('mapRowsById indexes nested rows', () => {
  const outline = buildOutline([
    {
      key: 'alpha',
      text: 'Alpha',
      children: [{ key: 'child', text: 'Child' }]
    }
  ])

  const map = mapRowsById(asRow(outline.outline.root))
  assert.strictEqual(map.get(outline.byKey.alpha.id), outline.byKey.alpha)
  assert.strictEqual(map.get(outline.byKey.child.id), outline.byKey.child)
})
