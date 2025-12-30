declare function require(path: string): any

export interface ModelDefinition {
  name: string
  provider: string
}

export interface ExtensionConfig {
  server: {
    protocol: 'http' | 'https'
    host: string
    port: number
    basePath: string
  }
  pollingIntervalMs: number
  requestDefaults: {
    model: string
    maxTokens: number
  }
  models: ModelDefinition[]
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

type PartialConfig = Partial<ExtensionConfig> & {
  server?: Partial<ExtensionConfig['server']>
  requestDefaults?: Partial<ExtensionConfig['requestDefaults']>
  models?: ModelDefinition[]
  ui?: Partial<ExtensionConfig['ui']>
}

const rawConfig = require('../config.json') as PartialConfig

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function assertConfig(value: PartialConfig): asserts value is ExtensionConfig {
  const errors: string[] = []

  if (!value.server || typeof value.server !== 'object') {
    errors.push('Missing server configuration')
  } else {
    if (!isNonEmptyString(value.server.host)) {
      errors.push('server.host must be a non-empty string')
    }
    if (!isNonEmptyString(value.server.protocol)) {
      errors.push('server.protocol must be a non-empty string')
    } else if (value.server.protocol !== 'http' && value.server.protocol !== 'https') {
      errors.push('server.protocol must be http or https')
    }
    if (!isNumber(value.server.port)) {
      errors.push('server.port must be a number')
    }
    if (typeof value.server.basePath !== 'string') {
      errors.push('server.basePath must be a string (can be empty)')
    }
  }

  if (!isNumber(value.pollingIntervalMs)) {
    errors.push('pollingIntervalMs must be a number')
  }

  if (!value.requestDefaults || typeof value.requestDefaults !== 'object') {
    errors.push('Missing requestDefaults configuration')
  } else {
    if (!isNonEmptyString(value.requestDefaults.model)) {
      errors.push('requestDefaults.model must be a non-empty string')
    }
    if (!isNumber(value.requestDefaults.maxTokens)) {
      errors.push('requestDefaults.maxTokens must be a number')
    }
  }

  if (!Array.isArray(value.models) || value.models.length === 0) {
    errors.push('models must be a non-empty array')
  } else {
    value.models.forEach((model, index) => {
      if (!isNonEmptyString(model?.name)) {
        errors.push(`models[${index}].name must be a non-empty string`)
      }
      if (!isNonEmptyString(model?.provider)) {
        errors.push(`models[${index}].provider must be a non-empty string`)
      }
    })
  }

  if (!value.ui || typeof value.ui !== 'object') {
    errors.push('Missing ui configuration')
  } else if (typeof value.ui.showErrorsInOutline !== 'boolean') {
    errors.push('ui.showErrorsInOutline must be a boolean')
  }

  if (errors.length > 0) {
    throw new Error(`Invalid llm-chat config.json:\n- ${errors.join('\n- ')}`)
  }
}

assertConfig(rawConfig)

export const config: ExtensionConfig = rawConfig

export function getServerBaseUrl(): string {
  const { protocol, host, port, basePath } = config.server
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
