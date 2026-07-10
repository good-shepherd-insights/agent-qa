/**
 * ONE canonical-JSON implementation (366 D-15). The same recursive-key-sort serialization
 * serves extraction receipt hashing and replay exchange-args / identity matching so producer
 * and consumer share one hash. Object keys sort recursively, array order is retained, and
 * primitives pass through unchanged. Hoisted verbatim from extract/receipt.ts — extraction
 * hashing stays byte-identical after the move.
 */
export function canonicalValue(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonicalValue)
  if (input === null || typeof input !== 'object') return input

  const source = input as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    sorted[key] = canonicalValue(source[key])
  }
  return sorted
}

/** Canonical serialization of a value: recursive key sort + stable JSON. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}
