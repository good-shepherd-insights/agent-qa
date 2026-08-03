/**
 * D-16's LAST HOP: no consumer may drop the trace between the reader port and evidence
 * (Phase 387-04, KREV-02).
 *
 * The structural half of this is a signature — `recordServedBrief` and `recordServedCautions` take
 * the trace as a REQUIRED parameter, so a loop that obtained a composite and discarded its trace
 * cannot compile. That half is enforced by `tsc` and exercised by every runner suite.
 *
 * This file covers what a type cannot see: that the loop actually threads the trace it received
 * rather than manufacturing a fresh empty one at the recorder call. A `trace: emptyTrace()` at the
 * call site would type-check perfectly and would make D-16 vacuous at the exact hop it is meant to
 * protect — so it is scanned for, with a planted violation confirming the scan can reject.
 *
 * `grep` is deliberately unused: it has silently returned nothing for patterns demonstrably
 * present in this tree, and a gate that can fail open is worse than no gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { computeBriefDigest, type BriefBlock, type TraceLine } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { KnowledgeHintReader, ServedCautions } from '../../knowledge-hint-reader.js'
import type { ActionResult } from '../../platform.js'
import { executeStep } from '../index.js'
import type { LoopPorts } from '../ports.js'
import type { ActionPlan } from '../types.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext } from './loop-harness.js'
import { noCautions, servedBrief, servedCautions } from './fixtures/served-trace.js'

const loopDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function statementsOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('the loop threads the serve-time trace to the evidence seam (387-04)', () => {
  const source = statementsOf(readFileSync(join(loopDir, 'index.ts'), 'utf8'))

  it('hands the recorder the trace it was served, never a fabricated one', () => {
    // The composite is destructured once and its own `trace` is what reaches the recorder.
    expect(occurrences(source, 'trace: served.trace')).toBe(1)
    expect(occurrences(source, 'recorder.recordServedCautions(injected, cautionsForTurn.trace)'))
      .toBe(1)

    // No empty/synthetic trace is constructed anywhere in the loop.
    for (const forbidden of [
      'servedLines: []',
      'truncated: []',
      'schemaVersion: 1',
    ]) {
      expect(occurrences(source, forbidden)).toBe(0)
    }

    // POSITIVE CONTROL: the fabricated-trace shape this scan exists to reject is rejected.
    const planted = `${source}\n  recorder.recordServedBrief({ block, trace: { schemaVersion: 1, servedLines: [], truncated: [] } })\n`
    expect(occurrences(planted, 'servedLines: []')).toBe(1)
    expect(occurrences(planted, 'schemaVersion: 1')).toBe(1)

    // INVERSE CONTROL: the same shape in PROSE must not be flagged, which is the failure mode a
    // naive substring scan hits in this file — it explains the contract it implements.
    expect(occurrences(
      statementsOf('// never write servedLines: [] here\n/* nor schemaVersion: 1 */\nconst x = 1\n'),
      'servedLines: []',
    )).toBe(0)
  })

  it('reads both composite entries exactly once each', () => {
    // Two serving entries cross this seam; a third call would be a serve nobody attributed.
    expect(occurrences(source, '.getRunBrief(')).toBe(1)
    expect(occurrences(source, '.getCautions(')).toBe(1)
    expect(occurrences(`${source}\nports.knowledgeReader?.getRunBrief(s, b)\n`, '.getRunBrief(')).toBe(2)
  })
})

/**
 * WR-10 (Phase 387-13): the scan above proves the loop hands over the trace it was SERVED. It
 * cannot see whether the loop hands it over AT ALL on a turn that injected nothing — that is a
 * control-flow fact, and the source text of a call site says nothing about the gate enclosing it.
 *
 * This section runs the loop. Shape A is the zero-injection case whose drop gate lives HERE, in
 * `index.ts`: the reader ranked candidates and budget-cut every one of them, so `block.cautions`
 * is empty, the caution turn's enclosing condition is false, and the recorder is never reached.
 * That is precisely the step "why didn't it mention X" is asked about.
 */
const EMPTY_BRIEF: BriefBlock = {
  tiers: { L0: '', L1: '', L2: '' },
  lines: [],
  truncation: '',
  admissions: [],
}

const BUDGETS = { brief: 64, searchResults: 64, caution: 24, readBody: 64, recordCap: 8 }

function cut(recordId: string, rank: number, score: number): TraceLine {
  return { recordId, leg: 'anchor', rank, score }
}

/**
 * A reader whose caution serve is SCRIPTED per lookup, so a step with two failure moments can
 * hand each staging its own cut candidates. One entry behaves exactly like the fixed-shape stub
 * this replaced (the index clamps), which is what keeps the WR-10 cases below unchanged.
 */
