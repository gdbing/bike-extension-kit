import * as assert from 'node:assert/strict'
import { parseConversationSettings } from '../../src/llm-chat.bkext/app/settings-parser'
import { test } from './test-harness'

type RowType = 'row' | 'note'

interface TestRow {
  id: string
  text: { string: string }
  type: RowType
  level: number
  parent?: TestRow
  firstChild?: TestRow
  nextSibling?: TestRow
  nextInOutline?: TestRow
  children: TestRow[]
}

interface OutlineNode {
  text: string
  type?: RowType
  key?: string
  children?: OutlineNode[]
}

interface BuildResult {
  root: TestRow
  byKey: Record<string, TestRow>
}

let idCounter = 0

function buildOutline(nodes: OutlineNode[]): BuildResult {
  const root: TestRow = {
    id: 'root',
    text: { string: '' },
    type: 'row',
    level: 0,
    children: []
  }

  const byKey: Record<string, TestRow> = {}

  const createChildren = (items: OutlineNode[], parent: TestRow) => {
    let previous: TestRow | undefined
    for (const item of items) {
      const row: TestRow = {
        id: `row-${++idCounter}`,
        text: { string: item.text },
        type: item.type ?? 'row',
        level: parent.level + 1,
        parent,
        children: []
      }

      if (!parent.firstChild) parent.firstChild = row
      parent.children.push(row)
      if (previous) previous.nextSibling = row
      if (item.key) byKey[item.key] = row
      if (item.children?.length) createChildren(item.children, row)
      previous = row
    }
  }

  createChildren(nodes, root)

  const preorder: TestRow[] = []
  const visit = (row?: TestRow) => {
    if (!row) return
    preorder.push(row)
    visit(row.firstChild)
    visit(row.nextSibling)
  }
  visit(root.firstChild)

  for (let index = 0; index < preorder.length; index += 1) {
    const current = preorder[index]
    current.nextInOutline = preorder[index + 1]
  }

  return { root, byKey }
}

test('resolves <model> aliases against known models', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model',
      children: [{ text: 'sonnet', key: 'model-value' }]
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

  assert.equal(result.model, 'claude-3-5-sonnet-20241022')
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

  const result = parseConversationSettings(root as any, stopRow as any)

  assert.equal(result.model, 'custom-model')
  assert.equal(result.maxTokens, 512)
  assert.equal(result.temperature, 1.2)
  assert.deepEqual(result.errors, [])
})

test('reports errors for unknown model alias and invalid config keys', () => {
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

  const result = parseConversationSettings(root as any, stopRow as any)

  assert.equal(result.model, undefined)
  assert.ok(result.errors.some(e => e.includes('Unknown model "unknown-model"')))
  assert.ok(result.errors.some(e => e.includes('Unknown provider')))
  assert.ok(result.errors.some(e => e.includes('Unknown config key')))
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

  const result = parseConversationSettings(root as any, stopRow as any)

  assert.equal(result.maxTokens, 100)
})
