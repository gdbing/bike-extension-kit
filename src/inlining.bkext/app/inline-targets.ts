import type { Row, RowTemplate } from 'bike/app'
import type { DocInfo, InlineHeading, InlineLink, InlineTarget } from './inline-model'
import { YieldController } from './inline-yield'

function normalizeDocName(name: string): string {
  return name.trim().toLowerCase()
}

export function getInlineTarget(row: Row): InlineTarget | null {
  const trimmed = row.text.string.trim()
  const match = trimmed.match(/^<inline:\s*(.+?)\s*>$/i)
  if (!match) return null
  const label = match[1].trim()
  const name = normalizeDocName(label)
  return name ? { name, label } : null
}

export function indexDocumentsByName(docInfos: DocInfo[]): Map<string, DocInfo[]> {
  const map = new Map<string, DocInfo[]>()
  for (const info of docInfos) {
    const name = normalizeDocName(info.displayName)
    if (!name) continue
    const bucket = map.get(name)
    if (bucket) {
      bucket.push(info)
    } else {
      map.set(name, [info])
    }
  }
  return map
}

export async function collectInlineHeadings(
  docInfos: DocInfo[],
  docsByName: Map<string, DocInfo[]>,
  yieldController: YieldController
): Promise<{ links: InlineLink[]; missing: InlineHeading[]; ambiguous: InlineHeading[] }> {
  const links: InlineLink[] = []
  const missing: InlineHeading[] = []
  const ambiguous: InlineHeading[] = []

  for (const info of docInfos) {
    let row = info.outline.root.firstChild
    while (row) {
      const target = getInlineTarget(row)
      if (target) {
        const candidates = docsByName.get(target.name) ?? []
        if (candidates.length > 1) {
          ambiguous.push({
            heading: row,
            hostDoc: info.document,
            hostOutline: info.outline,
            target
          })
        } else if (candidates.length === 1 && candidates[0].document !== info.document) {
          const candidate = candidates[0]
          links.push({
            heading: row,
            hostDoc: info.document,
            hostOutline: info.outline,
            targetDoc: candidate
          })
        } else {
          missing.push({
            heading: row,
            hostDoc: info.document,
            hostOutline: info.outline,
            target
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

  return { links, missing, ambiguous }
}

export function buildAmbiguousWarning(label: string): string {
  return `⚠️ Multiple documents named "${label}" are open`
}

export function buildCycleWarning(label: string): string {
  return `⚠️ Inline cycle detected for "${label}"`
}

export function isWarningRow(row: Row, message: string): boolean {
  return row.type === 'note' && row.text.string === message && row.children.length === 0
}

export function createWarningRowSource(message: string): RowTemplate {
  return {
    type: 'note',
    text: message
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
