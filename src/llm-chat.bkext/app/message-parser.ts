import type { Row } from 'bike/app'
import { collectInlineReferences, getLastRow, InlineResolver, resolveInlineReference } from './inline-resolver'
import { isFileUrl } from './inline-path'
import { Message } from './providers/types'
import { isDescendant, nextRowAfterSubtree } from './outline-walk'
import { attributedTextToMarkdown } from './markdown'

type ParseOptions = {
  inlineResolver?: InlineResolver
  inlineBaseUrl?: string | null
}

/**
 * Parse messages from outline rows up to and including the message containing stopRow.
 *
 * - Markers must be at level 1 (root children) and match <name> pattern
 * - <user> → user role, <system> → system role
 * - Any other <name> marker (including <assistant>, model names) → assistant role
 * - <model> and <config> markers are ignored (used for settings only)
 * - Only content nested under a marker is included in that message
 * - Note-type rows are skipped (treated as comments)
 * - Tags are indented <name> rows inside a message; they emit open/close tags and de-indent their contents
 * - The entire message containing stopRow is included, not just content up to stopRow
 */
export function parseMessages(root: Row, stopRow: Row, options: ParseOptions = {}): Message[] {
  return parseMessagesInternal(root, stopRow, options, [])
}

function parseMessagesInternal(
  root: Row,
  stopRow: Row | undefined,
  options: ParseOptions,
  inlineStack: string[]
): Message[] {
  const messages: Message[] = []
  let currentMessage: Message | null = null
  let markerRow: Row | null = null
  let row: Row | undefined = root.firstChild
  const tagStack: { row: Row; name: string; indent: number }[] = []
  let pendingCacheTtl: '1h' | null = null
  let codeBlockIndent: number | null = null

  if (!stopRow) return messages

  // Walk stopRow up to the level-1 marker that contains it so the entire message is included
  let stopMarker: Row = stopRow
  while (stopMarker.level > 1 && stopMarker.parent) {
    stopMarker = stopMarker.parent
  }
  let reachedStopMarker = false

  const appendLine = (indent: number, text: string) => {
    if (!currentMessage) return
    currentMessage.content += '\t'.repeat(Math.max(0, indent)) + text + '\n'
  }

  const openCodeBlock = (indent: number) => {
    if (codeBlockIndent !== null) return
    appendLine(indent, '```')
    codeBlockIndent = indent
  }

  const closeCodeBlock = () => {
    if (codeBlockIndent === null) return
    appendLine(codeBlockIndent, '```')
    codeBlockIndent = null
  }

  const closeTag = (tag: { name: string; indent: number }) => {
    appendLine(tag.indent, `</${tag.name}>`)
  }

  const closeTagsUntilRow = (nextRow?: Row) => {
    while (tagStack.length) {
      const top = tagStack[tagStack.length - 1]
      if (nextRow && isDescendant(nextRow, top.row)) {
        break
      }
      if (codeBlockIndent !== null) {
        closeCodeBlock()
      }
      closeTag(top)
      tagStack.pop()
    }
  }

  const closeAllTags = () => {
    if (codeBlockIndent !== null) {
      closeCodeBlock()
    }
    closeTagsUntilRow(undefined)
  }

  const orderedIndexForRow = (target: Row): number => {
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

  const formatRowText = (row: Row): string => {
    const text = attributedTextToMarkdown(row.text)
    switch (row.type) {
      case 'heading':
        return `# ${text}`
      case 'quote':
        return `> ${text}`
      case 'unordered':
        return `- ${text}`
      case 'ordered': {
        const index = orderedIndexForRow(row)
        return `${index}. ${text}`
      }
      case 'task': {
        const isDone = typeof row.attributes?.done === 'string'
        return `${isDone ? '[x]' : '[ ]'} ${text}`
      }
      default:
        return text
    }
  }

  while (row) {
    if (currentMessage && markerRow) {
      if (codeBlockIndent !== null && row.type !== 'code') {
        closeCodeBlock()
      }
      closeTagsUntilRow(row)
    }

    // Skip note rows and all their descendants (treat as comments)
    if (row.type === 'note') {
      if (isSameRow(row, stopMarker) || isDescendant(stopMarker, row)) {
        break
      }
      row = nextRowAfterSubtree(row)
      continue
    }

    // Check for markers at level 1 (root children only)
    if (row.level === 1) {
      // If we've already processed stopMarker and hit a new level-1 row, we're done
      if (reachedStopMarker) {
        break
      }

      if (isSameRow(row, stopMarker)) {
        reachedStopMarker = true
      }

      const text = row.text.string.trim().toLowerCase()
      const markerMatch = text.match(/^<([^>]+)>$/)

      if (markerMatch) {
        closeAllTags()
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
        } else if (markerName === 'inline') {
          const inlineMessages = resolveInlineMessages(row, options, inlineStack)
          messages.push(...inlineMessages)
          currentMessage = null
          markerRow = null
          row = nextRowAfterSubtree(row)
          continue
        } else if (markerName === 'cache') {
          pendingCacheTtl = '1h'
          currentMessage = null
          markerRow = null
          row = nextRowAfterSubtree(row)
          continue
        } else if (markerName === 'model' || markerName === 'config') {
          currentMessage = null
          markerRow = null
          row = nextRowAfterSubtree(row)
          continue
        } else {
          role = 'assistant'
        }

        currentMessage = pendingCacheTtl
          ? { role, content: '', cacheControl: { type: 'ephemeral', ttl: pendingCacheTtl } }
          : { role, content: '' }
        pendingCacheTtl = null
        markerRow = row

        row = row.nextInOutline
        continue
      } else {
        // Level 1 non-marker row - finalize current message
        closeAllTags()
        if (currentMessage && currentMessage.content.trim()) {
          messages.push(currentMessage)
          currentMessage = null
          markerRow = null
        }

        row = row.nextInOutline
        continue
      }
    }

    // Accumulate content only if nested under the marker row
    if (currentMessage && markerRow && isDescendant(row, markerRow)) {
      const text = row.text.string
      const trimmed = text.trim()
      const tagMatch = trimmed.match(/^<([^>]+)>$/)
      const tagDepth = tagStack.length
      const baseIndent = Math.max(0, row.level - 2)
      const effectiveIndent = Math.max(0, baseIndent - tagDepth)

      if (tagMatch) {
        const tagName = tagMatch[1]
        appendLine(effectiveIndent, `<${tagName}>`)
        tagStack.push({ row, name: tagName, indent: effectiveIndent })
      } else {
        if (row.type === 'code') {
          openCodeBlock(effectiveIndent)
          appendLine(effectiveIndent, row.text.string)
        } else {
          if (codeBlockIndent !== null) {
            closeCodeBlock()
          }
          appendLine(effectiveIndent, formatRowText(row))
        }
      }
    }

    row = row.nextInOutline
  }

  closeAllTags()
  // Save final message
  if (currentMessage && currentMessage.content.trim()) {
    messages.push(currentMessage)
  }

  return messages
}

