/**
 * 413 D-15 corpus digest — the identity of the committed entry SET.
 *
 * The `computeBatchKey` precedent (match/metrics.ts) taken over whole corpus entries rather
 * than bare ids: the digest keys on every committed byte of membership, so the D-09 relative
 * handoff-path rewrite deliberately changes it. That is the point — a census filed under a
 * digest names exactly the corpus it was derived from, and a rewritten corpus is a different
 * corpus. Sorting by cassetteId first makes the value order-insensitive over the loaded root.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { CorpusEntry } from '../labels/corpus-entry'

/** sha256hex over the canonical cassetteId-sorted corpus entry list (D-15). */
export function computeCorpusDigest(entries: readonly CorpusEntry[]): string {
  const sorted = [...entries].sort((first, second) =>
    first.cassetteId < second.cassetteId ? -1 : first.cassetteId > second.cassetteId ? 1 : 0,
  )
  return sha256hex(canonicalJson(sorted))
}
