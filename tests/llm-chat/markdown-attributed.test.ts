import * as assert from 'node:assert/strict'
import type { AttributedString } from 'bike/app'
import { attributedTextToMarkdown } from '../../src/llm-chat.bkext/app/markdown'
import { test } from './test-harness'

test('attributedTextToMarkdown preserves run boundaries', () => {
  const text = 'normal italic normal'
  const attributed = makeAttributedText(text, [
    { name: 'em', start: 7, end: 13, value: '' }
  ])

  const markdown = attributedTextToMarkdown(attributed)

  assert.equal(markdown, 'normal *italic* normal')
})

test('attributedTextToMarkdown uses downstream affinity with attributesAt', () => {
  const text = 'normal italic normal'
  const attributed = makeAttributesOnlyAttributedText(text, [
    { name: 'em', start: 7, end: 13, value: '' }
  ])

  const markdown = attributedTextToMarkdown(attributed)

  assert.equal(markdown, 'normal *italic* normal')
})

type Run = {
  name: string
  start: number
  end: number
  value?: string
}

function makeAttributedText(text: string, runs: Run[]): AttributedString {
  return {
    string: text,
    attributesAt(index: number, affinity?: 'upstream' | 'downstream') {
      const attributes: Record<string, string> = {}
      for (const run of runs) {
        if (hasAttribute(index, run, affinity)) {
          attributes[run.name] = run.value ?? ''
        }
      }
      return attributes
    },
    attributeAt(name: string, index: number, affinity?: 'upstream' | 'downstream') {
      const run = runs.find(candidate =>
        candidate.name === name && hasAttribute(index, candidate, affinity)
      )
      return run ? (run.value ?? '') : null
    }
  } as AttributedString
}

function makeAttributesOnlyAttributedText(text: string, runs: Run[]): AttributedString {
  return {
    string: text,
    attributesAt(index: number, affinity?: 'upstream' | 'downstream') {
      const attributes: Record<string, string> = {}
      for (const run of runs) {
        if (hasAttribute(index, run, affinity)) {
          attributes[run.name] = run.value ?? ''
        }
      }
      return attributes
    }
  } as AttributedString
}

function hasAttribute(index: number, run: Run, affinity?: 'upstream' | 'downstream'): boolean {
  if (affinity === 'downstream') {
    return index >= run.start && index < run.end
  }
  return index > run.start && index <= run.end
}
