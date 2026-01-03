import type { Document, Outline, Row, Disposable } from 'bike/app'

const SYNC_DELAY_MS = 1000
const INLINE_ID_ATTR = 'data-inline-id'
const BACKGROUND_SLICE_ROWS = 200

type SyncTimer = ReturnType<typeof setTimeout>

type DocInfo = {
  document: Document
  outline: Outline
  displayName: string
}

type InlineLink = {
  heading: Row
  hostDoc: Document
  hostOutline: Outline
  targetDoc: DocInfo
}

type InlineHeading = {
  heading: Row
  hostDoc: Document
  hostOutline: Outline
  targetName: string
}

type InlineInfo = {
  link: InlineLink
  inlineSig: string
  prevInlineSig?: string
  inlineChanged: boolean
  needsInlineIds: boolean
}

class YieldController {
  private rowCount = 0

  async maybeYield(): Promise<void> {
    this.rowCount += 1
    if (this.rowCount < BACKGROUND_SLICE_ROWS) return
    this.rowCount = 0
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

export class InlineDocumentSync {
  private docOutlines = new Map<Document, Outline>()
  private outlineObservers = new Map<Outline, { observer: Disposable; doc: Document }>()
  private lastDocSignatures = new Map<Document, string>()
  private lastInlineSignatures = new Map<Document, Map<string, string>>()
  private lastChangedDocument?: Document
  private syncTimer?: SyncTimer
  private isSyncing = false
  private resyncRequested = false
  private applying = 0
  private disposed = false

  start(): void {
    this.scheduleSync()
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.outlineObservers.values()) {
      entry.observer.dispose()
    }
    this.outlineObservers.clear()
    this.lastDocSignatures.clear()
    this.lastInlineSignatures.clear()
    if (this.syncTimer !== undefined) {
      clearTimeout(this.syncTimer)
      this.syncTimer = undefined
    }
  }

  scheduleSync(): void {
    if (this.disposed) return
    if (this.isSyncing) {
      this.resyncRequested = true
      return
    }
    if (this.syncTimer !== undefined) return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      void this.syncAll()
    }, SYNC_DELAY_MS)
  }

  observeOutline(outline: Outline, doc: Document): void {
    const existing = this.outlineObservers.get(outline)
    if (existing && existing.doc === doc) return
    existing?.observer.dispose()
    const observer = outline.streamQuery('/body', () => {
      if (this.applying > 0) return
      this.lastChangedDocument = doc
      this.scheduleSync()
    })
    this.outlineObservers.set(outline, { observer, doc })
  }

  private async syncAll(): Promise<void> {
    if (this.isSyncing) {
      this.resyncRequested = true
      return
    }
    this.isSyncing = true
    const yieldController = new YieldController()
    try {
      const docInfos = this.collectDocumentInfos()
      const outlineDocs = new Map<Outline, Document>(docInfos.map((info) => [info.outline, info.document]))
      this.updateOutlineObservers(outlineDocs)

      const docsByName = indexDocumentsByName(docInfos)
      const { links, missing } = await collectInlineHeadings(docInfos, docsByName, yieldController)

      const prevDocSignatures = this.lastDocSignatures
      const prevInlineSignatures = this.lastInlineSignatures

      this.removeMissingInlineChildren(missing)
      if (links.length === 0) {
        this.lastDocSignatures.clear()
        this.lastInlineSignatures.clear()
        return
      }

      const linksByTarget = new Map<Document, InlineLink[]>()
      for (const link of links) {
        const targetDoc = link.targetDoc.document
        const bucket = linksByTarget.get(targetDoc)
        if (bucket) {
          bucket.push(link)
        } else {
          linksByTarget.set(targetDoc, [link])
        }
        await yieldController.maybeYield()
      }

      const initialDocSignatures = await collectDocSignatures(docInfos, yieldController)
      const initialInlineSignatures = await collectInlineSignatures(links, yieldController)

      for (const [targetDoc, linkGroup] of linksByTarget) {
        let docSig = initialDocSignatures.get(targetDoc)
        if (docSig === undefined) continue

        const prevDocSig = prevDocSignatures.get(targetDoc)
        const docChanged = prevDocSig !== undefined && docSig !== prevDocSig

        const inlineInfos: InlineInfo[] = linkGroup.map((link) => {
          const inlineSig = initialInlineSignatures.get(link.hostDoc)?.get(link.heading.id) ?? ''
          const prevInlineSig = prevInlineSignatures.get(link.hostDoc)?.get(link.heading.id)
          const inlineChanged = prevInlineSig !== undefined && inlineSig !== prevInlineSig
          const needsInlineIds = hasMissingInlineIds(link.heading)
          return { link, inlineSig, prevInlineSig, inlineChanged, needsInlineIds }
        })
        const inlineChangedInfos = inlineInfos.filter((info) => info.inlineChanged)

        let source: 'doc' | 'inline' | null = null
        let inlineSource: InlineInfo | undefined

        if (docChanged) {
          if (inlineChangedInfos.length > 0) {
            const preferredInline = pickInlineSource(inlineChangedInfos, this.lastChangedDocument)
            if (this.lastChangedDocument && preferredInline.link.hostDoc === this.lastChangedDocument) {
              source = 'inline'
              inlineSource = preferredInline
            } else {
              source = 'doc'
            }
          } else {
            source = 'doc'
          }
        } else if (inlineChangedInfos.length > 0) {
          source = 'inline'
          inlineSource = pickInlineSource(inlineChangedInfos, this.lastChangedDocument)
        } else if (inlineInfos.some((info) => info.inlineSig !== docSig || info.needsInlineIds)) {
          source = 'doc'
        }

        if (source === 'inline' && inlineSource) {
          const targetOutline = inlineSource.link.targetDoc.outline
          this.syncDocFromInline(
            targetOutline.root,
            inlineSource.link.heading.children,
            inlineSource.link.targetDoc.displayName,
            inlineSource.link.hostOutline
          )
          docSig = await serializeRows(targetOutline.root.children, { ignoreInlineId: true }, yieldController)
        }

        const docRows = linkGroup[0].targetDoc.outline.root.children
        for (const info of inlineInfos) {
          if (info.inlineSig !== docSig) {
            this.syncInlineFromDoc(info.link.heading, docRows, info.link.targetDoc.displayName)
          }
        }
        await yieldController.maybeYield()
      }

      const finalDocSignatures = await collectDocSignatures(docInfos, yieldController)
      const finalInlineSignatures = await collectInlineSignatures(links, yieldController)

      this.lastDocSignatures = finalDocSignatures
      this.lastInlineSignatures = finalInlineSignatures
    } catch (error) {
      console.error('Inlining: Sync failed', error)
    } finally {
      this.isSyncing = false
      if (this.resyncRequested && !this.disposed) {
        this.resyncRequested = false
        this.scheduleSync()
      }
    }
  }

  private updateOutlineObservers(outlineDocs: Map<Outline, Document>): void {
    for (const [outline, doc] of outlineDocs) {
      this.observeOutline(outline, doc)
    }
    for (const [outline, observer] of this.outlineObservers) {
      if (!outlineDocs.has(outline)) {
        observer.observer.dispose()
        this.outlineObservers.delete(outline)
      }
    }
  }

  private syncInlineFromDoc(parent: Row, sourceRows: Row[], label: string): void {
    const outline = parent.outline
    const context: DocToInlineContext = {
      inlineMap: mapInlineRowsById(parent),
      matched: new Set<Row>(),
      desiredChildren: new Map<Row, Row[]>()
    }
    this.withApplying(() => {
      outline.transaction({ label: `Inline ${label}` }, () => {
        syncDocToInlineRows(sourceRows, parent, context)
        removeExtraChildren(outline, context.desiredChildren)
      })
    })
  }

  private syncDocFromInline(parent: Row, sourceRows: Row[], label: string, inlineOutline: Outline): void {
    const outline = parent.outline
    const context: InlineToDocContext = {
      matched: new Set<Row>(),
      desiredChildren: new Map<Row, Row[]>(),
      inlineUpdates: new Map<Row, string>(),
      docMap: mapRowsById(parent)
    }
    this.withApplying(() => {
      outline.transaction({ label: `Inline ${label}` }, () => {
        syncInlineToDocRows(sourceRows, parent, context)
        removeExtraChildren(outline, context.desiredChildren)
      })
      if (context.inlineUpdates.size > 0) {
        inlineOutline.transaction({ label: `Inline ${label}` }, () => {
          for (const [row, id] of context.inlineUpdates) {
            setInlineId(row, id)
          }
        })
      }
    })
  }

  private withApplying(action: () => void): void {
    this.applying += 1
    try {
      action()
    } finally {
      this.applying -= 1
    }
  }

  private removeMissingInlineChildren(missing: InlineHeading[]): void {
    if (missing.length === 0) return
    this.withApplying(() => {
      const outlines = new Map<Outline, Row[]>()
      for (const entry of missing) {
        if (entry.heading.children.length === 0) continue
        const bucket = outlines.get(entry.hostOutline)
        if (bucket) {
          bucket.push(...entry.heading.children)
        } else {
          outlines.set(entry.hostOutline, entry.heading.children.slice())
        }
      }

      for (const [outline, rows] of outlines) {
        if (rows.length === 0) continue
        outline.transaction({ label: 'Inline cleanup' }, () => {
          outline.removeRows(rows)
        })
      }
    })
  }

  private collectDocumentInfos(): DocInfo[] {
    this.refreshDocumentCache()
    const infos: DocInfo[] = []
    for (const doc of bike.documents) {
      const outline = this.docOutlines.get(doc)
      if (!outline) continue
      infos.push({
        document: doc,
        outline,
        displayName: doc.displayName
      })
    }
    return infos
  }

  private refreshDocumentCache(): void {
    const openDocs = new Set<Document>(bike.documents)
    for (const doc of this.docOutlines.keys()) {
      if (!openDocs.has(doc)) {
        this.docOutlines.delete(doc)
      }
    }

    for (const doc of bike.documents) {
      const window = doc.frontmostWindow
      const editor = window?.currentOutlineEditor
      if (editor) {
        this.docOutlines.set(doc, editor.outline)
      }
    }

    const frontmostDoc = bike.frontmostDocument
    const frontmostOutline = bike.frontmostOutlineEditor?.outline
    if (frontmostDoc && frontmostOutline) {
      this.docOutlines.set(frontmostDoc, frontmostOutline)
    }
  }
}

