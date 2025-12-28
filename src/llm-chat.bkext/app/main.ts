import { AppExtensionContext, CommandContext } from 'bike/app'
import { parseMessages } from './message-parser'
import { AnthropicProvider } from './providers/anthropic'
import { streamResponseToOutline } from './response-inserter'

// Unique instance ID for debugging
const INSTANCE_ID = Math.random().toString(36).slice(2, 8)

// Cache API key in memory for session
let cachedAPIKey: string | null = null

// Prevent concurrent requests
let isProcessing = false

async function getAPIKey(): Promise<string | null> {
  if (cachedAPIKey) return cachedAPIKey

  // For MVP: use environment variable or prompt
  // Check if there's a key in the frontmost outline's metadata
  const editor = bike.frontmostOutlineEditor
  if (editor) {
    const storedKey = editor.outline.persistentMetadata.get('anthropic-api-key') as string | undefined
    if (storedKey) {
      cachedAPIKey = storedKey
      return storedKey
    }
  }

  // Prompt for key using basic prompt (if available)
  // For now, check console for instructions
  console.log('LLM Chat: No API key found. Set one with:')
  console.log('  outline.persistentMetadata.set("anthropic-api-key", "sk-ant-...")')

  return null
}

async function sendMessageCommand(context: CommandContext): Promise<boolean> {
  const editor = context.editor
  if (!editor) return false

  const selection = editor.selection
  if (!selection) return false

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
      return true
    }

    // Check we have at least one user message
    const hasUserMessage = messages.some(m => m.role === 'user')
    if (!hasUserMessage) {
      console.log('LLM Chat: No <user> message found.')
      return true
    }

    // Get API key
    const apiKey = await getAPIKey()
    if (!apiKey) {
      console.log('LLM Chat: API key required.')
      return true
    }

    // Create provider and stream
    const provider = new AnthropicProvider()
    const tokenGenerator = provider.streamCompletion(messages, {
      apiKey,
      model: 'claude-3-5-haiku-20241022',
      maxTokens: 4096
    })

    // Stream response into outline
    await streamResponseToOutline(editor.outline, selection.row, tokenGenerator)

    return true
  } catch (error) {
    console.error('LLM Chat error:', error)
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
      'cmd-shift-Return': 'llm-chat:send'
    },
    priority: 100
  })

  bike.keybindings.addKeybindings({
    keymap: 'block-mode',
    keybindings: {
      'cmd-shift-Return': 'llm-chat:send'
    },
    priority: 100
  })
}
