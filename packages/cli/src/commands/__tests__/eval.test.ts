// Phase 372-05 — the eval command family's first verb: extract (D-01), sweep-by-default with the
// D-02 filter vocabulary, typed per-run skips (never batch errors), D-04 DTO-faithful rendering,
// and D-08 exit semantics. Task 1 pins runExtractVerb; Task 2 pins the commander wiring.
// Phase 372-06 adds the replay verb: sweep staged cassette bundles through runCassetteReplay with
// the session's seeded masking factory (D-06), the D-03 judge bag, typed refusal counters, and
// the deterministic batchKey audit dir (D-07).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { computeBatchKey } from '@vostride/agent-qa-eval'
import type { createModel, ModelProviderOverrides } from '@vostride/agent-qa-model'
import {
  FsEvidenceArtifactStore,
  FsHandoffStore,
  HANDOFF_FILE,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  asRef,
  asRunId,
  computeBriefDigest,
} from '@vostride/agent-qa-schema'
import type {
  ArtifactRef,
  CompletedRunHandoff,
  ScopeKey,
  ScreenState,
  ServedBrief,
  StepEvidence,
} from '@vostride/agent-qa-schema'
import { committedCassettePath, committedLabelPath } from '@vostride/agent-qa-eval-local'
import {
  EvalNamedInputError,
  resolveEvalSession,
  runExtractVerb,
  runReplayVerb,
  runSeedVerb,
} from '../../eval-session-composition.js'
import type {
  EvalSession,
  ExtractVerbResult,
  ReplayVerbResult,
} from '../../eval-session-composition.js'
import { createEvalCommand } from '../eval.js'

const BLOB_BYTES = Uint8Array.from(Buffer.from('agent-qa eval extract fixture blob\n', 'utf8'))
const SUITE_SCOPE: ScopeKey = { tier: 'suite', key: 'eval-cli' }

let tmpRoot: string
let savedXdgDataHome: string | undefined
let savedExitCode: number | string | undefined

const CONFIG_YAML = [
  'workspace:',
  '  testMatch: ["tests/**/*.yaml"]',
  '  suiteMatch: ["suites/**/*.suite.yaml"]',
  '  hooksFile: hooks.yaml',
  '  agentRules: ./agent-rules.md',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'registry:',
  '  llms:',
  '    - name: planner',
  '      provider: openai-compatible',
  '      model: gpt-4o',
  '      baseURL: https://api.openai.com/v1',
  'use:',
  '  mobile:',
  '    appState: preserve',
  '  llm: planner',
  '',
].join('\n')

async function writeFixture(): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpRoot, 'fixture-'))
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, CONFIG_YAML)
  await writeFile(join(dir, '.env.secrets.local'), '')
  return { dir, configPath }
}

function emptyBrief(scope: ScopeKey): ServedBrief {
  const unstamped: ServedBrief = {
    scope,
    asOfBuild: 11,
    budget: 0,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...unstamped, briefDigest: computeBriefDigest(unstamped) }
}

const buttonRef = asRef('e-continue')

function screenState(timestamp: number): ScreenState {
  const bounds = { x: 24, y: 32, width: 160, height: 44 }
  const center = { x: 104, y: 54 }
  return {
    platform: 'web',
    tree: 'button Continue',
    elements: [
      {
        ref: buttonRef,
        role: 'button',
        name: 'Continue',
        nameNormalized: 'continue',
        bounds,
        center,
        state: { enabled: true, focused: false, visible: true, clickable: true },
        labels: { ariaLabel: 'Continue' },
        attributes: { 'data-fixture': 'continue' },
      },
    ],
    refMap: {
      [buttonRef]: { bounds, center, scrollContext: { offsetX: 0, offsetY: 0 } },
    } as ScreenState['refMap'],
    url: 'https://example.test/checkout',
    timestamp,
    metadata: {
      captureMode: 'full',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      imageWidth: 1_280,
      imageHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 720 },
    },
  }
}

