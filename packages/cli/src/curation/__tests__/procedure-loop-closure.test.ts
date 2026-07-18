import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  deriveBundleTrust,
  drainQueue,
  enumerateBundleDirs,
  loadBundle,
  createAuthoringReader,
  openKnowledgeReader,
  type CuratorAuthor,
  type LoadedBundle,
} from '@vostride/agent-qa-knowledge-local'
import { createModel } from '@vostride/agent-qa-model'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
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
  type Action,
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
  return {
    ref: asRef(ref),
    role,
    name,
    nameNormalized: name.toLowerCase(),
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
    refMap: {},
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

function subAction(action: Action, elements: ElementInfo[], url: string): SubActionEvidence {
  return {
    plan: 'planned by the loop-closure fixture',
    plannedAction: action,
    stateBefore: screenState(elements, url),
    result: { success: true },
  }
}

function step(
  stepIndex: number,
  stepText: string,
  action: Action,
  elements: ElementInfo[],
  cacheStatus: StepEvidence['cacheStatus'] = 'miss',
): StepEvidence {
  return {
    stepIndex,
    stepText,
    cacheStatus,
    servedBrief: servedBrief(),
    subActions: [subAction(action, elements, '/login')],
    verifierVerdict: { pass: true, reasoning: 'verified by the loop-closure fixture' },
  }
}

/**
 * A verified-PASS 3-step trajectory with masked-before-record values: the email arrives as a
 * masked placeholder and the password as a masked secret on a cache-bypass step, so D-03's
 * forced parameterization has real evidence to key on.
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
              text: '<EMAIL_0>',
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
          ),
        ],
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

  function getProcedure(): ProcedureMatch | undefined {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    return reader.getProcedure(
      'sign in and buy at checkout',
      screenState([], '/login'),
      // D-08: binding NAMES only — no value of any binding ever reaches the matcher. Every
      // required name of the served parameterSchema is bound, the way replay callers do:
      // the receipt-driven D-03 posture also force-parameterizes the clearMode slot because
      // it targets the masked password region.
      ['accountEmail', 'step2_clearMode', 'step2_text'],
    )
  }

  it('cold to committed: one drained tail run yields exactly one round-tripping procedure bundle', { timeout: 60_000 }, async () => {
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
    // Parameterized values: the proposed email param (secret-escalated by the masked slot)
    // plus the forced parameterization of the masked password step the proposal missed —
    // including its clearMode companion slot, which targets the masked region (D-03).
    expect(payload!.steps[1]!.action.values['text']).toEqual({ param: 'accountEmail' })
    expect(payload!.steps[2]!.action.values['text']).toEqual({ param: 'step2_text' })
    expect(payload!.steps[2]!.action.values['clearMode']).toEqual({ param: 'step2_clearMode' })
    expect(payload!.parameters).toHaveLength(3)
    expect(payload!.parameters).toEqual(
      expect.arrayContaining([
        { name: 'accountEmail', type: 'secret', required: true },
        { name: 'step2_clearMode', type: 'secret', required: true },
        { name: 'step2_text', type: 'secret', required: true },
      ]),
    )
    expect(bundle.body).not.toContain('<EMAIL_0>')
    expect(bundle.body).not.toContain('<SECRET_0>')
  })

  it('hint before trust: getProcedure serves the committed procedure as a hint at zero canary confirmations', () => {
    const match = getProcedure()
    expect(match?.id).toBe(procedureId)
    // The Add commit carries only its own attributing evidence — below the full-tier replay
    // bar, so the fresh procedure serves as a hint until canary outcomes earn replay (D-05).
    expect(match?.replayRecommendation).toBe('hint')
    expect(match?.authoringModelTier).toBe('full')
    expect(match?.parameterSchema).toEqual(
      expect.arrayContaining([
        { name: 'accountEmail', type: 'secret', required: true },
        { name: 'step2_clearMode', type: 'secret', required: true },
        { name: 'step2_text', type: 'secret', required: true },
      ]),
    )
  })

  it('earned replay: the full-tier bar of drained positive canary outcomes flips hint to replay', { timeout: 60_000 }, async () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    for (let stepIndex = 0; stepIndex < FULL_TIER_REPLAY_CONFIRMATIONS; stepIndex += 1) {
      reader.emitCanaryOutcome({
        candidateId: procedureId,
        runOutcome: 'positive',
        runId: 'run-canary-replays',
        testId: FLOW,
        testIndex: 0,
        buildOrdinal: 42,
        stepIndex,
        briefDigest: `brief-digest-replay-${stepIndex}`,
        attribution: `Procedure ${procedureId} replayed on passing step ${stepIndex}`,
        exercisedAnchor: normalizeAnchor({ t: 'flow', name: FLOW }),
      })
    }

    const report = await drainQueue({
      knowledgeRoot,
      auditBaseDir: agentQaRoot,
      author: async () => {
        throw new Error('canary jobs must never reach the Curator author')
      },
      executionContext: 'local-interactive',
      policy,
    })
    expect(report).toMatchObject({
      kind: 'drained',
      committed: FULL_TIER_REPLAY_CONFIRMATIONS,
      failures: 0,
    })

    const match = getProcedure()
    expect(match?.id).toBe(procedureId)
    expect(match?.replayRecommendation).toBe('replay')
    expect(match?.confidence).toBeGreaterThanOrEqual(0.5)
  })

  it('structural dedup: re-draining the same flow disposes as Confirm — no second bundle (D-01)', { timeout: 60_000 }, async () => {
    const confirmedBefore = deriveBundleTrust(procedureBundles()[0]!).counters.confirmed

    const warnings = await runTail('run-loop-2', 43)
    expect(warnings).toEqual([])

    const bundles = procedureBundles()
    expect(bundles).toHaveLength(1)
    expect(bundles[0]!.frontmatter.id).toBe(procedureId)
    expect(deriveBundleTrust(bundles[0]!).counters.confirmed).toBe(confirmedBefore + 1)
  })

  it('4th channel: the authoring brief serves the procedure and the source test as an exemplar', async () => {
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
})
