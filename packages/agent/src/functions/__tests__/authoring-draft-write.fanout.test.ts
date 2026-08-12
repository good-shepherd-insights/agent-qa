// The fan-out report on the op's OWN output (394-14 · WTST-08, SC-5's reporting half).
//
// WHY THIS FILE EXISTS AND `fan-out-accounting.test.ts` DOES NOT COVER IT. That file measures the
// LOOP: `runAuthoringLoop` returns an `AuthoringLoopResult` whose `fanOut` is correct on every arm,
// and every one of its cells reads that in-process value. 394-VERIFICATION found the whole of it
// unreachable one layer up — `invoke()` built its answer from four fields and DISCARDED
// `result.fanOut`, and `AuthoringDraftWriteOutputSchema` was `.strict()` with no field the report
// could have ridden. So the loop's number was correct and no caller on any host could read it.
//
// THE MEASUREMENT IS THEREFORE THROUGH THE OUTPUT SCHEMA, NEVER OFF THE RETURNED OBJECT. Every
// cell below parses what `invoke` answered with the shipped contract before asserting anything: a
// field the op returns but the contract strips is not carried, and a cell reading the raw object
// would have reported a pass for exactly the shape this plan exists to fix.
//
// vitest does not typecheck `.test.ts` (`typecheck.include` is `*.test-d.ts`); `tsc --noEmit` is
// this file's only type authority.

import {
  AuthoringDraftWriteOutputSchema,
  CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  DraftReceiptSchema,
} from '@vostride/agent-qa-schema'
import type { DraftReceipt } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { authoringDraftWriteSpec } from '../ops/authoring-draft-write.js'
import { authoringFanOutBound } from '../../authoring/loop.js'
import type { AuthoringLoopInput } from '../../authoring/loop.js'
import type { FunctionDeps } from '../spec.js'
import type { DraftStageOutcome, ParsedDraftLike } from '../../authoring/ports.js'

const DRAFT_PATH = 'tests/.agent-qa-drafts/report-fixture.yaml'
const DRAFT_NAME = 'Submit the local account form'

/** The document the scripted model compiles at stage 3. Its bytes are never parsed here. */
const MODEL_DOCUMENT = 'name: Submit the local account form\nsteps:\n  - a\n'

const DRAFT: ParsedDraftLike = {
  testId: DRAFT_NAME,
  filePath: DRAFT_PATH,
  testName: DRAFT_NAME,
  steps: [
    'Open the local account form',
    'Type "alice" into the Username field',
    'Click the Submit button',
    'Verify the confirmation banner says "Saved"',
  ],
  contentDigest: 'digest-0',
}

const GATE_RUN_IDS = ['r_gate-0', 'r_gate-1', 'r_gate-2'] as const

/**
 * A keep-eligible receipt naming the gate runs it took, PARSED by the shipped schema.
 *
 * Parsed rather than cast for the produced-not-literal reason: a receipt this file typed as a
 * literal could pin a shape the evaluator would never mint, and the report's `consumed` list is
 * read straight off `gateRuns`.
 */
const ACCEPTED: DraftReceipt = DraftReceiptSchema.parse({
  schemaVersion: CURRENT_DRAFT_RECEIPT_SCHEMA_VERSION,
  draftRef: {
    filePath: DRAFT_PATH,
    testId: DRAFT_NAME,
    testName: DRAFT_NAME,
    contentDigest: 'digest-0',
  },
  gates: {
    executesDefinitive: { pass: true, runRefs: [...GATE_RUN_IDS], indefinitiveRunRefs: [] },
    stableVerdict: {
      pass: true,
      runRefs: [...GATE_RUN_IDS],
      distinctOutcomes: ['passed'],
      earlyStopped: false,
    },
    addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
    falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
  },
  stepTable: [],
  gateRuns: GATE_RUN_IDS.map((runId) => ({
    runId,
    memberOutcome: 'passed',
    definitive: true,
    healed: false,
  })),
  addsValueFinding: { novelElements: ['el:button "submit"'], comparedTests: [] },
  stabilityRunsRequested: DRAFT_STABILITY_RUNS_N,
  stabilityRunsCompleted: GATE_RUN_IDS.length,
  disposition: 'keep-eligible',
  evaluatedAt: 1,
})

interface SuiteText {
  readonly filePath: string
  readonly testName: string
  readonly stepsText: readonly string[]
}

/**
 * The op's host, scripted to the two arms this file needs.
 *
 * The run port answers only `get`: this file drives the happy path and the stage-2 refusal, and
 * neither starts a probe — so a `start` that THROWS is the structural statement that no cell here
 * is quietly exercising the repair arm.
 */