function step(input: {
  stepIndex: number
  scope: ScopeKey
  live: boolean
  screenshotRef?: ArtifactRef
  stepText?: string
}): StepEvidence {
  return {
    stepIndex: input.stepIndex,
    stepText: input.stepText ?? (input.live ? 'Click Continue' : 'Replay Continue from cache'),
    cacheStatus: input.live ? 'miss' : 'hit',
    servedBrief: emptyBrief(input.scope),
    modelProfile: {
      provider: 'openai-compatible',
      modelId: 'eval-cli-fixture-planner',
      vision: true,
      maxOutputTokens: 512,
      sampling: { temperature: 0 },
    },
    toolSchemaDigest: 'c'.repeat(64),
    subActions: [
      {
        plan: input.live ? 'Use the recorded Continue button' : 'Use the cached Continue decision',
        plannedAction: { type: 'click', ref: buttonRef },
        stateBefore: screenState(1_725_000_000_100 + input.stepIndex),
        result: {
          success: true,
          annotation: {
            kind: 'point',
            viewport: { width: 1_280, height: 720 },
            point: { x: 104, y: 54, boundingBox: { x: 24, y: 32, width: 160, height: 44 } },
          },
        },
        ...(input.live
          ? {
              exchanges: [],
              ...(input.screenshotRef ? { decisionScreenshotRef: input.screenshotRef } : {}),
              callRecord: {
                resolvedModelId: 'eval-cli-fixture-planner-2026-07-10',
                fingerprint: 'fp_eval_cli_fixture',
                effectiveMaxOutputTokens: 512,
                effectiveSampling: { temperature: 0 },
              },
            }
          : {}),
      },
    ],
    verifierVerdict: { pass: true, reasoning: 'The recorded state advanced' },
    verifierIdentity: { provider: 'openai-compatible', modelId: 'eval-cli-fixture-verifier' },
  }
}

function buildHandoff(input: {
  runId: string
  scope?: ScopeKey
  screenshotRef: ArtifactRef
  withCachedStep?: boolean
  schemaVersion?: number
  stepText?: string
}): CompletedRunHandoff {
  const scope = input.scope ?? SUITE_SCOPE
  const steps = [
    step({
      stepIndex: 0,
      scope,
      live: true,
      screenshotRef: input.screenshotRef,
      ...(input.stepText === undefined ? {} : { stepText: input.stepText }),
    }),
    ...(input.withCachedStep ? [step({ stepIndex: 1, scope, live: false })] : []),
  ]
  return {
    schemaVersion: input.schemaVersion ?? CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(input.runId),
    scope,
    buildOrdinal: 11,
    executionContext: 'ci',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'd'.repeat(64), testConfigDigest: 'e'.repeat(64) },
    startedAt: 1_725_000_000_000,
    endedAt: 1_725_000_001_000,
    tests: [
      {
        testId: 'eval-cli::extract-fixture',
        testIndex: 0,
        outcome: 'passed',
        steps,
      },
    ],
  }
}

/** Persist the fixture blob + a valid v2 handoff into `<dir>/.agent-qa/runs/<slug(runId)>/`. */
function saveRun(
  dir: string,
  runId: string,
  options: { scope?: ScopeKey; withCachedStep?: boolean; stepText?: string } = {},
): void {
  const root = join(dir, '.agent-qa')
  const ref = new FsEvidenceArtifactStore({ root, runId }).persistDecisionScreenshot(BLOB_BYTES)
  new FsHandoffStore({ root, runId }).save(
    buildHandoff({ runId, screenshotRef: ref, ...options }),
  )
}

async function sessionFor(configPath: string): Promise<EvalSession> {
  return resolveEvalSession({ configPath })
}

/** Recursive file-name → content-sha snapshot of the staged cassettes root. */
async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  let entries: string[]
  try {
    entries = (await readdir(root, { recursive: true })) as string[]
  } catch {
    return snapshot
  }
  for (const entry of entries) {
    try {
      const bytes = await readFile(join(root, entry))
      snapshot[entry] = createHash('sha256').update(bytes).digest('hex')
    } catch {
      // directories
    }
  }
  return snapshot
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'agent-qa-eval-cli-'))
  savedXdgDataHome = process.env.XDG_DATA_HOME
  savedExitCode = process.exitCode ?? undefined
  // Point the auth store at an empty temp location so nothing reads the host auth store.
  process.env.XDG_DATA_HOME = join(tmpRoot, 'xdg-data')
})

