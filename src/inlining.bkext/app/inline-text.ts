import type { Row } from 'bike/app'

export function serializeText(row: Row): string {
  if (row.text.string === '') return ''
  return row.text.toHTML()
}