type DocToInlineContext = {
  inlineMap: Map<string, Row>
  matched: Set<Row>
  desiredChildren: Map<Row, Row[]>
}

type InlineToDocContext = {
  matched: Set<Row>
  desiredChildren: Map<Row, Row[]>
  inlineUpdates: Map<Row, string>
  docMap: Map<string, Row>
}


function indexDocumentsByName(docInfos: DocInfo[]): Map<string, DocInfo> {
  const map = new Map<string, DocInfo>()
  for (const info of docInfos) {
    const name = info.displayName.trim()
    if (!name) continue
    if (!map.has(name)) {
      map.set(name, info)
    }
  }
  return map
}

async function collectInlineHeadings(
  docInfos: DocInfo[],
  docsByName: Map<string, DocInfo>,
  yieldController: YieldController
): Promise<{ links: InlineLink[]; missing: InlineHeading[] }> {
  const links: InlineLink[] = []
  const missing: InlineHeading[] = []

  for (const info of docInfos) {
    let row = info.outline.root.firstChild
    while (row) {
      const targetName = getInlineTargetName(row)
      if (targetName) {
        const target = docsByName.get(targetName)
        if (target && target.document !== info.document) {
          links.push({
            heading: row,
            hostDoc: info.document,
            hostOutline: info.outline,
            targetDoc: target
          })
        } else {
          missing.push({
            heading: row,
            hostDoc: info.document,
            hostOutline: info.outline,
            targetName
          })
        }
        row = nextRowAfterSubtree(row)
        await yieldController.maybeYield()
        continue
      }
      row = row.nextInOutline
      await yieldController.maybeYield()
    }
  }

  return { links, missing }
}

