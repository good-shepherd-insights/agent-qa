import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deriveBundleTrust,
  drainQueue,
  enumerateBundleDirs,
  loadBundle,
  commitCurationDelta,
  createAuthoringReader,
  openKnowledgeReader,
  type CommitCurationOutcome,
  type CuratorAuthor,
  type LoadedBundle,
} from '@vostride/agent-qa-knowledge-local'
import { createModel } from '@vostride/agent-qa-model'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import {
  executeStep,
  SecretStore,
  type LoopPorts,
  type Planner,
  type PlatformAdapter,
  type StepContext,
} from '@vostride/agent-qa-runner'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import {
  asRef,
  asRunId,
  normalizeAnchor,
  parseProcedureBody,
  procedureSourceBinding,
  survivingOutcomeEvents,
  type Action,
  type CanaryOutcome,
  type CompletedRunHandoff,
  type ElementInfo,
  type ProcedureMatch,
  type RecordId,
  type ScopeKey,
  type ScreenState,
  type ServedBrief,
  type StepEvidence,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { runCurationTail } from '../curation-tail.js'
import { buildCuratorAuthor } from '../curator-author.js'
import { emitCanaryOutcomes } from '../emit-canary-outcomes.js'

type CuratorModel = ReturnType<typeof createModel>
type GenerateResult = Awaited<ReturnType<CuratorModel['doGenerate']>>

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const PRODUCT = 'loop-shop'
const FLOW = 'checkout::sign-in-and-buy'
const FILE_PATH = 'tests/checkout/sign-in-and-buy.test.ts'
const SCOPE: ScopeKey = { tier: 'product', key: PRODUCT }
/** Mirror of get-procedure.ts PROCEDURE_REPLAY_CONFIRMATIONS.full (internal constitution value). */
const FULL_TIER_REPLAY_CONFIRMATIONS = 2
const noAuth: ResolvedModelAuth = { kind: 'none' }

/** Capable-family model id so llm-path authorship derives the FULL curator tier (D-06). */
function scriptedProfile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: 'claude-sonnet-4',
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
    capabilities: {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: false,
      streaming: false,
      contextWindow: 16_384,
      maxOutput: 1_024,
    },
  }
}

function generateResult(text: string): GenerateResult {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

/** Deterministic fixture model: every call returns the same whole-flow proposal (no live LLM). */
function alwaysModel(output: string): CuratorModel {
  return {
    specificationVersion: 'v3',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    async doGenerate() {
      return generateResult(output)
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
}

/** The LLM proposes segmentation + parameter names ONLY; code builds the body (D-02/D-03). */
const wholeFlowProposal = JSON.stringify({
  candidates: [
    {
      flowName: FLOW,
      stepSpan: [0, 2],
      parameters: [
        {
          name: 'accountEmail',
          type: 'string',
          required: true,
          appliesTo: [{ stepOrdinal: 1, field: 'text' }],
        },
      ],
      successAssertion: 'The checkout landing renders after sign-in',
    },
  ],
})

function element(
  ref: string,
  role: string,
  name: string,
  attributes: Record<string, string> = {},
): ElementInfo {
  const bounds = { x: 48, y: 120, width: 280, height: 44 }
  return {
    ref: asRef(ref),
    role,
    name,
    nameNormalized: name.toLowerCase(),
    bounds,
    center: { x: 188, y: 142 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: {},
    attributes,
  }
}

function screenState(elements: ElementInfo[], url: string): ScreenState {
  return {
    platform: 'web',
    tree: 'fixture tree',
    elements,
    refMap: Object.fromEntries(elements.flatMap((candidate) =>
      candidate.bounds === undefined || candidate.center === undefined
        ? []
        : [[candidate.ref, { bounds: candidate.bounds, center: candidate.center }]],
    )),
    url,
    timestamp: 1_700_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1280,
      viewportHeight: 800,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 800 },
    },
  }
}

function servedBrief(): ServedBrief {
  return {
    scope: SCOPE,
    asOfBuild: 42,
    budget: 0,
    truncation: '',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'a'.repeat(64),
  }
}

function subAction(
  action: Action,
  elements: ElementInfo[],
  url: string,
  afterUrl?: string,
): SubActionEvidence {
  return {
    plan: 'planned by the loop-closure fixture',
    plannedAction: action,
    stateBefore: screenState(elements, url),
    ...(afterUrl === undefined ? {} : { stateAfter: screenState(elements, afterUrl) }),
    result: { success: true },
  }
}

function step(
  stepIndex: number,
  stepText: string,
  action: Action,
  elements: ElementInfo[],
  cacheStatus: StepEvidence['cacheStatus'] = 'miss',
  afterUrl?: string,
): StepEvidence {
  return {
    stepIndex,
    stepText,
    cacheStatus,
    servedBrief: servedBrief(),
    subActions: [subAction(action, elements, '/login', afterUrl)],
    verifierVerdict: { pass: true, reasoning: 'verified by the loop-closure fixture' },
  }
}

/**
 * A verified-PASS 3-step trajectory with source-tagged values: the email arrives as a test
 * variable and the password as a masked secret on a cache-bypass step, so D-03's forced
 * parameterization has real evidence to key on without inventing a second credential.
 */
function handoffFor(runId: string, buildOrdinal: number): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: asRunId(runId),
    scope: SCOPE,
    buildOrdinal,
    executionContext: 'local-interactive',
    aggregateVerdict: 'passed',
    configDigests: {
      suiteConfigDigest: 'b'.repeat(64),
      testConfigDigest: 'c'.repeat(64),
    },
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_001_000,
    tests: [
      {
        testId: FLOW,
        testName: FLOW,
        filePath: FILE_PATH,
        testIndex: 0,
        outcome: 'passed',
        steps: [
          step(
            0,
            'Open the sign-in form',
            { type: 'click', ref: asRef('e-signin') },
            [element('e-signin', 'button', 'Sign in')],
          ),
          step(
            1,
            'Enter the account email',
            {
              type: 'fill',
              ref: asRef('e-email'),
              text: '{{env:ACCOUNT_EMAIL}}',
              clearMode: 'replace',
              submit: false,
            },
            [element('e-email', 'textbox', 'Account email', { type: 'email' })],
          ),
          step(
            2,
            'Submit the account password',
            {
              type: 'fill',
              ref: asRef('e-password'),
              text: '<SECRET_0>',
              clearMode: 'replace',
              submit: true,
            },
            [element('e-password', 'textbox', 'Account password', { type: 'password' })],
            'bypass',
            '/dashboard',
          ),
        ],
      },
    ],
  }
}

