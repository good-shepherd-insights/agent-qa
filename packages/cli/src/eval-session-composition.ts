// The CLI composition-root sibling for the eval verbs (Phase 372, Plan 04 — the D-05 sibling of
// run-session-composition.ts). It discharges at ONE site what every eval verb (replay / score /
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

import { existsSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  buildSeedingPlan,
  computeBatchKey,
  extractRunCassettes,
  resolveJudgeFamily,
  resolveProductPartition,
} from '@vostride/agent-qa-eval'
import type { Cassette, CassetteScore, DecisionScoreEntry } from '@vostride/agent-qa-eval'
import {
  DEFAULT_EVAL_CASSETTES_SUBDIR,
  DEFAULT_EVAL_REPLAYS_SUBDIR,
  FsCassetteStore,
  FsReplayRecordStore,
  FsRunArtifactSource,
  FsScoreStore,
  listCassetteBundleDirs,
  loadCassetteBundle,
  loadScoreRecord,
  runCassetteReplay,
  seedCommittedCorpus,
} from '@vostride/agent-qa-eval-local'
import type { CassetteBundleLoad, SeedingRefusal } from '@vostride/agent-qa-eval-local'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
import type {
  ModelProfile,
  ModelProviderOverrides,
  ResolvedModelAuth,
} from '@vostride/agent-qa-model'
import type { AgentQaConfig } from '@vostride/agent-qa-core'
import { resolveConfig } from './config.js'
import {
  buildRunMaskingContext,
  resolveRunExecutionContext,
} from './run-session-composition.js'
import type { RunExecutionContext, RunMaskingContext } from './run-session-composition.js'

// The @vostride/agent-qa-eval-local workspace edge (G5) is anchored by the real store/loader
// value imports above (372-05/06); this type re-export stays for the report verb plan (372-07)
// that consumes record loads. Erased at build — no runtime coupling.
export type { ReplayRecordLoad } from '@vostride/agent-qa-eval-local'

/** The user-facing eval params (config `eval:` block merged with per-invocation flags, D-03). */
export interface EvalCliConfig {
  judge?: string
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
 */
export async function resolveEvalJudge(session: EvalSession): Promise<{
  judge?: { profile: ModelProfile; auth: ResolvedModelAuth }
  notice?: string
}> {
  if (!session.evalConfig.judge) {
    return {
      notice: 'no judge configured — unresolved ties will record not-invoked{no-judge-configured}',
    }
  }

  const judge = await resolveNamedProfile(session.evalConfig.judge, session.configPath)
  const planner = await resolveReplayPlanner(session)
  const judgeFamily = resolveJudgeFamily(judge.profile.model)
  const plannerFamily = resolveJudgeFamily(planner.profile.model)

  if (judgeFamily === undefined || plannerFamily === undefined || judgeFamily === plannerFamily) {
    return {
      judge,
      notice:
        `judge model "${judge.profile.model}" and planner model "${planner.profile.model}" ` +
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

// ---- the seed verb (372-07, D-01/D-12/D-16/D-17) -----------------------------------------------

/** The seed verb's one DTO — per-handoff SeedingReports aggregated field-wise (D-04). */
export interface SeedVerbResult {
  /** Run dirs (with a handoff document) that entered the sweep after `--run` narrowing. */
  runsSwept: number
  /** Per-run typed skips: unreadable / version-refused handoffs (D-02, never batch errors). */
  runsSkipped: { runSlug: string; reason: string }[]
  /** Runs whose product partition differed from `--product`. */
  runsFiltered: number
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
      if (
        filters.product !== undefined
        && resolveProductPartition(handoff.scope) !== filters.product
      ) {
        result.runsFiltered++
        continue
      }
      const extraction = extractRunCassettes({
        handoff,
        artifacts: new FsRunArtifactSource({ root: agentQaRoot, runId: handoff.runId }),
      })
      // eval core is the ONLY decision-maker (D-16); the CLI executes the plan verbatim.
      const plan = buildSeedingPlan({
        handoff,
        cassettes: extraction.cassettes,
        handoffPath,
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
  const k = flags?.k ?? fromConfig?.k
  const seed = flags?.seed ?? fromConfig?.seed
  const silverPerTestCap = flags?.silverCap ?? fromConfig?.seeding?.silverPerTestCap

  return {
    ...(judge !== undefined ? { judge } : {}),
    ...(k !== undefined ? { k } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(silverPerTestCap !== undefined ? { seeding: { silverPerTestCap } } : {}),
  }
}