function pickInlineSource(inlineChanged: InlineInfo[], lastChangedDocument?: Document): InlineInfo {
  if (lastChangedDocument) {
    const match = inlineChanged.find((info) => info.link.hostDoc === lastChangedDocument)
    if (match) return match
  }
  return inlineChanged[0]
}

async function collectDocSignatures(
  docInfos: DocInfo[],
  yieldController: YieldController
): Promise<Map<Document, string>> {
  const signatures = new Map<Document, string>()
  for (const info of docInfos) {
    const signature = await serializeRows(info.outline.root.children, { ignoreInlineId: true }, yieldController)
    signatures.set(info.document, signature)
  }
  return signatures
}

async function collectInlineSignatures(
  links: InlineLink[],
  yieldController: YieldController
): Promise<Map<Document, Map<string, string>>> {
  const signatures = new Map<Document, Map<string, string>>()
  for (const link of links) {
    const inlineSig = await serializeRows(link.heading.children, { ignoreInlineId: true }, yieldController)
    let inlineMap = signatures.get(link.hostDoc)
    if (!inlineMap) {
      inlineMap = new Map()
      signatures.set(link.hostDoc, inlineMap)
    }
    inlineMap.set(link.heading.id, inlineSig)
  }
  return signatures
}

type SerializeOptions = {
  ignoreInlineId?: boolean
}

