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
} from '@vostride/agent-qa-schema'
import type { TestResult } from '../result.js'
import type { LoopEventEmitPort } from '../loop/ports.js'

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
 * The durable handoff seam (D-05/D-17). SYNC single-document persist of the one
 * `CompletedRunHandoff` at run end; the runner-local `FsHandoffStore` (Plan 07) writes
 * `handoff.json` beside `events.jsonl`. Failure degrades with a `runWarning`, never gates
 * the verdict (D-07).
 */
export interface HandoffStorePort {
  save(handoff: CompletedRunHandoff): void
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
}

/** The per-member execution context threaded into the injected {@link MemberTestExecutor}. */
export interface MemberTestRunContext {
  abortSignal: AbortSignal
  testIndex: number
  events: MemberEventSink
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
   * The run-budget clock (D-03). The shell arms `runBudgetMs` on this timer; it is NOT
   * routed into the bus heartbeat (the two clocks stay distinct so firing the injected
   * budget timer is unambiguous — see the shell's timer note).
   */
  timer?: RunTimerPort
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
  members: readonly RunMemberDescriptor[]
  executor: MemberTestExecutor
  masking?: MaskingContext
  runBudgetMs?: number
  ports?: RunPorts
}
