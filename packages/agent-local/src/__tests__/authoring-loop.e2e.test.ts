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
  FunctionNotBoundError,
  FunctionScopeError,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { JobModelCapability, JobModelRequest } from '@vostride/agent-qa-agent'
import { FsEventLog, HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  AuthoringDraftWriteOutputSchema,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  asRunId,
  computeDraftDisposition,
} from '@vostride/agent-qa-schema'
import type {
  Action,
  AuthoringDraftWriteOutput,
  CompletedRunHandoff,
  ElementInfo,
  FunctionCaller,
  MaskedResolvedConfig,
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
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
  })

  function compose(input: {
    readonly executor?: RunExecutionPort
    readonly authoring?: DraftAuthoringPort
    readonly model?: () => JobModelCapability
  }): LocalAgentHost {
    const host = composeLocalAgent({
      agentQaRoot,
      mintQuarantineIdentityPath: (filePath: string) => filePath,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: input.model ?? (() => scriptedModel().capability()),
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

    // ONE model call, and its system block leads with the tier law's `Agent context:` line
    // carrying the authoring context — the ONE builder extended, never a second renderer.
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.system).toMatch(/^Agent context: authoring\.draft\.write — /)

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