function readerServing(...serves: ServedCautions[]): KnowledgeHintReader {
  let call = 0
  return {
    // The Channel-1 trace is deliberately empty, so any cut candidate reaching evidence can only
    // have come through Channel 3. A brief-borne cut would make the assertion below pass for a
    // reason that has nothing to do with the caution turn.
    getRunBrief: () => servedBrief(EMPTY_BRIEF),
    search: () => [],
    read: () => { throw new Error('not used') },
    getCautions: () => serves[Math.min(call++, serves.length - 1)]!,
    getProcedure: () => undefined,
    emitCanaryOutcome: () => {},
  }
}

const ACTION_FAILED: ActionResult = { success: false, error: 'Browser process disconnected' }

interface LoopShape {
  /** Scripted adapter results; the last entry repeats, so `[ACTION_FAILED]` never succeeds. */
  executeResults?: ActionResult[]
  plans?: ActionPlan[]
  /** D-10 remaining-budget cap. Absent ⇒ the loop's own default (50), i.e. no early exit. */
  maxSubActions?: number
}

function ports(serves: ServedCautions[], shape: LoopShape = {}): LoopPorts {
  const loopPorts: LoopPorts = {
    adapter: makeAdapter({
      executeResults: shape.executeResults ?? [ACTION_FAILED, { success: true }],
    }),
    planner: makePlanner(shape.plans ?? [
      makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
      makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
    ]),
    knowledgeReader: readerServing(...serves),
    knowledgeBudgets: BUDGETS,
  }
  if (shape.maxSubActions !== undefined) {
    loopPorts.plannerConfig = { maxSubActions: shape.maxSubActions, previousStepCount: 0 }
  }
  return loopPorts
}

/** One action failure followed by a success — the shape that triggers exactly one caution turn. */
async function replanAfterFailure(cautions: ServedCautions): ReturnType<typeof executeStep> {
  return executeStep('Click Log in', ports([cautions]), makeStepContext({ testName: 'Checkout Flow' }))
}

describe('a turn that injected ZERO cautions still lands the reader cut ledger (WR-10, 387-13)', () => {
  it('Shape A: the reader ranked candidates and cut them all', async () => {
    // RED BASELINE, observed against unmodified production code before the fix:
    //   AssertionError: expected [] to deeply equal [ 'caution-cut-a', 'caution-cut-b' ]
    // `retrievalTrace` was PRESENT but its `truncated` ledger was EMPTY — the Channel-1 record
    // makes the trace object exist, so an assertion that merely checked for its presence would
    // have passed over the defect. The drop is at the caution turn's own gate in `index.ts`:
    // with `block.cautions` empty the branch is skipped entirely and `recordServedCautions` is
    // never called, so the recorder body never sees this trace at all.
    const served = await replanAfterFailure(servedCautions(
      { cautions: [], budgetUsed: 0, admissions: [] },
      {
        schemaVersion: 1,
        servedLines: [],
        truncated: [cut('caution-cut-a', 4, 0.31), cut('caution-cut-b', 5, 0.22)],
      },
    ))

    const persisted = served.evidence?.retrievalTrace
    expect(persisted?.truncated.map(({ recordId }) => recordId))
      .toEqual(['caution-cut-a', 'caution-cut-b'])
    // Honesty (D-2 / 387-04 probe r4, extended to the all-cut case): nothing was rendered into
    // the turn, so nothing may be claimed as served testimony.
    expect(persisted?.servedLines).toEqual([])
  })

  it('Shape A leaves the ServedBrief bytes exactly where the no-caution baseline left them', async () => {
    // D-13: the repair may not dent byte-stability. The comparison is against a real replan that
    // served no caution trace at all, not against a hand-built empty brief — the two runs differ
    // ONLY in what the reader's caution trace carried.
    const laden = await replanAfterFailure(servedCautions(
      { cautions: [], budgetUsed: 0, admissions: [] },
      { schemaVersion: 1, servedLines: [], truncated: [cut('caution-cut-a', 4, 0.31)] },
    ))
    const baseline = await replanAfterFailure(noCautions())

    expect(laden.evidence?.servedBrief.channel3).toHaveLength(0)
    expect(JSON.stringify(laden.evidence?.servedBrief))
      .toBe(JSON.stringify(baseline.evidence?.servedBrief))
    expect(laden.evidence?.servedBrief.briefDigest)
      .toBe(computeBriefDigest({ ...laden.evidence!.servedBrief, briefDigest: '' }))
    // The guard is not vacuously true over two empty things: the laden run really did carry a cut.
    expect(laden.evidence?.retrievalTrace?.truncated).toHaveLength(1)
  })
})