function deps(options: { readonly suiteText?: readonly SuiteText[] } = {}): FunctionDeps {
  const documents = new Map<string, { endedAt: number }>()
  GATE_RUN_IDS.forEach((runId, index) => documents.set(runId, { endedAt: 100 + index }))

  const shelf = {
    runs: {
      start: () => { throw new Error('neither arm in this file starts a run') },
      get: (runId: string) => Promise.resolve(documents.get(runId)),
    },
    model: () => Promise.resolve({
      modelId: 'fixture:report',
      generate: () => Promise.resolve({ text: MODEL_DOCUMENT }),
    }),
    write: () => Promise.resolve({ kind: 'staged', draft: DRAFT } as DraftStageOutcome),
    applyPatches: (candidate: ParsedDraftLike) => Promise.resolve({
      kind: 'staged' as const,
      draft: candidate,
    }),
    verifyDraft: () => Promise.resolve(ACCEPTED),
  }

  return {
    draftShelf: shelf,
    authoringRead: {
      getAuthoringBrief: () => Promise.resolve({
        scope: { tier: 'product', key: 'local-form' },
        facts: [],
        cautions: [],
        procedures: [],
        exemplars: [],
      }),
      suiteTextCorpus: () => Promise.resolve(options.suiteText ?? []),
    },
  } as unknown as FunctionDeps
}

const INPUT: AuthoringLoopInput = {
  intent: 'Check that submitting the local account form shows the confirmation banner',
  scope: { tier: 'product', key: 'local-form' },
}

/** The suite test the intent already describes, so the dedup screen refuses before compile. */
const DUPLICATE_SUITE: readonly SuiteText[] = [{
  filePath: 'tests/local-form-submit.yaml',
  testName: 'Check that submitting the local account form shows the confirmation banner',
  stepsText: ['Submit the local account form and check the confirmation banner'],
}]

/** Invoke the op and hand back what the SHIPPED CONTRACT carries — never the raw return. */
async function carried(options: { readonly suiteText?: readonly SuiteText[] } = {}) {
  const answered = await authoringDraftWriteSpec.invoke(INPUT, deps(options))
  return AuthoringDraftWriteOutputSchema.parse(answered)
}

describe('the op carries the fan-out report it computed (SC-5, the reporting half)', () => {
  it('a drafted invocation answers with a fanOut report that survives the output contract', async () => {
    const output = await carried()

    expect(output.outcome).toBe('drafted')
    // THE WHOLE OF THE GAP, IN ONE ASSERTION. `invoke()` discarded `result.fanOut` and the
    // `.strict()` contract had no field it could have ridden, so this key was unreachable on
    // every host — the loop's number was correct and nobody could read it.
    expect(output).toHaveProperty('fanOut')
    expect(output.fanOut?.consumedTotal).toBe(DRAFT_STABILITY_RUNS_N)
    expect(output.fanOut?.exceedsPreview).toBe(false)
    // The runs are named, not merely counted — a total with no refs cannot be checked against the
    // run store by whoever doubts it.
    expect(output.fanOut?.consumed.map((run) => run.runId)).toEqual([...GATE_RUN_IDS])
  })

  it('the reported ceiling IS the disclosed one — one function of one input', async () => {
    const output = await carried()

    // The number a person approved at the confirm and the number they are shown afterwards are
    // the SAME arithmetic, asserted against `authoringFanOutBound` rather than against a literal:
    // a literal would keep passing while the bound and the disclosure drifted apart.
    expect(output.fanOut?.previewed).toEqual(authoringFanOutBound(INPUT))
    expect(output.fanOut?.previewed.total).toBe(authoringFanOutBound(INPUT).total)
  })

  it('a stage-2 refusal reports its cost too — the field is PRESENT and the count is 0', async () => {
    const output = await carried({ suiteText: DUPLICATE_SUITE })

    expect(output.outcome).toBe('refused')
    // "This invocation cost nothing" is a fact a caller is entitled to, and an ABSENT field says
    // something different from a zero one: absent is "nobody counted", zero is "nothing ran".
    expect(output).toHaveProperty('fanOut')
    expect(output.fanOut?.consumedTotal).toBe(0)
    expect(output.fanOut?.previewed.total).toBe(0)
    expect(output.fanOut?.exceedsPreview).toBe(false)
  })

  it('the PROPOSAL stays off the wire — the report is the only exception the contract makes', async () => {
    const output = await carried()

    // The control for the three cells above. The op discards `outcome.proposal` as well, and that
    // discard is the schema's no-payload-arms prohibition working — the proposal reaches people
    // through 391's inbox. A fix that had widened the contract to "carry what the loop returned"
    // would pass every cell above and red this one.
    expect(output).not.toHaveProperty('proposal')
    expect(output).not.toHaveProperty('stages')
    expect(Object.keys(output).sort()).toEqual(['draftRef', 'fanOut', 'outcome', 'receipt'])
  })
})
