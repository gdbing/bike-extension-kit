export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface StreamOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  provider?: string
}
