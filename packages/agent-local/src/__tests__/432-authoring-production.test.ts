// Authoring reaches the production boundary on both of its chains (Phase 432 plan 04, D-18).
//
// Authoring starts runs in two places, and each is its own immediate chain to the run core:
//
//   NORMAL — `authoring.draft.verify` → `createDraftEvaluation.startGateRun` → the registered
//            `runs.start` op → the host's run execution → the core.
//   REPAIR — the loop's repair arm → `draftShelf.runs.start` (one probe per iteration) → the same
//            op; a probe that passes returns to `draftShelf.verifyDraft`, which is the NORMAL chain
//            again for the repaired draft.
//
// Pinning only one of them leaves the other unproved, so every cell below drives the REGISTERED ops
// on a host built by `composeLocalAgent()`, and the host's run execution IS the shipped run core
// (`createRunInvocationCore`). Only the core's two host ports are fixtures: the declaration is read
// off the draft file on disk and a mutable project config (the CLI's own producer is 432-03's
// cell), and the assembler records every run it is asked to build. The production refusal is the
// core's, unchanged.
//
// A refused run is measured as nothing having happened: no run assembled, no run directory, no
// receipt, and for repair no further model call or verification. The opt-in controls prove the same
// chains reach assembly, so no zero below is vacuous.
//
// WHY THE REPAIR CELLS CHANGE THE CONFIG MID-LOOP. A draft can only reach repair after its first
// verification has run, and that verification runs against the same target. So the loop starts
// opted in, and the opt-in is withdrawn at the moment the cell is about: when the model is asked for
// a repair patch (the probe is next), or when the probe run finishes (the final verification is
// next). The core reads the config per run, so each chain meets the refusal on its own.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { JobModelCapability, JobModelRequest } from '@vostride/agent-qa-agent'
import {
  getActiveExecutionContext,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  DRAFT_STABILITY_RUNS_N,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  asRunId,
} from '@vostride/agent-qa-schema'
import type {
  Action,
  AuthoringDraftWriteOutput,
  CompletedRunHandoff,
  DraftReceipt,
  ElementInfo,
  FunctionCaller,
  MaskedResolvedConfig,
  RunsStartInput,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeLocalAgent } from '../composition/compose-local-agent.js'
import type {
  DraftAuthoringPort,
  DraftParseOutcome,
  DraftStageOutcome,
  LocalAgentHost,
  RunExecutionPort,
} from '../composition/compose-local-agent.js'
import { createRunInvocationCore, RunDeniedError } from '../composition/run-invocation-core.js'
import type { RunConfig, RunTargetDeclaration } from '../composition/run-invocation-core.js'
import type { RunTargetClass } from '../composition/run-risk.js'

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

/** The one line the refusal must name, spelled here rather than imported from the producer. */
const OPT_IN_LINE = 'allowProduction: true'

const SHELF_DIR = 'tests/.agent-qa-drafts'
const SCOPE = { tier: 'product', key: 'prod-form' } as const
const INTENT = 'Check that submitting the production account form saves the account'

const PROD_TARGET = 'prod-form'
const LOCAL_TARGET = 'local-form'

const DRAFT_NAME = 'Submit the production account form'
const WORKING_STEP = 'Type "alice" into the Username field'
/** The step the first verification cannot carry out, so the loop routes to repair. */
const BROKEN_STEP = 'Click the Sumbit button'
const REPAIRED_STEP = 'Click the Submit button'

function draftDocument(target: string, steps: readonly string[] = [WORKING_STEP, BROKEN_STEP]): string {
  return stringifyYaml({ name: DRAFT_NAME, target, steps: [...steps] })
}

/** The repair patch the model emits: fix the one step the run could not carry out. */
const REPAIR_PATCH = JSON.stringify({
  thoughts: 'name the submit control the way the page spells it',
  patches: [{ op: 'replace', path: '/steps/1', value: REPAIRED_STEP }],
})

// ---- the project: its declared targets and the top-level opt-in, read per run ----------------

