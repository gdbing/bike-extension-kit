import * as assert from 'node:assert/strict'
import { InlineOpenDependencies, openInlineDocumentsIfNeeded } from '../../src/llm-chat.bkext/app/inline-opener'
import { buildOutline } from './outline-builder'
import { test } from './test-harness'

function makeEditor(root: ReturnType<typeof buildOutline>['root']) {
  return { outline: { root } } as any
}

test('opens missing inline documents and rescans nested inline references', async () => {
  const mainDoc = buildOutline([
    {
      text: '<inline>',
      children: [{ text: 'file:///doc1.bike' }]
    },
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const doc1 = buildOutline([
    {
      text: '<inline>',
      children: [{ text: 'file:///doc2.bike' }]
    }
  ])

  const doc2 = buildOutline([
    {
      text: '<assistant>',
      children: [{ text: 'Doc2 reply' }]
    }
  ])

  const openDocs = new Map<string, any>([
    ['file:///main.bike', mainDoc.root]
  ])
  const allDocs = new Map<string, any>([
    ['file:///doc1.bike', doc1.root],
    ['file:///doc2.bike', doc2.root]
  ])
  const opened: string[] = []
  let restored: string | null = null

  const deps: InlineOpenDependencies = {
    canOpenURL: true,
    openUrl: (url) => {
      opened.push(url)
      const root = allDocs.get(url)
      if (root) {
        openDocs.set(url, root)
      }
    },
    isInlineDocumentOpen: (url) => openDocs.has(url),
    getOpenDocumentRoot: (url) => openDocs.get(url) ?? null,
    getEditorDocumentFileUrl: () => 'file:///main.bike',
    restoreFrontmostDocument: (url) => {
      restored = url
    },
    waitForInlineDocuments: async () => {}
  }

  await openInlineDocumentsIfNeeded(
    makeEditor(mainDoc.root),
    mainDoc.byKey['cursor'] as any,
    'file:///main.bike',
    deps
  )

  assert.deepEqual(opened, ['file:///doc1.bike', 'file:///doc2.bike'])
  assert.equal(restored, 'file:///main.bike')
})

test('resolves relative inline paths and ignores markers after the stop row', async () => {
  const mainDoc = buildOutline([
    {
      text: '<inline>',
      children: [{ text: 'sub/child.bike' }]
    },
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'cursor' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'file:///ignored.bike' }]
    }
  ])

  const childDoc = buildOutline([
    {
      text: '<assistant>',
      children: [{ text: 'Child reply' }]
    }
  ])

  const openDocs = new Map<string, any>([
    ['file:///root/main.bike', mainDoc.root]
  ])
  const allDocs = new Map<string, any>([
    ['file:///root/sub/child.bike', childDoc.root]
  ])
  const opened: string[] = []
  let restored: string | null = null

  const deps: InlineOpenDependencies = {
    canOpenURL: true,
    openUrl: (url) => {
      opened.push(url)
      const root = allDocs.get(url)
      if (root) {
        openDocs.set(url, root)
      }
    },
    isInlineDocumentOpen: (url) => openDocs.has(url),
    getOpenDocumentRoot: (url) => openDocs.get(url) ?? null,
    getEditorDocumentFileUrl: () => 'file:///root/main.bike',
    restoreFrontmostDocument: (url) => {
      restored = url
    },
    waitForInlineDocuments: async () => {}
  }

  await openInlineDocumentsIfNeeded(
    makeEditor(mainDoc.root),
    mainDoc.byKey['cursor'] as any,
    'file:///root/main.bike',
    deps
  )

  assert.deepEqual(opened, ['file:///root/sub/child.bike'])
  assert.equal(restored, 'file:///root/main.bike')
})

test('skips inline opening when openURL is unavailable', async () => {
  const mainDoc = buildOutline([
    {
      text: '<inline>',
      children: [{ text: 'file:///doc1.bike' }]
    },
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const opened: string[] = []
  let restored = false

  const deps: InlineOpenDependencies = {
    canOpenURL: false,
    openUrl: (url) => {
      opened.push(url)
    },
    isInlineDocumentOpen: () => false,
    getOpenDocumentRoot: () => null,
    getEditorDocumentFileUrl: () => 'file:///main.bike',
    restoreFrontmostDocument: () => {
      restored = true
    }
  }

  await openInlineDocumentsIfNeeded(
    makeEditor(mainDoc.root),
    mainDoc.byKey['cursor'] as any,
    'file:///main.bike',
    deps
  )

  assert.deepEqual(opened, [])
  assert.equal(restored, false)
})
