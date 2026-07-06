// Redesigned storage-neutral cache port (Phase 356, D-03/D-11/D-12).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no core/model/adapter package imports. Type-only imports, exported interfaces,
// no implementation. This replaces the v1 sub-action trio + StepKeyInput: the port
// is now keyed only by a branded CacheKey and the value is descriptor-only so a
// cached plan never carries a raw ref/selector/coordinate or step data value.

import type { CacheKey } from '@vostride/agent-qa-schema'
import type { Action } from '../platform.js'

/**
 * The subset of the action union that may be persisted in a cached plan (D-08). The
 * non-deterministic AI-assertion verbs — `assertAI` (judge lane) and `extractAI`
 * (extraction lane) — are `Exclude`d from the composed `Action` union so a plan carrying
 * one CANNOT typecheck into a cache write. Plan 10's runtime guard at the write site is the
 * narrowing proof; this static boundary is the belt-and-suspenders (the 356
 * `NonCacheableStepInput` type-level idiom, mirrored at the value shape).
 */
export type CacheablePlannedAction = Exclude<Action, { type: 'assertAI' } | { type: 'extractAI' }>

/**
 * Descriptor-only locator (D-12). Identity is role + nameNormalized (+ a same-screen
 * ordinal), never a ref/selector/coordinates — those are re-derived at replay time
 * against a fresh observation via the GroundingStrategy seam.
 */
export interface GroundedLocator {
  role: string
  nameNormalized: string
  ordinal?: number
}

/**
 * The cached plan value. `plannedActions` are stored in sanitized (locator-free,
 * data-free) form AND statically exclude the AI-assertion verbs (D-08); grounding is carried
 * only by `groundedLocator` descriptors so no run-specific ref/selector/coordinate or step
 * `data` value ever persists (D-12).
 */
export interface CachedPlanValue {
  plannedActions: CacheablePlannedAction[]
  groundedLocator: GroundedLocator[]
  verificationOutcome: 'passed' | 'failed'
}

/**
 * Redesigned per-key cache port (D-11). Get/set/invalidate over a branded CacheKey
 * — the v1 prefix/index sub-action model is dropped. A storage implementation (Plan
 * 05's FsActionCache) implements this interface; runner stays storage-neutral.
 */
export interface ActionPlanCache {
  get(key: CacheKey): Promise<CachedPlanValue | null>
  set(key: CacheKey, value: CachedPlanValue): Promise<void>
  invalidate(key: CacheKey): Promise<void>
}
