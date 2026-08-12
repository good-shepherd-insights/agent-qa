// The finding arm an ABANDONED repair produces (394-21, WR-09 · D-11).
//
// WHAT WENT WRONG AND WHY IT IS THIS FILE'S SUBJECT. `routeAfterVerify`'s exhausted route built a
// `FindingRoute` carrying `signalClass: 'indefinitive-failure'` and then spread over the result of
// `findingProposal`, overwriting two fields: `signalClass` became `repair-${abandonment.kind}` — a
// string outside `ROUTER_SIGNAL_CLASSES`, so the one closed vocabulary a reader can rely on was
// open on exactly one path — and `explanation` became `abandonment.error.message`, which on the
// exhausted arm ENDS IN THE MODEL'S OWN BYTES (`RepairExhaustedError` carries `lastRefusal`, and
// two of its three assignment sites are model-emitted text). `findingProposal`'s doc states the
// ordering law that spread broke: the arm is built from the ROUTE and from nothing a model wrote.
//
// THE MARKER IS PRODUCED, NEVER ASSERTED INTO PLACE. The bench plants a distinctive string in the
// text the fake model emits, and the integrity cell below drives `repairDraft` directly to show
// that string really does reach `abandonment.error.message`. Only then does the absence cell mean
// anything: without it, "the marker is not in the proposal" would pass just as happily against a
// channel that never carried it.

