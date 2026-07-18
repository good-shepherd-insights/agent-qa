// Runner-owned port interfaces for the run layer (D-01/D-02/D-04/D-05).
// CRITICAL: provider-neutral + storage-neutral. Type-only imports, exported
// interfaces, no implementation, no class, and NO `node:*` — the run shell and
// the in-memory bus are pure logic; every I/O leg (JSONL event log, handoff.json,
// timers) crosses to `runner-local` behind these seams (validate:arch storageNeutral,
// the FsActionCache / storage-state port precedent). Declared interface-first so
// Plans 06–10 build against them without exploration.

import type {
  RunEventEnvelope,
  RunId,
  ScopeKey,
  ExecutionContext,
  MaskingContext,
  CompletedRunHandoff,
  HookStartedPayload,
  HookFinishedPayload,
  DeclaredModelProfile,
  ModelIdentity,
  TestRetryScheduledPayload,
  RunArtifactStageInput,
  RunArtifactFinalizeInput,
} from '@vostride/agent-qa-schema'
import type { TestResult } from '../result.js'
import type { EvidenceArtifactStorePort, LoopEventEmitPort, SecretRedactorPort } from '../loop/ports.js'
import type { HookDefinition, HookResult } from '../hooks/types.js'
import type { RuntimeAuthStateConfig } from '../platform.js'

/**
 * The two 356 A5 config digests the run actually keyed on, computed once at the CLI
 * composition root and passed in the resolved {@link RunConfig} (D-20). Carried verbatim
 * into `runStarted`/the handoff so run identity and handoff identity cannot fork.
 */
export interface ConfigDigests {
  suiteConfigDigest: string
  testConfigDigest: string
}

/**
 * The run-start baseline health-probe outcome (D-04, RCC-02): ONE GET against the web
 * target's base URL, executed at the CLI composition root (the runner bans node:* — only
 * the RESULT crosses this seam). ALL probe failures arrive as values on `error`; a probe
 * never aborts the run. Consumed by the deterministic root-cause classifier's environment
 * branch (run/root-cause.ts).
 */
export interface BaselineProbeResult {
  status?: number
  elapsedMs: number
  error?: string
}

/**
 * The JSONL event-log seam (D-05/D-06). BOTH legs are SYNC and fire-and-forget — the bus
 * NEVER awaits telemetry (the JsonlAuditSink discipline; D-06/D-07). `append` persists one
 * envelope per emitted event; a throw degrades the bus to memory-only with a single
 * `runWarning` (D-07). `read(fromSeq)` supplies older-than-window envelopes for deep replay.
 * The runner-local `FsEventLog` (Plan 07) implements this against `events.jsonl`.
 */
export interface EventLogPort {
  append(envelope: RunEventEnvelope): void
  read(fromSeq: number): RunEventEnvelope[]
}

/**
 * The per-hook execution options the orchestration threads into the {@link HookExecutorPort}
 * (D-06). `env` is the accumulated-variables + user-env map the orchestrator merges per hook;
 * `secretEnv` is the ALREADY-RESOLVED secret name→value map for container injection — the CLI
 * composition root resolves the SecretStore and the runner never touches the store itself. The
 * secret VALUES double as the output-variable filter (a hook-emitted variable equal to a secret
 * value is dropped). `secretRedactor` redacts stdout/stderr/error; `authState` mounts + injects
 * the active auth state (container-local paths only). Pitfall 3: all sandbox-side
 * redaction/filtering stays inside the impl — the sink mask is additive.
 */
export interface HookExecuteOptions {
  env: Record<string, string>
  secretEnv: Record<string, string>
  secretRedactor?: SecretRedactorPort
  authState?: RuntimeAuthStateConfig
}

/**
 * The D-06 hook-execution seam: a runner-owned port whose only implementation is the
 * runner-local `DockerHookExecutor` (the 356/361 port-in-runner/impl-in-runner-local
 * precedent). `execute` runs ONE hook in the sandboxed container and resolves a
 * {@link HookResult} — a per-hook timeout resolves a FAILED result with an exit-124-style
 * error, NEVER a throw (the orchestration relies on a resolved result to synthesize
 * fail-fast skips). node:child_process / node:fs live behind this port in runner-local;
 * the runner stays storageNeutral (validate:arch is the arbiter).
 */
export interface HookExecutorPort {
  execute(hook: HookDefinition, opts: HookExecuteOptions): Promise<HookResult>
}

/**
 * The durable handoff seam (D-05/D-17). SYNC single-document persist of the one
 * `CompletedRunHandoff` at run end; the runner-local `FsHandoffStore` (Plan 07) writes
 * `handoff.json` beside `events.jsonl`. Failure degrades with a `runWarning`, never gates
 * the verdict (D-07).
 */
export interface HandoffStorePort {
  save(handoff: CompletedRunHandoff): void
}

