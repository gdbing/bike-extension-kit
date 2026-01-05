import * as assert from 'assert'
import type { Outline, Row } from 'bike/app'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import {
  mapRowsById,
  removeExtraChildren,
  setInlineId,
  syncInlineToDocRows
} from '../../src/inlining.bkext/app/inline-sync-rows'
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

function makeContext(parent: TestRow) {
  return {
    matched: new Set<Row>(),
    desiredChildren: new Map<Row, Row[]>(),
    inlineUpdates: new Map<Row, string>(),
    docMap: mapRowsById(asRow(parent))
  }
}

test('syncInlineToDocRows creates doc rows and records inline ids', () => {
  const doc = buildOutline([])
  const inline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [{ key: 'alpha', text: 'Alpha', attributes: { priority: 'high' } }]
    }
  ])

  const parentDoc = doc.outline.root
  const inlineRow = inline.byKey.inline
  const inlineChild = inline.byKey.alpha
  const context = makeContext(parentDoc)

  syncInlineToDocRows(asRows(inlineRow.children), asRow(parentDoc), context)
  removeExtraChildren(asOutline(doc.outline), context.desiredChildren)

  assert.strictEqual(parentDoc.children.length, 1)
  const inserted = parentDoc.children[0]
  assert.strictEqual(inserted.text.string, 'Alpha')
  assert.strictEqual(inserted.attributes.priority, 'high')
  assert.strictEqual(inserted.attributes[INLINE_ID_ATTR], undefined)

  const update = context.inlineUpdates.get(asRow(inlineChild))
  assert.ok(update)
  setInlineId(asRow(inlineChild), update)
  assert.strictEqual(inlineChild.attributes[INLINE_ID_ATTR], inserted.id)
})

test('syncInlineToDocRows reorders doc rows to match inline ids', () => {
  const doc = buildOutline([
    { key: 'alpha', text: 'Alpha' },
    { key: 'beta', text: 'Beta' }
  ])

  const inline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        {
          key: 'inlineBeta',
          text: 'Beta',
          attributes: { [INLINE_ID_ATTR]: doc.byKey.beta.id }
        },
        {
          key: 'inlineAlpha',
          text: 'Alpha',
          attributes: { [INLINE_ID_ATTR]: doc.byKey.alpha.id }
        }
      ]
    }
  ])

  const context = makeContext(doc.outline.root)
  syncInlineToDocRows(asRows(inline.byKey.inline.children), asRow(doc.outline.root), context)
  removeExtraChildren(asOutline(doc.outline), context.desiredChildren)

  assert.strictEqual(doc.outline.root.children[0], doc.byKey.beta)
  assert.strictEqual(doc.outline.root.children[1], doc.byKey.alpha)
})

test('syncInlineToDocRows removes extra doc rows', () => {
  const doc = buildOutline([
    { key: 'alpha', text: 'Alpha' },
    { key: 'beta', text: 'Beta' }
  ])

  const inline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Doc>',
      children: [
        {
          key: 'inlineAlpha',
          text: 'Alpha',
          attributes: { [INLINE_ID_ATTR]: doc.byKey.alpha.id }
        }
      ]
    }
  ])

  const context = makeContext(doc.outline.root)
  syncInlineToDocRows(asRows(inline.byKey.inline.children), asRow(doc.outline.root), context)
  removeExtraChildren(asOutline(doc.outline), context.desiredChildren)

  assert.strictEqual(doc.outline.root.children.length, 1)
  assert.strictEqual(doc.outline.root.children[0], doc.byKey.alpha)
})
