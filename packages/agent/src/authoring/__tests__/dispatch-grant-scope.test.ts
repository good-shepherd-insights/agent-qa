// D-08's DISPATCH SCOPE, AS THE LOOP KEEPS IT (Phase 401 plan 08).
//
// WHAT IS UNDER TEST is the LIFETIME and nothing else: when the scope opens relative to the first
// line that can spend a run, when it closes, and that it closes on paths nobody planned. The
// grant's arithmetic is measured in `agent-local` and its EFFECT on a real gate is measured over a
// real run in `packages/cli/src/composition/__tests__/dispatch-grant-gate.e2e.test.ts`. A cell here
// that claimed a run was allowed would be asserting its own fake.
//
// ORDERING IS ASSERTED AS A SEQUENCE, not as a pair of call counts. "The scope was opened" and "a
// run was started" are both true of a loop that opens the scope AFTER the first gate run — which is
// exactly the defect: that run crosses the gate with no grant in force and denies. So the bench
// records one interleaved trace and the cells compare it whole.
//
// vitest does not typecheck `.test.ts` (`typecheck.include` is `*.test-d.ts`); `tsc --noEmit` is
// this file's only type authority.

import {
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  DraftReceiptSchema,
} from '@vostride/agent-qa-schema'
import type { DraftReceipt } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { runAuthoringLoop } from '../loop.js'
import type { AuthoringLoopDeps, AuthoringLoopInput } from '../loop.js'
import type { DraftStageOutcome, ParsedDraftLike } from '../ports.js'

const DRAFT_PATH = 'tests/.agent-qa-drafts/dispatch-scope-fixture.yaml'
const DRAFT_NAME = 'Submit the local account form'
const MODEL_DOCUMENT = 'name: Submit the local account form\nsteps:\n  - a\n'

const DRAFT: ParsedDraftLike = {
  testId: DRAFT_NAME,
  filePath: DRAFT_PATH,
  testName: DRAFT_NAME,
  target: 'local-form',
  steps: ['Open the local account form', 'Click the Submit button'],
  contentDigest: 'digest-0',
}

/** A keep-eligible receipt, so the loop takes the shortest path that still spends a run. */
function keepEligibleReceipt(runIds: readonly string[]): DraftReceipt {
  return DraftReceiptSchema.parse({
    schemaVersion: CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
    draftRef: {
      filePath: DRAFT_PATH,
      testId: DRAFT_NAME,
      testName: DRAFT_NAME,
      contentDigest: 'digest-0',
    },
    gates: {
      executesDefinitive: { pass: true, runRefs: [...runIds], indefinitiveRunRefs: [] },
      stableVerdict: {
        pass: true,
        runRefs: [...runIds],
        distinctOutcomes: ['passed'],
        earlyStopped: false,
      },
      addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
      falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
    },
    stepTable: [],
    gateRuns: runIds.map((runId) => ({
      runId,
      memberOutcome: 'passed',
      definitive: true,
      healed: false,
    })),
    addsValueFinding: { novelElements: ['el:button "submit"'], comparedTests: [] },
    stabilityRunsRequested: DRAFT_STABILITY_RUNS_N,
    stabilityRunsCompleted: runIds.length,
    disposition: 'keep-eligible',
    evaluatedAt: 1,
  })
}

type TraceEntry = 'open' | 'dispose' | 'model' | `start:${string}`

interface Bench {
  readonly deps: AuthoringLoopDeps
  readonly trace: TraceEntry[]
}

/**
 * The loop's host, with the two things this file measures wired to one trace.
 *
 * `verifyDraft` STARTS ITS OWN GATE RUNS, which is what the real stage 4 does — `authoring.draft.
 * verify` dispatches `runStabilityGates`, and those runs go through `shelf.runs.start`. A bench
 * whose `verifyDraft` started nothing would put the scope's whole reason for existing outside the
 * fixture and every ordering cell would pass vacuously.
 */
function bench(input: {
  readonly gateRuns: number
  readonly bindDispatchGrants: boolean
  readonly failVerify?: boolean
  readonly duplicateIntent?: boolean
}): Bench {
  const trace: TraceEntry[] = []
  const runIds: string[] = []

  const shelf = {
    runs: {
      start(request: { patterns?: readonly string[] }) {
        const runId = `r_gate-${runIds.length}`
        runIds.push(runId)
        trace.push(`start:${runId}` as TraceEntry)
        return Promise.resolve({
          runId,
          patterns: request.patterns,
          gateRun: true,
          excludedFromOutcomes: true,
        } as never)
      },
      get: () => Promise.resolve(undefined),
    },
    ...(input.bindDispatchGrants
      ? {
          dispatchGrants: {
            open() {
              trace.push('open')
              return {
                dispose() {
                  trace.push('dispose')
                },
              }
            },
          },
        }
      : {}),
    model: () => Promise.resolve({
      modelId: 'fixture:dispatch-scope',
      generate() {
        trace.push('model')
        return Promise.resolve({ text: MODEL_DOCUMENT })
      },
    }),
    write: () => Promise.resolve({ kind: 'staged', draft: DRAFT } as DraftStageOutcome),
    applyPatches: (candidate: ParsedDraftLike) =>
      Promise.resolve({ kind: 'staged', draft: candidate } as DraftStageOutcome),
    async verifyDraft(): Promise<DraftReceipt> {
      // The gate runs stage 4 takes, INSIDE the scope if the scope is where it should be.
      for (let taken = 0; taken < input.gateRuns; taken += 1) {
        await shelf.runs.start({ patterns: [DRAFT_PATH] })
      }
      if (input.failVerify === true) throw new Error('the evaluator could not judge this draft')
      return keepEligibleReceipt(runIds)
    },
  }

  return {
    trace,
    deps: {
      read: {
        configuredTargetNames: () => Promise.resolve(['local-form']),
        getAuthoringBrief: () => Promise.resolve({
          scope: { tier: 'product', key: 'local-form' },
          facts: [],
          cautions: [],
          procedures: [],
          exemplars: [],
        } as never),
        suiteTextCorpus: () => Promise.resolve(
          input.duplicateIntent === true
            ? [{
                filePath: 'suites/existing.yaml',
                testName: LOOP_INPUT.intent,
                stepsText: [LOOP_INPUT.intent],
              }]
            : [],
        ),
      },
      shelf: shelf as never,
    },
  }
}

