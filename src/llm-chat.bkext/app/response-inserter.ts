import { Outline, Row } from 'bike/app'
import { setMarkerAttribute } from './marker-attributes'
import { parseMarkdownLineTokens, parseMarkdownToRows, ParsedMarkdownRow, TextAttributeRun, TextDeleteRange } from './markdown'

/**
 * Create a new marker row after the given row.
 */
function findOrCreateMarkerRow(
  outline: Outline,
  afterRow: Row,
  markerText: string
): Row {
  // Find the root-level row containing or equal to afterRow
  let rootLevelRow: Row = afterRow
  while (rootLevelRow.level > 1 && rootLevelRow.parent) {
    rootLevelRow = rootLevelRow.parent
  }

  // Always create a new marker row to avoid concurrent streaming collisions.
  const newRows = outline.insertRows(
    [{ text: markerText }],
    outline.root,
    rootLevelRow.nextSibling
  )

  return newRows[0]
}

function prepareMarkerRow(
  outline: Outline,
  afterRow: Row,
  markerText: string
): Row {
  const markerRow = findOrCreateMarkerRow(outline, afterRow, markerText)
  setMarkerAttribute(markerRow, markerText)
  return markerRow
}

export function insertStaticResponse(
  outline: Outline,
  afterRow: Row,
  text: string,
  markerText = '<assistant>'
): void {
  const targetRow = prepareMarkerRow(outline, afterRow, markerText)

  const normalized = text.replace(/\r\n/g, '\n')
  replaceRowsWithMarkdown(outline, targetRow, normalized)
}

/**
 * Stream tokens from the generator into the outline under an <assistant> heading.
 */
export async function streamResponseToOutline(
  outline: Outline,
  afterRow: Row,
  tokenGenerator: AsyncGenerator<string, void, unknown>,
  markerText = '<assistant>'
): Promise<void> {
  // Find or create assistant heading
  const assistantRow = prepareMarkerRow(outline, afterRow, markerText)

  // Create initial content row
  let currentRow = outline.insertRows([{ text: '' }], assistantRow)[0]

  const state: StreamParseState = {
    indentUnit: null,
    rowStack: [],
    inCodeFence: false
  }

  let buffer = ''
  let currentRowContent = ''

  for await (const token of tokenGenerator) {
    buffer += token

    // Split on newlines
    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n')
      let lineContent = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      if (lineContent.endsWith('\r')) {
        lineContent = lineContent.slice(0, -1)
      }

      const finalContent = currentRowContent + lineContent
      currentRowContent = ''
      finalizeLine(outline, assistantRow, currentRow, finalContent, state)
      currentRow = outline.insertRows([{ text: '' }], assistantRow)[0]
    }

    // Update current row with remaining buffer (no newline yet)
    if (buffer) {
      currentRowContent += buffer
      outline.transaction({ animate: 'none' }, () => {
        currentRow.text.replace([0, currentRow.text.string.length], currentRowContent)
      })
      buffer = ''
    }
  }

  if (currentRowContent.endsWith('\r')) {
    currentRowContent = currentRowContent.slice(0, -1)
  }
  finalizeLine(outline, assistantRow, currentRow, currentRowContent, state)
}

type StreamParseState = {
  indentUnit: string | null
  rowStack: Row[]
  inCodeFence: boolean
}

function finalizeLine(
  outline: Outline,
  assistantRow: Row,
  row: Row,
  rawLine: string,
  state: StreamParseState
): void {
  const { indent, content, indentLength } = splitIndent(rawLine, state)
  const trimmed = content.trim()

  outline.transaction({ animate: 'none' }, () => {
    if (row.text.string !== rawLine) {
      row.text.replace([0, row.text.string.length], rawLine)
    }

    if (indentLength > 0) {
      row.text.replace([0, indentLength], '')
    }

    if (trimmed.startsWith('```')) {
      outline.removeRows([row])
      state.inCodeFence = !state.inCodeFence
      return
    }

    placeRowByIndent(outline, assistantRow, row, indent, state.rowStack)

    if (state.inCodeFence) {
      row.type = 'code'
      return
    }

    const parsed = parseMarkdownLineTokens(content)
    applyDeleteRanges(row.text, parsed.deleteRanges)
    applyRowType(row, parsed.type)
    applyRowAttributes(row, parsed.attributes)
    if (parsed.runs?.length) {
      applyTextRuns(row.text, parsed.runs)
    }
  })
}

function splitIndent(
  line: string,
  state: StreamParseState
): { indent: number; content: string; indentLength: number } {
  if (!state.indentUnit) {
    const match = line.match(/^[\t ]+/)
    if (match) {
      state.indentUnit = match[0]
    }
  }

  let indent = 0
  let content = line
  const indentUnit = state.indentUnit

  if (indentUnit) {
    while (content.startsWith(indentUnit)) {
      indent += 1
      content = content.slice(indentUnit.length)
    }
    if (!indentUnit.includes('\t')) {
      while (content.startsWith('\t')) {
        indent += 1
        content = content.slice(1)
      }
    }
  }

  return { indent, content, indentLength: line.length - content.length }
}

function placeRowByIndent(
  outline: Outline,
  assistantRow: Row,
  row: Row,
  indent: number,
  stack: Row[]
): void {
  if (indent <= 0) {
    outline.moveRows([row], assistantRow)
    stack.length = 0
    stack[0] = row
    return
  }

  const clampedIndent = Math.min(indent, stack.length)
  const parent = stack[clampedIndent - 1] ?? assistantRow
  outline.moveRows([row], parent)
  stack.length = clampedIndent
  stack[clampedIndent] = row
}

function applyRowType(row: Row, type?: Row['type']): void {
  if (type) {
    row.type = type
  }
}

function applyRowAttributes(row: Row, attributes?: Record<string, string>): void {
  if (!attributes) return
  for (const [key, value] of Object.entries(attributes)) {
    row.setAttribute(key, value)
  }
}

function applyDeleteRanges(text: Row['text'], ranges: TextDeleteRange[]): void {
  if (!ranges.length) return
  const ordered = [...ranges].sort((a, b) => {
    if (a.start === b.start) return b.end - a.end
    return b.start - a.start
  })
  for (const range of ordered) {
    if (range.end <= range.start) continue
    text.replace([range.start, range.end], '')
  }
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
