// The repair path's credential screen, `context` inside the screen's domain, and the evidence a
// repair iteration past the first is actually shown (Phase 394, gap round 1 · WTST-04 · T-394-43).
//
// WHY THIS FILE EXISTS AND `secret-guardrail.test.ts` DOES NOT COVER IT. That file measures the
// gate on the LOOP's path: compile, refine, screen, verify. It cannot see the two holes the phase
// verification found, and both are holes of REACH rather than of detection:
//
//   1. `loop.ts`'s doc block claims verbatim that a credential "introduced by a repair patch" is
//      caught. No call site existed after `repair.ts`'s `applyPatches`. A repair patch's value is
//      model-emitted text that a probe run TYPES INTO A LIVE APPLICATION and that `verifyDraft`
//      then persists verbatim in `DraftReceipt.stepTable[].stepText`. The detector was never
//      wrong; it was never asked.
//   2. `context` is one of the three `EDITABLE_POINTER_ROOTS`, and `ParsedDraftLike` carried no
//      such field at all — so the gate was blind to it by TYPE SHAPE, not by a missed line in a
//      locations array. A cell that only added a context string to a draft literal would not even
//      compile before the fix, which is exactly the RED this file was committed as.
//
// THE FAKE SHELF REMINTS `filePath` ON EVERY APPLY, and that single fidelity choice is what makes
// the third property measurable at all. `local-agent-host.ts`'s `stageDraft` mints the shelf path
// FROM THE CONTENT DIGEST, so every patched candidate lives at a new path. `repair-fence.test.ts`'s
// applier keeps the path fixed — correct for what that file measures (step positions), and the
// reason its five cells cannot see that `draftMember(candidate, handoff)` stops joining the moment
// the candidate advances. A fake that cannot reproduce the host's identity churn cannot fail on a
// defect made of it.
//
// EVERY CELL NAMES ITS FAMILY IN ITS OWN TITLE (`repair-screen`, `context-screen`,
// `iteration-2-evidence`) because `scripts/394-repair-screen-mutation.sh` greps vitest's printed
// cell names, and a differential that has to match on a substring of prose is a differential that
// reds on the next reword.

import { TestEditPatchSetSchema } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  DraftReceipt,
  DraftRef,
  RunsStartInput,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy, scan } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { memberOutcome, runDocument } from './evidence-fixtures.js'
import type { MemberFixture } from './evidence-fixtures.js'
import {
  DraftSecretRefusedError,
  screenDraftForCredentials,
} from '../loop.js'
import { REPAIR_ITERATION_CAP, repairDraft } from '../repair.js'
import { routeRepairOrStop } from '../router.js'
import type { RepairRoute } from '../router.js'
import type { DraftRunPortLike, DraftStageOutcome, ParsedDraftLike } from '../ports.js'
import {
  AUTHORING_DRAFT_EDIT_FUNCTION_ID,
  authoringDraftEditSpec,
} from '../../functions/ops/authoring-draft-edit.js'
import type { DraftEvaluationPort, FunctionDeps } from '../../functions/spec.js'

// ---- the planted literal ------------------------------------------------------------------------
//
// ONE family, taken from `secret-guardrail.test.ts`'s corpus and PROVEN to fire below rather than
// assumed to. A fixture that fired nothing would make every refusal cell in this file pass for the
// reason the gate exists to rule out.
const PLANTED_LITERAL = 'AKIAIOSFODNN7EXAMPLE'
const PLANTED_FAMILY = 'awsKey'

const SHELF_DIR = 'tests/.agent-qa-drafts'

const DRAFT: ParsedDraftLike = {
  testId: 't_repair-screen-fixture',
  filePath: `${SHELF_DIR}/repair-screen-fixture.yaml`,
  testName: 'Submit the local account form',
  target: 'local-form',
  steps: [
    'Open the local account form',
    'Type "alice" into the Username field',
    'Click the Submit button',
    'Verify the confirmation banner says "Saved"',
  ],
  contentDigest: 'digest-repair-screen-0',
}

const DRAFT_REF: DraftRef = {
  filePath: DRAFT.filePath,
  testId: DRAFT.testId,
  testName: DRAFT.testName,
  contentDigest: DRAFT.contentDigest,
}

