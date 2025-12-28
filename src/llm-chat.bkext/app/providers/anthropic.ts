import { Message, StreamOptions } from './types'

const SERVER_URL = 'http://127.0.0.1:3033'
const POLL_INTERVAL_MS = 50

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`)
    return response.ok
  } catch {
    return false
  }
}

export async function* streamCompletion(
  messages: Message[],
  options: StreamOptions = {}
): AsyncGenerator<string, void, unknown> {
  const serverAvailable = await isServerRunning()

  if (!serverAvailable) {
    throw new Error(
      'LLM Chat server not running. Start it with:\n' +
      '  cd src/llm-chat.bkext/proxy && python3 server.py'
    )
  }

  // Start chat session
  const startResponse = await fetch(`${SERVER_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      model: options.model,
      maxTokens: options.maxTokens
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

    const pollResponse = await fetch(`${SERVER_URL}/chunks/${sessionId}`)
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
