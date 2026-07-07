// Type-level payload-discipline proofs (D-11): the projection payload types structurally
// cannot carry live handles / raw bytes / embedded evidence — a compile error, not a
// runtime strip (the 356 `NonCacheableStepInput` `?: never` idiom). Plus the M1-lite
// RunSession contract pins (D-13, SESSION-01). Copies the cache-key.test-d idiom.
import { expectTypeOf } from 'vitest'
import type {
  RunEvent,
  RunEventEnvelope,
  RunEventPayload,
  RunEventType,
  StepFinalizedPayload,
  SubActionRecordedPayload,
  TestFinishedPayload,
} from '../run/bus-events'
import { RUN_EVENT_TYPES } from '../run/bus-events'
import type { RunCompletion, RunSession } from '../run/run-session'
import type { Action } from '../action/index'
import type { ServedBrief } from '../brief/served-brief'
import type { VerifierVerdict } from '../handoff/step-evidence'
import type { StepEvidence } from '../handoff/step-evidence'
import type { RecordedActionResult } from '../result/index'
import type { ScreenState } from '../screen/screen-state'

// --- Envelope + event-type pins ---------------------------------------------

expectTypeOf<RunEventEnvelope['seq']>().toEqualTypeOf<number>()
expectTypeOf<RunEventEnvelope['ts']>().toEqualTypeOf<number>()
expectTypeOf<RunEventEnvelope['runId']>().toEqualTypeOf<string>()
expectTypeOf<RunEventEnvelope['type']>().toEqualTypeOf<RunEventType>()
expectTypeOf<RunEventEnvelope['payload']>().toEqualTypeOf<RunEventPayload>()
expectTypeOf<RunEventType>().toEqualTypeOf<(typeof RUN_EVENT_TYPES)[number]>()

// The discriminated union narrows payload on `type`.
expectTypeOf<Extract<RunEvent, { type: 'runFinished' }>['payload']['disposition']>().toEqualTypeOf<'detached'>()

// --- RunSession M1-lite contract pins (D-13, SESSION-01) ---------------------

expectTypeOf<RunSession['done']>().toEqualTypeOf<Promise<RunCompletion>>()
expectTypeOf<RunSession['cancel']>().toEqualTypeOf<() => void>()
expectTypeOf<RunSession['subscribe']>().parameter(0).toEqualTypeOf<number>()
expectTypeOf<RunSession['subscribe']>().returns.toEqualTypeOf<() => void>()
expectTypeOf<RunCompletion['verdict']>().toMatchTypeOf<string>()

// --- Structural payload-discipline rejection proofs (D-11) -------------------

const validSubAction = {
  testIndex: 0,
  stepIndex: 0,
  subActionIndex: 0,
  plan: 'click Save',
  plannedAction: {} as Action,
  result: {} as RecordedActionResult,
  screenStateHashBefore: 'hash-before',
}

// states collapse to hash identity (D-10/D-11) — a raw ScreenState cannot ride as `stateBefore`.
const rejectsStateBefore: SubActionRecordedPayload = {
  ...validSubAction,
  // @ts-expect-error stateBefore is structurally excluded (?: never)
  stateBefore: {} as ScreenState,
}

// raw image bytes cannot ride any payload member — screenshot is structurally excluded.
const rejectsScreenshotBytes: SubActionRecordedPayload = {
  ...validSubAction,
  // @ts-expect-error a Uint8Array cannot satisfy the excluded screenshot member (?: never)
  screenshot: new Uint8Array(),
}

// the full ServedBrief body is excluded from stepFinalized — only briefDigest travels.
const rejectsServedBrief: StepFinalizedPayload = {
  testIndex: 0,
  stepIndex: 0,
  cacheStatus: 'hit',
  verifierVerdict: {} as VerifierVerdict,
  selfHealOccurred: false,
  briefDigest: 'digest',
  // @ts-expect-error servedBrief is structurally excluded (?: never)
  servedBrief: {} as ServedBrief,
}

// testFinished never embeds the steps array (D-10).
const rejectsSteps: TestFinishedPayload = {
  testId: 't1',
  testIndex: 0,
  outcome: 'passed',
  // @ts-expect-error steps are structurally excluded (?: never)
  steps: [] as StepEvidence[],
}

void rejectsStateBefore
void rejectsScreenshotBytes
void rejectsServedBrief
void rejectsSteps