/** Steps 0 and 1 passed; step 2 could not be carried out. The router's repair input. */
const BEST_PRIOR_MEMBER: MemberFixture = {
  filePath: DRAFT.filePath,
  testName: DRAFT.testName,
  outcome: 'failed',
  steps: [
    [{ type: 'navigate', url: 'http://127.0.0.1:8931/form.html' }],
    [{ type: 'fill', ref: 'e1', role: 'textbox', name: 'username' }],
    [{ type: 'click', ref: 'e9', role: 'button', name: 'submit', success: false }],
  ],
  failedSteps: [2],
  infeasibleSteps: [2],
}

const BEST_PRIOR_RUN: CompletedRunHandoff = runDocument('r_best-prior', [BEST_PRIOR_MEMBER])

function repairRoute(): RepairRoute {
  const route = routeRepairOrStop(DRAFT_REF, BEST_PRIOR_RUN)
  if (route.kind !== 'repair') {
    throw new Error(`the fixture must route to repair, and it routed to ${route.kind}`)
  }
  return route
}

// ---- the patch corpus, produced through the shipped schema --------------------------------------

/** A patch planting the credential into an UNPROTECTED step — the fence has no answer to it. */
const CREDENTIAL_PATCH: TestEditPatchSet = TestEditPatchSetSchema.parse({
  thoughts: 'the submit control needs the key',
  patches: [{ op: 'replace', path: '/steps/3', value: `Verify the banner shows ${PLANTED_LITERAL}` }],
})

/** The same shape carrying nothing a detector fires on — this file's admit direction. */
const CLEAN_PATCH: TestEditPatchSet = TestEditPatchSetSchema.parse({
  thoughts: 'wait for the banner',
  patches: [{ op: 'replace', path: '/steps/3', value: 'Verify the confirmation banner is visible' }],
})

const emit = (set: TestEditPatchSet): string => JSON.stringify(set)

// ---- the harness --------------------------------------------------------------------------------

interface Harness {
  readonly deps: Parameters<typeof repairDraft>[1]
  readonly prompts: string[]
  readonly startInputs: RunsStartInput[]
  readonly verifiedPaths: string[]
  readonly stagedDrafts: ParsedDraftLike[]
}

const FINAL_RECEIPT = {
  schemaVersion: 1,
  draftRef: DRAFT_REF,
  gates: {
    executesDefinitive: { pass: true, runRefs: [], indefinitiveRunRefs: [] },
    stableVerdict: { pass: true, runRefs: [], distinctOutcomes: ['passed'], earlyStopped: false },
    addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
    falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
  },
  stepTable: [],
  gateRuns: [],
  addsValueFinding: { novelElements: [], comparedTests: [] },
  stabilityRunsRequested: 3,
  stabilityRunsCompleted: 3,
  disposition: 'keep-eligible',
  evaluatedAt: 1,
} as unknown as DraftReceipt

/**
 * The applier, faithful to the HOST on the one axis this file turns on: the path is minted from
 * the digest, so a patched candidate never lives where the run that produced the handoff ran.
 */
function applyToSteps(draft: ParsedDraftLike, set: TestEditPatchSet): ParsedDraftLike {
  const steps = [...draft.steps]
  for (const op of set.patches) {
    const segments = op.path.split('/').slice(1)
    if (segments[0] !== 'steps') continue
    const index = Number(segments[1])
    if (!Number.isInteger(index)) continue
    if (op.op === 'replace') steps[index] = op.value as string
    if (op.op === 'add') steps.splice(index, 0, op.value as string)
    if (op.op === 'remove') steps.splice(index, 1)
  }
  const contentDigest = `${draft.contentDigest}+${set.patches.length}`
  return { ...draft, steps, contentDigest, filePath: `${SHELF_DIR}/${contentDigest}.yaml` }
}

/** How the scripted probe answers: the member either still fails at step 2, or passes. */
type ProbeVerdict = 'still-failing' | 'passing'

