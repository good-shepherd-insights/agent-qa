import { GATE2_DEFAULT_MAX_LOWER_TRUST_PER_SCOPE } from '@vostride/agent-qa-schema'
import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
// The CLI composition-root sibling for the eval verbs (Phase 372, Plan 04 — the D-05 sibling of
// the run session composition, which as of 385-08/D-13 is the local agent package's composition
// subtree rather than a module beside this one). It discharges at ONE site what every eval verb (replay / score /
// report / seed; plans 372-05/06/07) stands on: D-06 run-parity seeded masking — the factory
// seeds from the SAME three sources as run (the workspace secrets file's SecretStore, the
// name-based sensitive env slice, and auth-state sensitive strings) via the IMPORTED
// buildRunMaskingContext, never a copy; D-07 the eval-scoped audit stream — per-invocation dirs
// under .agent-qa/eval/audit/<verb>/<key>, never .agent-qa/runs/ and never a fabricated runId
// (Pitfall 2: buildRunAuditSink is the run-dir-rooted, runId-stamping builder and is never
// reused here); and D-03 judge-as-named-user-facing-config — judge/planner resolution flows
// through the exact resolveNamedConfig → resolveModelAuth → toModelProfileAndAuth chain run
// uses, discharging 370 D-06's explicit-second-ModelProfile contract. Errors are typed (D-08):
// the command layer maps them to exit codes — never process.exit inside this module.
//
// The CLI is a surface / composition root with full host access (spec §4), so this module uses
// node builtins directly.

import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  assertBaselineComparator,
  buildEvalReport,
  buildSeedingPlan,
  admitSeedMember,
  canonicalJson,
  composeBaselineProfileKey,
  computeBatchKey,
  computeCorpusDigest,
  decisionCorrectnessVectors,
  deriveCensus,
  renderCensusMarkdown,
  EXCLUSION_CLASSES,
  extractRunCassettes,
  FLOOR_PROTOCOL_MINIMUM,
  guardClassifierRepeatability,
  guardCampaignManifest,
  JUDGE_CONFIG,
  partitionParamsOf,
  projectBaselinePointer,
  projectDecisionVectorsDocument,
  projectPartitionManifest,
  projectRunExclusion,
  renderBaselineComparatorRefusal,
  renderFloorRefusal,
  resolveJudgeFamily,
  resolveProductPartition,
  SEED_POLICIES,
} from '@vostride/agent-qa-eval'
import type {
  BaselineComparatorRefusal,
  ClassifierRepeatability,
  CassetteScore,
  CorpusCensus,
  DecisionScoreEntry,
  DeriveCensusInput,
  EvalBatchReport,
  ExclusionClass,
  JudgeIdentityBlock,
  PartitionManifest,
  SeedPolicy,
  ScoredBatchEntry,
  SilverExclusion,
  TargetEnvironment,
} from '@vostride/agent-qa-eval'
import {
  COMMITTED_CASSETTES_DIR,
  DEFAULT_EVAL_CASSETTES_SUBDIR,
  DEFAULT_EVAL_REPLAYS_SUBDIR,
  DEFAULT_EVAL_REPORTS_SUBDIR,
  FloorProtocolError,
  FsCassetteStore,
  FsReplayRecordStore,
  FsReportStore,
  FsRunArtifactSource,
  FsScoreStore,
  assembleScoredBatch,
  ablateCanaryStep,
  isNovelState,
  stageFeedbackEntry,
  admitStagedFeedback,
  FEEDBACK_STAGING_SUBDIR,
  readCommittedCorpusDigest,
  cassetteProductPartition,
  commitCensus,
  commitEvalReport,
  committedExclusionPath,
  committedNoiseFloorPath,
  committedPartitionManifestPath,
  computeReplayProfileFingerprintFor,
  listBaselinePointers,
  listCommittedReports,
  listNoiseFloorArtefacts,
  loadCassetteBundles,
  loadLabelEvidence,
  loadReplayRecord,
  loadScoreRecord,
  readCommittedCorpus,
  readActiveCommittedCorpus,
  readPartitionManifests,
  readRunExclusions,
  runNoiseFloorMeasurement,
  runReleaseGate,
  runLabelCalibration,
  seedCommittedCorpus,
  sweepCassetteReplays,
  writeBaselinePointer,
  writePartitionManifest,
  writeRunExclusion,
} from '@vostride/agent-qa-eval-local'
import type {
  CommitCensusOutcome,
  CommitEvalReportOutcome,
  ReleaseGateMode,
  RunNoiseFloorMeasurementResult,
  RunReleaseGateResult,
  RunLabelCalibrationResult,
  SeedingRefusal,
  StageFeedbackEntryInput,
  WriteBaselinePointerOutcome,
} from '@vostride/agent-qa-eval-local'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
import type {
  ModelProfile,
  ModelProviderOverrides,
  ResolvedModelAuth,
} from '@vostride/agent-qa-model'
import {
  ANALYSIS_FILE,
  admitAnalysisArtifactForRun,
  guardRunAnalysisArtifact,
  resolveRunVerdicts,
  sha256hex,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  RunAnalysisArtifact,
  Verdict,
} from '@vostride/agent-qa-schema'
import type { AgentQaConfig } from '@vostride/agent-qa-core'
import { resolveConfig } from './config.js'
import { listTargets, resolveTarget } from './targets.js'
export { renderCensusMarkdown }
import { renderEvalReportMarkdown } from './eval-report-render.js'
import {
  buildRunMaskingContext,
  LOCAL_CURATION_CAPABILITIES,
  resolveRunExecutionContext,
} from '@vostride/agent-qa-agent-local'
import type { RunExecutionContext, RunMaskingContext } from '@vostride/agent-qa-agent-local'

// The @vostride/agent-qa-eval-local workspace edge (G5) is anchored by the real store/loader
// value imports above (372-05/06); this type re-export stays for the report verb plan (372-07)
// that consumes record loads. Erased at build — no runtime coupling.
export type { ReplayRecordLoad } from '@vostride/agent-qa-eval-local'

// FUNC-02 surface firewall (Phase 384 D-01/D-03): this composition root is the ledgered edge to
// `@vostride/agent-qa-eval`, and the ledger only ever SHRINKS — a surface file written after
// 2026-07-28 may not join it. The census renderer beside this module is such a file, so it types
// against the census DTO through the composition root rather than minting a second edge of its
// own, exactly as `commands/eval.ts` types against the verb DTOs. Type-only, erased at build.
export type {
  BaselineComparatorRefusal,
  CensusCrossCheckLine,
  CorpusCensus,
  ExclusionCensusBlock,
  PartitionCensusBlock,
} from '@vostride/agent-qa-eval'

// 413-06 D-20: the ONE refusal renderer, re-exported so `commands/eval.ts` can print a refused
// baseline designation WITHOUT minting a second surface-firewall edge of its own — the command
// layer receives it through this ledgered root exactly as it receives the verb pipelines.
export { renderBaselineComparatorRefusal, SEED_POLICIES } from '@vostride/agent-qa-eval'
export type { SeedPolicy } from '@vostride/agent-qa-eval'
export type { WriteBaselinePointerOutcome } from '@vostride/agent-qa-eval-local'

// 416: the posture builder obtains eval capabilities through this existing host edge.
// Keep the surface firewall self-shrinking; new CLI files do not gain eval imports.
export { computeCorpusDigest, selectGateSet } from '@vostride/agent-qa-eval'
export type { JudgeCapabilityInput } from '@vostride/agent-qa-eval'
export { readActiveCommittedCorpus, readCommittedCorpus, readGatePostureFor, resolveMinimumGateSet } from '@vostride/agent-qa-eval-local'

/** The user-facing eval params (config `eval:` block merged with per-invocation flags, D-03). */
export interface EvalCliConfig {
  judge?: string
  /** Owner override of D-10 (2026-07-12): explicit default-off same-family judging opt-in. */
  judgeAllowSameFamily?: boolean
  k?: number
  seed?: number
  seeding?: { silverPerTestCap?: number }
  gate1?: { maxScreens?: number }
  gate2?: NonNullable<AgentQaConfig['eval']>['gate2']
}

/** The one resolved session every eval verb consumes (D-05). */
export interface EvalSession {
  config: AgentQaConfig
  configPath: string
  configDir: string
  evalConfig: EvalCliConfig
  /**
   * D-06: each call constructs a fresh, disposable MaskingContext seeded from the SAME three
   * sources as run via the imported buildRunMaskingContext — a secret registered in any source
   * masks to a placeholder on every eval egress.
   */
  maskingContextFactory: () => RunMaskingContext
  executionContext: RunExecutionContext
}

/**
 * Resolve the one eval session (D-05). Validates the config through resolveConfig (which now
 * carries the typed `eval` block), loads the workspace secrets file into a SecretStore, reads
 * every persisted auth-state payload best-effort, merges flag overrides over the config eval
 * block (flags win field-wise, D-03), and closes the run-parity masking seed over all of it.
 * Config errors are typed Errors naming the offending path (D-08) — never process.exit.
 */
export async function resolveEvalSession(input: {
  configPath?: string
  flags?: { judge?: string; k?: number; seed?: number; silverCap?: number }
  /** Declaration-only host probes neither read secrets/auth state nor create a run masker. */
  keyOnly?: boolean
} = {}): Promise<EvalSession> {
  const configPath = input.configPath ?? 'agent-qa.config.yaml'
  const configDir = dirname(resolve(configPath))
  const config = await resolveConfig({ configPath, loadAuthPlugins: input.keyOnly !== true })

  if (input.keyOnly === true) {
    return {
      config, configPath, configDir,
      evalConfig: mergeEvalConfig(config.eval, input.flags),
      maskingContextFactory: () => { throw new Error('A key-only eval session cannot create a run masker') },
      executionContext: resolveRunExecutionContext(),
    }
  }

  const secretStore = await loadEvalSecretStore(config, configDir)
  const authStatePayloads = await readAuthStatePayloadsBestEffort(
    resolve(configDir, config.services?.authState?.dir ?? '.agent-qa/auth-states'),
  )

  return {
    config,
    configPath,
    configDir,
    evalConfig: mergeEvalConfig(config.eval, input.flags),
    maskingContextFactory: () =>
      buildRunMaskingContext({ secretStore, env: process.env, authStatePayloads }),
    executionContext: resolveRunExecutionContext(),
  }
}

// D-07: per-invocation eval audit dirs live under `.agent-qa/eval/audit/<verb>/<slugBranch(key)>`
// so measurement audit stays separable from run audit. Pitfall 2: never buildRunAuditSink here —
// that builder roots under `.agent-qa/runs/` and stamps a runId; eval invocations have neither.
// The WHOLE key is slugged with slugBranch (one path segment) — the exact slug the run dir uses,
// so path shapes never fork.
export function evalAuditDir(configDir: string, verb: string, key: string): string {
  return resolve(configDir, '.agent-qa', 'eval', 'audit', verb, slugBranch(key))
}

/**
 * Typed named-input-not-found rejection (D-08): a `--run <slug>` or `--cassette <id>` naming
 * nothing on disk is the ONLY sweep-shape failure — the command layer maps it to exit 1.
 * Per-item load failures inside a sweep are DATA (`runsSkipped` / `loadRefusals`), never errors.
 */
export class EvalNamedInputError extends Error {
  readonly inputKind: string
  readonly inputName: string
  readonly searchRoot: string

  constructor(
    inputKind: string, inputName: string, searchRoot: string, verb = 'extract', detail?: string,
  ) {
    super(
      detail === undefined
        ? `No recorded ${inputKind} named "${inputName}" under ${searchRoot} — nothing to ${verb}.`
        : `Cannot ${verb} ${inputKind} "${inputName}" at ${searchRoot}: ${detail}`,
    )
    this.name = 'EvalNamedInputError'
    this.inputKind = inputKind
    this.inputName = inputName
    this.searchRoot = searchRoot
  }
}

/** The extract verb's one DTO — the console renders FROM this, never around it (D-04). */
export interface ExtractVerbResult {
  /** Run dirs (with a handoff document) that entered the sweep after `--run` narrowing. */
  runsSwept: number
  /** Per-run typed skips: unreadable / version-refused handoffs (D-02, never batch errors). */
  runsSkipped: { runSlug: string; reason: string }[]
  /** Runs whose product partition differed from `--product`. */
  runsFiltered: number
  cassettesWritten: number
  /**
   * ExtractionReport counters folded verbatim: emitted-cassette completeness statuses and
   * per-decision selection-skip reasons, keyed by the engine's own names (D-04).
   */
  completeness: Record<string, number>
  cassettesRoot: string
}

/**
 * The extract verb pipeline (D-01/D-02): sweep every handoff under `.agent-qa/runs/` (or the one
 * `--run` names), load each through the version-guarded runner-local loader (typed skips on
 * refusal — pre-366 documents surface here, never as batch errors), and hand every survivor to
 * the sanctioned engines: `extractRunCassettes` selects/projects, `FsCassetteStore` stages
 * idempotently (rm+mkdir recreate). The CLI adds NO selection, completeness, or dedup logic.
 * The whole body runs inside `runSafetyScope` with the session's seeded masking context and a
 * D-07 eval-scoped audit sink — extract has no model egress, the discipline is uniform anyway.
 */
export async function runExtractVerb(
  session: EvalSession,
  filters: { run?: string; product?: string } = {},
): Promise<ExtractVerbResult> {
  const maskingContext = session.maskingContextFactory()
  const auditSink = new JsonlAuditSink(
    evalAuditDir(session.configDir, 'extract', filters.run ?? 'sweep'),
  )
  try {
    return await runSafetyScope(
      { maskingContext, auditSink, executionContext: session.executionContext },
      async () => sweepAndExtract(resolve(session.configDir, '.agent-qa'), filters),
    )
  } finally {
    maskingContext.dispose()
  }
}

// ---- internals --------------------------------------------------------------------------------

function sweepAndExtract(
  agentQaRoot: string,
  filters: { run?: string; product?: string },
): ExtractVerbResult {
  const runsRoot = resolve(agentQaRoot, RUNS_SUBDIR)
  let runSlugs = listRunSlugsWithHandoff(runsRoot)

  if (filters.run !== undefined) {
    const named = filters.run
    runSlugs = runSlugs.filter(slug => slug === named || slug === slugBranch(named))
    if (runSlugs.length === 0) {
      throw new EvalNamedInputError('run', named, runsRoot)
    }
  }

  const store = new FsCassetteStore({ root: agentQaRoot })
  const runsSkipped: { runSlug: string; reason: string }[] = []
  const completeness: Record<string, number> = {}
  let runsFiltered = 0
  let cassettesWritten = 0

  for (const runSlug of runSlugs) {
    let extraction: ReturnType<typeof extractRunCassettes>
    try {
      // The version-guarded loader is the ONE handoff read path (never raw JSON.parse here):
      // unreadable documents and version-guard refusals become typed per-run skips (D-02).
      const handoff = loadCompletedRunHandoff(resolve(runsRoot, runSlug, HANDOFF_FILE))
      if (
        filters.product !== undefined
        && resolveProductPartition(handoff.scope) !== filters.product
      ) {
        runsFiltered++
        continue
      }
      extraction = extractRunCassettes({
        handoff,
        artifacts: new FsRunArtifactSource({ root: agentQaRoot, runId: handoff.runId }),
      })
    } catch (err) {
      runsSkipped.push({ runSlug, reason: err instanceof Error ? err.message : String(err) })
      continue
    }

    for (const extracted of extraction.cassettes) {
      store.write(extracted)
      cassettesWritten++
    }
    for (const emitted of extraction.report.emitted) {
      bumpCounter(completeness, emitted.completenessStatus)
    }
    for (const skip of extraction.report.skips) {
      bumpCounter(completeness, skip.reason)
    }
  }

  return {
    runsSwept: runSlugs.length,
    runsSkipped,
    runsFiltered,
    cassettesWritten,
    completeness,
    cassettesRoot: resolve(agentQaRoot, DEFAULT_EVAL_CASSETTES_SUBDIR),
  }
}

