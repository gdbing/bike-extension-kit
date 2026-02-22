import { AppExtensionContext, CommandContext, OutlineEditor, Row, URL, Selection, Affinity } from 'bike/app'
import { ExtensionConfig, getConfig } from './config'
import type { InlineResolver } from './inline-resolver'
import { parseMessages } from './message-parser'
import { parseConversationSettings } from './settings-parser'
import { streamCompletion } from './providers/anthropic'
import type { CacheUsage } from './providers/types'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'
import {
  MARKER_ATTRIBUTE,
  updateMarkerAttribute,
  updateMarkerAttributes
} from './marker-attributes'
import { registerStatusInspector, resetStatus, updateCacheStatus } from './status-inspector'
import { applyDefaultSystemMessage } from './system-message'
import { runChatCommand, getResponseMarkerText } from './chat-command'
import { openInlineDocumentsIfNeeded } from './inline-opener'
import { buildCacheWarmCandidates, WarmRequestOptions } from './cache-warm-candidates'
import {
  CacheWarmRuntime,
  CacheWarmRuntimeSnapshot,
  CacheWarmRuntimeTarget
} from './cache-warm-runtime'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)
let canOpenURL = false
let cacheWarmRuntime: CacheWarmRuntime | null = null

async function sendMessageCommandAsync(context: CommandContext): Promise<void> {
  const editor = context.editor
  if (!editor) return

  const selection = editor.selection
  if (!selection) return

  console.log(`LLM Chat [${INSTANCE_ID}]: Starting request`)

  const originDocumentFileUrl =
    getEditorDocumentFileUrl(editor) ?? bike.frontmostDocument?.fileURL?.absoluteString ?? null
  const stopMarkerRow = getStopMarkerRow(selection.row)
  const conversationKey = getConversationKey(editor, stopMarkerRow, originDocumentFileUrl)

  await runChatCommand({
    editor,
    selection,
    originDocumentFileUrl,
    statusWindow: bike.frontmostWindow,
    inlineResolver: createInlineResolver()
  }, {
    getConfig,
    updateMarkerAttributes,
    openInlineDocumentsIfNeeded: (targetEditor, stopRow, originUrl) =>
      openInlineDocumentsIfNeeded(targetEditor, stopRow, originUrl, {
        canOpenURL,
        openUrl: (url) => {
          new URL(url).open({ activates: false, promptsUserIfNeeded: false })
        },
        isInlineDocumentOpen,
        getOpenDocumentRoot,
        getEditorDocumentFileUrl,
        restoreFrontmostDocument
      }),
    getInlineResolver: () => createInlineResolver(),
    parseMessages,
    parseConversationSettings,
    applyDefaultSystemMessage,
    streamCompletion,
    streamResponseToOutline,
    insertStaticResponse,
    resetStatus,
    updateCacheStatus,
    getResponseMarkerText,
    onSuccessfulStream: ({ messages, settings, usage, requestStartedAt }) => {
      if (!cacheWarmRuntime) return
      const config = getConfig()
      const candidates = buildCacheWarmCandidates(
        messages,
        resolveWarmRequestOptions(settings, config)
      )
      cacheWarmRuntime.observe(
        {
          conversationKey,
          documentFileUrl: originDocumentFileUrl,
          outlineRootId: editor.outline.root.id,
          stopMarkerRowId: stopMarkerRow.id
        },
        {
          observedAt: requestStartedAt,
          cacheReadInputTokens: Number(usage?.cache_read_input_tokens ?? 0),
          cacheWriteInputTokens: Number(usage?.cache_creation_input_tokens ?? 0),
          candidates
        }
      )
    }
  })
  return
}

function sendMessageCommand(context: CommandContext): boolean {
  if (!context.editor || !context.editor.selection) return false
  void sendMessageCommandAsync(context)
  return true
}