function harness(emissions: readonly string[], probes: readonly ProbeVerdict[]): Harness {
  const prompts: string[] = []
  const startInputs: RunsStartInput[] = []
  const verifiedPaths: string[] = []
  const stagedDrafts: ParsedDraftLike[] = []
  const documents = new Map<string, CompletedRunHandoff>()
  let emitted = 0

  const runs: DraftRunPortLike = {
    start(input: RunsStartInput) {
      const index = startInputs.length
      startInputs.push(input)
      const runId = `r_probe-${index}`
      // The probe runs over the STAGED path, so its member is recorded there — which is what the
      // real runner does and what makes the prefix re-check joinable at all.
      const filePath = input.patterns?.[0] ?? DRAFT.filePath
      const verdict = probes[index] ?? 'still-failing'
      documents.set(runId, runDocument(runId, [{
        ...BEST_PRIOR_MEMBER,
        filePath,
        ...(verdict === 'passing'
          ? { outcome: 'passed' as const, failedSteps: [], infeasibleSteps: [] }
          : {}),
      }]))
      return Promise.resolve({
        runId,
        scope: { tier: 'product', key: 'local-form' },
        executionContext: 'local-headless',
        buildOrdinal: 1,
        startedAt: 0,
        testCount: 1,
        gateRun: true,
        excludedFromOutcomes: true,
      } as never)
    },
    get(runId: string) {
      return Promise.resolve(documents.get(runId))
    },
  }

  const shelf = {
    runs,
    model: () => Promise.resolve({
      modelId: 'fixture:repair-screen',
      generate(request: { prompt: string }) {
        if (prompts.length >= REPAIR_ITERATION_CAP + 1) {
          throw new Error(`the repair loop asked for patch ${prompts.length + 1}: K did not bound it`)
        }
        prompts.push(request.prompt)
        const text = emissions[emitted] ?? emissions.at(-1) ?? '{}'
        emitted += 1
        return Promise.resolve({ text })
      },
    }),
    write: () => Promise.resolve({ kind: 'unparsable', reason: 'unused' } as DraftStageOutcome),
    applyPatches(draft: ParsedDraftLike, set: TestEditPatchSet): Promise<DraftStageOutcome> {
      const staged = applyToSteps(draft, set)
      stagedDrafts.push(staged)
      return Promise.resolve({ kind: 'staged', draft: staged })
    },
    verifyDraft(input: { draftPath: string }): Promise<DraftReceipt> {
      verifiedPaths.push(input.draftPath)
      return Promise.resolve(FINAL_RECEIPT)
    },
  }

  return {
    deps: { draft: DRAFT, handoff: BEST_PRIOR_RUN, shelf, runs } as Parameters<typeof repairDraft>[1],
    prompts,
    startInputs,
    verifiedPaths,
    stagedDrafts,
  }
}

/** The body of one `## Title` block of a rendered prompt, or `undefined`. */
function blockBody(prompt: string, titlePrefix: string): string | undefined {
  const blocks = prompt.split('\n\n## ')
  const found = blocks
    .map((block) => (block.startsWith('## ') ? block.slice(3) : block))
    .find((block) => block.startsWith(titlePrefix))
  if (found === undefined) return undefined
  const separator = found.indexOf('\n\n')
  return separator === -1 ? '' : found.slice(separator + 2)
}

// ---- integrity cells: these never depend on the fix and stay GREEN in the RED record ------------

describe('the fixtures this file measures with are real', () => {
  it('the planted literal really fires the credential family it names', () => {
    const fired = scan(PLANTED_LITERAL, loadGuardrailPolicy(defaultGuardrailPolicyInput)).fired
    expect(fired.map((entry) => entry.detector)).toContain(PLANTED_FAMILY)
  })

  it('every patch in the corpus is one the shipped schema accepts', () => {
    for (const [name, set] of [['credential', CREDENTIAL_PATCH], ['clean', CLEAN_PATCH]] as const) {
      expect(TestEditPatchSetSchema.safeParse(set).success, name).toBe(true)
    }
  })

  it('the fixture routes to the repair arm through the shipped router', () => {
    expect(repairRoute().kind).toBe('repair')
    expect(repairRoute().failingStepIndex).toBe(2)
  })

  it('the best prior run passes two steps and fails the third', () => {
    const member = memberOutcome(BEST_PRIOR_MEMBER)
    expect(member.steps.map((step) => step.verifierVerdict.pass)).toEqual([true, true, false])
  })

  it('the fake applier remints the path the way the host does', () => {
    const staged = applyToSteps(DRAFT, CLEAN_PATCH)
    expect(staged.filePath).not.toBe(DRAFT.filePath)
    expect(staged.filePath).toBe(`${SHELF_DIR}/${staged.contentDigest}.yaml`)
  })
})

// ---- the repair-path screen ---------------------------------------------------------------------

