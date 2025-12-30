import { AppExtensionContext, CommandContext, OutlineEditor } from 'bike/app'
import { getConfig } from './config'
import { parseMessages } from './message-parser'
import { parseConversationSettings } from './settings-parser'
import { HttpError, streamCompletion } from './providers/anthropic'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'
import { updateMarkerAttributes } from './marker-attributes'

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

  try {
    const config = getConfig()
    showErrorsInOutline = config.ui.showErrorsInOutline
    updateMarkerAttributes(editor.outline.root)

    // Parse messages from document up to cursor
    const messages = parseMessages(editor.outline.root, selection.row)
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
      reasoningEffort: settings.reasoningEffort
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

  const attachEditorObserver = (editor?: OutlineEditor) => {
    outlineObserver?.dispose()
    outlineObserver = undefined

    if (!editor) return

    updateMarkerAttributes(editor.outline.root)
    outlineObserver = editor.outline.streamQuery('/body@text', () => {
      updateMarkerAttributes(editor.outline.root)
    })
  }

  attachEditorObserver(bike.frontmostOutlineEditor)

  const editorObserver = bike.observeFrontmostOutlineEditor(attachEditorObserver)
  context['llm-chat-editor-observer'] = editorObserver
  context['llm-chat-outline-observer'] = {
    dispose: () => outlineObserver?.dispose()
  }

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
