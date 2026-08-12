// The authoring loop END TO END, through the REGISTERED op (Phase 394 plan 02, D-01 · WTST-01).
//
// ONE CHECK OF ONE PATH, not a per-layer unit test. Nothing below calls `runAuthoringLoop`
// directly: every case goes through `invokeFunction(registry, AUTHORING_DRAFT_WRITE…)` on a host
// built by `composeLocalAgent()` — the real registry, the real policy gate, the real
// `authoring.draft.verify` op underneath it, the real four gates, a real receipts store on a real
// disk. A composition that forgot a binding, an op that never registered, a dep whose optionality
// left the capability permanently `unbound` would all leave `packages/agent`'s own suites green,
// which is the produced-not-literal law applied to an entry point.
//
// HERMETIC BY CONTRACT. The model is scripted — one fixed, valid test document, returned for
// whatever prompt it is handed — and the run executor writes the run records a real executor would
// have written. The live half (a real model authoring against a real browser) is a later plan's
// lane and proves a different claim.
//
// WHAT IS FAKED, AND EXACTLY HOW FAR. `DraftAuthoringPort` is the one thing `packages/agent` and
// `packages/agent-local` genuinely cannot do: parsing a test file needs
// `@vostride/agent-qa-core`, which the FUNC-02 firewall forbids either from naming, and the CLI's
// real implementation over `parseTestFile` is exercised by that package's own suite. So the fake
// below does the REAL work either side of the parse — it hashes the actual bytes, writes them to a
// real `tests/.agent-qa-drafts/<digest>.yaml`, and reads them back off disk when the verify op
// asks — and uses the real `yaml` parser for the structure in between. The digest join this file
// asserts therefore crosses the filesystem: the shelf writes bytes, and the receipt's
// `contentDigest` is derived from a separate read of those bytes on the way into gate evaluation.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  AUTHORING_FUNNEL_GET_FUNCTION_ID,
  PROPOSALS_ACCEPT_FUNCTION_ID,
  RUNS_DIGEST_FUNCTION_ID,
  FunctionDeniedError,
  FunctionNotBoundError,
  FunctionScopeError,
  authoringFanOutBound,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { JobModelCapability, JobModelRequest } from '@vostride/agent-qa-agent'
import {
  getActiveExecutionContext,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import { FsEventLog, HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  AUTHORING_DEDUP_CONTINUATIONS,
  AuthoringDraftWriteOutputSchema,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  asRunId,
  authoredSuiteTargetPath,
  computeDraftDisposition,
  exercisedAnchors,
  renderFanOutPreview,
} from '@vostride/agent-qa-schema'
import { foldRunOutcomes, listProposalEnvelopes } from '@vostride/agent-qa-knowledge-local'
import type {
  Action,
  AuthoringDraftWriteOutput,
  AuthoringFunnelGetOutput,
  CompletedRunHandoff,
  DraftReceipt,
  MemberTestOutcome,
  ProposalsAcceptOutput,
  RunDigest,
  ElementInfo,
  FunctionCaller,
  MaskedResolvedConfig,
  RiskActionDescriptor,
  RunsStartInput,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { parse as parseYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type {
  ComposeLocalAgentInput,
  DraftAuthoringPort,
  DraftParseOutcome,
  DraftStageOutcome,
  LocalAgentHost,
  RunExecutionPort,
} from '../composition/compose-local-agent.js'
import type { TestDraftApplyRequestLike } from '@vostride/agent-qa-agent'

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** A person holding every scope, so a refusal below can only ever be the axis under test. */
const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/**
 * The caller 394-01 minted `test-write` to refuse — everything the EVALUATOR needs and nothing
 * more. It reaches `authoring.draft.verify` and must not reach `authoring.draft.write`.
 */
const RUN_AND_READ_ONLY: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['run', 'read'],
  safeMode: false,
  origin: 'human',
}

const INTENT = 'Check that the local account form shows its heading'
const SCOPE = { tier: 'product', key: 'local-form' } as const

const DRAFT_TEST_NAME = 'Confirm the local account form page heading'

/** The one document the scripted model emits — a whole test, per D-02 (creation is not an edit). */
const MODEL_DOCUMENT = `name: ${DRAFT_TEST_NAME}
target: local-form
use:
  browser:
    headless: true
steps:
  - Type "alice" into the Username field
  - Verify the page heading says "Local Form"
`

const DRAFT_STEPS: readonly string[] = [
  'Type "alice" into the Username field',
  'Verify the page heading says "Local Form"',
]

interface SuiteTextEntryFixture {
  readonly filePath: string
  readonly testName: string
  readonly stepsText: readonly string[]
}

/**
 * A suite test the INTENT above already describes, in different words.
 *
 * Every one of the intent's nine normalized tokens appears in this test's text and this test adds
 * one of its own, so the Jaccard is 9/10 -- comfortably over the pinned 0.45 rather than balanced
 * on it. The boundary itself is pinned by the frozen corpus in `packages/agent`; what this file
 * proves is that a refusal travels the whole composed path, which wants an unambiguous input.
 */
const NEAR_DUPLICATE_SUITE_TEST: SuiteTextEntryFixture = {
  filePath: 'tests/local-form-heading.yaml',
  testName: 'Check the local account form heading',
  stepsText: ['Verify that the form shows its heading'],
}

/** A suite test about something else entirely -- the control the refusal must NOT name. */
const DISTANT_SUITE_TEST: SuiteTextEntryFixture = {
  filePath: 'tests/billing-ledger.yaml',
  testName: 'Delete an archived invoice from the billing ledger',
  stepsText: ['Open the billing ledger', 'Delete the archived invoice'],
}

interface SubActionFixture {
  readonly type: string
  readonly ref: string
  readonly role: string
  readonly name: string
}

/** What the draft exercises: the Username textbox, then the page heading. */
const DRAFT_SUBACTIONS: readonly (readonly SubActionFixture[])[] = [
  [{ type: 'fill', ref: 'e1', role: 'textbox', name: 'username' }],
  [{ type: 'assertValue', ref: 'e2', role: 'heading', name: 'local form' }],
]

function elementInfo(fixture: SubActionFixture): ElementInfo {
  return {
    ref: fixture.ref,
    role: fixture.role,
    name: fixture.name,
    nameNormalized: fixture.name,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  } as unknown as ElementInfo
}

function subAction(fixture: SubActionFixture): SubActionEvidence {
  return {
    plan: `plan ${fixture.type}`,
    plannedAction: { type: fixture.type, ref: fixture.ref } as unknown as Action,
    stateBefore: {
      platform: 'web',
      tree: '',
      elements: [elementInfo(fixture)],
      refMap: {},
      timestamp: 0,
      metadata: {},
      url: 'http://127.0.0.1:8931/form.html',
    },
    result: { success: true },
  } as unknown as SubActionEvidence
}

function stepEvidence(index: number, subActions: readonly SubActionFixture[]): StepEvidence {
  return {
    stepIndex: index,
    stepText: DRAFT_STEPS[index] ?? `step ${index}`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'local-form' },
      asOfBuild: 1,
      budget: 1,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
    },
    subActions: subActions.map(subAction),
    verifierVerdict: { pass: true, reasoning: 'fixture' },
  } as unknown as StepEvidence
}

