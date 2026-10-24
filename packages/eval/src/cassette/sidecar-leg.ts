import type { Action, ActionAnnotation } from '@vostride/agent-qa-schema'

/** Stable same-screen descriptor for a recorded gold target (D-03/D-10). */
export interface GoldAnchorDescriptor {
  /** Recorded accessibility role used for semantic identity (D-03). */
  role: string
  /** Recorded normalized accessible name used for semantic identity (D-03). */
  nameNormalized: string
  /** Position among elements sharing the same role and normalized name (D-03). */
  ordinal: number
  /** Evidence-only recorded ref; it is never part of cross-run identity (D-03). */
  ref?: string
}

/** Matcher inputs projected from one recorded decision (D-03). */
export interface CassetteSidecarLeg {
  /** Eval-owned copy of the recorded action selected by the planner (D-03). */
  goldAction: Action
  /** Recorded verb copied verbatim; matcher class semantics are applied later (D-03). */
  opClass: string
  /** Recorded value for value-bearing operations; absence is not fabricated (D-03). */
  goldValue?: string
  /** Resolved semantic target; legitimately absent for coordinate-only actions (D-10). */
  goldAnchor?: GoldAnchorDescriptor
  /** Gold target plus action-equivalent wrappers or descendants (D-03). */
  equivalenceSet: readonly GoldAnchorDescriptor[]
  /** Recorded interaction geometry used by coordinate matching (D-03). */
  annotation?: ActionAnnotation
}
