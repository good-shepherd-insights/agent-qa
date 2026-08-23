// The session-pin DENY overlay, as a property of the shipped gate (Phase 392, D-21, plan 05).
//
// WHAT THIS FILE PROVES, and why it is two-sided rather than one.
//
// `/pin <class>` records a session-scoped deny overlay. The dangerous version of that feature is
// a general "session policy override" — a map a session can write into that the gate consults —
// because such a map can loosen as easily as it tightens, and the thing it would be loosening is
// the authorization ladder. So the overlay enters as a hook whose ONLY reachable effect is a
// deny, and both arms of that claim are measured here:
//
//   ARM A (present-and-tightening): with the hook supplied and answering true, an allow becomes a
//   deny, an ask becomes a deny, a covering standing approval does NOT resurrect the action
//   (execution-safety §2.4), and the refusal lands an ordinary execution-audit row with a named
//   outcome — never a silent pre-gate throw, which is what `invokeFunction`'s own pre-gate
//   refusals are (invoke.ts:17-19) and precisely the repudiation gap this placement closes.
//
//   ARM B (absent-and-inert): with the hook ABSENT the gate is byte-identical to before, and with
//   the hook present answering false it is byte-identical to absent — result AND audit row,
//   deep-equal, over the whole action/context matrix. A read-side refusal shipped without its
//   write-side arm being pinned is how a working entry point becomes permanently poisoned; the
//   absent arm is therefore an assertion, not an assumption.
//
// AND THE WIDENING ATTEMPT IS SHOWN REFUSED. "Tighten-only" is a claim about the hook's IMAGE:
// over every base verdict and every answer the hook can give, the resulting verdict is either the
// base verdict or `deny`, and never anything wider. The matrix below states that exhaustively,
// and the type-level case pins that the hook cannot even be handed a value that names a verdict.

import { describe, expect, it, vi } from 'vitest'

