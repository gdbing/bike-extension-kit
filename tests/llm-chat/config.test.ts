import * as assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from './test-harness'

function getTestConfigPath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/config.json')
}

function getTestManifestPath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/manifest.json')
}

function getTestConfigJsonPath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/config.json')
}

function getConfigModulePath(): string {
  return resolve(__dirname, '../../src/llm-chat.bkext/app/config.js')
}

test('getConfig rejects server hosts not allowed by manifest', () => {
  const configPath = getTestConfigPath()
  const manifestPath = getTestManifestPath()
  const configJsonPath = getTestConfigJsonPath()
  const configModulePath = getConfigModulePath()

  const originalConfig = readFileSync(configPath, 'utf-8')
  const originalManifest = readFileSync(manifestPath, 'utf-8')

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

    writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2))
    writeFileSync(
      manifestPath,
      JSON.stringify({ host_permissions: [] }, null, 2)
    )

    delete require.cache[configModulePath]
    delete require.cache[manifestPath]
    delete require.cache[configJsonPath]
    const { getConfig } = require(configModulePath) as typeof import('../../src/llm-chat.bkext/app/config')

    assert.throws(
      () => getConfig(),
      /not allowed by manifest host_permissions/
    )
  } finally {
    writeFileSync(configPath, originalConfig)
    writeFileSync(manifestPath, originalManifest)
    delete require.cache[configModulePath]
  }
})
