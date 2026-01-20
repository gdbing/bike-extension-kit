import * as assert from 'node:assert/strict'
import { parseMarkdownLine, TextAttributeRun } from '../../src/llm-chat.bkext/app/markdown'
import { test } from './test-harness'

test('parseMarkdownLine handles h1 headings', () => {
  const result = parseMarkdownLine('# Title')
  assert.equal(result.text, 'Title')
  assert.equal(result.type, 'heading')
})

test('parseMarkdownLine leaves h2 markers as plain text', () => {
  const result = parseMarkdownLine('## Heading')
  assert.equal(result.text, '## Heading')
  assert.equal(result.type, undefined)
})

test('parseMarkdownLine handles ordered list items', () => {
  const result = parseMarkdownLine('2. Second')
  assert.equal(result.text, 'Second')
  assert.equal(result.type, 'ordered')
})

test('parseMarkdownLine handles unordered list items', () => {
  const result = parseMarkdownLine('- Bullet')
  assert.equal(result.text, 'Bullet')
  assert.equal(result.type, 'unordered')
})

test('parseMarkdownLine handles checked tasks', () => {
  const result = parseMarkdownLine('- [x] Done')
  assert.equal(result.text, 'Done')
  assert.equal(result.type, 'task')
  assert.ok(result.attributes?.done)
  assert.match(result.attributes?.done ?? '', /\d{4}-\d{2}-\d{2}T/)
})

test('parseMarkdownLine handles quotes with inline formatting', () => {
  const result = parseMarkdownLine('> Quote with *italic*')
  assert.equal(result.text, 'Quote with italic')
  assert.equal(result.type, 'quote')
  assertRun(result.runs ?? [], {
    name: 'em',
    start: result.text.indexOf('italic'),
    end: result.text.indexOf('italic') + 'italic'.length
  })
})

function assertRun(
  runs: TextAttributeRun[],
  expected: { name: string; start: number; end: number }
): void {
  const match = runs.find(run =>
    run.name === expected.name &&
    run.start === expected.start &&
    run.end === expected.end
  )
  assert.ok(match, `Missing ${expected.name} run at ${expected.start}-${expected.end}`)
}
