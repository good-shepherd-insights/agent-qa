// Runner-owned port interfaces for the step-execution loop (D-03/D-04/D-05).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no core/model/adapter package imports. Follows the knowledge-hint-reader idiom:
// type-only imports, exported interfaces, no implementation, no class. Every
// possibly-absent port is optional and optional-chained by the loop — never
// throw-on-absent (D-05 degrade-when-absent).

import type { LanguageModelUsage, ModelMessage } from 'ai'
import type {
  MaskingContext,
  ScreenState,
  WorkingMemoryEntry,
  StepEvidence,
  StepFinalizedPayload,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { ConfigDigests } from '../run/ports.js'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { PlatformAdapter } from '../platform.js'
import type { KnowledgeHintReader } from '../knowledge-hint-reader.js'
import type { ActionPlanCache } from '../cache/port.js'
import type { StorageStatePort } from '../storage-state/port.js'
import type { UniqueValueGenerator } from '../compound/dispatch-mint.js'
import type { Planner, Verifier, PlannerConfig } from './types.js'

/** Compression output — v1's CompressResult shape (Pitfall 9). */
export interface CompressedScreenshot {
  buffer: Buffer
  imageWidth: number
  imageHeight: number
}

/**
 * Screenshot compression + dimension port. The core-side implementation owns
 * `sharp` (storageNeutral forbids it in runner, Pitfall 9). `compress` covers the
 * LLM-planner compression call site; `dimensions` covers the action-space-width
 * metadata fallback done inline via `sharp(screenshot).metadata()` at v1
 * loop.ts:199-201. The loop applies `stampCaptureMode` itself (runner-owned since 352).
 */
export interface ScreenshotCompressor {
  compress(
    screenshot: Buffer,
    options: { effectiveResolution: number; maxBytes?: number; actionSpaceWidth: number },
  ): Promise<CompressedScreenshot>
  dimensions(screenshot: Buffer): Promise<{ width: number; height: number }>
}

/**
 * Structural secret-lookup port. The concrete `SecretStore` (moved into runner in
 * this plan, task 2) satisfies it by construction; `resolveSecretTemplatesInValue`
 * consumes it. Named distinctly from the concrete class to avoid a barrel collision.
 */
export interface SecretResolver {
  get(name: string): string | undefined
  require(name: string): string
  has(name: string): boolean
}

/** Structural secret-redactor port — the concrete `SecretRedactor` satisfies it. */
export interface SecretRedactorPort {
  redactString(value: string): string
}

/**
 * Structural run-scoped working-memory port (WM-01 · D-11/D-12). The concrete
 * `WorkingMemoryStore` (working-memory/store.ts) satisfies it by construction; declared
 * structurally here (the SecretResolver naming precedent) so the ports module never imports the
 * concrete class. `capture` writes verbatim entries (registered secrets redacted at capture);
 * `entries` returns the whole set in capture order; `dispose` empties it at run end.
 */
export interface WorkingMemoryPort {
  capture(entries: readonly WorkingMemoryEntry[], ctx?: { test?: number; step?: number }): void
  entries(): WorkingMemoryEntry[]
  dispose(): void
}

/** Minimal scoped-logger surface the loop uses; core's LogManager satisfies it. */
export interface LoopScopedLogger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error?(message: string, meta?: Record<string, unknown>): void
}

export interface LoopLogger {
  createScopedLogger(scope: string): LoopScopedLogger | undefined
}

/**
 * Runner-local structural copy of model's DegradeOptions (D-05/D-07). Runner cannot
 * import the model package, so the shape is duplicated here; Plan 05's cli conformance
 * proof asserts model's `DegradeOptions` structurally matches this. Policy-free: the
 * caller (Phase 355) supplies the concrete budget + pin predicate.
 */
export interface RunnerDegradeOptions {
  budget: number
  pin?: (message: ModelMessage, index: number) => boolean
}

/**
 * Runner-local structural copy of model's DegradeOutcome (D-09). `ok:true` carries the
 * fitted messages; `ok:false` is the structured cannot-fit outcome (system + final +
 * pinned content alone exceed the budget) — degrade never throws and never violates a pin.
 */
export type RunnerDegradeOutcome =
  | { ok: true; messages: ModelMessage[] }
  | { ok: false; reason: 'pinned-content-exceeds-budget'; messages: ModelMessage[] }

/**
 * Provider-neutral token-accounting port (D-05/D-07) — the 354↔355 seam. A types-only
 * structural duplicate of model's `TokenAccounting` (accounting/types.ts): runner cannot
 * import model, so the shape is mirrored here and message types are imported from `'ai'`
 * only (never `@ai-sdk/*`, PROVIDER_ORCHESTRATION_ALLOWED). Policy-free — prompt tokens
 * only. This plan declares the seam; Phase 355 wires estimate/degrade consumption.
 */
export interface TokenAccounting {
  estimate(messages: ModelMessage[]): number
  recordUsage(usage: LanguageModelUsage, messages: ModelMessage[]): void
  getCeilings(): { contextWindow: number; maxOutput: number }
  degrade(messages: ModelMessage[], options: RunnerDegradeOptions): RunnerDegradeOutcome
}