import type {
  ExecutionContext,
  RiskActionDescriptor,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'
import type { ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import type { ConfirmPort, StandingApprovalReader } from '../../ports/policy-ports'
import { evaluate, type GateDeps, type GateTrust } from '../gate'

class FakeAuditSink {
  readonly executionRows: ExecutionAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(_row: GuardrailAuditRow): void {
    throw new Error('gate writes execution audit only')
  }
}

// The four base verdicts this gate can reach, each named by the action that reaches it. Spelled
// exactly as gate.test.ts spells them so a reader comparing the two files is comparing behaviour
// and not fixtures.
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

const mutatingLocalAction: RiskActionDescriptor = {
  name: 'edit_local_file',
  recognized: true,
}

const ALL_ACTIONS: readonly RiskActionDescriptor[] = [
  readOnlyAction,
  restrictedAction,
  mutatingSharedAction,
  destructiveAction,
  mutatingLocalAction,
]

const ALL_CONTEXTS: readonly ExecutionContext[] = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
]

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

function grantReader(scope: TrustScope): StandingApprovalReader {
  return {
    grantsFor: () => [{ actionClass: 'file_issue', scope }],
  }
}

const DENY_EVERYTHING = (): boolean => true
const DENY_NOTHING = (): boolean => false

describe('ARM A — the pin present and tightening', () => {
  it('turns an allow into an audited deny with a named outcome', async () => {
    const { result, row } = await evaluateWithAudit(readOnlyAction, 'cloud', {}, {
      deny: DENY_EVERYTHING,
    })

    expect(result).toMatchObject({ verdict: 'deny', riskTier: 'read-only' })
    expect(row).toMatchObject({
      action: 'inspect_state',
      riskTier: 'read-only',
      verdict: 'deny',
      outcome: 'session-pin-denied',
    })
    // The refusal names itself and names the way out. A pin dies with the session and has no
    // revoke verb (D-21), so the remediation is the session boundary and nothing else.
    expect(row.reason).toContain('session-pin-denied')
    expect(row.reason).toMatch(/pin/i)
    // No trust source can be attached to a pin refusal: nothing satisfied anything.
    expect(row).not.toHaveProperty('trustSource')
  })

  it('turns an ask into a deny WITHOUT prompting the human', async () => {
    const ask = vi.fn(() => true)
    const confirm: ConfirmPort = { surface: 'tty-prompt', ask }

    const { result, row } = await evaluateWithAudit(
      destructiveAction,
      'local-interactive',
      {},
      { confirm, deny: DENY_EVERYTHING },
    )

    expect(result).toMatchObject({ verdict: 'deny', riskTier: 'destructive' })
    expect(row).toMatchObject({ verdict: 'deny', outcome: 'session-pin-denied' })
    // Asking a person to confirm something they themselves pinned, and then refusing it whatever
    // they answer, would be a prompt with no outcome attached to it.
    expect(ask).not.toHaveBeenCalled()
  })

  it('is not resurrected by a covering standing approval (§2.4: a grant never overrides a deny)',
    async () => {
      const reader = grantReader({ project: 'A' })
      const grantsFor = vi.spyOn(reader, 'grantsFor')

      const { result, row } = await evaluateWithAudit(
        destructiveAction,
        'ci',
        { actionScope: { project: 'A' } },
        { reader, deny: DENY_EVERYTHING },
      )

      expect(result).toMatchObject({ verdict: 'deny', riskTier: 'destructive' })
      expect(row).toMatchObject({ verdict: 'deny', outcome: 'session-pin-denied' })
      expect(row).not.toHaveProperty('trustSource')
      // Stronger than "the grant lost": the ledger was never consulted. A pin refuses before any
      // trust source is read, so there is no ordering between them for a later edit to invert.
      expect(grantsFor).not.toHaveBeenCalled()
    })

  it('is not resurrected by session trust mode or a matching credential', async () => {
    const credential: TrustCredential = { scope: { project: 'A' } }

    const trusted = await evaluateWithAudit(
      mutatingSharedAction,
      'ci',
      { trustMode: true, credential, actionScope: { project: 'A' } },
      { deny: DENY_EVERYTHING },
    )

    expect(trusted.result.verdict).toBe('deny')
    expect(trusted.row).toMatchObject({ verdict: 'deny', outcome: 'session-pin-denied' })
    expect(trusted.row).not.toHaveProperty('trustSource')
  })

  it('leaves a restricted deny on its OWN reason — the overlay is idempotent over a deny',
    async () => {
      const { result, row } = await evaluateWithAudit(restrictedAction, 'local-interactive', {}, {
        deny: DENY_EVERYTHING,
      })

      expect(result).toMatchObject({ verdict: 'deny', riskTier: 'restricted' })
      // A restricted action was never executable and the §2.4 finality clause is the more
      // informative thing to tell an operator. Relabelling it as a pin refusal would blame a
      // session setting for a decision the tier had already made.
      expect(row.outcome).toBe('blocked')
      expect(row.reason).toMatch(/never|no grant|cannot/i)
    })

  it('hands the hook the classified action descriptor itself, so an overlay can match on it',
    async () => {
      const seen: RiskActionDescriptor[] = []

      await evaluateWithAudit(mutatingSharedAction, 'ci', {}, {
        deny: (action) => {
          seen.push(action)
          return action.name === 'push_to_remote'
        },
      })

      expect(seen).toEqual([mutatingSharedAction])
      expect(seen[0]).toBe(mutatingSharedAction)
    })
})

describe('ARM B — the pin absent, and the ladder byte-identical', () => {
  const matrix = ALL_ACTIONS.flatMap((action) =>
    ALL_CONTEXTS.map((ctx) => ({ action, ctx, label: `${action.name} in ${ctx}` })),
  )

  it.each(matrix)('$label: hook absent === hook present answering false', async ({ action, ctx }) => {
    const absentSink = new FakeAuditSink()
    const inertSink = new FakeAuditSink()

    const absent = await evaluate(action, ctx, {}, { auditSink: absentSink })
    const inert = await evaluate(action, ctx, {}, { auditSink: inertSink, deny: DENY_NOTHING })

    expect(inert).toEqual(absent)
    expect(inertSink.executionRows).toEqual(absentSink.executionRows)
  })

  it.each(matrix)(
    '$label: hook absent === hook present answering false, with every trust source supplied',
    async ({ action, ctx }) => {
      const trust: GateTrust = {
        credential: { scope: { project: 'A' } },
        actionScope: { project: 'A' },
      }
      const shared: Omit<GateDeps, 'auditSink' | 'deny'> = {
        reader: grantReader({ project: 'A' }),
        confirm: { surface: 'tty-prompt', ask: () => true },
      }

      const absentSink = new FakeAuditSink()
      const inertSink = new FakeAuditSink()

      const absent = await evaluate(action, ctx, trust, { ...shared, auditSink: absentSink })
      const inert = await evaluate(action, ctx, trust, {
        ...shared,
        auditSink: inertSink,
        deny: DENY_NOTHING,
      })

      expect(inert).toEqual(absent)
      expect(inertSink.executionRows).toEqual(absentSink.executionRows)
    },
  )
})

describe('the widening attempt, refused', () => {
  const matrix = ALL_ACTIONS.flatMap((action) =>
    ALL_CONTEXTS.map((ctx) => ({ action, ctx, label: `${action.name} in ${ctx}` })),
  )

  it.each(matrix)(
    '$label: whatever the hook answers, the verdict is the base verdict or deny — never wider',
    async ({ action, ctx }) => {
      const baseline = await evaluateWithAudit(action, ctx)

      const tightened = await evaluateWithAudit(action, ctx, {}, { deny: DENY_EVERYTHING })
      expect(tightened.result.verdict).toBe('deny')

      const inert = await evaluateWithAudit(action, ctx, {}, { deny: DENY_NOTHING })
      expect(inert.result.verdict).toBe(baseline.result.verdict)

      // The image of the hook over this cell, stated as a set. `allow` appears in it only when the
      // base verdict was already `allow` and the hook declined to tighten.
      const image = new Set([tightened.result.verdict, inert.result.verdict])
      for (const verdict of image) {
        expect(verdict === 'deny' || verdict === baseline.result.verdict).toBe(true)
      }
    },
  )

  it('cannot flip a deny the ladder already reached, however the hook answers', async () => {
    // Two independent denies the ladder produces on its own: the restricted `blocked` and the
    // non-interactive `fail-closed-denied`. A hook answering false is the closest thing to a
    // widening request this signature can express, and it moves neither.
    const restricted = await evaluateWithAudit(restrictedAction, 'local-interactive', {}, {
      deny: DENY_NOTHING,
    })
    expect(restricted.result.verdict).toBe('deny')
    expect(restricted.row.outcome).toBe('blocked')

    const failClosed = await evaluateWithAudit(destructiveAction, 'ci', {}, {
      deny: DENY_NOTHING,
      confirm: { surface: 'tty-prompt', ask: () => true },
    })
    expect(failClosed.result.verdict).toBe('deny')
    expect(failClosed.row.outcome).toBe('fail-closed-denied')
  })

  it('cannot be handed a value that names a verdict — the widening refusal at the type', () => {
    // The hook answers a BOOLEAN, and the only branch a `true` can take writes a deny. There is no
    // value of this type that means "allow this", which is what makes tighten-only a property of
    // the signature rather than a rule the implementation remembers. If this directive ever stops
    // erroring, the hook has grown a way to say something other than "refuse".
    const widening = {
      // @ts-expect-error a deny hook may not answer with a verdict
      deny: (): 'allow' => 'allow',
    } satisfies GateDeps

    expect(typeof widening.deny).toBe('function')
  })
})
