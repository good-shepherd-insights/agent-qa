import { OP_CLASS_MAP } from './op-class'

/** D-02 named, discrete element-identity levels shared by every matcher consumer. */
export type IdentityLadderLevel =
  | 'full'
  | 'ordinal-only-differs'
  | 'role-matches-name-differs'
  | 'name-matches-role-differs'
  | 'within-tolerance'
  | 'miss'

/**
 * The D-04 measurement constitution. It is deliberately not caller-injectable and is stamped
 * on every score breakdown and metrics report. Every tuned constant lives here; changing any
 * material value requires a matcherVersion bump, enforced by the pinned-material guard test.
 * Phase 370 applies the same versioned-artifact discipline to its judge rubric.
 */
export const MATCHER_CONFIG = Object.freeze({
  matcherVersion: 1,
  opClass: OP_CLASS_MAP,
  identityLadder: Object.freeze({
    full: 1,
    'ordinal-only-differs': 0.75,
    'role-matches-name-differs': 0.4,
    'name-matches-role-differs': 0.25,
    'within-tolerance': 0.6,
    miss: 0,
  } as const satisfies { [T in IdentityLadderLevel]: number }),
  tier3: Object.freeze({
    distanceToleranceRatio: 0.05,
  } as const),
  valueMidBand: Object.freeze({
    low: 0.4,
    high: 0.9,
  } as const),
} as const)

/** Exact deeply-readonly shape of the single exported matcher constitution. */
export type MatcherConfig = typeof MATCHER_CONFIG
