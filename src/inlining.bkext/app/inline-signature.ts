import type { Document, Row, RowId } from 'bike/app'
import type { DocInfo, InlineLink, InlineSignatureMap } from './inline-model'
import { INLINE_ID_ATTR } from './inline-constants'
import { serializeText } from './inline-text'
import { YieldController } from './inline-yield'

export type SerializeOptions = {
  ignoreInlineId?: boolean
}

export async function collectDocSignatures(
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

export async function collectInlineSignatures(
  links: InlineLink[],
  yieldController: YieldController
): Promise<InlineSignatureMap> {
  const signatures: InlineSignatureMap = new Map()
  for (const link of links) {
    const inlineSig = await serializeRows(link.heading.children, { ignoreInlineId: true }, yieldController)
    let inlineMap = signatures.get(link.hostDoc)
    if (!inlineMap) {
      inlineMap = new Map<RowId, string>()
      signatures.set(link.hostDoc, inlineMap)
    }
    inlineMap.set(link.heading.id, inlineSig)
  }
  return signatures
}

export async function serializeRows(
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
