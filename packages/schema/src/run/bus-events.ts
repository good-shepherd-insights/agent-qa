import type { Action } from '../action/index'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { RecordedActionResult } from '../result/index'
import type { GroundingEvidence } from '../screen/target-descriptor'
import type { ScopeKey } from '../identity/scope-key'
import type { MemberTestOutcome } from './member-outcome'
import type { ExecutionContext, RunStatus } from './run-status'
import type { VerifierVerdict } from '../handoff/step-evidence'

/**
 * The bus schema version, declared once per run in `runStarted.payload.busSchemaVersion`
 * (spec §2.2, mirroring the {@link CompletedRunHandoff.schemaVersion} discipline: reject
 * newer-than-known, migrate older). D-05.
 */
export const CURRENT_BUS_SCHEMA_VERSION = 1

/**
 * The complete §2.2 event vocabulary M1 ships: every group EXCEPT the reserved
 * control/arbiter group (Live view / M5). Eleven lifecycle/diagnostic events plus the
 * nine post-processing chip events — camelCase, names verbatim per spec §2.2
 * (Ratified 2026-07-05). The enum is append-only; the chip group is DEFINED here but
 * emitted by no M1 producer.
 */
export const RUN_EVENT_TYPES = [
  // Run lifecycle
  'runStarted',
  'runFinished',
  // Member-test lifecycle
  'testStarted',
  'testFinished',
  // Step lifecycle
  'stepStarted',
  'stepFinalized',
  // Sub-action evidence tick
  'subActionRecorded',
  // Verdict
  'verdict',
  // Diagnostics
  'runWarning',
  'runError',
  // Liveness
  'heartbeat',
  // Post-processing / status chips — DEFINED in v1, emitted by no M1 producer
  'analysisStarted',
  'analysisCompleted',
  'analysisFailed',
  'curationStarted',
  'curationCompleted',
  'curationFailed',
  'issuesStarted',
  'issuesCompleted',
  'issuesFailed',
] as const

export type RunEventType = (typeof RUN_EVENT_TYPES)[number]

// --- Run lifecycle payloads -------------------------------------------------

/** `runStarted`: the {@link CompletedRunHandoff} header fields + the bus schema version. */
export interface RunStartedPayload {
  busSchemaVersion: number
  scope: ScopeKey
  executionContext: ExecutionContext
  buildOrdinal: number
  configDigests: {
    suiteConfigDigest: string
    testConfigDigest: string
  }
  memberTestCount: number
}

/**
 * `runFinished`: always last, exactly once. `disposition` is fixed to `'detached'` in
 * M1 — no post-processing producer exists yet (Ratified 2026-07-05).
 */
export interface RunFinishedPayload {
  aggregateVerdict: RunStatus
  disposition: 'detached'
  finalSeq: number
}

/** `verdict`: exactly once, the terminal aggregate {@link RunStatus} — the exit-code moment. */
export interface VerdictPayload {
  verdict: RunStatus
}

// --- Diagnostics payloads ---------------------------------------------------

/** `runWarning` / `runError`: non-terminal diagnostics. */
export interface RunWarningPayload {
  code: string
  message: string
  context?: Record<string, string>
}

export type RunErrorPayload = RunWarningPayload

/** `heartbeat`: empty payload, emitted after ~10 s of bus silence (the v1 cadence). */
export type HeartbeatPayload = Record<string, never>

// --- Member-test lifecycle payloads -----------------------------------------

/** `testStarted`: the {@link PerTestOutcome} identity fields (never the embedded steps). */
export interface TestStartedPayload {
  testId: string
  testIndex: number
  name: string
}

/**
 * `testFinished`: the {@link PerTestOutcome} identity fields plus `outcome`; the embedded
 * `steps` array is structurally excluded — projections never carry it (D-10/D-11).
 */
export interface TestFinishedPayload {
  testId: string
  testIndex: number
  outcome: MemberTestOutcome
  readonly steps?: never
}

// --- Step lifecycle payloads ------------------------------------------------

/** `stepStarted`: the owning `testIndex`, `stepIndex`, and `stepText`. */
export interface StepStartedPayload {
  testIndex: number
  stepIndex: number
  stepText: string
}

/**
 * `stepFinalized`: the {@link StepEvidence} projection — the full `ServedBrief` body is
 * structurally excluded (only its `briefDigest` travels). D-10/D-11.
 */
export interface StepFinalizedPayload {
  testIndex: number
  stepIndex: number
  cacheStatus: 'hit' | 'miss' | 'bypass'
  verifierVerdict: VerifierVerdict
  selfHealOccurred: boolean
  briefDigest: string
  readonly servedBrief?: never
}

// --- Sub-action evidence tick payload ----------------------------------------

