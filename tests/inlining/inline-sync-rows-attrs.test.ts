import * as assert from 'assert'
import type { Outline, Row } from 'bike/app'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import { removeExtraChildren, syncDocToInlineRows, syncInlineToDocRows, mapRowsById } from '../../src/inlining.bkext/app/inline-sync-rows'
import { buildOutline, TestRow } from './test-outline'
import { test } from './test-harness'

function asRow(row: TestRow): Row {
  return row as unknown as Row
}

function asRows(rows: TestRow[]): Row[] {
  return rows as unknown as Row[]
}

function asOutline(outline: ReturnType<typeof buildOutline>['outline']): Outline {
  return outline as unknown as Outline
}

test('syncDocToInlineRows replaces attributes to match the doc', () => {
  const doc = buildOutline([
    { key: 'alpha', text: 'Alpha', attributes: { keep: 'yes' } }
  ])

  const inline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        {
          key: 'inlineAlpha',
          text: 'Alpha',
          attributes: {
            [INLINE_ID_ATTR]: doc.byKey.alpha.id,
            keep: 'no',
            remove: 'x'
          }
        }
      ]
    }
  ])

  const parent = inline.byKey.inline
  const context = {
    inlineMap: new Map([[doc.byKey.alpha.id, asRow(inline.byKey.inlineAlpha)]]),
    matched: new Set<Row>(),
    desiredChildren: new Map<Row, Row[]>()
  }

  syncDocToInlineRows(asRows(doc.outline.root.children), asRow(parent), context)
  removeExtraChildren(asOutline(inline.outline), context.desiredChildren)

  const updated = inline.byKey.inlineAlpha
  assert.strictEqual(updated.attributes.keep, 'yes')
  assert.strictEqual(updated.attributes.remove, undefined)
  assert.strictEqual(updated.attributes[INLINE_ID_ATTR], doc.byKey.alpha.id)
})

test('syncInlineToDocRows removes extra attributes and strips inline id', () => {
  const doc = buildOutline([
    {
      key: 'alpha',
      text: 'Alpha',
      attributes: { remove: 'x', [INLINE_ID_ATTR]: 'stale' }
    }
  ])

  const inline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        {
          key: 'inlineAlpha',
          text: 'Alpha',
          attributes: { keep: 'yes', [INLINE_ID_ATTR]: doc.byKey.alpha.id }
        }
      ]
    }
  ])

  const context = {
    matched: new Set<Row>(),
    desiredChildren: new Map<Row, Row[]>(),
    inlineUpdates: new Map<Row, string>(),
    docMap: mapRowsById(asRow(doc.outline.root))
  }

  syncInlineToDocRows(asRows(inline.byKey.inline.children), asRow(doc.outline.root), context)
  removeExtraChildren(asOutline(doc.outline), context.desiredChildren)

  const updated = doc.byKey.alpha
  assert.strictEqual(updated.attributes.keep, 'yes')
  assert.strictEqual(updated.attributes.remove, undefined)
  assert.strictEqual(updated.attributes[INLINE_ID_ATTR], undefined)
})
