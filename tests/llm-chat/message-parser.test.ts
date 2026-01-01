import * as assert from 'node:assert/strict'
import { parseMessages } from '../../src/llm-chat.bkext/app/message-parser'
import { test } from './test-harness'

type RowType = 'row' | 'note'

interface TestRow {
  id: string
  text: TestText
  type: RowType
  level: number
  parent?: TestRow
  firstChild?: TestRow
  nextSibling?: TestRow
  nextInOutline?: TestRow
  children: TestRow[]
  lastLeaf?: TestRow
}

interface OutlineNode {
  text: string
  type?: RowType
  key?: string
  link?: string
  children?: OutlineNode[]
}

interface BuildResult {
  root: TestRow
  byKey: Record<string, TestRow>
}

let idCounter = 0

interface TestText {
  string: string
  attributeAt?: (name: string, index: number) => string | null
}

function makeText(value: string, link?: string): TestText {
  if (!link) {
    return { string: value }
  }

  return {
    string: value,
    attributeAt: (name: string, index: number) => {
      if (name !== 'a') return null
      if (index < 0 || index >= value.length) return null
      return link
    }
  }
}

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
        text: makeText(item.text, item.link),
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

  if (preorder.length > 0) {
    root.lastLeaf = preorder[preorder.length - 1]
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
    content: 'Top level line\nNested parent\n\tNested child\n'
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

test('ignores root rows that are not markers', () => {
  const { root, byKey } = buildOutline([
    { text: 'user', key: 'plain-user' },
    { text: 'NB refer to $URL', key: 'note' },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Hello', key: 'user-line' }]
    }
  ])

  const stopRow = byKey['user-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: 'Hello\n'
    }
  ])
})

test('applies <cache> marker to the next user message', () => {
  const { root, byKey } = buildOutline([
    { text: '<cache>', key: 'cache' },
    {
      text: '<user>',
      key: 'user',
      children: [{ text: 'Cache this', key: 'user-line' }]
    }
  ])

  const stopRow = byKey['user-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Cache this\n',
    cacheControl: { type: 'ephemeral', ttl: '1h' }
  })
})

test('cache marker does not apply to later messages', () => {
  const { root, byKey } = buildOutline([
    { text: '<cache>', key: 'cache' },
    {
      text: '<user>',
      key: 'user-one',
      children: [{ text: 'First message', key: 'user-one-line' }]
    },
    {
      text: '<user>',
      key: 'user-two',
      children: [{ text: 'Second message', key: 'user-two-line' }]
    }
  ])

  const stopRow = byKey['user-two-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 2)
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: 'First message\n',
      cacheControl: { type: 'ephemeral', ttl: '1h' }
    },
    {
      role: 'user',
      content: 'Second message\n'
    }
  ])
})

test('applies <cache> marker to the next assistant message', () => {
  const { root, byKey } = buildOutline([
    { text: '<cache>', key: 'cache' },
    {
      text: '<assistant>',
      key: 'assistant',
      children: [{ text: 'Cached response', key: 'assistant-line' }]
    }
  ])

  const stopRow = byKey['assistant-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'assistant',
    content: 'Cached response\n',
    cacheControl: { type: 'ephemeral', ttl: '1h' }
  })
})

test('cache marker is consumed by an empty user message', () => {
  const { root, byKey } = buildOutline([
    { text: '<cache>', key: 'cache' },
    {
      text: '<user>',
      key: 'empty-user',
      children: [{ text: '   ', key: 'empty-line' }]
    },
    {
      text: '<user>',
      key: 'next-user',
      children: [{ text: 'Hello', key: 'next-line' }]
    }
  ])

  const stopRow = byKey['next-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Hello\n'
  })
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

test('ignores <model> and <config> markers for message parsing', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<model>',
      key: 'model-marker',
      children: [{ text: 'sonnet', key: 'model-line' }]
    },
    {
      text: '<config>',
      key: 'config-marker',
      children: [{ text: 'model: gpt-5-mini', key: 'config-line' }]
    },
    {
      text: '<user>',
      key: 'user-marker',
      children: [{ text: 'Hello', key: 'user-line' }]
    }
  ])

  const stopRow = byKey['user-line']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages, [
    {
      role: 'user',
      content: 'Hello\n'
    }
  ])
})

test('treats indented <name> rows as tags with closing tags', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        { text: 'Top level', key: 'top' },
        {
          text: '<dogs>',
          key: 'dogs-tag',
          children: [
            { text: 'terrier', key: 'terrier' },
            { text: 'foxhound', key: 'foxhound' },
            { text: 'poodle', key: 'poodle' }
          ]
        },
        { text: 'After tag', key: 'after' }
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
      content: 'Top level\n<dogs>\nterrier\nfoxhound\npoodle\n</dogs>\nAfter tag\n'
    },
    {
      role: 'assistant',
      content: 'Reply\n'
    }
  ])
})

test('tag content aligns with the tag row indentation', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        {
          text: 'Animals',
          key: 'animals',
          children: [
            {
              text: '<dogs>',
              key: 'dogs-tag',
              children: [{ text: 'terrier', key: 'terrier' }]
            }
          ]
        }
      ]
    }
  ])

  const stopRow = byKey['terrier']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: 'Animals\n\t<dogs>\n\tterrier\n\t</dogs>\n'
  })
})

