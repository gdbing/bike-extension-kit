import * as assert from 'assert'
import type { Document } from 'bike/app'
import type { DocInfo, InlineHeading, InlineLink } from '../../src/inlining.bkext/app/inline-model'
import { InlineDocumentSync } from '../../src/inlining.bkext/app/inline-sync'
import { buildAmbiguousWarning, buildCycleWarning } from '../../src/inlining.bkext/app/inline-targets'
import type { Outline, Row } from 'bike/app'
import { buildOutline, TestRow } from './test-outline'
import { test } from './test-harness'

function makeDocument(displayName: string): Document {
  return { displayName } as unknown as Document
}

function makeDocInfo(displayName: string, outline: ReturnType<typeof buildOutline>['outline']): DocInfo {
  const document = makeDocument(displayName)
  return { document, outline: asOutline(outline), displayName }
}

function asRow(row: TestRow): Row {
  return row as unknown as Row
}

function asOutline(outline: ReturnType<typeof buildOutline>['outline']): Outline {
  return outline as unknown as Outline
}

test('removeMissingInlineChildren clears inline content for missing targets', () => {
  const outline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Missing>',
      children: [{ key: 'child', text: 'Child' }]
    }
  ])

  const sync = new InlineDocumentSync() as unknown as {
    removeMissingInlineChildren: (entries: InlineHeading[]) => void
  }

  const entry: InlineHeading = {
    heading: asRow(outline.byKey.inline),
    hostDoc: makeDocument('Host'),
    hostOutline: asOutline(outline.outline),
    target: { name: 'missing', label: 'Missing' }
  }

  sync.removeMissingInlineChildren([entry])
  assert.strictEqual(outline.byKey.inline.children.length, 0)
})

test('updateAmbiguousInlineChildren replaces children with a warning', () => {
  const outline = buildOutline([
    {
      key: 'inline',
      text: '<inline: Ambiguous>',
      children: [{ key: 'child', text: 'Child' }]
    }
  ])

  const sync = new InlineDocumentSync() as unknown as {
    updateAmbiguousInlineChildren: (entries: InlineHeading[]) => void
  }

  const entry: InlineHeading = {
    heading: asRow(outline.byKey.inline),
    hostDoc: makeDocument('Host'),
    hostOutline: asOutline(outline.outline),
    target: { name: 'ambiguous', label: 'Ambiguous' }
  }

  sync.updateAmbiguousInlineChildren([entry])
  assert.strictEqual(outline.byKey.inline.children.length, 1)

  const warning = outline.byKey.inline.children[0]
  const message = buildAmbiguousWarning('Ambiguous')
  assert.strictEqual(warning.text.string, message)
  assert.strictEqual(warning.type, 'note')

  sync.updateAmbiguousInlineChildren([entry])
  assert.strictEqual(outline.byKey.inline.children[0], warning)
})

test('updateCycleInlineChildren replaces children with a warning', () => {
  const outline = buildOutline([
    {
      key: 'inline',
      text: '<inline: LoOp>',
      children: [{ key: 'child', text: 'Child' }]
    }
  ])

  const sync = new InlineDocumentSync() as unknown as {
    updateCycleInlineChildren: (entries: InlineLink[]) => void
  }

  const entry: InlineLink = {
    heading: asRow(outline.byKey.inline),
    hostDoc: makeDocument('Host'),
    hostOutline: asOutline(outline.outline),
    targetDoc: makeDocInfo('Loop', buildOutline([]).outline)
  }

  sync.updateCycleInlineChildren([entry])
  assert.strictEqual(outline.byKey.inline.children.length, 1)

  const warning = outline.byKey.inline.children[0]
  const message = buildCycleWarning('LoOp')
  assert.strictEqual(warning.text.string, message)
  assert.strictEqual(warning.type, 'note')

  sync.updateCycleInlineChildren([entry])
  assert.strictEqual(outline.byKey.inline.children[0], warning)
})
