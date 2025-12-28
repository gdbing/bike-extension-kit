export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface StreamOptions {
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface LLMProvider {
  streamCompletion(
    messages: Message[],
    options: StreamOptions
  ): AsyncGenerator<string, void, unknown>
}