afterEach(async () => {
  if (savedXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = savedXdgDataHome
  process.exitCode = savedExitCode
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('runExtractVerb — sweep-by-default over the sanctioned engines (D-01/D-02)', () => {
  it('sweeps every recorded handoff and writes staged cassette bundles with faithful counters', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    saveRun(dir, 'run-beta', { withCachedStep: true })

    const result = await runExtractVerb(await sessionFor(configPath))

    expect(result.runsSwept).toBe(2)
    expect(result.runsSkipped).toEqual([])
    expect(result.runsFiltered).toBe(0)
    // Each run stages one leaf + one procedure cassette; run-beta's cached step is a
    // selection skip counted by the engine's report, never re-derived by the CLI (D-04).
    expect(result.cassettesWritten).toBe(4)
    expect(result.completeness).toEqual({ complete: 4, 'cache-hit': 1 })
    expect(result.cassettesRoot).toBe(resolve(dir, '.agent-qa', 'eval', 'cassettes'))

    const staged = await snapshotTree(result.cassettesRoot)
    const cassetteFiles = Object.keys(staged).filter(name => name.endsWith('cassette.json'))
    expect(cassetteFiles).toHaveLength(4)
  })

  it('surfaces unreadable and pre-366 handoffs as typed skips, never batch errors (D-02)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    saveRun(dir, 'run-beta')

    const corruptDir = join(dir, '.agent-qa', RUNS_SUBDIR, slugBranch('run-corrupt'))
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, HANDOFF_FILE), 'not json at all')

    const preInstrumentationDir = join(dir, '.agent-qa', RUNS_SUBDIR, slugBranch('run-old'))
    await mkdir(preInstrumentationDir, { recursive: true })
    await writeFile(
      join(preInstrumentationDir, HANDOFF_FILE),
      JSON.stringify({ schemaVersion: 1, runId: 'run-old' }),
    )

    const result = await runExtractVerb(await sessionFor(configPath))

    expect(result.runsSwept).toBe(4)
    expect(result.runsSkipped).toHaveLength(2)
    const skippedSlugs = result.runsSkipped.map(skip => skip.runSlug).sort()
    expect(skippedSlugs).toEqual([slugBranch('run-corrupt'), slugBranch('run-old')].sort())
    for (const skip of result.runsSkipped) {
      expect(skip.reason).toBeTruthy()
    }
    const oldSkip = result.runsSkipped.find(skip => skip.runSlug === slugBranch('run-old'))
    expect(oldSkip?.reason).toContain('schemaVersion')
    // The other runs still extracted — never a batch abort.
    expect(result.cassettesWritten).toBe(4)
  })

  it('narrows to --run and throws the typed named-input error for a missing slug (D-08)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    saveRun(dir, 'run-beta')
    const session = await sessionFor(configPath)

    const narrowed = await runExtractVerb(session, { run: slugBranch('run-alpha') })
    expect(narrowed.runsSwept).toBe(1)
    expect(narrowed.cassettesWritten).toBe(2)

    const missing = runExtractVerb(session, { run: 'no-such-run' })
    await expect(missing).rejects.toBeInstanceOf(EvalNamedInputError)
    await expect(runExtractVerb(session, { run: 'no-such-run' })).rejects.toThrow(/no-such-run/)
    await expect(runExtractVerb(session, { run: 'no-such-run' })).rejects.toThrow(
      new RegExp(RUNS_SUBDIR),
    )
  })

  it('counts product-scope mismatches as filtered, not extracted (D-02)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-shop', { scope: { tier: 'product', key: 'shop' } })
    saveRun(dir, 'run-suite-scoped')

    const result = await runExtractVerb(await sessionFor(configPath), { product: 'shop' })

    expect(result.runsSwept).toBe(2)
    expect(result.runsFiltered).toBe(1)
    expect(result.runsSkipped).toEqual([])
    expect(result.cassettesWritten).toBe(2)
    expect(result.completeness).toEqual({ complete: 2 })
  })

  it('re-sweeps idempotently — identical DTO and identical staged bytes (D-02)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    saveRun(dir, 'run-beta', { withCachedStep: true })
    const session = await sessionFor(configPath)

    const first: ExtractVerbResult = await runExtractVerb(session)
    const firstTree = await snapshotTree(first.cassettesRoot)

    const second = await runExtractVerb(session)
    expect(second).toEqual(first)
    expect(await snapshotTree(second.cassettesRoot)).toEqual(firstTree)
  })
})

// ---- 372-06 Task 1: runReplayVerb — sweep, seeded masking, judge bag (D-02/D-06/D-08) ---------

/** The config-registry model id the captured-boundary stub keys off (createModel passthrough). */
const REPLAY_STUB_MODEL_ID = 'replay-cli-stub'

// A registered fake secret embedded in recorded step text — long enough for the ≥4-char register
// guard, shaped to trip NO guardrail detector (no Bearer prefix, no email).
const FAKE_REPLAY_SECRET = 'raw-fake-replay-secret-9001'