function insertUserMarkerCommand(context: CommandContext): boolean {
  const editor = context.editor
  if (!editor) return false

  const selection = context.selection ?? editor.selection
  if (!selection) return false

  const outline = editor.outline
  const selectedRows = selection.rows
  if (selectedRows.length === 0) return false

  const row = selection.row
  const isSingleRowSelection = selectedRows.length === 1
  const isRowEmpty = row.text.string.trim().length === 0
  const isCaretSelection = selection.type === 'caret' || selection.type === 'text'
  const selectionSnapshot = snapshotSelection(selection)

  editor.transaction({ label: 'Insert <user>', animate: 'default' }, () => {
    if (isCaretSelection && isSingleRowSelection && isRowEmpty) {
      const root = outline.root
      if (row.parent && row.parent.id !== root.id) {
        let topLevel = row
        while (topLevel.parent && topLevel.parent.id !== root.id) {
          topLevel = topLevel.parent
        }
        outline.moveRows([row], root, topLevel.nextSibling)
      }
      const currentText = row.text.string
      row.text.replace([0, currentText.length], '<user>')
      const childRow = outline.insertRows([{ text: '' }], row, row.firstChild)[0]
      editor.selectCaret(childRow, 0)
      return
    }

    const startRow =
      selection.type === 'block'
        ? selection.detail.startRow
        : selection.row
    const parent = startRow.parent ?? outline.root
    const markerRow = outline.insertRows([{ text: '<user>' }], parent, startRow)[0]
    outline.moveRows(selectedRows, markerRow)
    restoreSelection(editor, selectionSnapshot)
  })

  return true
}

type SelectionSnapshot =
  | { type: 'caret'; row: Row; char: number; runAffinity?: Affinity; lineAffinity: Affinity }
  | { type: 'text'; row: Row; anchor: number; head: number }
  | { type: 'block'; anchorRow: Row; headRow: Row }
  | null

function snapshotSelection(selection: Selection): SelectionSnapshot {
  if (selection.type === 'caret') {
    return {
      type: 'caret',
      row: selection.row,
      char: selection.detail.char,
      runAffinity: selection.detail.runAffinity,
      lineAffinity: selection.detail.lineAffinity
    }
  }

  if (selection.type === 'text') {
    return {
      type: 'text',
      row: selection.row,
      anchor: selection.detail.anchorChar,
      head: selection.detail.headChar
    }
  }

  if (selection.type === 'block') {
    return {
      type: 'block',
      anchorRow: selection.detail.anchorRow,
      headRow: selection.detail.headRow
    }
  }

  return null
}

function restoreSelection(editor: OutlineEditor, selection: SelectionSnapshot): void {
  if (!selection) return

  if (selection.type === 'caret') {
    editor.selectCaret(
      selection.row,
      selection.char,
      selection.runAffinity,
      selection.lineAffinity
    )
    return
  }

  if (selection.type === 'text') {
    editor.selectText(selection.row, selection.anchor, selection.head)
    return
  }

  if (selection.type === 'block') {
    editor.selectRows(selection.anchorRow, selection.headRow)
  }
}

