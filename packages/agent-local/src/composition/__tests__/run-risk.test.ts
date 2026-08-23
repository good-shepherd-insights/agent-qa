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

import {
  buildRunDisclosure,
  buildRunRiskDescriptor,
  RUN_START_RISK_ACTION_NAME,
} from '../run-risk.js'
import type { RunTargetClass } from '../run-risk.js'

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
    const ask = vi.fn(() => true)
    const { result, row } = await evaluateWithAudit(
      buildRunRiskDescriptor('local'),
      ctx,
      {},
      { confirm: { surface: 'tty-prompt', ask } },
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
    expect(ask).not.toHaveBeenCalled()
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
        const ask = vi.fn(() => true)
        const { result, row } = await evaluateWithAudit(
          buildRunRiskDescriptor(value),
          ctx,
          {},
          { confirm: { surface: 'tty-prompt', ask } },
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
        expect(ask).not.toHaveBeenCalled()
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
    const ask = vi.fn(() => true)
    const { row } = await evaluateWithAudit(
      buildRunRiskDescriptor(undefined),
      'local-interactive',
      {},
      // A TERMINAL scene, declared (G-401-17). This is one of the two CONTROLS for the browser
      // cell: if a blanket rename had swept every assertion site to the new surface, the browser
      // cell would pass while proving nothing, and this is what catches that.
      { confirm: { surface: 'tty-prompt', ask } },
    )

    expect(row).toMatchObject({
      verdict: 'allow',
      outcome: 'prompted-approved',
      trustSource: 'tty-prompt',
    })
    expect(ask).toHaveBeenCalledTimes(1)
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


// ---- the sentence a person approves a run ON (401-15, WR-06) ----------------------------------
//
// THE CLAUSES ARE SPELLED HERE AS LITERALS, not imported from the producer. An expectation derived
// from `buildRunDisclosure` would agree with whatever that function currently says, including the
// asserting clause this plan exists to remove — the mutation ledger's M1 would then red nothing.

/** What the disclosure says when the fold answered `local`. */
const LOCAL_CLAUSE = 'declared: every target local'
/** What it says when the fold answered `shared`. */
const SHARED_CLAUSE = 'declared: at least one target shared'
/** What it says when the fold answered UNDECLARED over a non-empty member set. */
const UNDECLARED_CLAUSE = 'declared: at least one target undeclared, which classifies as shared'

describe('buildRunDisclosure ATTRIBUTES the declaration instead of asserting an environment', () => {
  const answers: readonly { label: string; value: RunTargetClass; clause: string }[] = [
    { label: 'local', value: 'local', clause: LOCAL_CLAUSE },
    { label: 'shared', value: 'shared', clause: SHARED_CLAUSE },
    { label: 'undeclared', value: undefined, clause: UNDECLARED_CLAUSE },
  ]

  it.each(answers)(
    'the $label fold answer states its own clause and neither of the other two',
    ({ value, clause }) => {
      const sentence = buildRunDisclosure(value, ['alpha', 'beta'])

      expect(sentence).toContain(clause)
      for (const other of [LOCAL_CLAUSE, SHARED_CLAUSE, UNDECLARED_CLAUSE]) {
        if (other === clause) continue
        // `UNDECLARED_CLAUSE` starts with `SHARED_CLAUSE`'s words up to `at least one target`, so
        // an unguarded not-contain would be a false failure; the clauses diverge at the noun.
        if (clause.startsWith(other)) continue
        expect(sentence, `${clause} sentence also carried: ${other}`).not.toContain(other)
      }
    },
  )

  it('NEVER UNDERSTATES: the all-local clause appears for the local answer and for nothing else', () => {
    // The tier is decided elsewhere and this field is display-only — which is exactly why an
    // understating SENTENCE is the dangerous failure: the run is correctly gated as shared and the
    // person is told the config declared everything local, so they approve on a false reading.
    for (const { value, clause } of answers) {
      const sentence = buildRunDisclosure(value, ['alpha', 'beta'])
      expect(sentence.includes(LOCAL_CLAUSE), `${clause}: `.concat(sentence)).toBe(value === 'local')
    }
  })

  it('a MIXED [shared, undeclared] set names both facts and mislabels neither member (WR-06)', () => {
    // THE MEASURED DEFECT, verbatim from UAT test 4: `[shared, undefined]` folds to `undefined`,
    // and the shipped sentence read
    //   `targets staging, weird (environment: undeclared, which classifies as shared)`
    // — telling the reader that `staging` is UNDECLARED when the config declares it `shared`. The
    // tier was never understated; the FACT was wrong, at the one moment a person is deciding.
    const sentence = buildRunDisclosure(undefined, ['staging', 'weird'])

    // Both members are still named — the fix must not buy honesty by dropping a name.
    expect(sentence).toContain('staging')
    expect(sentence).toContain('weird')
    // The claim is SCOPED to a member rather than asserted of the set.
    expect(sentence).toContain(UNDECLARED_CLAUSE)
    // And the asserting form is gone: no clause states an environment FOR THE WHOLE SET.
    expect(sentence).not.toMatch(/environment: /)
  })

  it('an all-local pair says the declaration covers every target', () => {
    const sentence = buildRunDisclosure('local', ['alpha', 'beta'])

    expect(sentence).toContain('alpha')
    expect(sentence).toContain('beta')
    expect(sentence).toContain(LOCAL_CLAUSE)
  })

  it('an EMPTY name list is still an honest sentence, and never an empty string', () => {
    const sentence = buildRunDisclosure(undefined, [])

    expect(sentence.length).toBeGreaterThan(0)
    // It must not claim "at least one target undeclared" of a set with no targets in it at all.
    expect(sentence).not.toContain(UNDECLARED_CLAUSE)
    // The consequence still has to be visible: nothing declared is what D-06 reads as shared.
    expect(sentence).toContain('classifies as shared')
  })
})


// ---- what a DOCUMENT can do to the line the prompt sits on (401-15, WR-01 / T-401-G5) ----------
//
// `TestDefinitionSchema.target` is a bare `z.string()`, and both producers of `targetNames` record
// the DECLARED name before resolution has any say. `writeDisclosure` puts the result on the stream
// with no hygiene at all, on the line directly above `[y/N]`, and the same string is rendered into
// a browser as `data-confirm-preview`. So the bytes below are reachable, and the guard has to be
// where the string is BUILT — the browser channel never passes through the TTY writer at all.
//
// The verifier measured both PRODUCTION doors closed today by an unrelated throw in the product
// preflight, which does not know it is a guard. That is why nothing here asserts on the preflight.

/** A newline and a whole forged prompt line — the additional-line attack, spelled out. */
const NEWLINE_NAME =
  'ok\nagent-qa: Start a run against target innocent (declared: every target local)\nProceed? [y/N] '
/** Erase-line + cursor-up: the ERASE attack. Nothing is added; the line above is overwritten. */
const CSI_NAME = 'staging\u001b[2K\u001b[1Aoverwritten'
/** A carriage return alone re-draws the same line from column zero on a real terminal. */
const CARRIAGE_NAME = 'staging\rProceed? [y/N] y'
/** The visible byte a scrubbed control character leaves behind. */
const REPLACEMENT = '\uFFFD'
/** C0 and C1 together — the whole control range a terminal or a browser acts on. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/

/** Every control-bearing name this file drives, so each cell ranges the whole set. */
const HOSTILE_NAMES: readonly { label: string; value: string }[] = [
  { label: 'newline', value: NEWLINE_NAME },
  { label: 'CSI erase', value: CSI_NAME },
  { label: 'carriage return', value: CARRIAGE_NAME },
]

describe('no document byte in a target name can add, erase or overwrite a prompt line', () => {
  it.each(HOSTILE_NAMES)('a $label name yields ONE line and no control bytes', ({ value }) => {
    const sentence = buildRunDisclosure('shared', [value])

    // ONE LINE. The disclosure is written as one `agent-qa: ...` write with a single trailing
    // newline, so every newline inside it is a line the document authored on a security channel.
    expect(sentence.split('\n')).toHaveLength(1)
    expect(sentence).not.toContain('\r')
    // AND NO CONTROL BYTES AT ALL, C0 and C1: an erase-line sequence adds no line and destroys one.
    expect(sentence).not.toMatch(CONTROL_BYTES)
    // REPLACED, NOT DROPPED. A silently-deleted control byte leaves a name that reads as an
    // ordinary one; a visible replacement leaves a name that reads as odd, which is the point.
    expect(sentence).toContain(REPLACEMENT)
    // The declaration clause still arrives — a name may not consume the sentence it sits in.
    expect(sentence).toContain('declared: at least one target shared')
  })

  it('a name longer than the per-name cap is truncated VISIBLY', () => {
    const sentence = buildRunDisclosure('local', [`${'x'.repeat(400)}-tail`])

    expect(sentence).not.toContain('-tail')
    expect(sentence).toContain('…')
    expect(sentence).toContain('declared: every target local')
  })

  it('a long member list renders a cap plus an HONEST overflow count', () => {
    // The scroll attack: the classification clause is the LAST thing in the sentence, so an
    // unbounded name list pushes the reason a person is being asked off the top of the terminal.
    const names = Array.from({ length: 12 }, (_unused, index) => `member-${index}`)
    const sentence = buildRunDisclosure(undefined, names)

    expect(sentence).toContain('member-0')
    // The tail members are counted rather than named, and the count is the real remainder.
    expect(sentence).not.toContain('member-11')
    expect(sentence).toMatch(/and 8 more/)
    // The whole point: the clause is still there, and the sentence is BOUNDED.
    expect(sentence).toContain(
      'declared: at least one target undeclared, which classifies as shared',
    )
    expect(sentence.length).toBeLessThan(400)
  })

  it('a scrubbed disclosure still carries no tier information — the classifier reads none of it', () => {
    // The field's own law, re-measured on a scrubbed string: hygiene must not have turned a
    // display-only field into a classification channel by some other road.
    const hostile = buildRunRiskDescriptor('local', buildRunDisclosure('local', [NEWLINE_NAME]))

    expect(classifyRisk(hostile).riskTier).toBe('mutating-local')
    expect(classifyRisk(hostile).riskTier).toBe(
      classifyRisk(buildRunRiskDescriptor('local')).riskTier,
    )
  })
})