interface Project {
  readonly targets: Record<string, { readonly environment?: 'local' | 'shared' | 'production' }>
  allowProduction?: unknown
}

function project(allowProduction?: unknown): Project {
  return {
    targets: {
      [PROD_TARGET]: { environment: 'production' },
      [LOCAL_TARGET]: { environment: 'local' },
    },
    ...(allowProduction === undefined ? {} : { allowProduction }),
  }
}

/** The member targets a file drives: a test's own, or each member's for a suite. */
function memberTargets(workspace: string, relativePath: string): string[] {
  const document = parseYaml(readFileSync(join(workspace, relativePath), 'utf8')) as {
    target?: unknown
    tests?: unknown
  }
  if (Array.isArray(document.tests)) {
    return document.tests.flatMap((member) => memberTargets(workspace, String(member)))
  }
  return typeof document.target === 'string' ? [document.target] : []
}

/** The declaration the core refuses on, produced from the files the request names and the config. */
function declarationFor(workspace: string, config: Project, request: RunsStartInput): RunTargetDeclaration {
  const targetNames = (request.patterns ?? []).flatMap((pattern) => memberTargets(workspace, pattern))
  const declared = targetNames.map((name) =>
    Object.hasOwn(config.targets, name) ? config.targets[name]?.environment : undefined)
  const productionTargetNames = targetNames.filter((_, index) => declared[index] === 'production')
  const targetClass: RunTargetClass = productionTargetNames.length > 0
    ? 'production'
    : declared.every((environment) => environment === 'local') && targetNames.length > 0
      ? 'local'
      : declared.includes(undefined) ? undefined : 'shared'
  return {
    targetClass,
    targetNames: [...new Set(targetNames)],
    productionTargetNames,
    allowProduction: config.allowProduction === true,
  }
}

// ---- the run evidence a finished run leaves ---------------------------------------------------

function subAction(type: string, name: string, success: boolean): SubActionEvidence {
  return {
    plan: `plan ${type}`,
    plannedAction: { type, ref: 'e1' } as unknown as Action,
    stateBefore: {
      platform: 'web',
      tree: '',
      elements: [{
        ref: 'e1',
        role: type === 'fill' ? 'textbox' : 'button',
        name,
        nameNormalized: name,
        state: { enabled: true, focused: false, visible: true },
        labels: {},
        attributes: {},
      } as unknown as ElementInfo],
      refMap: {},
      timestamp: 0,
      metadata: {},
      url: 'http://127.0.0.1:8931/form.html',
    },
    result: { success },
  } as unknown as SubActionEvidence
}

/** One step's evidence. The broken step is the one the planner could not carry out. */
function stepEvidence(stepIndex: number, stepText: string): StepEvidence {
  const broken = stepText === BROKEN_STEP
  return {
    stepIndex,
    stepText,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { ...SCOPE },
      asOfBuild: 1,
      budget: 1,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
    },
    subActions: [subAction(stepIndex === 0 ? 'fill' : 'click', `control ${stepIndex}`, !broken)],
    verifierVerdict: { pass: !broken, reasoning: broken ? 'the control does not exist' : 'fixture' },
    ...(broken ? { termination: { kind: 'infeasible', reason: 'fixture: no such control' } } : {}),
  } as unknown as StepEvidence
}

/** What the run found for the draft it drove, keyed on the draft's own file and name. */
function evidenceFor(workspace: string, runId: string, request: RunsStartInput): CompletedRunHandoff {
  const filePath = request.patterns?.[0] ?? 'tests/missing.yaml'
  const document = parseYaml(readFileSync(join(workspace, filePath), 'utf8')) as {
    name: string
    steps: string[]
  }
  const failed = document.steps.includes(BROKEN_STEP)
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { ...SCOPE },
    buildOrdinal: 1,
    gateRun: true,
    excludedFromOutcomes: true,
    executionContext: 'local-interactive',
    aggregateVerdict: failed ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [{
      testId: document.name,
      testName: document.name,
      filePath,
      testIndex: 0,
      outcome: failed ? 'failed' : 'passed',
      steps: document.steps.map((text, index) => stepEvidence(index, text)),
    }],
  } as unknown as CompletedRunHandoff
}

