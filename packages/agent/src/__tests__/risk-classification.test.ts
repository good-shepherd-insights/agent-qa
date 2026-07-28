// The hazard test the research called for by name (Phase 384, Plan 04 — Pitfall 10).
//
// `runs.start`'s risk descriptor is load-bearing: if it ever classified `mutating-shared`,
// the gate would ask, and an ask in a fail-closed context DENIES — so the whole future
// authoring loop would be unable to start a run in CI. `mutating-local` allows in every
// execution context by ratified spec (execution-safety.md §2.1).
//
// These cases run the REAL `evaluate` over the REAL descriptors the specs declare, so the
// claim is about shipped code and not about a restatement of it. The counterfactual case
// proves the assertion would actually go red if the classification drifted.

import { evaluate } from '@vostride/agent-qa-safety'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import type { ExecutionContext, RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { configGetSpec } from '../functions/ops/config-get.js'
import { knowledgeBundlesListSpec } from '../functions/ops/knowledge-bundles-list.js'
import { runsEventsSpec } from '../functions/ops/runs-events.js'
import { runsGetSpec } from '../functions/ops/runs-get.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import { runsStartSpec } from '../functions/ops/runs-start.js'

/** Every context a capability call can be made in; `ci` and `cloud` are fail-closed. */
const EVERY_CONTEXT: readonly ExecutionContext[] = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
]

interface CapturedSink {
  sink: AuditSink
  executionRows: () => readonly ExecutionAuditRow[]
}

function capturingSink(): CapturedSink {
  const executionRows: ExecutionAuditRow[] = []
  const guardrailRows: GuardrailAuditRow[] = []
  return {
    sink: {
      appendExecutionAudit(row) {
        executionRows.push(row)
      },
      appendGuardrailAudit(row) {
        guardrailRows.push(row)
      },
    },
    executionRows: () => executionRows,
  }
}

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

  it('resolves to an ALLOW verdict in ci — the CI deny-lock never forms', async () => {
    const audit = capturingSink()

    const result = await evaluate(runsStartSpec.risk, 'ci', {}, { auditSink: audit.sink })

    expect(result.riskTier).toBe('mutating-local')
    expect(result.verdict).toBe('allow')
    expect(audit.executionRows()).toHaveLength(1)
  })

  it('allows in EVERY execution context, fail-closed ones included', async () => {
    for (const context of EVERY_CONTEXT) {
      const result = await evaluate(runsStartSpec.risk, context, {})
      expect(result.verdict, context).toBe('allow')
      expect(result.riskTier, context).toBe('mutating-local')
    }
  })

  it('would go RED on a mutating-shared descriptor — the counterfactual', async () => {
    const shared: RiskActionDescriptor = {
      name: 'fn:runs.start',
      recognized: true,
      declaredTier: 'mutating-shared',
    }

    const result = await evaluate(shared, 'ci', {})

    // This is the failure mode the assertions above exist to prevent: an ask in a
    // fail-closed context is a deny, and no CI run could ever start.
    expect(result.riskTier).toBe('mutating-shared')
    expect(result.verdict).toBe('deny')
  })
})

describe('read ops classify read-only and are audited anyway (D-11)', () => {
  it('resolves every read descriptor to allow with exactly one audit row', async () => {
    for (const spec of READ_OPS) {
      const audit = capturingSink()

      const result = await evaluate(spec.risk, 'ci', {}, { auditSink: audit.sink })

      expect(result.riskTier, spec.id).toBe('read-only')
      expect(result.verdict, spec.id).toBe('allow')
      expect(audit.executionRows(), spec.id).toHaveLength(1)
      expect(audit.executionRows()[0], spec.id).toMatchObject({
        action: `fn:${spec.id}`,
        riskTier: 'read-only',
        verdict: 'allow',
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
