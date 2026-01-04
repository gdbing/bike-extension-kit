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

test('insertStaticResponse converts markdown rows and inline formatting', () => {
  const userRow = createRow('<user>')
  const outline = new FakeOutline([userRow])

  const markdown = [
    '# Heading',
    '## H2 Heading',
    '- Bullet with **bold**',
    '1. First',
    '2. Second',
    '> Quote with *italic*',
    '[ ] Task one',
    '[x] Task done',
    '- [ ] Task dashed',
    '- [x] Task dashed done',
    'Plain `code` and ~~strike~~ and [link](http://example.com)'
  ].join('\n')

  insertStaticResponse(outline as any, userRow as any, markdown)

  const assistantRow = outline.root.children[1]
  const rows = assistantRow.children

  assert.equal(rows.length, 11)

  assert.equal(rows[0].type, 'heading')
  assert.equal(rows[0].text.string, 'Heading')

  assert.notEqual(rows[1].type, 'heading')
  assert.equal(rows[1].text.string, '## H2 Heading')

  assert.equal(rows[2].type, 'unordered')
  assert.equal(rows[2].text.string, 'Bullet with bold')
  assertAttribute(rows[2], 'bold', 'strong')

  assert.equal(rows[3].type, 'ordered')
  assert.equal(rows[3].text.string, 'First')

  assert.equal(rows[4].type, 'ordered')
  assert.equal(rows[4].text.string, 'Second')

  assert.equal(rows[5].type, 'quote')
  assert.equal(rows[5].text.string, 'Quote with italic')
  assertAttribute(rows[5], 'italic', 'em')

  assert.equal(rows[6].type, 'task')
  assert.equal(rows[6].text.string, 'Task one')
  assert.equal(rows[6].attributes?.done, undefined)

  assert.equal(rows[7].type, 'task')
  assert.equal(rows[7].text.string, 'Task done')
  assertDoneAttribute(rows[7])

  assert.equal(rows[8].type, 'task')
  assert.equal(rows[8].text.string, 'Task dashed')
  assert.equal(rows[8].attributes?.done, undefined)

  assert.equal(rows[9].type, 'task')
  assert.equal(rows[9].text.string, 'Task dashed done')
  assertDoneAttribute(rows[9])

  assert.equal(rows[10].text.string, 'Plain code and strike and link')
  assertAttribute(rows[10], 'code', 'code')
  assertAttribute(rows[10], 'strike', 's')
  assertAttribute(rows[10], 'link', 'a', 'http://example.com')
})

test('insertStaticResponse normalizes indentation to the first indent', () => {
  const userRow = createRow('<user>')
  const outline = new FakeOutline([userRow])

  const markdown = [
    '- Parent',
    '  - Child',
    '    - Grandchild',
    '    - Sibling'
  ].join('\n')

  insertStaticResponse(outline as any, userRow as any, markdown)

  const assistantRow = outline.root.children[1]
  const parent = assistantRow.children[0]

  assert.equal(parent.type, 'unordered')
  assert.equal(parent.text.string, 'Parent')

  const child = parent.children[0]
  assert.equal(child.type, 'unordered')
  assert.equal(child.text.string, 'Child')

  assert.equal(child.children.length, 2)
  assert.equal(child.children[0].text.string, 'Grandchild')
  assert.equal(child.children[1].text.string, 'Sibling')
})

test('insertStaticResponse parses fenced code blocks with indentation', () => {
  const userRow = createRow('<user>')
  const outline = new FakeOutline([userRow])

  const markdown = [
    '```js',
    'code 1',
    '  code 1.1',
    'code 2',
    '```',
    '```',
    'code 3',
    '```'
  ].join('\n')

  insertStaticResponse(outline as any, userRow as any, markdown)

  const assistantRow = outline.root.children[1]
  const [codeOne, codeTwo, codeThree] = assistantRow.children

  assert.equal(codeOne.type, 'code')
  assert.equal(codeOne.text.string, 'code 1')
  assert.equal(codeOne.children.length, 1)
  assert.equal(codeOne.children[0].text.string, 'code 1.1')
  assert.equal(codeOne.children[0].type, 'code')

  assert.equal(codeTwo.type, 'code')
  assert.equal(codeTwo.text.string, 'code 2')

  assert.equal(codeThree.type, 'code')
  assert.equal(codeThree.text.string, 'code 3')
})

test('streamResponseToOutline converts markdown rows and inline formatting', async () => {
  const userRow = createRow('<user>')
  const outline = new FakeOutline([userRow])

  await streamResponseToOutline(
    outline as any,
    userRow as any,
    makeTokenStream('- **Bold** item')
  )

  const assistantRow = outline.root.children[1]
  const [row] = assistantRow.children

  assert.equal(row.type, 'unordered')
  assert.equal(row.text.string, 'Bold item')
  assertAttribute(row, 'Bold', 'strong')
})

function assertAttribute(row: FakeRow, fragment: string, name: string, value?: string): void {
  const index = row.text.string.indexOf(fragment)
  if (index === -1) {
    throw new Error(`Missing fragment: ${fragment}`)
  }
  const expected = value ?? ''
  assert.equal(row.text.attributeAt(name, index), expected)
}

function assertDoneAttribute(row: FakeRow): void {
  const done = row.attributes?.done
  assert.ok(done)
  assert.match(done, /\d{4}-\d{2}-\d{2}T/)
}