test('supports nested tags with closing tags in order', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        {
          text: '<outer>',
          key: 'outer-tag',
          children: [
            { text: 'Before inner', key: 'before' },
            {
              text: '<inner>',
              key: 'inner-tag',
              children: [{ text: 'Inside', key: 'inside' }]
            },
            { text: 'After inner', key: 'after' }
          ]
        }
      ]
    }
  ])

  const stopRow = byKey['after']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: '<outer>\nBefore inner\n<inner>\nInside\n</inner>\nAfter inner\n</outer>\n'
  })
})

test('skips note subtrees inside tags but keeps tag structure', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        {
          text: '<section>',
          key: 'section-tag',
          children: [
            { text: 'Intro', key: 'intro' },
            {
              text: 'Note block',
              type: 'note',
              key: 'note',
              children: [{ text: 'Hidden', key: 'hidden' }]
            },
            { text: 'Outro', key: 'outro' }
          ]
        }
      ]
    }
  ])

  const stopRow = byKey['outro']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: '<section>\nIntro\nOutro\n</section>\n'
  })
})

test('renders empty tags with opening and closing lines', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      key: 'user',
      children: [
        { text: '<empty>', key: 'empty-tag' },
        { text: 'After', key: 'after' }
      ]
    }
  ])

  const stopRow = byKey['after']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any)

  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0], {
    role: 'user',
    content: '<empty>\n</empty>\nAfter\n'
  })
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

function makeInlineResolver(
  byUrl: Record<string, BuildResult>,
  byDisplayName: Record<string, BuildResult>
) {
  return {
    resolveByURL: (url: string) => {
      const match = byUrl[url]
      return match ? { root: match.root as any, id: url } : null
    },
    resolveByDisplayName: (name: string) => {
      const match = byDisplayName[name]
      return match ? { root: match.root as any, id: name } : null
    }
  }
}

test('inlines messages from linked outlines in order', () => {
  const inlineDoc1 = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Doc1 user', key: 'doc1-user' }]
    },
    {
      text: '<assistant>',
      children: [{ text: 'Doc1 assistant', key: 'doc1-assistant' }]
    }
  ])

  const inlineDoc2 = buildOutline([
    {
      text: '<assistant>',
      children: [{ text: 'Doc2 assistant', key: 'doc2-assistant' }]
    }
  ])

  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'hi' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'file:///doc1.bike' }]
    },
    {
      text: '<assistant>',
      children: [{ text: 'After inline', key: 'after-inline' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'Second Doc' }]
    },
    {
      text: '<user>',
      children: [{ text: 'Done', key: 'done' }]
    }
  ])

  const stopRow = byKey['done']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any, {
    inlineResolver: makeInlineResolver(
      { 'file:///doc1.bike': inlineDoc1 },
      { 'Second Doc': inlineDoc2 }
    )
  })

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hi\n' },
    { role: 'user', content: 'Doc1 user\n' },
    { role: 'assistant', content: 'Doc1 assistant\n' },
    { role: 'assistant', content: 'After inline\n' },
    { role: 'assistant', content: 'Doc2 assistant\n' },
    { role: 'user', content: 'Done\n' }
  ])
})

test('falls back to visible text when link URL does not resolve', () => {
  const inlineDoc = buildOutline([
    {
      text: '<assistant>',
      children: [{ text: 'Fallback hit', key: 'fallback' }]
    }
  ])

  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'hi' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'Doc Three', link: 'file:///missing.bike' }]
    },
    {
      text: '<assistant>',
      children: [{ text: 'After inline', key: 'after-inline' }]
    }
  ])

  const stopRow = byKey['after-inline']
  if (!stopRow) throw new Error('Missing test row')

  const messages = parseMessages(root as any, stopRow as any, {
    inlineResolver: makeInlineResolver(
      {},
      { 'Doc Three': inlineDoc }
    )
  })

  assert.deepEqual(messages, [
    { role: 'user', content: 'Hi\n' },
    { role: 'assistant', content: 'Fallback hit\n' },
    { role: 'assistant', content: 'After inline\n' }
  ])
})

test('throws when inline document is not open', () => {
  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'hi' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'Missing Doc' }]
    },
    {
      text: '<assistant>',
      children: [{ text: 'After inline', key: 'after-inline' }]
    }
  ])

  const stopRow = byKey['after-inline']
  if (!stopRow) throw new Error('Missing test row')

  assert.throws(
    () =>
      parseMessages(root as any, stopRow as any, {
        inlineResolver: makeInlineResolver({}, {})
      }),
    {
      message: 'Unable to find Missing Doc. Inlined documents must be open in Bike.'
    }
  )
})

test('throws on inline cycles', () => {
  const inlineDoc = buildOutline([
    {
      text: '<inline>',
      children: [{ text: 'file:///doc1.bike' }]
    }
  ])

  const { root, byKey } = buildOutline([
    {
      text: '<user>',
      children: [{ text: 'Hi', key: 'hi' }]
    },
    {
      text: '<inline>',
      children: [{ text: 'file:///doc1.bike' }]
    },
    {
      text: '<assistant>',
      children: [{ text: 'After inline', key: 'after-inline' }]
    }
  ])

  const stopRow = byKey['after-inline']
  if (!stopRow) throw new Error('Missing test row')

  assert.throws(
    () =>
      parseMessages(root as any, stopRow as any, {
        inlineResolver: makeInlineResolver(
          { 'file:///doc1.bike': inlineDoc },
          {}
        )
      }),
    {
      message: 'Inline cycle detected for file:///doc1.bike.'
    }
  )
})