const REPLAY_CONFIG_YAML = [
  'workspace:',
  '  testMatch: ["tests/**/*.yaml"]',
  '  suiteMatch: ["suites/**/*.suite.yaml"]',
  '  hooksFile: hooks.yaml',
  '  agentRules: ./agent-rules.md',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'registry:',
  '  llms:',
  '    - name: planner',
  '      provider: openai-compatible',
  `      model: ${REPLAY_STUB_MODEL_ID}`,
  '      baseURL: http://localhost:9999/v1',
  'use:',
  '  mobile:',
  '    appState: preserve',
  '  llm: planner',
  '',
].join('\n')

async function writeReplayFixture(
  secretsContent = '',
): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpRoot, 'replay-fixture-'))
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, REPLAY_CONFIG_YAML)
  await writeFile(join(dir, '.env.secrets.local'), secretsContent)
  return { dir, configPath }
}

type StubLanguageModel = ReturnType<typeof createModel>
type CapturedCallOptions = Parameters<StubLanguageModel['doGenerate']>[0]
type StubGenerateResult = Awaited<ReturnType<StubLanguageModel['doGenerate']>>

/** A grounded web_click tool-call on the recorded ref — a full-match replay decision. */
function clickGenerateResult(): StubGenerateResult {
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId: 'replay-action',
        toolName: 'web_click',
        input: JSON.stringify({
          ref: 'e-continue',
          reasoning: 'Click the recorded Continue button',
          confidence: 0.95,
          stepComplete: true,
          doesActionAdvanceUsTowardsGoal: true,
        }),
      },
    ],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 2, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

/**
 * The captured-boundary stub seam (the replay-composition test recipe): a scripted language model
 * injected through createModel's overrides so every doGenerate params object is captured POST the
 * pinned-last mask/guardrail middleware — the exact provider boundary.
 */
function replayStub(): { captured: CapturedCallOptions[]; overrides: ModelProviderOverrides } {
  const captured: CapturedCallOptions[] = []
  const stub: StubLanguageModel = {
    specificationVersion: 'v3',
    provider: 'replay-cli-stub-provider',
    modelId: REPLAY_STUB_MODEL_ID,
    supportedUrls: {},
    async doGenerate(params) {
      captured.push(params)
      return clickGenerateResult()
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
  return { captured, overrides: { languageModels: { [REPLAY_STUB_MODEL_ID]: stub } } }
}

/** Read every staged cassette id back from the bundle documents, sorted. */
async function stagedCassetteIds(dir: string): Promise<string[]> {
  const root = join(dir, '.agent-qa', 'eval', 'cassettes')
  const entries = (await readdir(root, { recursive: true })) as string[]
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('cassette.json')) continue
    const document = JSON.parse(await readFile(join(root, entry), 'utf-8')) as { id: string }
    ids.push(document.id)
  }
  return ids.sort()
}

/** The slugged replay-record dir FsReplayRecordStore derives for one cassette id. */
function replayDirFor(dir: string, id: string): string {
  return join(dir, '.agent-qa', 'eval', 'replays', ...id.split('/').map(segment => slugBranch(segment)))
}