/**
 * `subActionRecorded`: the {@link SubActionEvidence} projection with states collapsed to
 * `screenStateHash` identity (D-10). Raw `stateBefore`/`screenshot` are structural
 * compile errors — the 356 `NonCacheableStepInput` `?: never` idiom enforces payload
 * discipline at the type level (D-11), not a runtime strip.
 */
export interface SubActionRecordedPayload {
  testIndex: number
  stepIndex: number
  subActionIndex: number
  plan: string
  plannedAction: Action
  grounding?: GroundingEvidence
  result: RecordedActionResult
  /**
   * The `stateBefore` identity — the full {@link ScreenState} collapsed to a
   * `screenStateHash` string (D-10). This is the sub-action's primary state hash;
   * `screenStateHashAfter` is present only when the action recorded a distinct
   * post-action state.
   */
  screenStateHash: string
  screenStateHashAfter?: string
  artifactRefs?: readonly ArtifactRef[]
  readonly stateBefore?: never
  readonly screenshot?: never
}

// --- Post-processing / status chip payloads (defined-never-emitted in M1) -----

/**
 * The shared post-processing chip payload shape (spec §2.2: `{ runId, error, willRetry }`).
 * DEFINED in bus schema v1; emitted by no M1 producer — the analysis/curation/issue
 * milestones land the producers (append-only enum).
 */
export interface ChipEventPayload {
  runId: string
  error?: string
  willRetry?: boolean
}

export type AnalysisStartedPayload = ChipEventPayload
export type AnalysisCompletedPayload = ChipEventPayload
export type AnalysisFailedPayload = ChipEventPayload
export type CurationStartedPayload = ChipEventPayload
export type CurationCompletedPayload = ChipEventPayload
export type CurationFailedPayload = ChipEventPayload
export type IssuesStartedPayload = ChipEventPayload
export type IssuesCompletedPayload = ChipEventPayload
export type IssuesFailedPayload = ChipEventPayload

// --- Envelope + event union --------------------------------------------------

/** The union of every §2.2 payload projection an envelope can carry. */
export type RunEventPayload =
  | RunStartedPayload
  | RunFinishedPayload
  | VerdictPayload
  | RunWarningPayload
  | RunErrorPayload
  | HeartbeatPayload
  | TestStartedPayload
  | TestFinishedPayload
  | StepStartedPayload
  | StepFinalizedPayload
  | SubActionRecordedPayload
  | ChipEventPayload

/**
 * The frozen bus envelope (spec §2.2): `{ seq, ts, runId, type, payload }`. This is a
 * TYPE ONLY — the runner bus stamps `seq`/`ts` at publish (schema bans host time/hash APIs, D-05).
 * `seq` is a per-run gap-free monotonic integer (the total order; `lastEventId ≡ seq`);
 * `ts` is wall-clock, audit only. `runId` is a plain string here (the envelope crosses to
 * the browser/JSONL, so it carries the un-branded id).
 */
export interface RunEventEnvelope {
  seq: number
  ts: number
  runId: string
  type: RunEventType
  payload: RunEventPayload
}

/** A per-type envelope binding each event `type` to its payload projection. */
interface RunEventOf<T extends RunEventType, P extends RunEventPayload> {
  seq: number
  ts: number
  runId: string
  type: T
  payload: P
}

/**
 * The discriminated bus-event union: each event `type` mapped to its payload. M5 replay
 * tooling and M1b eval consume this to narrow on `type`. The nine chip events are members
 * of the union (defined-never-emitted in M1).
 */
export type RunEvent =
  | RunEventOf<'runStarted', RunStartedPayload>
  | RunEventOf<'runFinished', RunFinishedPayload>
  | RunEventOf<'verdict', VerdictPayload>
  | RunEventOf<'runWarning', RunWarningPayload>
  | RunEventOf<'runError', RunErrorPayload>
  | RunEventOf<'heartbeat', HeartbeatPayload>
  | RunEventOf<'testStarted', TestStartedPayload>
  | RunEventOf<'testFinished', TestFinishedPayload>
  | RunEventOf<'stepStarted', StepStartedPayload>
  | RunEventOf<'stepFinalized', StepFinalizedPayload>
  | RunEventOf<'subActionRecorded', SubActionRecordedPayload>
  | RunEventOf<'analysisStarted', AnalysisStartedPayload>
  | RunEventOf<'analysisCompleted', AnalysisCompletedPayload>
  | RunEventOf<'analysisFailed', AnalysisFailedPayload>
  | RunEventOf<'curationStarted', CurationStartedPayload>
  | RunEventOf<'curationCompleted', CurationCompletedPayload>
  | RunEventOf<'curationFailed', CurationFailedPayload>
  | RunEventOf<'issuesStarted', IssuesStartedPayload>
  | RunEventOf<'issuesCompleted', IssuesCompletedPayload>
  | RunEventOf<'issuesFailed', IssuesFailedPayload>
