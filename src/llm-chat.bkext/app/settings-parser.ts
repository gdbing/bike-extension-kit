import type { Row } from 'bike/app'
import { config } from './config'

export interface ConversationSettings {
  model?: string
  modelMarker?: string
  provider?: string
  maxTokens?: number
  temperature?: number
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  errors: string[]
}

const MODEL_DEFINITIONS = config.models
const ALLOWED_PROVIDERS = new Set(MODEL_DEFINITIONS.map(model => model.provider))
const ALLOWED_CONFIG_KEYS = new Set(['model', 'provider', 'maxTokens', 'temperature', 'reasoningEffort'])
const ALLOWED_REASONING_EFFORT = new Set(['none', 'low', 'medium', 'high'])

export function parseConversationSettings(root: Row, stopRow: Row): ConversationSettings {
  const settings: ConversationSettings = { errors: [] }

  // Walk stopRow up to the level-1 marker that contains it so we stop after that block
  let stopMarker: Row = stopRow
  while (stopMarker.level > 1 && stopMarker.parent) {
    stopMarker = stopMarker.parent
  }

  let reachedStopMarker = false
  let row: Row | undefined = root.firstChild

  while (row) {
    // Skip note rows and descendants
    if (row.type === 'note') {
      if (isSameRow(row, stopMarker) || isDescendant(stopMarker, row)) {
        break
      }
      row = nextRowAfterSubtree(row)
      continue
    }

    // Only consider root-level markers
    if (row.level === 1) {
      if (reachedStopMarker) break
      if (isSameRow(row, stopMarker)) reachedStopMarker = true

      const markerMatch = row.text.string.trim().toLowerCase().match(/^<([^>]+)>$/)
      if (markerMatch) {
        const markerName = markerMatch[1]
        if (markerName === 'model') {
          const modelValue = readFirstContentLine(row)
          if (!modelValue) {
            settings.errors.push('Empty <model> marker')
          } else {
            settings.modelMarker = modelValue
          }
          row = nextRowAfterSubtree(row)
          continue
        }

        if (markerName === 'config') {
          const configResult = parseConfigBlock(row)
          settings.errors.push(...configResult.errors)
          if (configResult.values.model) {
            settings.model = configResult.values.model
            settings.modelMarker = undefined
          }
          if (configResult.values.provider) {
            settings.provider = configResult.values.provider
          }
          if (typeof configResult.values.maxTokens === 'number') {
            settings.maxTokens = configResult.values.maxTokens
          }
          if (typeof configResult.values.temperature === 'number') {
            settings.temperature = configResult.values.temperature
          }
          if (configResult.values.reasoningEffort) {
            settings.reasoningEffort = configResult.values.reasoningEffort
          }
          row = nextRowAfterSubtree(row)
          continue
        }
      }
    }

    row = row.nextInOutline
  }

  if (!settings.model && settings.modelMarker) {
    const resolved = resolveModel(settings.modelMarker, settings.provider)
    if (resolved.error) {
      settings.errors.push(resolved.error)
    } else if (resolved.model) {
      settings.model = resolved.model
      if (resolved.provider) {
        settings.provider = resolved.provider
      }
    }
  }

  return settings
}

function parseConfigBlock(markerRow: Row): {
  values: Partial<Omit<ConversationSettings, 'errors'>>
  errors: string[]
} {
  const values: Partial<Omit<ConversationSettings, 'errors'>> = {}
  const errors: string[] = []

  let row: Row | undefined = markerRow.nextInOutline
  while (row && isDescendant(row, markerRow)) {
    if (row.type === 'note') {
      row = nextRowAfterSubtree(row)
      continue
    }

    const line = row.text.string.trim()
    if (line) {
      const [keyRaw, ...rest] = line.split(':')
      if (!keyRaw || rest.length === 0) {
        errors.push(`Invalid config line: "${line}"`)
      } else {
        const key = keyRaw.trim()
        const valueRaw = rest.join(':').trim()
        if (!ALLOWED_CONFIG_KEYS.has(key)) {
          errors.push(`Unknown config key: ${key}`)
        } else {
          applyConfig(values, key, valueRaw, errors)
        }
      }
    }

    row = row.nextInOutline
  }

  return { values, errors }
}