describe('runReplayVerb — offline sweep through the sanctioned composition (D-02/D-06/D-08)', () => {
  it('replays every staged bundle, persists replay.json + score.json, and stamps the deterministic batchKey', async () => {
    const { dir, configPath } = await writeReplayFixture()
    saveRun(dir, 'run-alpha')
    const session = await sessionFor(configPath)
    await runExtractVerb(session)
    const ids = await stagedCassetteIds(dir)
    expect(ids).toHaveLength(2)

    const stub = replayStub()
    const result = await runReplayVerb(session, {}, { plannerOverrides: stub.overrides })

    expect(result.swept).toBe(2)
    expect(result.replayed).toBe(2)
    expect(result.loadRefusals).toEqual({})
    expect(result.replayRefusals).toEqual({})
    expect(result.batchKey).toBe(computeBatchKey(ids))
    expect(result.scored).toBe(2)
    expect(result.replaysRoot).toBe(join(dir, '.agent-qa', 'eval', 'replays'))
    for (const id of ids) {
      expect(existsSync(join(replayDirFor(dir, id), 'replay.json'))).toBe(true)
      expect(existsSync(join(replayDirFor(dir, id), 'score.json'))).toBe(true)
    }

    // Idempotent re-run over the same staging: the record store recreates dirs, the score store
    // writes file-scoped — a second sweep is green with the same counters (Pitfall 5).
    const second = await runReplayVerb(session, {}, { plannerOverrides: replayStub().overrides })
    expect(second.replayed).toBe(2)
    expect(second.scored).toBe(2)
    expect(second.batchKey).toBe(result.batchKey)
  })

  it('threads the session-seeded masking factory: a secrets-file value crosses the boundary as a placeholder (D-06)', async () => {
    const { dir, configPath } = await writeReplayFixture(`EVAL_FIXTURE_TOKEN=${FAKE_REPLAY_SECRET}\n`)
    saveRun(dir, 'run-secret', {
      stepText: `Use the token ${FAKE_REPLAY_SECRET} then click Continue`,
    })
    const session = await sessionFor(configPath)
    await runExtractVerb(session)

    const stub = replayStub()
    const result = await runReplayVerb(session, {}, { plannerOverrides: stub.overrides })

    expect(result.replayed).toBe(2)
    expect(stub.captured.length).toBeGreaterThan(0)
    // Captured POST the pinned-last mask middleware: the secrets-file value reaches the provider
    // boundary as a <SECRET_n> placeholder, never as raw bytes — end-to-end proof the CLI passes
    // the 372-01 seam into runCassetteReplay.
    const boundaryPayload = JSON.stringify(stub.captured)
    expect(boundaryPayload).toContain('<SECRET_')
    expect(boundaryPayload).not.toContain(FAKE_REPLAY_SECRET)
  })

  it('folds a corrupt bundle into loadRefusals by reason and still replays the rest (D-08)', async () => {
    const { dir, configPath } = await writeReplayFixture()
    saveRun(dir, 'run-alpha')
    const session = await sessionFor(configPath)
    await runExtractVerb(session)

    const corruptDir = join(dir, '.agent-qa', 'eval', 'cassettes', 'corrupt-bundle')
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, 'cassette.json'), 'not json at all')

    const result = await runReplayVerb(session, {}, { plannerOverrides: replayStub().overrides })

    // The refusal is data (never a batch abort): the corrupt dir entered the sweep and folded
    // into loadRefusals by reason while both valid cassettes replayed normally.
    expect(result.swept).toBe(3)
    expect(result.loadRefusals).toEqual({ 'parse-failed': 1 })
    expect(result.replayed).toBe(2)
    expect(result.scored).toBe(2)
  })

  it('applies the ONE filter vocabulary on the loaded set: --cassette, --run, --product (D-02)', async () => {
    const { dir, configPath } = await writeReplayFixture()
    saveRun(dir, 'run-shop', { scope: { tier: 'product', key: 'shop' } })
    saveRun(dir, 'run-plain')
    const session = await sessionFor(configPath)
    await runExtractVerb(session)
    const ids = await stagedCassetteIds(dir)
    expect(ids).toHaveLength(4)
    const shopIds = ids.filter(id => id.startsWith(slugBranch('run-shop')))
    const shopLeafId = shopIds.find(id => id.endsWith('-leaf'))
    if (shopLeafId === undefined) throw new Error('expected a staged run-shop leaf cassette')

    const named = await runReplayVerb(
      session,
      { cassette: shopLeafId },
      { plannerOverrides: replayStub().overrides },
    )
    expect(named.replayed).toBe(1)
    expect(named.batchKey).toBe(computeBatchKey([shopLeafId]))

    await expect(
      runReplayVerb(session, { cassette: 'no-such-cassette' }, { plannerOverrides: replayStub().overrides }),
    ).rejects.toBeInstanceOf(EvalNamedInputError)

    const byRun = await runReplayVerb(
      session,
      { run: 'run-plain' },
      { plannerOverrides: replayStub().overrides },
    )
    expect(byRun.replayed).toBe(2)
    expect(byRun.batchKey).toBe(
      computeBatchKey(ids.filter(id => id.startsWith(slugBranch('run-plain')))),
    )

    await expect(
      runReplayVerb(session, { run: 'no-such-run' }, { plannerOverrides: replayStub().overrides }),
    ).rejects.toBeInstanceOf(EvalNamedInputError)

    const byProduct = await runReplayVerb(
      session,
      { product: 'shop' },
      { plannerOverrides: replayStub().overrides },
    )
    expect(byProduct.replayed).toBe(2)
    expect(byProduct.batchKey).toBe(computeBatchKey(shopIds))
  })

  it('completes without a judge: configured false with the notice riding the DTO (D-03/370)', async () => {
    const { dir, configPath } = await writeReplayFixture()
    saveRun(dir, 'run-alpha')
    const session = await sessionFor(configPath)
    await runExtractVerb(session)

    const result = await runReplayVerb(session, {}, { plannerOverrides: replayStub().overrides })

    // Absence is first-class configuration (370): the batch completes, the judge block is honest
    // zeros, and the no-judge notice is DTO data — any tie would record not-invoked downstream.
    expect(result.replayed).toBe(2)
    expect(result.judge).toEqual({
      configured: false,
      invoked: 0,
      settled: 0,
      abstained: 0,
      errors: 0,
      notInvoked: 0,
    })
    expect(result.notices.some(notice => notice.includes('no judge configured'))).toBe(true)
  })
})