describe('a repair patch carrying a credential never reaches a run or a receipt', () => {
  it('repair-screen refuses a credential-carrying patch by name and starts no probe', async () => {
    // The probe is scripted PASSING, so an unscreened credential draft would be verified into a
    // persisted receipt. The forbidden implementation is the maximally bad one, on purpose.
    const bench = harness([emit(CREDENTIAL_PATCH)], ['passing', 'passing', 'passing'])

    const outcome = await repairDraft(repairRoute(), bench.deps)

    // NOTHING RAN. Not "a run that was later discarded" — the child process never started, so the
    // value was never typed into an application.
    expect(bench.startInputs).toEqual([])
    expect(outcome.kind).toBe('abandoned')
    if (outcome.kind !== 'abandoned') throw new Error('unreachable')
    expect(outcome.abandonment.kind).toBe('exhausted')
    // BY NAME: the family and the place, and never the value.
    expect(outcome.abandonment.error.message).toContain(PLANTED_FAMILY)
    expect(outcome.abandonment.error.message).not.toContain(PLANTED_LITERAL)
  })

  it('repair-screen spends the iteration and mints no receipt', async () => {
    const bench = harness([emit(CREDENTIAL_PATCH)], ['passing', 'passing', 'passing'])

    const outcome = await repairDraft(repairRoute(), bench.deps)

    // SPENT, not free: a refusal that did not consume an iteration would let a model that keeps
    // planting credentials run forever.
    expect(outcome.iterations).toBe(REPAIR_ITERATION_CAP)
    expect(bench.prompts).toHaveLength(REPAIR_ITERATION_CAP)
    expect(outcome.probeRunIds).toEqual([])
    // The receipt is the durable half of the disclosure: `stepTable[].stepText` is verbatim.
    expect(bench.verifiedPaths).toEqual([])
    // …and the poisoned draft never became the candidate the next iteration edits from.
    for (const prompt of bench.prompts) {
      expect(prompt).not.toContain(PLANTED_LITERAL)
    }
  })

  it('repair-screen leaves a clean patch on the path it was already on', async () => {
    // THE ADMIT DIRECTION. A screen that refused everything would pass every cell above.
    const bench = harness([emit(CLEAN_PATCH)], ['passing'])

    const outcome = await repairDraft(repairRoute(), bench.deps)

    expect(outcome.kind).toBe('repaired')
    expect(bench.startInputs).toHaveLength(1)
    expect(bench.verifiedPaths).toEqual([bench.stagedDrafts[0]?.filePath])
    expect(outcome.iterations).toBe(1)
  })
})

// ---- `context` inside the screen's domain --------------------------------------------------------

describe('the context root is inside the gate the doc block claims covers the draft', () => {
  it('context-screen refuses a credential planted in the draft context', () => {
    // A LITERAL, not a spread: `context` must be a field `ParsedDraftLike` DECLARES. Before the
    // fix this line does not typecheck, which is the type-shape half of the hole.
    const planted: ParsedDraftLike = {
      testId: DRAFT.testId,
      filePath: DRAFT.filePath,
      testName: DRAFT.testName,
      target: DRAFT.target,
      steps: DRAFT.steps,
      contentDigest: DRAFT.contentDigest,
      context: `Sign in as the operator using ${PLANTED_LITERAL}`,
    }

    let caught: DraftSecretRefusedError | undefined
    try {
      screenDraftForCredentials(planted)
    } catch (error) {
      caught = error as DraftSecretRefusedError
    }

    expect(caught).toBeInstanceOf(DraftSecretRefusedError)
    expect(caught?.family).toBe(PLANTED_FAMILY)
    expect(caught?.location).toContain('context')
    // Not a step: the location must not borrow a step's label and mislead the reader to a line
    // that holds nothing.
    expect(caught?.stepIndex).toBeUndefined()
    expect(caught?.message).not.toContain(PLANTED_LITERAL)
  })

  it('context-screen refuses a context-planted credential through authoring.draft.edit', async () => {
    // THE WIDENED DOMAIN REACHES THE SECOND PRODUCER with no second change at that op: the edit
    // path calls the same screen on the re-parsed draft.
    const target: ParsedDraftLike = {
      testId: 't_committed-checkout',
      filePath: 'tests/checkout.yaml',
      testName: 'Checkout with a coupon',
      target: 'checkout',
      steps: ['Open the cart', 'Verify the total is 0.00'],
      contentDigest: 'digest-committed',
    }
    const patches = [{ op: 'replace', path: '/context', value: `key ${PLANTED_LITERAL}` }]

    const shelf = {
      model: () => Promise.resolve({
        modelId: 'fixture:edit',
        generate: () => Promise.resolve({
          text: JSON.stringify({ thoughts: 'record the key', patches }),
        }),
      }),
      write: () => Promise.reject(new Error('an edit never emits a whole document')),
      applyPatches: () => Promise.resolve({
        kind: 'staged' as const,
        draft: {
          ...target,
          filePath: `${SHELF_DIR}/digest-edited.yaml`,
          contentDigest: 'digest-edited',
          context: `key ${PLANTED_LITERAL}`,
        },
      }),
      runs: {
        start: () => { throw new Error('authoring.draft.edit must start ZERO runs') },
        get: () => { throw new Error('authoring.draft.edit reads no runs') },
      },
      verifyDraft: () => { throw new Error('authoring.draft.edit re-runs no gates') },
    }
    const draftEvaluation: DraftEvaluationPort = {
      resolveDraft: () => Promise.resolve({ kind: 'parsed' as const, draft: target }),
      openEvaluation: () => Promise.reject(new Error('an edit opens no evaluation')),
    }
    const deps = {
      entities: {
        resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
        get: () => Promise.resolve(undefined),
      },
      draftShelf: shelf,
      draftEvaluation,
    } as unknown as FunctionDeps

    const refusal = await authoringDraftEditSpec
      .invoke(
        { testRef: `${target.filePath}::${target.testName}`, intent: 'record the operator key' },
        deps,
      )
      .then(() => undefined, (error: unknown) => error)

    expect(AUTHORING_DRAFT_EDIT_FUNCTION_ID).toBe('authoring.draft.edit')
    expect(refusal).toBeInstanceOf(DraftSecretRefusedError)
    expect((refusal as DraftSecretRefusedError).location).toContain('context')
    expect((refusal as Error).message).not.toContain(PLANTED_LITERAL)
  })
})

