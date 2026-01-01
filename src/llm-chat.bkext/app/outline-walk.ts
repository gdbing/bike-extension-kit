import type { Row } from 'bike/app'

export function isDescendant(row: Row, ancestor: Row): boolean {
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

export function nextRowAfterSubtree(row: Row): Row | undefined {
  let current: Row | undefined = row
  while (current) {
    if (current.nextSibling) {
      return current.nextSibling
    }
    current = current.parent
  }
  return undefined
}
