import { Outline, Row } from 'bike/app'

/**
 * Find an existing <assistant> row after the given row,
 * or create a new one.
 */
function findOrCreateAssistantRow(outline: Outline, afterRow: Row): Row {
  // Find the root-level row containing or equal to afterRow
  let rootLevelRow: Row = afterRow
  while (rootLevelRow.level > 1 && rootLevelRow.parent) {
    rootLevelRow = rootLevelRow.parent
  }

  // Search for existing <assistant> row among root-level siblings
  const nextSibling = rootLevelRow.nextSibling
  if (nextSibling && nextSibling.text.string.trim().toLowerCase() === '<assistant>') {
    // Reuse existing assistant only if it has no content to avoid clobbering later messages
    if (nextSibling.children.length === 0) {
      return nextSibling
    }
  }

  // Create new <assistant> row at root level, after the current root-level row
  const newRows = outline.insertRows(
    [{ text: '<assistant>' }],
    outline.root,
    rootLevelRow.nextSibling
  )

  return newRows[0]
}

function prepareAssistantRow(outline: Outline, afterRow: Row): Row {
  const assistantRow = findOrCreateAssistantRow(outline, afterRow)

  return assistantRow
}

export function insertStaticResponse(
  outline: Outline,
  afterRow: Row,
  text: string
): void {
  const assistantRow = prepareAssistantRow(outline, afterRow)

  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  const rows = lines.map(line => ({ text: line }))
  const inserted = outline.insertRows(rows, assistantRow)

  if (inserted.length === 0) {
    outline.insertRows([{ text: '' }], assistantRow)
  }
}

/**
 * Stream tokens from the generator into the outline under an <assistant> heading.
 */
export async function streamResponseToOutline(
  outline: Outline,
  afterRow: Row,
  tokenGenerator: AsyncGenerator<string, void, unknown>
): Promise<void> {
  // Find or create assistant heading
  const assistantRow = prepareAssistantRow(outline, afterRow)

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
}
