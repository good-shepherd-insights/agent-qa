/**
 * Phase 377 read-side mirror of memory.md §7.3.2 supersession grouping.
 * Phase 378's write-side disposition must share this helper so Curator and retrieval collapse use
 * the same normalized, order-independent anchor identity (377 Pitfall 7).
 */
import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import type { Anchor } from './anchor'
import { normalizeAnchor } from './normalize-anchor'

/** Hashes a normalized anchor set without mutating the caller's array. */
export function supersessionKey(anchors: readonly Anchor[]): string {
  const sortedNormalized = anchors.map(normalizeAnchor)
  sortedNormalized.sort((left, right) => {
    const leftJson = canonicalJson(left)
    const rightJson = canonicalJson(right)
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0
  })

  return sha256hex(canonicalJson(sortedNormalized))
}
