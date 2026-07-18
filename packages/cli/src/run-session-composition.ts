// The CLI composition-root helper for `startRun` (Phase 361, Plan 10 — D-04/D-09/D-18/D-20).
//
// This module keeps the ~2800-line run.ts churn contained: it resolves everything the runner
// shell's `RunConfig` needs BEFORE `startRun` is called — config digests (the ONE mint feeding
// both the cache path and the handoff header), the run execution context, the identity masking
// seam, the runner-local persistence ports + buildOrdinal, the lazy suite-lifecycle manager, and
// the member-executor closure that wraps core's `executeSuiteMember` behind the injected
// `MemberTestExecutor` port. `startRun` itself never discovers or resolves (D-04): the composition
// root owns all of it. Phase 362 (section 7 below) seeds the real run MaskingContext both startRun
// sites wrap in `runSafetyScope`; Phase 363 dissolves the executor port's core side. A future cloud
// RPC surface reuses this same resolved-config shape.
//
// The CLI is a surface / composition root with full host access (spec §4), so this module uses
// node builtins directly and constructs the runner-local fs stores.

import { createHash } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { LanguageModel, ModelMessage } from 'ai'
import {
  createMaskingContext,
  registerFirstPartySafetyHooks,
  seedMaskingContext,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-safety'
import type { AuditSink, ConfirmPort, SafetyHookRunner } from '@vostride/agent-qa-safety'
import {
  createReadlineConfirm,
  detectExecutionContext,
  JsonlAuditSink,
} from '@vostride/agent-qa-safety-local'
import {
  createConsoleReporter,
  createJunitReporter,
  createWireReporter,
} from './reporters/index.js'
import type {
  ConsoleReporterHandle,
  ConsoleReporterOptions,
  JunitReporterHandle,
} from './reporters/index.js'
// Type-only (erased at build; schema is a type-only devDependency, 363-07). The bus subscriber
// handlers name the real envelope type without a runtime schema coupling.
import { guardToolOutput } from '@vostride/agent-qa-model'
import type { TokenAccounting } from '@vostride/agent-qa-model'
import { openKnowledgeReader } from '@vostride/agent-qa-knowledge-local'
import type {
  MaskingContext,
  ModelCapabilities,
  RunEventEnvelope,
  ScopeKey,
} from '@vostride/agent-qa-schema'
import {
  FsEventLog,
  FsEvidenceArtifactStore,
  FsHandoffStore,
  FsRunArtifactStore,
  nextBuildOrdinal,
  recordBuildTag,
  RUNS_SUBDIR,
  slugBranch,
  SharpScreenshotCompressor,
} from '@vostride/agent-qa-runner-local'
import type { ScreenshotCompressorLogger } from '@vostride/agent-qa-runner-local'
import {
  coerceRunJSResult,
  createMemoryTools,
  createRecordLedger,
  resolveSecretEnv,
  resolveSecretTemplatesInValue,
} from '@vostride/agent-qa-runner'
import type {
  Action,
  AccessibilityCheckHandler,
  ActionPlanCache,
  AppiumScriptHandler,
  ConfigDigests,
  EventLogPort,
  EvidenceArtifactStorePort,
  FailureScreenshotWriter,
  HandoffStorePort,
  HookDefinition,
  HookExecutorPort,
  LoopLogger,
  MemberEventSink,
  MemberRunConfig,
  MemberStepSpec,
  MemberTest,
  MemberTestExecutor,
  MemberTestRunContext,
  NonActionToolMap,
  PlannerConfig,
  Planner,
  PlatformAdapter,
  KnowledgeHintReader,
  RecordLedger,
  RunArtifactStorePort,
  RunJsHandler,
  RunMemberDescriptor,
  SandboxRunnerOptions,
  ScreenshotCompressor,
  SecretRedactorPort,
  SecretStore,
  StorageStatePort,
  TestResult,
  Verifier,
  WorkingMemoryPort,
} from '@vostride/agent-qa-runner'
import {
  computeKnowledgeBudgets,
  memoryToolGate,
  scaledRecordCap,
  type KnowledgeBudgets,
} from './composition/knowledge-budgets.js'

// ---- Local structural types -----------------------------------------------------------------
// The CLI does not take a `@vostride/agent-qa-schema` dependency purely to name these injected
// seam types — the local shapes structurally satisfy the runner `RunConfig` fields. ExecutionContext
// mirrors the schema union exactly.

/** Mirror of schema's ExecutionContext union (safety-local's detectExecutionContext returns it). */
export type RunExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'

// ---- (0) run-scoped knowledge serving composition (D-01/D-02/D-09/D-15/D-17/D-23) ----------

type KnowledgeAccounting = Pick<TokenAccounting, 'estimate' | 'getCeilings'>

export interface RunKnowledgeComposition {
  reader: KnowledgeHintReader
  budgets: KnowledgeBudgets
  recordLedger: RecordLedger
  nonActionTools?: NonActionToolMap
  beginMemoryTurn?: (scope?: ScopeKey) => void
}

/**
 * Freeze Channel 1 at the composition root. The budget is deliberately absent from the key:
 * budgets are run-fixed, while canonical `[tier,key]` material gives one immutable memo entry per
 * scope. All other reader methods remain live pass-throughs for Channels 2, 3, and canary output.
 */
export function createFrozenKnowledgeReader(reader: KnowledgeHintReader): KnowledgeHintReader {
  const briefs = new Map<string, ReturnType<KnowledgeHintReader['getRunBrief']>>()
  const scopeKey = (scope: ScopeKey): string => JSON.stringify([scope.tier, scope.key])

  return {
    getRunBrief(scope, budget) {
      const key = scopeKey(scope)
      const existing = briefs.get(key)
      if (existing !== undefined) return existing
      const brief = reader.getRunBrief(scope, budget)
      briefs.set(key, brief)
      return brief
    },
    search: (query, options) => reader.search(query, options),
    read: (id, options) => reader.read(id, options),
    getCautions: (anchors, budget) => reader.getCautions(anchors, budget),
    getProcedure: (intent, screenState) => reader.getProcedure(intent, screenState),
    emitCanaryOutcome: (payload) => reader.emitCanaryOutcome(payload),
  }
}

export interface OpenRunKnowledgeCompositionInput {
  knowledgeRoot: string
  product?: string
  scope: ScopeKey
  /** Known containing scopes for a member (the suite scope on prepared-suite runs). */
  parentScopes?: readonly ScopeKey[]
  asOfBuild: number
  capabilities: ModelCapabilities
  accounting: KnowledgeAccounting
  qaRulesText: string
  workingContextText: string
}

/**
 * Open and bind the complete serving stack once per run/planner scope. The CLI can estimate only
 * prompt material it owns, so `qaRulesText` is the run-start capability/rules appendix and
 * `workingContextText` is the resolved suite/test context plus steps. Both ride the same model
 * accounting estimator as planning calls; static runner rules remain covered by the reserved
 * output and conservative fractional allocation rather than a second character heuristic.
 */
export function openRunKnowledgeComposition(
  input: OpenRunKnowledgeCompositionInput,
): RunKnowledgeComposition {
  const ceilings = input.accounting.getCeilings()
  const qaRulesTokens = input.accounting.estimate([
    { role: 'system', content: input.qaRulesText } as ModelMessage,
  ])
  const workingContextTokens = input.accounting.estimate([
    { role: 'user', content: input.workingContextText } as ModelMessage,
  ])
  const computed = computeKnowledgeBudgets({
    contextWindow: ceilings.contextWindow,
    reservedOutput: ceilings.maxOutput,
    qaRulesTokens,
    workingContextTokens,
  })
  const budgets: KnowledgeBudgets = {
    ...computed,
    recordCap: scaledRecordCap(input.capabilities),
  }
  const reader = createFrozenKnowledgeReader(openKnowledgeReader({
    knowledgeRoot: input.knowledgeRoot,
    ...(input.product === undefined ? {} : { product: input.product }),
    scopeDefaults: {
      asOfBuild: input.asOfBuild,
      ...(input.parentScopes === undefined ? {} : { parentScopes: input.parentScopes }),
    },
    budgets: { recordCap: budgets.recordCap },
  }))
  const recordLedger = createRecordLedger({ cap: budgets.recordCap, seedIds: [] })

  // D-09/T-380-29: the planner's action slice remains whole under the always-send-all law. The
  // optional non-action slice is composed only for capable models, so non-registration itself is
  // the gate and no model-visible flag can elevate a weak profile into Channel 2.
  const memory = memoryToolGate(input.capabilities)
    ? createMemoryTools({
        reader,
        scope: input.scope,
        asOfBuild: input.asOfBuild,
        readBodyBudget: budgets.readBody,
        recordLedger,
        estimateTokens: (text) => input.accounting.estimate([
          { role: 'user', content: text } as ModelMessage,
        ]),
      })
    : undefined

  return {
    reader,
    budgets,
    recordLedger,
    nonActionTools: memory?.tools,
    beginMemoryTurn: memory?.beginTurn,
  }
}

// ---- (1) computeRunConfigDigests — the ONE digest mint (D-20) --------------------------------

/** One member's file inputs to the digest mint. `suiteFileContent` is absent on the single-test path. */
export interface RunDigestMemberInput {
  testFileContent: string
  suiteFileContent?: string
}

/**
 * The per-member cache pair AND the run-level handoff pair, both produced by the SINGLE call
 * below (D-20). The cache-key threading consumes `perMember[i]`; the handoff header carries
 * `runLevel`. Because both draw from one mint, run identity and handoff identity cannot fork.
 */
export interface RunConfigDigests {
  runLevel: ConfigDigests
  perMember: ConfigDigests[]
}

/** 16-hex SHA-256 digest of a UTF-8 string (the 356 A5 `sha256hex16` value; node:crypto here). */
function digest16(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Mint the run's config digests ONCE (D-20; RESEARCH A1 pinning).
 *
 * - Per-member cache pair:
 *     suiteConfigDigest = sha256hex16(configContent + '\n' + (suiteFileContent ?? ''))
 *     testConfigDigest  = sha256hex16(testFileContent)
 * - Run-level handoff pair:
 *     suiteConfigDigest = sha256hex16(ordered DISTINCT per-member suite digests joined by '\n')
 *     testConfigDigest  = sha256hex16(ordered per-member test digests joined by '\n')
 *   A single-member run collapses the run-level pair to the member's values.
 *
 * Both consumers (per-member cache, run-level handoff) draw from this one call — identities
 * cannot fork. This is the ONLY digest computation in the composition layer.
 */
export function computeRunConfigDigests(input: {
  configContent: string
  members: readonly RunDigestMemberInput[]
}): RunConfigDigests {
  const perMember: ConfigDigests[] = input.members.map((m) => ({
    suiteConfigDigest: digest16(input.configContent + '\n' + (m.suiteFileContent ?? '')),
    testConfigDigest: digest16(m.testFileContent),
  }))

  if (perMember.length === 1) {
    // Single-member runs collapse the run-level pair to the member values.
    return { runLevel: { ...perMember[0] }, perMember }
  }

  const distinctSuiteDigests: string[] = []
  const seen = new Set<string>()
  for (const pair of perMember) {
    if (!seen.has(pair.suiteConfigDigest)) {
      seen.add(pair.suiteConfigDigest)
      distinctSuiteDigests.push(pair.suiteConfigDigest)
    }
  }

  const runLevel: ConfigDigests = {
    suiteConfigDigest: digest16(distinctSuiteDigests.join('\n')),
    testConfigDigest: digest16(perMember.map((p) => p.testConfigDigest).join('\n')),
  }

  return { runLevel, perMember }
}

// ---- (2) resolveRunExecutionContext — canonical resolver (D-04) ------------------------------

/**
 * Resolve the run's execution context via safety-local's canonical `detectExecutionContext`
 * (RESEARCH Q1.4 recommendation (a) — already tested; an explicit override wins). Carried into
 * `RunConfig.executionContext` and the handoff header.
 */
export function resolveRunExecutionContext(override?: RunExecutionContext): RunExecutionContext {
  return detectExecutionContext(override) as RunExecutionContext
}

// ---- (3) run masking seed pipeline lives in section (7) below (SEAM-01, 362-06) --------------
// The pre-362 identity masking injection point is gone: both run.ts startRun sites now construct the
// real seeded run MaskingContext via `buildRunMaskingContext` (section 7) and run the body inside
// `runSafetyScope`. No production call site constructs an identity masking context.

// ---- (4) buildRunPorts + buildOrdinal — runner-local persistence tier (D-06/D-17/D-18) -------

/** The durable run ports the shell wires behind `RunConfig.ports` (event log + handoff + artifact). */
export interface RunPersistencePorts {
  eventLog: EventLogPort
  handoffStore: HandoffStorePort
  runArtifactStore: RunArtifactStorePort
  /**
   * CASS-02 run-scoped decision-screenshot store (Plan 13). Constructed once here from the SAME
   * persistence root + runId as the other adapters; the shell hands this exact instance to every
   * member so Plan 12's live-decision producer persists into one durable, run-addressable namespace.
   */
  evidenceArtifacts: EvidenceArtifactStorePort
}

/**
 * Construct the runner-local persistence ports rooted at the run's `.agent-qa` runtime dir (the
 * FsActionCache rooting idiom). `FsEventLog`/`FsHandoffStore`/`FsRunArtifactStore`/
 * `FsEvidenceArtifactStore` all write under the SAME `<configDir>/.agent-qa/runs/<slug(runId)>/…`
 * family (D-08 — one self-contained run dir).
 */
export function buildRunPorts(input: { configDir: string; runId: string }): RunPersistencePorts {
  const root = resolve(input.configDir, '.agent-qa')
  return {
    eventLog: new FsEventLog({ root, runId: input.runId }),
    handoffStore: new FsHandoffStore({ root, runId: input.runId }),
    runArtifactStore: new FsRunArtifactStore({ root, runId: input.runId }),
    evidenceArtifacts: new FsEvidenceArtifactStore({ root, runId: input.runId }),
  }
}

/**
 * Construct the D-08/Q10 screenshot compressor at the CLI composition root (sharp's host-adapter
 * home). The runner-local `SharpScreenshotCompressor` is injected into every member's runner loop
 * via `RunSuiteConfig.compressor` / `RunTestConfig.compressor` — core no longer constructs one.
 */
export function buildScreenshotCompressor(logger?: ScreenshotCompressorLogger): ScreenshotCompressor {
  return new SharpScreenshotCompressor(logger)
}

/** Resolve D-16 build-tag precedence without reading ambient process state. */
export function resolveBuildTagSetting(input: {
  flag?: string
  env?: string
  use?: { buildTag?: string }
}): string | undefined {
  for (const value of [input.flag, input.env, input.use?.buildTag]) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

/**
 * Advance the per-product buildOrdinal counter under the same `.agent-qa` root (D-18), then
 * record D-14/D-16's first-seen tag mapping beside it when supplied. Both files are lock-free,
 * best-effort runtime truth; the resolved ordinal rides `RunConfig.buildOrdinal` into the handoff.
 */
export async function resolveRunBuildOrdinal(input: {
  configDir: string
  product: string
  buildTag?: string
}): Promise<number> {
  const root = resolve(input.configDir, '.agent-qa')
  const ordinal = await nextBuildOrdinal({ root, product: input.product })
  if (input.buildTag !== undefined) {
    await recordBuildTag({
      root,
      product: input.product,
      tag: input.buildTag,
      ordinal,
    })
  }
  return ordinal
}

// ---- (5) createSuiteLifecycle — lazy per-suite setup/teardown --------------------------------

/** The setup/teardown pair a suite runs when it first becomes active / when it is torn down. */
export interface SuiteLifecycleHooks {
  /** Suite-level setup: setup hooks + adapter.setup + suite-URL navigation. */
  setup(): Promise<void>
  /** Suite-level teardown: teardown hooks + auth-state capture (when all passed) + adapter.cleanup. */
  teardown(): Promise<void>
}

export interface SuiteLifecycle {
  /**
   * Ensure `suiteKey` is the active suite before running a member. On the FIRST member of a suite
   * this runs the suite's setup; crossing a suite boundary first tears down the previous suite.
   * Idempotent within a suite (repeat calls for the active key are no-ops).
   */
  ensureReady(suiteKey: string, hooks: SuiteLifecycleHooks): Promise<void>
  /** Tear down the last active suite (if any). Called once at run end after `session.done`. */
  finalize(): Promise<void>
}

/**
 * A lazy suite-lifecycle manager (the Q1.2 "pre/post-run CLI composition" rows). It tracks the
 * active suite: `ensureReady` sets up a suite on its first member and tears down the previous
 * suite when a member crosses a boundary; `finalize` tears down the last active suite. A wholly
 * SKIPPED suite never sets up — the shell only invokes the executor (hence `ensureReady`) for
 * non-skipped members, so a suite whose members are all fail-fast/cancel skips is never touched.
 */
export function createSuiteLifecycle(): SuiteLifecycle {
  let activeKey: string | undefined
  let activeTeardown: (() => Promise<void>) | undefined

  return {
    async ensureReady(suiteKey, hooks) {
      if (activeKey === suiteKey) return
      if (activeTeardown) await activeTeardown()
      await hooks.setup()
      activeKey = suiteKey
      activeTeardown = hooks.teardown
    },
    async finalize() {
      if (activeTeardown) await activeTeardown()
      activeKey = undefined
      activeTeardown = undefined
    },
  }
}

// ---- (6) buildSuiteMemberExecutor — the MemberTestExecutor closure (D-01) ---------------------

/**
 * One prepared suite member: its suite key + lifecycle hooks (setup runs on the first member of
 * that suite) and a `run(ctx)` that builds the member's bound `SuiteMemberInput` around core's
 * per-test machinery and returns `executeSuiteMember(...)` with the shell-provided ctx seams
 * (abortSignal, events, per-member configDigests) threaded in.
 */
export interface SuiteMemberBinding {
  suiteKey: string
  hooks: SuiteLifecycleHooks
  run(ctx: MemberTestRunContext): Promise<TestResult>
}

/**
 * Build the injected `MemberTestExecutor` (D-01). Per member the closure looks up the prepared
 * binding by the shell-derived `testIndex` (array position — authoritative), calls
 * `lifecycle.ensureReady(...)` to lazily set up / cross-boundary tear down the member's suite,
 * then runs the member behind `executeSuiteMember`. Wrapping ONE audited function instead of
 * replicating the loop body.
 */
export function buildSuiteMemberExecutor(input: {
  lifecycle: SuiteLifecycle
  bindings: readonly SuiteMemberBinding[]
}): MemberTestExecutor {
  return async (member: RunMemberDescriptor, ctx: MemberTestRunContext): Promise<TestResult> => {
    const binding = input.bindings[ctx.testIndex]
    if (!binding) {
      throw new Error(`No suite-member binding for testIndex ${ctx.testIndex} (testId ${member.testId})`)
    }
    await input.lifecycle.ensureReady(binding.suiteKey, binding.hooks)
    return binding.run(ctx)
  }
}

// ---- (7) masking seed pipeline — sensitiveEnvSlice / extractAuthStateSensitiveStrings / -------
// ---------------------------------- buildRunMaskingContext (D-05/D-06/D-07) --------------------
//
// The real MaskingContext seed pipeline 362-06 wires at both run.ts startRun sites (the former D-09
// identity injection point). seedMaskingContext registers EVERY env value it is handed (filtering is explicitly the
// caller's job), so `sensitiveEnvSlice` is the D-05 gate: masking must never degrade planning, so
// selection is name-based ONLY (never value-based) — planner-visible config (BASE_URL, NODE_ENV,
// HOME, PATH) is never seeded while every ambient-credential-shaped name is. `extractAuthStateSensitiveStrings`
// is the D-07 channel (all cookie + all localStorage values, no classification heuristics — exact-string
// masking means benign blobs only mask when the app renders that exact string). The ≥4-char
// `minRegisteredLength` guard rides through unchanged.

/** Uppercase-name suffix families that mark an env var as an ambient credential (D-05). */
const SENSITIVE_ENV_SUFFIXES: readonly string[] = [
  '_KEY',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_PASSWD',
  '_CREDENTIAL',
  '_CREDENTIALS',
  '_AUTH',
]

/** Uppercase-name prefix families that mark an env var as an ambient credential (D-05). */
const SENSITIVE_ENV_PREFIXES: readonly string[] = [
  'AWS_SECRET',
  'AWS_SESSION',
  'ANTHROPIC_',
  'OPENAI_',
  'GH_',
  'NPM_TOKEN',
  'GITHUB_TOKEN',
]

/**
 * Select the sensitive slice of `env` by NAME only (D-05). Deterministic: an uppercased name is
 * kept when it ends with a sensitive suffix family OR begins with a sensitive prefix family.
 * Never reads or matches on env VALUES; undefined values are skipped. The kept values feed
 * `seedMaskingContext`'s `env` channel — planner-visible config names never appear here.
 */
export function sensitiveEnvSlice(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = name.toUpperCase()
    const sensitive =
      SENSITIVE_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix)) ||
      SENSITIVE_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
    if (sensitive) out[name] = value
  }
  return out
}