/**
 * Enumerate child run dirs carrying a handoff document (the cache.ts sweep precedent:
 * ENOENT ⇒ empty sweep, never an error). Sorted for a deterministic sweep order.
 */
function listRunSlugsWithHandoff(runsRoot: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(runsRoot, { withFileTypes: true })
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return entries
    .filter(entry => entry.isDirectory() && existsSync(resolve(runsRoot, entry.name, HANDOFF_FILE)))
    .map(entry => entry.name)
    .sort()
}

function bumpCounter(counters: Record<string, number>, key: string): void {
  counters[key] = (counters[key] ?? 0) + 1
}

// ---- the cassette source (413-06, D-08) -------------------------------------------------------

/**
 * 413 D-08: which cassette population a batch replays or reports over.
 *
 * `staged` is `.agent-qa/eval/cassettes/` — whatever the last `eval extract` put on this machine.
 * `committed` is `<configDir>/agent-qa-eval/cassettes/` — the REVIEWED corpus: the legacy entries
 * plus every freshly seeded cassette, which is the only population a whole-corpus baseline may be
 * measured over (the legacy cassettes are never re-extracted, so a staged sweep silently omits
 * them and the number would cover a different corpus than Phase 415's floor will).
 *
 * The replay RECORDS root is unaffected by either value: replay output is runtime staging (D-07)
 * and never lands inside the write-once committed root.
 */
export type EvalCorpusSource = 'staged' | 'committed'

/** Resolve the sweep root for a cassette source — the ONE place the two roots are spelled. */
function resolveCassettesRoot(
  session: EvalSession,
  source: EvalCorpusSource,
): { cassettesRoot: string; notice?: string } {
  if (source === 'committed') {
    const cassettesRoot = join(
      resolve(session.configDir, 'agent-qa-eval'),
      COMMITTED_CASSETTES_DIR,
    )
    return { cassettesRoot, notice: `cassette source: committed root ${cassettesRoot}` }
  }
  return {
    cassettesRoot: join(resolve(session.configDir, '.agent-qa'), DEFAULT_EVAL_CASSETTES_SUBDIR),
  }
}

// ---- the replay verb (372-06, D-02/D-06/D-07/D-08) --------------------------------------------

/** D-04 judge honesty counters folded from the PERSISTED score records, never recomputed. */
export interface ReplayJudgeCounters {
  /** Whether a judge resolved from `eval.judge` / `--judge` entered the batch (D-03). */
  configured: boolean
  invoked: number
  settled: number
  abstained: number
  errors: number
  notInvoked: number
}

/** The replay verb's one DTO — the console renders FROM this, never around it (D-04). */
export interface ReplayVerbResult {
  /** sha256hex over the sorted replayed cassette ids ('empty' literal for a zero batch, D-02). */
  batchKey: string
  /** Bundle dirs that entered the sweep (pre-load, pre-filter). */
  swept: number
  /** Cassettes that replayed to a ReplayResult through the sanctioned composition. */
  replayed: number
  /** Typed loadCassetteBundle refusals folded by reason — data, never batch errors (D-08). */
  loadRefusals: Record<string, number>
  /** Typed replay refusals (plus harness errors) folded by reason — the batch never aborts. */
  replayRefusals: Record<string, number>
  /** Persisted score.json records read back after the loop (refusals are never scored). */
  scored: number
  /** Judge dispositions read from the persisted tie/settled stamps (D-04). */
  judge: ReplayJudgeCounters
  /** The staged replay-records root the persisted outcomes landed under. */
  replaysRoot: string
  /** 413 D-08: which cassette population this batch swept — 'staged' unless asked otherwise. */
  source: EvalCorpusSource
  /** Stderr-destined notices: no-judge / family-preflight warnings, harness errors, empty sweep. */
  notices: string[]
  /** Invocation calls include planner, judge and retries; tokens are persisted reported usage. */
  spend: ReplayInvocationSpend
}

export interface ReplayInvocationSpend {
  seed: number | null
  /** Null when no seed was declared or no replay samples were recorded. */
  seedHonored: boolean | null
  decisions: number
  /** Observed provider invocations, including retries and judge calls. Never sample-derived. */
  modelCalls: number
  /** Reported planner + judge usage; failed/unreported attempts may have unknown usage. */
  promptTokens: number
  completionTokens: number
  wallClockMs: number
  sampleCount: number
  samplesMissingTokenUsage: number
  /** Persisted judge outcomes and usage, included in the token totals above. */
  judgeCost: EvalBatchReport['honesty']['judge']['cost']
}

function replayInvocationSpend(
  entries: ScoredBatchEntry[], seed: number | undefined, modelCalls: number, started: number,
  calibration?: EvalBatchReport['calibration'],
): ReplayInvocationSpend {
  const report = buildEvalReport(entries, undefined, undefined, { declaredSeed: seed, calibration })
  const cost = report.totalCost
  const judgeCost = report.honesty.judge.cost
  return {
    seed: seed ?? null,
    seedHonored: cost.sampleCount === 0 ? null : report.seedHonored ?? null,
    decisions: report.headline.perDecisionCost.decisionCount,
    modelCalls,
    promptTokens: cost.promptTokens + judgeCost.inputTokens,
    completionTokens: cost.completionTokens + judgeCost.outputTokens,
    wallClockMs: Math.max(0, Math.round(performance.now() - started)),
    sampleCount: cost.sampleCount,
    samplesMissingTokenUsage: cost.samplesMissingTokenUsage,
    judgeCost,
  }
}

/**
 * The replay verb pipeline (D-01/D-02): sweep every staged cassette bundle (or the ones the
 * filters name), load each through loadCassetteBundle (typed refusals as data), and drive
 * runCassetteReplay — production planner profile, D-06 session-seeded maskingContextFactory,
 * D-03 judge bag, D-07 batchKey-scoped audit dir, replay + score stores. After the loop the
 * judge counters are folded from the PERSISTED ScoreRecords (render from disk, never recompute,
 * D-04). Pitfall 1: runCassetteReplay opens its OWN safety scopes with the injected factory, so
 * no outer runSafetyScope wraps the model legs here. `opts` is the TEST-ONLY captured-boundary
 * stub seam (createModel overrides passthrough) — judge/k/seed are NOT verb parameters, they
 * arrive flag-merged on `session.evalConfig` (D-03).
 */
export async function runReplayVerb(
  session: EvalSession,
  filters: { run?: string; cassette?: string; product?: string } = {},
  opts: {
    plannerOverrides?: ModelProviderOverrides
    judgeOverrides?: ModelProviderOverrides
    /** 413 D-08: sweep the committed corpus instead of the staging root. Defaults to 'staged'. */
    source?: EvalCorpusSource
  } = {},
): Promise<ReplayVerbResult> {
  const started = performance.now()
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const source: EvalCorpusSource = opts.source ?? 'staged'
  const sourceRoot = resolveCassettesRoot(session, source)
  const cassettesRoot = sourceRoot.cassettesRoot
  // D-07: replay output is runtime staging under .agent-qa/, whichever population was swept —
  // the write-once committed root never receives a replay record.
  const replaysRoot = join(agentQaRoot, DEFAULT_EVAL_REPLAYS_SUBDIR)

  // (1)+(2) sweep + load: every bundle dir enters; refusals fold by reason (D-02/D-08).
  const { swept, loaded, loadRefusals } = loadCassetteBundles(cassettesRoot)

  // (3) filters on the LOADED set — the ONE D-02 vocabulary; a named miss is the only throw.
  const activeCorpus = source === 'committed'
    ? readActiveCommittedCorpus(resolve(session.configDir, 'agent-qa-eval'), agentQaRoot) : undefined
  const activeIds = activeCorpus === undefined ? undefined : new Set(activeCorpus.snapshot.entries.map(entry => entry.cassetteId))
  let selected = activeIds === undefined ? loaded : loaded.filter(entry => activeIds.has(entry.cassette.id))
  if (filters.cassette !== undefined) {
    const named = filters.cassette
    selected = selected.filter(entry => entry.cassette.id === named)
    if (selected.length === 0) {
      throw new EvalNamedInputError('cassette', named, cassettesRoot, 'replay')
    }
  }
  if (filters.run !== undefined) {
    const named = filters.run
    selected = selected.filter(entry => {
      const head = entry.cassette.id.split('/')[0]
      return head === named || head === slugBranch(named)
    })
    if (selected.length === 0) {
      throw new EvalNamedInputError('run', named, cassettesRoot, 'replay')
    }
  }
  if (filters.product !== undefined) {
    const named = filters.product
    selected = selected.filter(entry => cassetteProductPartition(entry.cassette) === named)
  }
  selected.sort((a, b) => (a.cassette.id < b.cassette.id ? -1 : a.cassette.id > b.cassette.id ? 1 : 0))

  const notices: string[] = []
  if (sourceRoot.notice !== undefined) notices.push(sourceRoot.notice)
  const zeroJudge = (configured: boolean): ReplayJudgeCounters => ({
    configured,
    invoked: 0,
    settled: 0,
    abstained: 0,
    errors: 0,
    notInvoked: 0,
  })

  // (4) empty batch: exit-0 data, no planner/judge resolution spend (D-02).
  if (selected.length === 0) {
    notices.push(`empty sweep — no ${source} cassette bundles matched`)
    return {
      batchKey: 'empty',
      swept,
      replayed: 0,
      loadRefusals,
      replayRefusals: {},
      scored: 0,
      judge: zeroJudge(session.evalConfig.judge !== undefined),
      replaysRoot,
      source,
      notices,
      spend: replayInvocationSpend([], session.evalConfig.seed, 0, started, activeCorpus?.calibration),
    }
  }

  const batchKey = computeBatchKey(selected.map(entry => entry.cassette.id))

  // (5) planner + judge through the run-parity named-LLM chain (D-03). resolveEvalJudge takes
  // ONE argument: any `--judge` flag was already field-wise merged into session.evalConfig.
  const planner = await resolveReplayPlanner(session)
  const judgeResolution = await resolveEvalJudge(session)
  if (judgeResolution.notice !== undefined) notices.push(judgeResolution.notice)

  // (6) the replay loop, in sorted id order, everything under the ONE batchKey audit dir (D-07).
  const replayBaseDir = evalAuditDir(session.configDir, 'replay', batchKey)
  const recordStore = new FsReplayRecordStore({ root: agentQaRoot })
  const scoreStore = new FsScoreStore({ root: agentQaRoot })
  let modelCalls = 0
  const { replayed, replayRefusals, replayedDirs, notices: replayNotices } =
    await sweepCassetteReplays({
      selected,
      labelRecords: activeCorpus?.snapshot.labelsById,
      profile: planner.profile,
      auth: planner.auth,
      modelCallObservation: { onProviderCall: () => { modelCalls++ } },
      ...(opts.plannerOverrides !== undefined ? { modelOverrides: opts.plannerOverrides } : {}),
      ...(session.evalConfig.k !== undefined ? { k: session.evalConfig.k } : {}),
      ...(session.evalConfig.seed !== undefined ? { seed: session.evalConfig.seed } : {}),
      ...(judgeResolution.judge !== undefined
        ? {
            judge: {
              ...judgeResolution.judge,
              ...(opts.judgeOverrides !== undefined ? { modelOverrides: opts.judgeOverrides } : {}),
            },
          }
        : {}),
      maskingContextFactory: session.maskingContextFactory,
      replayOutputBaseDir: replayBaseDir,
      recordStore,
      scoreStore,
      replaysRoot,
      // Progress ALWAYS rides stderr — stdout stays reserved for the rendered DTO.
      onProgress: id => process.stderr.write(`replay: ${id}\n`),
    })
  notices.push(...replayNotices)

  // (7) fold judge dispositions FROM the persisted score records — never recomputed (D-04).
  const judge = zeroJudge(judgeResolution.judge !== undefined)
  let scored = 0
  for (const recordDir of replayedDirs) {
    const replay = loadReplayRecord(recordDir)
    const load = loadScoreRecord(recordDir)
    if (replay.kind !== 'loaded') {
      notices.push(`spend replay read refused under ${recordDir}: ${replay.refusal.detail}`)
    }
    if (load.kind === 'absent') continue
    if (load.kind === 'refused') {
      notices.push(`score read refused under ${recordDir}: ${load.refusal.detail}`)
      continue
    }
    scored++
    foldJudgeDispositions(load.record.score, judge)
  }
  const spendBatch = assembleScoredBatch({ replaysRoot, cassettesRoot, source,
    recordDirs: replayedDirs, labelRecords: activeCorpus?.snapshot.labelsById,
    corpusEntriesById: activeCorpus?.corpusEntriesById,
    excludedLabelIds: activeCorpus?.snapshot.excludedLabelIds,
    calibration: activeCorpus?.calibration })
  notices.push(...spendBatch.notices)

  return {
    batchKey,
    swept,
    replayed,
    loadRefusals,
    replayRefusals,
    scored,
    judge,
    replaysRoot,
    source,
    notices,
    spend: replayInvocationSpend(spendBatch.entries, session.evalConfig.seed, modelCalls, started, spendBatch.calibration),
  }
}

/**
 * Fold one persisted CassetteScore's judge stamps into the DTO counters — the exact
 * buildEvalReport disposition read (metrics.ts), scalar-summed for the summary surface (D-04).
 */
function foldJudgeDispositions(score: CassetteScore, judge: ReplayJudgeCounters): void {
  const entries: readonly DecisionScoreEntry[] =
    score.kind === 'leaf' ? [score.entry] : score.kind === 'procedure' ? score.entries : []
  for (const entry of entries) {
    if (entry.kind !== 'decision') continue
    const decision = entry.score
    if (decision.kind === 'unresolved-tie') {
      const outcome = decision.judgeOutcome
      if (outcome === undefined) continue
      if (outcome.kind === 'abstained') {
        judge.abstained++
        judge.invoked++
      } else if (outcome.kind === 'judge-error') {
        judge.errors++
        judge.invoked++
      } else {
        judge.notInvoked++
      }
    } else if (decision.kind === 'scored' && decision.judgeSettled !== undefined) {
      judge.settled++
      judge.invoked++
    }
  }
}