export async function activate(context: AppExtensionContext) {
  console.log(`LLM Chat: Activated (instance ${INSTANCE_ID})`)
  canOpenURL = context.permissions.contains('openURL')
  cacheWarmRuntime = new CacheWarmRuntime({
    getSnapshot: (target) => buildCacheWarmSnapshot(target),
    executeWarmRequest: async (request) => {
      let latestUsage: CacheUsage | null | undefined = null
      const tokenGenerator = streamCompletion(request.messages, {
        model: request.model,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        provider: request.provider,
        reasoningEffort: request.reasoningEffort,
        onStatus: (status) => {
          latestUsage = status.usage ?? latestUsage
        }
      })
      for await (const _chunk of tokenGenerator) {
        // Warm requests intentionally discard output.
      }
      return latestUsage
    }
  })

  let outlineObserver: { dispose: () => void } | undefined

  const attachEditorObserver = (editor?: OutlineEditor) => {
    outlineObserver?.dispose()
    outlineObserver = undefined

    if (!editor) return

    const outline = editor.outline
    updateMarkerAttributes(outline.root)
    outlineObserver = outline.observeChanges((change) => {
      switch (change.type) {
        case 'rowChanged': {
          if (change.change.type === 'setAttribute') {
            if (change.change.name === MARKER_ATTRIBUTE) return
            return
          }

          if (
            change.change.type !== 'replacedText' &&
            change.change.type !== 'replacedTextAndSetType' &&
            change.change.type !== 'setType'
          ) {
            return
          }

          const row = outline.getRowById(change.rowId)
          if (row) {
            updateMarkerAttribute(row)
          }
          return
        }
        case 'siblingsInserted':
          for (const row of change.siblings) {
            updateMarkerAttribute(row)
          }
          return
        case 'siblingsMoved': {
          const seenRowIds = new Set<string>()
          for (const row of change.oldSiblings) {
            if (seenRowIds.has(row.id)) continue
            seenRowIds.add(row.id)
            updateMarkerAttribute(row)
          }
          for (const row of change.newSiblings) {
            if (seenRowIds.has(row.id)) continue
            seenRowIds.add(row.id)
            updateMarkerAttribute(row)
          }
          return
        }
        case 'reload':
          updateMarkerAttributes(change.newOutline.root)
          return
      }
    })
  }

  attachEditorObserver(bike.frontmostOutlineEditor)

  const editorObserver = bike.observeFrontmostOutlineEditor(attachEditorObserver)
  context['llm-chat-editor-observer'] = editorObserver
  context['llm-chat-outline-observer'] = {
    dispose: () => {
      outlineObserver?.dispose()
    }
  }
  context['llm-chat-cache-warm-runtime'] = {
    dispose: () => {
      cacheWarmRuntime?.dispose()
      cacheWarmRuntime = null
    }
  }

  bike.observeWindows(async (window) => {
    await registerStatusInspector(window)
  })

  // Register command
  bike.commands.addCommands({
    commands: {
      'llm-chat:send': sendMessageCommand,
      'llm-chat:insert-user': insertUserMarkerCommand
    }
  })

  // Register keybindings for both modes
  bike.keybindings.addKeybindings({
    keymap: 'text-mode',
    keybindings: {
      'cmd-shift-l': 'llm-chat:send',
      'cmd-u': 'llm-chat:insert-user'
    },
    priority: 100
  })

  bike.keybindings.addKeybindings({
    keymap: 'block-mode',
    keybindings: {
      'cmd-shift-l': 'llm-chat:send',
      'cmd-u': 'llm-chat:insert-user'
    },
    priority: 100
  })
}

function getEditorDocumentFileUrl(editor: OutlineEditor): string | null {
  const editorRootId = editor.outline.root.id
  for (const doc of bike.documents) {
    for (const window of doc.windows) {
      const windowEditor = window.currentOutlineEditor
      if (!windowEditor) continue
      if (windowEditor === editor || windowEditor.outline.root.id === editorRootId) {
        return doc.fileURL?.absoluteString ?? null
      }
    }
  }

  const frontmostDoc = bike.frontmostDocument
  const frontmostEditor = bike.frontmostOutlineEditor
  if (frontmostDoc && frontmostEditor) {
    if (frontmostEditor === editor || frontmostEditor.outline.root.id === editorRootId) {
      return frontmostDoc.fileURL?.absoluteString ?? null
    }
  }

  return null
}

function restoreFrontmostDocument(fileUrl: string | null): void {
  if (!fileUrl) return
  try {
    new URL(fileUrl).open({ activates: true, promptsUserIfNeeded: false })
  } catch (error) {
    console.warn(`LLM Chat: Failed to restore frontmost document ${fileUrl}`, error)
  }
}

function isInlineDocumentOpen(fileUrl: string): boolean {
  return Boolean(getOpenDocumentRoot(fileUrl))
}

