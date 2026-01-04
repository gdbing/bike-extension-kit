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

export interface TextAttributeRun {
  start: number
  end: number
  name: string
  value?: string
}

export interface TestText {
  string: string
  attributeAt?: (name: string, index: number) => string | null
  attributesAt?: (index: number) => Record<string, string>
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
  attributes: Record<string, string>
}

export interface OutlineNode {
  text: string
  type?: RowType
  key?: string
  link?: string
  attributes?: Record<string, string>
  textAttributes?: TextAttributeRun[]
  children?: OutlineNode[]
}

export interface BuildResult {
  root: TestRow
  byKey: Record<string, TestRow>
}

function makeText(value: string, link?: string, textAttributes?: TextAttributeRun[]): TestText {
  const runs = textAttributes ? [...textAttributes] : []
  if (link) {
    runs.push({ name: 'a', start: 0, end: value.length, value: link })
  }

  if (runs.length === 0) {
    return { string: value }
  }

  const normalized = runs.filter(run => run.end > run.start)

  return {
    string: value,
    attributeAt: (name: string, index: number) => {
      if (index < 0 || index >= value.length) return null
      const match = normalized.find(run => run.name === name && index >= run.start && index < run.end)
      if (!match) return null
      return match.value ?? ''
    },
    attributesAt: (index: number) => {
      if (index < 0 || index >= value.length) return {}
      const attributes: Record<string, string> = {}
      for (const run of normalized) {
        if (index >= run.start && index < run.end) {
          attributes[run.name] = run.value ?? ''
        }
      }
      return attributes
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
    children: [],
    attributes: {}
  }

  const byKey: Record<string, TestRow> = {}

  const createChildren = (items: OutlineNode[], parent: TestRow) => {
    let previous: TestRow | undefined
    for (const item of items) {
      const row: TestRow = {
        id: `row-${++idCounter}`,
        text: makeText(item.text, item.link, item.textAttributes),
        type: item.type ?? 'row',
        level: parent.level + 1,
        parent,
        children: [],
        attributes: item.attributes ? { ...item.attributes } : {}
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
