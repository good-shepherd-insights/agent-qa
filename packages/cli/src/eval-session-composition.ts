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

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
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
  canonicalJson,
  computeBatchKey,
  deriveCensus,
  extractRunCassettes,
  guardCampaignManifest,
  renderBaselineComparatorRefusal,
  resolveJudgeFamily,
  resolveProductPartition,
} from '@vostride/agent-qa-eval'
import type {
  Cassette,
  CassetteLabelLeg,
  CassetteScore,
  CorpusCensus,
  DecisionScoreEntry,
  DeriveCensusInput,
  EvalBatchReport,
  JudgeIdentityBlock,
  ScoredBatchEntry,
} from '@vostride/agent-qa-eval'
import {
  DEFAULT_EVAL_CASSETTES_SUBDIR,
  DEFAULT_EVAL_REPLAYS_SUBDIR,
  FsCassetteStore,
  FsReplayRecordStore,
  FsReportStore,
  FsRunArtifactSource,
  FsScoreStore,
  commitCensus,
  commitEvalReport,
  listBaselinePointers,
  listCassetteBundleDirs,
  listCommittedReports,
  listReplayRecordDirs,
  loadCassetteBundle,
  loadReplayRecord,
  loadScoreRecord,
  readCommittedCorpus,
  runCassetteReplay,
  seedCommittedCorpus,
} from '@vostride/agent-qa-eval-local'
import type {
  CassetteBundleLoad,
  CommitCensusOutcome,
  CommitEvalReportOutcome,
  SeedingRefusal,
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
import { renderCensusMarkdown } from './eval-census-render.js'
import { renderEvalReportMarkdown } from './eval-report-render.js'
import {
  buildRunMaskingContext,
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
export type { CensusCrossCheckLine, CorpusCensus } from '@vostride/agent-qa-eval'

/** The user-facing eval params (config `eval:` block merged with per-invocation flags, D-03). */
export interface EvalCliConfig {
  judge?: string
  /** Owner override of D-10 (2026-07-12): explicit default-off same-family judging opt-in. */
  judgeAllowSameFamily?: boolean
  k?: number
  seed?: number
  seeding?: { silverPerTestCap?: number }
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
} = {}): Promise<EvalSession> {
  const configPath = input.configPath ?? 'agent-qa.config.yaml'
  const configDir = dirname(resolve(configPath))
  const config = await resolveConfig({ configPath, loadAuthPlugins: true })

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

  constructor(inputKind: string, inputName: string, searchRoot: string, verb = 'extract') {
    super(
      `No recorded ${inputKind} named "${inputName}" under ${searchRoot} — nothing to ${verb}.`,
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
  /** Stderr-destined notices: no-judge / family-preflight warnings, harness errors, empty sweep. */
  notices: string[]
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
  } = {},
): Promise<ReplayVerbResult> {
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const cassettesRoot = join(agentQaRoot, DEFAULT_EVAL_CASSETTES_SUBDIR)
  const replaysRoot = join(agentQaRoot, DEFAULT_EVAL_REPLAYS_SUBDIR)

  // (1)+(2) sweep + load: every bundle dir enters; refusals fold by reason (D-02/D-08).
  const bundleDirs = listCassetteBundleDirs(cassettesRoot)
  const loadRefusals: Record<string, number> = {}
  const loaded: Extract<CassetteBundleLoad, { kind: 'loaded' }>[] = []
  for (const bundleDir of bundleDirs) {
    const load = loadCassetteBundle(bundleDir)
    if (load.kind === 'refused') {
      bumpCounter(loadRefusals, load.refusal.reason)
      continue
    }
    loaded.push(load)
  }

  // (3) filters on the LOADED set — the ONE D-02 vocabulary; a named miss is the only throw.
  let selected = loaded
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
    notices.push('empty sweep — no staged cassette bundles matched')
    return {
      batchKey: 'empty',
      swept: bundleDirs.length,
      replayed: 0,
      loadRefusals,
      replayRefusals: {},
      scored: 0,
      judge: zeroJudge(session.evalConfig.judge !== undefined),
      replaysRoot,
      notices,
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
  const replayRefusals: Record<string, number> = {}
  const replayedDirs: string[] = []
  let replayed = 0

  for (const entry of selected) {
    // Progress ALWAYS rides stderr — stdout stays reserved for the rendered DTO.
    process.stderr.write(`replay: ${entry.cassette.id}\n`)
    let outcome: Awaited<ReturnType<typeof runCassetteReplay>>
    try {
      outcome = await runCassetteReplay({
        cassette: entry.cassette,
        artifacts: entry.artifacts,
        profile: planner.profile,
        auth: planner.auth,
        ...(opts.plannerOverrides !== undefined ? { modelOverrides: opts.plannerOverrides } : {}),
        ...(session.evalConfig.k !== undefined ? { k: session.evalConfig.k } : {}),
        ...(session.evalConfig.seed !== undefined ? { seed: session.evalConfig.seed } : {}),
        ...(judgeResolution.judge !== undefined
          ? {
              judge: {
                ...judgeResolution.judge,
                ...(opts.judgeOverrides !== undefined
                  ? { modelOverrides: opts.judgeOverrides }
                  : {}),
              },
            }
          : {}),
        maskingContextFactory: session.maskingContextFactory,
        replayOutputBaseDir: replayBaseDir,
        recordStore,
        scoreStore,
      })
    } catch (err) {
      // A helper-thrown harness error on one cassette is DATA — the loop continues (D-08,
      // the 368 never-batch-abort law extended to the CLI batch).
      bumpCounter(replayRefusals, 'harness-error')
      notices.push(
        `harness error replaying ${entry.cassette.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    if (!('granularity' in outcome)) {
      bumpCounter(replayRefusals, outcome.reason)
      continue
    }
    replayed++
    replayedDirs.push(
      join(replaysRoot, ...entry.cassette.id.split('/').map(segment => slugBranch(segment))),
    )
  }

  // (7) fold judge dispositions FROM the persisted score records — never recomputed (D-04).
  const judge = zeroJudge(judgeResolution.judge !== undefined)
  let scored = 0
  for (const recordDir of replayedDirs) {
    const load = loadScoreRecord(recordDir)
    if (load.kind === 'absent') continue
    if (load.kind === 'refused') {
      notices.push(`score read refused under ${recordDir}: ${load.refusal.detail}`)
      continue
    }
    scored++
    foldJudgeDispositions(load.record.score, judge)
  }

  return {
    batchKey,
    swept: bundleDirs.length,
    replayed,
    loadRefusals,
    replayRefusals,
    scored,
    judge,
    replaysRoot,
    notices,
  }
}

/**
 * Resolve the D-02 `--product` partition key from a cassette's recorded scope — the served
 * brief's ScopeKey is the one scope stamp every cassette carries (a procedure reads its first
 * decision record). A cassette with no decision entry maps to the typed 'default' partition.
 */
function cassetteProductPartition(cassette: Cassette): string {
  if (cassette.granularity === 'leaf') {
    return resolveProductPartition(cassette.input.servedBrief.scope)
  }
  for (const step of cassette.steps) {
    if (step.kind === 'decision') {
      return resolveProductPartition(step.record.input.servedBrief.scope)
    }
  }
  return 'default'
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
const EXCLUDED_VERDICT_CLASSES: ReadonlySet<Verdict['class']> = new Set<Verdict['class']>([
  'flake',
  'environment',
  'timeout',
])

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
  params: { silverPerTestCap?: number } = {},
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
    committedRoot,
  }

  for (const runSlug of runSlugs) {
    let report: ReturnType<typeof seedCommittedCorpus>
    try {
      const handoffPath = resolve(runsRoot, runSlug, HANDOFF_FILE)
      // The version-guarded loader is the ONE handoff read path (D-02 typed per-run skips).
      const handoff = loadCompletedRunHandoff(handoffPath)
      const product = resolveProductPartition(handoff.scope)
      // The product filter runs BEFORE the verdict read so `--product` still narrows the sweep
      // and a partition nobody asked about costs no artifact read.
      if (filters.product !== undefined && product !== filters.product) {
        result.runsFiltered++
        continue
      }
      // 413 D-04: resolve this run's verdicts and decide admission BEFORE anything touches the
      // write-once root — an admitted run cannot be un-seeded without a reviewed deletion, so the
      // filter can only ever run in front of the commit, never after it.
      const artifact = readRunAnalysisArtifact(runsRoot, runSlug, handoff.runId, result.notices)
      const row: SeedRunVerdictRow = {
        runSlug,
        product,
        verdicts: resolveSeedVerdictRows(artifact, handoff),
      }
      if (row.verdicts.some(verdict => EXCLUDED_VERDICT_CLASSES.has(verdict.class))) {
        result.runsExcluded.push(row)
        continue
      }
      result.runsAdmitted.push(row)
      const extraction = extractRunCassettes({
        handoff,
        artifacts: new FsRunArtifactSource({ root: agentQaRoot, runId: handoff.runId }),
      })
      // eval core is the ONLY decision-maker (D-16); the CLI executes the plan verbatim.
      const plan = buildSeedingPlan({
        handoff,
        cassettes: extraction.cassettes,
        // 413 D-09 forward: the committed entry records a CONFIG-RELATIVE handoff location. The
        // absolute path above is what this process loads; the string that lands in the write-once
        // root can never carry a home directory across a machine boundary (T-413-27, hygiene L1).
        handoffPath: relative(session.configDir, handoffPath),
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
): RunAnalysisArtifact | undefined {
  const path = join(runsRoot, runSlug, ANALYSIS_FILE)
  if (!existsSync(path)) return undefined
  try {
    const admission = admitAnalysisArtifactForRun(
      guardRunAnalysisArtifact(JSON.parse(readFileSync(path, 'utf8'))),
      runId,
    )
    if (admission.kind === 'admitted') return admission.artifact
    notices.push(
      `${ANALYSIS_FILE} for ${runSlug} records run ${admission.recordedRunId}, not `
        + `${admission.resolvingRunId} — deterministic floor used`,
    )
    return undefined
  } catch (err) {
    notices.push(
      `${ANALYSIS_FILE} unreadable for ${runSlug}: `
        + `${err instanceof Error ? err.message : String(err)} — deterministic floor used`,
    )
    return undefined
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
  return [...byPerTest.entries()]
    .sort(([first], [second]) => first - second)
    .map(([, verdict]) => verdict)
}

// ---- the report verb (372-07, D-13/D-14) -------------------------------------------------------

/** The report verb's one DTO — the console renders FROM this, never around it (D-04). */
export interface ReportVerbResult {
  /** sha256hex over the sorted assembled cassette ids — minted by buildEvalReport (D-13). */
  batchKey: string
  /** Persisted replay records that entered the ONE batch (refusal outcomes included). */
  entries: number
  /** The ONE whole-corpus EvalBatchReport — one buildEvalReport call, one headline (D-14). */
  report: EvalBatchReport
  /** The staged report file FsReportStore derived from the batchKey. */
  stagedFile: string
  /** The typed commitEvalReport outcome when `--commit` ran — egress blocks are DATA (D-08). */
  committed?: CommitEvalReportOutcome
  /** Batch-level judge identity: consistent blocks pass through; mixed/absent surface honestly. */
  judgeIdentity: 'present' | 'absent' | 'mixed'
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
  opts: { commit?: boolean } = {},
): Promise<ReportVerbResult> {
  const agentQaRoot = resolve(session.configDir, '.agent-qa')
  const replaysRoot = join(agentQaRoot, DEFAULT_EVAL_REPLAYS_SUBDIR)
  const cassettesRoot = join(agentQaRoot, DEFAULT_EVAL_CASSETTES_SUBDIR)
  const notices: string[] = []

  // (1) Label join index from the staged bundles: cassette id → label leg + product partition.
  // Bundle load refusals are notices — the report still assembles from the replay records.
  // Only LEAF cassettes carry a label leg (pair members are leaves, D-08); procedures join
  // with partition only.
  const labelsById = new Map<string, CassetteLabelLeg>()
  const partitionsById = new Map<string, string>()
  for (const bundleDir of listCassetteBundleDirs(cassettesRoot)) {
    const load = loadCassetteBundle(bundleDir)
    if (load.kind === 'refused') {
      notices.push(`staged bundle read refused under ${bundleDir}: ${load.refusal.detail}`)
      continue
    }
    if (load.cassette.granularity === 'leaf') {
      labelsById.set(load.cassette.id, load.cassette.label)
    }
    partitionsById.set(load.cassette.id, cassetteProductPartition(load.cassette))
  }

  // (2) Every persisted replay record is an entry: a loaded outcome verbatim, or — for an
  // unreadable record — the typed read refusal itself (a ReplayRefusal IS a ReplayCassetteOutcome).
  const assembled: ScoredBatchEntry[] = []
  const judgeBlocks: JudgeIdentityBlock[] = []
  let missingBundleCount = 0
  for (const recordDir of listReplayRecordDirs(replaysRoot)) {
    const load = loadReplayRecord(recordDir)
    const outcome = load.kind === 'loaded' ? load.outcome : load.refusal
    if (load.kind === 'refused') {
      notices.push(`replay record read refused under ${recordDir}: ${load.refusal.detail}`)
    }
    const cassetteId = outcome.cassetteId

    let score: CassetteScore | undefined
    const scoreLoad = loadScoreRecord(recordDir)
    if (scoreLoad.kind === 'loaded') {
      score = scoreLoad.record.score
      if (scoreLoad.record.judge !== undefined) judgeBlocks.push(scoreLoad.record.judge)
    } else if (scoreLoad.kind === 'refused') {
      notices.push(`score read refused under ${recordDir}: ${scoreLoad.refusal.detail}`)
    }

    const label = labelsById.get(cassetteId)
    if (!partitionsById.has(cassetteId)) missingBundleCount++

    assembled.push({
      cassetteId,
      outcome,
      ...(score !== undefined ? { score } : {}),
      ...(label !== undefined ? { label } : {}),
    })
  }
  if (missingBundleCount > 0) {
    notices.push(
      `${missingBundleCount} replay record(s) have no staged cassette bundle — label legs absent`,
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
      notices.push(
        'mixed judge identities across persisted score records — the report carries no judge '
          + 'block (never fabricated)',
      )
    }
  }

  // (5) Exactly ONE buildEvalReport call — one batch, one report, one headline (D-14). The CLI
  // never sums scores; every counter and rate is the aggregator's.
  const report = buildEvalReport(entries, judgeForReport)

  // (6) The staged report ALWAYS lands (uncommitted runtime staging, batchKey-derived filename).
  const staged = new FsReportStore({ root: agentQaRoot }).save(report)

  // (7) `--commit`: render the deterministic markdown projection and route BOTH parts through
  // commitEvalReport's egress checkpoint into the committed root (D-13) — the typed outcome
  // (committed / egress-blocked / write-conflict) folds into the DTO as data (D-08).
  let committed: CommitEvalReportOutcome | undefined
  if (opts.commit === true) {
    committed = commitEvalReport({
      report,
      markdown: renderEvalReportMarkdown(report),
      committedRoot: resolve(session.configDir, 'agent-qa-eval'),
      reportOutputBaseDir: evalAuditDir(session.configDir, 'report', report.batchKey),
    })
  }

  return {
    batchKey: report.batchKey,
    entries: entries.length,
    report,
    stagedFile: staged.file,
    ...(committed !== undefined ? { committed } : {}),
    judgeIdentity,
    notices,
  }
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
  /** Stderr-destined honesty lines: read refusals, cross-check reconciliations, comparator refusals. */
  notices: string[]
}

/**
 * The census verb pipeline (D-13/D-14): the corpus census is a property of the COMMITTED CORPUS,
 * not of a replay batch, so this verb reads the committed root directly through eval-local's read
 * leg and folds it with ONE `deriveCensus` call. Three legs feed that fold:
 *
 *   (a) the corpus itself — entries, label records, cassette bundles and local blob presence;
 *   (b) the optional `--campaign` manifest, whose run-level tallies (excluded runs, repeats, the
 *       model-call and token cost line) the committed root cannot state because an excluded run
 *       leaves no committed entry behind (D-16);
 *   (c) every committed `reports/<batchKey>/report.json`, cross-checked — the two populations are
 *       PRINTED side by side and never reconciled (RESEARCH F7: a report carries a batchKey, never
 *       its cassette-id list), and each report is run through the ONE comparator predicate so a
 *       same-family report can never be mistaken for a gate comparator (D-18/D-20, ROOT-11).
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
  const read = readCommittedCorpus(committedRoot)
  notices.push(...read.notices)
  for (const refusal of read.refusals) {
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

  // (4) The ONE pure fold — every counter, rate and tally in the DTO is the derivation's.
  const census = deriveCensus({
    snapshot: read.snapshot,
    ...(campaign === undefined ? {} : { campaign }),
    reports,
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

  return {
    ...(judge !== undefined ? { judge } : {}),
    ...(judgeAllowSameFamily !== undefined ? { judgeAllowSameFamily } : {}),
    ...(k !== undefined ? { k } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(silverPerTestCap !== undefined ? { seeding: { silverPerTestCap } } : {}),
  }
}
