import { LLMProvider, Message, StreamOptions } from './types'

const PROXY_URL = 'http://127.0.0.1:3033'
const POLL_INTERVAL_MS = 50

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isProxyRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${PROXY_URL}/health`)
    return response.ok
  } catch {
    return false
  }
}

export class AnthropicProvider implements LLMProvider {
  async *streamCompletion(
    messages: Message[],
    options: StreamOptions
  ): AsyncGenerator<string, void, unknown> {
    // Check if proxy is available for streaming
    const proxyAvailable = await isProxyRunning()

    if (proxyAvailable) {
      // Use streaming proxy
      yield* this.streamViaProxy(messages, options)
    } else {
      // Fall back to direct non-streaming call
      console.log('LLM Chat: Proxy not running, using non-streaming mode')
      console.log('LLM Chat: Run `python3 proxy/server.py` for streaming')
      yield* this.fetchDirect(messages, options)
    }
  }

  private async *streamViaProxy(
    messages: Message[],
    options: StreamOptions
  ): AsyncGenerator<string, void, unknown> {
    // Start chat session
    const startResponse = await fetch(`${PROXY_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        apiKey: options.apiKey,
        model: options.model || 'claude-3-5-haiku-20241022',
        maxTokens: options.maxTokens || 4096
      })
    })

    if (!startResponse.ok) {
      const error = await startResponse.json()
      throw new Error(error.error || 'Failed to start chat session')
    }

    const { sessionId } = await startResponse.json()

    // Poll for chunks
    while (true) {
      await sleep(POLL_INTERVAL_MS)

      const pollResponse = await fetch(`${PROXY_URL}/chunks/${sessionId}`)
      if (!pollResponse.ok) {
        throw new Error('Failed to poll for chunks')
      }

      const { chunks, done, error } = await pollResponse.json()

      if (error) {
        throw new Error(error)
      }

      // Yield all new chunks
      for (const chunk of chunks) {
        yield chunk
      }

      if (done) {
        break
      }
    }
  }

  private async *fetchDirect(
    messages: Message[],
    options: StreamOptions
  ): AsyncGenerator<string, void, unknown> {
    // Separate system messages from conversation
    const systemMessages = messages.filter(m => m.role === 'system')
    const conversationMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.trim()
      }))

    const systemPrompt = systemMessages.map(m => m.content.trim()).join('\n\n')

    const body: Record<string, unknown> = {
      model: options.model || 'claude-3-5-haiku-20241022',
      messages: conversationMessages,
      stream: false,
      max_tokens: options.maxTokens || 4096
    }

    if (systemPrompt) {
      body.system = systemPrompt
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': options.apiKey
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`)
    }

    const result = await response.json()

    if (result.error) {
      throw new Error(result.error.message || 'API error')
    }

    // Extract text from response
    const text = result.content?.[0]?.text || ''
    if (text) {
      yield text
    }
  }
}
