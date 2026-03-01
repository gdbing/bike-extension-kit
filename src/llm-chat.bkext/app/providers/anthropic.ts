import { getChatEndpoint, getChunksEndpoint, getConfig, getHealthEndpoint } from '../config'
import { Message, StreamOptions } from './types'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(getHealthEndpoint())
    return response.ok
  } catch {
    return false
  }
}

async function buildHttpError(response: Response): Promise<HttpError> {
  let detail: string | null = null

  try {
    const text = await response.text()
    if (text) {
      try {
        const parsed = JSON.parse(text)
        detail = typeof parsed === 'string' ? parsed : parsed.error ?? JSON.stringify(parsed)
      } catch {
        detail = text
      }
    }
  } catch {
    detail = null
  }

  const statusTextValue = (response as { statusText?: unknown }).statusText
  const statusText = typeof statusTextValue === 'string' ? statusTextValue : ''
  const baseMessage = statusText
    ? `HTTP ${response.status} ${statusText}`
    : `HTTP ${response.status}`
  const message = detail ? `${baseMessage}: ${detail}` : baseMessage
  return new HttpError(response.status, statusText, message)
}

export async function* streamCompletion(
  messages: Message[],
  options: StreamOptions = {}
): AsyncGenerator<string, void, unknown> {
  const config = getConfig()
  const pollIntervalMs = config.pollingIntervalMs
  const serverAvailable = await isServerRunning()

  if (!serverAvailable) {
    throw new Error(
      `LLM Chat server not running at ${getServerBaseUrlDescription()}.\n` +
      'Install/start the background agent (recommended):\n' +
      '  src/llm-chat.bkext/proxy/install-launch-agent.sh\n' +
      'Check status:\n' +
      '  src/llm-chat.bkext/proxy/status-launch-agent.sh\n' +
      'Or run manually:\n' +
      '  cd src/llm-chat.bkext/proxy && python3 server.py'
    )
  }

  const model = options.model ?? config.requestDefaults.model
  const maxTokens = options.maxTokens ?? config.requestDefaults.maxTokens
  const temperature = options.temperature
  const provider = options.provider
  const reasoningEffort = options.reasoningEffort
  const onStatus = options.onStatus

  // Start chat session
  const startPayload: Record<string, unknown> = {
    messages
  }

  if (model) {
    startPayload.model = model
  }

  if (typeof maxTokens === 'number') {
    startPayload.maxTokens = maxTokens
  }

  if (typeof temperature === 'number') {
    startPayload.temperature = temperature
  }

  if (provider) {
    startPayload.provider = provider
  }

  if (reasoningEffort) {
    startPayload.reasoningEffort = reasoningEffort
  }

  const startResponse = await fetch(getChatEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(startPayload)
  })

  if (!startResponse.ok) {
    throw await buildHttpError(startResponse)
  }

  const { sessionId } = await startResponse.json()

  // Poll for chunks
  while (true) {
    await sleep(pollIntervalMs)

    const pollResponse = await fetch(getChunksEndpoint(sessionId))
    if (!pollResponse.ok) {
      throw await buildHttpError(pollResponse)
    }

    const { chunks, done, error, usage } = await pollResponse.json()

    if (error) {
      throw new Error(error)
    }
    if (usage && onStatus) {
      onStatus({ usage })
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

function getServerBaseUrlDescription(): string {
  const { protocol, host, port } = getConfig().server
  const portSegment = port ? `:${port}` : ''
  return `${protocol}://${host}${portSegment}`
}
