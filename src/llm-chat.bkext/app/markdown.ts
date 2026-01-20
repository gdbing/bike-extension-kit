import type { AttributedString, RowType } from 'bike/app'

export type TextAttributeRun = {
  start: number
  end: number
  name: string
  value?: string
}

export type TextDeleteRange = {
  start: number
  end: number
}

export type ParsedMarkdownRow = {
  text: string
  type?: RowType
  attributes?: Record<string, string>
  runs?: TextAttributeRun[]
  children: ParsedMarkdownRow[]
}

type InlineState = {
  strong: boolean
  em: boolean
  code: boolean
  strike: boolean
  link: string | null
}

const EMPTY_STATE: InlineState = {
  strong: false,
  em: false,
  code: false,
  strike: false,
  link: null
}

const INLINE_MARKERS = {
  strong: '**',
  em: '*',
  code: '`',
  strike: '~~'
}

export function attributedTextToMarkdown(text: AttributedString): string {
  const value = text.string
  if (!value) return ''

  const getAttribute = (name: string, index: number): string | null => {
    if (typeof text.attributesAt === 'function') {
      const attributes = text.attributesAt(index, 'downstream')
      if (Object.prototype.hasOwnProperty.call(attributes, name)) {
        const value = attributes[name]
        return value == null ? '' : value
      }
    }
    if (typeof text.attributeAt === 'function') {
      const value = text.attributeAt(name, index, 'downstream')
      return value == null ? null : value
    }
    return null
  }

  const stateAt = (index: number): InlineState => {
    const strong = getAttribute('strong', index) !== null
    const em = getAttribute('em', index) !== null
    const code = getAttribute('code', index) !== null
    const strike = getAttribute('s', index) !== null
    const link = getAttribute('a', index)
    return {
      strong,
      em,
      code,
      strike,
      link
    }
  }

  const openMarkers = (prev: InlineState, next: InlineState): string => {
    let result = ''
    if (prev.link !== next.link && next.link) {
      result += '['
    }
    if (!prev.strong && next.strong) result += INLINE_MARKERS.strong
    if (!prev.em && next.em) result += INLINE_MARKERS.em
    if (!prev.strike && next.strike) result += INLINE_MARKERS.strike
    if (!prev.code && next.code) result += INLINE_MARKERS.code
    return result
  }

  const closeMarkers = (prev: InlineState, next: InlineState): string => {
    let result = ''
    if (prev.code && !next.code) result += INLINE_MARKERS.code
    if (prev.strike && !next.strike) result += INLINE_MARKERS.strike
    if (prev.em && !next.em) result += INLINE_MARKERS.em
    if (prev.strong && !next.strong) result += INLINE_MARKERS.strong
    if (prev.link && prev.link !== next.link) result += `](${prev.link})`
    return result
  }

  let output = ''
  let previous = EMPTY_STATE

  for (let index = 0; index < value.length; index += 1) {
    const next = stateAt(index)
    if (!statesEqual(previous, next)) {
      output += closeMarkers(previous, next)
      output += openMarkers(previous, next)
      previous = next
    }
    output += value[index]
  }

  output += closeMarkers(previous, EMPTY_STATE)
  return output
}

export function parseMarkdownLineTokens(line: string): {
  text: string
  type?: RowType
  attributes?: Record<string, string>
  runs?: TextAttributeRun[]
  deleteRanges: TextDeleteRange[]
} {
  if (line.startsWith('# ') && !line.startsWith('##')) {
    const content = line.slice(2)
    const parsed = parseInlineMarkdownTokens(content)
    return {
      text: parsed.text,
      type: 'heading',
      runs: parsed.runs,
      deleteRanges: mergeDeleteRanges(parsed.deleteRanges, 2)
    }
  }

  const taskPrefix = parseTaskPrefix(line)
  if (taskPrefix) {
    const parsed = parseInlineMarkdownTokens(taskPrefix.text)
    return {
      text: parsed.text,
      type: 'task',
      attributes: taskPrefix.checked ? { done: new Date().toISOString() } : undefined,
      runs: parsed.runs,
      deleteRanges: mergeDeleteRanges(parsed.deleteRanges, taskPrefix.prefixLength)
    }
  }

  const orderedMatch = line.match(/^(\d+)\.\s+/)
  if (orderedMatch) {
    const content = line.slice(orderedMatch[0].length)
    const parsed = parseInlineMarkdownTokens(content)
    return {
      text: parsed.text,
      type: 'ordered',
      runs: parsed.runs,
      deleteRanges: mergeDeleteRanges(parsed.deleteRanges, orderedMatch[0].length)
    }
  }

  const unorderedMatch = line.match(/^(?:-|\*|\u2022)\s+/)
  if (unorderedMatch) {
    const content = line.slice(unorderedMatch[0].length)
    const parsed = parseInlineMarkdownTokens(content)
    return {
      text: parsed.text,
      type: 'unordered',
      runs: parsed.runs,
      deleteRanges: mergeDeleteRanges(parsed.deleteRanges, unorderedMatch[0].length)
    }
  }

  const quoteMatch = line.match(/^>\s?/)
  if (quoteMatch) {
    const content = line.slice(quoteMatch[0].length)
    const parsed = parseInlineMarkdownTokens(content)
    return {
      text: parsed.text,
      type: 'quote',
      runs: parsed.runs,
      deleteRanges: mergeDeleteRanges(parsed.deleteRanges, quoteMatch[0].length)
    }
  }

  const parsed = parseInlineMarkdownTokens(line)
  return {
    text: parsed.text,
    runs: parsed.runs,
    deleteRanges: parsed.deleteRanges
  }
}

