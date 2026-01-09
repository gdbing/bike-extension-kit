import type { Outline, OutlineEditor, Row, Selection } from 'bike/app'
import type { ExtensionConfig } from './config'
import type { InlineResolver } from './inline-resolver'
import type { Message, StreamOptions } from './providers/types'
import type { ConversationSettings } from './settings-parser'
import { HttpError } from './providers/anthropic'

type ParseMessagesOptions = {
  inlineResolver?: InlineResolver
  inlineBaseUrl?: string | null
}

export type ChatCommandContext = {
  editor: OutlineEditor
  selection: Selection
  originDocumentFileUrl: string | null
  statusWindow?: unknown
  inlineResolver?: InlineResolver
}

export type ChatCommandDependencies = {
  getConfig: () => ExtensionConfig
  updateMarkerAttributes: (root: Row) => void
  openInlineDocumentsIfNeeded: (
    editor: OutlineEditor,
    stopRow: Row,
    originDocumentFileUrl: string | null
  ) => Promise<void>
  parseMessages: (root: Row, stopRow: Row, options: ParseMessagesOptions) => Message[]
  parseConversationSettings: (root: Row, stopRow: Row) => ConversationSettings
  applyDefaultSystemMessage: (messages: Message[], defaultSystemMessage?: string) => Message[]
  streamCompletion: (messages: Message[], options?: StreamOptions) => AsyncGenerator<string, void, unknown>
  streamResponseToOutline: (
    outline: Outline,
    afterRow: Row,
    tokenGenerator: AsyncGenerator<string, void, unknown>,
    markerText?: string
  ) => Promise<void>
  insertStaticResponse: (outline: Outline, afterRow: Row, text: string, markerText?: string) => void
  resetStatus: (window?: unknown) => void
  updateCacheStatus: (
    window: unknown | undefined,
    data: {
      cacheReadTokens: number
      cacheWriteTokens: number
      ttlSeconds: number
      startedAt: number
    }
  ) => void
  getResponseMarkerText: (settings: ConversationSettings, defaultModel?: string) => string
}

export function getResponseMarkerText(
  settings: ConversationSettings,
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

export async function runChatCommand(
  context: ChatCommandContext,
  deps: ChatCommandDependencies
): Promise<void> {
  const { editor, selection, originDocumentFileUrl, statusWindow, inlineResolver } = context

  let showErrorsInOutline = true
  const showInlineError = (message: string) => {
    if (!showErrorsInOutline) return
    deps.insertStaticResponse(editor.outline, selection.row, `Error: ${message}`, '<error>')
  }

  const requestStartedAt = Date.now()
  deps.resetStatus(statusWindow)

  try {
    const config = deps.getConfig()
    showErrorsInOutline = config.ui.showErrorsInOutline
    deps.updateMarkerAttributes(editor.outline.root)

    await deps.openInlineDocumentsIfNeeded(editor, selection.row, originDocumentFileUrl)

    let messages = deps.parseMessages(editor.outline.root, selection.row, {
      inlineResolver,
      inlineBaseUrl: originDocumentFileUrl
    })
    const settings = deps.parseConversationSettings(editor.outline.root, selection.row)

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

    messages = deps.applyDefaultSystemMessage(messages, config.defaultSystemMessage)

    const hasUserMessage = messages.some(m => m.role === 'user')
    if (!hasUserMessage) {
      console.log('LLM Chat: No <user> message found.')
      showInlineError('No <user> message found.')
      return
    }

    const tokenGenerator = deps.streamCompletion(messages, {
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
          deps.updateCacheStatus(statusWindow, {
            cacheReadTokens,
            cacheWriteTokens,
            ttlSeconds: 300,
            startedAt: requestStartedAt
          })
        }
      }
    })

    const markerText = deps.getResponseMarkerText(settings, config.requestDefaults.model)
    await deps.streamResponseToOutline(editor.outline, selection.row, tokenGenerator, markerText)
  } catch (error) {
    console.error('LLM Chat error:', error)
    if (error instanceof HttpError) {
      showInlineError(error.message)
    } else if (error instanceof Error) {
      showInlineError(error.message)
    }
  }
}