/**
 * WR-10′ (Phase 387-15): every case above drives a step that reaches its NEXT planning turn, which
 * is where a staged caution composite is picked up. The staged value is consumed there and nowhere
 * else, and the loop has exits above that pickup — the step deadline and the D-10 remaining-budget
 * cap. A step that ends at one of those exits loses the whole staged ledger, and the terminal
 * failure is precisely the turn "why didn't it mention X" is asked about.
 *
 * The suite's input domain had no step that ends early. These cases add one. The closure is a
 * single backstop drain inside `finish()` — the file's own single terminal funnel — never an
 * enumeration of the exit sites, which is the failure mode this whole arc exists to end.
 */
/**
 * A staged composite whose block renders NOTHING. `served` are lines the reader handed over for a
 * turn that never came; `cutCandidates` are the ones it had already dropped. Both must reach
 * evidence as candidates — a line the reader served to a turn that never ran was still not shown
 * to anybody, and `cut` builds either side because the two differ only in which array they sit in.
 */
function stagedServe(served: TraceLine[], cutCandidates: TraceLine[]): ServedCautions {
  return servedCautions(
    { cautions: [], budgetUsed: 0, admissions: [] },
    { schemaVersion: 1, servedLines: served, truncated: cutCandidates },
  )
}

/** A step whose every action fails and whose budget ends it after `maxSubActions` iterations. */
async function endsAtBudget(
  serves: ServedCautions[],
  maxSubActions: number,
): ReturnType<typeof executeStep> {
  return executeStep(
    'Click Log in',
    ports(serves, {
      executeResults: [ACTION_FAILED],
      plans: [
        makeActionPlan({ action: { type: 'click', ref: 'e2' } }),
        makeActionPlan({ action: { type: 'click', ref: 'e1' } }),
      ],
      maxSubActions,
    }),
    makeStepContext({ testName: 'Checkout Flow' }),
  )
}

describe('a step that ENDS before its staged ledger is consumed still lands it (WR-10′, 387-15)', () => {
  it('terminal budget exit: the staged cut ledger survives the step that never replanned', async () => {
    // RED BASELINE, observed against unmodified production code before the drain existed:
    //   AssertionError: expected [] to deeply equal [ 'caution-cut-a', 'caution-cut-b' ]
    // `retrievalTrace` was PRESENT (the Channel-1 brief record makes the object exist) with an
    // EMPTY `truncated` — the same trap Shape A recorded: an assertion on the mere presence of
    // `retrievalTrace` would have passed straight over the defect. The drop is at neither of
    // WR-10's three gates: the composite was staged correctly and the recorder would have
    // accumulated it correctly; the step simply RETURNED at the remaining-budget exit before the
    // consuming turn ran, and nothing drained what was staged.
    const served = await endsAtBudget([stagedServe(
      // A line the reader SERVED for the turn that never came. Its presence is what makes the
      // honesty assertion below non-vacuous: with a served-lines-empty trace, no implementation
      // could populate `servedLines` at all, so the assertion would hold for a reason having
      // nothing to do with the drain (found by probing this case's own controls — m4).
      [cut('caution-served-x', 1, 0.88)],
      [cut('caution-cut-a', 4, 0.31), cut('caution-cut-b', 5, 0.22)],
    )], 1)

    // The step really did end at the budget, not at a replan that happened to work.
    expect(served.status).toBe('failed')
    expect(served.error).toContain('Sub-action limit reached')

    const persisted = served.evidence?.retrievalTrace
    // Non-injected served lines first, then the reader's own cuts — the recorder's uniform split,
    // applied to the terminal turn with no special case.
    expect(persisted?.truncated.map(({ recordId }) => recordId))
      .toEqual(['caution-served-x', 'caution-cut-a', 'caution-cut-b'])
    // Nothing was rendered into any turn, so nothing may be claimed as served testimony
    // (D-2 / 387-04 probe r4, carried to the terminal turn).
    expect(persisted?.servedLines).toEqual([])
  })

  it('two stagings: the terminal drain APPENDS to the consumed one, it does not replace it', async () => {
    // RED BASELINE, observed against unmodified production code:
    //   AssertionError: expected [ 'staged-a-cut' ] to deeply equal [ 'staged-a-cut', 'staged-b-cut' ]
    // The failure mode differs from the case above and that difference is the point: staging A WAS
    // consumed by the intervening turn and reached evidence, so the ledger is non-empty and only
    // the LAST staging is missing. A control that asserted "truncated is non-empty" would have
    // passed here while the terminal step's own ledger was still being dropped.
    const served = await endsAtBudget(
      [stagedServe([], [cut('staged-a-cut', 4, 0.31)]), stagedServe([], [cut('staged-b-cut', 6, 0.19)])],
      2,
    )

    expect(served.error).toContain('Sub-action limit reached')
    expect(served.evidence?.retrievalTrace?.truncated.map(({ recordId }) => recordId))
      .toEqual(['staged-a-cut', 'staged-b-cut'])
    expect(served.evidence?.retrievalTrace?.servedLines).toEqual([])
  })

  it('the terminal drain leaves the ServedBrief bytes where a cut-free budget exit left them', async () => {
    // D-13 one-way beside-field identity, carried to the terminal path: the drain injects NOTHING,
    // so the recorder's non-empty-injection gate never fires and the brief cannot move. As with
    // Shape A, the comparison is against a REAL budget-exit run that carried no cut candidates —
    // the two runs differ only in what the reader's caution trace held.
    const laden = await endsAtBudget([stagedServe([], [cut('caution-cut-a', 4, 0.31)])], 1)
    const baseline = await endsAtBudget([noCautions()], 1)

    expect(laden.evidence?.servedBrief.channel3).toHaveLength(0)
    expect(JSON.stringify(laden.evidence?.servedBrief))
      .toBe(JSON.stringify(baseline.evidence?.servedBrief))
    expect(laden.evidence?.servedBrief.briefDigest)
      .toBe(computeBriefDigest({ ...laden.evidence!.servedBrief, briefDigest: '' }))
    // Not vacuous over two empty things: the laden run really did carry a cut through the drain.
    expect(laden.evidence?.retrievalTrace?.truncated).toHaveLength(1)
  })
})