/**
 * D-02 run-scoped event-emit seam. The loop emits `stepFinalized`/`subActionRecorded` at the
 * moment they occur (live semantics from day one) — the bus assigns `seq` centrally. Both legs
 * are fire-and-forget SYNCHRONOUS void: the loop must NEVER await telemetry (D-02/D-07). Follows
 * the optional-port idiom (masking/workingMemory): structural, optional on {@link LoopPorts},
 * optional-chained at the emit site, never throw-on-absent (D-05 degrade-when-absent). The
 * concrete curry lands at the run shell (`MemberEventSink.loopEmitFor`); the port survives 363's
 * migration unchanged.
 */
export interface LoopEventEmitPort {
  /**
   * 363 D-01: the additive-optional `extra` carries the StepResult-derived
   * `{status, durationMs, error}` the reporters need (RESEARCH Q1 parity). Sourced from the
   * runner `StepResult` at the loop's single terminal `finish()` funnel — NOT fields on the §A8
   * `StepEvidence` DTO (Pitfall 2). `error` is masked at the sink chokepoint (T-363-05). Absent
   * ⇒ the base evidence-only payload, source-compatible with pre-363 callers.
   */
  stepFinalized(
    evidence: StepEvidence,
    extra?: {
      status?: StepFinalizedPayload['status']
      durationMs?: number
      error?: string
    },
  ): void
  subActionRecorded(evidence: SubActionEvidence, subActionIndex: number): void
}

/**
 * The runner-owned port bundle the loop executes against — successor to v1's
 * AgentLoopConfig (core types.ts:66-104), minus the D-10 healing/attempt-limit
 * fields and minus the v1 cache-key inputs (those move behind the cache port).
 */
export interface LoopPorts {
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  /**
   * Redesigned per-key cache port (D-11): get/set/invalidate over a branded CacheKey,
   * descriptor-only value. Plan 05's FsActionCache implements it; injected at the Plan 06
   * CLI composition root. Absent ⇒ every step misses (no cache), never throws (D-05).
   */
  cache?: ActionPlanCache
  /**
   * D-05 masking seam for the cache key. `mask()` is applied to stepText BEFORE it enters
   * key material (the MASK-FUT-01 floor). Identity when unbound (pre-362); Phase 362 seeds
   * the live run-scope context. Never a `safety`/`safety-local` import — the browser-safe
   * schema `{ mask, unmask }` type only.
   */
  masking?: MaskingContext
  compressor?: ScreenshotCompressor
  /** D-05 optional L2 reader — the loop degrades gracefully when absent. */
  knowledgeReader?: KnowledgeHintReader
  /** D-05 v48 safety seam (context/tool_call/tool_result); unpopulated until Phase 362. */
  safetyHooks?: SafetyHookRunner
  plannerConfig?: PlannerConfig
  /** Wall-clock timeout for a single step (ms). 0 or undefined = no timeout. */
  stepTimeout?: number
  logger?: LoopLogger
  logCapture?: { console?: boolean; network?: boolean }
  vision?: { screenshotSize?: number; effectiveResolution?: number }
  visionGate?: { attachImage: boolean; captureMode: 'full' | 'textOnly'; promptNote: string }
  /** Pitfall 8 — setVariable executes via this callback, NOT the adapter. */
  onSetVariable?: (name: string, value: string) => void
  /** Pitfall 1 — path resolution stays core-side, injected pre-resolved into the loop. */
  resolveUploadPath?: (rawPath: string) => string
  abortSignal?: AbortSignal
  secretStore?: SecretResolver
  secretRedactor?: SecretRedactorPort
  /**
   * WM-01 run-scoped working-memory seam (D-11/D-12). The concrete `WorkingMemoryStore` is
   * created at the CLI composition root and injected here; Phase 361 rebinds this exact seam onto
   * `RunSession` (the knowledgeReader idiom). Unbound ⇒ the loop runs memory-less: no capture, an
   * empty served set — it never throws (D-05 degrade-when-absent).
   */
  workingMemory?: WorkingMemoryPort
  /**
   * D-14 storage-state persistence seam (Phase 360). The runner-local `FsStorageStateStore` is
   * constructed run-scoped at the CLI/dashboard composition roots and injected here; the seam
   * strips the raw blob from the recorded result and records only `{ name, fingerprint }`. Unbound
   * ⇒ a `storageState` action degrades to a §7.1 persistence-unavailable error (never throws, D-05).
   */
  storageState?: StorageStatePort
  /**
   * D-16 injectable unique-value suffix generator (353 K=2 determinism). Absent ⇒ the seam uses
   * `defaultUniqueValueGenerator` (timestamp + entropy). Tests inject a fixed generator for
   * deterministic minted values; production leaves it unbound.
   */
  uniqueValueGenerator?: UniqueValueGenerator
  /**
   * D-06 optional pre-prompt blob-guard — bounds a single one-shot structured tool-output
   * value before it lands in the sub-action history / next planning turn. A pure signature
   * (no `ai`/model types, zero arch risk). Composition roots that depend on model may inject
   * model's canonical `guardBlob`; the loop degrades to a runner-local fallback when absent.
   */
  guardBlob?: (value: unknown) => string | undefined
  /**
   * D-02 run-scoped event-emit seam. Bound by the run shell (per-step curry via
   * `MemberEventSink.loopEmitFor`) so the loop emits `stepFinalized`/`subActionRecorded` live;
   * absent ⇒ the loop runs telemetry-less (no emit), never throws (D-05 degrade-when-absent).
   */
  events?: LoopEventEmitPort
  /**
   * D-20 real config digests, so the loop can key the cache on what the run actually keyed on
   * (consumed in Plan 08). Type-imported from the run layer; absent ⇒ the existing key material
   * is used unchanged.
   */
  configDigests?: ConfigDigests
}
