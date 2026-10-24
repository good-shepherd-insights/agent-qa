// Sovereignty differential 4 — DENY FINALITY (Phase 391, PROP-05, plan 05) — RE-SPELLED 2026-10-01
// (432-19, D-14/D-15).
//
// spec/v2/qa-agent-and-surfaces.md §5 stated the sovereignty rule as "a grant satisfies an ask but
// never overrides a deny/restricted". This file drove the shipped gate (`evaluate`) with a covering
// standing approval and showed it satisfying an ask on a class while never overriding a `restricted`
// verdict on the identical class, by each of the three routes to `restricted`. 432-18 deleted the
// grant ledger; 432-19 deletes the gate, its ask, its `StandingApprovalReader` port and the
// `StandingApprovalGrant` contract. There is no grant to satisfy anything and no verdict to override,
// so the differential is now two facts:
//
//   1. ABSENCE: no gate, no reader, no grant contract — the thing the rule constrained is gone, and a
//      returning one would be seen here.
//   2. CLASSIFICATION, RETAINED: each of the three routes still classifies `restricted` (eval scores
//      side effects with this tier), on the same identical-name corpus the differential used, so a
//      reader can see the tier was never what moved.

import * as schema from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import * as safety from '@vostride/agent-qa-safety'
import { classifyRisk } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

/** The class the declared-tier and unrecognized routes carry; the name lexicon does not fire on it. */
const ASK_TIER_CLASS = 'fn:fixture.deny-finality'

/** A class the HARD name lexicon fires on, via the `shutdown` token. */
const LEXICON_CLASS = 'fn:fixture.shutdown.now'

describe('differential 4: a covering standing approval never overrides a restricted verdict', () => {
  it('C432-NO-EVALUATE: there is no gate, no standing-approval reader and no grant contract to override anything', () => {
    for (const retired of ['evaluate', 'resolveAsk', 'NO_STANDING_APPROVALS', 'DENY_CONFIRM']) {
      expect(Object.keys(safety), retired).not.toContain(retired)
    }
    // The grant contract was type-only, and its runtime footprint (the scope constant) left with the
    // MCP credential in 432-21, so the census reads the barrel for anything grant-shaped instead.
    expect(Object.keys(schema).filter((key) => /StandingApproval(Grant|Reader)/.test(key))).toEqual([])
  })

  it('C432-EVAL-RISK-PARITY: the admitted twin still classifies at its declared ask tier', () => {
    const admitted: RiskActionDescriptor = { name: ASK_TIER_CLASS, recognized: true, declaredTier: 'mutating-shared' }
    expect(classifyRisk(admitted)).toEqual({ riskTier: 'mutating-shared', reason: 'declared tier: mutating-shared' })
  })

  it('C432-EVAL-RISK-PARITY: route 1 (declared tier) — the identical class at `restricted` classifies restricted', () => {
    expect(classifyRisk({ name: ASK_TIER_CLASS, recognized: true, declaredTier: 'restricted' })).toEqual({
      riskTier: 'restricted',
      reason: 'declared tier: restricted',
    })
  })

  it('C432-EVAL-RISK-PARITY: route 2 (unrecognized fail-safe) — the identical class, unrecognized, classifies restricted', () => {
    expect(classifyRisk({ name: ASK_TIER_CLASS, recognized: false })).toEqual({
      riskTier: 'restricted',
      reason: 'unrecognized action fail-safe',
    })
  })

  it('C432-EVAL-RISK-PARITY: route 3 (hard name lexicon) — a declared ask tier is raised to restricted', () => {
    expect(classifyRisk({ name: LEXICON_CLASS, recognized: true, declaredTier: 'mutating-shared' })).toEqual({
      riskTier: 'restricted',
      reason: `hard destructive lexicon: ${LEXICON_CLASS}`,
    })
  })
})