/**
 * The D-08 run-artifact persistence seam: a runner-owned port whose only implementation is the
 * runner-local `FsRunArtifactStore` (the 356/361 port-in-runner/impl-in-runner-local precedent).
 * BOTH legs are SYNC and fire-and-forget — the shell NEVER awaits artifact persistence, and a
 * throw degrades with a `runWarning`, never gates the verdict (the JsonlAuditSink/handoff
 * discipline; D-07). The store writes ONE `artifact.json` into the SAME
 * `<root>/runs/<slug(runId)>/` family as `events.jsonl`/`handoff.json` (one self-contained run
 * directory). `stage(document)` persists the config + source snapshot once after `runStarted`;
 * `finalize(patch)` merges terminal errors + the end timestamp before `runFinished` — matching
 * the dashboard DB staged/finalize idiom so a crashed run still leaves a staged artifact. Per the
 * RESEARCH Q5 keep/drop table the FILE artifact keeps config/source/errors only; the top-level
 * `runtime` section is dropped (derived from events/handoff). An absent port is a silent no-op.
 */
export interface RunArtifactStorePort {
  stage(document: RunArtifactStageInput): void
  finalize(patch: RunArtifactFinalizeInput): void
}

/**
 * Injectable timer seam for the heartbeat + run-budget clocks (spec §2.2 liveness / D-03).
 * `schedule(delayMs, fn)` arms a one-shot and returns a cancel handle; `now()` supplies the
 * envelope `ts`. The default impl wraps global setTimeout/clearTimeout (unref'd so it never
 * keeps the process alive); unit pins inject a deterministic fake — no real timers, no watch
 * mode.
 */
export interface RunTimerPort {
  schedule(delayMs: number, fn: () => void): () => void
  now(): number
}

/**
 * One ordered member of the run (D-04). `failFastGroup` scopes today's suite fail-fast: a
 * failed/timed-out member skips the remaining SAME-group members; ungrouped members never
 * fail-fast, preserving the single-test path's run-all behavior.
 *
 * `testIndex`/`name` are OPTIONAL: the shell owns iteration and derives the authoritative
 * `testIndex` from array position (a caller-supplied value is a hint at most), and `name`
 * defaults to `testId` when absent. The Wave-0 `run-shell.test.ts` pins members as bare
 * `{ testId }` (± `failFastGroup`), so these must not be required.
 */
export interface RunMemberDescriptor {
  testId: string
  testIndex?: number
  name?: string
  failFastGroup?: string
  /**
   * The member test file's path as the CLI resolves it. REQUIRED since 381-01 (ABRF-02):
   * stable test identity = filePath + testId, copied verbatim onto `PerTestOutcome.filePath`
   * by the handoff assembly — the required field makes the compiler enforce that every
   * descriptor construction site supplies it.
   */
  filePath: string
  /**
   * 363 D-01 parity fields (RESEARCH Q1). All OPTIONAL and additive — the shell rides them onto
   * the widened `testStarted` payload so reporters can render the full v1 console/JUnit/wire
   * surface from the bus alone. Suite grouping (`suiteId`/`suiteName`/`suiteIndex`/`suiteTotal`)
   * rides testStarted rather than a suite lifecycle event — the shell stays suite-agnostic and
   * reporters derive suite boundaries by watching the grouping change. `totalSteps` is the
   * per-member parsed step count. The CLI populates these at both startRun sites; absent
   * ⇒ omitted from the payload (no undefined-hole survives JSON round-trip).
   */
  suiteId?: string
  suiteName?: string
  suiteIndex?: number
  suiteTotal?: number
  totalSteps?: number
}

/**
 * The run-scoped event sink handed to the executor per member test (D-02). The shell binds
 * `runId`/`testIndex`/masking; core curries `stepIndex` via `loopEmitFor`. `stepStarted`
 * fires as a step opens; `loopEmitFor(stepIndex)` yields the {@link LoopEventEmitPort} the
 * loop emits `stepFinalized`/`subActionRecorded` through.
 */
export interface MemberEventSink {
  stepStarted(input: { stepIndex: number; stepText: string }): void
  loopEmitFor(stepIndex: number): LoopEventEmitPort
  /**
   * 363 D-01 parity legs, each routed through its Plan 01 projection + the sink mask (never a raw
   * `bus.publish` from the caller — T-363-06). `hookStarted`/`hookFinished` are emitted by the
   * runner hook orchestration (Plan 04 populates them; `hookFinished` stdout/stderr/error and every
   * `variables` value are masked at the sink, T-363-05). `testRetryScheduled` is emitted by the
   * member-runner retry loop (Plan 10) and marks a per-test accumulation reset for subscribers.
   */
  hookStarted(input: HookStartedPayload): void
  hookFinished(input: HookFinishedPayload): void
  testRetryScheduled(input: TestRetryScheduledPayload): void
}

/** Immutable member-start decision context used when the shell must synthesize step evidence. */
export interface MemberEvidenceContext {
  modelProfile?: DeclaredModelProfile
  verifierIdentity?: ModelIdentity
  toolSchemaDigest?: string
}

