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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
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
  computeDraftDisposition,
  renderFanOutPreview,
} from '@vostride/agent-qa-schema'
import type {
  Action,
  AuthoringDraftWriteOutput,
  CompletedRunHandoff,
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
  DraftAuthoringPort,
  DraftParseOutcome,
  DraftStageOutcome,
  LocalAgentHost,
  RunExecutionPort,
} from '../composition/compose-local-agent.js'

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
function gateRunHandoff(runId: string, filePath: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'local-form' },
    buildOrdinal: 1,
    gateRun: true,
    excludedFromOutcomes: true,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: DRAFT_TEST_NAME,
        testName: DRAFT_TEST_NAME,
        filePath,
        testIndex: 0,
        outcome: 'passed',
        steps: DRAFT_SUBACTIONS.map((subActions, index) => stepEvidence(index, subActions)),
      },
    ],
  } as unknown as CompletedRunHandoff
}

interface FixtureExecutor {
  readonly port: RunExecutionPort
  readonly startInputs: RunsStartInput[]
}

function fixtureExecutor(agentQaRoot: string): FixtureExecutor {
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
          `${JSON.stringify(gateRunHandoff(runId, request.patterns?.[0] ?? 'tests/missing.yaml'))}\n`,
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
  }): LocalAgentHost {
    const host = composeLocalAgent({
      agentQaRoot,
      mintQuarantineIdentityPath: (filePath: string) => filePath,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
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
})
