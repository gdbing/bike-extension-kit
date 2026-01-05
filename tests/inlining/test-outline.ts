import type { RowId } from 'bike/app'

export type TestText = {
  string: string
  toHTML: () => string
}

export type TestNode = {
  text: string
  type?: string
  attributes?: Record<string, string>
  key?: string
  children?: TestNode[]
}

export type BuildResult = {
  outline: TestOutline
  byKey: Record<string, TestRow>
}

export class TestOutline {
  root: TestRow
  private idCounter = 0

  constructor(nodes: TestNode[] = [], byKey?: Record<string, TestRow>) {
    this.root = new TestRow({
      outline: this,
      id: 'root',
      type: 'root',
      text: makeText(''),
      attributes: {},
      parent: undefined
    })
    this.root.children = []
    if (nodes.length > 0) {
      this.buildChildren(nodes, this.root, byKey)
    }
  }

  insertRows(rows: TestRowSource[], parent?: TestRow, before?: TestRow): TestRow[] {
    const target = parent ?? this.root
    const insertIndex = before ? target.children.indexOf(before as TestRow) : target.children.length
    const inserted: TestRow[] = []
    let index = insertIndex >= 0 ? insertIndex : target.children.length

    for (const rowSource of rows) {
      const row = this.createRow(rowSource, target as TestRow)
      target.children.splice(index, 0, row)
      inserted.push(row)
      index += 1
    }

    return inserted
  }

  moveRows(rows: TestRow[], parent: TestRow, before?: TestRow): void {
    const target = parent
    const beforeRow = before

    for (const row of rows) {
      const current = row as TestRow
      if (!current.parent) continue
      const siblings = current.parent.children
      const index = siblings.indexOf(current)
      if (index >= 0) {
        siblings.splice(index, 1)
      }
    }

    const insertIndex = beforeRow ? target.children.indexOf(beforeRow) : target.children.length
    let index = insertIndex >= 0 ? insertIndex : target.children.length

    for (const row of rows) {
      const current = row as TestRow
      current.parent = target
      target.children.splice(index, 0, current)
      index += 1
    }
  }

  removeRows(rows: TestRow[]): void {
    for (const row of rows) {
      const current = row as TestRow
      if (!current.parent) continue
      const siblings = current.parent.children
      const index = siblings.indexOf(current)
      if (index >= 0) {
        siblings.splice(index, 1)
      }
      current.parent = undefined
    }
  }

  transaction(_options: unknown, fn: () => void): void {
    fn()
  }

  nextInOutline(row: TestRow): TestRow | undefined {
    const order = this.outlineOrder()
    const index = order.indexOf(row)
    if (index < 0) return undefined
    return order[index + 1]
  }

  prevInOutline(row: TestRow): TestRow | undefined {
    const order = this.outlineOrder()
    const index = order.indexOf(row)
    if (index <= 0) return undefined
    return order[index - 1]
  }

  private buildChildren(nodes: TestNode[], parent: TestRow, byKey?: Record<string, TestRow>): void {
    for (const node of nodes) {
      const row = this.createRow(node, parent)
      parent.children.push(row)
      if (node.key && byKey) {
        byKey[node.key] = row
      }
      if (node.children?.length) {
        this.buildChildren(node.children, row, byKey)
      }
    }
  }

  private createRow(node: TestRowSource, parent: TestRow): TestRow {
    return new TestRow({
      outline: this,
      id: this.nextId(),
      type: node.type ?? 'body',
      text: normalizeText(node.text ?? ''),
      attributes: node.attributes ? { ...node.attributes } : {},
      parent
    })
  }

  private nextId(): RowId {
    this.idCounter += 1
    return `row-${this.idCounter}`
  }

  private outlineOrder(): TestRow[] {
    const rows: TestRow[] = []
    const stack = [...this.root.children].reverse()
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      rows.push(current)
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push(current.children[index])
      }
    }
    return rows
  }
}

export class TestRow {
  outline: TestOutline
  id: RowId
  type: string
  text: TestText
  attributes: Record<string, string>
  parent?: TestRow
  children: TestRow[]

  constructor(params: {
    outline: TestOutline
    id: RowId
    type: string
    text: TestText
    attributes: Record<string, string>
    parent?: TestRow
  }) {
    this.outline = params.outline
    this.id = params.id
    this.type = params.type
    this.text = params.text
    this.attributes = params.attributes
    this.parent = params.parent
    this.children = []
  }

  get prevSibling(): TestRow | undefined {
    if (!this.parent) return undefined
    const index = this.parent.children.indexOf(this)
    return index > 0 ? this.parent.children[index - 1] : undefined
  }

  get nextSibling(): TestRow | undefined {
    if (!this.parent) return undefined
    const index = this.parent.children.indexOf(this)
    return index >= 0 && index < this.parent.children.length - 1
      ? this.parent.children[index + 1]
      : undefined
  }

  get firstChild(): TestRow | undefined {
    return this.children[0]
  }

  get lastChild(): TestRow | undefined {
    return this.children[this.children.length - 1]
  }

  get level(): number {
    return this.parent ? this.parent.level + 1 : 0
  }

  get prevInOutline(): TestRow | undefined {
    return this.outline.prevInOutline(this)
  }

  get nextInOutline(): TestRow | undefined {
    return this.outline.nextInOutline(this)
  }

  get firstLeaf(): TestRow {
    return this.firstChild ? this.firstChild.firstLeaf : this
  }

  get lastLeaf(): TestRow {
    if (!this.lastChild) return this
    return this.lastChild.lastLeaf
  }

  get descendants(): TestRow[] {
    const rows: TestRow[] = []
    const stack = [...this.children].reverse()
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) break
      rows.push(current)
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push(current.children[index])
      }
    }
    return rows
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name]
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value)
  }

  removeAttribute(name: string): void {
    delete this.attributes[name]
  }

  isAncestor(row: TestRow): boolean {
    let current = row.parent
    while (current) {
      if (current === this) return true
      current = current.parent
    }
    return false
  }

  isDescendant(row: TestRow): boolean {
    return row.isAncestor(this)
  }
}

type TestRowSource = {
  type?: string
  text?: string | TestText
  attributes?: Record<string, string>
}

function makeText(value: string): TestText {
  return {
    string: value,
    toHTML: () => value
  }
}

function normalizeText(value: string | TestText): TestText {
  if (typeof value === 'string') {
    return makeText(value)
  }
  return value
}

export function buildOutline(nodes: TestNode[]): BuildResult {
  const byKey: Record<string, TestRow> = {}
  const outline = new TestOutline(nodes, byKey)
  return { outline, byKey }
}
