import * as assert from 'node:assert/strict'
import { ModelDefinition } from '../../src/llm-chat.bkext/app/config'
import { parseConversationSettings } from '../../src/llm-chat.bkext/app/settings-parser'
import { buildOutline } from './outline-builder'
import { test } from './test-harness'

const MODEL_DEFINITIONS: ModelDefinition[] = [
  { name: 'claude-haiku-4-5', provider: 'anthropic' },
  { name: 'claude-sonnet-4-5', provider: 'anthropic' },
  { name: 'claude-opus-4-5', provider: 'anthropic' },
  { name: 'gpt-5.2', provider: 'openai' },
  { name: 'gpt-5-mini', provider: 'openai' }
]


test('resolves <model> against configured models and sets provider', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'sonnet 4.5', key: 'model-value' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'claude-sonnet-4-5')
  assert.equal(result.modelMarker, 'sonnet 4.5')
  assert.equal(result.provider, 'anthropic')
  assert.deepEqual(result.errors, [])
})

test('resolves <model> using config defaults when no model list is provided', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'sonnet 4.5', key: 'model-value' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any)

  assert.equal(result.model, 'claude-sonnet-4-5')
  assert.equal(result.provider, 'anthropic')
  assert.deepEqual(result.errors, [])
})

test('config overrides model and adds other params with latest precedence', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'haiku', key: 'model-value' }]
    },
    {
      text: '<config>',
      key: 'config',
      children: [
        { text: 'model: "custom-model"', key: 'conf-model' },
        { text: 'maxTokens: 512', key: 'conf-max' },
        { text: 'temperature: 1.2', key: 'conf-temp' }
      ]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'custom-model')
  assert.equal(result.modelMarker, undefined)
  assert.equal(result.maxTokens, 512)
  assert.equal(result.temperature, 1.2)
  assert.equal(result.reasoningEffort, undefined)
  assert.deepEqual(result.errors, [])
})

test('first match wins for ambiguous model inputs', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'sonnet', key: 'model-line' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'claude-sonnet-4-5')
  assert.equal(result.modelMarker, 'sonnet')
  assert.equal(result.provider, 'anthropic')
  assert.deepEqual(result.errors, [])
})

test('reports errors for unknown models and invalid config keys', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'bad-model',
      children: [{ text: 'unknown-model', key: 'model-line' }]
    },
    {
      text: '<config>',
      key: 'bad-config',
      children: [
        { text: 'provider: invalid', key: 'bad-provider' },
        { text: 'foo: bar', key: 'bad-key' }
      ]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, undefined)
  assert.ok(result.errors.some(e => e.includes('Unknown model "unknown-model"')))
  assert.ok(result.errors.some(e => e.includes('Unknown provider')))
  assert.ok(result.errors.some(e => e.includes('Unknown config key')))
})

test('parses reasoningEffort when provided', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<config>',
      key: 'config',
      children: [
        { text: 'model: gpt-5.2', key: 'model' },
        { text: 'reasoningEffort: medium', key: 'effort' }
      ]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'gpt-5.2')
  assert.equal(result.modelMarker, undefined)
  assert.equal(result.reasoningEffort, 'medium')
  assert.deepEqual(result.errors, [])
})

test('records model marker when <model> is present without config override', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'opus', key: 'model-line' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'claude-opus-4-5')
  assert.equal(result.modelMarker, 'opus')
  assert.equal(result.provider, 'anthropic')
  assert.deepEqual(result.errors, [])
})

test('clears model marker when config model overrides <model>', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'haiku', key: 'model-line' }]
    },
    {
      text: '<config>',
      key: 'config',
      children: [{ text: 'model: exact-model-name', key: 'conf-model' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, 'exact-model-name')
  assert.equal(result.modelMarker, undefined)
  assert.deepEqual(result.errors, [])
})

test('unknown fuzzy tokens still report an error', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'bad-model',
      children: [{ text: 'kimi', key: 'model-line' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.model, undefined)
  assert.ok(result.errors.some(e => e.includes('Unknown model "kimi"')))
})

test('settings after the cursor marker are ignored', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<config>',
      key: 'config1',
      children: [{ text: 'maxTokens: 100', key: 'max1' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hi', key: 'cursor' }]
    },
    {
      text: '<config>',
      key: 'config2',
      children: [{ text: 'maxTokens: 200', key: 'max2' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing stop row')

  const result = parseConversationSettings(root as any, stopRow as any, MODEL_DEFINITIONS)

  assert.equal(result.maxTokens, 100)
})
