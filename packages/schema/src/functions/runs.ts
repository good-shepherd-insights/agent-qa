import { z } from 'zod'

import type { ScopeKey, ScopeTier } from '../identity/scope-key'
import { RUN_EVENT_TYPES } from '../run/bus-events'
import type { RunEventEnvelope, RunEventPayload } from '../run/bus-events'
import type { MemberTestOutcome } from '../run/member-outcome'
import { asRunId } from '../run/run-id'
import type { RunId } from '../run/run-id'
import type { ExecutionContext, RunStatus } from '../run/run-status'
import type { Verdict } from '../verdict/verdict'

export const RUN_SUMMARY_SCHEMA_VERSION = 1

/**
 * Surface-facing projection of one completed run (Phase 384, D-16).
 *
 * Minimal by construction: it carries the identity fields 387's run addressing
 * (`RUN-456`) resolves against, the build ordinal knowledge folds key on, and the
 * coarse outcome a listing renders. Step-level evidence stays in the handoff
 * document — 389's evidence links reach it through `runId`, not through this DTO.
 */
export interface RunSummary {
  runId: RunId
  scope: ScopeKey
  buildOrdinal: number
  executionContext: ExecutionContext
  aggregateVerdict: RunStatus
  startedAt: number
  endedAt: number
  /** Number of member tests the run recorded. */
  testCount: number
}

const scopeTierValues = [
  'global',
  'product',
  'suite',
  'test',
] as const satisfies readonly ScopeTier[]

const runStatusValues = [
  'passed',
  'failed',
  'healed',
  'timeout',
  'cancelled',
] as const satisfies readonly RunStatus[]

const executionContextValues = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
] as const satisfies readonly ExecutionContext[]

const scopeKeySchema = z.object({
  tier: z.enum(scopeTierValues),
  key: z.string(),
}).strict()

const runIdSchema = z.string().transform(asRunId)

