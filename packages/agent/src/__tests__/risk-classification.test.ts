// The hazard test the research called for by name (Phase 384, Plan 04 — Pitfall 10).
//
// `runs.start`'s risk descriptor was load-bearing while the execution gate existed: had it
// classified `mutating-shared` the gate would have asked, and an ask in a fail-closed context
// denied, so no CI run could have started.
//
// RE-SPELLED 2026-10-01 (432-19, D-15/D-16). The gate (`evaluate`), its ask and its fail-closed
// contexts are deleted, so the VERDICT half of every cell below is gone: nothing reads a descriptor
// to allow or deny. The CLASSIFICATION half stays, because every op still declares its descriptor
// (it is published on the registry's declaration view) and `classifyRisk` is the vocabulary eval
// scores side effects with. These cells run the REAL classifier over the REAL descriptors the specs
// declare, so the claim is about shipped code and not about a restatement of it.

import { classifyRisk, TIER_ORDER } from '@vostride/agent-qa-safety'
import * as safety from '@vostride/agent-qa-safety'
import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { configGetSpec } from '../functions/ops/config-get.js'
import { knowledgeBundlesListSpec } from '../functions/ops/knowledge-bundles-list.js'
import { runsEventsSpec } from '../functions/ops/runs-events.js'
import { runsGetSpec } from '../functions/ops/runs-get.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import { runsStartSpec } from '../functions/ops/runs-start.js'

const READ_OPS = [runsListSpec, runsGetSpec, runsEventsSpec, knowledgeBundlesListSpec, configGetSpec]

describe('runs.start risk classification (Pitfall 10)', () => {
  it('declares the exact descriptor fields that classify mutating-local', () => {
    // Pinned field by field because each one is load-bearing: `recognized` with no
    // `readOnly` puts the floor at mutating-local, `declaredTier` says so explicitly, and
    // the name carries no destructive-lexicon token that could raise the tier above it.
    expect(runsStartSpec.risk).toEqual({
      name: 'fn:runs.start',
      recognized: true,
      declaredTier: 'mutating-local',
    })
    expect(runsStartSpec.risk.readOnly).toBeUndefined()
    expect(runsStartSpec.risk.destructive).toBeUndefined()
  })

  // RE-SPELLED from 'resolves to an ALLOW verdict in ci — the CI deny-lock never forms' and 'allows
  // in EVERY execution context, fail-closed ones included'. There is no verdict and no fail-closed
  // context; the classification those verdicts were computed from is unchanged.
  it('C432-EVAL-RISK-PARITY: classifies mutating-local, the tier it always declared', () => {
    // The recognized floor and the declaration agree, and the classifier keeps the first of two
    // equal-rank proposals, so the reason names the floor.
    expect(classifyRisk(runsStartSpec.risk)).toEqual({
      riskTier: 'mutating-local',
      reason: 'recognized mutating action floor',
    })
  })

  // RE-SPELLED from 'would go RED on a mutating-shared descriptor — the counterfactual'. The
  // counterfactual still classifies higher — which is what eval's side-effect axis would flag — and
  // nothing denies it, because there is no gate to read the tier.
  it('C432-EVAL-RISK-PARITY: a mutating-shared counterfactual classifies higher, and no gate remains to deny it', () => {
    const shared: RiskActionDescriptor = {
      name: 'fn:runs.start',
      recognized: true,
      declaredTier: 'mutating-shared',
    }

    expect(classifyRisk(shared).riskTier).toBe('mutating-shared')
    expect(TIER_ORDER.indexOf('mutating-shared')).toBeGreaterThan(TIER_ORDER.indexOf('mutating-local'))
    expect(Object.keys(safety)).not.toContain('evaluate')
  })
})

describe('read ops classify read-only and are audited anyway (D-11)', () => {
  // RE-SPELLED from 'resolves every read descriptor to allow with exactly one audit row'. The
  // execution-audit row is deleted with the gate (D-17); the read-only classification stays.
  it('C432-EVAL-RISK-PARITY: classifies every read descriptor read-only', () => {
    for (const spec of READ_OPS) {
      expect(classifyRisk(spec.risk), spec.id).toEqual({
        riskTier: 'read-only',
        reason: 'readOnly advisory flag',
      })
    }
  })

  it('names every op descriptor with the fn: prefix so audit rows are attributable', () => {
    for (const spec of [...READ_OPS, runsStartSpec]) {
      expect(spec.risk.name).toBe(`fn:${spec.id}`)
      expect(spec.risk.recognized, spec.id).toBe(true)
    }
  })
})
