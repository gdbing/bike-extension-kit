export function isFileUrl(value: string): boolean {
  return value.toLowerCase().startsWith('file:')
}

export function hasUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

export function resolveRelativeFileUrl(baseFileUrl: string, relativePath: string): string | null {
  if (!isFileUrl(baseFileUrl)) return null
  const baseDir = getBaseFileUrl(baseFileUrl)
  if (!baseDir) return null

  const basePath = baseDir.slice('file://'.length)
  const hasLeadingSlash = basePath.startsWith('/')
  const baseSegments = basePath.split('/').filter((segment) => segment.length > 0)
  const relativeSegments = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').split('/')

  const normalizedSegments = baseSegments.slice()
  for (const rawSegment of relativeSegments) {
    const segment = rawSegment.trim()
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop()
      }
      continue
    }
    normalizedSegments.push(encodePathSegment(segment))
  }

  const normalizedPath = `${hasLeadingSlash ? '/' : ''}${normalizedSegments.join('/')}`
  return `file://${normalizedPath}`
}

function getBaseFileUrl(fileUrl: string): string | null {
  const lastSlash = fileUrl.lastIndexOf('/')
  if (lastSlash === -1) return null
  return fileUrl.slice(0, lastSlash + 1)
}

function encodePathSegment(segment: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(segment))
  } catch {
    return encodeURIComponent(segment)
  }
}