export const RunSummarySchema = z.object({
  runId: runIdSchema,
  scope: scopeKeySchema,
  buildOrdinal: z.number().int().nonnegative(),
  executionContext: z.enum(executionContextValues),
  aggregateVerdict: z.enum(runStatusValues),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  testCount: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<RunSummary>

/**
 * `runs.list` takes no arguments in the tracer slice. It is a `.strict()` empty object
 * rather than `z.void()` so filters (product, since-ordinal, limit) become additive
 * fields later without changing the op's input contract shape.
 */
export const RunsListInputSchema = z.object({}).strict()

export type RunsListInput = z.infer<typeof RunsListInputSchema>

export const RUN_DETAIL_SCHEMA_VERSION = 1

/**
 * One member test as `runs.get` projects it (Phase 384, D-06/D-16).
 *
 * Carries the stable test identity (filePath + testName, ABRF-02) a review surface
 * addresses and renders, the member verdict, and the root-cause classification when the
 * run produced one. Step evidence itself is deliberately NOT projected — `stepCount` is
 * the only step-shaped field, and 389's evidence links reach the full step record through
 * the handoff document by `runId` + `testIndex`.
 */
export interface RunTestDetail {
  testId: string
  testName: string
  filePath: string
  testIndex: number
  outcome: MemberTestOutcome
  /** Number of recorded steps; the step evidence stays in the handoff document. */
  stepCount: number
  /**
   * Present iff the run classified a root cause for this member. Flattened to the three
   * fields a listing renders — the full `Verdict` (cited steps, anchors, artifacts) stays
   * in the handoff document rather than crossing every surface boundary by default.
   */
  rootCause?: {
    class: Verdict['class']
    producer: 'deterministic-classifier' | 'analyze-run'
    confidence: number
    rationale: string
  }
}

/**
 * The `runs.get` result: one completed run projected across the `CompletedRunHandoff` v4
 * surface a review UI needs (Phase 384, D-06/D-16).
 *
 * A superset of {@link RunSummary} — every listing field, plus the config digests a
 * reproduction needs, both durable run markers, and the per-member outcome rows.
 */
export interface RunDetail {
  runId: RunId
  scope: ScopeKey
  buildOrdinal: number
  executionContext: ExecutionContext
  aggregateVerdict: RunStatus
  configDigests: {
    suiteConfigDigest: string
    testConfigDigest: string
  }
  startedAt: number
  endedAt: number
  /**
   * D-10 verify-before-present gate-run marker, copied verbatim from the handoff.
   * Absent for an ordinary run; only the literal marker is meaningful.
   */
  gateRun?: true
  /**
   * D-14 §6 outcome-exclusion marker, copied verbatim from the handoff. A DISTINCT axis
   * from `gateRun` — neither implies the other.
   */
  excludedFromOutcomes?: true
  tests: RunTestDetail[]
}

const verdictClassValues = [
  'test_bug',
  'app_bug',
  'environment',
  'flake',
  'config_error',
  'llm_error',
  'unknown',
  'timeout',
] as const satisfies readonly Verdict['class'][]

const memberTestOutcomeValues = [
  ...runStatusValues,
  'skipped',
] as const satisfies readonly MemberTestOutcome[]

const configDigestsSchema = z.object({
  suiteConfigDigest: z.string(),
  testConfigDigest: z.string(),
}).strict()

export const RunTestDetailSchema = z.object({
  testId: z.string(),
  testName: z.string(),
  filePath: z.string(),
  testIndex: z.number().int().nonnegative(),
  outcome: z.enum(memberTestOutcomeValues),
  stepCount: z.number().int().nonnegative(),
  rootCause: z.object({
    class: z.enum(verdictClassValues),
    producer: z.enum(['deterministic-classifier', 'analyze-run']),
    confidence: z.number(),
    rationale: z.string(),
  }).strict().optional(),
}).strict() satisfies z.ZodType<RunTestDetail>

export const RunDetailSchema = z.object({
  runId: runIdSchema,
  scope: scopeKeySchema,
  buildOrdinal: z.number().int().nonnegative(),
  executionContext: z.enum(executionContextValues),
  aggregateVerdict: z.enum(runStatusValues),
  configDigests: configDigestsSchema,
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative(),
  gateRun: z.literal(true).optional(),
  excludedFromOutcomes: z.literal(true).optional(),
  tests: z.array(RunTestDetailSchema),
}).strict() satisfies z.ZodType<RunDetail>

/** `runs.get` addresses exactly one completed run by id. */
export const RunsGetInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsGetInput = z.infer<typeof RunsGetInputSchema>

/**
 * The `runs.start` input (D-09/D-10). The op registers with this full contract in 384 and
 * binds to a named not-bound-in-this-composition error until 386 relocates the composition
 * root — so this schema is the contract, not a description of what runs today.
 *
 * Every field is optional: an argument-less call means "run the configured default set the
 * resolved config describes". Fields are additive by construction (the object is strict, so
 * an unrecognized key is a typed refusal rather than a silently ignored request).
 */
export const RunsStartInputSchema = z.object({
  /** Test file paths or glob patterns to run; absent means the configured default set. */
  patterns: z.array(z.string()).optional(),
  /** Scope the run addresses; absent resolves from the config. */
  scope: scopeKeySchema.optional(),
  /** Execution context to record on the run; absent resolves from the environment. */
  executionContext: z.enum(executionContextValues).optional(),
  /** Config file the composition root resolves the run against. */
  configPath: z.string().optional(),
  /**
   * D-10 verify-before-present gate-run marker. Surfaced here so 393 can set it and 388 can
   * propagate it onto the analyze-run job payload with no second schema break. Only the
   * literal marker is accepted, matching the handoff carrier exactly.
   */
  gateRun: z.literal(true).optional(),
  /** D-14 §6 outcome-exclusion marker; a DISTINCT axis from `gateRun`. */
  excludedFromOutcomes: z.literal(true).optional(),
}).strict()

export type RunsStartInput = z.infer<typeof RunsStartInputSchema>

export const RUN_START_ACKNOWLEDGEMENT_SCHEMA_VERSION = 1

/**
 * The `runs.start` result (Phase 384, D-09).
 *
 * Starting a run is ASYNCHRONOUS, so the acknowledgment names the run a caller may now
 * address — `runs.events` for the stream while it happens, `runs.get` for the outcome once
 * it exists — and deliberately not the outcome itself, which has not happened yet. Both
 * durable markers are echoed so a caller can confirm the run was accepted as the kind of
 * run it asked for rather than assuming its request survived resolution.
 */
export interface RunStartAcknowledgement {
  runId: RunId
  scope: ScopeKey
  executionContext: ExecutionContext
  buildOrdinal: number
  startedAt: number
  /** Member tests the resolved pattern set admitted. */
  testCount: number
  gateRun?: true
  excludedFromOutcomes?: true
}

export const RunStartAcknowledgementSchema = z.object({
  runId: runIdSchema,
  scope: scopeKeySchema,
  executionContext: z.enum(executionContextValues),
  buildOrdinal: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  testCount: z.number().int().nonnegative(),
  gateRun: z.literal(true).optional(),
  excludedFromOutcomes: z.literal(true).optional(),
}).strict() satisfies z.ZodType<RunStartAcknowledgement>

/**
 * The `runs.events` stream input (D-08). `lastEventId` is the v49 bus resume token — the
 * gap-free `seq` of the last envelope the caller observed, so the stream resumes at
 * `lastEventId + 1`. Absent means replay from the beginning of the log.
 */
export const RunsEventsInputSchema = z.object({
  runId: runIdSchema,
  lastEventId: z.number().int().nonnegative().optional(),
}).strict()

export type RunsEventsInput = z.infer<typeof RunsEventsInputSchema>

export const RUN_EVENT_ENVELOPE_SCHEMA_VERSION = 1

/**
 * The `runs.events` stream ELEMENT contract (Phase 384, D-08).
 *
 * A stream op's declared output describes ONE element of the async iterable, never the
 * iterable itself — so this is the frozen v49 bus envelope as the JSONL event log records
 * it. `seq` is the per-run gap-free total order and doubles as the resume token: a caller
 * that observed seq N re-invokes with `lastEventId: N`.
 *
 * `payload` is projected as an OPEN record rather than the fifteen-member per-type union.
 * The envelope contract describes the frame; a consumer narrows the payload by `type`
 * against the exported `RunEvent` union. The `.transform` restoring the union rides the
 * same idiom as the branded-id schemas here, so JSON-Schema projection uses `io: 'input'`.
 */
export const RunEventEnvelopeSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.number().int().nonnegative(),
  runId: z.string(),
  type: z.enum(RUN_EVENT_TYPES),
  payload: z.record(z.string(), z.unknown()).transform((value) => value as RunEventPayload),
}).strict() satisfies z.ZodType<RunEventEnvelope>
