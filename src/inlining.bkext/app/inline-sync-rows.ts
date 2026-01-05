import type { Outline, Row, RowId } from 'bike/app'
import { INLINE_ID_ATTR } from './inline-constants'
import { serializeText } from './inline-text'

export type DocToInlineContext = {
  inlineMap: Map<RowId, Row>
  matched: Set<Row>
  desiredChildren: Map<Row, Row[]>
}

export type InlineToDocContext = {
  matched: Set<Row>
  desiredChildren: Map<Row, Row[]>
  inlineUpdates: Map<Row, RowId>
  docMap: Map<RowId, Row>
}

function getInlineId(row: Row): RowId | undefined {
  const value = row.attributes[INLINE_ID_ATTR]
  return value && value.length > 0 ? value : undefined
}

export function hasMissingInlineIds(parent: Row): boolean {
  for (const row of collectSubtreeRows(parent)) {
    if (!getInlineId(row)) {
      return true
    }
  }
  return false
}

export function setInlineId(row: Row, id: RowId): void {
  const value = String(id)
  if (row.attributes[INLINE_ID_ATTR] !== value) {
    row.setAttribute(INLINE_ID_ATTR, value)
  }
}

function queueInlineIdUpdate(updates: Map<Row, RowId>, row: Row, id: RowId): void {
  const value = String(id)
  if (row.attributes[INLINE_ID_ATTR] !== value) {
    updates.set(row, value)
  }
}

export function mapInlineRowsById(root: Row): Map<RowId, Row> {
  const map = new Map<RowId, Row>()
  for (const row of collectSubtreeRows(root)) {
    const inlineId = getInlineId(row)
    if (inlineId && !map.has(inlineId)) {
      map.set(inlineId, row)
    }
  }
  return map
}

export function mapRowsById(root: Row): Map<RowId, Row> {
  const map = new Map<RowId, Row>()
  for (const row of collectSubtreeRows(root)) {
    const id = row.id
    if (!map.has(id)) {
      map.set(id, row)
    }
  }
  return map
}

export function syncDocToInlineRows(sourceRows: Row[], targetParent: Row, context: DocToInlineContext): void {
  const outline = targetParent.outline
  const desired: Row[] = []
  const skipOrdering = orderMatchesDocToInline(targetParent, sourceRows)
  let prevDesired: Row | undefined

  for (const sourceRow of sourceRows) {
    let targetRow = context.inlineMap.get(sourceRow.id)
    if (targetRow && (context.matched.has(targetRow) || isAncestorOf(targetRow, targetParent))) {
      targetRow = undefined
    }
    if (!targetRow) {
      const [inserted] = outline.insertRows([createRowSourceFromDoc(sourceRow)], targetParent)
      targetRow = inserted
      context.inlineMap.set(sourceRow.id, targetRow)
    }
    context.matched.add(targetRow)
    if (!skipOrdering) {
      ensureRowOrder(outline, targetParent, targetRow, prevDesired)
    }
    syncRowContentFromDoc(sourceRow, targetRow)
    syncDocToInlineRows(sourceRow.children, targetRow, context)
    desired.push(targetRow)
    prevDesired = targetRow
  }

  context.desiredChildren.set(targetParent, desired)
}

export function syncInlineToDocRows(sourceRows: Row[], targetParent: Row, context: InlineToDocContext): void {
  const outline = targetParent.outline
  const desired: Row[] = []
  const skipOrdering = orderMatchesInlineToDoc(targetParent, sourceRows)
  let prevDesired: Row | undefined

  for (const sourceRow of sourceRows) {
    const inlineId = getInlineId(sourceRow)
    let targetRow = inlineId ? context.docMap.get(inlineId) : undefined
    if (targetRow && (context.matched.has(targetRow) || isAncestorOf(targetRow, targetParent))) {
      targetRow = undefined
    }
    if (!targetRow) {
      const [inserted] = outline.insertRows([createRowSourceFromInline(sourceRow)], targetParent)
      targetRow = inserted
      context.docMap.set(targetRow.id, targetRow)
      if (inlineId && !context.docMap.has(inlineId)) {
        context.docMap.set(inlineId, targetRow)
      }
    }
    queueInlineIdUpdate(context.inlineUpdates, sourceRow, targetRow.id)
    context.matched.add(targetRow)
    if (!skipOrdering) {
      ensureRowOrder(outline, targetParent, targetRow, prevDesired)
    }
    syncRowContentFromInline(sourceRow, targetRow)
    syncInlineToDocRows(sourceRow.children, targetRow, context)
    desired.push(targetRow)
    prevDesired = targetRow
  }

  context.desiredChildren.set(targetParent, desired)
}

