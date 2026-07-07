import { screenStateHash } from '../determinism/screen-hash'
import type { PerTestOutcome } from '../handoff/per-test-outcome'
import type { StepEvidence } from '../handoff/step-evidence'
import type { SubActionEvidence } from '../handoff/sub-action-evidence'
import type {
  StepFinalizedPayload,
  SubActionRecordedPayload,
  TestFinishedPayload,
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
): StepFinalizedPayload {
  const payload: StepFinalizedPayload = {
    testIndex: ids.testIndex,
    stepIndex: ids.stepIndex,
    cacheStatus: evidence.cacheStatus,
    verifierVerdict: evidence.verifierVerdict,
    selfHealOccurred: evidence.selfHeal !== undefined,
    briefDigest: evidence.servedBrief.briefDigest,
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
): TestFinishedPayload {
  const { steps, ...rest } = outcome
  void steps

  const payload: TestFinishedPayload = {
    testId: rest.testId,
    testIndex: rest.testIndex,
    outcome: rest.outcome,
  }
  return maskPayloadStrings(payload, mask)
}
