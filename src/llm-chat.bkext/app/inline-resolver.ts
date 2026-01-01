import type { Row } from 'bike/app'

export type InlineResolver = {
  resolveByURL: (url: string) => { root: Row; id: string } | null
  resolveByDisplayName: (name: string) => { root: Row; id: string } | null
}

type InlineReference = {
  text?: string
  link?: string
}

export function collectInlineReferences(markerRow: Row): InlineReference[] {
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

export function resolveInlineReference(
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

export function getLastRow(root: Row): Row | undefined {
  const lastLeaf = (root as { lastLeaf?: Row }).lastLeaf
  if (lastLeaf) return lastLeaf
  let current = root.firstChild
  if (!current) return undefined
  while (current.nextInOutline) {
    current = current.nextInOutline
  }
  return current
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