// ---- the evidence a repair iteration past the first is shown -------------------------------------

const RUN_BLOCK_TITLE = 'What happened in run r_best-prior'
const CANDIDATE_BLOCK_TITLE = 'The draft as it stands'

describe('every repair iteration is shown the trace and the a11y coordinates', () => {
  it('iteration-2-evidence carries the trace and the a11y coordinates at the failure point', async () => {
    // Iteration 1 probes and fails, so iteration 2 exists. The candidate has by then moved to a
    // digest-minted path, which is precisely when the handoff join used to return `undefined`.
    const bench = harness([emit(CLEAN_PATCH)], ['still-failing', 'still-failing', 'still-failing'])

    await repairDraft(repairRoute(), bench.deps)

    expect(bench.prompts).toHaveLength(REPAIR_ITERATION_CAP)
    const second = blockBody(bench.prompts[1] ?? '', RUN_BLOCK_TITLE)
    expect(second).toBeDefined()
    // CONCRETE fixture values, never non-emptiness: the mechanics-signals stub is non-empty too,
    // and asserting presence alone is how the collapse stayed invisible.
    expect(second).toContain('step 2: step 2 <- FAILED HERE')
    expect(second).toContain('verdict: fail — fixture: step 2 did not show what the test claims')
    expect(second).toContain('plan: plan click')
    expect(second).toContain('a11y state-before: step 2 sub-action 0')
  })

  it('iteration-2-evidence carries the same failure body as iteration 1', async () => {
    // THE COUNTER-DIRECTION. The handoff cannot change within one repair entry, so the evidence
    // must not either — a join that drifted to some OTHER member would pass the cell above while
    // showing the model a different run's trace every iteration.
    const bench = harness([emit(CLEAN_PATCH)], ['still-failing', 'still-failing', 'still-failing'])

    await repairDraft(repairRoute(), bench.deps)

    const first = blockBody(bench.prompts[0] ?? '', RUN_BLOCK_TITLE)
    const second = blockBody(bench.prompts[1] ?? '', RUN_BLOCK_TITLE)
    const third = blockBody(bench.prompts[2] ?? '', RUN_BLOCK_TITLE)
    expect(first).toBeDefined()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('iteration-2-evidence labels which draft each numbering belongs to', async () => {
    const bench = harness([emit(CLEAN_PATCH)], ['still-failing', 'still-failing', 'still-failing'])

    await repairDraft(repairRoute(), bench.deps)

    const prompt = bench.prompts[1] ?? ''
    expect(prompt).toContain(`## ${CANDIDATE_BLOCK_TITLE} (numbered against the current candidate)`)
    expect(prompt).toContain(`## ${RUN_BLOCK_TITLE} (steps numbered against the draft that run executed)`)
    // …and the as-it-stands block really is the CURRENT candidate, not the original.
    const asItStands = blockBody(prompt, CANDIDATE_BLOCK_TITLE)
    expect(asItStands).toContain('3: Verify the confirmation banner is visible')
  })
})
