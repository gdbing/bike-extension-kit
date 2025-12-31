import type { Row } from 'bike/app'
import { Message } from './providers/types'

export type InlineResolver = {
  resolveByURL: (url: string) => { root: Row; id: string } | null
  resolveByDisplayName: (name: string) => { root: Row; id: string } | null
}

type ParseOptions = {
  inlineResolver?: InlineResolver
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

  const closeTag = (tag: { name: string; indent: number }) => {
    appendLine(tag.indent, `</${tag.name}>`)
  }

  const closeTagsUntilRow = (nextRow?: Row) => {
    while (tagStack.length) {
      const top = tagStack[tagStack.length - 1]
      if (nextRow && isDescendant(nextRow, top.row)) {
        break
      }
      closeTag(top)
      tagStack.pop()
    }
  }

  const closeAllTags = () => {
    closeTagsUntilRow(undefined)
  }

  while (row) {
    if (currentMessage && markerRow) {
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
        } else if (markerName === 'model' || markerName === 'config') {
          currentMessage = null
          markerRow = null
          row = nextRowAfterSubtree(row)
          continue
        } else {
          role = 'assistant'
        }

        currentMessage = { role, content: '' }
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
        appendLine(effectiveIndent, text)
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
    const resolved = resolveInlineReference(reference, options.inlineResolver)
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
    const inlineMessages = parseMessagesInternal(resolved.root, stopRow, options, nextStack)
    messages.push(...inlineMessages)
  }

  return messages
}

function resolveInlineReference(
  reference: InlineReference,
  resolver: InlineResolver
): { root: Row; id: string } | null {
  if (reference.link) {
    const byLink = resolver.resolveByURL(reference.link)
    if (byLink) return byLink
  }

  if (!reference.text) return null

  if (reference.text.startsWith('file:///')) {
    return resolver.resolveByURL(reference.text)
  }

  return resolver.resolveByDisplayName(reference.text)
}

type InlineReference = {
  text?: string
  link?: string
}

function collectInlineReferences(markerRow: Row): InlineReference[] {
  const references: InlineReference[] = []
  let row = markerRow.nextInOutline

  while (row && isDescendant(row, markerRow)) {
    if (row.type === 'note') {
      row = nextRowAfterSubtree(row)
      continue
    }

    const text = row.text.string.trim()
    const link = getFirstLinkURL(row.text)
    if (text || link) {
      references.push({ text: text || undefined, link: link || undefined })
    }

    row = row.nextInOutline
  }

  return references
}

function getFirstLinkURL(text: { string: string; attributeAt?: (name: string, index: number) => string | null }): string | null {
  if (typeof text.attributeAt !== 'function') return null
  const length = text.string.length
  for (let index = 0; index < length; index += 1) {
    const value = text.attributeAt('a', index)
    if (value) return value
  }
  return null
}

function getLastRow(root: Row): Row | undefined {
  const lastLeaf = (root as { lastLeaf?: Row }).lastLeaf
  if (lastLeaf) return lastLeaf
  let current = root.firstChild
  if (!current) return undefined
  while (current.nextInOutline) {
    current = current.nextInOutline
  }
  return current
}

/**
 * Check if two rows are the same row.
 * Compare by ID since Row objects may be different wrapper instances.
 */
function isSameRow(a: Row, b: Row): boolean {
  return a.id === b.id
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
