import { AppExtensionContext, CommandContext, OutlineEditor, Row } from 'bike/app'
import { getConfig } from './config'
import { InlineResolver } from './inline-resolver'
import { parseMessages } from './message-parser'
import { parseConversationSettings } from './settings-parser'
import { HttpError, streamCompletion } from './providers/anthropic'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'
import { updateMarkerAttributes } from './marker-attributes'
import { registerStatusInspector, resetStatus, updateCacheStatus } from './status-inspector'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)

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

    // Parse messages from document up to cursor
    const messages = parseMessages(editor.outline.root, selection.row, {
      inlineResolver: createInlineResolver()
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

export async function activate(context: AppExtensionContext) {
  console.log(`LLM Chat: Activated (instance ${INSTANCE_ID})`)

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
      'llm-chat:send': sendMessageCommand
    }
  })

  // Register keybindings for both modes
  bike.keybindings.addKeybindings({
    keymap: 'text-mode',
    keybindings: {
      'cmd-shift-l': 'llm-chat:send'
    },
    priority: 100
  })

  bike.keybindings.addKeybindings({
    keymap: 'block-mode',
    keybindings: {
      'cmd-shift-l': 'llm-chat:send'
    },
    priority: 100
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
