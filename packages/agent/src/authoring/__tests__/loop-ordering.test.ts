// The stage order and the single public entry, pinned structurally (394 plan 02, D-01 · WTST-01).
//
// THE MUTATION THIS FILE MUST GO RED ON: moving the dedup call site in `loop.ts` to after the
// compile call. That is the reordering "dedup-before-author" forbids — it turns a screen that
// stops the loop before a byte is authored into one that runs after an LLM has already been paid
// and a file already written — and a pin that never reds on it has measured one traversal and
// called it an order. The mutation is named HERE, in the test, and deliberately nowhere in
// `loop.ts`'s own comments: a source comment describing the forbidden edit teaches the next reader
// how to make it look intentional.
//
// SEQUENCE EQUALITY, NOT PER-STAGE CALL COUNTS. Every assertion below compares a WHOLE ordered
// sequence. Per-call checks (`expect(getBrief).toHaveBeenCalled()`) can only say that a stage ran;
// the claim this pin exists to support is that nothing ran out of order and nothing was skipped,
// and only an ordered comparison carries it. This is the key-set-equality argument `ports.test-d.ts`
// makes about SHAPE, applied to TIME.
//
// TWO INDEPENDENT WITNESSES, AND THE SECOND IS WHAT MAKES THE FIRST HONEST. The loop reports the
// stages it entered on its own result, which a reordered loop would report reordered — but a trace
// the loop writes about itself could in principle disagree with what it did. So the fakes keep
// their OWN log: each injected dep pushes its stage name when it is actually reached, and the two
// logs are asserted against each other. A self-report that claimed `compile` before `dedup` while
// the deps fired the other way fails the second cell even if it satisfies the first.

import { NO_STANDING_APPROVALS } from '@vostride/agent-qa-safety'
import {
  DRAFT_STABILITY_RUNS_N,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringBrief,
  DraftReceipt,
  FunctionCaller,
  ScopeKey,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  ACCEPT_CONTROL_DRAFT,
  ACCEPT_CONTROL_SUBACTIONS,
  acceptControlMember,
  expectedElement,
  fakeFingerprintIndex,
  fakeRunPort,
} from './evidence-fixtures.js'
import { AUTHORING_LOOP_STAGES, runAuthoringLoop } from '../loop.js'
import type { AuthoringLoopStage } from '../loop.js'
import { evaluateDraft } from '../verify-draft.js'
import type {
  AuthoringReadPortLike,
  DraftShelfPortLike,
  SuiteTextCorpusEntryLike,
} from '../ports.js'
import { createFunctionRegistry } from '../../functions/registry.js'
import type { FunctionDeps } from '../../functions/spec.js'

const INTENT = 'Check that the local account form shows its heading'
const SCOPE: ScopeKey = { tier: 'product', key: 'local-form' }

/** The staged draft's shelf path, as `stageDraft` mints it — digest in, path out. */
const STAGED_PATH = `tests/.agent-qa-drafts/${ACCEPT_CONTROL_DRAFT.contentDigest}.yaml`

const EMPTY_BRIEF: AuthoringBrief = {
  exemplars: [],
  procedures: [],
  facts: [],
  cautions: [],
  coverage: {},
  truncation: 'none',
  admissions: [],
}

const SUITE_TEXT: readonly SuiteTextCorpusEntryLike[] = [
  {
    filePath: 'tests/unrelated.yaml',
    testName: 'Delete an archived invoice from the billing ledger',
    stepsText: ['Open the billing ledger', 'Delete the archived invoice'],
  },
]

/**
 * Fakes that keep an ordered log of the stage each of them belongs to.
 *
 * The `verify` fake runs the REAL `evaluateDraft` over the shared evidence fixtures rather than
 * answering a hand-written receipt, so the value stage 5 routes on is one the evaluator actually
 * produced — a scripted `keep-eligible` would let the routing cell pass over a disposition no gate
 * ever reached.
 */
