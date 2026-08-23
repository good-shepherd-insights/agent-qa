// THE DISPATCH-SCOPED GRANT OVERLAY (Phase 401 plan 08 — D-08, RESEARCH Pitfall 6).
//
// WHAT THESE CELLS MEASURE is the overlay's own arithmetic and the ONE seam that carries it to the
// run gate. What they deliberately do NOT measure is the gate's verdict — that is a property of
// `resolveAsk`'s ladder over a real run, and it is measured where a real run happens
// (`packages/cli/src/composition/__tests__/dispatch-grant-gate.e2e.test.ts`). A cell here that
// asserted "the run proceeded" would be asserting its own fake.
//
// EVERY CELL BELOW HAS A STATED RED. The overlay is new, so none of them has a natural pre-change
// failure; their bar is the mutation ledger in this plan's SUMMARY, and each cell names the
// mutation that reds it.

import { describe, expect, it } from 'vitest'

import { NO_STANDING_APPROVALS } from '@vostride/agent-qa-safety'
import type { StandingApprovalReader } from '@vostride/agent-qa-safety'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type { RiskActionDescriptor, RunsStartInput } from '@vostride/agent-qa-schema'

import { createDispatchGrants } from '../dispatch-grants.js'
import { createLocalRunInvocation } from '../compose-local-agent.js'
import type { RunExecutionPort } from '../compose-local-agent.js'
import { RUN_START_RISK_ACTION_NAME, buildRunRiskDescriptor } from '../run-risk.js'

/** The descriptor the core actually evaluates, built by the shipped builder rather than typed here. */
const RUN_ACTION: RiskActionDescriptor = buildRunRiskDescriptor('shared')

/** An unrelated action, so "answers for every action" and "answers for this one" can differ. */
const OTHER_ACTION: RiskActionDescriptor = { name: 'fn:runs.start', recognized: true }

/** A durable reader with one hand-written line in it — the ledger's own model of a grant. */
function ledgerServing(actionClass: string): StandingApprovalReader {
  return { grantsFor: () => [{ actionClass, scope: STANDING_APPROVAL_SCOPE }] }
}

describe('the overlay grants only while a dispatch is open (D-08, T-401-22)', () => {
  it('NOTHING AT REST — with no dispatch open it answers exactly what the ledger answers', () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(NO_STANDING_APPROVALS)

    expect(grants.openScopes).toBe(0)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('THE GRANT APPEARS WITH THE SCOPE and is spelled from the run gate\'s own constants', () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(NO_STANDING_APPROVALS)
    const lease = grants.open()

    const answered = reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
    expect(answered).toEqual([
      { actionClass: RUN_START_RISK_ACTION_NAME, scope: STANDING_APPROVAL_SCOPE },
    ])
    // The two halves `grantCovers` compares, asserted against the SHIPPED descriptor and the
    // SHIPPED scope rather than against strings typed into this cell. A grant that failed either
    // comparison would be an overlay that grants nothing at all — green at rest, and the exact
    // vacuity 401-05's Truth 3 had to be rescued from.
    expect(answered[0]!.actionClass).toBe(RUN_ACTION.name)
    expect(answered[0]!.scope).toEqual(STANDING_APPROVAL_SCOPE)

    lease.dispose()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('IT IS READ AT ANSWER TIME — a reader taken BEFORE the dispatch opened still sees it', () => {
    // The run invocation builds a reader per call, but a door that cached one must not be able to
    // freeze the overlay's answer at the moment it took its reference. Reds if `open.size` is read
    // when `readerOver` is called instead of when `grantsFor` is.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])

    const lease = grants.open()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)
    lease.dispose()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('TWO OVERLAPPING DISPATCHES — disposing one does not retire the other\'s grant', () => {
    // A counter would pass the single-lease cells above and fail here. Two conversations, or a
    // repair probe taken while an outer scope is open, are the shapes that interleave.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)

    const outer = grants.open()
    const inner = grants.open()
    expect(grants.openScopes).toBe(2)

    inner.dispose()
    expect(grants.openScopes).toBe(1)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)

    outer.dispose()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('DISPOSE IS IDEMPOTENT — a second release does not retire somebody else\'s dispatch', () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)

    const first = grants.open()
    const second = grants.open()
    first.dispose()
    first.dispose()
    first.dispose()

    expect(grants.openScopes).toBe(1)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)
    second.dispose()
    expect(grants.openScopes).toBe(0)
  })

  it('THE UNION IS A UNION — the ledger\'s own answer survives the overlay in front of it', () => {
    // The dangerous direction, and the reason this cell exists: an overlay composed in front of the
    // ledger that REPLACED it would silently stop honouring a `run:start` line a person wrote by
    // hand — a one-sided tightening arriving as a side effect of a feature about widening.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(ledgerServing('run:start'))

    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([
      { actionClass: 'run:start', scope: STANDING_APPROVAL_SCOPE },
    ])

    const lease = grants.open()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(2)
    lease.dispose()
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)
  })

  it('THE OVERLAY NAMES ONE ACTION CLASS, and it is not the op gate\'s', () => {
    // `grantCovers` matches on the exact name, so this is what the gate would refuse anyway — but
    // asserting it HERE says the overlay never had the op's name to hand over in the first place.
    // There is no parameter on `open()` that could introduce one.
    const grants = createDispatchGrants()
    const lease = grants.open()
    const answered = grants.readerOver(undefined).grantsFor(OTHER_ACTION, STANDING_APPROVAL_SCOPE)
    expect(answered.map((grant) => grant.actionClass)).toEqual([RUN_START_RISK_ACTION_NAME])
    expect(answered.some((grant) => grant.actionClass === OTHER_ACTION.name)).toBe(false)
    lease.dispose()
  })
})

