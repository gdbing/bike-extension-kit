import type { Row } from 'bike/app'

export const MARKER_ATTRIBUTE = 'llm-marker'

export function setMarkerAttribute(row: Row, markerText: string): void {
  const normalized = markerText.trim().toLowerCase()
  const match = normalized.match(/^<([^>]+)>$/)
  const value = match ? match[1] : normalized
  row.setAttribute(MARKER_ATTRIBUTE, value)
}

export function clearMarkerAttribute(row: Row): void {
  row.removeAttribute(MARKER_ATTRIBUTE)
}

export function updateMarkerAttributes(root: Row): void {
  for (const row of root.children) {
    if (row.type === 'note') {
      clearMarkerAttribute(row)
      continue
    }

    const text = row.text.string.trim()
    const match = text.match(/^<([^>]+)>$/)
    if (match) {
      row.setAttribute(MARKER_ATTRIBUTE, match[1].toLowerCase())
    } else {
      clearMarkerAttribute(row)
    }
  }
}
