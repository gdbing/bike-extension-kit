import type { Row } from 'bike/app'

export const MARKER_ATTRIBUTE = 'llm-marker'

const NON_MESSAGE_MARKERS = new Set(['inline', 'cache', 'model', 'config'])

function resolveMarkerAttributeValue(markerText: string): string | null {
  const normalized = markerText.trim().toLowerCase()
  const match = normalized.match(/^<([^>]+)>$/)
  if (!match) return null

  const markerName = match[1]
  if (markerName === 'user' || markerName === 'system' || markerName === 'error') {
    return markerName
  }
  if (NON_MESSAGE_MARKERS.has(markerName)) {
    return markerName
  }
  return 'assistant'
}

export function setMarkerAttribute(row: Row, markerText: string): void {
  const value = resolveMarkerAttributeValue(markerText)
  if (value) {
    row.setAttribute(MARKER_ATTRIBUTE, value)
  } else {
    clearMarkerAttribute(row)
  }
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

    const value = resolveMarkerAttributeValue(row.text.string)
    if (value) {
      row.setAttribute(MARKER_ATTRIBUTE, value)
    } else {
      clearMarkerAttribute(row)
    }
  }
}
