import * as assert from 'node:assert/strict'
import { parseMessages } from '../../src/llm-chat.bkext/app/message-parser'
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

      if (!parent.firstChild) {
        parent.firstChild = row
      }
      parent.children.push(row)

      if (previous) {
        previous.nextSibling = row
      }

      if (item.key) {
        byKey[item.key] = row
      }

      if (item.children?.length) {
        createChildren(item.children, row)
      }

      previous = row
    }
  }

  createChildren(nodes, root)

  // Pre-order traversal to populate nextInOutline pointers
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

test('parses nested content with indentation preserved', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user-marker',
      children: [
        { text: 'Top level line', key: 'line1' },
        {
          text: 'Nested parent',
          key: 'parent',
          children: [{ text: 'Nested child', key: 'child' }]
        }
      ]
    }
  ])

  const stopRow = byKey['child']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Top level line\nNested parent\n  Nested child\n'
  })
})

test('skips note rows and their descendants', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<system>',
      key: 'system',
      children: [{ text: 'Use short answers', key: 'system-line' }]
    },
    {
      text: 'Internal note',
      type: 'note',
      key: 'note',
      children: [{ text: 'Should be ignored', key: 'note-line' }]
    },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hello', key: 'user-line' }]
    },
    {
      text: '<assistant>',
      key: 'assistant',
      children: [{ text: 'Hi there', key: 'assistant-line' }]
    }
  ])

  const stopRow = byKey['assistant-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 3)
  assert.deepEqual(messages, [
    {
      role: 'system',
      content: 'Use short answers\n'
    },
    {
      role: 'user',
      content: 'Hello\n'
    },
    {
      role: 'assistant',
      content: 'Hi there\n'
    }
  ])
})

test('stops after the level-1 ancestor containing the cursor row', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user-1',
      children: [{ text: 'First question', key: 'question-1' }]
    },
    {
      text: '<assistant>',
      key: 'assistant-1',
      children: [
        { text: 'Answer line 1', key: 'answer-line-1' },
        { text: 'Answer line 2', key: 'answer-line-2' }
      ]
    },
    {
      text: '<user>',
      key: 'user-2',
      children: [{ text: 'Follow up question', key: 'follow-up' }]
    },
    {
      text: '<assistant>',
      key: 'assistant-2',
      children: [{ text: 'Should not be included', key: 'after-stop' }]
    }
  ])

  const stopRow = byKey['follow-up']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 3)
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: 'First question\n'
    },
    {
      role: 'assistant',
      content: 'Answer line 1\nAnswer line 2\n'
    },
    {
      role: 'user',
      content: 'Follow up question\n'
    }
  ])
})

test('defaults non-user/system markers to assistant role', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<assistant>',
      key: 'assistant-marker',
      children: [{ text: 'Hi there', key: 'assistant-line' }]
    },
    {
      text: '<claude-3-5-haiku>',
      key: 'model-marker',
      children: [{ text: 'Model reply', key: 'model-line' }]
    }
  ])

  const stopRow = byKey['model-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 2)
  assert.deepEqual(messages, [
    {
      role: 'assistant',
      content: 'Hi there\n'
    },
    {
      role: 'assistant',
      content: 'Model reply\n'
    }
  ])
})

test('ignores indented markers; only level-1 markers start messages', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        { text: 'Top level', key: 'top' },
        {
          text: '<assistant>',
          key: 'nested-marker',
          children: [{ text: 'Indented content', key: 'nested-line' }]
        },
        { text: 'After nested marker', key: 'after' }
      ]
    },
    {
      text: '<assistant>',
      key: 'assistant',
      children: [{ text: 'Reply', key: 'assistant-line' }]
    }
  ])

  const stopRow = byKey['assistant-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 2)
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: 'Top level\n<assistant>\n  Indented content\nAfter nested marker\n'
    },
    {
      role: 'assistant',
      content: 'Reply\n'
    }
  ])
})

test('skips note subtrees inside a message but keeps following siblings', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        { text: 'Before note', key: 'before' },
        {
          text: 'Comment block',
          type: 'note',
          key: 'note',
          children: [{ text: 'Hidden content', key: 'note-line' }]
        },
        { text: 'After note', key: 'after' }
      ]
    }
  ])

  const stopRow = byKey['after']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Before note\nAfter note\n'
  })
})

test('cursor inside a note subtree still returns the containing message', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        { text: 'Before note', key: 'before' },
        {
          text: 'Comment block',
          type: 'note',
          key: 'note',
          children: [{ text: 'Cursor here', key: 'cursor' }]
        },
        { text: 'After note', key: 'after' }
      ]
    },
    {
      text: '<assistant>',
      key: 'assistant',
      children: [{ text: 'Assistant reply', key: 'assistant-line' }]
    }
  ])

  const stopRow = byKey['cursor']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Before note\nAfter note\n'
  })
})