import {
  CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION,
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  DraftReceiptSchema,
  FindingProposalV1Schema,
  TestEditPatchSetSchema,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  DraftReceipt,
  RunsStartInput,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { memberOutcome, runDocument } from './evidence-fixtures.js'
import type { MemberFixture } from './evidence-fixtures.js'
import { runAuthoringLoop } from '../loop.js'
import { repairDraft, REPAIR_ITERATION_CAP } from '../repair.js'
import { ROUTER_SIGNAL_CLASSES, routeRepairOrFinding } from '../router.js'
import type { AuthoringLoopDeps, AuthoringLoopInput } from '../loop.js'
import type { RepairRoute } from '../router.js'
import type { DraftStageOutcome, ParsedDraftLike } from '../ports.js'

const DRAFT_PATH = 'tests/.agent-qa-drafts/repair-abandonment-fixture.yaml'
const DRAFT_NAME = 'Submit the local account form'

const DRAFT_STEPS: readonly string[] = [
  'Open the local account form',
  'Type "alice" into the Username field',
  'Click the Submit button',
  'Verify the confirmation banner says "Saved"',
]

const MODEL_DOCUMENT = 'name: Submit the local account form\nsteps:\n  - a\n'

/**
 * The model's own bytes, in the emission the repair loop cannot parse.
 *
 * Ten characters, because `JSON.parse`'s message quotes the first ten of the input it choked on
 * verbatim — so the whole marker travels, and the integrity cell asserts that it did rather than
 * this comment claiming it.
 */
const REFUSAL_MARKER = 'MODELMARK7'

/** Two steps carried out, the third mechanically impossible — the evidence that routes to REPAIR. */
function mechanicsFailureMember(): MemberFixture {
  return {
    filePath: DRAFT_PATH,
    testName: DRAFT_NAME,
    outcome: 'failed',
    steps: [
      [{ type: 'navigate', url: 'http://127.0.0.1:8931/form.html' }],
      [{ type: 'fill', ref: 'e1', role: 'textbox', name: 'username' }],
      [{ type: 'click', ref: 'e9', role: 'button', name: 'submit', success: false }],
    ],
    failedSteps: [2],
    infeasibleSteps: [2],
  }
}

/**
 * A probe in which a step that USED TO PASS now fails — repair's dynamic refusal.
 *
 * No mechanics block: the point is the regression at index 1, not a second mechanics signal.
 */
function prefixRegressedMember(): MemberFixture {
  return {
    filePath: DRAFT_PATH,
    testName: DRAFT_NAME,
    outcome: 'failed',
    steps: mechanicsFailureMember().steps,
    failedSteps: [1],
  }
}

/** The draft failed on its ASSERTION, cleanly — the ordinary routed finding, with no repair at all. */
function definitiveAssertionFailMember(): MemberFixture {
  return {
    filePath: DRAFT_PATH,
    testName: DRAFT_NAME,
    outcome: 'failed',
    steps: mechanicsFailureMember().steps,
    failedSteps: [2],
    verdictSourceSteps: [{ stepIndex: 2, source: 'assert-value' }],
  }
}

function runAt(
  runId: string,
  endedAt: number,
  members: readonly MemberFixture[],
): CompletedRunHandoff {
  return { ...runDocument(runId, members), endedAt } as CompletedRunHandoff
}

function receiptFor(runIds: readonly string[]): DraftReceipt {
  return DraftReceiptSchema.parse({
    schemaVersion: CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
    draftRef: {
      filePath: DRAFT_PATH,
      testId: DRAFT_NAME,
      testName: DRAFT_NAME,
      contentDigest: 'digest-0',
    },
    gates: {
      executesDefinitive: { pass: false, runRefs: [...runIds], indefinitiveRunRefs: [] },
      stableVerdict: {
        pass: false,
        runRefs: [...runIds],
        distinctOutcomes: ['failed'],
        earlyStopped: false,
      },
      addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
      falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
    },
    stepTable: [],
    gateRuns: runIds.map((runId) => ({
      runId,
      memberOutcome: 'failed',
      definitive: true,
      healed: false,
    })),
    addsValueFinding: { novelElements: ['el:button "submit"'], comparedTests: [] },
    stabilityRunsRequested: DRAFT_STABILITY_RUNS_N,
    stabilityRunsCompleted: runIds.length,
    disposition: 'rejected',
    evaluatedAt: 1,
  })
}

/** A patch outside the passing prefix (steps 0-1), so the static fence ADMITS it. */
const OUTSIDE_PREFIX: TestEditPatchSet = TestEditPatchSetSchema.parse({
  thoughts: 'the submit control is addressed by a different label',
  patches: [{ op: 'replace', path: '/steps/2', value: 'Click the "Save account" button' }],
})

const GATE_RUN_IDS = ['r_gate-0', 'r_gate-1', 'r_gate-2']

/**
 * The run stage 5 ROUTES ON: the LAST gate run the receipt names (`routingHandoff`).
 *
 * Derived from the same array the bench serves rather than typed as a literal, so a cell asserting
 * "the failure point names the routed run" cannot pass against a run the loop never read.
 */
const ROUTED_RUN_ID = GATE_RUN_IDS.at(-1) as string

const DRAFT: ParsedDraftLike = {
  testId: DRAFT_NAME,
  filePath: DRAFT_PATH,
  testName: DRAFT_NAME,
  steps: [...DRAFT_STEPS],
  contentDigest: 'digest-0',
}

/** The draft's identity as the router keys on it — filePath and testName, never `testId`. */
const DRAFT_REF = {
  filePath: DRAFT_PATH,
  testId: DRAFT_NAME,
  testName: DRAFT_NAME,
  contentDigest: 'digest-0',
}

interface Bench {
  readonly deps: AuthoringLoopDeps
  readonly startedRunIds: string[]
}

/**
 * The loop's host, scripted to the abandonment paths.
 *
 * `gateMember` is the evidence the evaluation's gate runs carry, which is what decides whether the
 * router hands the draft to repair at all — so the ordinary-finding cell changes only that.
 */
function bench(input: {
  readonly emissions: readonly string[]
  readonly probes?: readonly (readonly MemberFixture[])[]
  readonly gateMember?: () => MemberFixture
}): Bench {
  const startedRunIds: string[] = []
  const documents = new Map<string, CompletedRunHandoff>()
  let emitted = 0
  const gateMember = input.gateMember ?? mechanicsFailureMember

  GATE_RUN_IDS.forEach((runId, index) => {
    documents.set(runId, runAt(runId, 100 + index, [gateMember()]))
  })

  const runs = {
    start(_started: RunsStartInput) {
      const index = startedRunIds.length
      const runId = `r_probe-${index}`
      startedRunIds.push(runId)
      const members = input.probes?.[index]
      if (members !== undefined) documents.set(runId, runAt(runId, 200 + index, members))
      return Promise.resolve({ runId } as never)
    },
    get(runId: string) {
      return Promise.resolve(documents.get(runId))
    },
  }

  const shelf = {
    runs,
    model: () => Promise.resolve({
      modelId: 'fixture:repair-abandonment',
      generate() {
        const text = input.emissions[emitted] ?? input.emissions.at(-1) ?? MODEL_DOCUMENT
        emitted += 1
        return Promise.resolve({ text })
      },
    }),
    write: () => Promise.resolve({ kind: 'staged', draft: DRAFT } as DraftStageOutcome),
    applyPatches(candidate: ParsedDraftLike, set: TestEditPatchSet): Promise<DraftStageOutcome> {
      return Promise.resolve({
        kind: 'staged',
        draft: { ...candidate, contentDigest: `${candidate.contentDigest}+${set.patches.length}` },
      })
    },
    verifyDraft(): Promise<DraftReceipt> {
      return Promise.resolve(receiptFor(GATE_RUN_IDS))
    },
  }

  return {
    startedRunIds,
    deps: {
      read: {
        getAuthoringBrief: () => Promise.resolve({
          scope: { tier: 'product', key: 'local-form' },
          facts: [],
          cautions: [],
          procedures: [],
          exemplars: [],
        } as never),
        suiteTextCorpus: () => Promise.resolve([]),
      },
      shelf: shelf as never,
    },
  }
}

const LOOP_INPUT: AuthoringLoopInput = {
  intent: 'Check that submitting the local account form shows the confirmation banner',
  scope: { tier: 'product', key: 'local-form' },
}

/** The finding proposal the loop persisted, as JSON — which is how a durable reader sees it. */
async function findingThrough(harness: Bench): Promise<Record<string, unknown>> {
  const result = await runAuthoringLoop(LOOP_INPUT, harness.deps)
  expect(result.outcome.kind).toBe('finding')
  const proposal = (result.outcome as { proposal: unknown }).proposal
  return JSON.parse(JSON.stringify(proposal)) as Record<string, unknown>
}

// ---- integrity: the fixture reaches the paths it claims to, and the marker channel is live -----

describe('the fixture reaches the paths it claims to', () => {
  it('the mechanics member passes two steps and fails the third; the regressed one fails step 1', () => {
    expect(memberOutcome(mechanicsFailureMember()).steps.map((s) => s.verifierVerdict.pass))
      .toEqual([true, true, false])
    expect(memberOutcome(prefixRegressedMember()).steps.map((s) => s.verifierVerdict.pass))
      .toEqual([true, false, true])
  })

  it('the model marker REALLY reaches the abandonment error — the channel this file closes', async () => {
    // PRODUCED, NOT ASSUMED. `repairDraft` is driven directly with the same unparsable emission the
    // bench feeds the loop, and the exhausted error's message is read off the outcome. If Node ever
    // stopped quoting the offending bytes, this cell reds and the absence cell below is known to
    // have gone vacuous instead of silently certifying nothing.
    const route: RepairRoute = {
      kind: 'repair',
      signalClass: 'execution-mechanics',
      mechanics: [{ stepIndex: 2, signal: 'termination' }],
      failingStepIndex: 2,
    }
    const handoff = runAt('r_gate-0', 100, [mechanicsFailureMember()])
    const outcome = await repairDraft(route, {
      draft: DRAFT,
      handoff,
      shelf: {
        model: () => Promise.resolve({
          modelId: 'fixture:repair-abandonment',
          generate: () => Promise.resolve({ text: REFUSAL_MARKER }),
        }),
        applyPatches: () => Promise.resolve({ kind: 'staged', draft: DRAFT }),
        verifyDraft: () => Promise.resolve(receiptFor(GATE_RUN_IDS)),
      } as never,
      runs: { start: () => Promise.resolve({ runId: 'r_unused' } as never), get: () => Promise.resolve(undefined) } as never,
    })

    expect(outcome.kind).toBe('abandoned')
    const abandonment = (outcome as { abandonment: { kind: string; error: Error } }).abandonment
    expect(abandonment.kind).toBe('exhausted')
    expect(abandonment.error.message).toContain(REFUSAL_MARKER)
  })
})

// ---- the arm ------------------------------------------------------------------------------------

describe('an abandoned repair produces a finding built from the route and typed facts only', () => {
  it('EXHAUSTED: the signal class stays inside ROUTER_SIGNAL_CLASSES', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER],
    })
    const proposal = await findingThrough(harness)

    // Every iteration was spent on an unparsable emission, so no probe ever started.
    expect(harness.startedRunIds).toHaveLength(0)
    expect(ROUTER_SIGNAL_CLASSES).toContain(proposal.signalClass)
    expect(proposal.signalClass).toBe('indefinitive-failure')
  })

  it('EXHAUSTED: the abandonment kind rides a typed field, and the model marker rides nothing', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER],
    })
    const proposal = await findingThrough(harness)

    // THE CHANNEL, CLOSED, and asserted FIRST so this is the failure a pre-fix run reports rather
    // than a missing field masking it. Not `explanation` alone — the WHOLE serialized proposal,
    // because a reader's question is "can model-emitted text reach this record", not "can it reach
    // the field it reached last time".
    expect(JSON.stringify(proposal)).not.toContain(REFUSAL_MARKER)
    expect(proposal.explanation).toBe('')
    expect(proposal.repairAbandonment).toBe('exhausted')
  })

  it('PREFIX-REGRESSED: the second abandonment kind carries its own name', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, JSON.stringify(OUTSIDE_PREFIX)],
      probes: [[prefixRegressedMember()]],
    })
    const proposal = await findingThrough(harness)

    expect(harness.startedRunIds).toHaveLength(1)
    expect(ROUTER_SIGNAL_CLASSES).toContain(proposal.signalClass)
    expect(proposal.repairAbandonment).toBe('prefix-regressed')
    expect(proposal.explanation).toBe('')
  })

  it('the ORDINARY routed finding carries NO repairAbandonment key at all — absent, not defaulted', async () => {
    // THE CONTROL. A field defaulted onto every finding would satisfy the two cells above and tell
    // a reader nothing: `repairAbandonment` present means bounded repair abandoned THIS draft, so
    // its absence has to be observable through JSON rather than through an `undefined` a serializer
    // happens to drop.
    const harness = bench({
      emissions: [MODEL_DOCUMENT],
      gateMember: definitiveAssertionFailMember,
    })
    const proposal = await findingThrough(harness)

    expect(harness.startedRunIds).toHaveLength(0)
    expect(proposal.signalClass).toBe('clean-definitive-assertion-fail')
    expect(Object.keys(proposal)).not.toContain('repairAbandonment')
  })

  it('every one of these proposals is one the SHIPPED strict schema accepts', async () => {
    // The arm is `.strict()`, so this is the cell that would red if `repairAbandonment` were added
    // to the loop and not to the contract — or spelled differently in the two places.
    for (const harness of [
      bench({ emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER] }),
      bench({
        emissions: [MODEL_DOCUMENT, JSON.stringify(OUTSIDE_PREFIX)],
        probes: [[prefixRegressedMember()]],
      }),
      bench({ emissions: [MODEL_DOCUMENT], gateMember: definitiveAssertionFailMember }),
    ]) {
      const proposal = await findingThrough(harness)
      expect(proposal.schemaVersion).toBe(CURRENT_AUTHORING_PROPOSAL_SCHEMA_VERSION)
      expect(FindingProposalV1Schema.safeParse(proposal).success).toBe(true)
    }
  })
})

