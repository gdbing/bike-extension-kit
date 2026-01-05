import * as assert from 'assert'
import type { Document, Outline, Row } from 'bike/app'
import type { DocInfo, InlineInfo, InlineLink } from '../../src/inlining.bkext/app/inline-model'
import { decideSyncSource } from '../../src/inlining.bkext/app/inline-decision'
import { test } from './test-harness'

function makeDocument(displayName: string): Document {
  return { displayName } as unknown as Document
}

function makeInlineInfo(name: string): InlineInfo {
  const hostDoc = makeDocument(name)
  const targetDoc: DocInfo = {
    document: makeDocument(`target-${name}`),
    outline: {} as Outline,
    displayName: `target-${name}`
  }
  const link: InlineLink = {
    heading: {} as Row,
    hostDoc,
    hostOutline: {} as Outline,
    targetDoc
  }
  return {
    link,
    inlineSig: '',
    prevInlineSig: '',
    inlineChanged: true,
    needsInlineIds: false
  }
}

test('decideSyncSource prefers inline when doc changed and last edit matches', () => {
  const inlineInfo = makeInlineInfo('Host')
  const decision = decideSyncSource({
    docChanged: true,
    inlineChangedInfos: [inlineInfo],
    lastChangedDocument: inlineInfo.link.hostDoc,
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, 'inline')
  assert.strictEqual(decision.inlineSource, inlineInfo)
})

test('decideSyncSource prefers doc when doc changed and last edit differs', () => {
  const inlineInfo = makeInlineInfo('Host')
  const decision = decideSyncSource({
    docChanged: true,
    inlineChangedInfos: [inlineInfo],
    lastChangedDocument: makeDocument('Other'),
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, 'doc')
  assert.strictEqual(decision.inlineSource, undefined)
})

test('decideSyncSource prefers doc when multiple inline copies changed', () => {
  const decision = decideSyncSource({
    docChanged: true,
    inlineChangedInfos: [makeInlineInfo('A'), makeInlineInfo('B')],
    lastChangedDocument: makeDocument('A'),
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, 'doc')
})

test('decideSyncSource picks inline when only one inline copy changed', () => {
  const inlineInfo = makeInlineInfo('Solo')
  const decision = decideSyncSource({
    docChanged: false,
    inlineChangedInfos: [inlineInfo],
    lastChangedDocument: undefined,
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, 'inline')
  assert.strictEqual(decision.inlineSource, inlineInfo)
})

test('decideSyncSource falls back to doc when multiple inline changes and mismatch', () => {
  const decision = decideSyncSource({
    docChanged: false,
    inlineChangedInfos: [makeInlineInfo('A'), makeInlineInfo('B')],
    lastChangedDocument: undefined,
    hasMismatchOrMissingIds: true
  })

  assert.strictEqual(decision.source, 'doc')
})

test('decideSyncSource returns null when multiple inline changes but no mismatch', () => {
  const decision = decideSyncSource({
    docChanged: false,
    inlineChangedInfos: [makeInlineInfo('A'), makeInlineInfo('B')],
    lastChangedDocument: undefined,
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, null)
})

test('decideSyncSource returns doc when no inline changes but mismatch present', () => {
  const decision = decideSyncSource({
    docChanged: false,
    inlineChangedInfos: [],
    lastChangedDocument: undefined,
    hasMismatchOrMissingIds: true
  })

  assert.strictEqual(decision.source, 'doc')
})

test('decideSyncSource returns null when no inline changes and no mismatch', () => {
  const decision = decideSyncSource({
    docChanged: false,
    inlineChangedInfos: [],
    lastChangedDocument: undefined,
    hasMismatchOrMissingIds: false
  })

  assert.strictEqual(decision.source, null)
})
