import type { GateRemedy } from './remedies'

export type PolicyVerdict = 'allow' | 'ask' | 'deny'

export type RiskTier =
  | 'read-only'
  | 'mutating-local'
  | 'mutating-shared'
  | 'destructive'
  | 'restricted'

export interface ExecutionPolicyResult {
  verdict: PolicyVerdict
  reason: string
  riskTier: RiskTier
  /**
   * What the caller could DO about this decision, typed (400 D-15).
   *
   * REQUIRED AND OFTEN EMPTY, which is the point. An optional member would have let a producer
   * answer "I did not think about it" in the same shape as "there is nothing to offer here", and
   * those are different facts: `[]` is a claim the gate makes — no surface can take anything about
   * this decision — and every arm of `buildDecisionRemedies` has to make it deliberately.
   *
   * IT IS BESIDE `reason`, NEVER INSTEAD OF IT. The prose stays the canonical audit/log text and
   * its bytes are unchanged (T-400-07); this is the machine-readable half each surface projects
   * through `remediesRenderableBy` so a reader is only ever shown a way forward they can take.
   */
  remedies: readonly GateRemedy[]
  /**
   * The same decision, said without naming any surface's affordance (400 gap round 1, D-15).
   *
   * BESIDE `reason`, NEVER INSTEAD OF IT, and the split is the whole repair. `reason` is the
   * CANONICAL sentence: the execution-audit row's text, the bytes `demo/acceptance/399/` published
   * verbatim, the template the runbook gate greps. It names `--trust-session` on two of its arms
   * because a terminal reader can take that. This one names nothing a reader could try, so a
   * surface can show it to anybody — and what to DO travels as `remedies`, projected per surface.
   *
   * REQUIRED, on `remedies`' own recorded argument: an optional member would let a producer answer
   * "I did not think about this decision" in the same bytes as a real answer, and a render that
   * fell back to `reason` on absence would silently re-mint the very defect this closes.
   */
  neutralReason: string
}
