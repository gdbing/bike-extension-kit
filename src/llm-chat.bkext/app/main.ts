import { AppExtensionContext, CommandContext, OutlineEditor, Row, URL, Selection, Affinity } from 'bike/app'
import { getConfig } from './config'
import { collectInlineReferences, getLastRow, InlineResolver } from './inline-resolver'
import { hasUrlScheme, isFileUrl, resolveRelativeFileUrl } from './inline-path'
import { parseMessages } from './message-parser'
import { parseConversationSettings } from './settings-parser'
import { HttpError, streamCompletion } from './providers/anthropic'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'
import { updateMarkerAttributes } from './marker-attributes'
import { registerStatusInspector, resetStatus, updateCacheStatus } from './status-inspector'
import { applyDefaultSystemMessage } from './system-message'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)
let canOpenURL = false

function getResponseMarkerText(
  settings: ReturnType<typeof parseConversationSettings>,
  defaultModel?: string
): string {
  const rawName =
    settings.modelMarker ??
    settings.model ??
    defaultModel
  if (!rawName) return '<assistant>'

  const trimmed = rawName.trim()
  const match = trimmed.match(/^<([^>]+)>$/)
  const name = match ? match[1] : trimmed
  return `<${name}>`
}

async function sendMessageCommandAsync(context: CommandContext): Promise<void> {
  const editor = context.editor
  if (!editor) return

  const selection = editor.selection
  if (!selection) return

  let showErrorsInOutline = true
  const showInlineError = (message: string) => {
    if (!showErrorsInOutline) return
    insertStaticResponse(editor.outline, selection.row, `Error: ${message}`, '<error>')
  }

  console.log(`LLM Chat [${INSTANCE_ID}]: Starting request`)

  const statusWindow = bike.frontmostWindow
  const requestStartedAt = Date.now()

  resetStatus(statusWindow)

  try {
    const config = getConfig()
    showErrorsInOutline = config.ui.showErrorsInOutline
    updateMarkerAttributes(editor.outline.root)

    const originDocumentFileUrl =
      getEditorDocumentFileUrl(editor) ?? bike.frontmostDocument?.fileURL?.absoluteString ?? null
    await openInlineDocumentsIfNeeded(editor, selection.row, originDocumentFileUrl)

    // Parse messages from document up to cursor
    let messages = parseMessages(editor.outline.root, selection.row, {
      inlineResolver: createInlineResolver(),
      inlineBaseUrl: originDocumentFileUrl
    })
    const settings = parseConversationSettings(editor.outline.root, selection.row)

    if (settings.errors.length > 0) {
      const message = settings.errors.join('\n')
      console.log(`LLM Chat: ${message}`)
      showInlineError(message)
      return
    }

    if (messages.length === 0) {
      console.log('LLM Chat: No messages found. Add <user> or <system> markers.')
      showInlineError('No messages found. Add <user> or <system> markers.')
      return
    }

    messages = applyDefaultSystemMessage(messages, config.defaultSystemMessage)

    // Check we have at least one user message
    const hasUserMessage = messages.some(m => m.role === 'user')
    if (!hasUserMessage) {
      console.log('LLM Chat: No <user> message found.')
      showInlineError('No <user> message found.')
      return
    }

    // Stream completion from server
    const tokenGenerator = streamCompletion(messages, {
      model: settings.model,
      maxTokens: settings.maxTokens,
      temperature: settings.temperature,
      provider: settings.provider,
      reasoningEffort: settings.reasoningEffort,
      onStatus: (status) => {
        const usage = status.usage ?? {}
        const cacheReadTokens = Number(usage.cache_read_input_tokens ?? 0)
        const cacheWriteTokens = Number(usage.cache_creation_input_tokens ?? 0)
        if (cacheReadTokens > 0 || cacheWriteTokens > 0) {
          updateCacheStatus(statusWindow, {
            cacheReadTokens,
            cacheWriteTokens,
            ttlSeconds: 300,
            startedAt: requestStartedAt
          })
        }
      }
    })

    // Stream response into outline
    const markerText = getResponseMarkerText(settings, config.requestDefaults.model)
    await streamResponseToOutline(editor.outline, selection.row, tokenGenerator, markerText)

    return
  } catch (error) {
    console.error('LLM Chat error:', error)
    if (error instanceof HttpError) {
      showInlineError(error.message)
    } else if (error instanceof Error) {
      showInlineError(error.message)
    }
    return
  } finally {
    return
  }
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

async function openInlineDocumentsIfNeeded(
  editor: OutlineEditor,
  stopRow: Row,
  originDocumentFileUrl: string | null
): Promise<void> {
  if (!canOpenURL) return

  const documentFileUrl = originDocumentFileUrl ?? getEditorDocumentFileUrl(editor)
  const scanQueue: InlineScanTarget[] = [
    {
      root: editor.outline.root,
      stopRow,
      baseFileUrl: documentFileUrl
    }
  ]
  const processedDocs = new Set<string>()
  let didOpen = false

  while (scanQueue.length > 0) {
    const target = scanQueue.shift()
    if (!target) break

    const inlineFileUrls = collectInlineFileUrls(
      target.root,
      target.stopRow,
      target.baseFileUrl
    )
    if (inlineFileUrls.length === 0) {
      continue
    }

    const missingUrls = inlineFileUrls.filter((url) => !isInlineDocumentOpen(url))
    if (missingUrls.length > 0) {
      didOpen = true
      for (const url of missingUrls) {
        try {
          new URL(url).open({ activates: false, promptsUserIfNeeded: false })
        } catch (error) {
          console.warn(`LLM Chat: Failed to open inline URL ${url}`, error)
        }
      }
      await waitForInlineDocuments(missingUrls)
    }

    for (const url of inlineFileUrls) {
      if (processedDocs.has(url)) continue
      const root = getOpenDocumentRoot(url)
      if (!root) continue
      processedDocs.add(url)
      const lastRow = getLastRow(root) ?? root
      scanQueue.push({
        root,
        stopRow: lastRow,
        baseFileUrl: url
      })
    }
  }

  if (didOpen) {
    restoreFrontmostDocument(originDocumentFileUrl ?? documentFileUrl)
  }
}

type InlineScanTarget = {
  root: Row
  stopRow: Row
  baseFileUrl: string | null
}

function collectInlineFileUrls(root: Row, stopRow: Row, documentFileUrl: string | null): string[] {
  const stopMarker = getStopMarker(stopRow)
  const urls = new Set<string>()
  let row = root.firstChild

  while (row) {
    if (row.type !== 'note') {
      const text = row.text.string.trim().toLowerCase()
      const markerMatch = text.match(/^<([^>]+)>$/)
      if (markerMatch && markerMatch[1] === 'inline') {
        const references = collectInlineReferences(row)
        for (const reference of references) {
          const url = extractInlineFileUrl(reference)
          if (url) {
            urls.add(url)
            continue
          }
          if (!documentFileUrl) continue
          const relativeUrl = resolveInlineRelativeFileUrl(reference, documentFileUrl)
          if (relativeUrl) {
            urls.add(relativeUrl)
          }
        }
      }
    }

    if (row.id === stopMarker.id) {
      break
    }
    row = row.nextSibling
  }

  return Array.from(urls)
}

function extractInlineFileUrl(reference: { text?: string; link?: string }): string | null {
  const link = reference.link?.trim()
  if (link && isFileUrl(link)) return link

  const text = reference.text?.trim()
  if (text && isFileUrl(text)) return text

  return null
}

function resolveInlineRelativeFileUrl(
  reference: { text?: string; link?: string },
  baseFileUrl: string
): string | null {
  const candidate = (reference.link ?? reference.text)?.trim()
  if (!candidate) return null
  if (isFileUrl(candidate)) return candidate
  if (hasUrlScheme(candidate)) return null
  return resolveRelativeFileUrl(baseFileUrl, candidate)
}

function getStopMarker(stopRow: Row): Row {
  let stopMarker = stopRow
  while (stopMarker.level > 1 && stopMarker.parent) {
    stopMarker = stopMarker.parent
  }
  return stopMarker
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

async function waitForInlineDocuments(fileUrls: string[]): Promise<void> {
  const pending = new Set(fileUrls)
  const timeoutMs = 1500
  const intervalMs = 50
  const start = Date.now()

  while (pending.size > 0 && Date.now() - start < timeoutMs) {
    for (const url of Array.from(pending)) {
      if (isInlineDocumentOpen(url)) {
        pending.delete(url)
      }
    }

    if (pending.size === 0) return
    await delay(intervalMs)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