/**
 * The funnel property the drain's totality rests on. A drain placed at one exit site closes one
 * exit; a drain placed where EVERY terminal path already converges closes the class, including
 * exits nobody has written yet. This scan pins the convergence itself rather than counting the
 * exits — a count of `return failure(` sites is exactly the hand-picked member set the drain is
 * designed to make irrelevant, and pinning it would red on an innocuous tenth exit that the
 * funnel already covers.
 */
describe('the terminal drain sits at the ONE funnel every exit routes through (387-15)', () => {
  const source = statementsOf(readFileSync(join(loopDir, 'index.ts'), 'utf8'))

  it('evidence is folded in exactly one place, and every terminal builder routes there', () => {
    // The convergence: one fold, so any terminal path's evidence passes whatever precedes it.
    expect(occurrences(source, 'recorder.finalize(')).toBe(1)

    // The three terminal builders are single-expression `finish` calls, so all their call sites —
    // however many there are today — inherit the drain by construction.
    for (const builder of [
      "const success = (): StepResult => finish('passed'",
      "const failure = (error: string): StepResult => finish('failed'",
      "const cancelled = (): StepResult => finish('cancelled'",
    ]) {
      expect(occurrences(source, builder)).toBe(1)
    }
  })

  it('the staged caution ledger drains BEFORE the fold, beside the other backstop drains', () => {
    const drain = source.indexOf('recorder.recordServedCautions([], pendingCautions.trace)')
    const readTraceDrain = source.indexOf('recorder.recordServedReadTraces(ports.drainMemoryReadTraces')
    const fold = source.indexOf('recorder.finalize(')

    expect(drain).toBeGreaterThan(-1)
    expect(readTraceDrain).toBeGreaterThan(-1)
    // Between the existing no-loss backstop drains and the fold: a drain after the fold would
    // record into evidence nobody reads again.
    expect(drain).toBeGreaterThan(readTraceDrain)
    expect(fold).toBeGreaterThan(drain)

    // POSITIVE CONTROL: the ordering scan can reject. A drain placed after the fold is exactly
    // the plausible wrong placement, and the indices invert when it is.
    const misplaced = source.replace(
      'recorder.recordServedCautions([], pendingCautions.trace)',
      'recorder.recordCautionsLater()',
    ) + '\n  recorder.recordServedCautions([], pendingCautions.trace)\n'
    expect(misplaced.indexOf('recorder.recordServedCautions([], pendingCautions.trace)'))
      .toBeGreaterThan(misplaced.indexOf('recorder.finalize('))
  })

  it('the drain is a SECOND sanctioned call shape, not a licence for a third', () => {
    // 387-04's exact-text pin asserted the consuming turn's call is the only one in the file. The
    // true set grew by one, so the claim widens to name BOTH sanctioned shapes explicitly — the
    // pin is not weakened: a fabricated-trace call site is still rejected, because neither
    // sanctioned shape constructs a trace and the forbidden-substring scan above still reports 0.
    expect(occurrences(source, 'recorder.recordServedCautions(injected, cautionsForTurn.trace)')).toBe(1)
    expect(occurrences(source, 'recorder.recordServedCautions([], pendingCautions.trace)')).toBe(1)
    // Exactly two call sites in the whole file — a third would be a serve nobody attributed.
    expect(occurrences(source, 'recorder.recordServedCautions(')).toBe(2)
  })
})
