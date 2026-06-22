const TRAILING_BADGE = /\s*(?:\([\s\d]*\d[\s\d]*\)|\[[\s\d]*\d[\s\d]*\]|[•·●]|\s\d+)\s*$/

/**
 * Normalizes app-observed accessible-name data into the stable nameNormalized value.
 */
export function normalizeAccessibleName(raw: string): string {
  const input = raw ?? ''
  const collapsed = input.trim().replace(/\s+/g, ' ')
  const stripped = collapsed.replace(TRAILING_BADGE, '').trimEnd()
  return stripped.toLowerCase()
}
