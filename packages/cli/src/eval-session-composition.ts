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
import { dirname, resolve } from 'node:path'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import {
  extractRunCassettes,
  resolveJudgeFamily,
  resolveProductPartition,
} from '@vostride/agent-qa-eval'
import {
  DEFAULT_EVAL_CASSETTES_SUBDIR,
  FsCassetteStore,
  FsRunArtifactSource,
} from '@vostride/agent-qa-eval-local'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import type { AgentQaConfig } from '@vostride/agent-qa-core'
import { resolveConfig } from './config.js'
import {
  buildRunMaskingContext,
  resolveRunExecutionContext,
} from './run-session-composition.js'
import type { RunExecutionContext, RunMaskingContext } from './run-session-composition.js'

// The @vostride/agent-qa-eval-local workspace edge (G5) is now anchored by the real store/source
// value imports above (372-05); this type re-export stays for the replay/report verb plans
// (372-06/07) that consume record loads. Erased at build — no runtime coupling.
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
 * Typed named-input-not-found rejection (D-08): a `--run <slug>` (and later `--cassette <id>`)
 * naming nothing on disk is the ONLY sweep-shape failure — the command layer maps it to exit 1.
 * Per-run load failures inside a sweep are DATA (`runsSkipped`), never errors.
 */
export class EvalNamedInputError extends Error {
  readonly inputKind: string
  readonly inputName: string
  readonly searchRoot: string

  constructor(inputKind: string, inputName: string, searchRoot: string) {
    super(`No recorded ${inputKind} named "${inputName}" under ${searchRoot} — nothing to extract.`)
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
