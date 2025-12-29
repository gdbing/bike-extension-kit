import { AppExtensionContext, CommandContext } from 'bike/app'
import { config } from './config'
import { parseMessages } from './message-parser'
import { HttpError, streamCompletion } from './providers/anthropic'
import { insertStaticResponse, streamResponseToOutline } from './response-inserter'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)

// Prevent concurrent requests
let isProcessing = false

const SHOW_ERRORS_IN_OUTLINE = config.ui.showErrorsInOutline

async function sendMessageCommand(context: CommandContext): Promise<boolean> {
  const editor = context.editor
  if (!editor) return false

  const selection = editor.selection
  if (!selection) return false

  const showInlineError = (message: string) => {
    if (!SHOW_ERRORS_IN_OUTLINE) return
    insertStaticResponse(editor.outline, selection.row, `Error: ${message}`)
  }

  // Prevent concurrent requests
  if (isProcessing) {
    console.log(`LLM Chat [${INSTANCE_ID}]: Already processing a request, please wait...`)
    return true
  }

  console.log(`LLM Chat [${INSTANCE_ID}]: Starting request`)

  isProcessing = true

  try {
    // Parse messages from document up to cursor
    const messages = parseMessages(editor.outline.root, selection.row)

    if (messages.length === 0) {
      console.log('LLM Chat: No messages found. Add <user> or <system> markers.')
      showInlineError('No messages found. Add <user> or <system> markers.')
      return true
    }

    // Check we have at least one user message
    const hasUserMessage = messages.some(m => m.role === 'user')
    if (!hasUserMessage) {
      console.log('LLM Chat: No <user> message found.')
      showInlineError('No <user> message found.')
      return true
    }

    // Stream completion from server
    const tokenGenerator = streamCompletion(messages)

    // Stream response into outline
    await streamResponseToOutline(editor.outline, selection.row, tokenGenerator)

    return true
  } catch (error) {
    console.error('LLM Chat error:', error)
    if (error instanceof HttpError) {
      showInlineError(error.message)
    } else if (error instanceof Error) {
      showInlineError(error.message)
    }
    return true
  } finally {
    isProcessing = false
  }
}

export async function activate(context: AppExtensionContext) {
  console.log(`LLM Chat: Activated (instance ${INSTANCE_ID})`)

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