/**
 * One completed gate-run, carrying BOTH durable markers and the draft's own identity.
 *
 * `filePath` is read off the run REQUEST rather than spelled here, which is what makes this
 * fixture unable to paper over a path defect: the loop staged the draft at a digest-derived path
 * and handed exactly that path to `runs.start`, and gates 1-2 find the draft's member by comparing
 * against these bytes. A hard-coded path would make the join pass no matter what the shelf minted.
 */
/**
 * WHOSE test the gate-run reports on, and which element it exercised.
 *
 * DEFAULTED to the one fixed draft every cell above authors, and overridable for the 394-18 corpus
 * cells, which author TWELVE distinct drafts through the same host. Gate 1 finds the draft's own
 * member by `testName` and gate 3 asks whether the draft touched an element the suite index has
 * never seen, so a fixture that reported one name and one element for every draft would make the
 * second draft onwards fail `addsValue` — measuring the fixture's sameness rather than the loop.
 */
interface DraftRunIdentity {
  readonly testName: string
  readonly elementName: string
}

const FIXED_RUN_IDENTITY: DraftRunIdentity = {
  testName: DRAFT_TEST_NAME,
  elementName: 'local form',
}

function gateRunHandoff(
  runId: string,
  filePath: string,
  identity: DraftRunIdentity = FIXED_RUN_IDENTITY,
  /**
   * What the draft's member DID on this run — `passed` for every cell that predates 394-19.
   *
   * Parameterised so a cell can produce a gate-2 FLIP, which is the only state D-14's stability
   * consultation is reachable from. A fixture that could only pass made the flip arm unreachable
   * from this composed host, which is half of why mutation M3 red nothing.
   */
  outcome: MemberTestOutcome = 'passed',
): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'local-form' },
    buildOrdinal: 1,
    gateRun: true,
    excludedFromOutcomes: true,
    executionContext: 'local-headless',
    aggregateVerdict: outcome === 'failed' ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: identity.testName,
        testName: identity.testName,
        filePath,
        testIndex: 0,
        outcome,
        steps: DRAFT_SUBACTIONS
          .map((subActions) => subActions.map((fixture) => (
            fixture.role === 'heading' ? { ...fixture, name: identity.elementName } : fixture
          )))
          .map((subActions, index) => stepEvidence(index, subActions)),
      },
    ],
  } as unknown as CompletedRunHandoff
}

/**
 * The suite the draft PROPOSES TO JOIN, and the two tests already living in it (394-19).
 *
 * Computed through `authoredSuiteTargetPath` rather than spelled, so this fixture names the same
 * file the accept arm would write to — a literal would drift the day the recipe moves, which is
 * exactly when the claim stops being about the right suite.
 */
const JOIN_TARGET = authoredSuiteTargetPath('tests/.agent-qa-drafts/any.yaml', DRAFT_TEST_NAME)
const FLAKY_NEIGHBOUR = 'Show the account banner'
const STABLE_NEIGHBOUR = 'Submit the local account form'

/**
 * An ORDINARY completed run over the JOIN TARGET — neither durable marker, so it FOLDS.
 *
 * Two members, and the pair is what makes the assertion a filter rather than a wildcard: one
 * neighbour whose outcome moves across builds, one that does not. `buildOrdinal` is a parameter
 * because a flip is a fact about two builds — the projection keeps `{buildOrdinal, passed}`
 * entries, and two folds at the same ordinal are one entry, which is a stable neighbour wearing a
 * flaky one's clothes.
 */
function neighbourSuiteHandoff(
  runId: string,
  buildOrdinal: number,
  flakyOutcome: MemberTestOutcome,
): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'local-form' },
    buildOrdinal,
    executionContext: 'local-headless',
    aggregateVerdict: flakyOutcome === 'failed' ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 't_flaky-neighbour',
        testName: FLAKY_NEIGHBOUR,
        filePath: JOIN_TARGET,
        testIndex: 0,
        outcome: flakyOutcome,
        steps: [stepEvidence(0, [{ type: 'click', ref: 'e3', role: 'button', name: 'banner' }])],
      },
      {
        testId: 't_stable-neighbour',
        testName: STABLE_NEIGHBOUR,
        filePath: JOIN_TARGET,
        testIndex: 1,
        outcome: 'passed',
        steps: [stepEvidence(0, [{ type: 'click', ref: 'e4', role: 'button', name: 'submit' }])],
      },
    ],
  } as unknown as CompletedRunHandoff
}