/**
 * Walk a Playwright `storageState` payload defensively and return every `cookies[].value` string
 * plus every `origins[].localStorage[].value` string (D-07). No classification; tolerant of
 * missing/odd sections and non-string values; returns [] for a non-object payload. The shape
 * mirrors what `captureAuthStateForRun` (run.ts) persists.
 */
export function extractAuthStateSensitiveStrings(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') return []
  const out: string[] = []

  const cookies = (payload as { cookies?: unknown }).cookies
  if (Array.isArray(cookies)) {
    for (const cookie of cookies) {
      const value = (cookie as { value?: unknown } | null)?.value
      if (typeof value === 'string') out.push(value)
    }
  }

  const origins = (payload as { origins?: unknown }).origins
  if (Array.isArray(origins)) {
    for (const origin of origins) {
      const localStorage = (origin as { localStorage?: unknown } | null)?.localStorage
      if (!Array.isArray(localStorage)) continue
      for (const entry of localStorage) {
        const value = (entry as { value?: unknown } | null)?.value
        if (typeof value === 'string') out.push(value)
      }
    }
  }

  return out
}

/** The full run MaskingContext (register/dispose included) — 362-06 registers mid-run auth (D-06). */
export type RunMaskingContext = ReturnType<typeof createMaskingContext>

