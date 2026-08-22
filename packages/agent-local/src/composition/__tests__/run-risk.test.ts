import { describe, expect, it, vi } from 'vitest'

import { RUNS_START_FUNCTION_ID } from '@vostride/agent-qa-agent'
import type {
  ExecutionContext,
  RiskActionDescriptor,
  TrustCredential,
} from '@vostride/agent-qa-schema'
import { classifyRisk, evaluate } from '@vostride/agent-qa-safety'
import type {
  AuditSink,
  ExecutionAuditRow,
  GateDeps,
  GateTrust,
  GuardrailAuditRow,
  StandingApprovalReader,
} from '@vostride/agent-qa-safety'

import { buildRunRiskDescriptor, RUN_START_RISK_ACTION_NAME } from '../run-risk.js'

// The gate.test.ts house fixture, copied rather than re-invented: the gate's own suite asserts on
// the audit ROW, and so does this one. A denial asserted on stderr text or an exit code is the
// green-that-never-ran shape a not-implemented stub also satisfies.
class FakeAuditSink implements AuditSink {
  readonly executionRows: ExecutionAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(_row: GuardrailAuditRow): void {
    throw new Error('gate writes execution audit only')
  }
}

async function evaluateWithAudit(
  action: RiskActionDescriptor,
  ctx: ExecutionContext,
  trust: GateTrust = {},
  deps: Omit<GateDeps, 'auditSink'> = {},
): Promise<{ row: ExecutionAuditRow; result: Awaited<ReturnType<typeof evaluate>> }> {
  const auditSink = new FakeAuditSink()
  const result = await evaluate(action, ctx, trust, { ...deps, auditSink })

  expect(auditSink.executionRows).toHaveLength(1)

  return { result, row: auditSink.executionRows[0] }
}

const ALL_CONTEXTS: readonly ExecutionContext[] = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
]

const NON_INTERACTIVE_CONTEXTS: readonly ExecutionContext[] = ['local-headless', 'ci', 'cloud']

describe('buildRunRiskDescriptor — the descriptor itself', () => {
  it('maps a local-declared target to mutating-local', () => {
    expect(buildRunRiskDescriptor('local')).toEqual({
      name: 'run:start',
      recognized: true,
      declaredTier: 'mutating-local',
    })
  })

  it('maps a shared-declared target to mutating-shared', () => {
    expect(buildRunRiskDescriptor('shared')).toEqual({
      name: 'run:start',
      recognized: true,
      declaredTier: 'mutating-shared',
    })
  })

  it('maps an UNDECLARED target to mutating-shared (D-06)', () => {
    expect(buildRunRiskDescriptor(undefined)).toEqual({
      name: 'run:start',
      recognized: true,
      declaredTier: 'mutating-shared',
    })
  })

  it('omits disclosure entirely when none is supplied', () => {
    expect(Object.hasOwn(buildRunRiskDescriptor('local'), 'disclosure')).toBe(false)
  })

  it('carries a disclosure without letting it move the tier (schema law: display-only)', () => {
    const plain = buildRunRiskDescriptor('local')
    const disclosed = buildRunRiskDescriptor('local', 'rm -rf / delete drop destroy production')

    expect(disclosed.disclosure).toBe('rm -rf / delete drop destroy production')
    expect(classifyRisk(disclosed).riskTier).toBe(classifyRisk(plain).riskTier)
    expect(classifyRisk(disclosed).riskTier).toBe('mutating-local')
  })
})

describe('run:start hits neither destructive lexicon', () => {
  it('classifies to the recognized-mutating floor when nothing is declared', () => {
    // Strip the declaration so the ONLY thing left to classify is the name. A lexicon hit would
    // raise this to destructive/restricted; the floor reason proves no lexicon signal fired.
    const { riskTier, reason } = classifyRisk({
      name: RUN_START_RISK_ACTION_NAME,
      recognized: true,
    })

    expect(riskTier).toBe('mutating-local')
    expect(reason).toBe('recognized mutating action floor')
  })

  it('leaves a local-declared descriptor at mutating-local rather than raising it', () => {
    // The declaration and the recognized-mutating floor propose the SAME tier here, and the
    // classifier's reduce keeps the earlier proposal on a rank tie — so the reason reads as the
    // floor's. Asserted as measured rather than as expected: the claim this cell owns is that
    // nothing RAISES the tier, and a reason string invented to look tidier would hide the tie.
    expect(classifyRisk(buildRunRiskDescriptor('local'))).toEqual({
      riskTier: 'mutating-local',
      reason: 'recognized mutating action floor',
    })
  })

  it('raises to mutating-shared for a shared declaration, naming the declaration', () => {
    expect(classifyRisk(buildRunRiskDescriptor('shared'))).toEqual({
      riskTier: 'mutating-shared',
      reason: 'declared tier: mutating-shared',
    })
  })
})

