import { screenStateHash } from '../determinism/screen-hash'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { StepEvidence } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type {
  HookFinishedPayload,
  HookStartedPayload,
  StepFinalizedPayload,
  SubActionRecordedPayload,
  TestFinishedPayload,
  TestRetryScheduledPayload,
} from './bus-events'

/**
 * The masking seam (D-09). Every payload projection takes a `MaskFn` and routes every
 * string it produces through it. Pre-362 the CLI passes an identity function; 362's
 * masking-context seeding replaces it with the real redactor with ZERO further wiring —
 * the same discipline `StepEvidence.workingMemory` already follows.
 */
export type MaskFn = (text: string) => string

/**
 * Structural walk that applies `mask` to every string value reachable from `value`.
 * Arrays and plain objects are walked; numbers/booleans/null pass through unchanged.
 * Pure — the input is never mutated (a fresh structure is returned). This is the
 * terminal pass every projection runs so no value-bearing string field can escape the
 * D-09 seam.
 */
export function maskPayloadStrings<T>(value: T, mask: MaskFn): T {
  return walk(value, mask) as T
}

function walk(value: unknown, mask: MaskFn): unknown {
  if (typeof value === 'string') {
    return mask(value)
  }
  if (Array.isArray(value)) {
    return value.map(entry => walk(entry, mask))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(entry, mask)
    }
    return out
  }
  return value
}

/**
 * `StepEvidence` → `stepFinalized` payload (D-10). Carries `cacheStatus`, the
 * `verifierVerdict`, a boolean `selfHealOccurred` FLAG (never the `selfHeal` body), and
 * the `briefDigest` — the `ServedBrief`'s own digest field travels, never its body.
 */