// ---- CR-02: the arm is built from the routed run's own facts ------------------------------------
//
// THE CELL THIS FILE WAS MISSING. 394-VERIFICATION's CR-02: the exhausted arm was assembled from an
// empty literal — `failurePoint: null`, `evidenceRefs: []` — while `handoff`, the route's
// `failingStepIndex` and `repaired.probeRunIds` were all in scope three lines above it. Every cell
// above this line passed against that literal, because each of them asked what the arm does NOT
// carry (a signal class outside the vocabulary, model bytes) and none asked what it DOES.
//
// A durable finding with no evidence and no failure point is unauditable by construction (T-394-90),
// and the module's own `AuthoringLoopUnroutableEvidenceError` doc calls filing one "the cardinal
// error pointed the other way". The evidence assertion sits at the HEAD of each cell so the RED a
// pre-fix run reports is the missing evidence rather than a later field masking it.

interface EvidenceRefRow {
  readonly runId: string
  readonly stepIndex: number
  readonly channel: string
}

function evidenceRefsOf(proposal: Record<string, unknown>): readonly EvidenceRefRow[] {
  return proposal.evidenceRefs as readonly EvidenceRefRow[]
}

/** The routed run's finding evidence as the ORDINARY arm derives it, for the same step of the same run. */
function ordinaryArmEvidence(): { failurePoint: unknown; evidenceRefs: readonly EvidenceRefRow[] } {
  const route = routeRepairOrFinding(
    DRAFT_REF,
    runAt(ROUTED_RUN_ID, 102, [definitiveAssertionFailMember()]),
  )
  if (route.kind !== 'finding') throw new Error(`the control must route to a finding, not ${route.kind}`)
  return { failurePoint: route.failurePoint, evidenceRefs: route.evidenceRefs as readonly EvidenceRefRow[] }
}