/**
 * Construct and seed the run's real MaskingContext (D-05/D-06/D-07). One `createMaskingContext()`
 * (default ≥4-char guard) seeded by a single `seedMaskingContext` call drawing from all three
 * sources: the run's `SecretStore` (all values), the D-05 name-based sensitive env slice, and the
 * concatenated D-07 auth-state values. The FULL context is returned so 362-06 can register mid-run
 * auth values at lazy suite load/capture (D-06) and dispose at run end.
 */
export function buildRunMaskingContext(input: {
  secretStore?: { forEachSecret(cb: (name: string, value: string) => void): void }
  env?: NodeJS.ProcessEnv
  authStatePayloads?: readonly unknown[]
}): RunMaskingContext {
  const ctx = createMaskingContext()
  const knownSensitiveStrings = (input.authStatePayloads ?? []).flatMap((payload) =>
    extractAuthStateSensitiveStrings(payload),
  )
  seedMaskingContext(ctx, {
    secretStore: input.secretStore,
    env: sensitiveEnvSlice(input.env ?? {}),
    authState: { knownSensitiveStrings },
  })
  return ctx
}

// ---- (8) per-run stamped audit sink — stampAuditSink / buildRunAuditSink (D-12/D-13) ---------
//
// D-13: `evaluate()` stays the single execution-audit author (untouched); the run stamps
// correlation at ONE composition-root site — a thin wrapper that injects runId + the resolved
// executionContext into every row before append so rows are self-describing (SEAM-02 is literal
// in the row, no joins). The stamp WINS over any pre-existing row field (RESEARCH Open Q3): spread
// the row FIRST, stamp AFTER. D-12: the sink is a JsonlAuditSink rooted at the SAME
// .agent-qa/runs/<slug(runId)>/ directory FsEventLog uses (slugBranch reuse — path forking is the
// failure mode), so a completed run is one self-contained directory.

