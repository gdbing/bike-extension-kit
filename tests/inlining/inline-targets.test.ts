import * as assert from 'assert'
import type { Document, Outline, Row } from 'bike/app'
import type { DocInfo } from '../../src/inlining.bkext/app/inline-model'
import {
  buildAmbiguousWarning,
  buildCycleWarning,
  collectInlineHeadings,
  createWarningRowSource,
  getInlineTarget,
  indexDocumentsByName,
  isWarningRow
} from '../../src/inlining.bkext/app/inline-targets'
import { YieldController } from '../../src/inlining.bkext/app/inline-yield'
import { buildOutline, TestRow } from './test-outline'
import { test } from './test-harness'

function asRow(row: TestRow): Row {
  return row as unknown as Row
}

function asOutline(outline: ReturnType<typeof buildOutline>['outline']): Outline {
  return outline as unknown as Outline
}

function makeDocument(displayName: string): Document {
  return { displayName } as unknown as Document
}

function makeDocInfo(displayName: string, outline: ReturnType<typeof buildOutline>['outline']): DocInfo {
  const document = makeDocument(displayName)
  return { document, outline: asOutline(outline), displayName }
}

test('getInlineTarget parses markers and trims outer whitespace', () => {
  const outline = buildOutline([{ key: 'inline', text: '  <inline:  Doc Name  >  ' }])
  const row = outline.byKey.inline
  const target = getInlineTarget(asRow(row))

  assert.ok(target)
  assert.strictEqual(target.name, 'doc name')
  assert.strictEqual(target.label, 'Doc Name')
})

test('getInlineTarget rejects invalid markers', () => {
  const outline = buildOutline([
    { key: 'empty', text: '<inline:   >' },
    { key: 'missing', text: 'inline: Doc' }
  ])

  assert.strictEqual(getInlineTarget(asRow(outline.byKey.empty)), null)
  assert.strictEqual(getInlineTarget(asRow(outline.byKey.missing)), null)
})

test('indexDocumentsByName matches case-insensitively', () => {
  const docA = makeDocInfo('Doc', buildOutline([]).outline)
  const docB = makeDocInfo('doc', buildOutline([]).outline)
  const map = indexDocumentsByName([docA, docB])

  const matches = map.get('doc')
  assert.ok(matches)
  assert.strictEqual(matches.length, 2)
})

test('collectInlineHeadings resolves links, missing, and ambiguous targets', async () => {
  const host = buildOutline([
    {
      key: 'inlineTarget',
      text: '<inline: Target>',
      children: [{ key: 'inlineChild', text: '<inline: Child>' }]
    },
    { key: 'plain', text: 'Plain row' },
    { key: 'inlineAmbiguous', text: '<inline: Ambiguous>' },
    { key: 'inlineMissing', text: '<inline: Missing>' },
    { key: 'inlineSelf', text: '<inline: Host>' }
  ])

  const target = buildOutline([])
  const ambiguousA = buildOutline([])
  const ambiguousB = buildOutline([])

  const hostInfo = makeDocInfo('Host', host.outline)
  const targetInfo = makeDocInfo('Target', target.outline)
  const ambiguousInfoA = makeDocInfo('Ambiguous', ambiguousA.outline)
  const ambiguousInfoB = makeDocInfo('Ambiguous', ambiguousB.outline)

  const docsByName = indexDocumentsByName([hostInfo, targetInfo, ambiguousInfoA, ambiguousInfoB])
  const { links, missing, ambiguous } = await collectInlineHeadings([hostInfo], docsByName, new YieldController())

  assert.strictEqual(links.length, 1)
  assert.strictEqual(links[0].heading, host.byKey.inlineTarget)
  assert.strictEqual(links[0].targetDoc.displayName, 'Target')

  const missingIds = new Set(missing.map((entry) => entry.heading.id))
  assert.ok(missingIds.has(host.byKey.inlineMissing.id))
  assert.ok(missingIds.has(host.byKey.inlineSelf.id))
  assert.strictEqual(missingIds.has(host.byKey.inlineChild.id), false)
  assert.strictEqual(missingIds.has(host.byKey.plain.id), false)

  assert.strictEqual(ambiguous.length, 1)
  assert.strictEqual(ambiguous[0].heading, host.byKey.inlineAmbiguous)
})

test('ambiguous warning helpers describe the target', () => {
  const message = buildAmbiguousWarning('Notes')
  const outline = buildOutline([{ key: 'warning', text: message, type: 'note' }])
  const row = outline.byKey.warning

  assert.strictEqual(message, '⚠️ Multiple documents named "Notes" are open')
  assert.ok(isWarningRow(asRow(row), message))
  assert.deepStrictEqual(createWarningRowSource(message), { type: 'note', text: message })
})

test('cycle warning helper describes the target', () => {
  const message = buildCycleWarning('Notes')
  assert.strictEqual(message, '⚠️ Inline cycle detected for "Notes"')
})
