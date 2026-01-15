import { AppExtensionContext, CommandContext, OutlineEditor, Row, URL, Selection, Affinity } from 'bike/app'
import { getConfig } from './config'
import type { InlineResolver } from './inline-resolver'
import { parseMessages } from './message-parser'
import { parseConversationSettings } from './settings-parser'
import { streamCompletion } from './providers/anthropic'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'
import { updateMarkerAttributes } from './marker-attributes'
import { registerStatusInspector, resetStatus, updateCacheStatus } from './status-inspector'
import { applyDefaultSystemMessage } from './system-message'
import { runChatCommand, getResponseMarkerText } from './chat-command'
import { openInlineDocumentsIfNeeded } from './inline-opener'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)
let canOpenURL = false

async function sendMessageCommandAsync(context: CommandContext): Promise<void> {
  const editor = context.editor
  if (!editor) return

  const selection = editor.selection
  if (!selection) return

  console.log(`LLM Chat [${INSTANCE_ID}]: Starting request`)

  const originDocumentFileUrl =
    getEditorDocumentFileUrl(editor) ?? bike.frontmostDocument?.fileURL?.absoluteString ?? null

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
    getResponseMarkerText
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

  let outlineObserver: { dispose: () => void } | undefined
  let outlineTextObserver: { dispose: () => void } | undefined

  const attachEditorObserver = (editor?: OutlineEditor) => {
    outlineObserver?.dispose()
    outlineObserver = undefined
    outlineTextObserver?.dispose()
    outlineTextObserver = undefined

    if (!editor) return

    updateMarkerAttributes(editor.outline.root)
    outlineObserver = editor.outline.streamQuery('/body', () => {
      updateMarkerAttributes(editor.outline.root)
    })
    outlineTextObserver = editor.outline.streamQuery('/body@text', () => {
      updateMarkerAttributes(editor.outline.root)
    })
  }

  attachEditorObserver(bike.frontmostOutlineEditor)

  const editorObserver = bike.observeFrontmostOutlineEditor(attachEditorObserver)
  context['llm-chat-editor-observer'] = editorObserver
  context['llm-chat-outline-observer'] = {
    dispose: () => {
      outlineObserver?.dispose()
      outlineTextObserver?.dispose()
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