/**
 * Wrap an AuditSink so every appended row carries `runId` + `executionContext` (D-13). Stamp-wins:
 * the row is spread first and the stamp applied after, so a stale row field never survives.
 * Guardrail rows carry `runId` only (their schema has no executionContext). The void-or-promise
 * return of the inner sink is preserved.
 */
export function stampAuditSink(
  inner: AuditSink,
  runId: string,
  executionContext: RunExecutionContext,
): AuditSink {
  return {
    appendExecutionAudit(row) {
      return inner.appendExecutionAudit({ ...row, runId, executionContext })
    },
    appendGuardrailAudit(row) {
      return inner.appendGuardrailAudit({ ...row, runId })
    },
  }
}

/**
 * Build the per-run stamped audit sink (D-12/D-13). A `JsonlAuditSink` rooted at the EXACT run dir
 * `FsEventLog`/`FsHandoffStore` write to — `<configDir>/.agent-qa/runs/<slugBranch(runId)>/` — so
 * execution_audit.jsonl / guardrail_audit.jsonl land beside events.jsonl + handoff.json. The
 * slug is `slugBranch` from runner-local (the exact slug the event log uses); path forking would
 * scatter a run's evidence. The sink is wrapped by `stampAuditSink` so every row is correlated.
 */
export function buildRunAuditSink(input: {
  configDir: string
  runId: string
  executionContext: RunExecutionContext
}): AuditSink {
  const runDir = resolve(input.configDir, '.agent-qa', RUNS_SUBDIR, slugBranch(input.runId))
  return stampAuditSink(new JsonlAuditSink(runDir), input.runId, input.executionContext)
}

