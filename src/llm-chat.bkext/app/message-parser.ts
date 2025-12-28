import { Row } from 'bike/app'
import { Message } from './providers/types'

/**
 * Parse messages from outline rows up to (and including) the stop row.
 * Markers like <user>, <system>, <assistant> at level 1 start new messages.
 */
export function parseMessages(root: Row, stopRow: Row): Message[] {
  const messages: Message[] = []
  let currentMessage: Message | null = null
  let row: Row | undefined = root.firstChild

  while (row) {
    const text = row.text.string
    const trimmedText = text.trim()

    // Check for role markers at level 1 (root children)
    if (row.level === 1) {
      const marker = trimmedText.toLowerCase()
      if (marker === '<user>' || marker === '<system>' || marker === '<assistant>') {
        // Save previous message if it has content
        if (currentMessage && currentMessage.content.trim()) {
          messages.push(currentMessage)
        }

        // Start new message
        const role = marker.slice(1, -1) as 'user' | 'assistant' | 'system'
        currentMessage = { role, content: '' }

        // Check if we should stop after this marker
        if (row === stopRow) {
          break
        }

        row = row.nextInOutline
        continue
      }
    }

    // Accumulate content for current message
    if (currentMessage) {
      // Preserve indentation relative to marker level
      const indent = '  '.repeat(Math.max(0, row.level - 2))
      currentMessage.content += indent + text + '\n'
    }

    // Stop if we've reached the stop row
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