describe('D-05: a local-declared target allows in EVERY execution context, credential-free', () => {
  it.each(ALL_CONTEXTS)('allows in %s with no trust at all', async (ctx) => {
    const confirm = vi.fn(() => true)
    const { result, row } = await evaluateWithAudit(
      buildRunRiskDescriptor('local'),
      ctx,
      {},
      { confirm },
    )

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'mutating-local' })
    expect(row).toMatchObject({
      action: 'run:start',
      riskTier: 'mutating-local',
      verdict: 'allow',
      outcome: 'proceeded',
    })
    // Never reached an ask, so nobody was asked — the CI guarantee is the ABSENCE of a prompt,
    // not a prompt that happens to be auto-answered.
    expect(confirm).not.toHaveBeenCalled()
    expect(row).not.toHaveProperty('trustSource')
  })
})

describe('D-06: a shared-declared or undeclared target fails closed without trust', () => {
  const classes: readonly { label: string; value: 'shared' | undefined }[] = [
    { label: 'shared-declared', value: 'shared' },
    { label: 'undeclared', value: undefined },
  ]

  for (const { label, value } of classes) {
    it.each(NON_INTERACTIVE_CONTEXTS)(
      `denies a ${label} target in %s with outcome fail-closed-denied`,
      async (ctx) => {
        const confirm = vi.fn(() => true)
        const { result, row } = await evaluateWithAudit(
          buildRunRiskDescriptor(value),
          ctx,
          {},
          { confirm },
        )

        expect(result).toMatchObject({ verdict: 'deny', riskTier: 'mutating-shared' })
        expect(row).toMatchObject({
          action: 'run:start',
          riskTier: 'mutating-shared',
          verdict: 'deny',
          // The typed artifact, never a message substring: a reworded denial must not be able to
          // pass this cell, and a not-implemented stub must not be able to produce it.
          outcome: 'fail-closed-denied',
        })
        expect(row).not.toHaveProperty('trustSource')
        // The fail-closed check runs BEFORE the confirm — an ask in a headless context is a deny,
        // not a question asked into a void and recorded as answered.
        expect(confirm).not.toHaveBeenCalled()
      },
    )
  }
})

describe('the allow-controls on the same door', () => {
  it('proceeds for a shared target when a scope-matching credential is presented', async () => {
    const credential: TrustCredential = { scope: { project: 'agent-qa' } }

    const { result, row } = await evaluateWithAudit(buildRunRiskDescriptor('shared'), 'ci', {
      credential,
      actionScope: { project: 'agent-qa' },
    })

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'mutating-shared' })
    expect(row).toMatchObject({
      action: 'run:start',
      riskTier: 'mutating-shared',
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'trust-credential',
    })
  })

  it('still denies a shared target when the credential scope does not match', async () => {
    const credential: TrustCredential = { scope: { project: 'somebody-else' } }

    const { row } = await evaluateWithAudit(buildRunRiskDescriptor('shared'), 'ci', {
      credential,
      actionScope: { project: 'agent-qa' },
    })

    expect(row).toMatchObject({ verdict: 'deny', outcome: 'fail-closed-denied' })
  })

  it('proceeds for an undeclared target in a context where a human can actually answer', async () => {
    const confirm = vi.fn(() => true)
    const { row } = await evaluateWithAudit(
      buildRunRiskDescriptor(undefined),
      'local-interactive',
      {},
      { confirm },
    )

    expect(row).toMatchObject({
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'tty-prompt',
    })
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})

describe('grants cannot leak between the op-level gate and the core-level gate', () => {
  it('does not let a standing grant for fn:runs.start satisfy a run:start ask', async () => {
    const opLevelActionName = `fn:${RUNS_START_FUNCTION_ID}`
    expect(RUN_START_RISK_ACTION_NAME).not.toBe(opLevelActionName)

    const reader: StandingApprovalReader = {
      grantsFor: () => [{ actionClass: opLevelActionName, scope: { project: 'agent-qa' } }],
    }

    const { row } = await evaluateWithAudit(
      buildRunRiskDescriptor('shared'),
      'ci',
      { actionScope: { project: 'agent-qa' } },
      { reader },
    )

    expect(row).toMatchObject({ verdict: 'deny', outcome: 'fail-closed-denied' })
  })

  it('the control: the same grant issued for run:start DOES satisfy it', async () => {
    const reader: StandingApprovalReader = {
      grantsFor: () => [
        { actionClass: RUN_START_RISK_ACTION_NAME, scope: { project: 'agent-qa' } },
      ],
    }

    const { row } = await evaluateWithAudit(
      buildRunRiskDescriptor('shared'),
      'ci',
      { actionScope: { project: 'agent-qa' } },
      { reader },
    )

    expect(row).toMatchObject({
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'standing-approval',
    })
  })
})
