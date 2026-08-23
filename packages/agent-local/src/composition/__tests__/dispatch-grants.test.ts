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
//
// 401-13 (verification gap CR-03) RESTRUCTURED THIS FILE onto the dispatch SCOPE that replaced the
// lease handle, preserving each cell's measured property, and added the axis the file never had:
// every cell here used to interrogate the reader from the test body while a lease was open, which
// is precisely the unrelated caller the gap is about — so on the old API "outside the tree" and
// "inside the tree" were the same call. They are now different calls, and the difference is the fix.

import { readFileSync } from 'node:fs'

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

describe('the overlay grants only inside an open dispatch\'s own call tree (D-08, T-401-22, CR-03)', () => {
  it('NOTHING AT REST — with no dispatch open it answers exactly what the ledger answers', () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(NO_STANDING_APPROVALS)

    expect(grants.openScopes).toBe(0)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('THE GRANT APPEARS INSIDE THE SCOPE and is spelled from the run gate\'s own constants', async () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(NO_STANDING_APPROVALS)

    const answered = await grants.within(async () =>
      await Promise.resolve(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)))

    expect(answered).toEqual([
      { actionClass: RUN_START_RISK_ACTION_NAME, scope: STANDING_APPROVAL_SCOPE },
    ])
    // The two halves `grantCovers` compares, asserted against the SHIPPED descriptor and the
    // SHIPPED scope rather than against strings typed into this cell. A grant that failed either
    // comparison would be an overlay that grants nothing at all — green at rest, and the exact
    // vacuity 401-05's Truth 3 had to be rescued from.
    expect(answered[0]!.actionClass).toBe(RUN_ACTION.name)
    expect(answered[0]!.scope).toEqual(STANDING_APPROVAL_SCOPE)

    // And the scope ended with the callback.
    expect(grants.openScopes).toBe(0)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('AN UNRELATED CALLER GETS THE LEDGER AND NOTHING ELSE — CR-03, at the unit', async () => {
    // THE CELL THIS FILE NEVER HAD, and the unit-level spelling of the gap. Every other cell in
    // this describe varies whether a dispatch is running; this one holds a dispatch OPEN and varies
    // WHO IS ASKING. Reds on the pre-401-13 branch (`if (open.size === 0) return persisted`), which
    // answers this caller and the dispatch's own calls identically.
    const grants = createDispatchGrants()
    // A ledger line for the SAME class the overlay grants, on purpose. `RUN_START_RISK_ACTION_NAME`
    // IS `'run:start'`, so a "no grant of that name is present" assertion would be VACUOUS here —
    // the hand-written line answers to it. The discriminator is the COUNT: the outsider gets the
    // ledger's one entry, and an overlay that answered them gets two. Written down because the
    // first draft of this cell asserted the name and measured nothing.
    const reader = grants.readerOver(ledgerServing(RUN_START_RISK_ACTION_NAME))

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    let insideSaw = -1
    const dispatch = grants.within(async () => {
      insideSaw = reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE).length
      await held
    })
    // The dispatch is provably open at the moment the outsider asks — this is not an expiry
    // measurement dressed up as a scoping one.
    await Promise.resolve()
    expect(grants.openScopes).toBe(1)

    // Asked from the test body: an async context that is NOT inside the scope's tree.
    const outsideSaw = reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
    expect(outsideSaw).toEqual([
      { actionClass: RUN_START_RISK_ACTION_NAME, scope: STANDING_APPROVAL_SCOPE },
    ])
    // AND THE SCOPE IS NOT INERT. Two entries inside, one outside, same reader, same instant —
    // without this the cell is equally satisfied by an overlay that grants nobody anything.
    expect(insideSaw).toBe(2)

    release!()
    await dispatch
    expect(grants.openScopes).toBe(0)
  })

  it('THE SAME READER ANSWERS BOTH WAYS AT ONCE — one object, two callers, two answers', async () => {
    // The two-sided pair in ONE cell, because the discriminating claim is not "outsiders get
    // nothing" or "insiders get the grant" taken separately — it is that one reader tells them
    // apart while both are live. An overlay that granted nobody passes the outsider cell above; an
    // overlay that granted everybody passes the insider cell before it. Only this one refuses both.
    //
    // It also crosses the boundary the mechanism is most exposed at: `insideAfterHold` is asked
    // AFTER an `await` on a promise a different async tree resolved, so it measures that the store
    // survives a suspension rather than assuming it.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)
    const classes = (): string[] =>
      reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE).map((grant) => grant.actionClass)

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    let insideDuring: string[] = ['unmeasured']

    const dispatch = grants.within(async () => {
      insideDuring = classes()
      await held
      return classes()
    })

    await Promise.resolve()
    const outsideDuring = classes()
    release!()
    const insideAfterHold = await dispatch

    expect(insideDuring).toEqual([RUN_START_RISK_ACTION_NAME])
    expect(insideAfterHold).toEqual([RUN_START_RISK_ACTION_NAME])
    expect(outsideDuring).toEqual([])
  })

  it('IT IS READ AT ANSWER TIME — a reader taken BEFORE the dispatch opened still sees it', async () => {
    // The run invocation builds a reader per call, but a door that cached one must not be able to
    // freeze the overlay's answer at the moment it took its reference. Reds if the open set or the
    // asking context is read when `readerOver` is called instead of when `grantsFor` is.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])

    const inside = await grants.within(async () =>
      await Promise.resolve(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)))
    expect(inside).toHaveLength(1)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('TWO OVERLAPPING DISPATCHES — one ending does not retire the other\'s grant', async () => {
    // A counter would pass the single-scope cells above and fail here. Two conversations, or a
    // repair probe taken while an outer scope is open, are the shapes that interleave. Each tree
    // carries its OWN token, and each token is checked against the open set independently.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)
    const answered = (): number => reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE).length

    let releaseOuter: (() => void) | undefined
    const outerHeld = new Promise<void>((resolve) => { releaseOuter = resolve })
    let outerSawAfterInner = -1

    const outer = grants.within(async () => {
      expect(answered()).toBe(1)
      // The inner scope runs to completion INSIDE the outer's tree.
      await grants.within(async () => {
        expect(grants.openScopes).toBe(2)
        expect(answered()).toBe(1)
        await Promise.resolve()
      })
      expect(grants.openScopes).toBe(1)
      // The outer's coverage survived the inner ending — the token check, not a counter.
      outerSawAfterInner = answered()
      await outerHeld
    })

    await Promise.resolve()
    releaseOuter!()
    await outer

    expect(outerSawAfterInner).toBe(1)
    expect(grants.openScopes).toBe(0)
    expect(answered()).toBe(0)
  })

  it('A CONTINUATION THAT OUTLIVES THE SCOPE IS NOT COVERED — T-401-22, and why the Set stays', async () => {
    // THE ASYNC CONTEXT IS NOT THE WHOLE MECHANISM, and this cell is what proves the open set earns
    // its place. A timer SCHEDULED INSIDE the scope inherits the store at schedule time, so when it
    // fires after the dispatch has returned and its `finally` has run, `getStore()` still hands back
    // the scope's token. The Set is the only thing that can tell that token is stale.
    //
    // TWO TIMERS, AND THE FIRST ONE IS THE CONTROL. Without it, the second timer's empty answer is
    // equally well explained by "timers do not inherit the store at all", which would make this a
    // cell that measures the platform rather than the overlay. The first fires while the scope is
    // still open and MUST see the grant; the second fires after it has closed and must not.
    //
    // The first draft captured a CLOSURE inside the scope and called it from the test body, which
    // measured nothing — a lexical capture carries no async context, so that call was just another
    // outsider and the `getStore() === undefined` branch answered it. It passed under a mutation
    // that deleted the `open.has(token)` check entirely.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)
    const classes = (): string[] =>
      reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE).map((grant) => grant.actionClass)

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    let resolveAfter: (() => void) | undefined
    const afterFired = new Promise<void>((resolve) => { resolveAfter = resolve })

    let duringScope: string[] = ['unmeasured']
    let afterScope: string[] = ['unmeasured']

    const dispatch = grants.within(async () => {
      setTimeout(() => { duringScope = classes() }, 1)
      await held
      setTimeout(() => { afterScope = classes(); resolveAfter!() }, 1)
    })

    await new Promise<void>((resolve) => { setTimeout(resolve, 20) })
    release!()
    await dispatch
    expect(grants.openScopes).toBe(0)
    await afterFired

    expect(duringScope).toEqual([RUN_START_RISK_ACTION_NAME])
    expect(afterScope).toEqual([])
  })

  it('A THROWN DISPATCH RETIRES ITS GRANT — disposal is the scope\'s own finally', async () => {
    const grants = createDispatchGrants()
    const reader = grants.readerOver(undefined)

    await expect(grants.within(async () => {
      expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)
      await Promise.resolve()
      throw new Error('the dispatch threw')
    })).rejects.toThrow('the dispatch threw')

    expect(grants.openScopes).toBe(0)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([])
  })

  it('THE UNION IS A UNION — the ledger\'s own answer survives the overlay in front of it', async () => {
    // The dangerous direction, and the reason this cell exists: an overlay composed in front of the
    // ledger that REPLACED it would silently stop honouring a `run:start` line a person wrote by
    // hand — a one-sided tightening arriving as a side effect of a feature about widening.
    const grants = createDispatchGrants()
    const reader = grants.readerOver(ledgerServing('run:start'))

    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toEqual([
      { actionClass: 'run:start', scope: STANDING_APPROVAL_SCOPE },
    ])

    const inside = await grants.within(async () =>
      await Promise.resolve(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)))
    expect(inside).toHaveLength(2)
    expect(reader.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)).toHaveLength(1)
  })

  it('THE OVERLAY NAMES ONE ACTION CLASS, and it is not the op gate\'s', async () => {
    // `grantCovers` matches on the exact name, so this is what the gate would refuse anyway — but
    // asserting it HERE says the overlay never had the op's name to hand over in the first place.
    // There is no parameter on `within()` that could introduce one.
    const grants = createDispatchGrants()
    const answered = await grants.within(async () =>
      await Promise.resolve(grants.readerOver(undefined)
        .grantsFor(OTHER_ACTION, STANDING_APPROVAL_SCOPE)))
    expect(answered.map((grant) => grant.actionClass)).toEqual([RUN_START_RISK_ACTION_NAME])
    expect(answered.some((grant) => grant.actionClass === OTHER_ACTION.name)).toBe(false)
  })

  it('THE SCOPE API NAMES NOTHING — its one parameter is the continuation', () => {
    // 401-08's stated law, re-pinned against the API that replaced `open()`. A parameter naming an
    // action class, a scope, a run budget or a dispatch id would each be a channel for widening an
    // approval a person already gave — and the last of those is exactly the request-carried token
    // this plan rejected. Structural because no behavioural cell can see a parameter that is not
    // there; its honest limit is that it reads the source rather than the type.
    const source = readFileSync(new URL('../dispatch-grants.ts', import.meta.url), 'utf8')
    expect(source).toContain('within<T>(fn: () => Promise<T>): Promise<T>')
    expect(source).toContain('async within<T>(fn: () => Promise<T>): Promise<T> {')
    expect(source).toContain('function dispatchGrant(): StandingApprovalGrant {')
    // Nothing in this file reads a caller-suppliable field, and the grant is spelled from the two
    // pinned constants alone.
    const code = source.split('\n').filter((line) => !line.trim().startsWith('//'))
    expect(code.some((line) => line.includes('actionClass:')
      && !line.includes('RUN_START_RISK_ACTION_NAME'))).toBe(false)
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

    // Run two: started INSIDE a dispatch scope. THE SAME BINDING resolves a reader that now grants
    // `run:start` — and this is the carriage claim 401-13 sharpened: what makes the difference is
    // not that a dispatch exists somewhere, it is that THIS run was started by it. The binding
    // resolves its reader through several awaits (`resolveRunGrants` is async and the invocation
    // awaits it), so a green here is also the measurement that the scope survives that chain.
    const inScope = await grants.within(async () => {
      await startIgnoringEvidence(() => invocation.start({ patterns: ['tests/a.yaml'] }))
      const reader = execution.readers[1]
      expect(reader).toBeDefined()
      // ASKED FROM INSIDE THE SCOPE, deliberately. The overlay reads its open set AND the asking
      // context at ANSWER time (the cell above pins that), so interrogating a captured reader from
      // the test body would measure the caller axis, not the carriage — and would report the
      // carriage as broken. Both axes are measured over a REAL gate in the cli e2e cells.
      expect(reader!.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
        .map((grant) => grant.actionClass))
        .toEqual(['something-else', RUN_START_RISK_ACTION_NAME])
      return reader
    })
    const inDispatch = inScope
    // Outside the scope again, the same object answers the ledger and nothing else.
    expect(inDispatch!.grantsFor(RUN_ACTION, STANDING_APPROVAL_SCOPE)
      .map((grant) => grant.actionClass)).toEqual(['something-else'])

    // TWO CALLS, TWO RESOLUTIONS. A reader resolved once at composition time would have handed the
    // same object twice, and the second run would have been decided by what was true when the host
    // was built rather than by what is true now.
    expect(execution.readers).toHaveLength(2)
    expect(inDispatch).not.toBe(atRest)
  })

  it('ONE OVERLAY PER COMPOSITION — the shelf and the run gate cannot be handed different objects', () => {
    // THE ONE SEAM NO BEHAVIOURAL CELL IN THIS PLAN CAN SEE, so it is pinned at its source.
    //
    // The loop's scope and the run gate's reader are only the same approval because they come from
    // the SAME object. A composition that minted a second overlay for the shelf binding would pass
    // every other cell here and every cell at the door — the loop would run inside one object's
    // scope and the gate would read the other, and every child gate run would deny after a person
    // approved. There
    // is no fixture in this plan that can drive `authoring.draft.write` end to end (its op gate is
    // `mutating-shared` and fail-closed under vitest, and stage 3 needs a model), so the guard is
    // structural: `createDispatchGrants()` is CALLED in exactly one place in first-party source.
    //
    // Its honest limit, stated: this says there is one instance, not that the two readers of it are
    // the same expression. A second `const` aliasing the same object would still pass.
    const composition = readFileSync(
      new URL('../compose-local-agent.ts', import.meta.url),
      'utf8',
    )
    const calls = composition.split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .filter((line) => line.includes('createDispatchGrants('))
    expect(calls).toHaveLength(1)
    // Both consumers read the one binding the line above produces.
    expect(composition).toContain('dispatchGrants.readerOver(')
    expect(composition).toContain('within: <T>(fn: () => Promise<T>): Promise<T> => dispatchGrants.within(fn)')
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