// ---- (9) per-run safety-hooks registrar — buildRunSafetyHooks (D-01/D-15/D-10/D-11) ----------
//
// D-01: the loop's SafetyHookRunner is a SECOND, per-run registerFirstPartySafetyHooks() invocation
// at the composition root with DIRECT deps (the model registry's deps-less call stays untouched).
// It carries the stamped per-run sink, a pause-timing ConfirmPort decorator, the resolved execution
// context, and the D-15 trust flag. D-10: the decorator measures each awaited confirm and accumulates
// the elapsed ms into a closure counter exposed as `confirmPausedMs` — the run-budget supplier 362-06
// wires into RunPorts.confirmPausedMs so human decision time never counts against the app under test.
// D-11: NO reader is passed — the no-standing-approvals default is reached by omission (the standing-
// approval WRITE side is M4's). Reporter/stdout interleaving beyond the readline default is 363 scope.

/**
 * Perform the D-01 per-run `registerFirstPartySafetyHooks` invocation and return the loop's
 * `SafetyHookRunner` plus the D-10 confirm-pause supplier. The confirm (readline by default, D-15)
 * is wrapped in a timing decorator whose accumulated awaited-ms is exposed via `confirmPausedMs()`.
 * `trustMode` flows through as `GateTrust.trustMode` (D-15). No `reader` is supplied so the
 * no-standing-approvals default holds by omission (D-11).
 */
export function buildRunSafetyHooks(input: {
  auditSink: AuditSink
  executionContext: RunExecutionContext
  trustMode: boolean
  confirm?: ConfirmPort
  /** The run MaskingContext — when supplied, the ask-tier prompt is unmasked for the human (D-11). */
  maskingContext?: RunMaskingContext
  /** Console pause/resume seam so the live TTY line is flushed around the readline question (Pitfall 4). */
  live?: LivePauseController
}): { safetyHooks: SafetyHookRunner; confirmPausedMs: () => number } {
  let pausedMs = 0
  const baseConfirm = input.confirm ?? createReadlineConfirm()
  const timedConfirm: ConfirmPort = async (action) => {
    const start = performance.now()
    try {
      return await baseConfirm(action)
    } finally {
      pausedMs += performance.now() - start
    }
  }

  // D-11: the unmask decorator composes OVER the timed decorator (timing still measures the human
  // pause), pausing/flushing the console reporter's live TTY line around the readline question and
  // delivering the UNMASKED prompt text to the human. The gate keeps its own MASKED action for the
  // deny/audit record, so machine-durable surfaces never see restored values (T-363-20/21).
  const confirm = input.maskingContext
    ? buildUnmaskingConfirm({ base: timedConfirm, maskingContext: input.maskingContext, live: input.live })
    : timedConfirm

  const { registry } = registerFirstPartySafetyHooks({
    auditSink: input.auditSink,
    confirm,
    resolveExecutionContext: () => input.executionContext,
    trust: { trustMode: input.trustMode },
  })

  return { safetyHooks: registry, confirmPausedMs: () => pausedMs }
}