export function parseMarkdownToRows(markdown: string): ParsedMarkdownRow[] {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const rows: ParsedMarkdownRow[] = []
  const stack: ParsedMarkdownRow[] = []
  let indentUnit: string | null = null
  let inCodeFence = false

  const pushRow = (row: ParsedMarkdownRow, indent: number) => {
    if (indent <= 0) {
      rows.push(row)
      stack.length = 0
      stack[0] = row
      return
    }

    const clampedIndent = Math.min(indent, stack.length)
    const parent = stack[clampedIndent - 1]
    if (parent) {
      parent.children.push(row)
    } else {
      rows.push(row)
    }
    stack.length = clampedIndent
    stack[clampedIndent] = row
  }

  const detectIndentUnit = (line: string): string | null => {
    const match = line.match(/^[\t ]+/)
    if (!match) return null
    return match[0]
  }

  const splitIndent = (line: string): { indent: number; content: string } => {
    if (!indentUnit) {
      const detected = detectIndentUnit(line)
      if (detected) {
        indentUnit = detected
      }
    }

    let indent = 0
    let content = line
    if (indentUnit) {
      while (content.startsWith(indentUnit)) {
        indent += 1
        content = content.slice(indentUnit.length)
      }
      if (!indentUnit.includes('\t')) {
        while (content.startsWith('\t')) {
          indent += 1
          content = content.slice(1)
        }
      }
    }
    return { indent, content }
  }

  for (const line of lines) {
    const { indent, content } = splitIndent(line)
    const trimmed = content.trim()
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence
      continue
    }

    if (inCodeFence) {
      pushRow(
        {
          text: content,
          type: 'code',
          children: []
        },
        indent
      )
      continue
    }

    const parsed = parseMarkdownLine(content)
    pushRow(
      {
        text: parsed.text,
        type: parsed.type,
        attributes: parsed.attributes,
        runs: parsed.runs,
        children: []
      },
      indent
    )
  }

  return rows
}

export function parseMarkdownLine(line: string): {
  text: string
  type?: RowType
  attributes?: Record<string, string>
  runs?: TextAttributeRun[]
} {
  const parsed = parseMarkdownLineTokens(line)
  return {
    text: parsed.text,
    type: parsed.type,
    attributes: parsed.attributes,
    runs: parsed.runs
  }
}

function parseTaskPrefix(line: string): { checked: boolean; text: string; prefixLength: number } | null {
  const bullet = line.match(/^(?:-|\*|\u2022)\s+\[( |x|X)\]\s+/)
  if (bullet) {
    return {
      checked: bullet[1].toLowerCase() === 'x',
      text: line.slice(bullet[0].length),
      prefixLength: bullet[0].length
    }
  }
  const plain = line.match(/^\[( |x|X)\]\s+/)
  if (plain) {
    return {
      checked: plain[1].toLowerCase() === 'x',
      text: line.slice(plain[0].length),
      prefixLength: plain[0].length
    }
  }
  return null
}

export function parseInlineMarkdown(input: string): { text: string; runs: TextAttributeRun[] } {
  const parsed = parseInlineMarkdownTokens(input)
  return { text: parsed.text, runs: parsed.runs }
}