describe('the composition carries the overlay to the run gate (D-08)', () => {
  /** A host that records the gate argument and reports a run id it never ran. */
  function recordingExecution(): {
    port: RunExecutionPort
    readers: (StandingApprovalReader | undefined)[]
  } {
    const readers: (StandingApprovalReader | undefined)[] = []
    return {
      readers,
      port: {
        execute(_request: RunsStartInput, gate?: { readonly reader?: StandingApprovalReader }) {
          readers.push(gate?.reader)
          return Promise.resolve({ runId: 'r_never-ran' as never })
        },
      },
    }
  }

  /**
   * Start a run through the binding and swallow the evidence check.
   *
   * `createLocalRunInvocation` reads the run's own event log back and refuses an empty one
   * (`RunProducedNoEventsError`) — correct, and irrelevant here: the reader is handed over BEFORE
   * that check, which is the only thing these two cells are about.
   */
  async function startIgnoringEvidence(
    start: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await start()
    } catch {
      // the evidence check, deliberately unmeasured here
    }
  }

  it('THE READER HANDED OVER IS THE OVERLAY\'S, resolved per run', async () => {
    const grants = createDispatchGrants()
    const execution = recordingExecution()
    const invocation = createLocalRunInvocation({
      agentQaRoot: '/nowhere/.agent-qa',
      execution: execution.port,
      resolveRunGrants: async () =>
        await Promise.resolve(grants.readerOver(ledgerServing('something-else'))),
    })

    // Run one: no dispatch open. The reader answers the ledger and nothing else.
    await startIgnoringEvidence(() => invocation.start({ patterns: ['tests/a.yaml'] }))
    const atRest = execution.readers[0]
    expect(atRest).toBeDefined()
    expect(atRest!.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
      .map((grant) => grant.actionClass)).toEqual(['something-else'])

    // Run two: a dispatch is open. THE SAME BINDING resolves a reader that now grants `run:start`.
    const lease = grants.open()
    await startIgnoringEvidence(() => invocation.start({ patterns: ['tests/a.yaml'] }))
    const inDispatch = execution.readers[1]
    expect(inDispatch).toBeDefined()
    // ASKED WHILE THE DISPATCH IS STILL OPEN, deliberately. The overlay reads its open set at
    // ANSWER time (the cell three above pins that), so interrogating a captured reader after the
    // lease was released would measure the expiry, not the carriage — and would report the
    // carriage as broken. The expiry is measured over a REAL gate in the cli e2e cells.
    expect(inDispatch!.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
      .map((grant) => grant.actionClass))
      .toEqual(['something-else', RUN_START_RISK_ACTION_NAME])
    lease.dispose()
    expect(inDispatch!.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
      .map((grant) => grant.actionClass)).toEqual(['something-else'])

    // TWO CALLS, TWO RESOLUTIONS. A reader resolved once at composition time would have handed the
    // same object twice, and the second run would have been decided by what was true when the host
    // was built rather than by what is true now.
    expect(execution.readers).toHaveLength(2)
    expect(inDispatch).not.toBe(atRest)
  })

  it('NO RESOLVER, NO FIELD — a composition that supplies none hands the host nothing', async () => {
    // The pre-401-08 posture, kept reachable: an absent authority must be an ABSENT field, never a
    // present `undefined`, so the gate's own `NO_STANDING_APPROVALS` default answers in one place.
    const execution = recordingExecution()
    const invocation = createLocalRunInvocation({
      agentQaRoot: '/nowhere/.agent-qa',
      execution: execution.port,
    })
    await startIgnoringEvidence(() => invocation.start({ patterns: ['tests/a.yaml'] }))
    expect(execution.readers).toEqual([undefined])
  })
})