function handoffWithSteps(input: {
  runId: string
  buildOrdinal: number
  flow: string
  filePath: string
  steps: StepEvidence[]
}): CompletedRunHandoff {
  return {
    ...handoffFor(input.runId, input.buildOrdinal),
    tests: [
      {
        testId: input.flow,
        testName: input.flow,
        filePath: input.filePath,
        testIndex: 0,
        outcome: 'passed',
        steps: input.steps,
      },
    ],
  }
}

describe('procedure loop closure (PROC-01/PROC-02/ABRF-01/ABRF-02, D-01..D-12)', () => {
  let root: string
  let agentQaRoot: string
  let knowledgeRoot: string
  let procedureId: RecordId
  let fixtureAuthor: CuratorAuthor

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'procedure-loop-closure-'))
    agentQaRoot = join(root, '.agent-qa')
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(knowledgeRoot, { recursive: true })

    // The 381-02 fixture-author seam: procedure jobs traverse the REAL extraction author over
    // a scripted model; fact jobs take the deterministic no-model fallback. No live LLM.
    const extractionAuthor = buildCuratorAuthor({
      profile: scriptedProfile(),
      auth: noAuth,
      createModelImpl: () => alwaysModel(wholeFlowProposal),
    })
    fixtureAuthor = async (job, neighbors) =>
      job.kind === 'procedure'
        ? extractionAuthor(job, neighbors)
        : { kind: 'fallback-required' as const, reason: 'no-model' as const }
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function runTail(runId: string, buildOrdinal: number): Promise<string[]> {
    const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, HANDOFF_FILE),
      `${JSON.stringify(handoffFor(runId, buildOrdinal))}\n`,
      'utf8',
    )
    const warnings: string[] = []
    await runCurationTail({
      runId,
      agentQaRoot,
      knowledgeConfig: { dir: 'agent-qa-knowledge' },
      configDir: root,
      auditSink: new JsonlAuditSink(agentQaRoot),
      modelDeps: { profile: scriptedProfile(), auth: noAuth },
      policy,
      log: { warn: (message) => warnings.push(message) },
      operations: { buildCuratorAuthor: () => fixtureAuthor },
    })
    return warnings
  }

  function procedureBundles(): LoadedBundle[] {
    return enumerateBundleDirs(knowledgeRoot).flatMap(({ dir }) => {
      const outcome = loadBundle(dir)
      if (outcome.kind !== 'loaded') return []
      return outcome.bundle.frontmatter.kind === 'procedure' ? [outcome.bundle] : []
    })
  }

  // Receipt-idempotent committed-procedure prerequisite: the curation-tail receipt makes
  // re-running the commit tail a no-op (the receiptMatches short-circuit in
  // curation-tail.ts), so this helper is safe in BOTH execution orders — ordered runs skip
  // on the receipt, standalone runs (vitest -t) establish the committed bundle from
  // scratch. It guarantees only the COMMIT prerequisite, never canary state: the ordered
  // flow's canary accumulation across tests stays intentional.
  async function ensureCommittedProcedure(): Promise<void> {
    const warnings = await runTail('run-loop-1', 42)
    expect(warnings).toEqual([])
    const bundle = procedureBundles()[0]
    if (bundle !== undefined) procedureId = bundle.frontmatter.id as RecordId
  }

  async function runIsolatedProcedureFixture(input: {
    name: string
    handoff: CompletedRunHandoff
    proposal: string
  }): Promise<{
    warnings: string[]
    bundles: LoadedBundle[]
    commitOutcomes: CommitCurationOutcome[]
  }> {
    const fixtureRoot = join(root, input.name)
    const fixtureAgentQaRoot = join(fixtureRoot, '.agent-qa')
    const fixtureKnowledgeRoot = join(fixtureRoot, 'agent-qa-knowledge')
    const runId = String(input.handoff.runId)
    const runDir = join(fixtureAgentQaRoot, RUNS_SUBDIR, slugBranch(runId))
    mkdirSync(fixtureKnowledgeRoot, { recursive: true })
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(input.handoff)}\n`, 'utf8')

    const extractionAuthor = buildCuratorAuthor({
      profile: scriptedProfile(),
      auth: noAuth,
      createModelImpl: () => alwaysModel(input.proposal),
    })
    const isolatedAuthor: CuratorAuthor = async (job, neighbors) =>
      job.kind === 'procedure'
        ? extractionAuthor(job, neighbors)
        : { kind: 'fallback-required' as const, reason: 'no-model' as const }
    const commitOutcomes: CommitCurationOutcome[] = []
    const captureDrain: typeof drainQueue = (options) =>
      drainQueue({
        ...options,
        operations: {
          ...options.operations,
          commitCurationDelta(deps, job, checkpoint) {
            const outcome = commitCurationDelta(deps, job, checkpoint)
            commitOutcomes.push(outcome)
            return outcome
          },
        },
      })
    const warnings: string[] = []
    await runCurationTail({
      runId,
      agentQaRoot: fixtureAgentQaRoot,
      knowledgeConfig: { dir: 'agent-qa-knowledge' },
      configDir: fixtureRoot,
      auditSink: new JsonlAuditSink(fixtureAgentQaRoot),
      modelDeps: { profile: scriptedProfile(), auth: noAuth },
      policy,
      log: { warn: (message) => warnings.push(message) },
      operations: {
        buildCuratorAuthor: () => isolatedAuthor,
        drainQueue: captureDrain,
      },
    })
    const bundles = enumerateBundleDirs(fixtureKnowledgeRoot).flatMap(({ dir }) => {
      const outcome = loadBundle(dir)
      return outcome.kind === 'loaded' && outcome.bundle.frontmatter.kind === 'procedure'
        ? [outcome.bundle]
        : []
    })
    return { warnings, bundles, commitOutcomes }
  }

  function getProcedure(): ProcedureMatch | undefined {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    return reader.getProcedure(
      'sign in and buy at checkout',
      screenState([], '/login'),
      // D-08: source-tagged binding names + per-type capability bits only — no value of any
      // binding ever reaches the matcher (the entry is computed loop-side by the shared
      // sanitizer over the run's actual raw value). Every required name of the served
      // parameterSchema is bound the way replay callers do; CR-03 keeps the password
      // behavior options literal.
      {
        variables: [procedureSourceBinding('accountEmail', 'buyer@example.test')!],
        memory: [],
        secrets: ['step2_text'],
      },
    )
  }

  function confirmationEvents(): {
    creationJobId: string
    creation: Extract<LoadedBundle['events'][number], { type: 'confirmed' }>
    organic: Extract<LoadedBundle['events'][number], { type: 'confirmed' }>[]
  } {
    const bundle = procedureBundles()[0]!
    if (bundle.provenance.mode !== 'run-linked') {
      throw new Error('expected run-linked procedure provenance')
    }
    const creationJobId = bundle.provenance.curationJobId
    if (creationJobId === undefined) throw new Error('expected procedure creation job identity')
    const confirmed = survivingOutcomeEvents(bundle.events).filter(
      (event): event is Extract<LoadedBundle['events'][number], { type: 'confirmed' }> =>
        event.type === 'confirmed' && event.evidenceToken.length > 0,
    )
    const creation = confirmed.find((event) => event.curationJobId === creationJobId)
    if (creation === undefined) throw new Error('expected confirmed procedure creation event')
    return {
      creationJobId,
      creation,
      organic: confirmed.filter((event) => event.curationJobId !== creationJobId),
    }
  }

  function emitPositiveProcedureCanary(stepIndex: number): void {
    const evidence: StepEvidence = {
      ...step(
        stepIndex,
        'Replay the accepted sign-in procedure',
        { type: 'click', ref: asRef('e-signin') },
        [element('e-signin', 'button', 'Sign in')],
      ),
      planSource: {
        kind: 'procedure-replay',
        procedureId,
        guard: { checksPassed: 3, total: 3 },
      },
    }
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    const report = emitCanaryOutcomes({
      handoff: handoffWithSteps({
        runId: `run-canary-replay-${stepIndex}`,
        buildOrdinal: 43 + stepIndex,
        flow: FLOW,
        filePath: FILE_PATH,
        steps: [evidence],
      }),
      knowledgeRoot,
      runDir: join(root, `canary-replay-${stepIndex}`),
      emit: (outcome) => reader.emitCanaryOutcome(outcome),
    })
    expect(report.procedure).toEqual({ emitted: 1, refused: 0, unresolved: 0 })
  }

  async function drainPositiveProcedureCanary() {
    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir: agentQaRoot,
      author: async () => {
        throw new Error('canary jobs must never reach the Curator author')
      },
      executionContext: 'local-interactive',
      policy,
    })
    expect(report).toMatchObject({ kind: 'drained', committed: 1, failures: 0 })
  }

  it('cold to committed: one drained tail run yields exactly one round-tripping procedure bundle', { timeout: 60_000 }, async () => {
    const finalSubAction = handoffFor('run-loop-shape', 42).tests[0]!.steps[2]!
      .subActions[0]!
    expect(finalSubAction.stateBefore.url).toBe('/login')
    expect(finalSubAction.stateAfter?.url).toBe('/dashboard')

    const warnings = await runTail('run-loop-1', 42)
    expect(warnings).toEqual([])

    const bundles = procedureBundles()
    expect(bundles).toHaveLength(1)
    const bundle = bundles[0]!
    procedureId = bundle.frontmatter.id as RecordId

    const payload = parseProcedureBody(bundle.body)
    expect(payload).toBeDefined()
    expect(payload!.steps).toHaveLength(3)
    expect(payload!.steps.map(({ instruction }) => instruction)).toEqual([
      'Open the sign-in form',
      'Enter the account email',
      'Submit the account password',
    ])
    // Per-step guard descriptors derive from recorded evidence, never from LLM text.
    expect(payload!.steps.map(({ guard }) => guard)).toEqual([
      {
        target: { role: 'button', nameNormalized: 'sign in', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
      {
        target: { role: 'textbox', nameNormalized: 'account email', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
      {
        target: { role: 'textbox', nameNormalized: 'account password', ordinal: 0 },
        pageAnchor: { t: 'page', route: '/login' },
      },
    ])
    // Parameterized values: the proposed email test variable plus exactly one forced secret
    // parameter for the masked password value. CR-03 keeps behavior as literal semantics.
    expect(payload!.steps[1]!.action.values['text']).toEqual({ param: 'accountEmail' })
    expect(payload!.steps[2]!.action.values['text']).toEqual({ param: 'step2_text' })
    expect(payload!.steps[2]!.action.values['clearMode']).toBe('replace')
    expect(payload!.steps[2]!.action.values['submit']).toBe(true)
    expect(payload!.parameters).toEqual([
      { name: 'accountEmail', type: 'string', required: true },
      { name: 'step2_text', type: 'secret', required: true },
    ])
    expect(payload!.parameters.filter(({ type }) => type === 'secret')).toEqual([
      { name: 'step2_text', type: 'secret', required: true },
    ])
    expect(bundle.body).not.toContain('{{env:ACCOUNT_EMAIL}}')
    expect(bundle.body).not.toContain('<SECRET_0>')
  })

  it('hint before trust: getProcedure serves the committed procedure as a hint at zero canary confirmations', { timeout: 60_000 }, async () => {
    await ensureCommittedProcedure()

    const match = getProcedure()
    expect(match?.id).toBe(procedureId)
    const confirmations = confirmationEvents()
    expect(confirmations.creation.curationJobId).toBe(confirmations.creationJobId)
    expect(confirmations.organic).toEqual([])
    // The Add commit carries its authoring evidence for audit, but its effective replay count is
    // zero, so the fresh procedure stays a hint until organic canary outcomes earn replay (D-05).
    expect(match?.replayRecommendation).toBe('hint')
    expect(match?.authoringModelTier).toBe('full')
    expect(match?.parameterSchema).toEqual([
      { name: 'accountEmail', type: 'string', required: true },
      { name: 'step2_text', type: 'secret', required: true },
    ])
  })

  it('earned replay: first organic canary stays hint and the second crosses the full-tier bar', { timeout: 60_000 }, async () => {
    expect(FULL_TIER_REPLAY_CONFIRMATIONS).toBe(2)
    await ensureCommittedProcedure()
    // Self-describing standalone boundary: the bar is crossed by THIS test's two organic
    // canaries and nothing else — identical in ordered and -t filtered execution.
    expect(confirmationEvents().organic).toEqual([])

    emitPositiveProcedureCanary(0)
    await drainPositiveProcedureCanary()

    const afterFirst = getProcedure()
    expect(afterFirst?.id).toBe(procedureId)
    expect(afterFirst?.replayRecommendation).toBe('hint')
    const oneOrganic = confirmationEvents()
    expect(oneOrganic.organic).toHaveLength(1)
    expect(oneOrganic.organic[0]!.curationJobId).not.toBe(oneOrganic.creationJobId)

    emitPositiveProcedureCanary(1)
    await drainPositiveProcedureCanary()

    const afterSecond = getProcedure()
    expect(afterSecond?.id).toBe(procedureId)
    expect(afterSecond?.replayRecommendation).toBe('replay')
    expect(afterSecond?.confidence).toBeGreaterThanOrEqual(0.5)
    const twoOrganic = confirmationEvents()
    expect(twoOrganic.organic).toHaveLength(FULL_TIER_REPLAY_CONFIRMATIONS)
    expect(twoOrganic.organic.every(
      (event) => event.curationJobId !== twoOrganic.creationJobId,
    )).toBe(true)
  })

  it('executes the committed credential procedure through every stored guard (CR-03)', { timeout: 60_000 }, async () => {
    await ensureCommittedProcedure()

    const login = screenState([
      element('e-signin', 'button', 'Sign in'),
      element('e-email', 'textbox', 'Account email', { type: 'email' }),
      element('e-password', 'textbox', 'Account password', { type: 'password' }),
    ], '/login')
    const executed: Action[] = []
    const adapter: PlatformAdapter<'web'> = {
      platform: 'web',
      async setup() {},
      async cleanup() {},
      async observe() {
        return login
      },
      async execute(action) {
        executed.push(action)
        return { success: true }
      },
    }
    let planningCalls = 0
    const planner: Planner = {
      async plan() {
        planningCalls += 1
        throw new Error('guarded replay must not call the planner')
      },
    }
    const inertModel = {} as StepContext['plannerModel']
    const contextFor = (stepInstruction: string): StepContext => ({
      stepInstruction,
      testName: FLOW,
      previousSteps: [],
      plannerModel: inertModel,
      verifierModel: inertModel,
      variables: { accountEmail: 'buyer@example.test' },
    })
    const baseReader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    const committed = procedureBundles()[0]!
    let consults = 0
    // Keep production matching/trust, while the runner-style reader harness returns the exact
    // just-committed body bytes at the read seam used by guarded replay.
    const knowledgeReader = {
      ...baseReader,
      getProcedure(...args: Parameters<typeof baseReader.getProcedure>) {
        consults += 1
        return baseReader.getProcedure(...args)
      },
      read(id: RecordId, options?: Parameters<typeof baseReader.read>[1]) {
        return baseReader.read(id, options) ?? (id === procedureId
          ? {
              id,
              title: committed.summary,
              body: committed.body,
              anchors: committed.frontmatter.anchors.map(({ normalized }) => normalized),
              evidenceDigest: committed.manifest.identityHash,
              relations: [],
            }
          : undefined)
      },
    }
    const secretStore = new SecretStore({ step2_text: 'correct horse battery staple' })
    // D-09 per-step law (F-381-51-1): body steps map 1:1 onto test steps, so CR-03's
    // "through every stored guard" is proven ACROSS three test steps — the member-scoped
    // carry cell threads the cursor, and every body step re-earns dispatch through the
    // full guard ladder on its own step's fresh observation.
    const flowCell: NonNullable<LoopPorts['procedureFlow']> = {}
    const stepPorts = () => ({
      adapter,
      planner,
      knowledgeReader,
      secretStore,
      procedureFlow: flowCell,
    })

    // Replay-recommended is a claim; adapter-observed execution is the CR-03 evidence.
    // Test step 0: the fresh consult earns replay and consumes body step 0 — exactly ONE
    // stored click, a per-step-complete guard fold, and the flow cursor at 0.
    const step0 = await executeStep(
      'sign in and buy at checkout',
      stepPorts(),
      contextFor('sign in and buy at checkout'),
    )
    expect(step0.status).toBe('passed')
    expect(consults).toBe(1)
    expect(executed.map(({ type }) => type)).toEqual(['click'])
    expect(step0.evidence?.subActions).toHaveLength(1)
    expect(step0.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId,
      guard: { checksPassed: 1, total: 1 },
      flow: { cursor: 0, length: 3 },
    })
    // The re-armed carry transports match + payload + cursor only — never a resolved ref.
    expect(flowCell.carry?.nextIndex).toBe(1)
    expect(flowCell.carry?.payload.steps).toHaveLength(3)

    // Test step 1: the carry substitutes the consult (still exactly one matcher call) and
    // body step 1 re-grounds its email-field guard on this step's own fresh screen.
    const step1 = await executeStep(
      'Enter the account email',
      stepPorts(),
      contextFor('Enter the account email'),
    )
    expect(step1.status).toBe('passed')
    expect(consults).toBe(1)
    expect(executed.map(({ type }) => type)).toEqual(['click', 'fill'])
    expect(executed.at(-1)).toMatchObject({ type: 'fill', text: 'buyer@example.test' })
    expect(step1.evidence?.subActions).toHaveLength(1)
    expect(step1.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId,
      guard: { checksPassed: 1, total: 1 },
      flow: { cursor: 1, length: 3 },
    })
    expect(flowCell.carry?.nextIndex).toBe(2)

    // Test step 2: the carried final body step submits the credential. CR-03 keeps the
    // stored clearMode/submit behavior literal and the secret resolves only at the execute
    // boundary; body exhaustion leaves no carry.
    const step2 = await executeStep(
      'Submit the account password',
      stepPorts(),
      contextFor('Submit the account password'),
    )
    expect(step2.status).toBe('passed')
    expect(planningCalls).toBe(0)
    expect(executed.map(({ type }) => type)).toEqual(['click', 'fill', 'fill'])
    expect(executed.at(-1)).toMatchObject({
      type: 'fill',
      text: 'correct horse battery staple',
      clearMode: 'replace',
      submit: true,
    })
    expect(step2.evidence?.subActions).toHaveLength(1)
    expect(step2.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId,
      guard: { checksPassed: 1, total: 1 },
      flow: { cursor: 2, length: 3 },
    })
    expect(flowCell.carry).toBeUndefined()
  })

  it('a replay rejected by the verifier is never certified by live recovery', { timeout: 60_000 }, async () => {
    await ensureCommittedProcedure()

    const login = screenState([
      element('e-signin', 'button', 'Sign in'),
      element('e-email', 'textbox', 'Account email', { type: 'email' }),
      element('e-password', 'textbox', 'Account password', { type: 'password' }),
    ], '/login')
    const executed: Action[] = []
    const adapter: PlatformAdapter<'web'> = {
      platform: 'web',
      async setup() {},
      async cleanup() {},
      async observe() {
        return login
      },
      async execute(action) {
        executed.push(action)
        return { success: true }
      },
    }
    let planningCalls = 0
    const planner: Planner = {
      async plan() {
        planningCalls += 1
        return {
          plan: {
            reasoning: 'Recover live after the stored sign-in action was rejected',
            action: { type: 'click', ref: asRef('e-signin') },
            confidence: 0.95,
            stepComplete: true,
            stepFailed: false,
          },
        }
      },
    }
    let verificationCalls = 0
    const verifier = {
      async verify() {
        verificationCalls += 1
        return verificationCalls === 1
          ? {
              verification: {
                success: false,
                reasoning: 'The stored sign-in action did not complete the flow',
                isAppError: false,
              },
            }
          : {
              verification: {
                success: true,
                reasoning: 'Live recovery completed the flow',
                isAppError: false,
              },
            }
      },
    }
    const inertModel = {} as StepContext['plannerModel']
    const context: StepContext = {
      stepInstruction: 'sign in and buy at checkout',
      testName: FLOW,
      previousSteps: [],
      plannerModel: inertModel,
      verifierModel: inertModel,
      variables: { accountEmail: 'buyer@example.test' },
    }
    const baseReader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    const committed = procedureBundles()[0]!
    const knowledgeReader = {
      ...baseReader,
      read(id: RecordId, options?: Parameters<typeof baseReader.read>[1]) {
        return baseReader.read(id, options) ?? (id === procedureId
          ? {
              id,
              title: committed.summary,
              body: committed.body,
              anchors: committed.frontmatter.anchors.map(({ normalized }) => normalized),
              evidenceDigest: committed.manifest.identityHash,
              relations: [],
            }
          : undefined)
      },
    }
    const flowCell: NonNullable<LoopPorts['procedureFlow']> = {}

    // Under the D-09 per-step law each replayed body step completes its own test step, so
    // the FIRST verify call verifies body step 0 — the stored sign-in click — and the
    // scripted first rejection lands at its proper per-step site, procedure step 0.
    const result = await executeStep(
      context.stepInstruction,
      {
        adapter,
        planner,
        verifier,
        knowledgeReader,
        secretStore: new SecretStore({ step2_text: 'correct horse battery staple' }),
        procedureFlow: flowCell,
      },
      context,
    )

    expect(result.status).toBe('passed')
    expect(result.evidence).toBeDefined()
    // The rejection aborts replay one-shot (D-11): ONE live recovery turn completes the
    // step, and the stored fills (body steps 1-2) never dispatch anywhere — neither within
    // this step (no replay re-entry) nor after it (the carry cell was never re-armed, so
    // no later step can resume the body).
    expect(planningCalls).toBe(1)
    expect(verificationCalls).toBe(2)
    expect(executed.map(({ type }) => type)).toEqual(['click', 'click'])
    expect(executed.filter(({ type }) => type === 'fill')).toEqual([])
    expect(result.evidence?.subActions).toHaveLength(2)
    expect(flowCell.carry).toBeUndefined()
    // Never certified: the per-step guard fold keeps the verifierRejection marker — the
    // live recovery's accepted PASS cannot rewrite the planSource into a clean replay fold.
    expect(result.evidence?.planSource).toEqual({
      kind: 'procedure-replay',
      procedureId,
      guard: {
        checksPassed: 1,
        total: 1,
        verifierRejection: { procedureStepIndex: 0 },
      },
      flow: { cursor: 0, length: 3 },
    })

    const emitted: CanaryOutcome[] = []
    const report = emitCanaryOutcomes({
      handoff: handoffWithSteps({
        runId: 'run-loop-verifier-rejection',
        buildOrdinal: 43,
        flow: FLOW,
        filePath: FILE_PATH,
        steps: [result.evidence!],
      }),
      knowledgeRoot,
      runDir: join(root, 'verifier-rejection-run'),
      emit: (outcome) => emitted.push(outcome),
    })
    const procedureOutcomes = emitted.filter(({ candidateId }) => candidateId === procedureId)

    expect(procedureOutcomes.filter(({ runOutcome }) => runOutcome === 'positive')).toEqual([])
    expect(procedureOutcomes).toEqual([
      expect.objectContaining({ candidateId: procedureId, runOutcome: 'negative' }),
    ])
    expect(procedureOutcomes[0]!.attribution).toContain(
      'verifier rejection at procedure step 0',
    )
    expect(report.procedure).toEqual({ emitted: 1, refused: 0, unresolved: 0 })
  })

  it('structural dedup: re-draining the same flow disposes as Confirm — no second bundle (D-01)', { timeout: 60_000 }, async () => {
    await ensureCommittedProcedure()

    const confirmedBefore = deriveBundleTrust(procedureBundles()[0]!).counters.confirmed

    const warnings = await runTail('run-loop-2', 43)
    expect(warnings).toEqual([])

    const bundles = procedureBundles()
    expect(bundles).toHaveLength(1)
    expect(bundles[0]!.frontmatter.id).toBe(procedureId)
    expect(deriveBundleTrust(bundles[0]!).counters.confirmed).toBe(confirmedBefore + 1)
  })

  it('4th channel: the authoring brief serves the procedure and the source test as an exemplar', { timeout: 60_000 }, async () => {
    await ensureCommittedProcedure()

    const authoringReader = createAuthoringReader({ knowledgeRoot, product: PRODUCT })
    const brief = await authoringReader.getAuthoringBrief(
      `flow:${FLOW} /login sign in and buy`,
      SCOPE,
    )

    expect(brief.procedures.map(({ id }) => id)).toContain(procedureId)
    // The tail-folded run-outcome projection surfaces the source test by reference (D-15),
    // verified outcomes and all — never test file content.
    const exemplar = brief.exemplars.find(
      ({ filePath, testName }) => filePath === FILE_PATH && testName === FLOW,
    )
    expect(exemplar).toBeDefined()
    expect(exemplar!.unverifiedOutcomes).toBe(false)
    expect(exemplar!.recentOutcomes?.length).toBeGreaterThan(0)
    expect(exemplar!.recentOutcomes?.every(({ passed }) => passed)).toBe(true)
  })

  it('commits a repeated first/third instruction through ordinal-window disposition', { timeout: 60_000 }, async () => {
    const repeatedFlow = 'checkout::repeated-next'
    const instructions = ['Click Next', 'Enter shipping address', 'Click Next']
    const fixture = await runIsolatedProcedureFixture({
      name: 'repeated-instruction',
      handoff: handoffWithSteps({
        runId: 'run-loop-repeated-instruction',
        buildOrdinal: 44,
        flow: repeatedFlow,
        filePath: 'tests/checkout/repeated-next.test.ts',
        steps: [
          step(
            0,
            instructions[0]!,
            { type: 'click', ref: asRef('e-next-start') },
            [element('e-next-start', 'button', 'Next')],
          ),
          step(
            1,
            instructions[1]!,
            {
              type: 'fill',
              ref: asRef('e-shipping-address'),
              text: '42 Test Lane',
              clearMode: 'replace',
              submit: false,
            },
            [element('e-shipping-address', 'textbox', 'Shipping address')],
          ),
          step(
            2,
            instructions[2]!,
            { type: 'click', ref: asRef('e-next-finish') },
            [element('e-next-finish', 'button', 'Next')],
          ),
        ],
      }),
      proposal: JSON.stringify({
        candidates: [
          {
            flowName: repeatedFlow,
            stepSpan: [0, 2],
            parameters: [],
            successAssertion: 'The shipping flow advances',
          },
        ],
      }),
    })

    // Integration proof for Plans 381-15 + 381-17: repeated text is resolved by ordinal window,
    // never disposed as the former globally-ambiguous procedure-step-coverage Noop.
    expect(fixture.warnings).toEqual([])
    expect(fixture.commitOutcomes).not.toContainEqual({
      kind: 'noop',
      reason: 'procedure-step-coverage',
    })
    expect(fixture.bundles).toHaveLength(1)
    const payload = parseProcedureBody(fixture.bundles[0]!.body)
    expect(payload?.steps.map(({ instruction }) => instruction)).toEqual(instructions)
  })

  it('round-trips a completing fill submit boolean through the committed record', { timeout: 60_000 }, async () => {
    const fixture = await runIsolatedProcedureFixture({
      name: 'scalar-round-trip',
      handoff: handoffFor('run-loop-scalar-round-trip', 45),
      proposal: wholeFlowProposal,
    })

    // Integration proof for Plans 381-14 + 381-17: the scalar keeps its JSON type through
    // emit -> author -> disposition -> commit -> record.md -> parseProcedureBody.
    expect(fixture.warnings).toEqual([])
    expect(fixture.bundles).toHaveLength(1)
    const payload = parseProcedureBody(fixture.bundles[0]!.body)
    expect(payload?.steps[2]?.action.values['submit']).toBe(true)
  })

  it('round-trips file lists and relative positions through the committed record', { timeout: 60_000 }, async () => {
    const compositeFlow = 'checkout::composite-actions'
    const fixture = await runIsolatedProcedureFixture({
      name: 'composite-round-trip',
      handoff: handoffWithSteps({
        runId: 'run-loop-composite-round-trip',
        buildOrdinal: 46,
        flow: compositeFlow,
        filePath: 'tests/checkout/composite-actions.test.ts',
        steps: [
          step(
            0,
            'Upload the checkout documents',
            {
              type: 'fileUpload',
              ref: asRef('e-upload'),
              files: ['a.png', 'b.pdf'],
            },
            [element('e-upload', 'button', 'Upload files')],
          ),
          step(
            1,
            'Open the document menu',
            {
              type: 'doubleClick',
              ref: asRef('e-document-menu'),
              relativePosition: { x: 5, y: 7 },
            },
            [element('e-document-menu', 'button', 'Document menu')],
          ),
        ],
      }),
      proposal: JSON.stringify({
        candidates: [
          {
            flowName: compositeFlow,
            stepSpan: [0, 1],
            parameters: [],
            successAssertion: 'The document menu opens',
          },
        ],
      }),
    })

    // CR-01 integration proof: Tasks 1-2 pin the codec and write-side unit halves; this
    // traverses the real emit -> author -> disposition -> commit -> record.md pipe.
    expect(fixture.warnings).toEqual([])
    expect(fixture.commitOutcomes).not.toContainEqual({
      kind: 'noop',
      reason: 'procedure-param-undeclared',
    })
    expect(fixture.bundles).toHaveLength(1)
    const payload = parseProcedureBody(fixture.bundles[0]!.body)
    expect(payload?.steps[0]?.action.values['files']).toEqual({
      json: ['a.png', 'b.pdf'],
    })
    expect(payload?.steps[1]?.action.values['relativePosition']).toEqual({
      json: { x: 5, y: 7 },
    })
  })
})
