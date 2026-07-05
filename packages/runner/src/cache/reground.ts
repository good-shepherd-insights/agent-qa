// Deterministic re-ground seam (Phase 356, CACHE-03 / D-13).
// CRITICAL: storage-neutral — no node:* imports. The GroundingStrategy seam is the
// thin rung Phase 357 absorbs into the full ref→tree-search→visual ladder; only the
// matcher body changes, never this contract. The default matcher re-derives a fresh
// Ref from a role+nameNormalized(+ordinal) descriptor against a fresh observation and
// returns null on no match (the fall-through-to-replan signal).

import type { ElementInfo, Ref } from '@vostride/agent-qa-schema'
import type { GroundedLocator } from './value.js'

export interface GroundingStrategy {
  reground(locator: GroundedLocator, elements: readonly ElementInfo[]): Ref | null
}

export const deterministicDescriptorMatcher: GroundingStrategy = {
  reground(locator, elements) {
    const matches = elements.filter(
      (element) =>
        element.role === locator.role && element.nameNormalized === locator.nameNormalized,
    )
    const match = matches[locator.ordinal ?? 0]
    return match ? match.ref : null
  },
}
