import type { Document } from 'bike/app'
import type { InlineInfo } from './inline-model'

export type SyncSourceDecision = {
  source: 'doc' | 'inline' | null
  inlineSource?: InlineInfo
}

export function pickInlineSource(inlineChanged: InlineInfo[], lastChangedDocument?: Document): InlineInfo {
  if (lastChangedDocument) {
    const match = inlineChanged.find((info) => info.link.hostDoc === lastChangedDocument)
    if (match) return match
  }
  return inlineChanged[0]
}

export function decideSyncSource(params: {
  docChanged: boolean
  inlineChangedInfos: InlineInfo[]
  lastChangedDocument?: Document
  hasMismatchOrMissingIds: boolean
}): SyncSourceDecision {
  const { docChanged, inlineChangedInfos, lastChangedDocument, hasMismatchOrMissingIds } = params

  if (docChanged) {
    if (inlineChangedInfos.length === 1) {
      const preferredInline = pickInlineSource(inlineChangedInfos, lastChangedDocument)
      if (lastChangedDocument && preferredInline.link.hostDoc === lastChangedDocument) {
        return { source: 'inline', inlineSource: preferredInline }
      }
      return { source: 'doc' }
    }
    return { source: 'doc' }
  }

  if (inlineChangedInfos.length === 1) {
    const preferredInline = pickInlineSource(inlineChangedInfos, lastChangedDocument)
    return { source: 'inline', inlineSource: preferredInline }
  }

  if (hasMismatchOrMissingIds) {
    return { source: 'doc' }
  }

  return { source: null }
}
