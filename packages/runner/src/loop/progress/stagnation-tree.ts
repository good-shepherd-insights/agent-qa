// Identity-keyed bounded stagnation tree (Phase 358 · CYCLE-02 · D-03 · Pattern 3 · LOOP-02).
//
// CRITICAL: provider-neutral + storage-neutral. No Node builtin imports, no fs/sharp, no
// core/model/adapter package imports — a pure in-memory counter structure, testable without
// the loop, keeping `validate:arch` green.
//
// LOOP-02 DISTINCTION (load-bearing): these are NOT a resurrected blanket per-step
// `maxAttempts` cap (the v1 machinery whose dead config this phase also removes). They are:
//   (1) IDENTITY-KEYED — every counter is scoped to a single element anchor
//       (role + nameNormalized + ordinal, never description/ref) AND a single ladder class,
//       so exhausting one anchor's remediation never starves another's.
//   (2) RESET-ON-PROGRESS — `reset(anchorKey)` wipes an anchor's counts the moment a
//       confirmed local effect lands for it; a legitimately-retried control is never
//       penalized for earlier no-ops.
//   (3) SPEC-DERIVED BOUNDS — the 2/(anchor,class) and 4/anchor limits come straight from
//       §12.16, mirrored as internal constants in the 353 K=2 precedent.
// The permanent LOOP-02 smoke test greps for the deleted v1 retry-machinery identifiers;
// nothing here is named after them.

import type { StagnationClass } from '@vostride/agent-qa-schema'

export type { StagnationClass } from '@vostride/agent-qa-schema'

/**
 * Per-(anchor, class) remediation attempt bound. Internal runner constant; injectable via
 * the StagnationTree constructor for tests only. Do NOT promote to user-facing config or
 * thread through LoopPorts / any config schema (same rule as planning-turn's K budget).
 */
export const DEFAULT_STAGNATION_CLASS_BOUND = 2

/**
 * Per-anchor total no-effect bound (across all classes) → terminal `stepFailed`. Internal
 * runner constant; injectable via the constructor for tests only. Do NOT promote to
 * user-facing config or thread through LoopPorts / any config schema.
 */
export const DEFAULT_STAGNATION_ANCHOR_BOUND = 4

/** The element anchor identity — role + nameNormalized + same-screen ordinal only. */
export interface StagnationAnchorIdentity {
  role: string
  nameNormalized: string
  ordinal: number
}

/**
 * Build the stable anchor key. Uses ONLY role + nameNormalized + ordinal — description and
 * ref are execution detail and are ignored even when supplied, so the key is stable across
 * description/ref churn (the identity contract).
 */
export function buildAnchorKey(anchor: StagnationAnchorIdentity): string {
  return `${anchor.role}|${anchor.nameNormalized}|${anchor.ordinal}`
}

export interface RecordNoEffectResult {
  /** The updated count for this (anchor, class). */
  classCount: number
  /** The updated total count for this anchor (across all classes). */
  totalCount: number
  /** True ⇒ this (anchor, class) reached the class bound. */
  classExhausted: boolean
  /** True ⇒ this anchor reached the total bound → terminal stepFailed. */
  terminal: boolean
}

export interface StagnationSnapshotEntry {
  anchorKey: string
  total: number
  perClass: Record<string, number>
}

interface AnchorRecord {
  perClass: Map<StagnationClass, number>
  total: number
}

export interface StagnationTreeOptions {
  classBound?: number
  anchorBound?: number
}

export class StagnationTree {
  private readonly classBound: number
  private readonly anchorBound: number
  private readonly anchors = new Map<string, AnchorRecord>()

  constructor(options: StagnationTreeOptions = {}) {
    this.classBound = options.classBound ?? DEFAULT_STAGNATION_CLASS_BOUND
    this.anchorBound = options.anchorBound ?? DEFAULT_STAGNATION_ANCHOR_BOUND
  }

  /**
   * Record a no-local-effect observation for `anchorKey` under `stagnationClass`. Increments
   * the per-(anchor,class) counter and the per-anchor total, returning both counts and
   * whether the class / anchor bound was reached.
   */
  recordNoEffect(anchorKey: string, stagnationClass: StagnationClass): RecordNoEffectResult {
    let record = this.anchors.get(anchorKey)
    if (!record) {
      record = { perClass: new Map(), total: 0 }
      this.anchors.set(anchorKey, record)
    }
    const classCount = (record.perClass.get(stagnationClass) ?? 0) + 1
    record.perClass.set(stagnationClass, classCount)
    record.total += 1
    return {
      classCount,
      totalCount: record.total,
      classExhausted: classCount >= this.classBound,
      terminal: record.total >= this.anchorBound,
    }
  }

  /** Clear ALL counts (per-class and total) for an anchor — the reset-on-progress rung. */
  reset(anchorKey: string): void {
    this.anchors.delete(anchorKey)
  }

  /** Emit per-anchor state for the D-07 terminal-fail evidence block. */
  snapshot(): StagnationSnapshotEntry[] {
    const entries: StagnationSnapshotEntry[] = []
    for (const [anchorKey, record] of this.anchors) {
      const perClass: Record<string, number> = {}
      for (const [cls, count] of record.perClass) perClass[cls] = count
      entries.push({ anchorKey, total: record.total, perClass })
    }
    return entries
  }
}