// ---- the host's run execution: the shipped core --------------------------------------------------

interface CoreRecord {
  /** Every request the core resolved a declaration for — the chain REACHED the core. */
  readonly reached: RunsStartInput[]
  /** Every request the core assembled — the run was allowed and built. */
  readonly assembled: RunsStartInput[]
  /** Every refusal the core raised, in order. */
  readonly refused: RunDeniedError[]
}

function coreBackedExecution(input: {
  readonly workspace: string
  readonly agentQaRoot: string
  readonly config: Project
  /** Called after each allowed run has finished and its evidence is on disk. */
  readonly afterRun?: (request: RunsStartInput, index: number) => void
}): { readonly port: RunExecutionPort; readonly record: CoreRecord } {
  const record: CoreRecord = { reached: [], assembled: [], refused: [] }
  let minted = 0
  const core = createRunInvocationCore({
    configPath: join(input.workspace, 'agent-qa.config.yaml'),
    agentQaRoot: input.agentQaRoot,
    executionContext: 'local-interactive',
    mintRunId: () => `run_authoring_${String(++minted)}`,
    isMintedRunId: (value) => /^run_[a-z0-9_]+$/.test(value),
    // 432-13: the core asks nobody, so the only thing that can refuse a run here is production.
    resolveTargetDeclaration: (request) => {
      record.reached.push(request)
      return declarationFor(input.workspace, input.config, request)
    },
    assembleRun: (context): RunConfig => {
      record.assembled.push(context.request)
      return {
        runId: context.runId as RunConfig['runId'],
        scope: { ...SCOPE },
        executionContext: context.executionContext,
        buildOrdinal: 1,
        configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
        members: (context.request.patterns ?? []).map((filePath) => ({
          testId: filePath,
          name: DRAFT_NAME,
          filePath,
        })),
        executor: async (member) => ({
          name: member.name,
          filePath: member.filePath,
          status: 'passed',
          steps: [],
          duration: 1,
        }),
        ports: context.ports,
      }
    },
  })
  return {
    record,
    port: {
      async execute(request) {
        let started: { runId: string }
        try {
          started = await core.execute(request)
        } catch (error) {
          if (error instanceof RunDeniedError) record.refused.push(error)
          throw error
        }
        // The core wrote the run's own events and handoff. The handoff is then replaced by what
        // this fixture's application "did", which is what every authoring e2e fixture scripts; the
        // claim here is whether the run happened, not what it found.
        const runDir = join(input.agentQaRoot, RUNS_SUBDIR, slugBranch(started.runId))
        writeFileSync(
          join(runDir, HANDOFF_FILE),
          `${JSON.stringify(evidenceFor(input.workspace, started.runId, request))}\n`,
          'utf8',
        )
        input.afterRun?.(request, record.assembled.length)
        return { runId: asRunId(started.runId) }
      },
    },
  }
}

// ---- the host's draft authoring, over a real workspace ----------------------------------------

