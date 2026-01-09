import * as assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from './test-harness'

function getConfigJsonPath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/config.json')
}

function getTestManifestPath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/manifest.json')
}

function getConfigModulePath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/app/config.js')
}

function stubModule(path: string, exports: unknown): NodeModule | undefined {
  const previous = require.cache[path]
  require.cache[path] = {
    id: path,
    filename: path,
    loaded: true,
    exports
  } as NodeModule
  return previous
}

function restoreModule(path: string, previous?: NodeModule): void {
  if (previous) {
    require.cache[path] = previous
  } else {
    delete require.cache[path]
  }
}

test('getConfig rejects server hosts not allowed by manifest', () => {
  const configPath = getConfigJsonPath()
  const manifestPath = getTestManifestPath()
  const configModulePath = getConfigModulePath()

  const originalConfig = require.cache[configPath]
  const originalManifest = require.cache[manifestPath]
  const originalConfigModule = require.cache[configModulePath]

  try {
    const updatedConfig = {
      server: {
        protocol: 'https',
        host: '127.0.0.1',
        port: 3033
      },
      pollingIntervalMs: 200,
      requestDefaults: {
        model: 'claude-haiku-4-5',
        maxTokens: 4096
      },
      models: [
        { name: 'claude-haiku-4-5', provider: 'anthropic' }
      ],
      ui: {
        showErrorsInOutline: true
      }
    }

    stubModule(configPath, updatedConfig)
    stubModule(manifestPath, { host_permissions: [] })
    delete require.cache[configModulePath]
    const { getConfig } = require(configModulePath) as typeof import('../../src/llm-chat.bkext/app/config')

    assert.throws(
      () => getConfig(),
      /not allowed by manifest host_permissions/
    )
  } finally {
    restoreModule(configPath, originalConfig)
    restoreModule(manifestPath, originalManifest)
    restoreModule(configModulePath, originalConfigModule)
  }
})
