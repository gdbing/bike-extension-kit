import type { Document, Outline, Row, Disposable } from 'bike/app'

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
}

export class InlineDocumentSync {
  private docOutlines = new Map<Document, Outline>()
  private outlineObservers = new Map<Outline, { dispose: Disposable; doc: Document }>()
  private lastDocSignatures = new Map<Document, string>()
  private lastInlineSignatures = new Map<Document, Map<string, string>>()
  private lastChangedDocument?: Document
  private syncTimer?: number
  private isSyncing = false
  private resyncRequested = false
  private applying = 0

  start(): void {
    this.scheduleSync()
  }

  dispose(): void {
    for (const observer of this.outlineObservers.values()) {
      observer.dispose.dispose()
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
    if (this.syncTimer !== undefined) return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      this.syncAll()
    }, 50)
  }

  observeOutline(outline: Outline, doc: Document): void {
    const existing = this.outlineObservers.get(outline)
    if (existing && existing.doc === doc) return
    existing?.dispose.dispose()
    const observer = outline.streamQuery('/body', () => {
      if (this.applying > 0) return
      this.lastChangedDocument = doc
      this.scheduleSync()
    })
    this.outlineObservers.set(outline, { dispose: observer, doc })
  }

  private syncAll(): void {
    if (this.isSyncing) {
      this.resyncRequested = true
      return
    }
    this.isSyncing = true
    try {
      const docInfos = this.collectDocumentInfos()
      const outlineDocs = new Map<Outline, Document>(docInfos.map((info) => [info.outline, info.document]))
      this.updateOutlineObservers(outlineDocs)

      const docsByName = indexDocumentsByName(docInfos)
      const { links, missing } = collectInlineHeadings(docInfos, docsByName)

      const prevDocSignatures = this.lastDocSignatures
      const prevInlineSignatures = this.lastInlineSignatures

      this.removeMissingInlineChildren(missing)

      const linksByTarget = new Map<Document, InlineLink[]>()
      for (const link of links) {
        const targetDoc = link.targetDoc.document
        const bucket = linksByTarget.get(targetDoc)
        if (bucket) {
          bucket.push(link)
        } else {
          linksByTarget.set(targetDoc, [link])
        }
      }

      const initialDocSignatures = new Map<Document, string>()
      for (const info of docInfos) {
        initialDocSignatures.set(info.document, serializeRows(info.outline.root.children))
      }

      const initialInlineSignatures = new Map<Document, Map<string, string>>()
      for (const link of links) {
        const inlineSig = serializeRows(link.heading.children)
        let inlineMap = initialInlineSignatures.get(link.hostDoc)
        if (!inlineMap) {
          inlineMap = new Map()
          initialInlineSignatures.set(link.hostDoc, inlineMap)
        }
        inlineMap.set(link.heading.id, inlineSig)
      }

      for (const [targetDoc, linkGroup] of linksByTarget) {
        let docSig = initialDocSignatures.get(targetDoc)
        if (docSig === undefined) continue

        const prevDocSig = prevDocSignatures.get(targetDoc)
        const docChanged = prevDocSig !== undefined && docSig !== prevDocSig

        const inlineInfos: InlineInfo[] = linkGroup.map((link) => {
        const inlineSig = initialInlineSignatures.get(link.hostDoc)?.get(link.heading.id) ?? ''
        const prevInlineSig = prevInlineSignatures.get(link.hostDoc)?.get(link.heading.id)
        const inlineChanged = prevInlineSig !== undefined && inlineSig !== prevInlineSig
        return { link, inlineSig, prevInlineSig, inlineChanged }
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
        } else if (inlineInfos.some((info) => info.inlineSig !== docSig)) {
          source = 'doc'
        }

        if (source === 'inline' && inlineSource) {
          docSig = inlineSource.inlineSig
          const targetOutline = inlineSource.link.targetDoc.outline
          this.replaceChildren(targetOutline.root, inlineSource.link.heading.children, inlineSource.link.targetDoc.displayName)
        }

        const docRows = linkGroup[0].targetDoc.outline.root.children
        for (const info of inlineInfos) {
          if (info.inlineSig !== docSig) {
            this.replaceChildren(info.link.heading, docRows, info.link.targetDoc.displayName)
          }
        }
      }

      const finalDocSignatures = new Map<Document, string>()
      for (const info of docInfos) {
        finalDocSignatures.set(info.document, serializeRows(info.outline.root.children))
      }

      const finalInlineSignatures = new Map<Document, Map<string, string>>()
      for (const link of links) {
        const inlineSig = serializeRows(link.heading.children)
        let inlineMap = finalInlineSignatures.get(link.hostDoc)
        if (!inlineMap) {
          inlineMap = new Map()
          finalInlineSignatures.set(link.hostDoc, inlineMap)
        }
        inlineMap.set(link.heading.id, inlineSig)
      }

      this.lastDocSignatures = finalDocSignatures
      this.lastInlineSignatures = finalInlineSignatures
    } finally {
      this.isSyncing = false
      if (this.resyncRequested) {
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
        observer.dispose.dispose()
        this.outlineObservers.delete(outline)
      }
    }
  }

  private replaceChildren(parent: Row, sourceRows: Row[], label: string): void {
    this.withApplying(() => {
      const outline = parent.outline
      const stableSourceRows = filterSyncRows(sourceRows)
      outline.transaction({ label: `Inline ${label}` }, () => {
        const existing = parent.children.slice()
        const removable = existing.filter((row) => !isPlaceholderRow(row))
        let insertedRoots: Row[] = []
        if (stableSourceRows.length > 0) {
          const before = removable[0]
          insertedRoots = copyRowSubtree(outline, parent, stableSourceRows, before)
        }
        if (removable.length > 0) {
          outline.removeRows(removable)
        }
      })
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

function collectInlineHeadings(
  docInfos: DocInfo[],
  docsByName: Map<string, DocInfo>
): { links: InlineLink[]; missing: InlineHeading[] } {
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
        continue
      }
      row = row.nextInOutline
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

function serializeRows(rows: Row[]): string {
  const snapshots = filterSyncRows(rows).map((row) => serializeRow(row))
  return JSON.stringify(snapshots)
}

type RowSnapshot = {
  type: string
  text: string
  attributes: [string, string][]
  children: RowSnapshot[]
}

function serializeRow(row: Row): RowSnapshot {
  return {
    type: row.type,
    text: serializeText(row),
    attributes: serializeAttributes(row.attributes),
    children: row.children.map((child) => serializeRow(child))
  }
}

function serializeAttributes(attributes: Record<string, string>): [string, string][] {
  const keys = Object.keys(attributes).sort()
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

function isPlaceholderRow(row: Row): boolean {
  return (
    row.type === 'body' &&
    row.text.string === '' &&
    row.children.length === 0 &&
    Object.keys(row.attributes).length === 0
  )
}

function filterSyncRows(rows: Row[]): Row[] {
  return rows.filter((row) => !isPlaceholderRow(row))
}

function copyRowSubtree(outline: Outline, parent: Row, sourceRows: Row[], before?: Row): Row[] {
  const insertedRoots: Row[] = []
  for (const sourceRow of sourceRows) {
    const [inserted] = outline.insertRows(
      [
        {
          type: sourceRow.type,
          text: sourceRow.text,
          attributes: { ...sourceRow.attributes }
        }
      ],
      parent,
      before
    )
    insertedRoots.push(inserted)
    if (sourceRow.children.length > 0) {
      copyRowSubtree(outline, inserted, sourceRow.children)
    }
  }
  return insertedRoots
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
