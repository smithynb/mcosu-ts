/** Normalize an adapter path while preventing traversal or native absolute paths. */
export function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    throw new Error('Paths must stay inside the selected osu! folder.')
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Paths must stay inside the selected osu! folder.')
  }
  return segments.join('/')
}

export function relativePathSegments(path: string): string[] {
  const normalized = normalizeRelativePath(path)
  return normalized.length === 0 ? [] : normalized.split('/')
}
