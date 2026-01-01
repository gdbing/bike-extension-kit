export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  cacheControl?: {
    type: 'ephemeral'
    ttl?: '1h'
  }
}

export interface CacheUsage {
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  input_tokens?: number
  output_tokens?: number
  [key: string]: unknown
}

export interface StreamStatus {
  usage?: CacheUsage | null
}

export interface StreamOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  provider?: string
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  onStatus?: (status: StreamStatus) => void
}
