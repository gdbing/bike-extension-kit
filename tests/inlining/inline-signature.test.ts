import * as assert from 'assert'
import { INLINE_ID_ATTR } from '../../src/inlining.bkext/app/inline-constants'
import { serializeRows } from '../../src/inlining.bkext/app/inline-signature'
import { YieldController } from '../../src/inlining.bkext/app/inline-yield'
import { buildOutline } from './test-outline'
import { test } from './test-harness'

async function signatureFor(nodes: Parameters<typeof buildOutline>[0]): Promise<string> {
  const outline = buildOutline(nodes)
  const controller = new YieldController()
  const rows = outline.outline.root.children as unknown as import('bike/app').Row[]
  return serializeRows(rows, { ignoreInlineId: true }, controller)
}

test('serializeRows ignores inline id attributes', async () => {
  const sigA = await signatureFor([
    { text: 'Alpha', attributes: { [INLINE_ID_ATTR]: 'row-1', role: 'doc' } }
  ])
  const sigB = await signatureFor([
    { text: 'Alpha', attributes: { [INLINE_ID_ATTR]: 'row-2', role: 'doc' } }
  ])

  assert.strictEqual(sigA, sigB)
})

test('serializeRows is stable for attribute order', async () => {
  const sigA = await signatureFor([
    { text: 'Alpha', attributes: { a: '1', b: '2' } }
  ])
  const sigB = await signatureFor([
    { text: 'Alpha', attributes: { b: '2', a: '1' } }
  ])

  assert.strictEqual(sigA, sigB)
})

test('serializeRows changes when content changes', async () => {
  const sigA = await signatureFor([{ text: 'Alpha' }])
  const sigB = await signatureFor([{ text: 'Beta' }])

  assert.notStrictEqual(sigA, sigB)
})

test('serializeRows uses HTML text when available', async () => {
  const outlineA = buildOutline([{ key: 'alpha', text: 'Alpha' }])
  const outlineB = buildOutline([{ key: 'alpha', text: 'Alpha' }])

  outlineA.byKey.alpha.text = { string: 'Alpha', toHTML: () => '<b>Alpha</b>' }
  outlineB.byKey.alpha.text = { string: 'Alpha', toHTML: () => 'Alpha' }

  const controller = new YieldController()
  const rowsA = outlineA.outline.root.children as unknown as import('bike/app').Row[]
  const rowsB = outlineB.outline.root.children as unknown as import('bike/app').Row[]
  const sigA = await serializeRows(rowsA, { ignoreInlineId: true }, controller)
  const sigB = await serializeRows(rowsB, { ignoreInlineId: true }, controller)

  assert.notStrictEqual(sigA, sigB)
})
