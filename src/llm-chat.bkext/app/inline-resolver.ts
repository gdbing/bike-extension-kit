import type { Row } from 'bike/app'
import { hasUrlScheme, isFileUrl, resolveRelativeFileUrl } from './inline-path'
import { isDescendant, nextRowAfterSubtree } from './outline-walk'

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
  resolver: InlineResolver,
  baseFileUrl?: string | null
): { root: Row; id: string } | null {
  const fileUrlCandidates = getFileUrlCandidates(reference, baseFileUrl ?? null)
  for (const url of fileUrlCandidates) {
    const byUrl = resolver.resolveByURL(url)
    if (byUrl) return byUrl
  }

  if (!reference.text) return null
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

function getFileUrlCandidates(reference: InlineReference, baseFileUrl: string | null): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  const consider = (value?: string) => {
    if (!value) return
    const trimmed = value.trim()
    if (!trimmed) return
    let resolved: string | null = null
    if (isFileUrl(trimmed)) {
      resolved = trimmed
    } else if (!hasUrlScheme(trimmed) && baseFileUrl) {
      resolved = resolveRelativeFileUrl(baseFileUrl, trimmed)
    }
    if (!resolved || seen.has(resolved)) return
    seen.add(resolved)
    candidates.push(resolved)
  }

  consider(reference.link)
  consider(reference.text)

  return candidates
}

function getFirstLinkURL(text: {
  string: string
  attributeAt?: (name: string, index: number, affinity?: 'upstream' | 'downstream') => string | null
}): string | null {
  if (typeof text.attributeAt !== 'function') return null
  const length = text.string.length
  for (let index = 0; index < length; index += 1) {
    const value = text.attributeAt('a', index, 'downstream')
    if (value) return value
  }
  return null
}
