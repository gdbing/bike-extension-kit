export type RowType =
  | 'row'
  | 'body'
  | 'heading'
  | 'quote'
  | 'code'
  | 'note'
  | 'unordered'
  | 'ordered'
  | 'task'
  | 'hr'

type TextAttributeRun = {
  start: number
  end: number
  name: string
  value: string
}

interface FakeText {
  string: string
  replace(range: [number, number], value: string): void
  attributeAt(name: string, index: number): string | null
  attributesAt(index: number): Record<string, string>
  addAttribute(name: string, value: string, range?: [number, number]): void
  addAttributes(attributes: Record<string, string>, range?: [number, number]): void
  removeAttribute(name: string, range?: [number, number]): void
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

  insertRows(
    rows: { text?: string; type?: RowType; attributes?: Record<string, string> }[],
    parent: FakeRow = this.root,
    before?: FakeRow
  ): FakeRow[] {
    const newRows = rows.map(row => createRow(
      row.text ?? '',
      parent,
      row.type ?? 'row',
      undefined,
      row.attributes
    ))
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
  level?: number,
  rowAttributes?: Record<string, string>
): FakeRow {
  const attributeRuns: TextAttributeRun[] = []
  const fakeText: FakeText = {
    string: text,
    replace(_range, value) {
      fakeText.string = value
      attributeRuns.length = 0
    },
    attributeAt(name, index) {
      if (index < 0 || index >= fakeText.string.length) return null
      const match = attributeRuns.find(
        run => run.name === name && index >= run.start && index < run.end
      )
      return match ? match.value : null
    },
    attributesAt(index) {
      if (index < 0 || index >= fakeText.string.length) return {}
      const attributes: Record<string, string> = {}
      for (const run of attributeRuns) {
        if (index >= run.start && index < run.end) {
          attributes[run.name] = run.value
        }
      }
      return attributes
    },
    addAttribute(name, value, range) {
      const start = range ? range[0] : 0
      const end = range ? range[1] : fakeText.string.length
      if (end <= start) return
      attributeRuns.push({ start, end, name, value })
    },
    addAttributes(attributes, range) {
      for (const [name, value] of Object.entries(attributes)) {
        fakeText.addAttribute(name, value, range)
      }
    },
    removeAttribute(name, range) {
      const start = range ? range[0] : 0
      const end = range ? range[1] : fakeText.string.length
      for (let index = attributeRuns.length - 1; index >= 0; index -= 1) {
        const run = attributeRuns[index]
        if (run.name !== name) continue
        if (end <= run.start || start >= run.end) continue
        attributeRuns.splice(index, 1)
      }
    }
  }

  const attributes: Record<string, string> = rowAttributes ? { ...rowAttributes } : {}
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
