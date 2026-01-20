import * as assert from 'node:assert/strict'
import { parseInlineMarkdown, TextAttributeRun } from '../../src/llm-chat.bkext/app/markdown'
import { test } from './test-harness'

test('parseInlineMarkdown captures italic runs', () => {
  const result = parseInlineMarkdown('normal *italic* normal')
  assert.equal(result.text, 'normal italic normal')
  assertRun(result.runs, {
    name: 'em',
    start: result.text.indexOf('italic'),
    end: result.text.indexOf('italic') + 'italic'.length
  })
})

test('parseInlineMarkdown captures code runs', () => {
  const result = parseInlineMarkdown('start `code` end')
  assert.equal(result.text, 'start code end')
  assertRun(result.runs, {
    name: 'code',
    start: result.text.indexOf('code'),
    end: result.text.indexOf('code') + 'code'.length
  })
})

test('parseInlineMarkdown captures link runs', () => {
  const result = parseInlineMarkdown('go [link](http://example.com) now')
  assert.equal(result.text, 'go link now')
  assertRun(result.runs, {
    name: 'a',
    value: 'http://example.com',
    start: result.text.indexOf('link'),
    end: result.text.indexOf('link') + 'link'.length
  })
})

function assertRun(
  runs: TextAttributeRun[],
  expected: { name: string; start: number; end: number; value?: string }
): void {
  const match = runs.find(run =>
    run.name === expected.name &&
    run.start === expected.start &&
    run.end === expected.end
  )

  assert.ok(match, `Missing ${expected.name} run at ${expected.start}-${expected.end}`)

  if (expected.value !== undefined) {
    assert.equal(match?.value, expected.value)
  }
}