interface FixtureExecutor {
  readonly port: RunExecutionPort
  readonly startInputs: RunsStartInput[]
}

function fixtureExecutor(
  agentQaRoot: string,
  resolveIdentity: (filePath: string) => DraftRunIdentity = () => FIXED_RUN_IDENTITY,
  /** Per-run member outcomes, in start order. Absent means every run passes (the default). */
  outcomes: readonly MemberTestOutcome[] = [],
): FixtureExecutor {
  const startInputs: RunsStartInput[] = []
  return {
    startInputs,
    port: {
      execute(request) {
        const index = startInputs.length
        startInputs.push(request)
        const runId = `RUN-LOOP-${index}`
        new FsEventLog({ root: agentQaRoot, runId }).append({
          seq: 1,
          ts: 1,
          runId,
          type: 'runStarted',
          payload: {},
        } as never)
        const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
        mkdirSync(runDir, { recursive: true })
        writeFileSync(
          join(runDir, HANDOFF_FILE),
          `${JSON.stringify(gateRunHandoff(
            runId,
            request.patterns?.[0] ?? 'tests/missing.yaml',
            resolveIdentity(request.patterns?.[0] ?? 'tests/missing.yaml'),
            outcomes[index] ?? 'passed',
          ))}\n`,
          'utf8',
        )
        return Promise.resolve({ runId: asRunId(runId) })
      },
    },
  }
}

interface ScriptedModel {
  readonly capability: () => JobModelCapability
  readonly requests: JobModelRequest[]
}

/** One fixed valid document, whatever it is asked — and a record of what it was asked. */
function scriptedModel(document = MODEL_DOCUMENT): ScriptedModel {
  const requests: JobModelRequest[] = []
  return {
    requests,
    capability: () => ({
      modelId: 'fixture:authoring-loop',
      generate(request) {
        requests.push(request)
        return Promise.resolve({ text: document })
      },
    }),
  }
}

const SHELF_DIR = 'tests/.agent-qa-drafts'

/**
 * The host's draft-authoring capability, over a REAL temp workspace.
 *
 * `stageDraft` hashes the bytes it was handed, writes them at the digest-derived shelf path, and
 * answers the descriptor; `parseDraft` re-reads that file FROM DISK and re-derives the digest from
 * what it finds there. The two are deliberately separate reads of one file, so the receipt's
 * `contentDigest` is a fact about bytes that survived a round trip rather than a value handed
 * along in memory.
 */
function draftAuthoring(workspace: string, suiteText: readonly {
  readonly filePath: string
  readonly testName: string
  readonly stepsText: readonly string[]
}[] = []): DraftAuthoringPort {
  function describe(contents: string, filePath: string): DraftStageOutcome {
    let document: unknown
    try {
      document = parseYaml(contents)
    } catch (error) {
      return { kind: 'unparsable', reason: (error as Error).message }
    }
    const test = document as { name?: unknown; steps?: unknown } | null
    if (test === null || typeof test.name !== 'string' || !Array.isArray(test.steps)) {
      return { kind: 'unparsable', reason: 'the document is not a single test with name and steps' }
    }
    return {
      kind: 'staged',
      draft: {
        testId: test.name,
        filePath,
        testName: test.name,
        steps: test.steps.map((step) => String(step)),
        contentDigest: createHash('sha256').update(contents).digest('hex'),
      },
    }
  }

  return {
    // 394-06: present because the port requires it, and never reached by this file — neither
    // case routes to repair, so no patch is ever applied. A fake answering one it was not asked
    // for would be a second staging path these e2e pins could accidentally observe.
    applyPatchesToDraft(): Promise<never> {
      throw new Error('this case never enters repair, so no patch set is ever applied')
    },
    stageDraft(contents: string): Promise<DraftStageOutcome> {
      const contentDigest = createHash('sha256').update(contents).digest('hex')
      const filePath = `${SHELF_DIR}/${contentDigest}.yaml`
      const described = describe(contents, filePath)
      if (described.kind === 'unparsable') return Promise.resolve(described)
      const absolute = join(workspace, filePath)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, contents, 'utf8')
      return Promise.resolve(described)
    },

    parseDraft(filePath: string): Promise<DraftParseOutcome> {
      let contents: string
      try {
        contents = readFileSync(join(workspace, filePath), 'utf8')
      } catch {
        return Promise.resolve({ kind: 'not-found' })
      }
      const described = describe(contents, filePath)
      return Promise.resolve(
        described.kind === 'staged'
          ? { kind: 'parsed', draft: described.draft }
          : { kind: 'unparsable', reason: described.reason },
      )
    },

    suiteTextCorpus() {
      return Promise.resolve(suiteText)
    },
  }
}

/**
 * A `ConfirmPort` that RECORDS what it was asked and answers a fixed way (394-08, D-03).
 *
 * The recording is the whole instrument: D-03's claim is that the dispatch confirm happens EXACTLY
 * ONCE, before the loop starts, carrying the fan-out preview — and none of those three is
 * observable from a boolean the gate consumed. `actions` holds the descriptors verbatim, so a cell
 * can compare the rendered figure against `authoringFanOutBound` rather than against a literal.
 */
function recordingConfirm(answer: boolean): {
  readonly port: (action: RiskActionDescriptor) => boolean
  readonly actions: RiskActionDescriptor[]
} {
  const actions: RiskActionDescriptor[] = []
  return {
    actions,
    port: (action: RiskActionDescriptor) => {
      actions.push(action)
      return answer
    },
  }
}

