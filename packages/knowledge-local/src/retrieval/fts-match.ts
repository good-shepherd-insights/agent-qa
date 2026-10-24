/** One deterministic, parameter-bound FTS5 serving contract for every lexical read path. */
export const LEXICAL_MATCH_SEMANTICS = 'quoted-token-or-v1' as const

export function buildLexicalMatchExpression(text: string): string {
  const seen = new Set<string>()
  const clauses: string[] = []

  for (const token of text.split(/\s+/)) {
    if (token === '' || seen.has(token)) continue
    seen.add(token)
    clauses.push(`"${token.replaceAll('"', '""')}"`)
  }

  return clauses.join(' OR ')
}
