// Deterministic re-ground seam — ABSORBED onto the shared matcher (Phase 357, D-12).
// CRITICAL: storage-neutral — no node:* imports. The GroundingStrategy seam contract is
// UNCHANGED: reground(locator, elements) => Ref | null, where null is the
// fall-through-to-replan signal. Only the body changed: it now delegates to the shared
// grounding matcher (grounding/matcher.ts) so live grounding and cache re-grounding run
// on one precedence ladder. The 356 first-pick body is gone — ambiguity (≥2 survivors,
// no uniquely-selecting ordinal) AND no-match both collapse to null on this cache path
// (Q4: invalidate → replan; a stale descriptor never drives a wrong-element pick,
// T-357-03a). The live path's distinct is_error mapping lives in the gate/loop (Plans
// 04/07) — the cache seam deliberately erases the resolved/ambiguous/no-match distinction
// down to Ref | null, keeping the 356 D-13 hit-ladder contract byte-compatible.

import type { ElementInfo, Ref } from '@vostride/agent-qa-schema'
import { matchDescriptor } from '../grounding/matcher.js'
import type { GroundedLocator } from './value.js'

export interface GroundingStrategy {
  reground(locator: GroundedLocator, elements: readonly ElementInfo[]): Ref | null
}

export const deterministicDescriptorMatcher: GroundingStrategy = {
  reground(locator, elements) {
    // nameNormalized passthrough lane — the locator is already normalized (Pitfall 6).
    const result = matchDescriptor({
      descriptor: {
        role: locator.role,
        nameNormalized: locator.nameNormalized,
        ordinal: locator.ordinal,
      },
      elements,
    })
    // Cache path collapses ambiguous + no-match (+ rejected) to the replan signal.
    return result.kind === 'resolved' ? result.ref : null
  },
}
