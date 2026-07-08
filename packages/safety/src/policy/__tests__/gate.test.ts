import { describe, expect, it, vi } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  RiskTier,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'
import type { ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { StandingApprovalReader } from '../../ports/policy-ports'
import {
  baseVerdict,
  buildExecutionAuditRow,
  evaluate,
  type GateDeps,
  type GateTrust,
} from '../gate'

class FakeAuditSink {
  readonly executionRows: ExecutionAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(_row: GuardrailAuditRow): void {
    throw new Error('gate writes execution audit only')
  }
}

const readOnlyAction: RiskActionDescriptor = {
  name: 'inspect_state',
  recognized: true,
  readOnly: true,
}

const restrictedAction: RiskActionDescriptor = {
  name: 'run_shell',
  recognized: true,
  command: 'rm -rf /',
}

const mutatingSharedAction: RiskActionDescriptor = {
  name: 'push_to_remote',
  recognized: true,
  declaredTier: 'mutating-shared',
}

const destructiveAction: RiskActionDescriptor = {
  name: 'file_issue',
  recognized: true,
  declaredTier: 'destructive',
}

// A recognized flagless verb floors to mutating-local (the surface-aware floor) —
// the "ordinary in-test verb" the §2.1 CI guarantee (D-15) keeps unblocked.
const mutatingLocalAction: RiskActionDescriptor = {
  name: 'edit_local_file',
  recognized: true,
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
  expect(auditSink.executionRows[0]).not.toHaveProperty('ts')

  return { result, row: auditSink.executionRows[0] }
}

function grantReader(scope: TrustScope): StandingApprovalReader {
  return {
    grantsFor: () => [{ actionClass: 'file_issue', scope }],
  }
}

describe('baseVerdict', () => {
  const contexts: readonly ExecutionContext[] = [
    'local-interactive',
    'local-headless',
    'ci',
    'cloud',
  ]
  const cases: { tier: RiskTier; ctx: ExecutionContext; expected: 'allow' | 'ask' | 'deny' }[] =
    [
      ...contexts.map((ctx) => ({ tier: 'read-only' as const, ctx, expected: 'allow' as const })),
      ...contexts.map((ctx) => ({ tier: 'restricted' as const, ctx, expected: 'deny' as const })),
      // spec/v2/execution-safety.md §2.1 (Ratified 2026-07-05): mutating-local
      // allows in EVERY execution context — the ask + fail-closed rule is reserved
      // for mutating-shared/destructive. Recognized in-test verbs never reach resolveAsk.
      ...contexts.map((ctx) => ({
        tier: 'mutating-local' as const,
        ctx,
        expected: 'allow' as const,
      })),
      ...contexts.map((ctx) => ({
        tier: 'mutating-shared' as const,
        ctx,
        expected: 'ask' as const,
      })),
      ...contexts.map((ctx) => ({ tier: 'destructive' as const, ctx, expected: 'ask' as const })),
    ]

  it.each(cases)('maps $tier in $ctx to $expected', ({ tier, ctx, expected }) => {
    expect(baseVerdict(tier, ctx)).toBe(expected)
  })
})

describe('evaluate', () => {
  it('allows read-only actions in any context with one proceeded audit row', async () => {
    const { result, row } = await evaluateWithAudit(readOnlyAction, 'cloud')

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'read-only' })
    expect(row).toMatchObject({
      action: 'inspect_state',
      riskTier: 'read-only',
      verdict: 'allow',
      outcome: 'proceeded',
    })
    expect(row).not.toHaveProperty('trustSource')
  })

  it('keeps restricted actions blocked even when every trust source is present', async () => {
    const reader = grantReader({ project: 'A' })
    const credential: TrustCredential = { scope: { project: 'A' } }

    const { result, row } = await evaluateWithAudit(
      restrictedAction,
      'local-interactive',
      {
        trustMode: true,
        credential,
        actionScope: { project: 'A' },
      },
      { reader, confirm: () => true },
    )

    expect(result).toMatchObject({ verdict: 'deny', riskTier: 'restricted' })
    expect(row).toMatchObject({
      action: 'run_shell',
      riskTier: 'restricted',
      verdict: 'deny',
      outcome: 'blocked',
    })
    expect(row).not.toHaveProperty('trustSource')
  })

  it('fails closed for non-interactive ask actions without trust before prompting', async () => {
    const confirm = vi.fn(() => true)

    const { result, row } = await evaluateWithAudit(mutatingSharedAction, 'ci', {}, { confirm })

    expect(result).toMatchObject({ verdict: 'deny', riskTier: 'mutating-shared' })
    expect(row).toMatchObject({
      action: 'push_to_remote',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
    })
    expect(row).not.toHaveProperty('trustSource')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('lets session trust mode satisfy an ask in a non-interactive context', async () => {
    const { result, row } = await evaluateWithAudit(mutatingSharedAction, 'ci', {
      trustMode: true,
    })

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'mutating-shared' })
    expect(row).toMatchObject({
      action: 'push_to_remote',
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'session-trust-mode',
    })
  })

  it('accepts a matching trust credential and rejects a mismatched credential', async () => {
    const credential: TrustCredential = { scope: { project: 'A' } }

    const matching = await evaluateWithAudit(mutatingSharedAction, 'ci', {
      credential,
      actionScope: { project: 'A' },
    })

    expect(matching.result).toMatchObject({ verdict: 'allow', riskTier: 'mutating-shared' })
    expect(matching.row).toMatchObject({
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'trust-credential',
    })

    const mismatched = await evaluateWithAudit(mutatingSharedAction, 'ci', {
      credential,
      actionScope: { project: 'B' },
    })

    expect(mismatched.result).toMatchObject({ verdict: 'deny', riskTier: 'mutating-shared' })
    expect(mismatched.row).toMatchObject({
      verdict: 'deny',
      outcome: 'fail-closed-denied',
    })
    expect(mismatched.row).not.toHaveProperty('trustSource')
  })

  it('lets a covering standing approval satisfy an ask', async () => {
    const { result, row } = await evaluateWithAudit(
      destructiveAction,
      'ci',
      { actionScope: { project: 'A' } },
      { reader: grantReader({ project: 'A' }) },
    )

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'destructive' })
    expect(row).toMatchObject({
      action: 'file_issue',
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'standing-approval',
    })
  })

  it('resolves local interactive prompts through injected confirm and denies by default', async () => {
    const approved = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: () => true,
    })
    expect(approved.result).toMatchObject({ verdict: 'allow', riskTier: 'destructive' })
    expect(approved.row).toMatchObject({
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'tty-prompt',
    })

    const denied = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: () => false,
    })
    expect(denied.result).toMatchObject({ verdict: 'deny', riskTier: 'destructive' })
    expect(denied.row).toMatchObject({
      verdict: 'deny',
      outcome: 'prompted-denied',
    })
    expect(denied.row).not.toHaveProperty('trustSource')

    const defaultDenied = await evaluateWithAudit(destructiveAction, 'local-interactive')
    expect(defaultDenied.result).toMatchObject({ verdict: 'deny', riskTier: 'destructive' })
    expect(defaultDenied.row).toMatchObject({
      verdict: 'deny',
      outcome: 'prompted-denied',
    })
  })
})

