import type { OutlineEditor, Row } from 'bike/app'
import { collectInlineReferences, getLastRow } from './inline-resolver'
import { hasUrlScheme, isFileUrl, resolveRelativeFileUrl } from './inline-path'

export type InlineOpenDependencies = {
  canOpenURL: boolean
  openUrl: (url: string) => void
  isInlineDocumentOpen: (fileUrl: string) => boolean
  getOpenDocumentRoot: (fileUrl: string) => Row | null
  getEditorDocumentFileUrl: (editor: OutlineEditor) => string | null
  restoreFrontmostDocument: (fileUrl: string | null) => void
  waitForInlineDocuments?: (
    fileUrls: string[],
    isInlineDocumentOpen: (fileUrl: string) => boolean
  ) => Promise<void>
}

type InlineScanTarget = {
  root: Row
  stopRow: Row
  baseFileUrl: string | null
}

export async function openInlineDocumentsIfNeeded(
  editor: OutlineEditor,
  stopRow: Row,
  originDocumentFileUrl: string | null,
  deps: InlineOpenDependencies
): Promise<void> {
  if (!deps.canOpenURL) return

  const documentFileUrl = originDocumentFileUrl ?? deps.getEditorDocumentFileUrl(editor)
  const waitForInlineDocuments = deps.waitForInlineDocuments ?? defaultWaitForInlineDocuments
  const scanQueue: InlineScanTarget[] = [
    {
      root: editor.outline.root,
      stopRow,
      baseFileUrl: documentFileUrl
    }
  ]
  const processedDocs = new Set<string>()
  let didOpen = false

  while (scanQueue.length > 0) {
    const target = scanQueue.shift()
    if (!target) break

    const inlineFileUrls = collectInlineFileUrls(
      target.root,
      target.stopRow,
      target.baseFileUrl
    )
    if (inlineFileUrls.length === 0) {
      continue
    }

    const missingUrls = inlineFileUrls.filter((url) => !deps.isInlineDocumentOpen(url))
    if (missingUrls.length > 0) {
      didOpen = true
      for (const url of missingUrls) {
        try {
          deps.openUrl(url)
        } catch (error) {
          console.warn(`LLM Chat: Failed to open inline URL ${url}`, error)
        }
      }
      await waitForInlineDocuments(missingUrls, deps.isInlineDocumentOpen)
    }

    for (const url of inlineFileUrls) {
      if (processedDocs.has(url)) continue
      const root = deps.getOpenDocumentRoot(url)
      if (!root) continue
      processedDocs.add(url)
      const lastRow = getLastRow(root) ?? root
      scanQueue.push({
        root,
        stopRow: lastRow,
        baseFileUrl: url
      })
    }
  }

  if (didOpen) {
    deps.restoreFrontmostDocument(originDocumentFileUrl ?? documentFileUrl)
  }
}

export function collectInlineFileUrls(
  root: Row,
  stopRow: Row,
  documentFileUrl: string | null
): string[] {
  const stopMarker = getStopMarker(stopRow)
  const urls = new Set<string>()
  let row = root.firstChild

  while (row) {
    if (row.type !== 'note') {
      const text = row.text.string.trim().toLowerCase()
      const markerMatch = text.match(/^<([^>]+)>$/)
      if (markerMatch && markerMatch[1] === 'inline') {
        const references = collectInlineReferences(row)
        for (const reference of references) {
          const url = extractInlineFileUrl(reference)
          if (url) {
            urls.add(url)
            continue
          }
          if (!documentFileUrl) continue
          const relativeUrl = resolveInlineRelativeFileUrl(reference, documentFileUrl)
          if (relativeUrl) {
            urls.add(relativeUrl)
          }
        }
      }
    }

    if (row.id === stopMarker.id) {
      break
    }
    row = row.nextSibling
  }

  return Array.from(urls)
}

function extractInlineFileUrl(reference: { text?: string; link?: string }): string | null {
  const link = reference.link?.trim()
  if (link && isFileUrl(link)) return link

  const text = reference.text?.trim()
  if (text && isFileUrl(text)) return text

  return null
}

function resolveInlineRelativeFileUrl(
  reference: { text?: string; link?: string },
  baseFileUrl: string
): string | null {
  const candidate = (reference.link ?? reference.text)?.trim()
  if (!candidate) return null
  if (isFileUrl(candidate)) return candidate
  if (hasUrlScheme(candidate)) return null
  return resolveRelativeFileUrl(baseFileUrl, candidate)
}

function getStopMarker(stopRow: Row): Row {
  let stopMarker = stopRow
  while (stopMarker.level > 1 && stopMarker.parent) {
    stopMarker = stopMarker.parent
  }
  return stopMarker
}

async function defaultWaitForInlineDocuments(
  fileUrls: string[],
  isInlineDocumentOpen: (fileUrl: string) => boolean
): Promise<void> {
  const pending = new Set(fileUrls)
  const timeoutMs = 2000
  const intervalMs = 100
  const start = Date.now()

  while (pending.size > 0 && Date.now() - start < timeoutMs) {
    for (const url of Array.from(pending)) {
      if (isInlineDocumentOpen(url)) {
        pending.delete(url)
      }
    }

    if (pending.size === 0) return
    await delay(intervalMs)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