function observedLoop() {
  const observed: AuthoringLoopStage[] = []

  const read: AuthoringReadPortLike = {
    getAuthoringBrief(intent: string, scope: ScopeKey): Promise<AuthoringBrief> {
      expect(intent).toBe(INTENT)
      expect(scope).toEqual(SCOPE)
      observed.push('brief')
      return Promise.resolve(EMPTY_BRIEF)
    },
    suiteTextCorpus(): Promise<readonly SuiteTextCorpusEntryLike[]> {
      observed.push('dedup')
      return Promise.resolve(SUITE_TEXT)
    },
  }

  const modelCalls: string[] = []
  const written: string[] = []

  const shelf: DraftShelfPortLike = {
    model: () => Promise.resolve({
      modelId: 'fixture:loop-ordering',
      generate(request) {
        observed.push('compile')
        modelCalls.push(request.prompt)
        return Promise.resolve({ text: 'name: whatever the fixture parses to\nsteps: []\n' })
      },
    }),
    write(contents: string) {
      // NOT its own stage name: the shelf write is the back half of `compile`, and giving it a
      // seventh name would let this pin claim an order over a stage the vocabulary does not have.
      // What it asserts instead is the ORDER WITHIN the stage — a model call has already been
      // observed by the time bytes arrive, which is what "compile then stage" means.
      expect(observed.at(-1)).toBe('compile')
      written.push(contents)
      return Promise.resolve({ kind: 'staged' as const, draft: { ...ACCEPT_CONTROL_DRAFT, filePath: STAGED_PATH } })
    },
    // The accept control passes its gates, so stage 5 answers `drafted` without consulting a run —
    // but a shelf that could not run one would be a host that verifies drafts and cannot look at
    // what answered. Bound to the shared fake so the port is real rather than absent.
    runs: fakeRunPort({ runs: [] }),
    // Never reached by this file: the accept control passes its gates, so stage 5 answers
    // `drafted` and the repair arm is not entered. Present because the shelf's contract requires
    // it — a host that can stage a draft can patch one — and a fake that answered a patch it was
    // never asked for would be a second staging path this pin could accidentally observe.
    applyPatches(): Promise<never> {
      throw new Error('the accept control never enters repair, so no patch is ever applied')
    },
    async verifyDraft(input): Promise<DraftReceipt> {
      expect(input.draftPath).toBe(STAGED_PATH)
      observed.push('verify')
      return await evaluateDraft(
        { draft: { ...ACCEPT_CONTROL_DRAFT, filePath: STAGED_PATH } },
        {
          runs: fakeRunPort({
            runs: Array.from({ length: DRAFT_STABILITY_RUNS_N }, () => [
              { ...acceptControlMember(), filePath: STAGED_PATH },
            ]),
          }),
          fingerprints: fakeFingerprintIndex([
            {
              filePath: 'demo/init/tests/uat-381-local-form.yaml',
              testName: 'Sign in on the local account form',
              elements: [expectedElement(ACCEPT_CONTROL_SUBACTIONS[0]![0]!)],
            },
          ]),
          textCorpus: [],
          receipts: { put: () => Promise.resolve() },
          now: () => 1_700_000_000_000,
        },
      )
    },
  }

  return { observed, modelCalls, written, deps: { read, shelf } }
}

/** The stages that touch an injected dep — the ones an observer outside the loop can witness. */
const DEP_OBSERVABLE_STAGES: readonly AuthoringLoopStage[] = ['brief', 'dedup', 'compile', 'verify']

