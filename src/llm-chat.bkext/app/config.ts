import configJson from '../config.json'

export interface ExtensionConfig {
  server: {
    protocol?: 'http' | 'https'
    host: string
    port?: number
    basePath?: string
  }
  pollingIntervalMs: number
  requestDefaults: {
    model?: string
    maxTokens?: number
  }
  ui: {
    showErrorsInOutline: boolean
    markerColors?: {
      user?: string
      system?: string
      assistant?: string
      error?: string
      default?: string
    }
  }
}

const defaultConfig: ExtensionConfig = {
  server: {
    protocol: 'http',
    host: '127.0.0.1',
    port: 3033,
    basePath: ''
  },
  pollingIntervalMs: 200,
  requestDefaults: {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 4096
  },
  ui: {
    showErrorsInOutline: true,
    markerColors: {
      user: '#2F6FDB',
      system: '#B25E00',
      assistant: '#18794E',
      error: '#C41C1C',
      default: '#6B7280'
    }
  }
}

type PartialConfig = Partial<ExtensionConfig> & {
  server?: Partial<ExtensionConfig['server']>
  requestDefaults?: Partial<ExtensionConfig['requestDefaults']>
  ui?: Partial<ExtensionConfig['ui']>
}

const rawConfig = configJson as PartialConfig

// Merge defaults with the JSON file while keeping types safe
export const config: ExtensionConfig = {
  server: {
    ...defaultConfig.server,
    ...rawConfig.server
  },
  pollingIntervalMs: rawConfig.pollingIntervalMs ?? defaultConfig.pollingIntervalMs,
  requestDefaults: {
    ...defaultConfig.requestDefaults,
    ...rawConfig.requestDefaults
  },
  ui: {
    ...defaultConfig.ui,
    ...rawConfig.ui
  }
}

export function getServerBaseUrl(): string {
  const { protocol = 'http', host, port, basePath = '' } = config.server
  const trimmedBasePath = basePath.replace(/\/+$/, '')
  const normalizedBasePath = trimmedBasePath
    ? trimmedBasePath.startsWith('/')
      ? trimmedBasePath
      : `/${trimmedBasePath}`
    : ''
  const portSegment = port ? `:${port}` : ''
  return `${protocol}://${host}${portSegment}${normalizedBasePath}`
}

export function getChatEndpoint(): string {
  const base = getServerBaseUrl()
  return `${base}/chat`
}

export function getChunksEndpoint(sessionId: string): string {
  const base = getServerBaseUrl()
  return `${base}/chunks/${sessionId}`
}

export function getHealthEndpoint(): string {
  const base = getServerBaseUrl()
  return `${base}/health`
}