export function parseInlineMarkdownTokens(input: string): {
  text: string
  runs: TextAttributeRun[]
  deleteRanges: TextDeleteRange[]
} {
  let output = ''
  const runs: TextAttributeRun[] = []
  const deleteRanges: TextDeleteRange[] = []
  const active: Record<string, number | null> = {
    strong: null,
    em: null,
    code: null,
    s: null
  }

  const hasClosing = (token: string, start: number): boolean => {
    return input.indexOf(token, start) !== -1
  }

  let index = 0
  while (index < input.length) {
    if (active.code !== null) {
      if (input[index] === '`') {
        deleteRanges.push({ start: index, end: index + 1 })
        const start = active.code
        active.code = null
        if (start !== null) {
          runs.push({ start, end: output.length, name: 'code' })
        }
        index += 1
        continue
      }
      output += input[index]
      index += 1
      continue
    }

    if (input.startsWith('**', index) && (active.strong !== null || hasClosing('**', index + 2))) {
      deleteRanges.push({ start: index, end: index + 2 })
      toggleInline(active, runs, 'strong', output.length)
      index += 2
      continue
    }

    if (input[index] === '*' && (active.em !== null || hasClosing('*', index + 1))) {
      deleteRanges.push({ start: index, end: index + 1 })
      toggleInline(active, runs, 'em', output.length)
      index += 1
      continue
    }

    if (input.startsWith('~~', index) && (active.s !== null || hasClosing('~~', index + 2))) {
      deleteRanges.push({ start: index, end: index + 2 })
      toggleInline(active, runs, 's', output.length)
      index += 2
      continue
    }

    if (input[index] === '`' && (active.code !== null || hasClosing('`', index + 1))) {
      deleteRanges.push({ start: index, end: index + 1 })
      toggleInline(active, runs, 'code', output.length)
      index += 1
      continue
    }

    if (input[index] === '[') {
      const closeBracket = input.indexOf(']', index + 1)
      const openParen = closeBracket !== -1 ? input.indexOf('(', closeBracket) : -1
      const closeParen = openParen !== -1 ? input.indexOf(')', openParen) : -1
      if (closeBracket !== -1 && openParen === closeBracket + 1 && closeParen !== -1) {
        const linkText = input.slice(index + 1, closeBracket)
        const url = input.slice(openParen + 1, closeParen)
        const parsed = parseInlineMarkdownTokens(linkText)
        const start = output.length
        output += parsed.text
        const end = output.length
        if (parsed.runs.length) {
          for (const run of parsed.runs) {
            runs.push({
              start: start + run.start,
              end: start + run.end,
              name: run.name,
              value: run.value
            })
          }
        }
        for (const range of parsed.deleteRanges) {
          deleteRanges.push({
            start: index + 1 + range.start,
            end: index + 1 + range.end
          })
        }
        if (end > start) {
          runs.push({ start, end, name: 'a', value: url })
        }
        deleteRanges.push({ start: index, end: index + 1 })
        deleteRanges.push({ start: closeBracket, end: closeBracket + 1 })
        deleteRanges.push({ start: openParen, end: openParen + 1 })
        deleteRanges.push({ start: openParen + 1, end: closeParen })
        deleteRanges.push({ start: closeParen, end: closeParen + 1 })
        index = closeParen + 1
        continue
      }
    }

    output += input[index]
    index += 1
  }

  closeRemaining(active, runs, output.length)
  return { text: output, runs, deleteRanges }
}

function toggleInline(
  active: Record<string, number | null>,
  runs: TextAttributeRun[],
  name: 'strong' | 'em' | 'code' | 's',
  index: number
): void {
  const start = active[name]
  if (start !== null && start !== undefined) {
    const attributeName = name === 's' ? 's' : name
    runs.push({ start, end: index, name: attributeName })
    active[name] = null
  } else {
    active[name] = index
  }
}

function closeRemaining(
  active: Record<string, number | null>,
  runs: TextAttributeRun[],
  end: number
): void {
  for (const [name, start] of Object.entries(active)) {
    if (start === null || start === undefined) continue
    const attributeName = name === 's' ? 's' : name
    runs.push({ start, end, name: attributeName })
  }
}

function statesEqual(a: InlineState, b: InlineState): boolean {
  return (
    a.strong === b.strong &&
    a.em === b.em &&
    a.code === b.code &&
    a.strike === b.strike &&
    a.link === b.link
  )
}

function mergeDeleteRanges(ranges: TextDeleteRange[], offset: number): TextDeleteRange[] {
  const merged = ranges.map(range => ({
    start: range.start + offset,
    end: range.end + offset
  }))
  merged.push({ start: 0, end: offset })
  return merged
}
