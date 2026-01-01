export type RowType = 'row' | 'note'

export interface TestText {
  string: string
  attributeAt?: (name: string, index: number) => string | null
}

export interface TestRow {
  id: string
  text: TestText
  type: RowType
  level: number
  parent?: TestRow
  firstChild?: TestRow
  nextSibling?: TestRow
  nextInOutline?: TestRow
  children: TestRow[]
  lastLeaf?: TestRow
}

export interface OutlineNode {
  text: string
  type?: RowType
  key?: string
  link?: string
  children?: OutlineNode[]
}

export interface BuildResult {
  root: TestRow
  byKey: Record<string, TestRow>
}

function makeText(value: string, link?: string): TestText {
  if (!link) {
    return { string: value }
  }

  return {
    string: value,
    attributeAt: (name: string, index: number) => {
      if (name !== 'a') return null
      if (index < 0 || index >= value.length) return null
      return link
    }
  }
}

export function buildOutline(nodes: OutlineNode[]): BuildResult {
  let idCounter = 0
  const root: TestRow = {
    id: 'root',
    text: { string: '' },
    type: 'row',
    level: 0,
    children: []
  }

  const byKey: Record<string, TestRow> = {}

  const createChildren = (items: OutlineNode[], parent: TestRow) => {
    let previous: TestRow | undefined
    for (const item of items) {
      const row: TestRow = {
        id: `row-${++idCounter}`,
        text: makeText(item.text, item.link),
        type: item.type ?? 'row',
        level: parent.level + 1,
        parent,
        children: []
      }

      if (!parent.firstChild) {
        parent.firstChild = row
      }
      parent.children.push(row)

      if (previous) {
        previous.nextSibling = row
      }

      if (item.key) {
        byKey[item.key] = row
      }

      if (item.children?.length) {
        createChildren(item.children, row)
      }

      previous = row
    }
  }

  createChildren(nodes, root)

  // Pre-order traversal to populate nextInOutline pointers
  const preorder: TestRow[] = []
  const visit = (row?: TestRow) => {
    if (!row) return
    preorder.push(row)
    visit(row.firstChild)
    visit(row.nextSibling)
  }
  visit(root.firstChild)

  for (let index = 0; index < preorder.length; index += 1) {
    const current = preorder[index]
    current.nextInOutline = preorder[index + 1]
  }

  if (preorder.length > 0) {
    root.lastLeaf = preorder[preorder.length - 1]
  }

  return { root, byKey }
}
