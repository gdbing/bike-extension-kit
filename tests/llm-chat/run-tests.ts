import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runTests } from './test-harness'

function seedConfigForTests(): void {
  const root = process.cwd()
  const testRoot = resolve(__dirname, '../../src/llm-chat.bkext')
  const targetDir = dirname(resolve(testRoot, 'config.json'))
  mkdirSync(targetDir, { recursive: true })

  copyFileSync(
    resolve(root, 'src/llm-chat.bkext/config.json'),
    resolve(testRoot, 'config.json')
  )
  copyFileSync(
    resolve(root, 'src/llm-chat.bkext/manifest.json'),
    resolve(testRoot, 'manifest.json')
  )
}

async function main(): Promise<void> {
  seedConfigForTests()

  await import('./config.test')
  await import('./command-flow.test')
  await import('./inline-opener.test')
  await import('./inline-resolver.test')
  await import('./inline-path.test')
  await import('./cache-warm-candidates.test')
  await import('./cache-warm-manager.test')
  await import('./cache-warm-runtime.test')
  await import('./message-parser.test')
  await import('./markdown-inline.test')
  await import('./markdown-line.test')
  await import('./markdown-attributed.test')
  await import('./response-inserter.test')
  await import('./settings-parser.test')
  await import('./system-message.test')

  await runTests()
}

main().catch(error => {
  console.error('Test runner encountered an unexpected error')
  console.error(error)
  process.exitCode = 1
})
