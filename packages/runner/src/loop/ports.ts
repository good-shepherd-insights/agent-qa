// Runner-owned port interfaces for the step-execution loop (D-03/D-04/D-05).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp,
// no core/model/adapter package imports. Follows the knowledge-hint-reader idiom:
// type-only imports, exported interfaces, no implementation, no class. Every
// possibly-absent port is optional and optional-chained by the loop — never
// throw-on-absent (D-05 degrade-when-absent).

import type { ScreenState } from '@vostride/agent-qa-schema'
import type { SafetyHookRunner } from '@vostride/agent-qa-safety'
import type { PlatformAdapter } from '../platform.js'
import type { KnowledgeHintReader } from '../knowledge-hint-reader.js'
import type { StepPhaseEvent } from '../result.js'
import type { ActionPlan, Planner, Verifier, PlannerConfig } from './types.js'

/**
 * Per-step cache-key input — only what the loop owns per step. The v1 hash inputs
 * (configContent/testFileContent/testFilePath/suiteFileContent/suiteTestIndex) do
 * NOT appear here: they live behind the cache port, where the core adapter closes
 * over them and does all hashing (core owns node:crypto; storageNeutral forbids it
 * in runner). D-03.
 */
export interface StepKeyInput {
  stepInstruction: string
  stepIndex?: number
}

/**
 * v1-shaped transitional cache port — Phase 356 redesigns both the shape (branded
 * computeCacheKey 8-tuple, replay→re-ground→replan hit ladder, env-step bypass) and
 * the implementation; the v1 FileActionCache stays in core behind the adapter (D-03).
 * The loop consumes only this sub-action trio; v1's step-level get/set/invalidate are
 * dropped (verified against core types.ts:120-127).
 */
export interface ActionPlanCache {
  getSubAction(key: StepKeyInput, index: number): Promise<ActionPlan | null>
  setSubAction(key: StepKeyInput, index: number, plan: ActionPlan): Promise<void>
  invalidateSubActionsFrom(key: StepKeyInput, fromIndex: number): Promise<void>
}

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
 * The runner-owned port bundle the loop executes against — successor to v1's
 * AgentLoopConfig (core types.ts:66-104), minus the D-10 healing/attempt-limit
 * fields and minus the v1 cache-key inputs (those move behind the cache port).
 */
export interface LoopPorts {
  adapter: PlatformAdapter
  planner: Planner
  verifier?: Verifier
  cache?: ActionPlanCache
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
  onPhase?: (event: StepPhaseEvent) => void | Promise<void>
  /** Pitfall 1 — path resolution stays core-side, injected pre-resolved into the loop. */
  resolveUploadPath?: (rawPath: string) => string
  abortSignal?: AbortSignal
  secretStore?: SecretResolver
  secretRedactor?: SecretRedactorPort
  cacheState?: { invalidated: boolean }
}
