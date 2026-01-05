import type { Document, Outline, Row, RowId } from 'bike/app'

export type DocInfo = {
  document: Document
  outline: Outline
  displayName: string
}

export type InlineTarget = {
  name: string
  label: string
}

export type InlineLink = {
  heading: Row
  hostDoc: Document
  hostOutline: Outline
  targetDoc: DocInfo
}

export type InlineHeading = {
  heading: Row
  hostDoc: Document
  hostOutline: Outline
  target: InlineTarget
}

export type InlineSignature = string

export type InlineSignatureByHeading = Map<RowId, InlineSignature>

export type InlineSignatureMap = Map<Document, InlineSignatureByHeading>

export type InlineInfo = {
  link: InlineLink
  inlineSig: InlineSignature
  prevInlineSig?: InlineSignature
  inlineChanged: boolean
  needsInlineIds: boolean
}