describe('authoring.draft.write end to end through the composition root', () => {
  let root: string
  let agentQaRoot: string
  let workspace: string
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'authoring-loop-'))
    agentQaRoot = join(root, '.agent-qa')
    workspace = join(root, 'workspace')
    mkdirSync(agentQaRoot, { recursive: true })
    mkdirSync(workspace, { recursive: true })

    // 394-08 D-03: `authoring.draft.write` is ask-tier, so every case below needs a context in
    // which an ask is REACHABLE at all — `requiresFailClosed` is true for everything except
    // `local-interactive`, and a vitest worker resolves `local-headless`. This is production's own
    // `resolveExecutionContext` with only the env/TTY read replaced, by the exact signal pair the
    // detector would hand it at a terminal (the `daemon-host.test.ts` idiom, verbatim).
    //
    // The fail-closed arm is NOT skipped by doing this — it has its own cell below, which pins the
    // headless context back for the duration of one case.
    setActiveExecutionContextResolver(() => resolveExecutionContext({ isTty: true, ciMarkers: false }))
    expect(getActiveExecutionContext()).toBe('local-interactive')
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
    // Restore the MODULE default rather than the detector, so no TTY-shaped ambient leaks into a
    // later file that shares this worker.
    setActiveExecutionContextResolver(() => 'local-headless')
  })

  function compose(input: {
    readonly executor?: RunExecutionPort
    readonly authoring?: DraftAuthoringPort
    readonly model?: () => JobModelCapability
    readonly confirm?: (action: RiskActionDescriptor) => boolean
    readonly draftApply?: ComposeLocalAgentInput['draftApply']
  }): LocalAgentHost {
    const host = composeLocalAgent({
      agentQaRoot,
      mintQuarantineIdentityPath: (filePath: string) => filePath,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      ...(input.draftApply === undefined ? {} : { draftApply: input.draftApply }),
      model: input.model ?? (() => scriptedModel().capability()),
      // An APPROVING confirm by default, so every case that is not about the gate keeps measuring
      // what it was written to measure. The decline arm is a cell of its own, and it supplies its
      // own port — a default that denied would have turned every unrelated cell into a gate test.
      confirm: input.confirm ?? (() => true),
      ...(input.executor === undefined ? {} : { runExecution: input.executor }),
      ...(input.authoring === undefined ? {} : { draftAuthoring: input.authoring }),
    })
    hosts.push(host)
    return host
  }

  it('turns one intent into a staged draft and the receipt the evaluator minted', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: model.capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    // Schema-valid at the boundary a caller reads, not merely shaped like the output.
    expect(AuthoringDraftWriteOutputSchema.safeParse(result).success).toBe(true)
    expect(result.outcome).toBe('drafted')

    // TWO model calls, and both system blocks lead with the tier law's `Agent context:` line —
    // the ONE builder extended twice through `agent_context`, never a second renderer. The two are
    // stage 3's halves (394-09, D-18): the whole-document compile, then the one unconditional
    // refinement round, whose context line names the round rather than the compile.
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0]?.system).toMatch(/^Agent context: authoring\.draft\.write — compile /)
    expect(model.requests[1]?.system).toMatch(/^Agent context: authoring\.draft\.write — refine /)

    // The draft really is on the shelf, at the digest-derived name, and the receipt's digest is
    // the sha256 of the bytes that are there. This is the write→read join: the shelf wrote them,
    // the parse re-read them, and the two agree.
    const staged = readdirSync(join(workspace, SHELF_DIR))
    expect(staged).toHaveLength(1)
    const shelfBytes = readFileSync(join(workspace, SHELF_DIR, staged[0] as string), 'utf8')
    const shelfDigest = createHash('sha256').update(shelfBytes).digest('hex')
    expect(result.draftRef?.contentDigest).toBe(shelfDigest)
    expect(staged[0]).toBe(`${shelfDigest}.yaml`)
    expect(result.draftRef?.filePath).toBe(`${SHELF_DIR}/${shelfDigest}.yaml`)
    expect(result.receipt?.draftRef.contentDigest).toBe(shelfDigest)

    // The receipt is the evaluator's: four separately-named gate booleans, N stability runs, and
    // a disposition that equals what `computeDraftDisposition` — the ONE derivation site — says
    // about those gates. Comparing against the function rather than against a literal is what
    // makes this unable to certify a second reading of the rule.
    const receipt = result.receipt
    expect(receipt).toBeDefined()
    expect(receipt?.gates.executesDefinitive.pass).toBe(true)
    expect(receipt?.gates.stableVerdict.pass).toBe(true)
    expect(receipt?.gates.addsValue.pass).toBe(true)
    expect(receipt?.gates.falsifiableAssertion.pass).toBe(true)
    expect(receipt?.stabilityRunsCompleted).toBe(DRAFT_STABILITY_RUNS_N)
    expect(receipt?.disposition).toBe(computeDraftDisposition({
      gates: {
        executesDefinitive: true,
        stableVerdict: true,
        addsValue: true,
        falsifiableAssertion: true,
      },
      stabilityRunsRequested: DRAFT_STABILITY_RUNS_N,
      stabilityRunsCompleted: DRAFT_STABILITY_RUNS_N,
    }))

    // Stage 4 really reached `runs.start`, on the staged path, with both gate-run markers.
    expect(executor.startInputs).toHaveLength(DRAFT_STABILITY_RUNS_N)
    for (const started of executor.startInputs) {
      expect(started.gateRun).toBe(true)
      expect(started.excludedFromOutcomes).toBe(true)
      expect(started.patterns).toEqual([`${SHELF_DIR}/${shelfDigest}.yaml`])
    }

    // …and the receipt was PERSISTED, keyed by the same digest — one store, one answer.
    expect(readdirSync(join(agentQaRoot, 'draft-receipts'))).toEqual([`${shelfDigest}.json`])
  })

  it('proposes a KEEP-ELIGIBLE draft without writing it — the accepted stage is the human (D-05)', async () => {
    // THE HALF OF D-05 THAT IS AN ABSENCE. A keep-eligible draft is the one the loop is most
    // confident about, which is exactly the one a route that auto-wrote would write — and a route
    // that wrote here would make the funnel's `accepted` stage meaningless and would be the private
    // write power the L10 posture abolishes. So the claim is measured as nothing having happened:
    // the arm names where accepting WOULD write, that path does not exist, and the suite directory
    // still holds only the file this fixture put there.
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: scriptedModel().capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    expect(result.receipt?.disposition).toBe('keep-eligible')

    // Where accepting WOULD write, computed through the loop's OWN recipe rather than by spelling a
    // path here — a literal would go on passing the day the recipe changed, which is precisely when
    // this claim stops being about the right file.
    const targetPath = authoredSuiteTargetPath(
      result.draftRef?.filePath ?? '',
      result.draftRef?.testName ?? '',
    )
    expect(targetPath).toBe('tests/confirm-the-local-account-form-page-heading.yaml')
    expect(existsSync(join(workspace, targetPath))).toBe(false)
    // The suite directory holds what the fixture put there and nothing else: the shelf, and no new
    // test file beside it.
    expect(readdirSync(join(workspace, 'tests'))).toEqual(['.agent-qa-drafts'])
  })

  it('lists as bound on a composed host, off the declarations rather than CLI stdout', () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({ executor: executor.port, authoring: draftAuthoring(workspace) })

    const declared = host.registry
      .list(HUMAN)
      .find((declaration) => declaration.id === AUTHORING_DRAFT_WRITE_FUNCTION_ID)

    expect(declared?.bindingStatus).toBe('bound')
    // The id passes the dot taxonomy the parity suite enforces off the registry, and carries no
    // underscore for the chat tool-name projection to trip on (T-394-07).
    expect(declared?.id).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
    expect(declared?.id).not.toContain('_')
    // THREE scopes, and the third is the one 394-01 minted for exactly this declaration.
    expect(declared?.requiredScopes).toEqual(['test-write', 'run', 'read'])
  })

  it('refuses a run+read caller BY NAME on the missing test-write scope', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({ executor: executor.port, authoring: draftAuthoring(workspace) })

    const failure = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      RUN_AND_READ_ONLY,
    ).then(() => undefined, (error: unknown) => error as FunctionScopeError)

    expect(failure).toBeInstanceOf(FunctionScopeError)
    expect(failure?.missingScopes).toEqual(['test-write'])
    // A refusal, not a run — and nothing was authored on the way to it.
    expect(executor.startInputs).toHaveLength(0)

    // The positive half, so this cell is not "the gate refuses everything": the SAME caller is
    // enough for the evaluator, which declares only the two scopes it holds.
    const stillAllowed = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
      { draftPath: 'tests/nothing-is-here.yaml' },
      RUN_AND_READ_ONLY,
    ).then(() => undefined, (error: unknown) => error as Error)
    expect(stillAllowed?.name).toBe('DraftFileNotFoundError')
  })

  it('refuses BY NAME on a host that cannot author — never an empty brief (D-09)', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({ executor: executor.port })

    const declared = host.registry
      .list(HUMAN)
      .find((declaration) => declaration.id === AUTHORING_DRAFT_WRITE_FUNCTION_ID)
    expect(declared?.bindingStatus).toBe('unbound')

    await expect(invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )).rejects.toBeInstanceOf(FunctionNotBoundError)
    expect(executor.startInputs).toHaveLength(0)
  })

  it('refuses an unparsable compiled draft and leaves the shelf empty (T-394-06)', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: scriptedModel('Sure! Here is your test:\n```yaml\nname: [unclosed\n').capability,
    })

    const failure = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    ).then(() => undefined, (error: unknown) => error as Error)

    expect(failure?.name).toBe('AuthoringDraftUnparsableError')
    // NEVER A PARTIAL WRITE: the shelf directory was never created, so there is nothing for a
    // later run — or a later reader — to mistake for a draft.
    expect(readdirSync(workspace)).toEqual([])
    expect(executor.startInputs).toHaveLength(0)
  })

  it('refuses a near-duplicate intent BEFORE any model call, naming what it matched', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const host = compose({
      executor: executor.port,
      // TWO suite members, and the refusal must name the right one. A cell whose corpus held a
      // single test would pass for a lane that named whatever it was handed.
      authoring: draftAuthoring(workspace, [NEAR_DUPLICATE_SUITE_TEST, DISTANT_SUITE_TEST]),
      model: model.capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    expect(AuthoringDraftWriteOutputSchema.safeParse(result).success).toBe(true)
    expect(result.outcome).toBe('refused')

    // THE ASSERTION THAT MAKES "before a model token is spent" A MEASURED CLAIM rather than a
    // description of the code's shape. Zero, not "fewer than one" -- the loop reaches the model
    // exactly once when it authors, so a dedup that ran after compile would read 1 here.
    expect(model.requests).toHaveLength(0)
    // And nothing was written, started, or half-done either: no shelf, no gate-run.
    expect(readdirSync(workspace)).toEqual([])
    expect(executor.startInputs).toHaveLength(0)
    expect(result.draftRef).toBeUndefined()
    expect(result.receipt).toBeUndefined()

    // THE REFUSAL NAMES ITS EVIDENCE (D-04). Asserting `outcome === 'refused'` alone would pass
    // for a refusal that named the wrong test, or named none at all.
    expect(result.refusal?.filePath).toBe(NEAR_DUPLICATE_SUITE_TEST.filePath)
    expect(result.refusal?.testName).toBe(NEAR_DUPLICATE_SUITE_TEST.testName)
    expect(result.refusal?.matchedRef)
      .toBe(`${NEAR_DUPLICATE_SUITE_TEST.filePath}::${NEAR_DUPLICATE_SUITE_TEST.testName}`)
    expect(result.refusal?.score).toBeCloseTo(0.9, 10)
    expect(result.refusal?.threshold).toBe(0.45)
    expect(result.refusal?.sharedTokens).toBe(9)
    // The universe is the whole suite, not the higher-scoring half of it.
    expect(result.refusal?.comparedTests).toBe(2)
    expect(result.refusal?.continuations).toEqual([...AUTHORING_DEDUP_CONTINUATIONS])
  })

  it('still AUTHORS when the same suite holds only a distant test', async () => {
    // The admit leg beside the refuse leg, over a NON-EMPTY corpus. Every other cell in this file
    // screens against an empty suite, so without this one "the lane admits" would be untested on
    // the only input where refusing is possible at all.
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace, [DISTANT_SUITE_TEST]),
      model: model.capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    expect(result.outcome).toBe('drafted')
    expect(result.refusal).toBeUndefined()
    // Two: the compile and D-18's one refinement round. See the first cell for why both are here.
    expect(model.requests).toHaveLength(2)
  })

  // ---- D-03's dispatch confirm: one ask, before anything, carrying the fan-out preview ---------

  it('asks EXACTLY ONCE at dispatch, before the brief is read, carrying the fan-out preview', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const confirm = recordingConfirm(true)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: model.capability,
      confirm: confirm.port,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    expect(result.outcome).toBe('drafted')
    // ONE ask for a loop that spent three child processes. D-03: one approval starts the loop,
    // which then runs unattended — a count of 2 here would be a suspended mid-loop approval state
    // by another name, and 3 would be one prompt per run.
    expect(confirm.actions).toHaveLength(1)
    expect(executor.startInputs).toHaveLength(DRAFT_STABILITY_RUNS_N)

    // THE NUMBER IS COMPARED AGAINST THE FUNCTION, NEVER AGAINST A LITERAL. A hard-coded 9 would
    // pass just as happily against a second arithmetic that had drifted from the one the report
    // reads, which is the single-source claim's whole content.
    const bound = authoringFanOutBound({})
    expect(confirm.actions[0]?.disclosure).toBe(renderFanOutPreview(bound))
    expect(confirm.actions[0]?.disclosure).toContain(`up to ${bound.total} runs`)

    // The ask is about THIS action class, and the class name is untouched by the disclosure — it is
    // the same string a standing grant would have to match and the audit row records.
    expect(confirm.actions[0]?.name).toBe(`fn:${AUTHORING_DRAFT_WRITE_FUNCTION_ID}`)
  })

  it('previews the DRAFT-MODE bound, which is smaller — so the preview is not one fixed number', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const confirm = recordingConfirm(true)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      confirm: confirm.port,
    })

    await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE, draftMode: true },
      HUMAN,
    )

    // The other side of the discriminator. Without it, a disclosure hard-coded to the default bound
    // would pass the cell above — and the two N terms would be untested at the one surface where a
    // person reads them, because in the default configuration they are equal.
    const draftBound = authoringFanOutBound({ draftMode: true })
    expect(draftBound.initialN).toBe(1)
    expect(draftBound.finalN).toBe(DRAFT_STABILITY_RUNS_N)
    expect(draftBound.total).toBeLessThan(authoringFanOutBound({}).total)
    expect(confirm.actions[0]?.disclosure).toBe(renderFanOutPreview(draftBound))
  })

  it('declines: a typed refusal, ZERO runs started, and an empty shelf', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const confirm = recordingConfirm(false)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: model.capability,
      confirm: confirm.port,
    })

    const failure = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    ).then(() => undefined, (error: unknown) => error as FunctionDeniedError)

    expect(failure).toBeInstanceOf(FunctionDeniedError)
    expect(failure?.reason).toContain('prompted-denied')
    // A decline COSTS NOTHING: no run, no model call, nothing on the shelf. Asserting only the
    // typed refusal would pass for a loop that ran to completion and then threw.
    expect(confirm.actions).toHaveLength(1)
    expect(executor.startInputs).toHaveLength(0)
    expect(model.requests).toHaveLength(0)
    expect(readdirSync(workspace)).toEqual([])
  })

  it('DENIES in a fail-closed context, by name — the cost of the ask tier, stated', async () => {
    // The tier raise's real consequence, pinned rather than discovered later: a non-interactive
    // host — CI, the daemon — cannot author, because an ask nobody can answer is a deny. The gate's
    // own reason names the ways out, so this cell asserts the reason and not merely the throw.
    setActiveExecutionContextResolver(() => 'local-headless')
    const executor = fixtureExecutor(agentQaRoot)
    const confirm = recordingConfirm(true)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      confirm: confirm.port,
    })

    const failure = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    ).then(() => undefined, (error: unknown) => error as FunctionDeniedError)

    expect(failure).toBeInstanceOf(FunctionDeniedError)
    expect(failure?.reason).toContain('fail-closed')
    expect(failure?.reason).toContain('--trust-session')
    // The confirm was never REACHED — the fail-closed arm returns before the prompt, so a person
    // is not asked a question whose answer could not be honoured anyway.
    expect(confirm.actions).toEqual([])
    expect(executor.startInputs).toHaveLength(0)
  })

  it('refuses an empty intent at the contract, before a model is ever asked', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const model = scriptedModel()
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: model.capability,
    })

    await expect(invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: '', scope: SCOPE },
      HUMAN,
    )).rejects.toThrow()
    expect(model.requests).toHaveLength(0)
  })

  // ---- 394-18: the outcome becomes a proposal, the proposal becomes a decision, the decision
  // becomes a NUMBER (WINDOWS 99 / 102 · WTST-05) ------------------------------------------------
  //
  // EVERY ENVELOPE BELOW IS MINTED THROUGH THE PRODUCTION WRITE PATH. Not one is a type literal:
  // `authoring.draft.write` runs on the composed host, its bound proposals port is the real
  // `writePendingProposalRecord`, and what these cells read back comes out of the real store's own
  // listing. That is the whole point — the funnel's `accepted` stage was structurally 0 because
  // nothing could mint one, so a corpus of hand-written envelopes would have measured a population
  // production is incapable of producing, which is exactly the defect being closed.

  /** A model that answers a DIFFERENT valid document per call, so each draft is its own digest. */
  function varyingModel(): { capability: () => JobModelCapability; count: () => number } {
    let calls = 0
    return {
      count: () => calls,
      capability: () => ({
        modelId: 'fixture:authoring-corpus',
        generate: () => {
          calls += 1
          return Promise.resolve({
            text: `name: ${DRAFT_TEST_NAME} ${calls}\n`
              + 'steps:\n'
              + '  - Open the local account form\n'
              + `  - Verify the page heading says "Local account ${calls}"\n`,
          })
        },
      }),
    }
  }

  /** Records what an accept asked the host to commit; answers as the real one-commit apply does. */
  function recordingApply(): {
    port: NonNullable<ComposeLocalAgentInput['draftApply']>
    calls: TestDraftApplyRequestLike[]
  } {
    const calls: TestDraftApplyRequestLike[] = []
    return {
      calls,
      port: {
        apply: (request: TestDraftApplyRequestLike) => {
          calls.push(request)
          return Promise.resolve({ filePath: request.targetPath, commit: `c0ffee${calls.length}` })
        },
      },
    }
  }

  it('files the drafted outcome as a test-draft envelope a person can read out of the store', async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: scriptedModel().capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput

    expect(result.outcome).toBe('drafted')
    // READ BACK THROUGH THE STORE'S OWN LISTING, not off the op's answer — which deliberately does
    // not carry the proposal at all.
    const entries = listProposalEnvelopes(agentQaRoot, { now: Date.now() })
    expect(entries).toHaveLength(1)
    const envelope = entries[0]?.envelope
    expect(envelope?.kind).toBe('test-draft')
    expect(envelope?.status).toBe('pending')
    expect(envelope?.origin?.emittedBy).toBe(AUTHORING_DRAFT_WRITE_FUNCTION_ID)
    if (envelope?.kind !== 'test-draft') throw new Error('unreachable')
    // The payload joins the receipt the same invocation answered with: one artifact, two readers.
    expect(envelope.payload.draftRef.contentDigest).toBe(result.receipt?.draftRef.contentDigest)
    expect(envelope.payload.runsPreviewed).toBe(result.fanOut?.previewed.total)
    expect(envelope.payload.runsConsumed).toBe(result.fanOut?.consumedTotal)
    // ATTRIBUTED TO A RUN THIS HOST REALLY RECORDED — the receipt's last gate run.
    expect(envelope.origin?.runId).toBe(result.receipt?.gateRuns.at(-1)?.runId)
  })

  it("renders the digest's test-draft line off that persisted envelope", async () => {
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: scriptedModel().capability,
    })

    const result = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    )) as AuthoringDraftWriteOutput
    const runId = result.receipt?.gateRuns.at(-1)?.runId

    const digest = (await invokeFunction(
      host.registry,
      RUNS_DIGEST_FUNCTION_ID,
      { runId },
      HUMAN,
    )) as RunDigest

    // SC-5 artifact 3. The line existed since 394-06 and had never rendered on any host, because
    // `proposalsMintedThisRun` attributes rows by `origin.runId` and nothing could write an
    // envelope carrying one. BOTH figures, which is the pairing WTST-08 exists for.
    expect(digest.proposalsMintedThisRun).toHaveLength(1)
    const row = digest.proposalsMintedThisRun[0]
    expect(row?.summaryLine).toContain('test draft')
    expect(row?.summaryLine).toContain(
      `${result.fanOut?.consumedTotal} run(s) of up to ${result.fanOut?.previewed.total} previewed`,
    )
    // A PENDING proposal is owed a decision, and the digest says which one.
    expect(row?.requiredDecision).not.toBe('pending')
    expect(digest.pendingProposalCount).toBe(1)
  })

  it('counts an ACCEPTED draft through the shipped projection, and raises the acceptance flag', async () => {
    // The gate-run fixture reports on whichever draft the run was actually handed, read off the
    // staged bytes — so twelve distinct drafts are twelve distinct members and twelve distinct
    // novel elements, and gate 3 is being asked a real question rather than a rigged one.
    const executor = fixtureExecutor(agentQaRoot, (filePath) => {
      const staged = parseYaml(readFileSync(join(workspace, filePath), 'utf8')) as { name: string }
      return { testName: staged.name, elementName: `heading ${staged.name}` }
    })
    const model = varyingModel()
    const applied = recordingApply()
    const host = compose({
      executor: executor.port,
      authoring: draftAuthoring(workspace),
      model: model.capability,
      draftApply: applied.port,
    })

    // TWELVE drafts, each authored through the registered op against a distinct document, so the
    // population the funnel reports on is one this host really produced.
    for (let index = 0; index < 12; index += 1) {
      const result = (await invokeFunction(
        host.registry,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
        { intent: `${INTENT} (${index})`, scope: SCOPE },
        HUMAN,
      )) as AuthoringDraftWriteOutput
      expect(result.outcome).toBe('drafted')
    }

    const pending = listProposalEnvelopes(agentQaRoot, { now: Date.now() })
    expect(pending).toHaveLength(12)

    // ELEVEN human decisions, each through the SHIPPED accept — the protected, human-origin verb
    // with its own confirm, not a store write this cell performs.
    for (const entry of pending.slice(0, 11)) {
      const answer = (await invokeFunction(
        host.registry,
        PROPOSALS_ACCEPT_FUNCTION_ID,
        { proposalId: entry.envelope.id },
        HUMAN,
      )) as ProposalsAcceptOutput
      expect(answer.apply.outcome).toBe('applied')
    }
    expect(applied.calls).toHaveLength(11)

    const funnel = (await invokeFunction(
      host.registry,
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'all-time' } },
      HUMAN,
    )) as AuthoringFunnelGetOutput

    // 394-12 leg B's frozen expectation, now answerable: `built` was already real, and `accepted`
    // was the stage that could not move off 0 on any host.
    expect(funnel.stages.built).toBe(12)
    expect(funnel.stages.accepted).toBe(11)
    // THE FLAG REACHES A SURFACE THROUGH THE SHIPPED PROJECTION (D-13). 11 of 12 is 91.7%, strictly
    // above the 9/10 ceiling, over a population at or above the 10-draft floor.
    expect(funnel.acceptanceFailure).toBe(true)
    expect(funnel.line).toContain('ACCEPTANCE FAILURE')
    expect(funnel.line).toContain('11 accepted')

    // THE TWO-SIDED CONTROL, over the SAME produced population: a window of five is below the
    // draft floor, so the flag stays silent and the line says why. A flag that fired here would be
    // one that fires on every high-keep-rate answer rather than on a judgeable one.
    const narrow = (await invokeFunction(
      host.registry,
      AUTHORING_FUNNEL_GET_FUNCTION_ID,
      { window: { scope: 'last-n', n: 5 } },
      HUMAN,
    )) as AuthoringFunnelGetOutput
    expect(narrow.stages.built).toBe(5)
    expect(narrow.acceptanceFailure).toBe(false)
  })

  it('refuses to author at all on a host that cannot FILE what it authors', async () => {
    // The composition binds the proposals port with the loop's two halves, so this is the same
    // conditional-spread absence every other optional capability answers with — and it is checked
    // BEFORE any run is spent, which the executor's empty record is the evidence for.
    const executor = fixtureExecutor(agentQaRoot)
    const host = compose({ executor: executor.port, model: scriptedModel().capability })

    const failure = await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      { intent: INTENT, scope: SCOPE },
      HUMAN,
    ).then(() => undefined, (error: unknown) => error as FunctionNotBoundError)

    expect(failure).toBeInstanceOf(FunctionNotBoundError)
    expect(executor.startInputs).toHaveLength(0)
    expect(listProposalEnvelopes(agentQaRoot, { now: Date.now() })).toEqual([])
  })

  // ---- the composed stability read (394-19 · WINDOWS 107) ------------------------------------
  //
  // WHAT WAS UNMEASURED. 394-17 wired D-14's history half — `authoringFunnel.outcomes`, over the
  // run-outcome projection's own read side — and mutation M3 recorded the wire itself as reachable
  // by NO cell: deleting the whole `outcomes:` binding from `compose-local-agent.ts` left the
  // monorepo fully green (0 of ~1576). Both ENDS were pinned; only the line joining them was not,
  // because the bundle lives in a private `WeakMap` and `openEvaluation` is module-private, so
  // nothing could reach the composed port without driving `authoring.draft.verify` end to end.
  //
  // This is that drive. No fake outcomes port is interposed: the rows arrive through
  // `foldRunOutcomes` — knowledge-local's own fold, over ordinary handoffs carrying NEITHER
  // durable marker, which is what a real run writes — and the only way a neighbour's name can
  // reach this receipt is the real binding serving the real read.
  it('names the TARGET suite\'s flaky neighbours through the COMPOSED outcomes binding', async () => {
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(knowledgeRoot, { recursive: true })
    // TWO BUILDS, because a flip is a fact about two of them. The projection keeps one
    // `{buildOrdinal, passed}` entry per build, so a single fold — however it read — could only
    // ever produce a one-valued history, which `assessSuiteStability` calls stable.
    foldRunOutcomes({
      knowledgeRoot,
      handoff: neighbourSuiteHandoff('RUN-SUITE-1', 1, 'passed'),
      extractAnchors: exercisedAnchors,
    })
    foldRunOutcomes({
      knowledgeRoot,
      handoff: neighbourSuiteHandoff('RUN-SUITE-2', 2, 'failed'),
      extractAnchors: exercisedAnchors,
    })

    // The draft on its one-test shelf, written to the real workspace so the composed parse reads
    // it back off disk exactly as it does for a loop-authored one.
    const draftPath = `${SHELF_DIR}/composed-stability.yaml`
    const absolute = join(workspace, draftPath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, MODEL_DOCUMENT, 'utf8')

    // The gate-2 FLIP: run 1 passed, run 2 failed. D-17 early-stops there, and the flip is the
    // only state from which the consultation is reachable at all.
    const executor = fixtureExecutor(agentQaRoot, () => FIXED_RUN_IDENTITY, ['passed', 'failed'])
    const host = compose({ executor: executor.port, authoring: draftAuthoring(workspace) })

    const receipt = (await invokeFunction(
      host.registry,
      AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
      { draftPath, targetSuitePath: JOIN_TARGET },
      HUMAN,
    )) as DraftReceipt

    expect(receipt.gates.stableVerdict.pass).toBe(false)
    expect(receipt.gates.stableVerdict.reason).toContain('the verdict flipped across runs')
    // THE EVIDENCE THE BINDING SERVED THE READ. This name exists in exactly one place on this
    // host — the rows the fold wrote — and it can only have reached a receipt through the bound
    // `outcomes` port. Deleting that binding degrades the same reason to the no-history line.
    expect(receipt.gates.stableVerdict.reason).toContain('Your app is unstable')
    expect(receipt.gates.stableVerdict.reason).toContain(`${JOIN_TARGET}::${FLAKY_NEIGHBOUR}`)
    // …and not the neighbour whose history did not move: a message naming everything names
    // nothing, and would also pass over a port that answered a constant.
    expect(receipt.gates.stableVerdict.reason).not.toContain(STABLE_NEIGHBOUR)
  })
})
