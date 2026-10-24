// Runtime half of the v54 deletion bar. Lists are hand-spelled in declaration order;
// their companion type assertions live in release-gate.test-d.ts (Plan 12 F-05/F-09/F-10/F-11).
import { describe, expect, it } from 'vitest'
import { SEED_POLICIES } from '../../baseline/profile-key'
import { FLOOR_AXES } from '../../stats/decision-vector'
import { FLOOR_REFUSAL_KINDS, FLOOR_SPLITS } from '../floor-artefact'
import { GATE_INCONCLUSIVE_REASONS } from '../release-gate'

describe('415 gate closed sets (v54 runtime bar)', () => {
  it('declares exactly the ten gate inconclusive reasons, in declaration order', () => {
    // prettier-ignore
    expect([...GATE_INCONCLUSIVE_REASONS]).toEqual(['missing-baseline', 'incomparable-baseline', 'missing-floor', 'stale-baseline', 'stale-floor', 'seed-regime-mismatch', 'harness-errors', 'never-scored', 'refusal-population-differs', 'no-decision-vector'])
  })

  it('declares exactly the six floor axes, in declaration order', () => {
    // prettier-ignore
    expect([...FLOOR_AXES]).toEqual(['headline', 'elementIdentity', 'value', 'opClass', 'sideEffect', 'loop'])
  })

  it('declares exactly the three floor splits, in declaration order', () => {
    expect([...FLOOR_SPLITS]).toEqual(['natural', 'held-out-shared', 'held-out-private'])
  })

  it('declares exactly the two seed policies, in declaration order', () => {
    expect([...SEED_POLICIES]).toEqual(['none', 'declared'])
  })

  it('declares exactly the three floor refusal kinds, in declaration order', () => {
    expect([...FLOOR_REFUSAL_KINDS]).toEqual([
      'zero-floor-without-explanation', 'below-protocol-minimum', 'unusable-measurement',
    ])
  })
})