// ---- (10) bus subscriber attachment + D-11 unmasking confirm decorator (363-09) ---------------
//
// The live-path composition swap (361 D-12): both run.ts startRun sites attach the Plan 07 reporters
// (console UNMASKS, junit + wire stay MASKED) plus the Plan 08 dashboard ingest / analytics subscriber
// onto the bus via `session.subscribe(REPLAY_FROM_START, …)` (replay-then-live gives D-04 for free),
// and await every subscriber's flush after `session.done` BEFORE the verdict is mapped to the exit
// code (Pitfall 6/8). The v1 Reporter constructions are gone from the CLI; core's internal
// MultiReporter goes inert (empty reporter list) until Plan 11 deletes it.

// The bus assigns sequence numbers from 1 (seq 0 never exists). Subscribing from seq 1 replays every
// retained event then goes live — a subscribe(0) would demand a seq-0 prefix the log can never supply
// and raise ReplayIncompleteError (bus.ts collectReplay/D-07). This is the full replay-then-live floor.
const REPLAY_FROM_START = 1

/**
 * The console pause/resume seam shared between the console reporter (attached at the startRun site)
 * and the D-11 confirm decorator (built earlier, at `buildRunSafetyHooks`). `bind` is called by
 * `attachRunSubscribers` once the console reporter exists; the confirm decorator reads through the
 * live target at call time. Guards swallow their own errors so a reporter fault never blocks a prompt.
 */
export interface LivePauseController {
  pauseLive(): void
  resumeLive(): void
  bind(handle: { pauseLive(): void; resumeLive(): void } | undefined): void
}

export function createLivePauseController(): LivePauseController {
  let active: { pauseLive(): void; resumeLive(): void } | undefined
  return {
    pauseLive() {
      try { active?.pauseLive() } catch { /* a reporter fault must never block a live prompt */ }
    },
    resumeLive() {
      try { active?.resumeLive() } catch { /* ditto */ }
    },
    bind(handle) {
      active = handle ?? undefined
    },
  }
}

/**
 * Wrap a base `ConfirmPort` with the D-11 human-output unmasking decorator (Pitfall 4). Before
 * delegating it (1) pauses the console reporter's live TTY line so the readline question is not
 * clobbered, (2) applies EXACTLY ONE `unmaskForHumanOutput` call on the final rendered prompt text
 * (the ask-tier prompt is `Proceed with <action.name>? …`, so `name` is the only human-visible
 * placeholder-bearing field) and delegates with a display-only action carrying the unmasked name,
 * and (3) resumes the live line on answer. The ORIGINAL masked action is never mutated — the gate
 * records the deny/allow decision MASKED (T-363-21). No unmasked value is retained beyond the call.
 */
export function buildUnmaskingConfirm(input: {
  base: ConfirmPort
  maskingContext: RunMaskingContext
  live?: LivePauseController
}): ConfirmPort {
  return async (action) => {
    input.live?.pauseLive()
    try {
      const displayName = unmaskForHumanOutput(input.maskingContext, action.name)
      const displayAction = displayName === action.name ? action : { ...action, name: displayName }
      return await input.base(displayAction)
    } finally {
      input.live?.resumeLive()
    }
  }
}

/** A bus subscriber the CLI attaches: an envelope `handler` plus an optional post-run `flush`. */
export interface RunSubscriberHandle {
  handler: (envelope: RunEventEnvelope) => void
  flush?: () => Promise<void>
}

/** The minimal RunSession surface `attachRunSubscribers` needs (subscribe replay-then-live). */
export interface AttachableRunSession {
  subscribe(fromSeq: number | undefined, handler: (envelope: RunEventEnvelope) => void): () => void
}

export interface AttachRunSubscribersInput {
  session: AttachableRunSession
  /** The run MaskingContext — the console reporter's sole unmasking authority (SEAM-05). */
  maskingContext: RunMaskingContext
  /** Console reporter options, or `false` to skip the console surface for this run. */
  console?: ConsoleReporterOptions | false
  /** JUnit output path — when set, the masked durable JUnit subscriber is attached and flushed. */
  junitOutputPath?: string
  /** Prebuilt out-of-package subscribers (dashboard ingest, analytics) constructed by run.ts. */
  extraSubscribers?: readonly RunSubscriberHandle[]
  /** Console pause/resume seam bound here so the D-11 confirm decorator can coordinate. */
  live?: LivePauseController
}

/**
 * Attach the run's bus subscribers at a startRun site (used by BOTH sites — Pitfall 8). Constructs
 * the CLI-owned reporters (console unmasks; junit + wire stay masked, wire env-gated internally),
 * subscribes each via `session.subscribe(REPLAY_FROM_START, …)` alongside any `extraSubscribers` (dashboard/analytics),
 * binds the console pause/resume seam to the live controller, and returns a single `flush()` awaiting
 * every subscriber's flush (JUnit write, dashboard finalize, analytics drain) — the CLI awaits this
 * after `session.done` before mapping the verdict to the exit code.
 */
