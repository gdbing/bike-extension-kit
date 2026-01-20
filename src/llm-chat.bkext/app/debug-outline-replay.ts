import type { Outline, OutlineEditor, Row } from 'bike/app'
import { attributedTextToMarkdown, parseMarkdownToRows, ParsedMarkdownRow, TextAttributeRun } from './markdown'

const WORD_DELAY_MS = 25

export async function replayOutlineAsStreamingMarkdown(editor: OutlineEditor): Promise<void> {
  const outline = editor.outline
  const markdown = outlineToMarkdown(outline.root)

  outline.transaction({ label: 'LLM Chat Debug Replay', animate: 'none' }, () => {
    const children = [...outline.root.children]
    if (children.length) {
      outline.removeRows(children)
    }
  })

  await streamMarkdownByWord(outline, markdown, WORD_DELAY_MS)
}

function outlineToMarkdown(root: Row): string {
  const lines: string[] = []
  let row: Row | undefined = root.firstChild
  let codeBlockIndent: number | null = null

  const openCodeBlock = (indent: number) => {
    if (codeBlockIndent !== null) return
    lines.push(`${'\t'.repeat(indent)}\`\`\``)
    codeBlockIndent = indent
  }

  const closeCodeBlock = () => {
    if (codeBlockIndent === null) return
    lines.push(`${'\t'.repeat(codeBlockIndent)}\`\`\``)
    codeBlockIndent = null
  }

  while (row) {
    const indent = Math.max(0, row.level - 1)
    if (row.type === 'code') {
      if (codeBlockIndent === null || codeBlockIndent !== indent) {
        if (codeBlockIndent !== null) {
          closeCodeBlock()
        }
        openCodeBlock(indent)
      }
      lines.push(`${'\t'.repeat(indent)}${row.text.string}`)
    } else {
      if (codeBlockIndent !== null) {
        closeCodeBlock()
      }
      const text = formatRowText(row)
      lines.push(`${'\t'.repeat(indent)}${text}`)
    }
    row = row.nextInOutline
  }

  if (codeBlockIndent !== null) {
    closeCodeBlock()
  }

  return lines.join('\n')
}

function formatRowText(row: Row): string {
  const text = attributedTextToMarkdown(row.text)
  switch (row.type) {
    case 'heading':
      return `# ${text}`
    case 'quote':
      return `> ${text}`
    case 'unordered':
      return `- ${text}`
    case 'ordered':
      return `${orderedIndexForRow(row)}. ${text}`
    case 'task': {
      const isDone = typeof row.attributes?.done === 'string'
      return `${isDone ? '[x]' : '[ ]'} ${text}`
    }
    default:
      return text
  }
}

function orderedIndexForRow(target: Row): number {
  const parent = target.parent
  if (!parent) return 1
  let index = 0
  for (const sibling of parent.children) {
    if (sibling.type === 'ordered') {
      index += 1
    }
    if (sibling.id === target.id) {
      return index || 1
    }
  }
  return 1
}

async function streamMarkdownByWord(
  outline: Outline,
  markdown: string,
  delayMs: number
): Promise<void> {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const tokens = splitMarkdownWords(normalized)

  let currentRow = outline.insertRows([{ text: '' }], outline.root)[0]
  let buffer = ''
  let currentRowContent = ''
  const completedLines: string[] = []

  const renderCompletedLines = () => {
    if (completedLines.length === 0) return
    const rawText = completedLines.join('\n')
    replaceRowsWithMarkdown(outline, outline.root, rawText)
    currentRow = outline.insertRows([{ text: currentRowContent }], outline.root)[0]
  }

  for (const token of tokens) {
    buffer += token

    let completedLine = false
    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n')
      const lineContent = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      const finalContent = currentRowContent + lineContent
      completedLines.push(finalContent)
      currentRowContent = ''
      completedLine = true
    }

    if (completedLine) {
      renderCompletedLines()
    }

    if (buffer) {
      currentRowContent += buffer
      outline.transaction({ animate: 'none' }, () => {
        currentRow.text.replace([0, currentRow.text.string.length], currentRowContent)
      })
      buffer = ''
    }

    if (delayMs > 0) {
      await sleep(delayMs)
    }
  }

  const finalLines = currentRowContent
    ? completedLines.concat(currentRowContent)
    : completedLines
  replaceRowsWithMarkdown(outline, outline.root, finalLines.join('\n'))
}

function splitMarkdownWords(markdown: string): string[] {
  if (!markdown) return []
  return markdown.match(/\s+|\S+\s*/g) ?? []
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function replaceRowsWithMarkdown(outline: Outline, parent: Row, markdown: string): void {
  const parsed = parseMarkdownToRows(markdown)
  if (parent.children.length) {
    outline.removeRows([...parent.children])
  }
  if (parsed.length === 0) {
    outline.insertRows([{ text: '' }], parent)
    return
  }
  insertParsedRows(outline, parent, parsed)
}

function insertParsedRows(
  outline: Outline,
  parent: Row,
  rows: ParsedMarkdownRow[]
): void {
  const templates = rows.map(row => ({
    text: row.text,
    type: row.type,
    attributes: row.attributes
  }))
  const inserted = outline.insertRows(templates, parent)

  for (let index = 0; index < inserted.length; index += 1) {
    const created = inserted[index]
    const source = rows[index]
    if (source.runs?.length) {
      applyTextRuns(created.text, source.runs)
    }
    if (source.children.length) {
      insertParsedRows(outline, created, source.children)
    }
  }
}

function applyTextRuns(text: Row['text'], runs: TextAttributeRun[]): void {
  for (const run of runs) {
    if (run.end <= run.start) continue
    text.addAttribute(run.name, run.value ?? '', [run.start, run.end])
  }
}