function applyConfig(
  values: Partial<Omit<ConversationSettings, 'errors'>>,
  key: string,
  rawValue: string,
  errors: string[]
): void {
  if (key === 'model') {
    if (!rawValue) {
      errors.push('Config model must not be empty')
    } else {
      values.model = stripQuotes(rawValue)
    }
    return
  }

  if (key === 'provider') {
    const provider = rawValue.toLowerCase()
    if (!ALLOWED_PROVIDERS.has(provider)) {
      errors.push(`Unknown provider: ${rawValue}`)
    } else {
      values.provider = provider
    }
    return
  }

  if (key === 'maxTokens') {
    const num = Number(rawValue)
    if (!Number.isFinite(num) || num <= 0) {
      errors.push(`maxTokens must be a positive number: ${rawValue}`)
    } else {
      values.maxTokens = Math.floor(num)
    }
    return
  }

  if (key === 'temperature') {
    const num = Number(rawValue)
    if (!Number.isFinite(num) || num < 0 || num > 2) {
      errors.push(`temperature must be between 0 and 2: ${rawValue}`)
    } else {
      values.temperature = num
    }
    return
  }

  if (key === 'reasoningEffort') {
    const effort = rawValue.toLowerCase()
    if (!ALLOWED_REASONING_EFFORT.has(effort)) {
      errors.push(`reasoningEffort must be one of none, low, medium, high: ${rawValue}`)
    } else {
      values.reasoningEffort = effort as ConversationSettings['reasoningEffort']
    }
    return
  }
}

function resolveModel(
  input: string,
  provider?: string
): { model?: string; provider?: string; error?: string } {
  const candidate = input.trim().toLowerCase()
  if (!candidate) {
    return { error: 'Empty <model> marker' }
  }

  const availableModels = provider
    ? MODEL_DEFINITIONS.filter(model => model.provider === provider)
    : MODEL_DEFINITIONS

  const exactMatch = availableModels.find(model => model.name.toLowerCase() === candidate)
  if (exactMatch) {
    return { model: exactMatch.name, provider: exactMatch.provider }
  }

  const substringMatch = availableModels.find(model =>
    model.name.toLowerCase().includes(candidate)
  )
  if (substringMatch) {
    return { model: substringMatch.name, provider: substringMatch.provider }
  }

  // Fuzzy token-in-order match: all tokens (len > 1) must appear in order
  const tokens = candidate
    .split(/[^a-z0-9]+/)
    .filter(token => token && (token.length > 1 || /^\d+$/.test(token)))
  if (tokens.length) {
    const fuzzyMatch = availableModels.find(model => {
      let start = 0
      const lowerModel = model.name.toLowerCase()
      for (const token of tokens) {
        const index = lowerModel.indexOf(token, start)
        if (index === -1) return false
        start = index + token.length
      }
      return true
    })

    if (fuzzyMatch) {
      return { model: fuzzyMatch.name, provider: fuzzyMatch.provider }
    }
  }

  return { error: `Unknown model "${input}"` }
}

function readFirstContentLine(markerRow: Row): string | null {
  let row: Row | undefined = markerRow.nextInOutline
  while (row && isDescendant(row, markerRow)) {
    if (row.type === 'note') {
      row = nextRowAfterSubtree(row)
      continue
    }
    const text = row.text.string.trim()
    if (text) return text
    row = row.nextInOutline
  }
  return null
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isSameRow(a: Row, b: Row): boolean {
  return a.id === b.id
}

function isDescendant(row: Row, ancestor: Row): boolean {
  const ancestorId = ancestor.id
  let parent = row.parent
  while (parent) {
    if (parent.id === ancestorId) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function nextRowAfterSubtree(row: Row): Row | undefined {
  let current: Row | undefined = row
  while (current) {
    if (current.nextSibling) {
      return current.nextSibling
    }
    current = current.parent
  }
  return undefined
}
