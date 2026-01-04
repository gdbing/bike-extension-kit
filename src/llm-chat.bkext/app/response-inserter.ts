import { Outline, Row } from 'bike/app'
import { setMarkerAttribute } from './marker-attributes'
import { parseMarkdownToRows, ParsedMarkdownRow, TextAttributeRun } from './markdown'

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
  let currentRow = outline.insertRows(
    [{ text: '' }],
    assistantRow
  )[0]

  let buffer = ''
  let currentRowContent = ''

  for await (const token of tokenGenerator) {
    buffer += token

    // Split on newlines
    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n')
      const lineContent = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)

      // Finalize current row with complete line
      const finalContent = currentRowContent + lineContent
      if (finalContent) {
        outline.transaction({ animate: 'none' }, () => {
          currentRow.text.replace([0, currentRow.text.string.length], finalContent)
        })
      }

      // Create new row for next line
      currentRow = outline.insertRows(
        [{ text: '' }],
        assistantRow
      )[0]
      currentRowContent = ''
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

  // Flush any remaining content
  if (currentRowContent) {
    outline.transaction({ animate: 'none' }, () => {
      currentRow.text.replace([0, currentRow.text.string.length], currentRowContent)
    })
  }

  // Remove empty trailing row if exists
  if (currentRow.text.string === '') {
    outline.removeRows([currentRow])
  }

  const rawLines = assistantRow.children.map(row => row.text.string)
  const rawText = rawLines.join('\n')
  replaceRowsWithMarkdown(outline, assistantRow, rawText)
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