/**
 * Resolve the configured judge (D-03/D-10). An absent `eval.judge` is a typed no-judge notice —
 * unresolved ties will record not-invoked. A resolvable judge flows through the named-LLM chain;
 * a judge whose model family equals the planner's family — or resolves to no family at all —
 * carries a stderr-destined warning notice. The preflight is SOFT: assessJudgeEligibility inside
 * runCassetteReplay stays the per-cassette authority (D-10).
 *
 * eval.judgeAllowSameFamily (owner override of D-10, 2026-07-12): when true, the flag is
 * threaded verbatim onto the judge bundle's allowSameFamily; a KNOWN-same-family pair then
 * yields an override-active ADVISORY instead of the refusal warning. Unknown families keep
 * the refusal-style notice regardless — the opt-in never relaxes unknown ⇒ forbidden.
 */
export async function resolveEvalJudge(session: EvalSession): Promise<{
  judge?: { profile: ModelProfile; auth: ResolvedModelAuth; allowSameFamily?: boolean }
  notice?: string
}> {
  if (!session.evalConfig.judge) {
    return {
      notice: 'no judge configured — unresolved ties will record not-invoked{no-judge-configured}',
    }
  }

  const resolved = await resolveNamedProfile(session.evalConfig.judge, session.configPath)
  const planner = await resolveReplayPlanner(session)
  const judgeFamily = resolveJudgeFamily(resolved.profile.model)
  const plannerFamily = resolveJudgeFamily(planner.profile.model)
  const overrideActive = session.evalConfig.judgeAllowSameFamily === true
  const judge = overrideActive ? { ...resolved, allowSameFamily: true } : resolved

  if (judgeFamily !== undefined && plannerFamily !== undefined && judgeFamily === plannerFamily
    && overrideActive) {
    return {
      judge,
      notice:
        `D-10 override active (eval.judgeAllowSameFamily, owner decision 2026-07-12): judge model ` +
        `"${resolved.profile.model}" and planner model "${planner.profile.model}" share the ` +
        `judge family '${judgeFamily}' — same-family judging runs and every scored entry ` +
        'discloses familyOverride: same-family-allowed',
    }
  }

  if (judgeFamily === undefined || plannerFamily === undefined || judgeFamily === plannerFamily) {
    return {
      judge,
      notice:
        `judge model "${resolved.profile.model}" and planner model "${planner.profile.model}" ` +
        'resolve to the same or unknown family — per-cassette judge eligibility will refuse ' +
        'self-judging and ties may record not-invoked',
    }
  }

  return { judge }
}

/**
 * Resolve the replay planner from the config's `use.llm` named entry through the same
 * resolveNamedConfig → resolveModelAuth → toModelProfileAndAuth chain run uses (D-03).
 * An absent `use.llm` is a typed Error (unknown names throw llm-utils' typed
 * available-names error).
 */
export async function resolveReplayPlanner(
  session: EvalSession,
): Promise<{ profile: ModelProfile; auth: ResolvedModelAuth }> {
  const plannerName = session.config.use?.llm
  if (!plannerName) {
    throw new Error(
      'use.llm is not set in the config — the replay planner is the named use.llm registry entry. '
      + 'Set use.llm in agent-qa.config.yaml.',
    )
  }
  return resolveNamedProfile(plannerName, session.configPath)
}

// D-01: three same-seed repeats establish the recorded minimum spread.
export const FLOOR_DEFAULT_REPEATS = 3
// D-01: the recorded pair adds one whole-corpus run under a second seed.
export const FLOOR_DEFAULT_SEEDS = [11, 29] as const
// D-15: fixed resampling seed makes the bootstrap disclosure reproducible.
export const FLOOR_DEFAULT_BOOTSTRAP_SEED = 7

// 420 D-13: twenty joined gold sources per global noisy channel is the recorded floor.
// Wilson intervals disclose finite-sample uncertainty; products never get separate tiny fits.
export const LABEL_CALIBRATION_MIN_GOLD = 20

export type CalibrateVerbResult = Extract<RunLabelCalibrationResult, { artifact: unknown }>
  | { kind: Exclude<RunLabelCalibrationResult['kind'], 'dry-run' | 'committed' | 'unchanged'>; reason: string }

/** Only the explicit operator command calls this producer; no model or credential resolution. */
export async function runCalibrateVerb(session: EvalSession, opts: {
  commit?: boolean; replace?: boolean; minGold?: number
} = {}): Promise<CalibrateVerbResult> {
  const minGold = opts.minGold ?? LABEL_CALIBRATION_MIN_GOLD
  if (!Number.isSafeInteger(minGold) || minGold < 2) {
    return { kind: 'refused', reason: '--min-gold must be a safe integer of at least 2.' }
  }
  if (opts.replace && !opts.commit) return { kind: 'refused', reason: '--replace requires --commit.' }
  const result = await runLabelCalibration({
    committedRoot: resolve(session.configDir, 'agent-qa-eval'),
    agentQaRoot: resolve(session.configDir, '.agent-qa'),
    reportOutputBaseDir: evalAuditDir(session.configDir, 'calibrate', 'labels'),
    commit: opts.commit, replace: opts.replace,
    minGold: { value: minGold, source: opts.minGold === undefined ? 'default' : 'cli' },
  })
  if ('artifact' in result) return result
  // Never echo input-bearing paths or detector labels in either output format.
  const reasons = {
    refused: 'Calibration inputs unavailable or invalid; inspect committed labels and run evidence.',
    busy: 'Another calibration publisher holds the lock; retry after it finishes.',
    'input-drift': 'Calibration inputs changed; retry from the current snapshot.',
    'publication-failed': 'Calibration publication interrupted; retry the identical command.',
    'write-conflict': 'Calibration bytes conflict; review the dry-run, then use --commit --replace to replace the marker. Immutable revision conflicts require inspection.',
    'egress-blocked': 'Calibration output was blocked by the egress checkpoint; inspect the local audit and mask source evidence before retrying.',
  }
  return { kind: result.kind, reason: reasons[result.kind] }
}

// 417 D-19: 51 demo collateral + one target + four cross-check screens = 56; next power of two.
export const GATE1_DEFAULT_MAX_SCREENS = 64
// 417 D-12: smallest odd k whose ceil(k/2)+1 is a strict supermajority.
export const GATE1_DEFAULT_K = 3

// 2026-09-07, 418 D-04: k=3 costs 2 fresh with-record + 3 without-record calls.
// At 415's ~8 s / ~30k prompt tokens per call, four ablations bound a run to
// ~20 calls / ~2.5 min, covering the <=2 cold-start reservation plus lower-trust actives.
export const GATE2_DEFAULT_MAX_ABLATIONS = 4

// 2026-09-07, 418 D-13: the >=5-unconfirmed-builds staleness law is the sizing
// precedent: five natural builds with an unexercised anchor form a quiet horizon.
export const GATE2_DEFAULT_CANARY_HORIZON_BUILDS = 5

export function resolveGate2Caps(session: EvalSession, opts: { maxAblations?: number } = {}) {
  const maxAblations = opts.maxAblations ?? session.evalConfig.gate2?.maxAblations ?? GATE2_DEFAULT_MAX_ABLATIONS
  if (!Number.isSafeInteger(maxAblations) || maxAblations < 1) {
    throw new TypeError('--max-ablations must be a positive integer')
  }
  const maxAblationsSource = opts.maxAblations !== undefined ? 'flag' as const
    : session.evalConfig.gate2?.maxAblations !== undefined ? 'config' as const : 'default' as const
  const canaryHorizonBuilds = session.evalConfig.gate2?.canaryHorizonBuilds ?? GATE2_DEFAULT_CANARY_HORIZON_BUILDS
  const maxLowerTrustPerScope = session.evalConfig.gate2?.maxLowerTrustPerScope ?? GATE2_DEFAULT_MAX_LOWER_TRUST_PER_SCOPE
  for (const [name, value] of Object.entries({ canaryHorizonBuilds, maxLowerTrustPerScope })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`eval.gate2.${name} must be a positive integer`)
  }
  return { maxAblations, maxAblationsSource, canaryHorizonBuilds, maxLowerTrustPerScope,
    canaryHorizonBuildsSource: session.evalConfig.gate2?.canaryHorizonBuilds === undefined ? 'default' as const : 'config' as const,
    maxLowerTrustPerScopeSource: session.evalConfig.gate2?.maxLowerTrustPerScope === undefined ? 'default' as const : 'config' as const,
  }
}

export function readCanaryCorpusDigest(session: EvalSession): import('./curation/canary-credit.js').CanaryCorpusDigestResult {
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  try {
    lstatSync(committedRoot)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'no-eval-root' }
      : { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
  }
  return readCommittedCorpusDigest({ committedRoot })
}

export interface RunCanaryAblationInput {
  agentQaRoot: string
  recordId: string
  target: { runId: string; testId: string; stepIndex: number }
  attributedObservationId: string
  k?: number
  seed?: number
  plannerOverrides?: ModelProviderOverrides
}

export async function runCanaryAblation(session: EvalSession, input: RunCanaryAblationInput) {
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const digest = readCanaryCorpusDigest(session)
  if (digest.kind !== 'digest') return digest
  const k = input.k ?? session.evalConfig.k ?? GATE1_DEFAULT_K
  if (!Number.isSafeInteger(k) || k < 3 || k % 2 === 0) {
    throw new TypeError('--k must be an odd integer of at least 3')
  }
  const identity = await resolveGateProfileIdentity(session, input.plannerOverrides)
  const floor = listNoiseFloorArtefacts(committedRoot).artefacts.find(
    (entry) => entry.artefact.profileKey === identity.profileKey,
  )?.artefact
  const baseSeed = input.seed ?? session.evalConfig.seed ?? floor?.seeds[0] ?? 11
  const execution = await resolveEvalSession({ configPath: session.configPath })
  const planner = await resolveReplayPlanner(execution)
  return ablateCanaryStep({
    agentQaRoot: input.agentQaRoot, committedRoot, recordId: input.recordId,
    target: input.target, attributedObservationId: input.attributedObservationId, k, baseSeed,
    replay: { profile: planner.profile, auth: planner.auth,
      modelOverrides: input.plannerOverrides, maskingContextFactory: execution.maskingContextFactory },
  })
}

export function isFeedbackStateNovel(session: EvalSession, input: { agentQaRoot: string; product: string; stateDigest: string }): boolean {
  const digest = readCanaryCorpusDigest(session)
  if (digest.kind === 'no-eval-root') return false
  if (digest.kind !== 'digest') throw new TypeError('feedback corpus unavailable')
  return isNovelState({ ...input, committedRoot: resolve(session.configDir, 'agent-qa-eval') })
}
export async function runFeedbackStaging(session: EvalSession, input: Omit<StageFeedbackEntryInput, 'committedRoot' | 'policy' | 'auditSink'>) {
  const digest = readCanaryCorpusDigest(session)
  if (digest.kind !== 'digest') return digest
  return stageFeedbackEntry({ ...input, committedRoot: resolve(session.configDir, 'agent-qa-eval'),
    auditSink: new JsonlAuditSink(join(input.agentQaRoot, 'eval/audit/feedback', slugBranch(input.attributedObservationId))) })
}

export interface SeedFromFeedbackVerbResult {
  kind: 'admitted' | 'dry-run' | 'nothing-staged' | 'refused'
  reason?: string
  entries: { cassetteId: string; product: string; split: 'natural'; source: 'canary-feedback'; benefit: import('@vostride/agent-qa-schema').Benefit;
    attributedObservationId: string; runId: string; stepIndex: number; captured_at_ordinal: number }[]
  refusals: import('@vostride/agent-qa-eval-local').AdmitStagedFeedbackResult['refusals']
  staleReceipts: ReturnType<typeof LOCAL_CURATION_CAPABILITIES.readStandingGateReceipts> | null
  writesStarted: boolean
  failures: (import('@vostride/agent-qa-eval-local').AdmitStagedFeedbackResult['failures'][number]
    | { phase: 'before-write'; reason: 'feedback-unavailable' | 'no-eval-root' | 'corpus-unavailable' })[]
  previousCorpusDigest?: string
  nextCorpusDigest?: string
  stagingDir: string
  floorCommand: string
}

export async function runSeedFromFeedbackVerb(session: EvalSession, opts: {
  agentQaRoot: string; product?: string; dryRun: boolean; knowledgeRoot?: string
  readStandingGateReceipts?: typeof LOCAL_CURATION_CAPABILITIES.readStandingGateReceipts
}): Promise<SeedFromFeedbackVerbResult> {
  const stagingDir = join(opts.agentQaRoot, FEEDBACK_STAGING_SUBDIR)
  // This is the actual registered floor measurement verb. Measuring does not silently replace
  // a standing write-once floor, and no new model call occurs during feedback admission itself.
  const configArg = `'${resolve(session.configPath).replaceAll("'", "'\"'\"'")}'`
  const floorCommand = `agent-qa --config ${configArg} eval floor`
  const base = { entries: [], refusals: [], staleReceipts: [], writesStarted: false, failures: [], stagingDir, floorCommand }
  const digest = readCanaryCorpusDigest(session)
  if (digest.kind !== 'digest') {
    const reason = digest.kind === 'no-eval-root' ? 'no-eval-root' : 'corpus-unavailable'
    return { ...base, kind: 'refused', reason, failures: [{ phase: 'before-write', reason }] }
  }
  try {
    // Read standing DATA before the operator's write. Gate3 has no digest and is never invented stale.
    const receipts = opts.knowledgeRoot !== undefined && opts.readStandingGateReceipts !== undefined
      ? opts.readStandingGateReceipts({ knowledgeRoot: opts.knowledgeRoot }) : []
    const result = await admitStagedFeedback({ ...opts, committedRoot: resolve(session.configDir, 'agent-qa-eval'),
      seedingOutputBaseDir: evalAuditDir(session.configDir, 'seed', 'feedback') })
    const selected = opts.dryRun ? result.entries : result.admitted
    const entries = selected.map(entry => ({ cassetteId: entry.extracted.cassette.id, product: entry.product,
      split: 'natural' as const, source: 'canary-feedback' as const, benefit: entry.benefit,
      attributedObservationId: entry.attributedObservationId, runId: entry.runId, stepIndex: entry.stepIndex,
      captured_at_ordinal: entry.extracted.cassette.receipt.buildOrdinal }))
    const moves = opts.dryRun ? entries.length > 0 : result.nextCorpusDigest === undefined ? undefined : result.nextCorpusDigest !== result.previousCorpusDigest
    const refused = result.refusals.length > 0 || result.failures.length > 0
    return { kind: refused ? 'refused' : result.entries.length === 0 ? 'nothing-staged' : opts.dryRun ? 'dry-run' : 'admitted',
      ...(refused ? { reason: 'admission-refused' } : {}), entries, refusals: result.refusals,
      writesStarted: result.writesStarted, failures: result.failures,
      staleReceipts: moves === undefined ? null : moves ? receipts.filter(receipt => receipt.corpusDigest === result.previousCorpusDigest) : [],
      previousCorpusDigest: result.previousCorpusDigest,
      ...(result.nextCorpusDigest === undefined ? {} : { nextCorpusDigest: result.nextCorpusDigest }), stagingDir, floorCommand }
  } catch {
    return { ...base, kind: 'refused', reason: 'feedback-unavailable',
      failures: [{ phase: 'before-write', reason: 'feedback-unavailable' }], previousCorpusDigest: digest.corpusDigest }
  }
}