// ---- 372-07 Task 1: runSeedVerb — per-handoff plan-then-execute, wrapped 1:1 (D-01/D-16) ------

/**
 * Seed fixture: the extract fixture with Luhn-safe state timestamps. The committed egress
 * checkpoint's credit-card detector Luhn-checks every 13-19 digit run and the extract fixture's
 * 1725000000100 stateBefore timestamp happens to pass — a 10-digit epoch keeps the committed
 * cassette text free of card-shaped numbers (the seeding-composition test precedent).
 */
function saveSeedRun(
  dir: string,
  runId: string,
  options: { withPairSkipStep?: boolean } = {},
): void {
  const root = join(dir, '.agent-qa')
  const ref = new FsEvidenceArtifactStore({ root, runId }).persistDecisionScreenshot(BLOB_BYTES)
  const handoff = buildHandoff({ runId, screenshotRef: ref })
  for (const test of handoff.tests) {
    for (const testStep of test.steps) {
      for (const subAction of testStep.subActions) {
        subAction.stateBefore = { ...subAction.stateBefore, timestamp: 1_725_000_000 }
      }
      if (options.withPairSkipStep) {
        // A selfHeal block whose failed action matches NO recorded sub-action mints exactly one
        // typed 'no-match' pair skip — never silent (T-371-18), carried verbatim by the verb.
        const recorded = testStep.subActions[0]!
        testStep.selfHeal = {
          failedDecision: {
            plan: 'Click a button that was never recorded',
            plannedAction: { type: 'click', ref: asRef('e-nonexistent') },
            result: structuredClone(recorded.result),
          },
          recoveringDecision: {
            plan: recorded.plan,
            plannedAction: structuredClone(recorded.plannedAction),
            result: structuredClone(recorded.result),
          },
        }
      }
    }
  }
  new FsHandoffStore({ root, runId }).save(handoff)
}

