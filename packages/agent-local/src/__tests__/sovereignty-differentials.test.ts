// Sovereignty differential 4 — DENY FINALITY: no standing approval overrides a `restricted`
// classification (Phase 391, PROP-05, plan 05).
//
// spec/v2/qa-agent-and-surfaces.md §5 states the sovereignty rule as "a grant satisfies an ask but
// never overrides a deny/restricted". Three of the four differentials that clause implies were
// pinned by plan 04 and are NOT rebuilt here — they are cited in this plan's summary at their
// file:line, because a second walk over a proven contract reads as thoroughness and measures
// nothing. This file owns the fourth, which had no coverage anywhere in the phase.
//
// WHY IT IS DRIVEN AGAINST `evaluate` AND NOT THROUGH `invokeFunction`. Measured at HEAD: of the 27
// registered capabilities, ZERO classify as `restricted` — `restricted` is reached three ways
// (`safety/src/policy/risk-classifier.ts`) and no op takes any of them. That state is therefore
// unreachable through the function layer today, and the honest options were to drive the gate
// directly or to CREATE a restricted op so a fixture could exist. The second would have been a real
// sovereignty change made for a test, which is the thing this file exists to guard against. So the
// subject is the shipped gate, the fact is pinned from the registry side as a forward red in
// `agent/src/functions/__tests__/protected-classes-registry.test.ts`, and the day an op does
// classify restricted, that case goes red and asks for the invokeFunction-level leg.
//
// (Importing `evaluate` here is sanctioned by the evaluate-pin's own contract: the scan is fed
// through `sourceFilesFor`, which drops `__tests__`, precisely because test files exercising the
// shipped gate are not call-sites in the sense SC2 polices. `EVALUATE_PIN` stays at three files.)
//
// EVERYTHING ELSE IS REAL, and that is what makes it a differential rather than an argument about
// `baseVerdict`. The grant is minted through the shipped `createGrantOperations.record` — the mint
// guard, the writer lease, the egress checkpoint and the committed append — and read back through
// the shipped `createStandingApprovalReader` over the committed `grants.jsonl`. Only the ACTION
// DESCRIPTOR is a fixture, because a descriptor is what a registered op would supply and the
// registry supplies no restricted one.
//
// THE CORPUS HAS BOTH SIDES, which is the whole difficulty of a negative like this one. "The grant
// did not help" is indistinguishable from "the grant never matched anything" unless the SAME grant
// is shown satisfying something. So each restricted descriptor below has an admitted twin carrying
// the IDENTICAL `name` — the only thing `grantCovers` compares — differing only in what pushes it
// to the restricted tier. Where an identical-name twin is structurally impossible (the destructive
// lexicon fires on the name itself), the reader is asked directly and shown returning the grant
// with both of `grantCovers`'s conditions satisfied.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createGrantOperations,
  createStandingApprovalReader,
  grantsLedgerPath,
} from '@vostride/agent-qa-knowledge-local'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type {
  ExecutionContext,
  GrantLedgerEvent,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import { evaluate } from '@vostride/agent-qa-safety'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const NOW_ISO = '2026-08-07T12:00:00.000Z'

/**
 * The class every descriptor in the declared-tier and unrecognized cases carries.
 *
 * Chosen so the destructive lexicon does NOT fire on it: `matchLexicon` tokenizes the action name,
 * and a hit here would make every case below reach `restricted` by an arm other than the one it
 * claims to be testing — which is exactly the drift the reason-text assertions are for.
 */
const ASK_TIER_CLASS = 'fn:fixture.deny-finality'

/**
 * A class the HARD destructive lexicon fires on, via the `shutdown` token.
 *
 * Separate from the one above because it has to be: the lexicon reads the NAME, so this route to
 * `restricted` cannot be turned off for a control while keeping the name equal.
 */
const LEXICON_CLASS = 'fn:fixture.shutdown.now'

const FINALITY_CLAUSE = 'restricted actions are never executable; no grant overrides them'

function capturingSink(): AuditSink & { rows: ExecutionAuditRow[] } {
  const rows: ExecutionAuditRow[] = []
  return {
    rows,
    appendExecutionAudit(row: ExecutionAuditRow) {
      rows.push(row)
    },
    appendGuardrailAudit(_row: GuardrailAuditRow) {},
  }
}

describe('differential 4: a covering standing approval never overrides a restricted verdict', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string
  let sink: ReturnType<typeof capturingSink>
  /** Would say YES to anything. Asserted NEVER consulted on a restricted action. */
  let prompted: RiskActionDescriptor[]

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sovereignty-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    sink = capturingSink()
    prompted = []

    // THE MINT, through the shipped port. Not an appended line and not a literal: a grant that
    // exists because the real mint decided it could, stamped with the real pinned scope, and
    // committed through the same lease and egress checkpoint a person's accept would have used.
    const grants = createGrantOperations({
      resolveKnowledgeRoot: () => knowledgeRoot,
      auditBaseDir: agentQaRoot,
      now: () => NOW_ISO,
    })
    for (const actionClass of [ASK_TIER_CLASS, LEXICON_CLASS]) {
      const recorded = await grants.record({ actionClass, scope: STANDING_APPROVAL_SCOPE })
      expect(recorded.kind).toBe('recorded')
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function reader(): ReturnType<typeof createStandingApprovalReader> {
    return createStandingApprovalReader({ knowledgeRoot })
  }

  function committedEvents(): GrantLedgerEvent[] {
    return readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
  }

  async function verdictFor(action: RiskActionDescriptor, context: ExecutionContext) {
    return await evaluate(
      action,
      context,
      { actionScope: STANDING_APPROVAL_SCOPE },
      {
        auditSink: sink,
        reader: reader(),
        // The confirm that would approve. Present so a restricted denial cannot be confused with
        // "there was nothing left to ask" — a fail-closed denial and a blocked one are different
        // facts, and only one of them is about finality.
        confirm: (descriptor) => {
          prompted.push(descriptor)
          return Promise.resolve(true)
        },
      },
    )
  }

  it('is not vacuous: both grants are committed, active, and returned for their exact classes', () => {
    // The precondition every negative below rests on. Without this, "the grant did not override the
    // deny" would be satisfied just as well by a ledger that never received the grant.
    expect(committedEvents().map((event) => event.kind)).toEqual(['grant', 'grant'])

    for (const actionClass of [ASK_TIER_CLASS, LEXICON_CLASS]) {
      const returned = reader().grantsFor(
        { name: actionClass, recognized: true },
        STANDING_APPROVAL_SCOPE,
      )
      // Both of `grantCovers`'s conditions, asserted at the reader: the class it compares by
      // equality, and the scope it compares by populated-key-set equality. Nothing is left for the
      // match to fail on except the tier.
      expect(returned).toEqual([{ actionClass, scope: STANDING_APPROVAL_SCOPE }])
    }
  })

  it('ADMITTED SIDE: the same grant satisfies an ask on the identical class, headless', async () => {
    // Run HEADLESS on purpose. In a fail-closed context there is no prompt arm at all, so the only
    // thing that can produce an allow is the committed grant — which makes this the strongest
    // available statement that the grant covers the class the two rejected cases below carry.
    const allowed = await verdictFor(
      { name: ASK_TIER_CLASS, recognized: true, declaredTier: 'mutating-shared' },
      'local-headless',
    )

    expect(allowed.verdict).toBe('allow')
    expect(allowed.riskTier).toBe('mutating-shared')
    expect(sink.rows.at(-1)).toMatchObject({
      action: ASK_TIER_CLASS,
      outcome: 'proceeded',
      trustSource: 'standing-approval',
    })
    expect(prompted).toEqual([])
  })

  it('REJECTED, route 1 (declared tier): the identical class at `restricted` is blocked', async () => {
    // ONE FIELD DIFFERS from the admitted case above — `declaredTier`. Same name, same scope, same
    // ledger, same reader. So the denial cannot be attributed to the grant not matching.
    const denied = await verdictFor(
      { name: ASK_TIER_CLASS, recognized: true, declaredTier: 'restricted' },
      'local-headless',
    )

    expect(denied.verdict).toBe('deny')
    expect(denied.riskTier).toBe('restricted')
    // The reason NAMES THE RULE that produced the tier. Asserting the whole sentence rather than a
    // substring is what makes this notice a tier that started arriving from a different arm of the
    // classifier — a `restricted` from the unrecognized fail-safe would read differently and this
    // case would say so instead of passing.
    expect(denied.reason).toBe(`blocked: declared tier: restricted: ${FINALITY_CLAUSE}`)
    // `blocked` and NOT `fail-closed-denied`: the outcome vocabulary is where "the ask arm ran and
    // found nothing" and "the ask arm never ran" are distinguishable, and finality is the second.
    expect(sink.rows.at(-1)).toMatchObject({ outcome: 'blocked', action: ASK_TIER_CLASS })
    expect(sink.rows.at(-1)?.trustSource).toBeUndefined()
  })

  it('REJECTED, route 2 (unrecognized fail-safe): the identical class, unrecognized, is blocked',
    async () => {
      // The second reachable route to `restricted`, and the one a real caller is most likely to
      // hit: an action nobody registered. Same name and same grant as the admitted case.
      const denied = await verdictFor({ name: ASK_TIER_CLASS, recognized: false }, 'local-headless')

      expect(denied.verdict).toBe('deny')
      expect(denied.riskTier).toBe('restricted')
      expect(denied.reason).toBe(`blocked: unrecognized action fail-safe: ${FINALITY_CLAUSE}`)
      expect(sink.rows.at(-1)).toMatchObject({ outcome: 'blocked' })
      expect(sink.rows.at(-1)?.trustSource).toBeUndefined()
    })

  it('REJECTED, route 3 (hard destructive lexicon): a DECLARED ask tier is raised and blocked',
    async () => {
      // The strongest of the three. This descriptor DECLARES `mutating-shared` — the same tier the
      // admitted case declares — and carries a covering grant minted for its exact class. The
      // lexicon raises it anyway, and the raise is final.
      //
      // No identical-name admitted twin is possible here: the lexicon reads the NAME, so any
      // descriptor that could serve as a control would also be restricted. What stands in for it is
      // the reader assertion in the non-vacuity case above, which shows this exact class coming
      // back with both of `grantCovers`'s conditions satisfied.
      const denied = await verdictFor(
        { name: LEXICON_CLASS, recognized: true, declaredTier: 'mutating-shared' },
        'local-headless',
      )

      expect(denied.verdict).toBe('deny')
      expect(denied.riskTier).toBe('restricted')
      expect(denied.reason).toBe(
        `blocked: hard destructive lexicon: ${LEXICON_CLASS}: ${FINALITY_CLAUSE}`,
      )
      expect(sink.rows.at(-1)).toMatchObject({ outcome: 'blocked', action: LEXICON_CLASS })
      expect(sink.rows.at(-1)?.trustSource).toBeUndefined()
    })

  it('the prompt is never reached either: a restricted action denies with a confirm that would say yes',
    async () => {
      // The other side of "blocked computes before resolveAsk". The two rejected cases above run
      // headless, where a denial is also the fail-closed answer; this one runs INTERACTIVE with a
      // confirm that approves everything. If the restricted tier were resolved through the ask
      // ladder at all — by the grant, or past it by the prompt — this would allow.
      const denied = await verdictFor(
        { name: ASK_TIER_CLASS, recognized: true, declaredTier: 'restricted' },
        'local-interactive',
      )

      expect(denied.verdict).toBe('deny')
      expect(sink.rows.at(-1)).toMatchObject({ outcome: 'blocked' })
      expect(prompted).toEqual([])

      // And the control that keeps THAT from being a claim about this fixture's confirm never
      // working: the same context, the same confirm, an ask-tier action whose grant is already
      // gone from the picture — a class nothing was ever minted for — is prompted and allowed.
      const allowed = await verdictFor(
        { name: 'fn:fixture.unrelated', recognized: true, declaredTier: 'mutating-shared' },
        'local-interactive',
      )
      expect(allowed.verdict).toBe('allow')
      expect(sink.rows.at(-1)).toMatchObject({ outcome: 'prompted-approved', trustSource: 'tty-prompt' })
      expect(prompted.map((descriptor) => descriptor.name)).toEqual(['fn:fixture.unrelated'])
    })
})