describe('an abandoned repair files a finding a person can trace (CR-02)', () => {
  it('EXHAUSTED: the finding carries evidence refs and a failure point naming the routed run', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER],
    })
    const proposal = await findingThrough(harness)

    // FIRST, so the pre-fix RED is this one: `expected 0 to be greater than 0`.
    expect(evidenceRefsOf(proposal).length).toBeGreaterThan(0)
    const failurePoint = proposal.failurePoint as Record<string, unknown> | null
    expect(failurePoint).not.toBeNull()
    expect(failurePoint?.runId).toBe(ROUTED_RUN_ID)
    // The step the ROUTE named — the mechanics member's third step, the one that could not be
    // carried out — not a step chosen by this cell.
    expect(failurePoint?.stepIndex).toBe(2)
    for (const ref of evidenceRefsOf(proposal)) {
      expect(ref.runId).toBe(ROUTED_RUN_ID)
      expect(ref.stepIndex).toBe(2)
    }
  })

  it('EXHAUSTED: that evidence is the ORDINARY arm\'s derivation, not a second walk', async () => {
    // ONE DERIVATION, TWO CALLERS. The ordinary finding arm's `failurePoint`/`evidenceRefs` over the
    // SAME run and the SAME step are computed here through the shipped router, and the exhausted
    // arm's must equal them field for field. A copy of the construction into `loop.ts` drifts from
    // this the first time either side is edited; a shared derivation cannot.
    const control = ordinaryArmEvidence()
    // Non-vacuity: two empty arrays would compare equal and certify nothing.
    expect(control.evidenceRefs.length).toBeGreaterThan(0)

    const harness = bench({
      emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER],
    })
    const proposal = await findingThrough(harness)

    expect(evidenceRefsOf(proposal)).toEqual(JSON.parse(JSON.stringify(control.evidenceRefs)))
    // The control's member records a `verdictSource` and the mechanics member does not, so the two
    // failure points agree on the coordinates rather than on the whole record.
    const failurePoint = proposal.failurePoint as Record<string, unknown> | null
    const controlPoint = control.failurePoint as Record<string, unknown>
    expect(failurePoint?.runId).toBe(controlPoint.runId)
    expect(failurePoint?.stepIndex).toBe(controlPoint.stepIndex)
    expect(failurePoint?.stepText).toBe(controlPoint.stepText)
  })

  it('PREFIX-REGRESSED: that arm carries the routed run\'s evidence too', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, JSON.stringify(OUTSIDE_PREFIX)],
      probes: [[prefixRegressedMember()]],
    })
    const proposal = await findingThrough(harness)

    expect(evidenceRefsOf(proposal).length).toBeGreaterThan(0)
    const failurePoint = proposal.failurePoint as Record<string, unknown> | null
    expect(failurePoint?.runId).toBe(ROUTED_RUN_ID)
    expect(failurePoint?.stepIndex).toBe(2)
  })
})