describe('runSeedVerb — corpus committing wraps seedCommittedCorpus 1:1 (D-01/D-16/D-17)', () => {
  it('re-extracts per handoff, plans, seeds the committed root, and sums the reports (D-16)', async () => {
    const { dir, configPath } = await writeFixture()
    saveSeedRun(dir, 'run-alpha')
    saveSeedRun(dir, 'run-beta')
    const session = await sessionFor(configPath)
    await runExtractVerb(session)
    const ids = await stagedCassetteIds(dir)
    const leafIds = ids.filter(id => id.endsWith('-leaf'))
    expect(leafIds).toHaveLength(2)

    const result = await runSeedVerb(session)

    // The committedRoot is ALWAYS <configDir>/agent-qa-eval (spec §B7, D-12) — no flag retargets it.
    expect(result.committedRoot).toBe(resolve(dir, 'agent-qa-eval'))
    expect(result.handoffsSeeded).toBe(2)
    // Each run's single verified-pass live decision is one silver case (D-10/D-11).
    expect(result.seededCount).toBe(2)
    expect(result.unchangedCount).toBe(0)
    expect(result.refusals).toEqual([])
    expect(result.pairSkips).toBe(0)
    expect(result.pairCounts).toEqual({ total: 0, sameState: 0, differingState: 0 })
    // Committed files land under the product partition — cassette + label per admitted case.
    for (const leafId of leafIds) {
      expect(existsSync(join(result.committedRoot, committedCassettePath('default', leafId)))).toBe(true)
      expect(existsSync(join(result.committedRoot, committedLabelPath('default', leafId)))).toBe(true)
    }
    expect(existsSync(join(result.committedRoot, 'eval-root.json'))).toBe(true)
  })

  it('re-seeds idempotently: the second sweep reports every case unchanged (D-17)', async () => {
    const { dir, configPath } = await writeFixture()
    saveSeedRun(dir, 'run-alpha')
    saveSeedRun(dir, 'run-beta')
    const session = await sessionFor(configPath)

    const first = await runSeedVerb(session)
    expect(first.seededCount).toBe(2)
    expect(first.refusals).toEqual([])

    const second = await runSeedVerb(session)
    expect(second.unchangedCount).toBe(first.seededCount)
    expect(second.seededCount).toBe(0)
    expect(second.refusals).toEqual([])
  })

  it('threads params.silverPerTestCap into buildSeedingPlan — cap 0 admits nothing (D-11)', async () => {
    const { dir, configPath } = await writeFixture()
    saveSeedRun(dir, 'run-alpha')
    const session = await sessionFor(configPath)

    const capped = await runSeedVerb(session, {}, { silverPerTestCap: 0 })
    expect(capped.seededCount).toBe(0)
    // The excluded candidate is a typed 'cap-exceeded' exclusion, never silently dropped.
    expect(capped.silverExclusions).toBeGreaterThan(0)

    const uncapped = await runSeedVerb(session)
    expect(uncapped.seededCount).toBe(1)
  })

  it('carries typed pair skips verbatim from the SeedingReport (T-371-18)', async () => {
    const { dir, configPath } = await writeFixture()
    saveSeedRun(dir, 'run-skips', { withPairSkipStep: true })
    const session = await sessionFor(configPath)

    const result = await runSeedVerb(session)

    expect(result.pairSkips).toBe(1)
    // The selfHeal step's decision belongs to the pair channel, so silver excludes it too.
    expect(result.seededCount).toBe(0)
    expect(result.silverExclusions).toBeGreaterThan(0)
  })
})

// ---- Task 2: the commander family, D-04 rendering purity, D-08 exit codes ---------------------

/** Mirror of cli.ts: the global --config option on the program, eval as a direct child. */
function buildProgram(): Command {
  const program = new Command()
  program.enablePositionalOptions()
  program.option('--config <path>', 'config file path', 'agent-qa.config.yaml')
  program.addCommand(createEvalCommand())
  return program
}

function captureConsole(): { logs: string[]; errors: string[] } {
  const logs: string[] = []
  const errors: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
  return { logs, errors }
}

describe('createEvalCommand — family skeleton and registration shape (D-01)', () => {
  it('names the family "eval" with the extract and replay subcommands', () => {
    const cmd = createEvalCommand()
    expect(cmd.name()).toBe('eval')
    expect(cmd.commands.map(sub => sub.name())).toEqual(['extract', 'replay'])
  })

  it('declares the D-02 filter vocabulary on extract: --run, --product, --json', () => {
    const extract = createEvalCommand().commands.find(sub => sub.name() === 'extract')
    const flags = extract?.options.map(option => option.long) ?? []
    expect(flags).toEqual(expect.arrayContaining(['--run', '--product', '--json']))
  })

  it('declares the full replay flag vocabulary: --run, --cassette, --product, --judge, --k, --seed, --json', () => {
    const replay = createEvalCommand().commands.find(sub => sub.name() === 'replay')
    const flags = replay?.options.map(option => option.long) ?? []
    expect(flags).toEqual(
      expect.arrayContaining([
        '--run',
        '--cassette',
        '--product',
        '--judge',
        '--k',
        '--seed',
        '--json',
      ]),
    )
  })
})

