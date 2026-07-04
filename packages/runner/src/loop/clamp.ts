// Runner-side clamp/degrade policy helper (Phase 355 / CTXB-04). Pure, generic policy
// over the shipped Phase 354 TokenAccounting port: the dynamic output clamp
// (max_output = max(floor, min(default, C − I − safety))), the percentage-plus-floor
// safety margin, the proactive/reactive degrade wiring, the observation+instruction
// pins, retry-exactly-once on a live context overflow, the recordUsage feed, and the
// structured cannot-fit outcome (never a crash, D-17).
//
// CRITICAL: provider-neutral. Imports message/usage TYPES from 'ai' only and the runner
// TokenAccounting port from './ports.js'; reuses estimateTokens from './prompts.js'.
// NEVER imports the model package (@vostride/agent-qa-model) or any provider SDK
// (@ai-sdk/*) — overflow detection is runner-local (validate:arch, mirrors ports.ts).

import type { LanguageModelUsage, ModelMessage, SystemModelMessage } from 'ai'
import type { TokenAccounting, RunnerDegradeOutcome } from './ports.js'
import { estimateTokens } from './prompts.js'

// ---------------------------------------------------------------------------
// Safety policy (D-02/D-14) — documented, injectable consts. The margin scales
// with the model window across the full BYOM range (a 4k local model floors at
// 256; a 1M model reserves 2%), and every knob is overridable per call.
// ---------------------------------------------------------------------------

/** Fraction of the context window reserved as headroom above the output cap (D-02). */
export const SAFETY_PERCENT = 0.02
/** Absolute floor for the safety margin — dominates on small windows (D-02). */
export const SAFETY_FLOOR = 256
/** Floor for the output clamp — the cap never drops to zero/negative (D-01). */
export const OUTPUT_FLOOR = 256

/** Per-call overrides for the safety policy (D-14). */
export interface SafetyOverrides {
  percent?: number
  floor?: number
}

/**
 * Resolve the safety margin for a context window `C` (D-02/D-14):
 * `max(floor, ceil(percent * C))`. Injectable percentage + floor so callers can
 * tune the reserve without forking the arithmetic.
 */
export function resolveSafety(contextWindow: number, overrides?: SafetyOverrides): number {
  const percent = overrides?.percent ?? SAFETY_PERCENT
  const floor = overrides?.floor ?? SAFETY_FLOOR
  return Math.max(floor, Math.ceil(percent * contextWindow))
}

/** Test-facing alias for the default safety policy: `max(256, ceil(0.02 * C))`. */
export function computeSafety(contextWindow: number): number {
  return resolveSafety(contextWindow)
}

// ---------------------------------------------------------------------------
// Clamp arithmetic (D-01).
// ---------------------------------------------------------------------------

export interface ComputeMaxOutputInput {
  contextWindow: number
  inputTokens: number
  defaultMaxOutput: number
  /** Reserve above the cap; defaults to the standard safety policy for `contextWindow`. */
  safety?: number
  /** Lower bound for the cap; defaults to OUTPUT_FLOOR. */
  floor?: number
}

/**
 * The dynamic output clamp (D-01):
 * `max(floor, min(default, C − I − safety))`. A tiny/negative headroom clamps up to
 * the floor rather than emitting a zero/negative cap.
 */
export function computeMaxOutput(input: ComputeMaxOutputInput): number {
  const { contextWindow, inputTokens, defaultMaxOutput } = input
  const safety = input.safety ?? resolveSafety(contextWindow)
  const floor = input.floor ?? OUTPUT_FLOOR
  return Math.max(floor, Math.min(defaultMaxOutput, contextWindow - inputTokens - safety))
}

// ---------------------------------------------------------------------------
// Input estimate (§5.1) — the port's estimate() counts messages only; tool schemas
// are not in the message stream, so their tokens must be added explicitly (Pitfall 4).
// ---------------------------------------------------------------------------

/** Tool-schema token count for the always-send-all action slice (Pitfall 4). */
export function estimateToolSchemaTokens(actionTools: unknown): number {
  if (actionTools === undefined || actionTools === null) return 0
  return estimateTokens(JSON.stringify(actionTools))
}

/**
 * Full input estimate `I` = message tokens (port) + tool-schema tokens. `toolSchema`
 * is the already-serialized action-slice JSON (computed once at the call site).
 */
export function estimateInput(
  accounting: TokenAccounting,
  messages: ModelMessage[],
  toolSchema?: string,
): number {
  const schemaTokens = toolSchema ? estimateTokens(toolSchema) : 0
  return accounting.estimate(messages) + schemaTokens
}

// ---------------------------------------------------------------------------
// Combined clamp: resolve ceilings + safety, produce the output cap and the input
// budget (the max input tokens allowed once the output reserve is carved out).
// ---------------------------------------------------------------------------

export interface ClampResult {
  maxOut: number
  budget: number
  safety: number
}

/**
 * Compute the output cap and input budget from the port ceilings for a precomputed
 * input estimate `I` (messages + tool schema). `budget = C − maxOut − safety`.
 */
export function computeClamp(
  accounting: TokenAccounting,
  inputTokens: number,
  safetyOverride?: SafetyOverrides,
): ClampResult {
  const { contextWindow, maxOutput } = accounting.getCeilings()
  const safety = resolveSafety(contextWindow, safetyOverride)
  const maxOut = computeMaxOutput({
    contextWindow,
    inputTokens,
    defaultMaxOutput: maxOutput,
    safety,
  })
  return { maxOut, budget: contextWindow - maxOut - safety, safety }
}

// ---------------------------------------------------------------------------
// Runner-local context-overflow predicate. Mirrors loop/index.ts
// CONTEXT_ERROR_PATTERNS so overflow detection stays provider-neutral and inside
// the runner boundary (the port does not expose it; a model re-export is forbidden).
// ---------------------------------------------------------------------------

const CONTEXT_OVERFLOW_PATTERNS = [
  'context length',
  'maximum context',
  'token limit',
  'too many tokens',
  'exceeds.*max',
  'input.*too long',
]

/** True when `err` is a provider context-length / token-limit overflow. */
export function isContextLengthOverflow(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : ''
  if (!message) return false
  const lower = message.toLowerCase()
  return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => new RegExp(pattern, 'i').test(lower))
}