// ---- abandonment.error is READ, through its typed fields only -----------------------------------
//
// `repaired.abandonment.error` is the only statement of WHY repair stopped, and until this plan it
// was written by `repair.ts` and read by nothing in production — a value the loop carried to the
// arm and dropped. Two of its typed facts now travel: the iterations the spend cost, and (on the
// regressed arm) the probe run and step that showed the regression, as an addressable coordinate.
//
// ITS PROSE DOES NOT TRAVEL AND MUST NOT. `RepairExhaustedError.lastRefusal` and therefore
// `error.message` end in the model's own bytes — that is WR-09's closure, and the marker cells
// above are what keep it. So the fields read here are `iterations`, `stepIndex` and `runId`, all
// three minted by this package, and never a sentence.

describe('the abandonment\'s typed facts reach the durable arm', () => {
  it('EXHAUSTED: repairIterations equals the iterations the harness drove', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, REFUSAL_MARKER, REFUSAL_MARKER, REFUSAL_MARKER],
    })
    const proposal = await findingThrough(harness)

    // Every iteration was spent on an unparsable emission, so the sequence reached K.
    expect(proposal.repairIterations).toBe(REPAIR_ITERATION_CAP)
    expect(proposal.repairAbandonment).toBe('exhausted')
  })

  it('PREFIX-REGRESSED: the probe that showed the regression rides evidenceRefs as a coordinate', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT, JSON.stringify(OUTSIDE_PREFIX)],
      probes: [[prefixRegressedMember()]],
    })
    const proposal = await findingThrough(harness)

    // The probe the loop actually started — read off the harness, not typed as a literal here.
    const probeRunId = harness.startedRunIds[0]
    expect(probeRunId).toBeDefined()
    // Step 1 is the regression: it passed in the gate run and fails in this probe. `stepIndex` and
    // `runId` are `PassingPrefixRegressedError`'s own typed fields, which is the whole read.
    const probeRef = evidenceRefsOf(proposal)
      .find((ref) => ref.runId === probeRunId)
    expect(probeRef).toBeDefined()
    expect(probeRef?.stepIndex).toBe(1)
    expect(probeRef?.channel).toBe('step-trace')
    // Beside the routed run's own refs rather than instead of them.
    expect(evidenceRefsOf(proposal).some((ref) => ref.runId === ROUTED_RUN_ID)).toBe(true)
    expect(proposal.repairIterations).toBe(1)
  })

  it('the ORDINARY routed finding carries NEITHER key — absent, not defaulted', async () => {
    const harness = bench({
      emissions: [MODEL_DOCUMENT],
      gateMember: definitiveAssertionFailMember,
    })
    const proposal = await findingThrough(harness)

    expect(Object.keys(proposal)).not.toContain('repairIterations')
    expect(Object.keys(proposal)).not.toContain('repairAbandonment')
    // Not a finding that skipped repair for want of a route: this one WAS routed, to the app-broken
    // arm, so a zero here would read as "repair was tried and spent nothing".
    expect(proposal.signalClass).toBe('clean-definitive-assertion-fail')
  })
})
