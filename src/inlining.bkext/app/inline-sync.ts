import type { Document, Outline, Row, RowId, Disposable } from 'bike/app'
import { SYNC_DELAY_MS } from './inline-constants'
import type { DocInfo, InlineHeading, InlineInfo, InlineLink, InlineSignatureMap } from './inline-model'
import { decideSyncSource } from './inline-decision'
import { collectInlineHeadings, indexDocumentsByName, buildAmbiguousWarning, createWarningRowSource, isWarningRow } from './inline-targets'
import { collectDocSignatures, collectInlineSignatures, serializeRows } from './inline-signature'
import {
  hasMissingInlineIds,
  mapInlineRowsById,
  mapRowsById,
  removeExtraChildren,
  setInlineId,
  syncDocToInlineRows,
  syncInlineToDocRows
} from './inline-sync-rows'
import type { DocToInlineContext, InlineToDocContext } from './inline-sync-rows'
import { YieldController } from './inline-yield'

type SyncTimer = ReturnType<typeof setTimeout>

export class InlineDocumentSync {
  private docOutlines = new Map<Document, Outline>()
  private outlineObservers = new Map<Outline, { observer: Disposable; doc: Document }>()
  private lastDocSignatures = new Map<Document, string>()
  private lastInlineSignatures: InlineSignatureMap = new Map()
  private lastChangedDocument?: Document
  private syncGeneration = 0
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
    this.syncGeneration += 1
    if (this.isSyncing) {
      this.resyncRequested = true
      return
    }
    this.scheduleSyncTimer()
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
    const runGeneration = this.syncGeneration
    const yieldController = new YieldController()
    const isSuperseded = () => runGeneration !== this.syncGeneration
    try {
      const docInfos = this.collectDocumentInfos()
      const outlineDocs = new Map<Outline, Document>(docInfos.map((info) => [info.outline, info.document]))
      this.updateOutlineObservers(outlineDocs)

      const docsByName = indexDocumentsByName(docInfos)
      const { links, missing, ambiguous } = await collectInlineHeadings(docInfos, docsByName, yieldController)
      if (isSuperseded()) return

      const prevDocSignatures = this.lastDocSignatures
      const prevInlineSignatures = this.lastInlineSignatures

      this.removeMissingInlineChildren(missing)
      this.updateAmbiguousInlineChildren(ambiguous)

      if (links.length === 0) {
        if (isSuperseded()) return
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
      if (isSuperseded()) return

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

        const decision = decideSyncSource({
          docChanged,
          inlineChangedInfos,
          lastChangedDocument: this.lastChangedDocument,
          hasMismatchOrMissingIds: inlineInfos.some(
            (info) => info.inlineSig !== docSig || info.needsInlineIds
          )
        })
        const { source, inlineSource } = decision

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
        this.scheduleSyncTimer()
      }
    }
  }

  private scheduleSyncTimer(): void {
    if (this.disposed) return
    if (this.syncTimer !== undefined) return
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined
      void this.syncAll()
    }, SYNC_DELAY_MS)
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
      inlineUpdates: new Map<Row, RowId>(),
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

  private updateAmbiguousInlineChildren(ambiguous: InlineHeading[]): void {
    if (ambiguous.length === 0) return
    this.withApplying(() => {
      const outlines = new Map<Outline, InlineHeading[]>()
      for (const entry of ambiguous) {
        const bucket = outlines.get(entry.hostOutline)
        if (bucket) {
          bucket.push(entry)
        } else {
          outlines.set(entry.hostOutline, [entry])
        }
      }

      for (const [outline, entries] of outlines) {
        outline.transaction({ label: 'Inline warning' }, () => {
          for (const entry of entries) {
            const message = buildAmbiguousWarning(entry.target.label)
            const children = entry.heading.children
            if (children.length === 1 && isWarningRow(children[0], message)) {
              continue
            }
            if (children.length > 0) {
              outline.removeRows(children)
            }
            outline.insertRows([createWarningRowSource(message)], entry.heading)
          }
        })
      }
    })
  }

  private collectDocumentInfos(): DocInfo[] {
    this.refreshDocumentCache()
    const infos: DocInfo[] = []
    for (const doc of bike.documents) {
      const outline = this.docOutlines.get(doc)
      if (!outline) {
        console.error('Inlining: Missing outline for open document', doc.displayName)
        continue
      }
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