function draftAuthoring(workspace: string, config: Project): DraftAuthoringPort {
  function describeDraft(contents: string, filePath: string): DraftStageOutcome {
    const test = parseYaml(contents) as { name?: unknown; target?: unknown; steps?: unknown } | null
    if (test === null || typeof test.name !== 'string' || !Array.isArray(test.steps)) {
      return { kind: 'unparsable', reason: 'the document is not a single test with name and steps' }
    }
    if (typeof test.target !== 'string') return { kind: 'unparsable', reason: 'no `target`' }
    return {
      kind: 'staged',
      draft: {
        testId: test.name,
        filePath,
        testName: test.name,
        target: test.target,
        steps: test.steps.map((step) => String(step)),
        contentDigest: createHash('sha256').update(contents).digest('hex'),
      },
    }
  }

  function stage(contents: string): DraftStageOutcome {
    const contentDigest = createHash('sha256').update(contents).digest('hex')
    const filePath = `${SHELF_DIR}/${contentDigest}.yaml`
    const described = describeDraft(contents, filePath)
    if (described.kind === 'unparsable') return described
    const absolute = join(workspace, filePath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents, 'utf8')
    return described
  }

  return {
    deriveDefaultScope(): Promise<never> {
      throw new Error('every case here supplies a scope, so nothing derives one')
    },
    stageDraft: (contents) => Promise.resolve(stage(contents)),
    // The shipped applier works on the yaml CST in the CLI; this one applies the same `replace` to
    // the steps and re-stages the bytes, so the repaired draft lives at its own digest path.
    applyPatchesToDraft(draft, patchSet): Promise<DraftStageOutcome> {
      const document = parseYaml(readFileSync(join(workspace, draft.filePath), 'utf8')) as {
        name: string
        target: string
        steps: string[]
      }
      for (const patch of patchSet.patches) {
        const [root, index] = patch.path.split('/').slice(1)
        if (root === 'steps' && patch.op === 'replace') document.steps[Number(index)] = String(patch.value)
      }
      return Promise.resolve(stage(stringifyYaml(document)))
    },
    parseDraft(filePath: string): Promise<DraftParseOutcome> {
      let contents: string
      try {
        contents = readFileSync(join(workspace, filePath), 'utf8')
      } catch {
        return Promise.resolve({ kind: 'not-found' })
      }
      const described = describeDraft(contents, filePath)
      return Promise.resolve(
        described.kind === 'staged'
          ? { kind: 'parsed', draft: described.draft }
          : { kind: 'unparsable', reason: described.reason },
      )
    },
    // 432 D-06: the direct writer, over the same temp workspace: a new test's target must be
    // absent, an edit's must still hold the bytes read, and the shelf bytes are what is written.
    publishDraft(request) {
      const target = join(workspace, request.targetPath)
      const found = existsSync(target)
        ? createHash('sha256').update(readFileSync(target)).digest('hex')
        : undefined
      if (found !== request.sourceDigest) {
        return Promise.resolve({
          kind: 'not-written' as const,
          targetPath: request.targetPath,
          reason: 'target-changed' as const,
        })
      }
      const bytes = readFileSync(join(workspace, request.draftPath))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      return Promise.resolve({
        kind: 'written' as const,
        filePath: request.targetPath,
        contentDigest: createHash('sha256').update(bytes).digest('hex'),
      })
    },
    suiteTextCorpus: () => Promise.resolve([]),
    configuredTargetNames: () => Promise.resolve(Object.keys(config.targets)),
  }
}

// ---- the model: compile, refine and repair ----------------------------------------------------

interface ScriptedModel {
  readonly capability: () => JobModelCapability
  readonly repairAsks: JobModelRequest[]
}

function scriptedModel(document: string, onRepairAsk?: () => void): ScriptedModel {
  const repairAsks: JobModelRequest[] = []
  return {
    repairAsks,
    capability: () => ({
      modelId: 'fixture:authoring-production',
      generate(request) {
        if (/You repair the MECHANICS/.test(`${request.system ?? ''}\n${request.prompt}`)) {
          repairAsks.push(request)
          onRepairAsk?.()
          return Promise.resolve({ text: REPAIR_PATCH })
        }
        return Promise.resolve({ text: document })
      },
    }),
  }
}

// ---- the cells ------------------------------------------------------------------------------

