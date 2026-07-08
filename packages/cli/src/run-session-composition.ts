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
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  createMaskingContext,
  registerFirstPartySafetyHooks,
  seedMaskingContext,
} from '@vostride/agent-qa-safety'
import type { AuditSink, ConfirmPort, SafetyHookRunner } from '@vostride/agent-qa-safety'
import {
  createReadlineConfirm,
  detectExecutionContext,
  JsonlAuditSink,
} from '@vostride/agent-qa-safety-local'
import {
  FsEventLog,
  FsHandoffStore,
  FsRunArtifactStore,
  nextBuildOrdinal,
  RUNS_SUBDIR,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type {
  ConfigDigests,
  EventLogPort,
  HandoffStorePort,
  MemberTestExecutor,
  MemberTestRunContext,
  RunArtifactStorePort,
  RunMemberDescriptor,
  TestResult,
} from '@vostride/agent-qa-runner'

// ---- Local structural types -----------------------------------------------------------------
// The CLI does not take a `@vostride/agent-qa-schema` dependency purely to name these injected
// seam types — the local shapes structurally satisfy the runner `RunConfig` fields. ExecutionContext
// mirrors the schema union exactly.

/** Mirror of schema's ExecutionContext union (safety-local's detectExecutionContext returns it). */
export type RunExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'

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
}

/**
 * Construct the runner-local persistence ports rooted at the run's `.agent-qa` runtime dir (the
 * FsActionCache rooting idiom). `FsEventLog`/`FsHandoffStore`/`FsRunArtifactStore` all write under
 * the SAME `<configDir>/.agent-qa/runs/<slug(runId)>/…` family (D-08 — one self-contained run dir).
 */
export function buildRunPorts(input: { configDir: string; runId: string }): RunPersistencePorts {
  const root = resolve(input.configDir, '.agent-qa')
  return {
    eventLog: new FsEventLog({ root, runId: input.runId }),
    handoffStore: new FsHandoffStore({ root, runId: input.runId }),
    runArtifactStore: new FsRunArtifactStore({ root, runId: input.runId }),
  }
}

/**
 * Advance the per-product buildOrdinal counter under the same `.agent-qa` root (D-18). Async
 * (the runner-local counter reads → increments → atomic-renames). The resolved value rides
 * `RunConfig.buildOrdinal` into the handoff header.
 */
export function resolveRunBuildOrdinal(input: { configDir: string; product: string }): Promise<number> {
  return nextBuildOrdinal({ root: resolve(input.configDir, '.agent-qa'), product: input.product })
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

  const { registry } = registerFirstPartySafetyHooks({
    auditSink: input.auditSink,
    confirm: timedConfirm,
    resolveExecutionContext: () => input.executionContext,
    trust: { trustMode: input.trustMode },
  })

  return { safetyHooks: registry, confirmPausedMs: () => pausedMs }
}