export function attachRunSubscribers(input: AttachRunSubscribersInput): { flush: () => Promise<void> } {
  const flushes: Array<() => Promise<void>> = []

  let consoleHandle: ConsoleReporterHandle | undefined
  if (input.console !== false) {
    consoleHandle = createConsoleReporter(input.maskingContext, input.console ?? {})
    input.session.subscribe(REPLAY_FROM_START, consoleHandle.handler)
    flushes.push(consoleHandle.flush)
  }
  // Bind (or clear) the console pause/resume seam the D-11 confirm decorator reads through.
  input.live?.bind(consoleHandle)

  if (input.junitOutputPath) {
    const junit: JunitReporterHandle = createJunitReporter({ outputPath: input.junitOutputPath })
    input.session.subscribe(REPLAY_FROM_START, junit.handler)
    flushes.push(junit.flush)
  }

  // Wire is AGENT_QA_LIVE_EVENTS-gated internally; always attach (no flush — synchronous printer).
  const wire = createWireReporter()
  input.session.subscribe(REPLAY_FROM_START, wire.handler)

  for (const sub of input.extraSubscribers ?? []) {
    input.session.subscribe(REPLAY_FROM_START, sub.handler)
    if (sub.flush) flushes.push(sub.flush)
  }

  return {
    // `allSettled`: every subscriber's flush runs to completion and a single fault (a best-effort
    // analytics/dashboard write) never aborts the others or the run (D-08 detach-on-error philosophy,
    // RUNX-03). All flushes complete BEFORE the caller maps the verdict / exits (Pitfall 6/8).
    async flush(): Promise<void> {
      await Promise.allSettled(flushes.map((f) => f()))
    },
  }
}

// ---- (11) member-run-config builder — the D-05 cutover onto runMemberTest (363-11) -----------
//
// Both startRun sites (suite + single-test) execute each member through the runner-owned
// `runMemberTest` (Plan 10). The executor closure at each site composes core-owned memory
// init/curator/destroy AROUND this member run and returns the member `TestResult` to the shell.
// `buildMemberRunConfig` is the ONE place (Pitfall 8 — no per-site drift) that maps the resolved
// host impls into a `MemberRunConfig`, constructing the adapter-backed injected handlers the runner
// stays neutral about: runJS (web `page.evaluate` + `coerceRunJSResult`), appium (adapter execute
// with secret resolution), the accessibility check (dynamic web-package import), the failure
// screenshot writer, and the store-neutral secret resolver. Adapter internals are legal HERE — this
// is the CLI composition root (D-05). Core's `runTest`/`runTestWithRetry` per-test wrapper is gone;
// its responsibilities live in `runMemberTest` (runner) and in the memory/curator composition here.

/** Capture a best-effort failure screenshot from the adapter (re-homed from the deleted core
 * reporter/screenshot.ts). Returns undefined when the adapter exposes no screenshot capability or
 * capture throws — never fails the step. */
async function captureFailureScreenshotFromAdapter(adapter: PlatformAdapter): Promise<Buffer | undefined> {
  try {
    const shot = (adapter as { screenshot?: () => Promise<Buffer> }).screenshot
    if (typeof shot !== 'function') return undefined
    return await shot.call(adapter)
  } catch {
    return undefined
  }
}

/** Build the injected runJS handler (Q-2). Web-only, mirroring the deleted core runjs-inline
 * execution half: resolve the page from the adapter, `page.evaluate`, coerce the result. Non-web /
 * page-less returns a `[runJS error: …]` value the runner splices in (the same self-describing text
 * core produced). */
function buildRunJsHandler(adapter: PlatformAdapter): RunJsHandler {
  return async (code, ctx) => {
    if (adapter.platform !== 'web') {
      return { value: '[runJS error: runJS is only supported on web platform]', error: 'runJS is only supported on web platform' }
    }
    const page = 'getPage' in adapter
      ? (adapter as { getPage: () => { evaluate: (c: string) => Promise<unknown> } | undefined }).getPage()
      : undefined
    if (!page) {
      return { value: '[runJS error: no browser page available]', error: 'no browser page available' }
    }
    void ctx
    const raw = await page.evaluate(code)
    return { value: coerceRunJSResult(raw) }
  }
}

/** Build the injected appium handler (Q-2). Resolves secret templates in the action, then executes
 * it on the adapter (the core appium-inline execution half). */
function buildAppiumScriptHandler(adapter: PlatformAdapter, secretStore?: SecretStore): AppiumScriptHandler {
  return async (action) => adapter.execute(resolveSecretTemplatesInValue(action as Action, secretStore) as Action)
}

/** Build the injected accessibility-check handler (Q-4). Web-only; resolves the page and runs the
 * dynamically-imported `@vostride/agent-qa-web` `runAccessibilityCheck` (the CLI is the dynamic-import
 * host — resolves Open Q-4 as move-now). Returns [] when no page is available. */
function buildAccessibilityCheckHandler(adapter: PlatformAdapter): AccessibilityCheckHandler {
  return async (opts) => {
    const page = 'getPage' in adapter ? (adapter as { getPage: () => unknown }).getPage() : undefined
    if (!page) return []
    const web = await import('@vostride/agent-qa-web')
    return web.runAccessibilityCheck(page as any, opts)
  }
}

/** Build the injected failure-screenshot writer. Captures from the adapter into the member's
 * `result.screenshot` (in-run buffer, the same artifact the reporter subscribers persist beside the
 * run dir). */
function buildFailureScreenshotWriter(adapter: PlatformAdapter): FailureScreenshotWriter {
  return async () => captureFailureScreenshotFromAdapter(adapter)
}

/** The runner-owned `MemberTest` shape derived from a resolved (already suite-patched) TestDefinition.
 * `filePath` is the member's own file. A suite-patched test carries no `url` (the suite owns nav), so
 * `runMemberTest` skips the per-test navigate for suite members. */