describe('agent-qa eval extract — rendering and exit semantics (D-04/D-08)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('--json emits exactly one JSON DTO on stdout and nothing else (Pitfall 11)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    saveRun(dir, 'run-beta', { withCachedStep: true })
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'extract', '--json'], {
      from: 'user',
    })

    expect(errors).toEqual([])
    expect(logs).toHaveLength(1)
    const dto = JSON.parse(logs[0] ?? '') as ExtractVerbResult
    expect(dto.runsSwept).toBe(2)
    expect(dto.cassettesWritten).toBe(4)
    expect(dto.completeness).toEqual({ complete: 4, 'cache-hit': 1 })
    expect(process.exitCode).not.toBe(1)
  })

  it('renders the human summary from the same DTO fields without --json (D-04)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'extract'], { from: 'user' })

    expect(errors).toEqual([])
    const rendered = logs.join('\n')
    expect(rendered).toContain('swept 1 run')
    expect(rendered).toContain('cassettes written: 2')
    expect(rendered).toContain('complete=2')
    expect(rendered).toContain(resolve(dir, '.agent-qa', 'eval', 'cassettes'))
    expect(() => JSON.parse(rendered)).toThrow()
  })

  it('a named --run with no handoff sets process.exitCode 1 — the ONLY extract failure (D-08)', async () => {
    const { dir, configPath } = await writeFixture()
    saveRun(dir, 'run-alpha')
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(
      ['--config', configPath, 'eval', 'extract', '--run', 'no-such-run'],
      { from: 'user' },
    )

    expect(process.exitCode).toBe(1)
    expect(errors.join('\n')).toContain('no-such-run')
    expect(logs).toEqual([])
  })

  it('an empty sweep is data, not an error: exit 0 with runsSwept 0', async () => {
    const { configPath } = await writeFixture()
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'extract', '--json'], {
      from: 'user',
    })

    expect(process.exitCode).not.toBe(1)
    expect(errors).toEqual([])
    const dto = JSON.parse(logs.join('\n')) as ExtractVerbResult
    expect(dto.runsSwept).toBe(0)
    expect(dto.cassettesWritten).toBe(0)
    expect(dto.runsSkipped).toEqual([])
  })

  it('config/session resolution errors map to exit 1 with the message on stderr (D-08)', async () => {
    const dir = await mkdtemp(join(tmpRoot, 'fixture-'))
    const configPath = join(dir, 'agent-qa.config.yaml')
    await writeFile(configPath, CONFIG_YAML)
    // No secrets file: resolveEvalSession throws a typed error naming the path.
    const { errors } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'extract'], { from: 'user' })

    expect(process.exitCode).toBe(1)
    expect(errors.join('\n')).toContain('.env.secrets.local')
  })
})

describe('agent-qa eval replay — rendering and exit semantics (372-06, D-04/D-08)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('--json emits exactly one JSON DTO on stdout; an empty sweep is data with batchKey "empty" (Pitfall 11/D-02)', async () => {
    const { configPath } = await writeReplayFixture()
    const { logs } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'replay', '--json'], {
      from: 'user',
    })

    expect(process.exitCode).not.toBe(1)
    expect(logs).toHaveLength(1)
    const dto = JSON.parse(logs[0] ?? '') as ReplayVerbResult
    expect(dto.batchKey).toBe('empty')
    expect(dto.swept).toBe(0)
    expect(dto.replayed).toBe(0)
    expect(dto.judge.configured).toBe(false)
  })

  it('renders the human summary from the DTO fields only, "0 ties" honestly (D-04)', async () => {
    const { configPath } = await writeReplayFixture()
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'replay'], { from: 'user' })

    expect(process.exitCode).not.toBe(1)
    expect(errors).toEqual([])
    const rendered = logs.join('\n')
    expect(rendered).toContain('batch empty')
    expect(rendered).toContain('swept 0')
    expect(rendered).toContain('judge: not configured')
    expect(rendered).toContain('0 ties')
    expect(rendered).toContain(join('.agent-qa', 'eval', 'replays'))
    expect(() => JSON.parse(rendered)).toThrow()
  })

  it('a named --cassette with no staged match sets exitCode 1 (D-08)', async () => {
    const { configPath } = await writeReplayFixture()
    const { logs, errors } = captureConsole()

    await buildProgram().parseAsync(
      ['--config', configPath, 'eval', 'replay', '--cassette', 'no-such-cassette'],
      { from: 'user' },
    )

    expect(process.exitCode).toBe(1)
    expect(errors.join('\n')).toContain('no-such-cassette')
    expect(logs).toEqual([])
  })

  it('a sweep containing only load refusals exits 0 — refusal counters are data, not errors (D-08)', async () => {
    const { dir, configPath } = await writeReplayFixture()
    const corruptDir = join(dir, '.agent-qa', 'eval', 'cassettes', 'corrupt-bundle')
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, 'cassette.json'), 'not json at all')
    const { logs } = captureConsole()

    await buildProgram().parseAsync(['--config', configPath, 'eval', 'replay', '--json'], {
      from: 'user',
    })

    expect(process.exitCode).not.toBe(1)
    const dto = JSON.parse(logs.join('\n')) as ReplayVerbResult
    expect(dto.swept).toBe(1)
    expect(dto.loadRefusals).toEqual({ 'parse-failed': 1 })
    expect(dto.replayed).toBe(0)
  })
})
