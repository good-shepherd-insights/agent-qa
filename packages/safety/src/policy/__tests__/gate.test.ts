import { describe, expect, it, vi } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  RiskTier,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'
import type { ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { ConfirmPort, StandingApprovalReader } from '../../ports/policy-ports'
import { DENY_CONFIRM } from '../../ports/policy-ports'
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

// ---- G-401-17: the confirm rung records a SURFACE the composition declared -------------------
//
// Measured in a real browser (UAT item 15 §4): a click in Chromium landed an `execution_audit` row
// reading `trustSource: tty-prompt`, because rung (e) of `resolveAsk`'s ladder hardcoded the
// mechanism it EXPECTED rather than the surface that actually answered. Rungs (a)-(c) name
// MECHANISMS and are correct; (e) was the only rung naming a surface and it named the wrong one.
//
// THE CONTROL IS THE TERMINAL CELL BESIDE THE BROWSER ONE. A blanket rename of the literal would
// pass a browser-only assertion while proving nothing; the pair is what makes the claim "the row
// names WHICHEVER surface was declared" rather than "the row names the browser now".

const terminalConfirm: ConfirmPort = {
  surface: 'tty-prompt',
  ask: () => true,
}

const browserConfirm: ConfirmPort = {
  surface: 'browser-click',
  ask: () => true,
}

describe('G-401-17: an approval names the surface that answered it', () => {
  it('records the browser when a browser answered', async () => {
    const { result, row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: browserConfirm,
    })

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'destructive' })
    expect(row).toMatchObject({
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'browser-click',
    })
  })

  it('records the terminal when a terminal answered — the control for the cell above', async () => {
    const { result, row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: terminalConfirm,
    })

    expect(result).toMatchObject({ verdict: 'allow', riskTier: 'destructive' })
    expect(row).toMatchObject({
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'tty-prompt',
    })
  })

  it('carries no trust source through a denial, whichever surface refused', async () => {
    for (const surface of ['tty-prompt', 'browser-click'] as const) {
      const { row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
        confirm: { surface, ask: () => false },
      })

      expect(row).toMatchObject({ verdict: 'deny', outcome: 'prompted-denied' })
      expect(row).not.toHaveProperty('trustSource')
    }
  })

  it('leaves the two approvals byte-identical apart from the surface they name', async () => {
    const viaBrowser = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: browserConfirm,
    })
    const viaTerminal = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: terminalConfirm,
    })

    // THE PROOF THAT THE FIX IS AT THE WRITE SITE, not in a reader. `buildDecisionReason` and
    // `buildDecisionNeutralReason` are untouched in this plan's diff; a repair that had reached
    // into either of them would show up here as two prose sentences that differ.
    expect(viaBrowser.result.reason).toBe(viaTerminal.result.reason)
    expect(viaBrowser.result.neutralReason).toBe(viaTerminal.result.neutralReason)
    expect({ ...viaBrowser.row, trustSource: undefined })
      .toEqual({ ...viaTerminal.row, trustSource: undefined })
  })

  it('leaves the MECHANISM rungs and their reason sentences exactly where they were', async () => {
    // Pinned as literal strings rather than a snapshot: these three sentences pre-date this plan
    // and the point of the cell is that widening the trust-source union moved none of them.
    const viaTrustMode = await evaluateWithAudit(destructiveAction, 'local-interactive', {
      trustMode: true,
    })
    expect(viaTrustMode.row).toMatchObject({
      outcome: 'proceeded',
      trustSource: 'session-trust-mode',
    })
    expect(viaTrustMode.row.reason).toContain('ask satisfied by session-trust-mode')

    const viaCredential = await evaluateWithAudit(destructiveAction, 'ci', {
      credential: { scope: { project: 'A' } },
      actionScope: { project: 'A' },
    })
    expect(viaCredential.row).toMatchObject({
      outcome: 'proceeded',
      trustSource: 'trust-credential',
    })
    expect(viaCredential.row.reason).toContain('ask satisfied by trust-credential')

    const viaGrant = await evaluateWithAudit(
      destructiveAction,
      'ci',
      { actionScope: { project: 'A' } },
      { reader: grantReader({ project: 'A' }) },
    )
    expect(viaGrant.row).toMatchObject({
      outcome: 'proceeded',
      trustSource: 'standing-approval',
    })
    expect(viaGrant.row.reason).toContain('ask satisfied by standing-approval')
  })

  it('cannot grant an approval through a binding that declares no surface', async () => {
    // `DENY_CONFIRM`'s own declaration, said out loud: a port with nobody behind it has nobody to
    // attribute an approval to, so it cannot mint one. Driven with an `ask` that LIES and answers
    // yes, because the constant's own `() => false` would prove this by coincidence.
    const { result, row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: { surface: null, ask: () => true },
    })

    expect(result.verdict).toBe('deny')
    expect(row).toMatchObject({ verdict: 'deny', outcome: 'prompted-denied' })
    expect(row).not.toHaveProperty('trustSource')
  })

  it('keeps DENY_CONFIRM composable and surfaceless', async () => {
    const { row } = await evaluateWithAudit(destructiveAction, 'local-interactive', {}, {
      confirm: DENY_CONFIRM,
    })

    expect(DENY_CONFIRM.surface).toBeNull()
    expect(row).toMatchObject({ verdict: 'deny', outcome: 'prompted-denied' })
    expect(row).not.toHaveProperty('trustSource')
  })
})
