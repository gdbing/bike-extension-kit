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

function applyMarkerAttribute(row: Row, value: string | null): void {
  const currentValue = row.attributes[MARKER_ATTRIBUTE]
  if (value) {
    if (currentValue !== value) {
      row.setAttribute(MARKER_ATTRIBUTE, value)
    }
    return
  }

  if (currentValue !== undefined) {
    row.removeAttribute(MARKER_ATTRIBUTE)
  }
}

export function clearMarkerAttribute(row: Row): void {
  applyMarkerAttribute(row, null)
}

function isRootLevelRow(row: Row): boolean {
  const parent = row.parent
  return Boolean(parent && parent.level === 0)
}

export function updateMarkerAttribute(row: Row): void {
  if (!isRootLevelRow(row) || row.type === 'note') {
    clearMarkerAttribute(row)
    return
  }

  const value = resolveMarkerAttributeValue(row.text.string)
  applyMarkerAttribute(row, value)
}

export function updateMarkerAttributes(root: Row): void {
  for (const row of root.children) {
    updateMarkerAttribute(row)
  }
}
