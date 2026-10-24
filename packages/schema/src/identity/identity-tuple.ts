/**
 * THE one canonical collision-free tuple encoding for product/scope/file/test identities
 * (ABRF-02, D-14 stable identity). JSON array serialization is injective over string tuples:
 * every quote/backslash/control character is escaped and the array form distinguishes both
 * part boundaries and arity, so distinct tuples never collide regardless of what delimiters
 * their parts contain. Keys are IN-MEMORY join/dedup/admission identities — never a storage
 * schema; projection columns stay separate. Equality is exact code-unit equality with NO
 * unicode normalization by design, matching SQLite's byte equality on the projection columns.
 */
export function identityTupleKey(parts: readonly string[]): string {
  return JSON.stringify(parts)
}