/** Resolve the existing host roots once for the command; the verb also accepts explicit test DATA. */
export function feedbackSeedHostOptions(session: EvalSession) {
  return { agentQaRoot: resolve(session.configDir, '.agent-qa'),
    knowledgeRoot: resolveKnowledgeRoot(session.config.knowledge, session.configDir),
    readStandingGateReceipts: LOCAL_CURATION_CAPABILITIES.readStandingGateReceipts }
}

// Preserve the existing eval composition boundary; the DATA bridge imports this lazily.
export { runReplayGate, serializeReplayGateReceipt, readLabelCalibration } from '@vostride/agent-qa-eval-local'
export type { RunReplayGateInput, RunReplayGateResult } from '@vostride/agent-qa-eval-local'
export type ReplayGateVerbResult = import('./gates/replay-gate-host.js').ReplayGateVerbResult & {
  maxScreens: number
  maxScreensSource: 'flag' | 'config' | 'default'
  k: number
  kSource: 'flag' | 'config' | 'default'
}

export interface ReplayGateVerbOptions {
  resolveTrustPriors?: import('./curation/trust-priors.js').ResolveTrustPriors
  /** Host runtime artifacts and audit root; config and committed roots remain config-relative. */
  agentQaRoot?: string
  k?: number
  maxScreens?: number
  dryRun?: boolean
  plannerOverrides?: ModelProviderOverrides
  judgeOverrides?: ModelProviderOverrides
  clock?: () => number
  onProgress?: (line: string) => void
}

export async function runReplayGateVerb(
  session: EvalSession,
  candidateId: string,
  opts: ReplayGateVerbOptions = {},
): Promise<ReplayGateVerbResult> {
  const k = opts.k ?? session.evalConfig.k ?? GATE1_DEFAULT_K
  if (!Number.isSafeInteger(k) || k < 3 || k % 2 === 0) {
    throw new TypeError('--k must be an odd integer of at least 3')
  }
  const kSource =
    opts.k !== undefined ? 'flag' : session.evalConfig.k !== undefined ? 'config' : 'default'
  const maxScreens =
    opts.maxScreens ?? session.evalConfig.gate1?.maxScreens ?? GATE1_DEFAULT_MAX_SCREENS
  const maxScreensSource = opts.maxScreens !== undefined ? 'flag'
    : session.evalConfig.gate1?.maxScreens !== undefined ? 'config' : 'default'
  if (!Number.isSafeInteger(maxScreens) || maxScreens < 1) {
    throw new TypeError('--max-screens must be a positive integer')
  }
  const identity = await resolveGateProfileIdentity(session, opts.plannerOverrides)
  const profile = await resolveReplayProfileDeclaration(session)
  // A key-only session deliberately has no masker. Prepare the full run-parity session only
  // when the composition crosses its spend boundary, before resolving provider credentials.
  let execution: Promise<EvalSession> | undefined
  let maskingContextFactory = session.maskingContextFactory
  const prepare = () =>
    (execution ??= resolveEvalSession({
      configPath: session.configPath,
      flags: { judge: session.evalConfig.judge },
    }).then((full) => {
      maskingContextFactory = full.maskingContextFactory
      return full
    }))
  let judge: import('@vostride/agent-qa-eval-local').RunReplayGateInput['judge']
  if (session.evalConfig.judge !== undefined) {
    const { resolveNamedConfig } = await import('./llm-utils.js')
    const { config } = await resolveNamedConfig(session.evalConfig.judge, session.configPath)
    judge = {
      profile: {
        provider: config.provider,
        model: config.model,
        auth: { mode: 'none' },
        ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
        ...(config.providerHeaders === undefined ? {} : { headers: config.providerHeaders }),
      },
      modelOverrides: opts.judgeOverrides,
      resolveAuth: async () => {
        const resolved = await resolveEvalJudge(await prepare())
        if (resolved.judge === undefined) throw new Error('configured Gate 1 judge disappeared')
        return resolved.judge.auth
      },
    }
  }
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const floor = listNoiseFloorArtefacts(committedRoot).artefacts.find(
    (entry) => entry.artefact.profileKey === identity.profileKey,
  )?.artefact
  const { createReplayGateHost } = await import('./gates/replay-gate-host.js')
  const result = await createReplayGateHost({
    ...(opts.resolveTrustPriors === undefined ? {} : { resolveTrustPriors: opts.resolveTrustPriors }),
    configPath: session.configPath,
    agentQaRoot: opts.agentQaRoot ?? resolve(session.configDir, '.agent-qa'),
    record: opts.dryRun !== true,
    session: { ...session, maskingContextFactory: () => maskingContextFactory() },
    composition: {
      identity,
      baselineWarmup: { configPath: session.configPath, judge: session.evalConfig.judge },
      k,
      kSource,
      maxScreens,
      planner: {
        profile,
        modelOverrides: opts.plannerOverrides,
        resolveAuth: async () => (await resolveReplayPlanner(await prepare())).auth,
      },
      judge,
      judgeOverrideConfigured: session.evalConfig.judgeAllowSameFamily === true,
      baselineSeed:
        session.evalConfig.seed !== undefined
          ? { seed: session.evalConfig.seed, source: 'config' }
          : { floorSeeds: floor?.seeds ?? [] },
      clock: opts.clock,
      onProgress: opts.onProgress,
    },
  }).run(candidateId)
  const capNotice = `cap: maxScreens=${maxScreens} (${maxScreensSource})`
  return {
    ...result,
    maxScreens,
    maxScreensSource,
    k,
    kSource,
    notices: [...result.notices, capNotice],
    ...(result.kind === 'receipt' ? { lines: [...result.lines, capNotice] } : {}),
  }
}

/** Measurement data and write-once outcomes, rendered identically on console and JSON. */
export interface FloorVerbResult extends RunNoiseFloorMeasurementResult {
  /** Actual same-seed repeat count supplied to the measurement. */
  repeats: number
  /** Distinct seeds in run order, with the first repeated above. */
  seeds: readonly number[]
  /** Actual deterministic bootstrap seed. */
  bootstrapSeed: number
  /** True only when none of the protocol settings was overridden. */
  recordedDefaults: boolean
  /** Digest of the committed snapshot measured by the composition. */
  corpusDigest: string
  /** Only measured per-run cost lines; raw cassette progress remains stderr-only. */
  costLines: string[]
}

/** Measure the committed corpus through the shared replay/fold/write composition. */
export async function runFloorVerb(
  session: EvalSession,
  opts: {
    repeats?: number
    seeds?: readonly number[]
    bootstrapSeed?: number
    commit?: boolean
    explanation?: string
    classifierRepeatability?: string
    fromMeasured?: string
    plannerOverrides?: ModelProviderOverrides
    judgeOverrides?: ModelProviderOverrides
  } = {},
): Promise<FloorVerbResult> {
  const repeats = opts.repeats ?? FLOOR_DEFAULT_REPEATS
  const seeds = [...new Set(opts.seeds ?? FLOOR_DEFAULT_SEEDS)]
  const bootstrapSeed = opts.bootstrapSeed ?? FLOOR_DEFAULT_BOOTSTRAP_SEED
  // Refuse the protocol before named-profile resolution or credentials can be needed.
  if (!Number.isSafeInteger(repeats) || repeats < FLOOR_PROTOCOL_MINIMUM.repeats
    || seeds.length < FLOOR_PROTOCOL_MINIMUM.seeds || !seeds.every(Number.isSafeInteger)) {
    throw new FloorProtocolError()
  }
  if (!Number.isSafeInteger(bootstrapSeed)) throw new TypeError('--bootstrap-seed must be a safe integer')
  let classifierRepeatability: ClassifierRepeatability | undefined
  if (opts.classifierRepeatability !== undefined) {
    const path = resolve(session.configDir, opts.classifierRepeatability)
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      throw new TypeError(`classifier repeatability unreadable at ${path}: ${(error as Error).message}`)
    }
    const guarded = guardClassifierRepeatability(value)
    if (guarded.kind === 'rejected') {
      throw new TypeError(`classifier repeatability rejected at ${path}: ${guarded.reason}`)
    }
    classifierRepeatability = guarded.repeatability
  }
  // Recovery resolves declarations only; credential and model creation are unreachable.
  const planner = opts.fromMeasured === undefined ? await resolveReplayPlanner(session)
    : { profile: await resolveReplayProfileDeclaration(session) }
  const judgeResolution = opts.fromMeasured === undefined ? await resolveEvalJudge(session) : {}
  const judge = judgeResolution.judge === undefined ? undefined
    : { ...judgeResolution.judge, modelOverrides: opts.judgeOverrides }
  let judgeModelId = judge?.profile.model
  if (opts.fromMeasured !== undefined && session.evalConfig.judge) {
    const { resolveNamedConfig } = await import('./llm-utils.js')
    judgeModelId = (await resolveNamedConfig(session.evalConfig.judge, session.configPath)).config.model
  }
  const fingerprint = await resolveReplayProfileFingerprint(session, 'declared', opts.plannerOverrides)
  const profileKeyInputs = {
    plannerModelId: await resolvePlannerModelId(session),
    matcherVersion: buildEvalReport([]).matcherVersion,
    ...(judgeModelId === undefined ? {} : { judgeModelId, judgeVersion: JUDGE_CONFIG.judgeVersion }),
  }
  const profileKey = composeBaselineProfileKey({ ...profileKeyInputs, fingerprint })
  const costLines: string[] = []
  const result = await runNoiseFloorMeasurement({
    committedRoot: resolve(session.configDir, 'agent-qa-eval'),
    cassettesRoot: resolveCassettesRoot(session, 'committed').cassettesRoot,
    agentQaRoot: resolve(session.configDir, '.agent-qa'),
    ...planner,
    ...(opts.fromMeasured === undefined ? {} : { fromMeasured: resolve(session.configDir, opts.fromMeasured) }),
    modelOverrides: opts.plannerOverrides,
    judge,
    maskingContextFactory: session.maskingContextFactory,
    profileKeyInputs,
    seeds, repeats, bootstrapSeed, classifierRepeatability,
    explanation: opts.explanation,
    commit: opts.commit === true,
    reportOutputBaseDir: evalAuditDir(session.configDir, 'floor', profileKey),
    onProgress: line => {
      if (/^floor r\d+ seed=/.test(line)) costLines.push(line)
      process.stderr.write(line + '\n')
    },
  })
  const notices = [...result.notices]
  if (judgeResolution.notice !== undefined) notices.unshift(judgeResolution.notice)
  if (result.committed?.kind === 'refused') notices.push(renderFloorRefusal(result.committed.refusal))
  return {
    ...result, notices, repeats, seeds, bootstrapSeed, costLines,
    recordedDefaults: opts.repeats === undefined && opts.seeds === undefined && opts.bootstrapSeed === undefined,
    corpusDigest: result.artefact.corpusDigest,
  }
}

/** Invocation context added to either the verdict or exact-file refusal arm. */
interface GateVerbContext {
  /** Resolved seed; offline reads disclose selection without making a new call. */
  seed: number
  /** The winning seed declaration, in flag/config/floor/default priority. */
  seedSource: 'flag' | 'config' | 'floor' | 'default'
  /** Absolute directories actually probed, in order; empty for a fresh run. */
  probedDirs: string[]
}

/** Preserve the composition's refusal and actual invocation-observation contracts verbatim. */
export type GateVerbResult = GateVerbContext & (
  | (Extract<RunReleaseGateResult, { kind: 'verdict' }> & {
      /** Absolute actual report path; relative --staged-dir resolves against session.configDir. */
      currentReportFile: string
    })
  | Extract<RunReleaseGateResult, { kind: 'refused' }>
)

