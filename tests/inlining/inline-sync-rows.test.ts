import * as assert from 'assert'
import type { Outline, Row } from 'bike/app'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import {
  mapInlineRowsById,
  removeExtraChildren,
  syncDocToInlineRows
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
    inlineMap: mapInlineRowsById(asRow(parent)),
    matched: new Set<Row>(),
    desiredChildren: new Map<Row, Row[]>()
  }
}

test('syncDocToInlineRows copies rows and inline ids', () => {
  const doc = buildOutline([
    {
      key: 'alpha',
      text: 'Alpha',
      attributes: { source: 'doc' },
      children: [{ key: 'alphaChild', text: 'Alpha child' }]
    },
    { key: 'beta', text: 'Beta' }
  ])

  const inline = buildOutline([{ key: 'inline', text: '<inline: Doc>' }])
  const parent = inline.byKey.inline
  const context = makeContext(parent)

  syncDocToInlineRows(asRows(doc.outline.root.children), asRow(parent), context)
  removeExtraChildren(asOutline(inline.outline), context.desiredChildren)

  assert.strictEqual(parent.children.length, 2)

  const [alpha, beta] = parent.children
  assert.strictEqual(alpha.text.string, 'Alpha')
  assert.strictEqual(alpha.attributes[INLINE_ID_ATTR], doc.byKey.alpha.id)
  assert.strictEqual(alpha.attributes.source, 'doc')
  assert.strictEqual(alpha.children.length, 1)
  assert.strictEqual(alpha.children[0].attributes[INLINE_ID_ATTR], doc.byKey.alphaChild.id)

  assert.strictEqual(beta.text.string, 'Beta')
  assert.strictEqual(beta.attributes[INLINE_ID_ATTR], doc.byKey.beta.id)
})

test('syncDocToInlineRows reorders existing inline rows', () => {
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

  const parent = inline.byKey.inline
  const context = makeContext(parent)

  syncDocToInlineRows(asRows(doc.outline.root.children), asRow(parent), context)
  removeExtraChildren(asOutline(inline.outline), context.desiredChildren)

  assert.strictEqual(parent.children[0], inline.byKey.inlineAlpha)
  assert.strictEqual(parent.children[1], inline.byKey.inlineBeta)
})