async function serializeRows(
  rows: Row[],
  options: SerializeOptions,
  yieldController: YieldController
): Promise<string> {
  const snapshots: RowSnapshot[] = []
  for (const row of rows) {
    snapshots.push(await serializeRow(row, options, yieldController))
  }
  return JSON.stringify(snapshots)
}

type RowSnapshot = {
  type: string
  text: string
  attributes: [string, string][]
  children: RowSnapshot[]
}

async function serializeRow(row: Row, options: SerializeOptions, yieldController: YieldController): Promise<RowSnapshot> {
  await yieldController.maybeYield()
  return {
    type: row.type,
    text: serializeText(row),
    attributes: serializeAttributes(row.attributes, options),
    children: await serializeRowChildren(row.children, options, yieldController)
  }
}

async function serializeRowChildren(
  rows: Row[],
  options: SerializeOptions,
  yieldController: YieldController
): Promise<RowSnapshot[]> {
  const snapshots: RowSnapshot[] = []
  for (const row of rows) {
    snapshots.push(await serializeRow(row, options, yieldController))
  }
  return snapshots
}

function serializeAttributes(
  attributes: Record<string, string>,
  options: SerializeOptions
): [string, string][] {
  const keys = Object.keys(attributes)
    .filter((key) => !(options.ignoreInlineId && key === INLINE_ID_ATTR))
    .sort()
  return keys.map((key) => [key, attributes[key]])
}

function serializeText(row: Row): string {
  if (row.text.string === '') return ''
  return row.text.toHTML()
}

function getInlineTargetName(row: Row): string | null {
  const trimmed = row.text.string.trim()
  const match = trimmed.match(/^<inline:\s*(.+?)\s*>$/i)
  if (!match) return null
  const name = match[1].trim()
  return name ? name : null
}

function getInlineId(row: Row): string | undefined {
  const value = row.attributes[INLINE_ID_ATTR]
  return value && value.length > 0 ? value : undefined
}

function hasMissingInlineIds(parent: Row): boolean {
  for (const row of collectSubtreeRows(parent)) {
    if (!getInlineId(row)) {
      return true
    }
  }
  return false
}

function setInlineId(row: Row, id: string): void {
  const value = String(id)
  if (row.attributes[INLINE_ID_ATTR] !== value) {
    row.setAttribute(INLINE_ID_ATTR, value)
  }
}

function queueInlineIdUpdate(updates: Map<Row, string>, row: Row, id: string): void {
  const value = String(id)
  if (row.attributes[INLINE_ID_ATTR] !== value) {
    updates.set(row, value)
  }
}

function mapInlineRowsById(root: Row): Map<string, Row> {
  const map = new Map<string, Row>()
  for (const row of collectSubtreeRows(root)) {
    const inlineId = getInlineId(row)
    if (inlineId && !map.has(inlineId)) {
      map.set(inlineId, row)
    }
  }
  return map
}

function mapRowsById(root: Row): Map<string, Row> {
  const map = new Map<string, Row>()
  for (const row of collectSubtreeRows(root)) {
    const id = String(row.id)
    if (!map.has(id)) {
      map.set(id, row)
    }
  }
  return map
}

function syncDocToInlineRows(sourceRows: Row[], targetParent: Row, context: DocToInlineContext): void {
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
      context.inlineMap.set(String(sourceRow.id), targetRow)
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

function syncInlineToDocRows(sourceRows: Row[], targetParent: Row, context: InlineToDocContext): void {
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
      context.docMap.set(String(targetRow.id), targetRow)
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

function removeExtraChildren(outline: Outline, desiredChildren: Map<Row, Row[]>): void {
  for (const [parent, desired] of desiredChildren) {
    const desiredIds = new Set(desired.map((row) => String(row.id)))
    const removable = parent.children.filter((child) => !desiredIds.has(String(child.id)))
    if (removable.length > 0) {
      outline.removeRows(removable)
    }
  }
}

function orderMatchesDocToInline(parent: Row, sourceRows: Row[]): boolean {
  const children = parent.children
  if (children.length !== sourceRows.length) return false
  for (let index = 0; index < sourceRows.length; index += 1) {
    const desiredId = String(sourceRows[index].id)
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
    if (String(children[index].id) !== desiredId) return false
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
  inlineId?: string
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
    inlineId: String(sourceRow.id)
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
      [INLINE_ID_ATTR]: String(sourceRow.id)
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
