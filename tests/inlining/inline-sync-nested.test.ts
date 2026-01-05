import * as assert from 'assert'
import type { Outline, Row } from 'bike/app'
import { InlineDocumentSync } from '../../src/inlining.bkext/app/inline-sync'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import { buildOutline, TestRow } from './test-outline'
import { test } from './test-harness'

type SyncTools = {
  syncInlineFromDoc: (parent: Row, sourceRows: Row[], label: string) => void
  syncDocFromInline: (parent: Row, sourceRows: Row[], label: string, inlineOutline: Outline) => void
}

function makeText(value: string): { string: string; toHTML: () => string } {
  return { string: value, toHTML: () => value }
}

function setRowText(row: TestRow, value: string): void {
  row.text = makeText(value)
}

function asRows(rows: TestRow[]): Row[] {
  return rows as unknown as Row[]
}


function getInlineHeadingInB(outlineB: ReturnType<typeof buildOutline>): TestRow {
  const inlineHeading = outlineB.outline.root.children[0]
  assert.ok(inlineHeading, 'Expected inline heading in B root')
  return inlineHeading
}

function getInlineHeadingInC(outlineC: ReturnType<typeof buildOutline>): TestRow {
  const inlineHeading = outlineC.outline.root.children[0]
  assert.ok(inlineHeading, 'Expected inline heading in C root')
  return inlineHeading
}

function getInlineRowInB(outlineB: ReturnType<typeof buildOutline>): TestRow {
  const inlineHeading = getInlineHeadingInB(outlineB)
  const child = inlineHeading.children[0]
  assert.ok(child, 'Expected inline content under B inline heading')
  return child
}

function getInlineRowInC(outlineC: ReturnType<typeof buildOutline>): TestRow {
  const inlineHeading = getInlineHeadingInC(outlineC)
  const inlineRow = inlineHeading.children[0]
  assert.ok(inlineRow, 'Expected inline content under C inline heading')
  const child = inlineRow.children[0]
  assert.ok(child, 'Expected nested inline content under C inline row')
  return child
}

function getDocRow(outline: ReturnType<typeof buildOutline>): TestRow {
  const row = outline.outline.root.children[0]
  assert.ok(row, 'Expected a doc row')
  return row
}

function setupNestedChain(): {
  outlineA: ReturnType<typeof buildOutline>
  outlineB: ReturnType<typeof buildOutline>
  outlineC: ReturnType<typeof buildOutline>
  tools: SyncTools
} {
  const outlineA = buildOutline([{ key: 'a1', text: 'Alpha' }])
  const outlineB = buildOutline([{ key: 'inlineA', text: '<inline: A>' }])
  const outlineC = buildOutline([{ key: 'inlineB', text: '<inline: B>' }])

  const tools = new InlineDocumentSync() as unknown as SyncTools

  tools.syncInlineFromDoc(
    getInlineHeadingInB(outlineB) as unknown as Row,
    asRows(outlineA.outline.root.children),
    'A'
  )
  tools.syncInlineFromDoc(
    getInlineHeadingInC(outlineC) as unknown as Row,
    asRows(outlineB.outline.root.children),
    'B'
  )

  const inlineRowB = getInlineRowInB(outlineB)
  const inlineRowC = getInlineRowInC(outlineC)
  assert.strictEqual(inlineRowC.attributes[INLINE_ID_ATTR], inlineRowB.id)

  return { outlineA, outlineB, outlineC, tools }
}

test('nested propagation updates all docs after editing A', () => {
  const { outlineA, outlineB, outlineC, tools } = setupNestedChain()

  setRowText(getDocRow(outlineA), 'Updated-A')
  tools.syncInlineFromDoc(
    getInlineHeadingInB(outlineB) as unknown as Row,
    asRows(outlineA.outline.root.children),
    'A'
  )
  tools.syncInlineFromDoc(
    getInlineHeadingInC(outlineC) as unknown as Row,
    asRows(outlineB.outline.root.children),
    'B'
  )

  assert.strictEqual(getDocRow(outlineA).text.string, 'Updated-A')
  assert.strictEqual(getInlineRowInB(outlineB).text.string, 'Updated-A')
  assert.strictEqual(getInlineRowInC(outlineC).text.string, 'Updated-A')
})

test('nested propagation updates all docs after editing B', () => {
  const { outlineA, outlineB, outlineC, tools } = setupNestedChain()

  setRowText(getInlineRowInB(outlineB), 'Updated-B')
  tools.syncDocFromInline(
    outlineA.outline.root as unknown as Row,
    asRows(getInlineHeadingInB(outlineB).children),
    'A',
    outlineB.outline as unknown as Outline
  )
  tools.syncInlineFromDoc(
    getInlineHeadingInC(outlineC) as unknown as Row,
    asRows(outlineB.outline.root.children),
    'B'
  )

  assert.strictEqual(getDocRow(outlineA).text.string, 'Updated-B')
  assert.strictEqual(getInlineRowInB(outlineB).text.string, 'Updated-B')
  assert.strictEqual(getInlineRowInC(outlineC).text.string, 'Updated-B')
})

test('nested propagation updates all docs after editing C', () => {
  const { outlineA, outlineB, outlineC, tools } = setupNestedChain()

  setRowText(getInlineRowInC(outlineC), 'Updated-C')
  tools.syncDocFromInline(
    outlineB.outline.root as unknown as Row,
    asRows(getInlineHeadingInC(outlineC).children),
    'B',
    outlineC.outline as unknown as Outline
  )
  assert.strictEqual(getInlineRowInB(outlineB).text.string, 'Updated-C')
  tools.syncDocFromInline(
    outlineA.outline.root as unknown as Row,
    asRows(getInlineHeadingInB(outlineB).children),
    'A',
    outlineB.outline as unknown as Outline
  )
  tools.syncInlineFromDoc(
    getInlineHeadingInC(outlineC) as unknown as Row,
    asRows(outlineB.outline.root.children),
    'B'
  )

  assert.strictEqual(getDocRow(outlineA).text.string, 'Updated-C')
  assert.strictEqual(getInlineRowInB(outlineB).text.string, 'Updated-C')
  assert.strictEqual(getInlineRowInC(outlineC).text.string, 'Updated-C')
})