const LOOP_INPUT: AuthoringLoopInput = {
  intent: 'Check that submitting the local account form shows the confirmation banner',
  scope: { tier: 'product', key: 'local-form' },
}

describe('one approval, N gated runs, one scope (D-08)', () => {
  it('THE SCOPE OPENS BEFORE THE FIRST RUN AND CLOSES AFTER THE LAST — the whole sequence', async () => {
    const harness = bench({ gateRuns: 3, bindDispatchGrants: true })
    await runAuthoringLoop(LOOP_INPUT, harness.deps)

    // Sequence equality over the whole invocation, on `loop-ordering.test.ts`'s own reasoning: a
    // per-entry "did it happen" check is satisfied by every wrong order, and every wrong order here
    // is a gate run crossing the gate with no grant in force.
    // TWO model calls, not one: stage 3's compile and D-18's unconditional refinement round. Both
    // are outside the scope, which is the point of the cell below.
    expect(harness.trace).toEqual([
      'model',
      'model',
      'open',
      'start:r_gate-0',
      'start:r_gate-1',
      'start:r_gate-2',
      'dispose',
    ])
  })

  it('ONE OPEN FOR N RUNS — the loop does not re-approve itself per run', async () => {
    // The prohibited shape D-08 names: a scope opened around each run would be the loop granting
    // itself, which makes the human ask decorative. One `open`, one `dispose`, three runs.
    const harness = bench({ gateRuns: 3, bindDispatchGrants: true })
    await runAuthoringLoop(LOOP_INPUT, harness.deps)

    expect(harness.trace.filter((entry) => entry === 'open')).toHaveLength(1)
    expect(harness.trace.filter((entry) => entry === 'dispose')).toHaveLength(1)
    expect(harness.trace.filter((entry) => entry.startsWith('start:'))).toHaveLength(3)
  })

  it('EVERY MODEL CALL IS OUTSIDE IT — a compile does not hold a run approval open', async () => {
    const harness = bench({ gateRuns: 1, bindDispatchGrants: true })
    await runAuthoringLoop(LOOP_INPUT, harness.deps)
    expect(harness.trace.lastIndexOf('model')).toBeLessThan(harness.trace.indexOf('open'))
    expect(harness.trace.filter((entry) => entry === 'model')).toHaveLength(2)
  })

  it('A THROWN DISPATCH STILL DISPOSES — the grant has no path that outlives the invocation', async () => {
    // T-401-22 stated as a measurement. Stage 4 throwing is a real path (a credential screen, an
    // unparsable receipt, a host error), and a grant surviving it would be an approval with no
    // expiry at all.
    const harness = bench({ gateRuns: 2, bindDispatchGrants: true, failVerify: true })
    await expect(runAuthoringLoop(LOOP_INPUT, harness.deps)).rejects.toThrow(
      'the evaluator could not judge this draft',
    )
    expect(harness.trace).toEqual([
      'model',
      'model',
      'open',
      'start:r_gate-0',
      'start:r_gate-1',
      'dispose',
    ])
  })

  it('A DEDUP REFUSAL OPENS NOTHING — an invocation that spends no run is granted nothing', async () => {
    // Stage 2 returns before the scope, and the fan-out report for that arm is
    // `NO_RUNS_FAN_OUT_BOUND` for the same reason: this invocation was never going to run anything.
    const harness = bench({ gateRuns: 3, bindDispatchGrants: true, duplicateIntent: true })
    const result = await runAuthoringLoop(LOOP_INPUT, harness.deps)

    expect(result.outcome.kind).toBe('refused')
    expect(harness.trace).toEqual([])
  })

  it('AN UNBOUND OVERLAY CHANGES NOTHING ELSE — the loop runs exactly as it did before D-08', async () => {
    // The absent-port posture, kept honest: a project whose target is declared `local` never
    // reaches an ask-tier gate and needs no grant, and a loop that REQUIRED one would turn a policy
    // affordance into a binding requirement.
    const withOverlay = bench({ gateRuns: 3, bindDispatchGrants: true })
    const withoutOverlay = bench({ gateRuns: 3, bindDispatchGrants: false })
    const granted = await runAuthoringLoop(LOOP_INPUT, withOverlay.deps)
    const ungranted = await runAuthoringLoop(LOOP_INPUT, withoutOverlay.deps)

    expect(ungranted.stages).toEqual(granted.stages)
    expect(ungranted.outcome.kind).toBe(granted.outcome.kind)
    expect(ungranted.fanOut).toEqual(granted.fanOut)
    expect(withoutOverlay.trace).toEqual([
      'model',
      'model',
      'start:r_gate-0',
      'start:r_gate-1',
      'start:r_gate-2',
    ])
  })
})