describe('§2.1 mutating-local conformance and D-16 remediation reasons', () => {
  it('allows a recognized in-test verb in ci with no trust (the D-15 CI guarantee)', async () => {
    const { result, row } = await evaluateWithAudit(mutatingLocalAction, 'ci')

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'mutating-local' })
    expect(row).toMatchObject({ outcome: 'proceeded' })
    expect(row).not.toHaveProperty('trustSource')
  })

  it('carries classification AND the way out in a fail-closed deny reason', async () => {
    const { result, row } = await evaluateWithAudit(destructiveAction, 'ci')

    expect(result.verdict).toBe('deny')
    expect(row.outcome).toBe('fail-closed-denied')
    // Classification fragment plus D-16 remediation (action names only, no data values).
    expect(row.reason).toContain('ci')
    expect(row.reason).toContain('--trust-session')
    expect(row.reason).toContain('locally')
  })

  it('carries remediation in a prompted-denied reason', async () => {
    const { result, row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: () => false,
    })

    expect(result.verdict).toBe('deny')
    expect(row.outcome).toBe('prompted-denied')
    expect(row.reason).toContain('--trust-session')
  })

  it('carries a finality clause in a blocked (restricted) reason', async () => {
    const { result, row } = await evaluateWithAudit(restrictedAction, 'local-interactive')

    expect(result.verdict).toBe('deny')
    expect(row.outcome).toBe('blocked')
    // §2.4: grants never override a restricted deny.
    expect(row.reason).toMatch(/never|no grant|cannot/i)
  })
})

describe('buildExecutionAuditRow', () => {
  it('builds the shared execution row without a timestamp', () => {
    const row = buildExecutionAuditRow({
      action: 'tool_call',
      riskTier: 'restricted',
      verdict: 'deny',
      outcome: 'blocked',
      reason: 'restricted action blocked',
    })

    expect(row).toEqual({
      action: 'tool_call',
      riskTier: 'restricted',
      verdict: 'deny',
      outcome: 'blocked',
      reason: 'restricted action blocked',
    })
    expect(row).not.toHaveProperty('ts')
  })
})
