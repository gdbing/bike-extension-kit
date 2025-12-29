import * as assert from 'node:assert/strict'
import { insertStaticResponse } from '../../src/llm-chat.bkext/app/response-inserter'
import { test } from './test-harness'

type RowType = 'row' | 'note'

interface FakeText {
  string: string
  replace(range: [number, number], value: string): void
}

interface FakeRow {
  id: string
  text: FakeText
  level: number
  parent?: FakeRow
  nextSibling?: FakeRow
  children: FakeRow[]
  type?: RowType
}

class FakeOutline {
  root: FakeRow

  constructor(children: FakeRow[]) {
    this.root = createRow('', undefined, 'row', 0)
    for (const child of children) {
      this.appendChild(this.root, child)
    }
    this.relinkSiblings(this.root)
  }

  insertRows(rows: { text: string }[], parent: FakeRow = this.root, before?: FakeRow): FakeRow[] {
    const newRows = rows.map(row => createRow(row.text, parent))
    const children = parent.children

    if (before) {
      const index = children.indexOf(before)
      if (index === -1) {
        children.push(...newRows)
      } else {
        children.splice(index, 0, ...newRows)
      }
    } else {
      children.push(...newRows)
    }

    this.relinkSiblings(parent)
    return newRows
  }

  removeRows(rows: FakeRow[]): void {
    for (const row of rows) {
      const parent = row.parent
      if (!parent) continue
      parent.children = parent.children.filter(child => child !== row)
      this.relinkSiblings(parent)
    }
  }

  // Unused Outline methods for this test suite
  private appendChild(parent: FakeRow, child: FakeRow): void {
    child.parent = parent
    child.level = parent.level + 1
    parent.children.push(child)
  }

  private relinkSiblings(parent: FakeRow): void {
    for (let index = 0; index < parent.children.length; index += 1) {
      const current = parent.children[index]
      current.nextSibling = parent.children[index + 1]
      // Propagate level/parent to nested children for consistency
      for (const child of current.children) {
        child.parent = current
        child.level = current.level + 1
      }
      this.relinkSiblings(current)
    }
  }
}

let idCounter = 0
function createRow(text: string, parent?: FakeRow, type: RowType = 'row', level?: number): FakeRow {
  const fakeText: FakeText = {
    string: text,
    replace(_range, value) {
      fakeText.string = value
    }
  }

  return {
    id: `row-${++idCounter}`,
    text: fakeText,
    type,
    level: level ?? (parent ? parent.level + 1 : 1),
    parent,
    children: [],
    nextSibling: undefined
  }
}

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

test('does not overwrite an existing assistant response after the current marker', () => {
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
