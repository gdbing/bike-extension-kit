import { Row } from 'bike/app'
import { Message } from './providers/types'

/**
 * Parse messages from outline rows up to (and including) the stop row.
 *
 * - Markers must be at level 1 (root children) and match <name> pattern
 * - <user> → user role, <system> → system role
 * - Any other <name> marker (including <assistant>, model names) → assistant role
 * - Only content nested under a marker is included in that message
 * - Note-type rows are skipped (treated as comments)
 */
export function parseMessages(root: Row, stopRow: Row): Message[] {
  const messages: Message[] = []
  let currentMessage: Message | null = null
  let markerRow: Row | null = null
  let row: Row | undefined = root.firstChild

  while (row) {
    // Skip note rows and all their descendants (treat as comments)
    if (row.type === 'note') {
      if (row === stopRow || isDescendant(stopRow, row)) {
        break
      }
      row = nextRowAfterSubtree(row)
      continue
    }

    // Check for markers at level 1 (root children only)
    if (row.level === 1) {
      const text = row.text.string.trim().toLowerCase()
      const markerMatch = text.match(/^<([^>]+)>$/)

      if (markerMatch) {
        // Save previous message if it has content
        if (currentMessage && currentMessage.content.trim()) {
          messages.push(currentMessage)
        }

        // Determine role: user/system are explicit, everything else is assistant
        const markerName = markerMatch[1]
        let role: 'user' | 'assistant' | 'system'
        if (markerName === 'user') {
          role = 'user'
        } else if (markerName === 'system') {
          role = 'system'
        } else {
          role = 'assistant'
        }

        currentMessage = { role, content: '' }
        markerRow = row

        if (row === stopRow) {
          break
        }

        row = row.nextInOutline
        continue
      } else {
        // Level 1 non-marker row - finalize current message
        if (currentMessage && currentMessage.content.trim()) {
          messages.push(currentMessage)
          currentMessage = null
          markerRow = null
        }

        if (row === stopRow) {
          break
        }

        row = row.nextInOutline
        continue
      }
    }

    // Accumulate content only if nested under the marker row
    if (currentMessage && markerRow && isDescendant(row, markerRow)) {
      const text = row.text.string
      // Preserve indentation relative to marker level
      const indent = '  '.repeat(Math.max(0, row.level - 2))
      currentMessage.content += indent + text + '\n'
    }

    if (row === stopRow) {
      break
    }

    row = row.nextInOutline
  }

  // Save final message
  if (currentMessage && currentMessage.content.trim()) {
    messages.push(currentMessage)
  }

  return messages
}

/**
 * Check if a row is a descendant of another row.
 * Compare by ID since Row objects may be different wrapper instances.
 */
function isDescendant(row: Row, ancestor: Row): boolean {
  const ancestorId = ancestor.id
  let parent = row.parent
  while (parent) {
    if (parent.id === ancestorId) {
      return true
    }
    parent = parent.parent
  }
  return false
}

/**
 * Find the next row after a subtree (skipping all descendants).
 * If the row has a next sibling, return it.
 * Otherwise, walk up and find an ancestor's next sibling.
 */
function nextRowAfterSubtree(row: Row): Row | undefined {
  let current: Row | undefined = row
  while (current) {
    if (current.nextSibling) {
      return current.nextSibling
    }
    current = current.parent
  }
  return undefined
}
