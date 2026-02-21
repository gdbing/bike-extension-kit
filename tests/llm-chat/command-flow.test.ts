import * as assert from 'node:assert/strict'
import { ChatCommandContext, ChatCommandDependencies, getResponseMarkerText, runChatCommand } from '../../src/llm-chat.bkext/app/chat-command'
import type { StreamOptions } from '../../src/llm-chat.bkext/app/providers/types'
import { buildOutline } from './outline-builder'
import { test } from './test-harness'

const DEFAULT_CONFIG = {
  server: {
    protocol: 'http',
    host: '127.0.0.1',
    port: 3033
  },
  pollingIntervalMs: 200,
  requestDefaults: {
    model: 'claude-haiku-4-5',
    maxTokens: 4096
  },
  models: [{ name: 'claude-haiku-4-5', provider: 'anthropic' }],
  ui: { showErrorsInOutline: true }
}

function makeContext(): ChatCommandContext {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Hello', key: 'cursor' }]
    }
  ])

  return {
    editor: { outline: { root } } as any,
    selection: { row: byKey['cursor'] } as any,
    originDocumentFileUrl: 'file:///main.bike',
    statusWindow: undefined,
    inlineResolver: undefined
  }
}

function makeDeps(overrides: Partial<ChatCommandDependencies> = {}): ChatCommandDependencies {
  return {
    getConfig: () => DEFAULT_CONFIG as any,
    updateMarkerAttributes: () => {},
    openInlineDocumentsIfNeeded: async () => {},
    parseMessages: () => [],
    parseConversationSettings: () => ({ errors: [] }),
    applyDefaultSystemMessage: (messages) => messages,
    streamCompletion: async function* () {
      yield ''
    },
    streamResponseToOutline: async () => {},
    insertStaticResponse: () => {},
    resetStatus: () => {},
    updateCacheStatus: () => {},
    getResponseMarkerText,
    ...overrides
  }
}

test('reports settings errors inline and skips streaming', async () => {
  const context = makeContext()
  let insertedText: string | null = null
  let insertedMarker: string | undefined
  let streamCalled = false

  const deps = makeDeps({
    parseMessages: () => [{ role: 'user', content: 'Hi\n' }],
    parseConversationSettings: () => ({ errors: ['Bad config'] }),
    insertStaticResponse: (_outline, _row, text, markerText) => {
      insertedText = text
      insertedMarker = markerText
    },
    streamCompletion: () => {
      streamCalled = true
      return (async function* () {
        yield ''
      })()
    },
    streamResponseToOutline: async () => {
      streamCalled = true
    }
  })

  await runChatCommand(context, deps)

  assert.equal(insertedText, 'Error: Bad config')
  assert.equal(insertedMarker, '<error>')
  assert.equal(streamCalled, false)
})

test('reports when no messages are found', async () => {
  const context = makeContext()
  let inserted: string | null = null

  const deps = makeDeps({
    parseMessages: () => [],
    parseConversationSettings: () => ({ errors: [] }),
    insertStaticResponse: (_outline, _row, text) => {
      inserted = text
    }
  })

  await runChatCommand(context, deps)

  assert.equal(inserted, 'Error: No messages found. Add <user> or <system> markers.')
})

test('reports when no user message exists', async () => {
  const context = makeContext()
  let inserted: string | null = null

  const deps = makeDeps({
    parseMessages: () => [{ role: 'assistant', content: 'Hi\n' }],
    parseConversationSettings: () => ({ errors: [] }),
    insertStaticResponse: (_outline, _row, text) => {
      inserted = text
    }
  })

  await runChatCommand(context, deps)

  assert.equal(inserted, 'Error: No <user> message found.')
})

test('streams responses with resolved marker text and default 5-minute cache status', async () => {
  const context = makeContext()
  let markerText: string | undefined
  let seenOptions: StreamOptions | undefined
  const cacheUpdates: Array<Record<string, unknown>> = []

  const deps = makeDeps({
    parseMessages: () => [{ role: 'user', content: 'Hi\n' }],
    parseConversationSettings: () => ({
      errors: [],
      modelMarker: 'sonnet',
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
      maxTokens: 512,
      temperature: 0.7,
      reasoningEffort: 'low'
    }),
    streamCompletion: (_messages, options = {}) => {
      seenOptions = options
      return (async function* () {
        if (options.onStatus) {
          options.onStatus({
            usage: { cache_read_input_tokens: 5, cache_creation_input_tokens: 0 }
          })
        }
        yield 'Done'
      })()
    },
    streamResponseToOutline: async (_outline, _row, tokens, marker) => {
      markerText = marker
      for await (const _chunk of tokens) {
        break
      }
    },
    updateCacheStatus: (_window, data) => {
      cacheUpdates.push(data as Record<string, unknown>)
    }
  })

  const realNow = Date.now
  Date.now = () => 1000
  try {
    await runChatCommand(context, deps)
  } finally {
    Date.now = realNow
  }

  assert.equal(markerText, '<sonnet>')
  assert.equal(seenOptions?.model, 'claude-sonnet-4-5')
  assert.equal(seenOptions?.maxTokens, 512)
  assert.equal(seenOptions?.temperature, 0.7)
  assert.equal(seenOptions?.provider, 'anthropic')
  assert.equal(seenOptions?.reasoningEffort, 'low')
  assert.deepEqual(cacheUpdates, [
    {
      cacheReadTokens: 5,
      cacheWriteTokens: 0,
      ttlSeconds: 300,
      startedAt: 1000
    }
  ])
})

test('invokes onSuccessfulStream with messages, settings, and usage', async () => {
  const context = makeContext()
  type SeenPayload = {
    messages: Array<{ role: string; content: string }>
    settings: Record<string, unknown>
    usage?: Record<string, unknown> | null
  }
  let seen: SeenPayload | null = null

  const deps = makeDeps({
    parseMessages: () => [{ role: 'user', content: 'Hi\n' }],
    parseConversationSettings: () => ({
      errors: [],
      model: 'claude-haiku-4-5',
      provider: 'anthropic'
    }),
    streamCompletion: (_messages, options = {}) => {
      return (async function* () {
        options.onStatus?.({
          usage: { cache_read_input_tokens: 12, cache_creation_input_tokens: 4 }
        })
        yield 'Done'
      })()
    },
    streamResponseToOutline: async (_outline, _row, tokens) => {
      for await (const _chunk of tokens) {
        break
      }
    },
    onSuccessfulStream: (data) => {
      seen = {
        messages: data.messages as Array<{ role: string; content: string }>,
        settings: data.settings as unknown as Record<string, unknown>,
        usage: data.usage as Record<string, unknown> | null | undefined
      }
    }
  })

  await runChatCommand(context, deps)

  assert.ok(seen)
  const observed = seen as SeenPayload
  assert.deepEqual(observed.messages, [{ role: 'user', content: 'Hi\n' }])
  assert.equal(observed.settings.model, 'claude-haiku-4-5')
  assert.equal(observed.settings.provider, 'anthropic')
  assert.equal(observed.usage?.cache_read_input_tokens, 12)
  assert.equal(observed.usage?.cache_creation_input_tokens, 4)
})
