export type RowType = 'row' | 'note'

interface FakeText {
  string: string
  replace(range: [number, number], value: string): void
}

export interface FakeRow {
  id: string
  text: FakeText
  level: number
  parent?: FakeRow
  nextSibling?: FakeRow
  children: FakeRow[]
  type?: RowType
  attributes?: Record<string, string>
  setAttribute?(key: string, value: string): void
  removeAttribute?(key: string): void
}

export class FakeOutline {
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

  transaction(_options: { animate?: string }, fn: () => void): void {
    fn()
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
export function createRow(
  text: string,
  parent?: FakeRow,
  type: RowType = 'row',
  level?: number
): FakeRow {
  const fakeText: FakeText = {
    string: text,
    replace(_range, value) {
      fakeText.string = value
    }
  }

  const attributes: Record<string, string> = {}
  return {
    id: `row-${++idCounter}`,
    text: fakeText,
    type,
    level: level ?? (parent ? parent.level + 1 : 1),
    parent,
    children: [],
    nextSibling: undefined,
    attributes,
    setAttribute(key, value) {
      attributes[key] = value
    },
    removeAttribute(key) {
      delete attributes[key]
    }
  }
}