export function toMemberTest(test: any, filePath: string): MemberTest {
  return {
    testId: (test['test-id'] as string | undefined) ?? test.name,
    name: test.name,
    filePath,
    url: test.url as string | undefined,
    context: test.context as string | undefined,
    steps: test.steps as Array<string | MemberStepSpec>,
    meta: test.meta as MemberTest['meta'],
  }
}

/** Everything both executor closures resolve at the composition root and hand to
 * {@link buildMemberRunConfig}. The adapter-backed injected handlers are constructed here from
 * `adapter` + `secretStore` so the two sites never drift (Pitfall 8). */
export interface BuildMemberRunConfigInput {
  // loop host impls
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  cache?: ActionPlanCache
  masking?: MaskingContext
  workingMemory?: WorkingMemoryPort
  storageState?: StorageStatePort
  compressor?: ScreenshotCompressor
  safetyHooks?: SafetyHookRunner
  knowledgeReader?: KnowledgeHintReader
  knowledgeBudgets?: KnowledgeBudgets
  knowledgeAsOfBuild?: number
  recordLedger?: RecordLedger
  beginMemoryTurn?: (scope?: ScopeKey) => void
  configDigests?: ConfigDigests
  // models
  plannerModel: LanguageModel
  verifierModel: LanguageModel
  // variable seeds
  envFileVars?: Record<string, string>
  inlineVars?: Record<string, string>
  suiteVars?: Record<string, string>
  cliVars?: Record<string, string>
  hookSetupVars?: Record<string, string>
  // inline hooks
  inlineHookDefs?: Map<string, HookDefinition>
  sandboxOptions?: SandboxRunnerOptions
  // secrets — the concrete SecretStore (superset of SecretResolver); resolveSecretEnv needs forEachSecret.
  secretStore?: SecretStore
  secretRedactor?: SecretRedactorPort
  // per-member ctx (bound by the run shell)
  sink: MemberEventSink
  testIndex: number
  abortSignal: AbortSignal
  /** CASS-02 run-scoped evidence store the shell threads onto the member ctx (Plan 13). */
  evidenceArtifacts?: EvidenceArtifactStorePort
  // run config
  captureScreenshots?: boolean
  accessibility?: MemberRunConfig['accessibility']
  timeouts?: MemberRunConfig['timeouts']
  plannerConfig?: PlannerConfig
  logger?: LoopLogger
  logCapture?: { console?: boolean; network?: boolean }
  vision?: { screenshotSize?: number; effectiveResolution?: number }
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  contextWindow?: number
  suiteContext?: string
  /** The member's own file, for the core-parity fileUpload path resolver. */
  filePath: string
}

/**
 * Assemble the {@link MemberRunConfig} `runMemberTest` slots behind, wiring the adapter-backed
 * injected handlers (runJS/appium/a11y/failure-shot), the store-neutral secret resolver, and the
 * fileUpload path resolver — reproducing core's `runTest` per-test behavior on runner soil (D-05).
 */
export function buildMemberRunConfig(input: BuildMemberRunConfigInput): MemberRunConfig {
  const sandbox = input.sandboxOptions
  return {
    adapter: input.adapter,
    planner: input.planner,
    verifier: input.verifier,
    cache: input.cache,
    masking: input.masking,
    workingMemory: input.workingMemory,
    storageState: input.storageState,
    // CTXB-06: model's canonical compaction (compactLogs for log bursts, guardBlob
    // otherwise) replaces the runner-local ceiling fallback on every tool-output value.
    guardBlob: guardToolOutput,
    compressor: input.compressor,
    safetyHooks: input.safetyHooks,
    knowledgeReader: input.knowledgeReader,
    knowledgeBudgets: input.knowledgeBudgets,
    knowledgeAsOfBuild: input.knowledgeAsOfBuild,
    recordLedger: input.recordLedger,
    beginMemoryTurn: input.beginMemoryTurn,
    configDigests: input.configDigests,

    plannerModel: input.plannerModel,
    verifierModel: input.verifierModel,

    envFileVars: input.envFileVars,
    inlineVars: input.inlineVars,
    suiteVars: input.suiteVars,
    cliVars: input.cliVars,
    hookSetupVars: input.hookSetupVars,

    // Inline hooks: the runner-local DockerHookExecutor + sandbox env/authState come off the resolved
    // sandbox options; the per-run secret env is resolved store-side (never crosses into the runner).
    hookExecutor: sandbox?.executor as HookExecutorPort | undefined,
    inlineHookDefs: input.inlineHookDefs,
    hookEnvVars: sandbox?.envVars,
    hookSecretEnv: resolveSecretEnv(input.secretStore),
    hookAuthState: sandbox?.authState,

    runJs: buildRunJsHandler(input.adapter),
    appiumScript: buildAppiumScriptHandler(input.adapter, input.secretStore),
    accessibilityCheck: buildAccessibilityCheckHandler(input.adapter),
    persistFailureScreenshot: buildFailureScreenshotWriter(input.adapter),

    resolveSecrets: (text: string) => resolveSecretTemplatesInValue(text, input.secretStore),
    secretStore: input.secretStore,
    secretRedactor: input.secretRedactor,

    sink: input.sink,
    testIndex: input.testIndex,
    abortSignal: input.abortSignal,
    evidenceArtifacts: input.evidenceArtifacts,

    captureScreenshots: input.captureScreenshots,
    accessibility: input.accessibility,
    timeouts: input.timeouts,
    plannerConfig: input.plannerConfig,
    logger: input.logger,
    logCapture: input.logCapture,
    vision: input.vision,
    visionGate: input.visionGate,
    contextWindow: input.contextWindow,
    suiteContext: input.suiteContext,
    resolveUploadPath: (rawPath: string) =>
      isAbsolute(rawPath) ? rawPath : resolve(dirname(input.filePath), rawPath),
  }
}