/** The per-member execution context threaded into the injected {@link MemberTestExecutor}. */
export interface MemberTestRunContext {
  abortSignal: AbortSignal
  testIndex: number
  events: MemberEventSink
  setEvidenceContext(context: MemberEvidenceContext): void
  /**
   * CASS-02 run-scoped decision-screenshot byte store (the same instance the shell holds on
   * {@link RunPorts}). The member threads it onto `LoopPorts.evidenceArtifacts`; absent ⇒ a
   * memory-only run with no screenshot persistence.
   */
  evidenceArtifacts?: EvidenceArtifactStorePort
}

/**
 * The injected per-test execution port (D-01). The CLI composition root wraps core's
 * `runTest` behind this seam (core depends on runner, so runner can never import core);
 * Phase 363 dissolves the core side of the port when it migrates hooks/variables/reporters.
 * A staged migration, not a workaround — this is the exact seam 363 needs.
 */
export type MemberTestExecutor = (
  member: RunMemberDescriptor,
  ctx: MemberTestRunContext,
) => Promise<TestResult>

/**
 * The durable/telemetry/clock seams the run wires behind ports (D-04/D-05). All optional —
 * an absent leg degrades gracefully (no persistence, memory-only telemetry, default clock).
 * Grouped under `ports` so the resolved config keeps the run identity fields flat and the
 * injectable I/O seams together (the Wave-0 `run-shell.test.ts` pins this nesting).
 */
export interface RunPorts {
  handoffStore?: HandoffStorePort
  eventLog?: EventLogPort
  /**
   * The D-08 run-artifact store. Staged after `runStarted`, finalized before `runFinished`;
   * absent ⇒ no artifact.json is written (memory-only run, byte-identical pre-363-06 behavior).
   */
  runArtifactStore?: RunArtifactStorePort
  /**
   * The run-budget clock (D-03). The shell arms `runBudgetMs` on this timer; it is NOT
   * routed into the bus heartbeat (the two clocks stay distinct so firing the injected
   * budget timer is unambiguous — see the shell's timer note).
   */
  timer?: RunTimerPort
  /**
   * The D-10 run-budget half: a monotonic supplier returning the TOTAL milliseconds this run
   * has spent awaiting human confirms so far. Human decision time is never attributed to the
   * app under test — so when the run-budget timer fires, the shell credits the accrued pause
   * and re-arms for the un-credited delta instead of aborting. The CLI's timed `ConfirmPort`
   * decorator feeds this (plan 362-06); absent ⇒ budget expiry aborts exactly as before.
   */
  confirmPausedMs?: () => number
  /**
   * The CASS-02 run-scoped decision-screenshot artifact store (Plan 11). The runner-local
   * `FsEvidenceArtifactStore` is constructed run-scoped at the CLI composition root and injected
   * here; the shell hands the same instance to every member. Absent ⇒ no screenshot bytes are
   * persisted (memory-only run, byte-identical pre-Plan-11 behavior).
   */
  evidenceArtifacts?: EvidenceArtifactStorePort
}

/**
 * The fully-resolved run configuration `startRun` receives (D-04). The CLI keeps pattern
 * discovery, parsing, config merge, and target/device/model resolution; `startRun` never
 * touches fs or providers (validate:arch stays clean) — hence NO fs/provider/discovery-shaped
 * members here. A future cloud RPC surface reuses this same resolved-config contract.
 *
 * `masking` is OPTIONAL (identity when absent, pre-362): 362's masking-context seeding
 * supplies the real redactor with zero further wiring. `members`/`ports` shapes are pinned
 * by the Wave-0 `run-shell.test.ts` scaffold.
 */
export interface RunConfig {
  runId: RunId
  scope: ScopeKey
  executionContext: ExecutionContext
  configDigests: ConfigDigests
  buildOrdinal: number
  /**
   * D-14 §6 gate-run exclusion copied into the durable completed-run handoff. Only literal
   * true excludes; absence denotes an ordinary counted run and remains absent in JSON.
   */
  excludedFromOutcomes?: true
  members: readonly RunMemberDescriptor[]
  executor: MemberTestExecutor
  masking?: MaskingContext
  runBudgetMs?: number
  ports?: RunPorts
  /**
   * Run-start health baseline for the deterministic root-cause classifier (D-04); recorded
   * in-memory only — persistence is the environment verdict's rationale template (never a
   * handoff field, Pitfall 8). Web targets only; absent on mobile targets, where the
   * device-session-create failure is the existing equivalent environment signal.
   */
  baselineProbe?: BaselineProbeResult
  /**
   * The D-08 config + source artifact snapshot the CLI composition root assembles (the
   * `buildRunArtifactContext` document). Staged verbatim into `artifact.json` after `runStarted`
   * via `ports.runArtifactStore`. Optional — absent ⇒ an empty stage (schema-version-only doc),
   * so the store leg stays a no-op-shaped write and the memory-only path is unchanged.
   */
  runArtifact?: RunArtifactStageInput
}