function getOpenDocumentRoot(fileUrl: string): Row | null {
  for (const doc of bike.documents) {
    if (doc.fileURL?.absoluteString !== fileUrl) continue
    const window = doc.frontmostWindow ?? doc.windows[0]
    const editor = window?.currentOutlineEditor
    if (editor) {
      return editor.outline.root
    }
  }
  return null
}

function createInlineResolver(): InlineResolver {
  const byUrl = new Map<string, { root: Row; id: string }>()
  const byDisplayName = new Map<string, { root: Row; id: string }>()

  for (const doc of bike.documents) {
    const displayName = doc.displayName
    const fileURL = doc.fileURL?.absoluteString

    const window = doc.windows[0]
    const editor = window?.currentOutlineEditor
    if (!window || !editor) continue

    const root = editor.outline.root
    if (fileURL && !byUrl.has(fileURL)) {
      byUrl.set(fileURL, { root, id: fileURL })
    }

    const id = fileURL ?? displayName
    if (displayName && !byDisplayName.has(displayName)) {
      byDisplayName.set(displayName, { root, id })
    }
  }

  return {
    resolveByURL: (url: string) => byUrl.get(url) ?? null,
    resolveByDisplayName: (name: string) => byDisplayName.get(name) ?? null
  }
}

function getStopMarkerRow(row: Row): Row {
  let stopMarker = row
  while (stopMarker.level > 1 && stopMarker.parent) {
    stopMarker = stopMarker.parent
  }
  return stopMarker
}

function getConversationKey(
  editor: OutlineEditor,
  stopMarkerRow: Row,
  originDocumentFileUrl: string | null
): string {
  const documentKey = originDocumentFileUrl ?? `outline:${editor.outline.root.id}`
  return `${documentKey}::${stopMarkerRow.id}`
}

function resolveWarmRequestOptions(
  settings: {
    model?: string
    provider?: 'anthropic' | 'openai' | 'openrouter'
    temperature?: number
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  },
  config: ExtensionConfig
): WarmRequestOptions {
  return {
    model: settings.model ?? config.requestDefaults.model,
    provider: settings.provider,
    temperature: settings.temperature,
    reasoningEffort: settings.reasoningEffort
  }
}

function buildCacheWarmSnapshot(target: CacheWarmRuntimeTarget): CacheWarmRuntimeSnapshot | null {
  let config: ExtensionConfig
  try {
    config = getConfig()
  } catch {
    return null
  }

  const root = getCacheWarmRoot(target)
  if (!root) return null

  const stopRow = findRowById(root, target.stopMarkerRowId)
  if (!stopRow) return null

  let messages
  let settings
  try {
    messages = parseMessages(root, stopRow, {
      inlineResolver: createInlineResolver(),
      inlineBaseUrl: target.documentFileUrl
    })
    settings = parseConversationSettings(root, stopRow)
  } catch {
    return null
  }
  if (settings.errors.length > 0) {
    return null
  }
  if (messages.length === 0) {
    return null
  }

  messages = applyDefaultSystemMessage(messages, config.defaultSystemMessage)
  if (!messages.some(message => message.role === 'user')) {
    return null
  }

  const candidates = buildCacheWarmCandidates(
    messages,
    resolveWarmRequestOptions(settings, config)
  )
  if (candidates.length === 0) {
    return null
  }

  return { candidates }
}

function getCacheWarmRoot(target: CacheWarmRuntimeTarget): Row | null {
  if (target.documentFileUrl) {
    return getOpenDocumentRoot(target.documentFileUrl)
  }

  for (const doc of bike.documents) {
    for (const window of doc.windows) {
      const editor = window.currentOutlineEditor
      if (!editor) continue
      if (editor.outline.root.id === target.outlineRootId) {
        return editor.outline.root
      }
    }
  }

  return null
}

function findRowById(root: Row, rowId: string): Row | null {
  let row: Row | undefined = root.firstChild
  while (row) {
    if (row.id === rowId) return row
    row = row.nextInOutline
  }
  return null
}
