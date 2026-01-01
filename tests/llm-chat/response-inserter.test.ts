import * as assert from 'node:assert/strict'
import { insertStaticResponse, streamResponseToOutline } from '../../src/llm-chat.bkext/app/response-inserter'
import { FakeOutline, FakeRow, createRow } from './response-outline'
import { test } from './test-harness'

test('inserts a new assistant after the marker when cursor is inside a note', () => {
  const userRow = createRow('<user>')
  const noteRow = createRow('Comment block', userRow, 'note')
  const noteChild = createRow('Cursor here', noteRow)
  noteRow.children.push(noteChild)
  userRow.children.push(noteRow)

  const trailingRow = createRow('Trailing root row')
  const outline = new FakeOutline([userRow, trailingRow])

  insertStaticResponse(outline as any, noteChild as any, 'Assistant reply')

  const [first, second, third] = outline.root.children
  assert.equal(first.text.string, '<user>')
  assert.equal(second.text.string, '<assistant>')
  assert.equal(third.text.string, 'Trailing root row')
  assert.equal(second.level, 1)
  assert.strictEqual(second.parent, outline.root)
  assert.equal(second.children.length, 1)
  assert.equal(second.children[0].text.string, 'Assistant reply')
})

test('does not overwrite an existing message after the current marker', () => {
  const userRow = createRow('<user>')
  const existingAssistant = createRow('<assistant>')
  existingAssistant.children.push(createRow('Original reply', existingAssistant))

  userRow.nextSibling = existingAssistant

  const trailingRow = createRow('<user>')
  existingAssistant.nextSibling = trailingRow

  const outline = new FakeOutline([userRow, existingAssistant, trailingRow])

  insertStaticResponse(outline as any, userRow as any, 'New reply')

  const rootChildren = outline.root.children
  assert.equal(rootChildren[0].text.string, '<user>')
  assert.equal(rootChildren[1].text.string, '<assistant>')
  assert.equal(rootChildren[1].children[0].text.string, 'New reply')
  assert.equal(rootChildren[2].text.string, '<assistant>')
  assert.equal(rootChildren[2].children[0].text.string, 'Original reply')
  assert.equal(rootChildren[3].text.string, '<user>')
})

test('inserts errors under an <error> marker without duplicating assistant headings', () => {
  const userRow = createRow('<user>')
  const priorAssistant = createRow('<assistant>')
  priorAssistant.children.push(createRow('Previous reply', priorAssistant))

  userRow.nextSibling = priorAssistant
  const trailingRow = createRow('<user>')
  priorAssistant.nextSibling = trailingRow

  const outline = new FakeOutline([userRow, priorAssistant, trailingRow])

  insertStaticResponse(outline as any, userRow as any, 'Error: failed', '<error>')

  const rootChildren = outline.root.children
  assert.equal(rootChildren[0].text.string, '<user>')
  assert.equal(rootChildren[1].text.string, '<error>')
  assert.equal(rootChildren[1].children[0].text.string, 'Error: failed')
  assert.equal(rootChildren[2].text.string, '<assistant>')
  assert.equal(rootChildren[2].children[0].text.string, 'Previous reply')
  assert.equal(rootChildren[3].text.string, '<user>')
})

async function* makeTokenStream(text: string): AsyncGenerator<string, void, unknown> {
  yield text
}

test('streaming responses always create new marker rows', async () => {
  const userRow = createRow('<user>')
  const outline = new FakeOutline([userRow])

  await streamResponseToOutline(outline as any, userRow as any, makeTokenStream('First reply'))
  await streamResponseToOutline(outline as any, userRow as any, makeTokenStream('Second reply'))

  const rootChildren = outline.root.children
  assert.equal(rootChildren.length, 3)
  assert.equal(rootChildren[0].text.string, '<user>')
  assert.equal(rootChildren[1].text.string, '<assistant>')
  assert.equal(rootChildren[2].text.string, '<assistant>')
  assert.equal(rootChildren[1].children[0].text.string, 'Second reply')
  assert.equal(rootChildren[2].children[0].text.string, 'First reply')
})
