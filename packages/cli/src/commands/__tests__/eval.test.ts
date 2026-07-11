// Phase 372-05 — the eval command family's first verb: extract (D-01), sweep-by-default with the
// D-02 filter vocabulary, typed per-run skips (never batch errors), D-04 DTO-faithful rendering,
// and D-08 exit semantics. Task 1 pins runExtractVerb; Task 2 pins the commander wiring.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
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
import {
  EvalNamedInputError,
  resolveEvalSession,
  runExtractVerb,
} from '../../eval-session-composition.js'
import type { EvalSession, ExtractVerbResult } from '../../eval-session-composition.js'

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
}): StepEvidence {
  return {
    stepIndex: input.stepIndex,
    stepText: input.live ? 'Click Continue' : 'Replay Continue from cache',
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
}): CompletedRunHandoff {
  const scope = input.scope ?? SUITE_SCOPE
  const steps = [
    step({ stepIndex: 0, scope, live: true, screenshotRef: input.screenshotRef }),
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
  options: { scope?: ScopeKey; withCachedStep?: boolean } = {},
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
  savedExitCode = process.exitCode
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