export function removeExtraChildren(outline: Outline, desiredChildren: Map<Row, Row[]>): void {
  for (const [parent, desired] of desiredChildren) {
    const desiredIds = new Set(desired.map((row) => row.id))
    const removable = parent.children.filter((child) => !desiredIds.has(child.id))
    if (removable.length > 0) {
      outline.removeRows(removable)
    }
  }
}

function orderMatchesDocToInline(parent: Row, sourceRows: Row[]): boolean {
  const children = parent.children
  if (children.length !== sourceRows.length) return false
  for (let index = 0; index < sourceRows.length; index += 1) {
    const desiredId = sourceRows[index].id
    const actualId = getInlineId(children[index])
    if (!actualId || actualId !== desiredId) return false
  }
  return true
}

function orderMatchesInlineToDoc(parent: Row, sourceRows: Row[]): boolean {
  const children = parent.children
  if (children.length !== sourceRows.length) return false
  for (let index = 0; index < sourceRows.length; index += 1) {
    const desiredId = getInlineId(sourceRows[index])
    if (!desiredId) return false
    if (children[index].id !== desiredId) return false
  }
  return true
}

function ensureRowOrder(
  outline: Outline,
  parent: Row,
  row: Row,
  prevDesired: Row | undefined
): void {
  if (isAncestorOf(row, parent)) return
  if (row.parent !== parent) {
    const before = prevDesired ? prevDesired.nextSibling : parent.firstChild
    outline.moveRows([row], parent, before)
    return
  }
  if (prevDesired) {
    if (row.prevSibling !== prevDesired) {
      const before = prevDesired.nextSibling
      outline.moveRows([row], parent, before)
      return
    }
  } else if (row.prevSibling !== undefined) {
    const before = parent.firstChild
    outline.moveRows([row], parent, before)
    return
  }
}

function collectSubtreeRows(root: Row): Row[] {
  const rows: Row[] = []
  const stack = root.children.slice().reverse()
  while (stack.length > 0) {
    const row = stack.pop()
    if (!row) break
    rows.push(row)
    for (let index = row.children.length - 1; index >= 0; index -= 1) {
      stack.push(row.children[index])
    }
  }
  return rows
}

function isAncestorOf(candidate: Row, other: Row): boolean {
  let current = other.parent
  while (current) {
    if (current === candidate) return true
    current = current.parent
  }
  return false
}

type RowAttributeOptions = {
  includeInlineId?: boolean
  ignoreInlineId?: boolean
  inlineId?: RowId
}

function syncRowContentFromDoc(sourceRow: Row, targetRow: Row): void {
  if (targetRow.type !== sourceRow.type) {
    targetRow.type = sourceRow.type
  }
  if (serializeText(targetRow) !== serializeText(sourceRow)) {
    targetRow.text = sourceRow.text
  }
  syncRowAttributes(sourceRow, targetRow, {
    includeInlineId: true,
    inlineId: sourceRow.id
  })
}

function syncRowContentFromInline(sourceRow: Row, targetRow: Row): void {
  if (targetRow.type !== sourceRow.type) {
    targetRow.type = sourceRow.type
  }
  if (serializeText(targetRow) !== serializeText(sourceRow)) {
    targetRow.text = sourceRow.text
  }
  syncRowAttributes(sourceRow, targetRow, { ignoreInlineId: true })
}

function syncRowAttributes(sourceRow: Row, targetRow: Row, options: RowAttributeOptions): void {
  const desired = new Map<string, string>()
  for (const [key, value] of Object.entries(sourceRow.attributes)) {
    if (options.ignoreInlineId && key === INLINE_ID_ATTR) continue
    desired.set(key, value)
  }

  if (options.includeInlineId && options.inlineId) {
    desired.set(INLINE_ID_ATTR, options.inlineId)
  }

  for (const key of Object.keys(targetRow.attributes)) {
    if (!desired.has(key)) {
      targetRow.removeAttribute(key)
    }
  }
  for (const [key, value] of desired) {
    if (targetRow.attributes[key] !== value) {
      targetRow.setAttribute(key, value)
    }
  }
}

function createRowSourceFromDoc(sourceRow: Row): {
  type: string
  text: Row['text']
  attributes: Record<string, string>
} {
  return {
    type: sourceRow.type,
    text: sourceRow.text,
    attributes: {
      ...sourceRow.attributes,
      [INLINE_ID_ATTR]: sourceRow.id
    }
  }
}

function createRowSourceFromInline(sourceRow: Row): {
  type: string
  text: Row['text']
  attributes: Record<string, string>
} {
  const attributes = { ...sourceRow.attributes }
  delete attributes[INLINE_ID_ATTR]
  return {
    type: sourceRow.type,
    text: sourceRow.text,
    attributes
  }
}