describe('authoring reaches the production boundary on both chains (432-04, D-18)', () => {
  let root: string
  let workspace: string
  let agentQaRoot: string
  const hosts: LocalAgentHost[] = []

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'authoring-production-'))
    workspace = root
    agentQaRoot = join(root, '.agent-qa')
    mkdirSync(agentQaRoot, { recursive: true })
    // `authoring.draft.write` is ask-tier; an ask is reachable only in `local-interactive`.
    setActiveExecutionContextResolver(() => resolveExecutionContext({ isTty: true, ciMarkers: false }))
    expect(getActiveExecutionContext()).toBe('local-interactive')
  })

  afterEach(() => {
    for (const composed of hosts.splice(0)) void composed.close()
    rmSync(root, { recursive: true, force: true })
    setActiveExecutionContextResolver(() => 'local-headless')
  })

  function compose(input: {
    readonly execution: RunExecutionPort
    readonly config: Project
    readonly model?: () => JobModelCapability
  }): LocalAgentHost {
    const host = composeLocalAgent({
      agentQaRoot,
      mintQuarantineIdentityPath: (filePath: string) => filePath,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => join(root, 'agent-qa-knowledge'),
      model: input.model ?? (() => {
        throw new Error('this case authors nothing, so no model is resolved')
      }),
      runExecution: input.execution,
      draftAuthoring: draftAuthoring(workspace, input.config),
    })
    hosts.push(host)
    return host
  }

  /** Put a draft on the shelf the way `stageDraft` does, and return its shelf path. */
  function shelve(contents: string): string {
    const filePath = `${SHELF_DIR}/${createHash('sha256').update(contents).digest('hex')}.yaml`
    mkdirSync(join(workspace, SHELF_DIR), { recursive: true })
    writeFileSync(join(workspace, filePath), contents, 'utf8')
    return filePath
  }

  function receipts(): string[] {
    const dir = join(agentQaRoot, 'draft-receipts')
    return existsSync(dir) ? readdirSync(dir) : []
  }

  async function refusalOf(work: Promise<unknown>): Promise<unknown> {
    try {
      await work
      return undefined
    } catch (error) {
      return error
    }
  }

  function expectProductionRefusal(error: unknown, targetName: string): void {
    expect(error).toBeInstanceOf(RunDeniedError)
    const denied = error as RunDeniedError
    expect(denied.reason).toContain(`"${targetName}"`)
    expect(denied.reason).toContain('environment: production')
    expect(denied.reason).toContain(OPT_IN_LINE)
    // 432-19 (D-15): the refusal carries no remedy member at all, not even an empty list.
    expect(denied).not.toHaveProperty('remedies')
  }

  describe('C432-AUTHORING-PRODUCTION-NORMAL — normal verification meets the core refusal', () => {
    it('C432-AUTHORING-PRODUCTION-NORMAL: authoring.draft.verify refuses a production draft at its first gate run, before assembly', async () => {
      const config = project()
      const draftPath = shelve(draftDocument(PROD_TARGET))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      // REACHED: the gate run arrived at the core, on the draft's own path, with both markers.
      expect(core.record.reached).toHaveLength(1)
      expect(core.record.reached[0]?.patterns).toEqual([draftPath])
      expect(core.record.reached[0]?.gateRun).toBe(true)
      expect(core.record.reached[0]?.excludedFromOutcomes).toBe(true)
      // REFUSED BEFORE EFFECTS: nothing assembled, no run directory, no receipt.
      expect(core.record.assembled).toEqual([])
      expect(existsSync(join(agentQaRoot, RUNS_SUBDIR))).toBe(false)
      expect(receipts()).toEqual([])
    })

    it('C432-AUTHORING-PRODUCTION-NORMAL: draft mode is refused the same way', async () => {
      const config = project()
      const draftPath = shelve(draftDocument(PROD_TARGET))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath, draftMode: true },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      expect(core.record.reached).toHaveLength(1)
      expect(core.record.assembled).toEqual([])
      expect(receipts()).toEqual([])
    })

    it('C432-AUTHORING-PRODUCTION-NORMAL: authoring.draft.write refuses at its first gate run, and no receipt is minted', async () => {
      const config = project()
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const model = scriptedModel(draftDocument(PROD_TARGET))
      const host = compose({ execution: core.port, config, model: model.capability })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
        { intent: INTENT, scope: SCOPE },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      expect(core.record.reached).toHaveLength(1)
      expect(core.record.reached[0]?.patterns?.[0]).toMatch(new RegExp(`^${SHELF_DIR}/[0-9a-f]{64}\\.yaml$`))
      expect(core.record.assembled).toEqual([])
      expect(model.repairAsks).toEqual([])
      expect(receipts()).toEqual([])
    })

    it('the opt-in control: with allowProduction: true the same verification is assembled N times and mints a receipt', async () => {
      const config = project(true)
      const draftPath = shelve(draftDocument(PROD_TARGET, [WORKING_STEP, REPAIRED_STEP]))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      const receipt = (await invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath },
        HUMAN,
      )) as DraftReceipt

      expect(core.record.refused).toEqual([])
      expect(core.record.assembled).toHaveLength(DRAFT_STABILITY_RUNS_N)
      for (const request of core.record.assembled) expect(request.patterns).toEqual([draftPath])
      expect(receipt.stabilityRunsCompleted).toBe(DRAFT_STABILITY_RUNS_N)
      expect(receipts()).toEqual([`${receipt.draftRef.contentDigest}.json`])
    })
  })

  describe('authoring edges (432-04, D-18)', () => {
    /** A suite the draft proposes to join, holding one existing test on `neighbourTarget`. */
    function suiteWith(neighbourTarget: string): string {
      const neighbour = 'tests/neighbour.yaml'
      mkdirSync(join(workspace, 'tests'), { recursive: true })
      writeFileSync(join(workspace, neighbour), draftDocument(neighbourTarget, [WORKING_STEP]), 'utf8')
      const suite = 'suites/mixed.suite.yaml'
      mkdirSync(join(workspace, 'suites'), { recursive: true })
      writeFileSync(join(workspace, suite), stringifyYaml({ name: 'mixed', tests: [neighbour] }), 'utf8')
      return suite
    }

    it('EDGE-04: a production draft proposed into a suite of local tests is refused naming only its own target', async () => {
      const config = project()
      const targetSuitePath = suiteWith(LOCAL_TARGET)
      const draftPath = shelve(draftDocument(PROD_TARGET))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath, targetSuitePath },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      expect((refusal as RunDeniedError).reason).not.toContain(`"${LOCAL_TARGET}"`)
      expect(core.record.reached.map((request) => request.patterns)).toEqual([[draftPath]])
      expect(core.record.assembled).toEqual([])
    })

    it('EDGE-04: a local draft proposed into a suite holding a production test runs, because its gate runs drive only the draft', async () => {
      const config = project()
      const targetSuitePath = suiteWith(PROD_TARGET)
      const draftPath = shelve(draftDocument(LOCAL_TARGET, [WORKING_STEP, REPAIRED_STEP]))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      await invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath, targetSuitePath },
        HUMAN,
      )

      expect(core.record.refused).toEqual([])
      expect(core.record.assembled).toHaveLength(DRAFT_STABILITY_RUNS_N)
      for (const request of core.record.assembled) expect(request.patterns).toEqual([draftPath])
      // Not vacuous: a gate run that named the suite would have carried its production member.
      expect(declarationFor(workspace, config, { patterns: [targetSuitePath] }).productionTargetNames)
        .toEqual([PROD_TARGET])
    })

    it.each([
      ['false', false],
      ['the string "true"', 'true'],
      ['1', 1],
    ])('only the literal true opts in: allowProduction %s refuses a production draft', async (_label, optIn) => {
      const config = project(optIn)
      const draftPath = shelve(draftDocument(PROD_TARGET))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
        { draftPath },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      expect(core.record.assembled).toEqual([])
    })

    it('the verification request carries no opt-in of its own: the gate runs name the draft and the markers only', async () => {
      const config = project()
      const draftPath = shelve(draftDocument(PROD_TARGET))
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const host = compose({ execution: core.port, config })

      await refusalOf(invokeFunction(host.registry, AUTHORING_DRAFT_VERIFY_FUNCTION_ID, { draftPath }, HUMAN))

      expect(Object.keys(core.record.reached[0] ?? {}).sort()).toEqual(
        ['excludedFromOutcomes', 'gateRun', 'patterns'],
      )
    })
  })

  describe('C432-AUTHORING-PRODUCTION-REPAIR — repair and the repaired draft meet the core refusal', () => {
    it('C432-AUTHORING-PRODUCTION-REPAIR: the repair probe is refused at the core once the opt-in is gone', async () => {
      const config = project(true)
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      // The person removes the opt-in while the loop is repairing: the probe is the next run.
      const model = scriptedModel(draftDocument(PROD_TARGET), () => { delete config.allowProduction })
      const host = compose({ execution: core.port, config, model: model.capability })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
        { intent: INTENT, scope: SCOPE },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      // The first verification ran (opted in) and routed to repair on its evidence.
      expect(model.repairAsks).toHaveLength(1)
      expect(core.record.assembled).toHaveLength(DRAFT_STABILITY_RUNS_N)
      // The probe REACHED the core, on the repaired candidate's own path, and was not assembled.
      const probe = core.record.reached.at(-1)
      expect(core.record.reached).toHaveLength(DRAFT_STABILITY_RUNS_N + 1)
      expect(probe?.patterns?.[0]).not.toBe(core.record.assembled[0]?.patterns?.[0])
      expect(readFileSync(join(workspace, probe?.patterns?.[0] ?? ''), 'utf8')).toContain(REPAIRED_STEP)
      expect(core.record.refused).toHaveLength(1)
      // Repair stopped there: no second patch, no final verification, one receipt (the first).
      expect(receipts()).toHaveLength(1)
    })

    it('C432-AUTHORING-PRODUCTION-REPAIR: a successful repair returns to verifyDraft, and that verification is refused at the core', async () => {
      const config = project(true)
      let probePath: string | undefined
      const core = coreBackedExecution({
        workspace,
        agentQaRoot,
        config,
        // The probe has passed; the person removes the opt-in before the final verification.
        afterRun: (request, assembled) => {
          if (assembled === DRAFT_STABILITY_RUNS_N + 1) {
            probePath = request.patterns?.[0]
            delete config.allowProduction
          }
        },
      })
      const model = scriptedModel(draftDocument(PROD_TARGET))
      const host = compose({ execution: core.port, config, model: model.capability })

      const refusal = await refusalOf(invokeFunction(
        host.registry,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
        { intent: INTENT, scope: SCOPE },
        HUMAN,
      ))

      expectProductionRefusal(refusal, PROD_TARGET)
      // N verification runs, then the one probe, all assembled while opted in.
      expect(core.record.assembled).toHaveLength(DRAFT_STABILITY_RUNS_N + 1)
      // The final verification of the REPAIRED draft reached the core and was refused.
      expect(core.record.reached).toHaveLength(DRAFT_STABILITY_RUNS_N + 2)
      expect(core.record.reached.at(-1)?.patterns).toEqual([probePath])
      expect(core.record.refused).toHaveLength(1)
      expect(receipts()).toHaveLength(1)
    })

    it('the repair control: kept opted in, the loop repairs the production draft through every chain', async () => {
      const config = project(true)
      const core = coreBackedExecution({ workspace, agentQaRoot, config })
      const model = scriptedModel(draftDocument(PROD_TARGET))
      const host = compose({ execution: core.port, config, model: model.capability })

      const result = (await invokeFunction(
        host.registry,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
        { intent: INTENT, scope: SCOPE },
        HUMAN,
      )) as AuthoringDraftWriteOutput

      expect(result.outcome).toBe('repaired')
      expect(core.record.refused).toEqual([])
      // Verification (N), one probe, then the repaired draft's verification (N).
      expect(core.record.assembled).toHaveLength(2 * DRAFT_STABILITY_RUNS_N + 1)
      const original = core.record.assembled[0]?.patterns?.[0]
      const repaired = core.record.assembled[DRAFT_STABILITY_RUNS_N]?.patterns?.[0]
      expect(repaired).not.toBe(original)
      expect(core.record.assembled.map((request) => request.patterns?.[0])).toEqual([
        ...Array.from({ length: DRAFT_STABILITY_RUNS_N }, () => original),
        ...Array.from({ length: DRAFT_STABILITY_RUNS_N + 1 }, () => repaired),
      ])
      expect(result.draftRef?.filePath).toBe(repaired)
    })
  })
})