export function projectStepFinalized(
  evidence: StepEvidence,
  ids: { testIndex: number; stepIndex: number },
  mask: MaskFn,
  extra?: {
    status?: StepFinalizedPayload['status']
    durationMs?: number
    error?: string
  },
): StepFinalizedPayload {
  const payload: StepFinalizedPayload = {
    testIndex: ids.testIndex,
    stepIndex: ids.stepIndex,
    cacheStatus: evidence.cacheStatus,
    verifierVerdict: evidence.verifierVerdict,
    selfHealOccurred: evidence.selfHeal !== undefined,
    briefDigest: evidence.servedBrief.briefDigest,
    // Phase 363 D-01 additive-optional appends (RESEARCH Q1). These are plain extra inputs
    // sourced from the runner `StepResult` — NOT fields on the §A8 StepEvidence DTO
    // (Pitfall 2). Omitted when absent so no undefined-hole survives JSON round-trip.
    ...(extra?.status !== undefined ? { status: extra.status } : {}),
    ...(extra?.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
    ...(extra?.error !== undefined ? { error: extra.error } : {}),
  }
  return maskPayloadStrings(payload, mask)
}

/**
 * `SubActionEvidence` → `subActionRecorded` payload (D-10). The raw `stateBefore`/
 * `stateAfter` are collapsed to `screenStateHash` identity strings and destructured away
 * (the `toRecordedActionResult` idiom — never `delete`); `result` is already a
 * `RecordedActionResult` by evidence construction so no live screenshot bytes ride the bus.
 */
export function projectSubActionRecorded(
  evidence: SubActionEvidence,
  ids: { testIndex: number; stepIndex: number; subActionIndex: number },
  mask: MaskFn,
): SubActionRecordedPayload {
  const { stateBefore, stateAfter, decisionScreenshotRef, localEffect, ...rest } = evidence
  void stateBefore
  void stateAfter
  void decisionScreenshotRef
  void localEffect

  const payload: SubActionRecordedPayload = {
    testIndex: ids.testIndex,
    stepIndex: ids.stepIndex,
    subActionIndex: ids.subActionIndex,
    plan: rest.plan,
    plannedAction: rest.plannedAction,
    result: rest.result,
    screenStateHash: screenStateHash(evidence.stateBefore),
    ...(rest.grounding !== undefined ? { grounding: rest.grounding } : {}),
    ...(evidence.stateAfter !== undefined
      ? { screenStateHashAfter: screenStateHash(evidence.stateAfter) }
      : {}),
    ...(rest.artifactRefs !== undefined ? { artifactRefs: rest.artifactRefs } : {}),
  }
  return maskPayloadStrings(payload, mask)
}

/**
 * `PerTestOutcome` → `testFinished` payload (D-10). Identity + `outcome` only; the
 * embedded `steps` array is destructured away and never rides the bus.
 */
export function projectTestFinished(
  outcome: PerTestOutcome,
  mask: MaskFn,
  extra?: { durationMs?: number; failureSummary?: string; retryCount?: number },
): TestFinishedPayload {
  const { steps, ...rest } = outcome
  void steps

  const payload: TestFinishedPayload = {
    testId: rest.testId,
    testIndex: rest.testIndex,
    outcome: rest.outcome,
    // Phase 363 D-01 additive-optional appends (RESEARCH Q1). Plain extra inputs sourced
    // from the runner `TestResult` — NOT fields on the §A8 PerTestOutcome DTO (Pitfall 2).
    // `failureSummary` is a string so it routes through the mask like every payload string.
    ...(extra?.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
    ...(extra?.failureSummary !== undefined
      ? { failureSummary: extra.failureSummary }
      : {}),
    ...(extra?.retryCount !== undefined ? { retryCount: extra.retryCount } : {}),
  }
  return maskPayloadStrings(payload, mask)
}

// --- Hook lifecycle + retry projections (Phase 363 D-01 parity appends, spec §2.2) ----

/**
 * Hook identity → `hookStarted` payload (D-01). Pure structural pass: absent optional
 * identity fields are omitted (no undefined holes), every string routes through the mask.
 */
export function projectHookStarted(
  input: HookStartedPayload,
  mask: MaskFn,
): HookStartedPayload {
  const payload: HookStartedPayload = {
    hookName: input.hookName,
    phase: input.phase,
    hookExecutionId: input.hookExecutionId,
    ...(input.hookId !== undefined ? { hookId: input.hookId } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.testIndex !== undefined ? { testIndex: input.testIndex } : {}),
    ...(input.stepIndex !== undefined ? { stepIndex: input.stepIndex } : {}),
  }
  return maskPayloadStrings(payload, mask)
}

/**
 * Hook result → `hookFinished` payload (D-01, T-363-01). `stdout`/`stderr`/`error` and each
 * `variables` VALUE are routed through the mask by the terminal string walk — keys pass
 * through because {@link maskPayloadStrings} masks values only. Absent optionals are omitted.
 */
export function projectHookFinished(
  input: HookFinishedPayload,
  mask: MaskFn,
): HookFinishedPayload {
  const payload: HookFinishedPayload = {
    hookName: input.hookName,
    phase: input.phase,
    hookExecutionId: input.hookExecutionId,
    status: input.status,
    durationMs: input.durationMs,
    stdout: input.stdout,
    stderr: input.stderr,
    variables: { ...input.variables },
    ...(input.hookId !== undefined ? { hookId: input.hookId } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.testIndex !== undefined ? { testIndex: input.testIndex } : {}),
    ...(input.stepIndex !== undefined ? { stepIndex: input.stepIndex } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
  }
  return maskPayloadStrings(payload, mask)
}

/**
 * Retry accounting → `testRetryScheduled` payload (resolves RESEARCH Open Q-3). No mask
 * param: the payload carries only identifiers and scheduling accounting (testId, indices,
 * attempt counts, a coarse reason) — no captured secret-bearing streams. Absent `reason`
 * is omitted so no undefined-hole survives JSON round-trip.
 */
export function projectTestRetryScheduled(
  input: TestRetryScheduledPayload,
): TestRetryScheduledPayload {
  return {
    testId: input.testId,
    testIndex: input.testIndex,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }
}