function resolveInlineMessages(
  markerRow: Row,
  options: ParseOptions,
  inlineStack: string[]
): Message[] {
  if (!options.inlineResolver) {
    throw new Error('Inline markers require a resolver to be configured.')
  }

  const references = collectInlineReferences(markerRow)
  const messages: Message[] = []

  for (const reference of references) {
    const resolved = resolveInlineReference(reference, options.inlineResolver, options.inlineBaseUrl)
    if (!resolved) {
      const label = reference.text || reference.link || 'inline document'
      throw new Error(
        `Unable to find ${label}. Inlined documents must be open in Bike.`
      )
    }

    if (inlineStack.includes(resolved.id)) {
      throw new Error(`Inline cycle detected for ${resolved.id}.`)
    }

    const stopRow = getLastRow(resolved.root)
    const nextStack = inlineStack.concat(resolved.id)
    const nextOptions: ParseOptions = {
      ...options,
      inlineBaseUrl: isFileUrl(resolved.id) ? resolved.id : null
    }
    const inlineMessages = parseMessagesInternal(resolved.root, stopRow, nextOptions, nextStack)
    messages.push(...inlineMessages)
  }

  return messages
}

/**
 * Check if two rows are the same row.
 * Compare by ID since Row objects may be different wrapper instances.
 */
function isSameRow(a: Row, b: Row): boolean {
  return a.id === b.id
}