describe('the six-stage order is structural, not a habit of the code', () => {
  it('enters every declared stage exactly once, in the declared order', async () => {
    const loop = observedLoop()

    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    // SEQUENCE EQUALITY over the WHOLE vocabulary. Not a subset, not a set, not a count: the
    // stages the loop entered are exactly the stages it declares, in exactly that order.
    expect(result.stages).toEqual([...AUTHORING_LOOP_STAGES])
    // …and the vocabulary really is the six, so the line above cannot be satisfied by a
    // vocabulary that quietly shrank to the stages the loop happens to run.
    expect(AUTHORING_LOOP_STAGES).toEqual([
      'brief',
      'dedup',
      'compile',
      'verify',
      'route',
      'compound',
    ])
    expect(result.outcome.kind).toBe('drafted')
  })

  it('is corroborated by the deps themselves, so the loop cannot mis-report its own order', async () => {
    const loop = observedLoop()

    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    // The independent witness: what the FAKES saw, in the order they saw it. `route` and
    // `compound` touch no dep and cannot appear here — the first is a pure function of the
    // receipt, the second is the recorded fact that the Curator's existing path already fires —
    // so the comparison is against the dep-observable stages, taken from the same vocabulary
    // rather than re-listed.
    expect(loop.observed).toEqual([...DEP_OBSERVABLE_STAGES])
    // The two logs AGREE: the loop's self-report, filtered to the stages a dep can witness, is
    // byte-for-byte what the deps witnessed. This is what makes the first cell's trace evidence
    // rather than an assertion the loop makes about itself.
    expect(result.stages.filter((stage) => DEP_OBSERVABLE_STAGES.includes(stage)))
      .toEqual(loop.observed)
  })

  it('screens the intent exactly once, and does so before anything is authored', async () => {
    const loop = observedLoop()

    const result = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    // ONCE. A second screen would be a second answer to "is this already covered", and the two
    // would be free to disagree about the same intent.
    expect(loop.observed.filter((stage) => stage === 'dedup')).toHaveLength(1)
    // BEFORE. Stated as an index comparison over the observed log rather than as a pair of
    // "was it called" checks, so a dedup that ran after the model call fails here even though
    // both stages ran.
    expect(loop.observed.indexOf('dedup')).toBeLessThan(loop.observed.indexOf('compile'))
    // …and nothing was authored on the way to it: the screen saw a corpus, the model saw one
    // prompt, and the shelf received exactly one document — after both.
    expect(result.dedup.comparedTests).toBe(SUITE_TEXT.length)
    expect(loop.modelCalls).toHaveLength(1)
    expect(loop.written).toHaveLength(1)
  })

  it('reaches verify only after the compiled bytes are on the shelf', async () => {
    const loop = observedLoop()

    await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, loop.deps)

    // The shelf write has no stage name of its own, so its ordering is pinned by the path the
    // verify stage was handed: `STAGED_PATH` is what `write` answered, and the `verifyDraft` fake
    // asserts it received exactly that. A verify reached before the write would have had no path
    // to pass — which is the claim, made structurally.
    expect(loop.observed.indexOf('compile')).toBeLessThan(loop.observed.indexOf('verify'))
    expect(loop.written).toHaveLength(1)
  })
})

// ---- the second claim: there is exactly ONE public entry to the loop ---------------------------

const LISTING_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read', 'run', 'test-write', 'knowledge-write', 'approval-write'],
  safeMode: false,
  origin: 'human',
}

function minimalDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) => Promise.resolve(
        { kind: 'not-found', schemaVersion: 1, recordId } as const,
      ),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
  }
}

/**
 * The ids this phase intends the `authoring.` domain to hold, and no others.
 *
 * `authoring.draft.edit` lands in plan 09 and is deliberately absent until it does — a pin that
 * pre-authorised an id nothing registers would go green on the day it arrived and say nothing
 * about it.
 *
 * 394-07 ADDS `authoring.funnel.get`, and the addition is a DECISION rather than bookkeeping,
 * because this pin is not a census — it is the one-public-entry claim. What it forbids is
 * promoting a loop STAGE to its own registered op, which would hand the chat planner (binding
 * every registered op 1:1) a way to run dedup, compile or route on its own and reorder or skip
 * the rest.
 *
 * The funnel read is not a stage and cannot become one. It runs over records the loop has already
 * written, it takes no draft and no intent, it starts nothing, and there is no ordering it could
 * be moved within: invoking it before, during or after a loop invocation answers a question about
 * the receipts on disk either way. Registering it therefore widens the DOMAIN without widening the
 * loop's entry surface — which is the distinction this line exists to make somebody state out
 * loud, in the same change that makes it.
 */
const EXPECTED_AUTHORING_IDS: readonly string[] = [
  'authoring.draft.verify',
  'authoring.draft.write',
  'authoring.funnel.get',
]

describe('the loop has exactly one public entry', () => {
  it('registers no authoring op besides the evaluator and the loop', () => {
    const registry = createFunctionRegistry({
      deps: minimalDeps(),
      resolveExecutionContext: () => 'local-interactive',
      // The no-grants reader, and it costs this cell nothing: `list` consults no gate, so the
      // question here is only which ids the catalogue holds.
      standingApprovalReader: () => NO_STANDING_APPROVALS,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    })

    const authoringIds = registry
      .list(LISTING_CALLER)
      .map((declaration) => declaration.id)
      .filter((id) => id.startsWith('authoring.'))
      .sort()

    // EXACT SET EQUALITY off the registry, which is what makes "no caller can reorder or skip the
    // stages" a structural claim rather than a statement about how `loop.ts` happens to be
    // written today. Promoting any stage — dedup, compile, route — to its own registered op would
    // hand the chat planner, which binds every registered op 1:1, a way to run that stage on its
    // own; this line is what refuses that edit, in the same change that makes it.
    expect(authoringIds).toEqual([...EXPECTED_AUTHORING_IDS])
  })
})