/** One fresh replay or a credential-free saved-report comparison through the shared gate. */
export async function runGateVerb(
  session: EvalSession,
  opts: {
    report?: string
    stagedDir?: string
    seed?: number
    plannerOverrides?: ModelProviderOverrides
    judgeOverrides?: ModelProviderOverrides
  } = {},
): Promise<GateVerbResult> {
  if (opts.stagedDir !== undefined && opts.report === undefined) {
    throw new TypeError('--staged-dir requires --report <batchKey>')
  }
  const declaredSeed = opts.seed ?? session.evalConfig.seed
  if (declaredSeed !== undefined && !Number.isSafeInteger(declaredSeed)) {
    throw new TypeError('--seed must be a safe integer')
  }
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const { plannerModelId, judgeModelId, judgeVersion, fingerprint, matcherVersion, profileKey } =
    await resolveGateProfileIdentity(session, opts.plannerOverrides)
  const profileKeyInputs = {
    plannerModelId, matcherVersion,
    ...(judgeModelId === undefined ? {} : { judgeModelId, judgeVersion }),
  }
  const floorPath = join(committedRoot, committedNoiseFloorPath(profileKey))
  const floorSeed = declaredSeed === undefined
    ? listNoiseFloorArtefacts(committedRoot).artefacts.find(entry =>
      entry.path === floorPath && entry.profileKey === profileKey)?.artefact.seeds[0] : undefined
  const seed = declaredSeed ?? floorSeed ?? FLOOR_DEFAULT_SEEDS[0]
  const seedSource: GateVerbContext['seedSource'] = opts.seed !== undefined ? 'flag'
    : session.evalConfig.seed !== undefined ? 'config' : floorSeed !== undefined ? 'floor' : 'default'
  const probedDirs: string[] = []
  const notices: string[] = []
  let mode: ReleaseGateMode
  if (opts.report !== undefined) {
    const choices = opts.stagedDir !== undefined
      ? [{ dir: resolve(session.configDir, opts.stagedDir), label: '--staged-dir' }]
      : [
          { dir: join(agentQaRoot, 'eval', 'gate', slugBranch(profileKey), 'reports'), label: 'gate root' },
          { dir: join(agentQaRoot, DEFAULT_EVAL_REPORTS_SUBDIR), label: 'default staging root' },
        ]
    const files: string[] = []
    let stagedOutputDir: string | undefined
    for (const choice of choices) {
      probedDirs.push(choice.dir)
      const file = join(choice.dir, `${slugBranch(opts.report)}.json`)
      files.push(file)
      try {
        lstatSync(file)
      } catch (error) {
        // Only absence permits fallback. Malformed/unreadable data (even a dangling link)
        // selects this root and reaches the composition's exact-file guarded refusal.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      }
      stagedOutputDir = choice.dir
      notices.push(`gate --report: reading ${file} (${choice.label})`)
      break
    }
    if (stagedOutputDir === undefined) {
      return { kind: 'refused', refusal: { path: files[files.length - 1]!,
        reason: `staged report absent; probed ${files.join(', ')}` }, notices,
        seed, seedSource, probedDirs }
    }
    mode = { kind: 'report', batchKey: opts.report, stagedOutputDir,
      profile: await resolveReplayProfileDeclaration(session), modelOverrides: opts.plannerOverrides }
  } else {
    const planner = await resolveReplayPlanner(session)
    const judgeResolution = await resolveEvalJudge(session)
    if (judgeResolution.notice !== undefined) notices.push(judgeResolution.notice)
    mode = {
      kind: 'fresh', ...planner, modelOverrides: opts.plannerOverrides,
      judge: judgeResolution.judge === undefined ? undefined
        : { ...judgeResolution.judge, modelOverrides: opts.judgeOverrides },
      maskingContextFactory: session.maskingContextFactory,
      seed, cassettesRoot: resolveCassettesRoot(session, 'committed').cassettesRoot,
      replayOutputBaseDir: evalAuditDir(session.configDir, 'gate', profileKey),
      onProgress: line => process.stderr.write(line + '\n'),
    }
  }
  const result = await runReleaseGate({ committedRoot, agentQaRoot, profileKeyInputs, mode })
  return { ...result, notices: [...notices, ...result.notices], seed, seedSource, probedDirs }
}

// ---- the seed verb (372-07, D-01/D-12/D-16/D-17; 413-06, D-04/D-09) ---------------------------

/**
 * 413 D-04: the three verdict classes that keep a run OUT of the measurement corpus. A run whose
 * failure is not attributable to the product under test — an overlay-interrupted or app-drifted
 * environment, a timeout, a retry-passed flake — measures the harness, not the planner, so it is
 * excluded and COUNTED rather than quietly admitted. Spelled locally on purpose: the same set
 * exists as `NON_ATTRIBUTABLE_FAILURES` in the agent package's canary fold
 * (`packages/agent/src/.../emit-canary-outcomes.ts`), and importing across that boundary would
 * mint an edge the arch contract forbids — the two spellings are the same closed vocabulary.
 */
const EXCLUDED_VERDICT_CLASSES: ReadonlySet<Verdict['class']> = new Set<Verdict['class']>(
  // 414 D-02: the local literal triplet is gone. `EXCLUSION_CLASSES` is the SAME closed
  // vocabulary, and it now also decides what the committed exclusion record admits — a second
  // spelling here could let the seeder drop a run the record schema would refuse to describe.
  EXCLUSION_CLASSES,
)

/** True for exactly the classes the committed exclusion record admits (414 D-02). */
function isExclusionVerdict(
  verdict: SeedRunVerdictRow['verdicts'][number],
): verdict is { class: ExclusionClass; producer: Verdict['producer'] } {
  return EXCLUDED_VERDICT_CLASSES.has(verdict.class)
}

/**
 * 414 D-07: a product's FIRST partition needs both fraction flags, and there is no default
 * anywhere to fall back on — a threshold is chosen after the floor is measured, so guessing one
 * here would silently pick the corpus's held-out set.
 */
export class EvalPartitionFlagsRequiredError extends Error {
  readonly products: readonly string[]

  constructor(products: readonly string[]) {
    super(
      `partition of ${products.join(', ')} requires --held-out-fraction and --private-fraction `
        + 'on its first seed (414 D-07); no default exists',
    )
    this.name = 'EvalPartitionFlagsRequiredError'
    this.products = products
  }
}

/**
 * 414 D-05: the committed manifest disagrees with the supplied fractions. The writer answered
 * `write-conflict` and nothing was touched.
 */
export class EvalPartitionManifestConflictError extends Error {
  readonly product: string
  readonly path: string

  constructor(product: string, path: string) {
    super(
      `partition manifest for ${product} at ${path}: write-conflict — the committed manifest `
        + 'disagrees with the supplied fractions; changing a manifest is a reviewed git edit and '
        + 'a named migration (414 D-05)',
    )
    this.name = 'EvalPartitionManifestConflictError'
    this.product = product
    this.path = path
  }
}

/** One product's partition manifest as the seed DTO echoes it — the DIGEST, never the salt (D-17). */
export interface SeedPartitionRow {
  product: string
  /** Committed-root-relative manifest path. */
  path: string
  outcome: 'written' | 'unchanged'
  /** sha256hex over the committed salt — the raw salt never leaves the manifest file (D-17). */
  saltDigest: string
  heldOutFraction: number
  privateFraction: number
  partitionVersion: number
}

/** One excluded run's committed provenance file, as the seed DTO echoes it (414 D-02). */
export interface SeedExclusionRow {
  runSlug: string
  product: string
  /** Committed-root-relative exclusion path. */
  path: string
  outcome: 'written' | 'unchanged' | 'write-conflict' | 'egress-blocked'
}

/** One run's resolved verdicts flattened to the two fields the DTO and the census print (D-04). */
export interface SeedRunVerdictRow {
  /** The run dir name the sweep visited. */
  runSlug: string
  /** The run's resolved product partition — the same key `--product` narrows on. */
  product: string
  /** Every resolved verdict's class and PRODUCER, so a floor answer is never mistaken for one. */
  verdicts: { class: Verdict['class']; producer: Verdict['producer'] }[]
}

/** The seed verb's one DTO — per-handoff SeedingReports aggregated field-wise (D-04). */
export interface SeedVerbResult {
  /** Member-grain exclusions on a mixed run; persisted handoffs retain the source evidence. */
  membersExcluded: { runSlug: string; product: string; testIndex: number;
    verdict: { class: Verdict['class']; producer: Verdict['producer'] } }[]
  admissionConflicts: { runSlug: string; product: string; path: string; reason: 'existing-run-exclusion' }[]
  silverExclusionRows: (SilverExclusion & { runSlug: string; product: string })[]
  supersededOriginalCount: number
  retirementCounts: { missing: number; conflict: number }
  /** Run dirs (with a handoff document) that entered the sweep after `--run` narrowing. */
  runsSwept: number
  /** Per-run typed skips: unreadable / version-refused handoffs (D-02, never batch errors). */
  runsSkipped: { runSlug: string; reason: string }[]
  /** Runs whose product partition differed from `--product`. */
  runsFiltered: number
  /**
   * 413 D-04: runs kept OUT of the corpus because a resolved verdict fell in
   * {@link EXCLUDED_VERDICT_CLASSES}. Each row names the run, its product and EVERY resolved
   * verdict's class + producer — the census prints these, so an exclusion is never a silent drop.
   */
  runsExcluded: SeedRunVerdictRow[]
  /**
   * 413 D-04: runs the filter admitted, carrying the verdicts they were admitted WITH — an empty
   * array is an honest clean run, and a present producer discloses whether the classification
   * came from `analyze-run` or the deterministic floor.
   */
  runsAdmitted: SeedRunVerdictRow[]
  /** Stderr-destined honesty lines: an unreadable analysis.json folded to the floor (T-413-26). */
  notices: string[]
  /** Handoffs whose SeedingPlan executed against the committed root. */
  handoffsSeeded: number
  /** Cases with at least one newly written file, summed across reports. */
  seededCount: number
  /** Cases whose every file was byte-identical (D-17 idempotent no-op), summed. */
  unchangedCount: number
  /** Typed per-case refusals concatenated verbatim — never silent (T-371-18). */
  refusals: SeedingRefusal[]
  /** Matcher skips counted across reports — never silent (T-371-18). */
  pairSkips: number
  /** Sampler exclusions counted across reports — never silent. */
  silverExclusions: number
  /** Both pair classes summed so a starved channel is visible (D-07). */
  pairCounts: { total: number; sameState: number; differingState: number }
  /** D-04 contracts-projection outcomes folded by kind (written/unchanged/write-conflict). */
  contracts: Record<string, number>
  /** D-15 scaffold outcomes (gitignore + root marker) folded by kind. */
  scaffold: Record<string, number>
  /**
   * 414 D-05/D-06/D-07: one row per admitted product's partition manifest — minted on the
   * product's first seed, echoed `unchanged` on every later one. `saltDigest` is the ONLY salt
   * fact that leaves the manifest file (D-17).
   */
  partitions: SeedPartitionRow[]
  /**
   * 414 D-02: one row per excluded run's committed provenance file. An exclusion that leaves no
   * committed trace is an unauditable deletion, so every row the D-04 filter drops writes one.
   */
  exclusionsWritten: SeedExclusionRow[]
  /** ALWAYS `<configDir>/agent-qa-eval` (spec §B7 target-project posture, D-12). */
  committedRoot: string
}

/**
 * The seed verb pipeline (D-01's explicit fourth verb): enumerate handoffs exactly like
 * runExtractVerb (same `--run`/`--product` vocabulary, same typed named-input error, same
 * version-guarded loads with typed skips); per handoff, RE-extract via extractRunCassettes
 * (deterministic — same ids/bytes as the extract verb, D-02; never reconstructed from staged
 * bundles), let buildSeedingPlan decide (eval core is the ONLY decision-maker, D-16), and hand
 * the plan verbatim to seedCommittedCorpus — the CLI adds NO selection or labeling logic.
 * The committed root is ALWAYS `<configDir>/agent-qa-eval`; no flag can retarget it (D-12).
 * Guardrail audit rows land under the D-07 per-run seed audit dirs via the helper's own sink.
 */
export async function runSeedVerb(
  session: EvalSession,
  filters: { run?: string; product?: string } = {},
  params: {
    silverPerTestCap?: number
    /** 414 D-07: REQUIRED on a product's first partition; no default exists anywhere. */
    heldOutFraction?: number
    /** 414 D-07: REQUIRED on a product's first partition; no default exists anywhere. */
    privateFraction?: number
  } = {},
): Promise<SeedVerbResult> {
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const runsRoot = resolve(agentQaRoot, RUNS_SUBDIR)
  let runSlugs = listRunSlugsWithHandoff(runsRoot)

  if (filters.run !== undefined) {
    const named = filters.run
    runSlugs = runSlugs.filter(slug => slug === named || slug === slugBranch(named))
    if (runSlugs.length === 0) {
      throw new EvalNamedInputError('run', named, runsRoot, 'seed')
    }
  }

  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  // D-03: the explicit param wins over the config/flag-merged eval block, field-wise.
  const silverPerTestCap =
    params.silverPerTestCap ?? session.evalConfig.seeding?.silverPerTestCap

  const result: SeedVerbResult = {
    membersExcluded: [],
    admissionConflicts: [],
    silverExclusionRows: [],
    supersededOriginalCount: 0,
    retirementCounts: { missing: 0, conflict: 0 },
    runsSwept: runSlugs.length,
    runsSkipped: [],
    runsFiltered: 0,
    runsExcluded: [],
    runsAdmitted: [],
    notices: [],
    handoffsSeeded: 0,
    seededCount: 0,
    unchangedCount: 0,
    refusals: [],
    pairSkips: 0,
    silverExclusions: 0,
    pairCounts: { total: 0, sameState: 0, differingState: 0 },
    contracts: {},
    scaffold: {},
    partitions: [],
    exclusionsWritten: [],
    committedRoot,
  }

  // ---- (A) admission: every run's verdicts decided, every exclusion COMMITTED ------------------
  //
  // 414 D-02: an excluded run's provenance is written HERE, before and independently of the
  // partition pre-pass below. A dropped run's committed trace does not wait on a partition
  // decision that has nothing to do with why it was dropped: the writer is write-once (an
  // identical regen answers `unchanged`), and a phase-(B) EvalPartitionFlagsRequiredError leaves
  // the exclusion files in place ON PURPOSE — the operator learns what was excluded from the very
  // invocation that refused to partition. Never reorder (A) after (B).
  const admitted: { runSlug: string; handoff: CompletedRunHandoff; product: string; testIndexes: Set<number> }[] = []
  const initialCommitted = readCommittedCorpus(committedRoot)

  for (const runSlug of runSlugs) {
    try {
      const handoffPath = resolve(runsRoot, runSlug, HANDOFF_FILE)
      const located = relative(realpathSync(agentQaRoot), realpathSync(handoffPath))
      if (located === '..' || located.startsWith('../') || located.startsWith('..\\') || isAbsolute(located)) {
        throw new Error('seed handoff path is outside the operator run root')
      }
      // The version-guarded loader is the ONE handoff read path (D-02 typed per-run skips).
      const handoff = loadCompletedRunHandoff(handoffPath)
      if (slugBranch(handoff.runId) !== runSlug) throw new Error('seed handoff run identity does not match its directory')
      const product = resolveProductPartition(handoff.scope)
      // The product filter runs BEFORE the verdict read so `--product` still narrows the sweep
      // and a partition nobody asked about costs no artifact read.
      if (filters.product !== undefined && product !== filters.product) {
        result.runsFiltered++
        continue
      }
      const verified = loadLabelEvidence({ snapshot: initialCommitted.snapshot, agentQaRoot, incoming: handoff })
      if (!verified.handoffs.some(value => value.runId === handoff.runId)) {
        throw new Error('seed incoming handoff evidence could not be positively verified before admission')
      }
      // 413 D-04: resolve this run's verdicts and decide admission BEFORE anything touches the
      // write-once root — an admitted run cannot be un-seeded without a reviewed deletion, so the
      // filter can only ever run in front of the commit, never after it.
      const analysis = readRunAnalysisArtifact(runsRoot, runSlug, handoff.runId, result.notices)
      const row: SeedRunVerdictRow = {
        runSlug,
        product,
        verdicts: resolveSeedVerdictRows(analysis.artifact, handoff),
      }
      const excluding = row.verdicts.filter(isExclusionVerdict)
      const memberVerdicts = resolveSeedMemberVerdicts(analysis.artifact, handoff)
      const eligible = handoff.tests.filter(member => admitSeedMember(member, memberVerdicts.get(member.testIndex)))
      const hasEligibleRerun = eligible.some(member => member.isRerun)
      if (excluding.length > 0 && !hasEligibleRerun) {
        result.runsExcluded.push(row)
        // The digest names the EVIDENCE the decision was read from: the analysis bytes when an
        // artifact decided it, else the canonical resolved verdict rows the deterministic floor
        // produced. Never a digest of something that did not decide anything.
        const record = projectRunExclusion({
          runId: handoff.runId,
          runSlug,
          product,
          verdicts: excluding,
          analysisDigest:
            analysis.text === undefined
              ? sha256hex(canonicalJson(row.verdicts))
              : sha256hex(analysis.text),
        })
        const outcome = writeRunExclusion({
          record,
          committedRoot,
          seedingOutputBaseDir: evalAuditDir(session.configDir, 'seed', runSlug),
        })
        // egress-blocked and write-conflict are DATA rows on the DTO, never throws (D-08).
        result.exclusionsWritten.push({
          runSlug,
          product,
          path: committedExclusionPath(product, runSlug),
          outcome: outcome.kind,
        })
        continue
      }
      const exclusionPath = committedExclusionPath(product, runSlug)
      if (existsSync(join(committedRoot, exclusionPath))) {
        result.admissionConflicts.push({ runSlug, product, path: exclusionPath, reason: 'existing-run-exclusion' })
        result.notices.push(`seed ${runSlug}: existing run exclusion requires the reviewed exclusion path before admission`)
        continue
      }
      const testIndexes = new Set(eligible.map(member => member.testIndex))
      for (const member of handoff.tests) {
        const verdict = memberVerdicts.get(member.testIndex)
        if (!testIndexes.has(member.testIndex) && verdict) {
          result.membersExcluded.push({ runSlug, product, testIndex: member.testIndex, verdict })
        }
      }
      result.runsAdmitted.push(row)
      admitted.push({ runSlug, handoff, product, testIndexes })
    } catch (err) {
      result.runsSkipped.push({
        runSlug,
        reason: err instanceof Error ? err.message : String(err),
      })
      continue
    }
  }

  // ---- (B) the partition pre-pass: one committed manifest per admitted product ----------------
  const manifests = ensurePartitionManifests(session, admitted, committedRoot, result, params)

  // ---- (C) seeding: eval core assigns every split from the committed manifest ------------------
  for (const { runSlug, handoff, product, testIndexes } of admitted) {
    let report: ReturnType<typeof seedCommittedCorpus>
    try {
      const committed = readCommittedCorpus(committedRoot)
      const evidence = loadLabelEvidence({ snapshot: committed.snapshot, agentQaRoot, incoming: handoff })
      for (const refusal of evidence.refusals) result.notices.push(`SOFT evidence ${refusal.runId}: ${refusal.reason}`)
      if (!evidence.handoffs.some(value => value.runId === handoff.runId)) {
        throw new Error('seed incoming handoff evidence could not be positively verified')
      }
      // Only filter AFTER the full incoming bytes have matched the guarded persisted handoff.
      const admittedHandoff = { ...handoff, tests: handoff.tests.filter(member => testIndexes.has(member.testIndex)) }
      const populationHandoffs = evidence.handoffs.map(source => {
        if (source.runId === handoff.runId) return admittedHandoff
        const sourceAnalysis = readRunAnalysisArtifact(runsRoot, slugBranch(source.runId), source.runId, result.notices)
        const verdicts = resolveSeedMemberVerdicts(sourceAnalysis.artifact, source)
        return { ...source, tests: source.tests.filter(member => admitSeedMember(member, verdicts.get(member.testIndex))) }
      })
      const manifest = manifests.get(product)
      if (manifest === undefined) {
        throw new Error(`no committed partition manifest for product ${product}`)
      }
      const extraction = extractRunCassettes({
        handoff: admittedHandoff,
        artifacts: new FsRunArtifactSource({ root: agentQaRoot, runId: handoff.runId }),
      })
      // 414 D-04: the two optional provenance fields are resolved by the CALLER and stamped only
      // when they resolve. `endedAt` is the run's own clock — the cli may read a Date, eval core
      // may not — and the environment is a property of the target registry, never of the handoff.
      const targetEnvironment = resolveTargetEnvironmentForProduct(session.config, product)
      // eval core is the ONLY decision-maker (D-16); the CLI executes the plan verbatim.
      const plan = buildSeedingPlan({
        handoff: admittedHandoff,
        populationContext: { snapshot: committed.snapshot, handoffs: populationHandoffs, marks: evidence.marks },
        cassettes: extraction.cassettes,
        // 414 D-07: the split comes from the product's COMMITTED manifest params — the cli adds
        // no selection or relabel logic of its own.
        partition: partitionParamsOf(manifest),
        capturedAt: new Date(handoff.endedAt).toISOString(),
        ...(targetEnvironment === undefined ? {} : { targetEnvironment }),
        params: {
          ...(silverPerTestCap !== undefined ? { silverPerTestCap } : {}),
        },
      })
      report = seedCommittedCorpus({
        plan,
        cassettes: extraction.cassettes,
        committedRoot,
        seedingOutputBaseDir: evalAuditDir(session.configDir, 'seed', runSlug),
      })
      for (const skip of report.softEvidence?.skips ?? []) {
        result.notices.push(`SOFT evidence ${skip.runId}/${skip.testIndex}/${skip.stepIndex}/${skip.attempt}: ${skip.reason}`)
      }
    } catch (err) {
      result.runsSkipped.push({
        runSlug,
        reason: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    result.handoffsSeeded++
    result.seededCount += report.seededCount
    result.unchangedCount += report.unchangedCount
    result.supersededOriginalCount += report.supersededOriginalCount
    result.retirementCounts.missing += report.retirementCounts.missing
    result.retirementCounts.conflict += report.retirementCounts.conflict
    result.silverExclusionRows.push(...report.silverExclusions.map(row => ({ ...row, runSlug, product })))
    result.refusals.push(...report.refusals)
    result.pairSkips += report.pairSkips.length
    result.silverExclusions += report.silverExclusions.length
    result.pairCounts.total += report.pairCounts.total
    result.pairCounts.sameState += report.pairCounts.sameState
    result.pairCounts.differingState += report.pairCounts.differingState
    for (const contract of report.contracts) {
      bumpCounter(result.contracts, contract.outcome)
    }
    bumpCounter(result.scaffold, report.scaffold.gitignore)
    bumpCounter(result.scaffold, report.scaffold.marker)
  }

  return result
}

/**
 * Phase (B) of the seed verb: every admitted product ends this call with exactly one committed
 * partition manifest, and the DTO echoes what happened to each.
 *
 * D-07 ↔ D-05, reconciled. D-07 says a later seed "accepts no fraction flags"; D-05 says a later
 * invocation whose flags DISAGREE with the committed manifest is refused as a write-conflict.
 * Read together: after a product's first partition, a fraction flag can never CHANGE anything.
 * Flags that agree byte-for-byte with the committed manifest are tolerated — they re-derive the
 * IDENTICAL manifest (same committed salt, same fractions), the write-once writer answers
 * `unchanged`, and an operator may therefore keep one invocation in a runbook forever. Flags that
 * disagree are refused. No flag ever writes a second manifest. "Accepts no fraction flags" is
 * enforced as "no fraction flag has any effect after the first partition", which is the only
 * reading consistent with D-05's write-conflict clause.
 *
 * The salt is 32 bytes from `randomBytes` minted HERE, once per product, and committed hex-encoded
 * (D-06). It is never derived from the product slug, a config value or a clock, and no flag can
 * supply one — a predictable salt lets a proposer pre-compute the held-out buckets.
 */
function ensurePartitionManifests(
  session: EvalSession,
  admitted: readonly { product: string }[],
  committedRoot: string,
  result: SeedVerbResult,
  params: { heldOutFraction?: number; privateFraction?: number },
): Map<string, PartitionManifest> {
  const byProduct = new Map<string, PartitionManifest>()
  const read = readPartitionManifests(committedRoot)
  for (const manifest of read.manifests) byProduct.set(manifest.product, manifest)
  // Never silent: a mismatched file name or a refused manifest is a notice, and a product whose
  // manifest was refused reads as unpartitioned below — which the write-once preview then refuses
  // rather than overwriting.
  result.notices.push(...read.notices)
  for (const refusal of read.refusals) {
    result.notices.push(`partition manifest refused at ${refusal.path}: ${refusal.reason}`)
  }

  const products = [...new Set(admitted.map(entry => entry.product))].sort()
  const { heldOutFraction, privateFraction } = params
  const unpartitioned = products.filter(product => !byProduct.has(product))
  if (
    unpartitioned.length > 0
    && (heldOutFraction === undefined || privateFraction === undefined)
  ) {
    throw new EvalPartitionFlagsRequiredError(unpartitioned)
  }

  for (const product of products) {
    const committed = byProduct.get(product)
    const relPath = committedPartitionManifestPath(product)

    if (committed === undefined) {
      // First partition: mint the salt (D-06) and commit the manifest once (D-05).
      const saltHex = randomBytes(32).toString('hex')
      const manifest = projectPartitionManifest({
        product,
        saltHex,
        heldOutFraction: heldOutFraction as number,
        privateFraction: privateFraction as number,
      })
      const outcome = writePartitionManifest({
        manifest,
        committedRoot,
        seedingOutputBaseDir: evalAuditDir(session.configDir, 'seed', `partition-${product}`),
      })
      byProduct.set(product, manifest)
      result.partitions.push(partitionRow(manifest, relPath, requireManifestWritten(outcome, product, relPath)))
      continue
    }

    if (heldOutFraction === undefined || privateFraction === undefined) {
      // A later seed with no fraction flags: echo the committed manifest, write nothing.
      result.partitions.push(partitionRow(committed, relPath, 'unchanged'))
      continue
    }

    // A later seed WITH flags: re-derive from the COMMITTED salt. Agreeing flags round-trip to
    // `unchanged`; disagreeing ones reach the write-once preview and refuse (D-05).
    const reprojected = projectPartitionManifest({
      product,
      saltHex: committed.salt,
      heldOutFraction,
      privateFraction,
    })
    const outcome = writePartitionManifest({
      manifest: reprojected,
      committedRoot,
      seedingOutputBaseDir: evalAuditDir(session.configDir, 'seed', `partition-${product}`),
    })
    result.partitions.push(
      partitionRow(committed, relPath, requireManifestWritten(outcome, product, relPath)),
    )
  }

  return byProduct
}

/** The DTO row for one manifest — `saltDigest`, never the salt (D-17). */
function partitionRow(
  manifest: PartitionManifest,
  path: string,
  outcome: 'written' | 'unchanged',
): SeedPartitionRow {
  return {
    product: manifest.product,
    path,
    outcome,
    saltDigest: sha256hex(manifest.salt),
    heldOutFraction: manifest.heldOutFraction,
    privateFraction: manifest.privateFraction,
    partitionVersion: manifest.partitionVersion,
  }
}

/**
 * 414 D-04: the target environment for one product, or `undefined` when it does not resolve.
 *
 * A `CompletedRunHandoff` carries no target — the environment is a property of the target
 * REGISTRY. Exactly one distinct DECLARED value across the targets whose resolved product equals
 * `product` stamps the field; zero matching targets, an undeclared `environment`, and a mixed set
 * all OMIT it. Never a sentinel, never a guess from the product name, never a majority vote: a
 * fabricated provenance field is worse than an absent one, because only the absent one is honest
 * about what is unknown. `resolveTarget` is the ONE place a target's product is decided (it falls
 * back to the target name), so this reads through it rather than the raw registry record.
 */
export function resolveTargetEnvironmentForProduct(
  config: AgentQaConfig,
  product: string,
): TargetEnvironment | undefined {
  const declared = new Set<TargetEnvironment>()
  for (const summary of listTargets(config)) {
    const target = resolveTarget(config, summary.name)
    if (target.product !== product) continue
    if (target.environment === undefined) continue
    declared.add(target.environment)
  }
  return declared.size === 1 ? [...declared][0] : undefined
}

/**
 * The manifest writer's four outcomes narrowed to the two a partition row can carry. A
 * write-conflict is D-05's refusal; an egress block on a document that is a product slug, a hex
 * salt and two numbers means the guardrail policy caught something the operator must look at.
 */
function requireManifestWritten(
  outcome: ReturnType<typeof writePartitionManifest>,
  product: string,
  path: string,
): 'written' | 'unchanged' {
  if (outcome.kind === 'write-conflict') {
    throw new EvalPartitionManifestConflictError(product, path)
  }
  if (outcome.kind === 'egress-blocked') {
    throw new Error(
      `partition manifest for ${product} at ${path} was egress-blocked: `
        + outcome.detections.map(detection => `${detection.label}/${detection.detector}`).join(' '),
    )
  }
  return outcome.kind
}


/**
 * An admitted analysis artifact AND the exact bytes it was parsed from (414 D-02). Both absent
 * means the deterministic floor decided: no artifact, and therefore no artifact digest.
 */
interface RunAnalysisRead {
  artifact?: RunAnalysisArtifact
  text?: string
}

/**
 * One run's persisted analysis artifact, loaded from its run dir through the ONE schema guard
 * (389 D-09). Absence is the deterministic floor and costs no notice. A PRESENT file recording
 * ANOTHER run's id is refused by identity (`admitAnalysisArtifactForRun`, G-389-3A) so a copied
 * run directory can never flip this run's admission off someone else's verdicts.
 *
 * A file that cannot be read, parsed or guarded is a NOTICE plus the floor — never a per-run skip
 * (T-413-26). Skipping would let a single hand-edited byte remove a run from the corpus silently,
 * which is precisely the tampering the guard exists to surface.
 */
function readRunAnalysisArtifact(
  runsRoot: string,
  runSlug: string,
  runId: string,
  notices: string[],
): RunAnalysisRead {
  const path = join(runsRoot, runSlug, ANALYSIS_FILE)
  if (!existsSync(path)) return {}
  try {
    const text = readFileSync(path, 'utf8')
    const admission = admitAnalysisArtifactForRun(
      guardRunAnalysisArtifact(JSON.parse(text)),
      runId,
    )
    // 414 D-02: the EXACT bytes are carried out beside the parsed artifact, because the committed
    // exclusion record digests the evidence that decided the exclusion — re-serialising the
    // parsed shape would digest this process's formatting, not the file anyone can re-read.
    if (admission.kind === 'admitted') return { artifact: admission.artifact, text }
    notices.push(
      `${ANALYSIS_FILE} for ${runSlug} records run ${admission.recordedRunId}, not `
        + `${admission.resolvingRunId} — deterministic floor used`,
    )
    return {}
  } catch (err) {
    notices.push(
      `${ANALYSIS_FILE} unreadable for ${runSlug}: `
        + `${err instanceof Error ? err.message : String(err)} — deterministic floor used`,
    )
    return {}
  }
}

/**
 * The run's resolved verdict rows, in the exact two-layer order `emit-canary-outcomes.ts` reads
 * them (389 D-10):
 *
 *   1. Members OUTSIDE the accessor's domain first — the runner's one PASS-mintable class is
 *      `flake` (a member that passed only after a retry), and D-04 must see it. `resolveRunVerdicts`
 *      never serves a verdict for a passed member, so reading it here cannot contradict the accessor.
 *   2. THE one supersedable-verdict read — `resolveRunVerdicts`: the artifact's authored verdicts
 *      when one is present, the deterministic floor when it is absent. It OVERWRITES layer 1 for
 *      every member it governs, so an `unknown` → `environment` upgrade excludes the run here
 *      rather than leaving two consumers deriving supersession differently.
 *
 * Sorted by `perTest` so the DTO (and the census that prints it) is order-deterministic.
 */
function resolveSeedVerdictRows(
  artifact: RunAnalysisArtifact | undefined,
  handoff: CompletedRunHandoff,
): SeedRunVerdictRow['verdicts'] {
  return [...resolveSeedMemberVerdicts(artifact, handoff).entries()]
    .sort(([first], [second]) => first - second)
    .map(([, verdict]) => verdict)
}

function resolveSeedMemberVerdicts(
  artifact: RunAnalysisArtifact | undefined,
  handoff: CompletedRunHandoff,
): Map<number, SeedRunVerdictRow['verdicts'][number]> {
  const byPerTest = new Map<number, SeedRunVerdictRow['verdicts'][number]>()
  for (const member of handoff.tests) {
    if (member.rootCause === undefined) continue
    byPerTest.set(member.testIndex, {
      class: member.rootCause.class,
      producer: member.rootCause.producer,
    })
  }
  for (const verdict of resolveRunVerdicts(artifact, handoff)) {
    byPerTest.set(verdict.perTest, { class: verdict.class, producer: verdict.producer })
  }
  return byPerTest
}

// ---- the report verb (372-07, D-13/D-14) -------------------------------------------------------

/** The report verb's one DTO — the console renders FROM this, never around it (D-04). */
export interface ReportVerbResult {
  /** sha256hex over the sorted assembled cassette ids — minted by buildEvalReport (D-13). */
  batchKey: string
  /** Records assembled this invocation, including refusals; zero for committed-history reads. */
  entries: number
  /** The ONE whole-corpus EvalBatchReport — one buildEvalReport call, one headline (D-14). */
  report: EvalBatchReport
  /** The staged file, present only when this invocation assembled and saved a report. */
  stagedFile?: string
  /** Actual report read for --from-committed; no staged file or run receipt is fabricated. */
  committedFile?: string
  /** Decision vectors actually projected for this invocation's report, including an empty set. */
  decisionVectorCount?: number
  /** The typed commitEvalReport outcome when `--commit` ran — egress blocks are DATA (D-08). */
  committed?: CommitEvalReportOutcome
  /** Batch-level judge identity: consistent blocks pass through; mixed/absent surface honestly. */
  judgeIdentity: 'present' | 'absent' | 'mixed'
  /** 413 D-08: which cassette population supplied the label join — 'staged' unless asked. */
  source: EvalCorpusSource
  /**
   * 413 D-19/D-20: the typed baseline-designation outcome when `--baseline` ran. Written,
   * unchanged, REFUSED (a same-family report is not a gate comparator), egress-blocked or a
   * write-conflict — all five are DATA, and the verb's exit code is unaffected by any of them.
   */
  baseline?: WriteBaselinePointerOutcome
  /** 413 D-19: the profile key the designation was composed under, present whenever it ran. */
  profileKey?: string
  /** Stderr-destined notices: read refusals, missing bundles, judge identity honesty. */
  notices: string[]
}

/**
 * The report verb pipeline (D-13/D-14): assemble ONE whole-corpus batch from every persisted
 * replay record under `.agent-qa/eval/replays/` via the 372-02 read legs — entries joined as
 * { cassetteId, outcome, score?, label? } from replay.json / score.json / the staged cassette's
 * label leg. A persisted refusal outcome IS an entry (Pitfall 4 — never dropped). Judge identity
 * threads from the persisted ScoreRecord.judge blocks: consistent blocks pass to buildEvalReport,
 * mixed or absent surfaces honestly — never fabricated (T-372-20). Exactly ONE buildEvalReport
 * call aggregates (the CLI never re-sums scores); the staged report always lands via
 * FsReportStore, and `--commit` additionally routes through commitEvalReport's egress
 * checkpoint into the committed root (D-13/D-17).
 */
export async function runReportVerb(
  session: EvalSession,
  filters: { run?: string; cassette?: string; product?: string } = {},
  opts: {
    commit?: boolean
    source?: EvalCorpusSource
    baseline?: boolean
    /** Re-designate this exact committed batch without reading replay records or staging. */
    fromCommitted?: string
    /** Required explicit policy for a reviewed --from-committed designation. */
    seedPolicy?: SeedPolicy
    /** No model call: overrides only name the fingerprint shared with a stub-measured floor. */
    plannerOverrides?: ModelProviderOverrides
  } = {},
): Promise<ReportVerbResult> {
  // D-19: a pointer designates a COMMITTED report. Designating a staged-only report would name a
  // batch nobody else can read, so the combination is refused before any work happens (D-08 typed
  // error — the command layer maps it to exit 1).
  if (opts.fromCommitted !== undefined) {
    if (opts.baseline !== true) throw new TypeError('--from-committed requires --baseline')
    if (opts.seedPolicy === undefined) {
      throw new TypeError('--from-committed requires --seed-policy <none|declared>')
    }
    if (opts.commit === true) throw new TypeError('--from-committed cannot be combined with --commit')
    if (!/^[0-9a-f]{64}$/.test(opts.fromCommitted)) {
      throw new TypeError('--from-committed requires a batchKey of 64 lowercase hexadecimal characters')
    }
    if (!SEED_POLICIES.includes(opts.seedPolicy)) {
      throw new TypeError('--seed-policy must be "none" or "declared"')
    }

    const committedRoot = resolve(session.configDir, 'agent-qa-eval')
    const reportList = listCommittedReports(committedRoot)
    const requestedFile = join(committedRoot, 'reports', opts.fromCommitted, 'report.json')
    const entry = reportList.reports.find(candidate => candidate.batchKey === opts.fromCommitted)
    if (entry === undefined) {
      const refusal = reportList.refusals.find(candidate => candidate.path === requestedFile)
      throw new EvalNamedInputError(
        'batchKey', opts.fromCommitted, refusal?.path ?? join(committedRoot, 'reports'),
        'designate', refusal?.reason,
      )
    }
    // The list's key comes from the directory; the light report guard preserves its body.
    // Require all three identities before projecting a pointer to the named history (T-415-42).
    if (entry.path !== requestedFile || entry.report.batchKey !== opts.fromCommitted) {
      throw new EvalNamedInputError(
        'batchKey', opts.fromCommitted, entry.path, 'designate',
        `report batchKey "${entry.report.batchKey}" does not match the requested directory`,
      )
    }
    const notices = reportList.refusals.map(
      refusal => `committed read refused ${refusal.path}: ${refusal.reason}`,
    )
    const designation = await designateReportBaseline(
      session, entry.report, opts.seedPolicy, opts.plannerOverrides, notices,
    )
    return {
      batchKey: entry.report.batchKey,
      entries: 0,
      report: entry.report,
      committedFile: entry.path,
      judgeIdentity: entry.report.judgeIdentity === 'mixed'
        ? 'mixed' : entry.report.judge === undefined ? 'absent' : 'present',
      source: 'committed',
      ...designation,
      notices,
    }
  }
  if (opts.baseline === true && opts.commit !== true) {
    throw new Error(
      '--baseline requires --commit: the pointer designates a COMMITTED report (413 D-19)',
    )
  }
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const replaysRoot = join(agentQaRoot, DEFAULT_EVAL_REPLAYS_SUBDIR)
  const source: EvalCorpusSource = opts.source ?? 'staged'
  const sourceRoot = resolveCassettesRoot(session, source)
  const cassettesRoot = sourceRoot.cassettesRoot
  const notices: string[] = []
  if (sourceRoot.notice !== undefined) notices.push(sourceRoot.notice)

  // (1)+(2) Join every persisted replay record to its score, judge identity, and cassette label.
  const committedCorpus = source === 'committed'
    ? readActiveCommittedCorpus(resolve(session.configDir, 'agent-qa-eval'), agentQaRoot) : undefined
  const {
    entries: assembled,
    judgeBlocks,
    partitionsById,
    missingBundleCount,
    notices: assemblyNotices,
  } = assembleScoredBatch({ replaysRoot, cassettesRoot, source,
    ...(committedCorpus === undefined ? {} : {
      productByCassetteId: new Map(committedCorpus.snapshot.entries.map(entry => [entry.cassetteId, entry.product])),
      eligibleCassetteIds: new Set(committedCorpus.snapshot.entries.map(entry => entry.cassetteId)),
      labelRecords: committedCorpus.snapshot.labelsById,
      corpusEntriesById: committedCorpus.corpusEntriesById,
      excludedLabelIds: committedCorpus.snapshot.excludedLabelIds,
    }),
  })
  notices.push(...assemblyNotices)
  if (assembled.some(entry => entry.split === undefined)) {
    notices.push('corpus split ownership unknown; entries without corpus metadata are unassigned')
  }
  if (missingBundleCount > 0) {
    notices.push(
      `${missingBundleCount} replay record(s) have no ${source} cassette bundle — label legs absent`,
    )
  }

  // (3) The ONE D-02 filter vocabulary, replay semantics: a named miss is the only throw.
  let entries = assembled
  if (filters.cassette !== undefined) {
    const named = filters.cassette
    entries = entries.filter(entry => entry.cassetteId === named)
    if (entries.length === 0) {
      throw new EvalNamedInputError('cassette', named, replaysRoot, 'report')
    }
  }
  if (filters.run !== undefined) {
    const named = filters.run
    entries = entries.filter(entry => {
      const head = entry.cassetteId.split('/')[0]
      return head === named || head === slugBranch(named)
    })
    if (entries.length === 0) {
      throw new EvalNamedInputError('run', named, replaysRoot, 'report')
    }
  }
  if (filters.product !== undefined) {
    const named = filters.product
    entries = entries.filter(entry => partitionsById.get(entry.cassetteId) === named)
  }
  entries.sort((a, b) => (a.cassetteId < b.cassetteId ? -1 : a.cassetteId > b.cassetteId ? 1 : 0))

  // (4) Batch judge identity from the persisted blocks only (T-372-20): all defined blocks
  // canonicalJson-equal ⇒ the identity passes through; none ⇒ honest absence; differing ⇒
  // 'mixed' and the report carries NO judge block — an identity is never synthesized.
  let judgeIdentity: ReportVerbResult['judgeIdentity']
  let judgeForReport: JudgeIdentityBlock | undefined
  let mixedIdentity: { judgeIdentity: 'mixed'; judgeModelIds: readonly string[] } | undefined
  if (judgeBlocks.length === 0) {
    judgeIdentity = 'absent'
    notices.push('no judge identity on any persisted score record — the report carries no judge block')
  } else {
    const first = canonicalJson(judgeBlocks[0])
    if (judgeBlocks.every(block => canonicalJson(block) === first)) {
      judgeIdentity = 'present'
      judgeForReport = judgeBlocks[0]
    } else {
      judgeIdentity = 'mixed'
      // 413-15: the report carries the mixture as DATA — the distinct persisted ids, sorted —
      // so `assertBaselineComparator` can refuse it instead of reading it as abstention. Still
      // no synthesized block: a list of the ids actually seen is not an identity (T-372-20).
      mixedIdentity = {
        judgeIdentity: 'mixed',
        judgeModelIds: [...new Set(judgeBlocks.map(block => block.judgeModelId))].sort(),
      }
      notices.push(
        'mixed judge identities across persisted score records — the report carries no judge '
          + 'block (never fabricated)',
      )
    }
  }

  // (5) Exactly ONE buildEvalReport call — one batch, one report, one headline (D-14). The CLI
  // never sums scores; every counter and rate is the aggregator's.
  const report = buildEvalReport(entries, judgeForReport, mixedIdentity, { calibration: committedCorpus?.calibration })
  const vectors = decisionCorrectnessVectors(entries, partitionsById)
  const decisions = projectDecisionVectorsDocument({
    batchKey: report.batchKey, matcherVersion: report.matcherVersion, vectors,
  })

  // (6) The staged report ALWAYS lands (uncommitted runtime staging, batchKey-derived filename).
  const staged = new FsReportStore({ root: agentQaRoot }).save(report, decisions)

  // (7) `--commit`: render the deterministic markdown projection and route all THREE parts through
  // commitEvalReport's egress checkpoint into the committed root (D-13) — the typed outcome
  // (committed / egress-blocked / write-conflict) folds into the DTO as data (D-08).
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const reportOutputBaseDir = evalAuditDir(session.configDir, 'report', report.batchKey)
  let committed: CommitEvalReportOutcome | undefined
  if (opts.commit === true) {
    committed = commitEvalReport({
      report,
      decisions,
      markdown: renderEvalReportMarkdown(report),
      committedRoot,
      reportOutputBaseDir,
    })
  }

  // (8) `--baseline`: designate this committed report as THE comparator for its profile (D-19).
  // The writer refuses first through the ONE comparator predicate (D-20), so a report judged
  // under the same-family override can never become a gate comparator — and the refusal rides
  // the DTO and the notices rather than an exit code, because the report itself is still valid
  // history (D-18). The pointer is per-PROFILE: a number produced by one planner under one
  // matcher and one judge only compares against the same combination.
  let baseline: WriteBaselinePointerOutcome | undefined
  let profileKey: string | undefined
  if (opts.baseline === true) {
    if (committed?.kind !== 'committed') {
      notices.push(
        `baseline pointer skipped: report commit outcome was ${committed?.kind ?? 'absent'}`,
      )
    } else {
      const seedPolicy: SeedPolicy = session.evalConfig.seed !== undefined ? 'declared' : 'none'
      const designation = await designateReportBaseline(
        session, report, seedPolicy, opts.plannerOverrides, notices,
      )
      profileKey = designation.profileKey
      baseline = designation.baseline
    }
  }

  return {
    batchKey: report.batchKey,
    entries: entries.length,
    report,
    stagedFile: staged.file,
    decisionVectorCount: decisions.vectors.length,
    ...(committed !== undefined ? { committed } : {}),
    judgeIdentity,
    source,
    ...(baseline !== undefined ? { baseline } : {}),
    ...(profileKey !== undefined ? { profileKey } : {}),
    notices,
  }
}

/** Both report paths share the same v2 projection and comparator-first write-once writer. */
async function designateReportBaseline(
  session: EvalSession,
  report: EvalBatchReport,
  seedPolicy: SeedPolicy,
  plannerOverrides: ModelProviderOverrides | undefined,
  notices: string[],
): Promise<{ profileKey: string; baseline: WriteBaselinePointerOutcome }> {
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const read = readActiveCommittedCorpus(committedRoot, resolve(session.configDir, '.agent-qa'))
  notices.push(...read.notices)
  for (const refusal of read.refusals) {
    notices.push(`committed read refused ${refusal.path}: ${refusal.reason}`)
  }
  const pointer = projectBaselinePointer({
    plannerModelId: await resolvePlannerModelId(session),
    fingerprint: await resolveReplayProfileFingerprint(session, seedPolicy, plannerOverrides),
    corpusDigest: computeCorpusDigest(read.snapshot.entries),
    matcherVersion: report.matcherVersion,
    ...(report.judge === undefined ? {} : {
      judgeModelId: report.judge.judgeModelId,
      ...(report.judge.judgeVersion === undefined ? {} : { judgeVersion: report.judge.judgeVersion }),
    }),
    batchKey: report.batchKey,
  })
  const baseline = writeBaselinePointer({
    report, pointer, committedRoot,
    reportOutputBaseDir: evalAuditDir(session.configDir, 'report', report.batchKey),
  })
  if (baseline.kind === 'refused') notices.push(renderBaselineComparatorRefusal(baseline.refusal))
  if (seedPolicy === 'none' && (baseline.kind === 'written' || baseline.kind === 'unchanged')) {
    notices.push(
      'baseline designated under seed policy none — eval gate compares against a declared-policy '
      + 'pointer; re-designate with eval report --baseline --from-committed <batchKey> --seed-policy declared',
    )
  }
  return { profileKey: pointer.profileKey, baseline }
}

/**
 * The replay planner's resolved MODEL ID for the D-19 profile key — config only, no credential.
 *
 * `resolveReplayPlanner` resolves auth and throws without a credential, which would make baseline
 * designation impossible on a machine that merely READS a committed report. The profile key needs
 * the declared model id and nothing else, so this reads the named registry entry directly through
 * the same `resolveNamedConfig` leg and stops there. An absent `use.llm` is the same typed error
 * `resolveReplayPlanner` raises — the planner identity is not optional for a comparator.
 */
async function resolvePlannerModelId(session: EvalSession): Promise<string> {
  return (await resolveBaselinePlannerConfig(session)).model
}

/** Shared declaration-only identity; gate overrides remain part of the exact fingerprint. */
export async function resolveGateProfileIdentity(
  session: EvalSession,
  modelOverrides?: ModelProviderOverrides,
): Promise<{
  plannerModelId: string
  judgeModelId?: string
  judgeVersion?: number
  fingerprint: string
  matcherVersion: number
  profileKey: string
}> {
  const plannerModelId = await resolvePlannerModelId(session)
  const fingerprint = await resolveReplayProfileFingerprint(session, 'declared', modelOverrides)
  let judgeModelId: string | undefined
  if (session.evalConfig.judge) {
    const { resolveNamedConfig } = await import('./llm-utils.js')
    judgeModelId = (await resolveNamedConfig(session.evalConfig.judge, session.configPath)).config.model
  }
  const identity = {
    plannerModelId, fingerprint, matcherVersion: buildEvalReport([]).matcherVersion,
    ...(judgeModelId === undefined ? {} : { judgeModelId, judgeVersion: JUDGE_CONFIG.judgeVersion }),
  }
  return { ...identity, profileKey: composeBaselineProfileKey(identity) }
}

/**
 * D-11: config declaration only, with no credential resolution or model creation. The auth
 * declaration mirrors toAuthDeclaration's unresolved/missing case; resolveCapabilities ignores
 * it. Provider transport options are also irrelevant to the resolved replay capabilities.
 */
export async function resolveReplayProfileFingerprint(
  session: EvalSession,
  seedPolicy: SeedPolicy,
  modelOverrides?: ModelProviderOverrides,
): Promise<string> {
  const profile = await resolveReplayProfileDeclaration(session)
  return computeReplayProfileFingerprintFor({ profile, seedPolicy, modelOverrides })
}

/** Shared unresolved declaration for fingerprinting and credential-free offline gate reads. */
async function resolveReplayProfileDeclaration(session: EvalSession): Promise<ModelProfile> {
  const config = await resolveBaselinePlannerConfig(session)
  return {
    provider: config.provider,
    model: config.model,
    ...(config.baseURL !== undefined ? { baseURL: config.baseURL } : {}),
    ...(config.providerHeaders !== undefined ? { headers: config.providerHeaders } : {}),
    auth: { mode: 'none' },
  }
}

/** The model-id and fingerprint readers share the same named-config validation. */
async function resolveBaselinePlannerConfig(session: EvalSession) {
  const plannerName = session.config.use?.llm
  if (!plannerName) {
    throw new Error(
      'use.llm is not set in the config — the baseline profile key is keyed on the replay '
      + 'planner, the named use.llm registry entry. Set use.llm in agent-qa.config.yaml.',
    )
  }
  const { resolveNamedConfig } = await import('./llm-utils.js')
  const { config } = await resolveNamedConfig(plannerName, session.configPath)
  return config
}

// ---- the census verb (413-05, D-13/D-14/D-15/D-16) ---------------------------------------------

/** The census verb's one DTO — the console renders FROM this, never around it (D-04). */
export interface CensusVerbResult {
  /** sha256hex over the canonical cassetteId-sorted committed entry set — names the corpus (D-15). */
  corpusDigest: string
  /** Committed corpus entries the read leg loaded; the census's population. */
  entryCount: number
  /** Product partition dirs seen under `corpus/` — a dir with no admitted entry still shows. */
  productsSeen: readonly string[]
  /** The ONE pure deriveCensus fold — the CLI never re-sums or re-rates anything (D-16). */
  census: CorpusCensus
  /** Absolute path of the guarded `--campaign` manifest when one was supplied. */
  campaignManifest?: string
  /** The typed commitCensus outcome when `--commit` ran — egress blocks are DATA (372 D-08). */
  committed?: CommitCensusOutcome
  /**
   * Read-only floor artefact disclosure, sorted by profileKey (415 D-14). This field never
   * enters deriveCensus or the committed census schema; absent when no guarded floor exists.
   */
  noiseFloor?: {
    profileKey: string
    path: string
    minimumGateSet?: number
    /** The measured artefact's own explanation, including why a value may be absent. */
    minimumGateSetDerivation: string
    classifierRepeatability?: {
      n: number
      k: number
      classFlipRate?: number
      admitExcludeFlipRate?: number
    }
  }[]
  /** Stderr-destined honesty lines: read refusals, cross-check reconciliations, comparator refusals. */
  notices: string[]
}

/**
 * The census verb pipeline (D-13/D-14): the corpus census is a property of the COMMITTED CORPUS,
 * not of a replay batch, so this verb reads the committed root directly through eval-local's read
 * leg and folds it with ONE `deriveCensus` call. Four legs feed that fold:
 *
 *   (a) the corpus itself — entries, label records, cassette bundles and local blob presence;
 *   (b) the optional `--campaign` manifest, whose run-level tallies (excluded runs, repeats, the
 *       model-call and token cost line) the committed root cannot state because an excluded run
 *       leaves no committed entry behind (D-16);
 *   (c) every committed `reports/<batchKey>/report.json`, cross-checked — the two populations are
 *       PRINTED side by side and never reconciled (RESEARCH F7: a report carries a batchKey, never
 *       its cassette-id list), and each report is run through the ONE comparator predicate so a
 *       same-family report can never be mistaken for a gate comparator (D-18/D-20, ROOT-11).
 *   (d) 414 D-17: the committed `contracts/partition-<product>.json` manifests and the
 *       `exclusions/<product>/<runSlug>.json` records, plus the read leg's `schemaVersionsSeen`.
 *       The manifest travels into the census as `sha256hex(salt)` only — the fold does the
 *       digesting, so the raw salt never reaches a DTO the console or a committed file can print.
 *
 * Refusal posture: an unreadable committed file is a NOTICE, never a throw — the verb completes
 * and prints what it could not read (T-413-24). The single typed error is a rejected `--campaign`
 * manifest (T-413-21): the command layer maps it to exit 1. No console output lives here (D-04).
 */
export async function runCensusVerb(
  session: EvalSession,
  opts: { commit?: boolean; campaign?: string } = {},
): Promise<CensusVerbResult> {
  const committedRoot = resolve(session.configDir, 'agent-qa-eval')
  const notices: string[] = []

  // (1) The committed root read leg — refusals are data, an absent root is an empty census.
  //
  // 414 D-02/D-05: the two committed document kinds this phase introduced are read HERE, in the
  // one file the surface-firewall ledger clears for `@vostride/agent-qa-eval-local`, and handed to
  // `deriveCensus` as DATA. Every refusal from either read becomes a notice: a manifest or an
  // exclusion the guard rejects must be NAMED, because silently dropped it reads as "this product
  // is unpartitioned" or "this run was never excluded" — a false count, not a missing one
  // (T-414-41).
  const read = readCommittedCorpus(committedRoot)
  const manifestRead = readPartitionManifests(committedRoot)
  const exclusionRead = readRunExclusions(committedRoot)
  notices.push(...read.notices, ...manifestRead.notices)
  for (const refusal of [...read.refusals, ...manifestRead.refusals, ...exclusionRead.refusals]) {
    notices.push(`committed read refused ${refusal.path}: ${refusal.reason}`)
  }

  // (2) The optional campaign manifest. `guardCampaignManifest` is STRICT and its TypeError
  // propagates deliberately — a widened or misspelt manifest is a typed input error, never a
  // silently dropped tally (T-413-21). Its digest is stamped into the committed census bytes.
  let campaign: DeriveCensusInput['campaign']
  let campaignManifest: string | undefined
  if (opts.campaign !== undefined) {
    campaignManifest = resolve(process.cwd(), opts.campaign)
    const manifest = guardCampaignManifest(JSON.parse(readFileSync(campaignManifest, 'utf8')))
    campaign = { legs: manifest.legs, manifestDigest: sha256hex(canonicalJson(manifest)) }
  }

  // (3) Cross-check EVERY committed report: the reconciliation line, the comparator verdict from
  // the ONE predicate, and the D-19 pointer designations that name it.
  const reportList = listCommittedReports(committedRoot)
  const pointerList = listBaselinePointers(committedRoot)
  for (const refusal of [...reportList.refusals, ...pointerList.refusals]) {
    notices.push(`committed read refused ${refusal.path}: ${refusal.reason}`)
  }

  const reports: NonNullable<DeriveCensusInput['reports']>[number][] = []
  for (const entry of reportList.reports) {
    const comparator = assertBaselineComparator(entry.report)
    const designatedBy = pointerList.pointers
      .filter(pointer => pointer.batchKey === entry.batchKey)
      .map(pointer => pointer.profileKey)
      .sort()
    notices.push(
      `cross-check ${entry.batchKey}: report decisions `
        + `${entry.report.headline.perDecisionCost.decisionCount} vs corpus cassettes `
        + `${read.snapshot.entries.length} — batch membership differs (batchKey only)`,
    )
    if (!comparator.ok) notices.push(renderBaselineComparatorRefusal(comparator.refusal))
    reports.push({ report: entry.report, comparator, designatedBy })
  }

  // D-14: disclose each guarded floor beside the census, without changing the census input.
  const floorList = listNoiseFloorArtefacts(committedRoot)
  for (const refusal of floorList.refusals) {
    notices.push(`committed read refused ${refusal.path}: ${refusal.reason}`)
  }
  const noiseFloor = floorList.artefacts.map(({ profileKey, path, artefact }) => {
    const repeatability = artefact.classifierRepeatability
    return {
      profileKey,
      path,
      ...(artefact.minimumGateSet.value === undefined
        ? {} : { minimumGateSet: artefact.minimumGateSet.value }),
      minimumGateSetDerivation: artefact.minimumGateSet.derivation,
      ...(repeatability === undefined ? {} : {
        classifierRepeatability: {
          n: repeatability.n,
          k: repeatability.k,
          ...(repeatability.classFlipRate === undefined
            ? {} : { classFlipRate: repeatability.classFlipRate }),
          ...(repeatability.admitExcludeFlipRate === undefined
            ? {} : { admitExcludeFlipRate: repeatability.admitExcludeFlipRate }),
        },
      }),
    }
  })

  // (4) The ONE pure fold — every counter, rate and tally in the DTO is the derivation's.
  const census = deriveCensus({
    snapshot: read.snapshot,
    ...(campaign === undefined ? {} : { campaign }),
    reports,
    manifests: manifestRead.manifests,
    exclusions: exclusionRead.exclusions,
    schemaVersionsSeen: read.schemaVersionsSeen,
  })

  // (5) `--commit`: render the deterministic markdown projection and route BOTH parts through
  // commitCensus's egress checkpoint into `reports/census/<corpus-digest>/` (D-15). The typed
  // outcome (committed / egress-blocked / write-conflict) folds into the DTO as data (372 D-08).
  let committed: CommitCensusOutcome | undefined
  if (opts.commit === true) {
    committed = commitCensus({
      census,
      markdown: renderCensusMarkdown(census),
      committedRoot,
      censusOutputBaseDir: evalAuditDir(session.configDir, 'census', census.corpusDigest),
    })
  }

  return {
    corpusDigest: census.corpusDigest,
    entryCount: census.entryCount,
    productsSeen: read.productsSeen,
    census,
    ...(campaignManifest !== undefined ? { campaignManifest } : {}),
    ...(committed !== undefined ? { committed } : {}),
    ...(noiseFloor.length === 0 ? {} : { noiseFloor }),
    notices,
  }
}

// ---- internals --------------------------------------------------------------------------------

/**
 * The named-LLM resolution chain shared by judge and planner: resolveNamedConfig (typed
 * available-names error on unknown name) → resolveModelAuth → toModelProfileAndAuth. A `missing`
 * auth resolution is a typed Error naming `agent-qa auth login` (D-08). Lazy dynamic import per
 * the auth.ts house style.
 */
async function resolveNamedProfile(
  name: string,
  configPath: string,
): Promise<{ profile: ModelProfile; auth: ResolvedModelAuth }> {
  const { resolveNamedConfig, resolveModelAuth, toModelProfileAndAuth } = await import('./llm-utils.js')
  const { config } = await resolveNamedConfig(name, configPath)
  const auth = await resolveModelAuth(config.name, config)
  if (auth.kind === 'missing') {
    throw new Error(
      `No credentials for LLM config "${config.name}": ${auth.message} `
      + 'Run `agent-qa auth login` to authenticate.',
    )
  }
  return toModelProfileAndAuth(config, auth)
}

/**
 * Load the workspace secrets file into a SecretStore (the run.ts loadRuntimeSecrets recipe,
 * reimplemented with typed errors — D-05 forbids touching the run module and D-08 forbids
 * process.exit here). Missing/unreadable/invalid all throw typed Errors naming the path.
 */
async function loadEvalSecretStore(
  config: AgentQaConfig,
  configDir: string,
): Promise<{ forEachSecret(cb: (name: string, value: string) => void): void }> {
  const secretsPath = resolve(configDir, config.workspace.secretsFile)

  let content: string
  try {
    content = await readFile(secretsPath, 'utf-8')
  } catch {
    throw new Error(
      `Secrets file not found or unreadable: ${secretsPath}. `
      + 'Create the file before running eval verbs (it may be empty, but it must exist).',
    )
  }

  try {
    const { SecretStore } = await import('@vostride/agent-qa-runner')
    return SecretStore.fromEnvContent(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Secrets file is invalid: ${secretsPath}: ${message}`)
  }
}

/**
 * Best-effort read of every persisted auth-state payload under the configured auth-state dir
 * (mirrors run.ts readAuthStatePayloadBestEffort — D-06 masking seed source). An absent dir or
 * an unreadable/invalid file degrades silently: the source simply contributes no seed.
 */
async function readAuthStatePayloadsBestEffort(authStateDir: string): Promise<unknown[]> {
  let entries: string[]
  try {
    entries = (await readdir(authStateDir, { recursive: true })) as string[]
  } catch {
    return []
  }

  const payloads: unknown[] = []
  for (const entry of entries) {
    try {
      payloads.push(JSON.parse(await readFile(resolve(authStateDir, entry), 'utf-8')) as unknown)
    } catch {
      // best-effort: directories, unreadable files, and non-JSON contribute no seed
    }
  }
  return payloads
}

/** Field-wise merge of flag overrides over the config eval block — flags win (D-03). */
function mergeEvalConfig(
  fromConfig: AgentQaConfig['eval'],
  flags?: { judge?: string; k?: number; seed?: number; silverCap?: number },
): EvalCliConfig {
  const judge = flags?.judge ?? fromConfig?.judge
  const judgeAllowSameFamily = fromConfig?.judgeAllowSameFamily
  const k = flags?.k ?? fromConfig?.k
  const seed = flags?.seed ?? fromConfig?.seed
  const silverPerTestCap = flags?.silverCap ?? fromConfig?.seeding?.silverPerTestCap
  const maxScreens = fromConfig?.gate1?.maxScreens

  return {
    ...(judge !== undefined ? { judge } : {}),
    ...(judgeAllowSameFamily !== undefined ? { judgeAllowSameFamily } : {}),
    ...(k !== undefined ? { k } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(fromConfig?.gate2 === undefined ? {} : { gate2: fromConfig.gate2 }),
    ...(silverPerTestCap !== undefined ? { seeding: { silverPerTestCap } } : {}),
    ...(fromConfig?.gate1 !== undefined
      ? { gate1: { ...(maxScreens === undefined ? {} : { maxScreens }) } } : {}),
  }
}
// Gate hosts reach eval/runtime storage only through this established composition boundary.
export { canonicalJson, markedDecisionCount, resolveMarkedDecisions, resolveProductPartition } from '@vostride/agent-qa-eval'
export { FsHandoffSource, FsMarkLedger, freezeGoldenTrajectory } from '@vostride/agent-qa-eval-local'
export { slugBranch } from '@vostride/agent-qa-runner-local'
export { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
export { createModel } from '@vostride/agent-qa-model'
export type { AgentQaConfig as FeedbackWordingConfig } from '@vostride/agent-qa-core'
export type { RunMaskingContext as FeedbackMaskingContext } from '@vostride/agent-qa-agent-local'
