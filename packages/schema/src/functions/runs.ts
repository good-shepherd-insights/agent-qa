import { z } from 'zod'

import type { Action } from '../action/index'
// 407 D-05: the `runs.knowledge` panel DTO composes three already-minted contracts — the rung
// vocabulary, the serve-time trace and the record-change row — rather than respelling any of
// them, so the panel and the verbs it sits beside can never disagree about one run.
import { RecordedRetrievalRungSchema } from '../brief/retrieval-rung'
import { ServedRetrievalTraceV1Schema } from '../brief/retrieval-trace'
import { BRIEF_WHY_NO_TRACE_REASONS } from '../knowledge/review-verbs'
import { RecordChangeSchema } from '../knowledge/maintenance-views'
import type { VerifierVerdict } from '../handoff/step-evidence'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { ScopeKey, ScopeTier } from '../identity/scope-key'
import { CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION } from '../notification/run-notification'
import type { RunNotification } from '../notification/run-notification'
import { POST_PROCESSING_CHIP_STATUSES } from '../notification/post-processing-status'
import type { PostProcessingChips, PostProcessingStatus } from '../notification/post-processing-status'
import { LiveStreamDeclarationSchema } from '../run/live-stream'
import { RUN_EVENT_TYPES } from '../run/bus-events'
import type { RunEventEnvelope, RunEventPayload } from '../run/bus-events'
import type { MemberTestOutcome } from '../run/member-outcome'
import type { RecordedActionResult } from '../result/index'
import { runIdSchema } from '../run/run-id'
import type { GroundingEvidence } from '../screen/target-descriptor'
import type { RunId } from '../run/run-id'
import { EXECUTION_CONTEXT_VALUES } from '../run/run-status'
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

// 393: hoisted to `run/run-status.ts` beside the type, so the analyze-run payload mirror
// enumerates the same closed set rather than keeping a second copy of it.
const executionContextValues = EXECUTION_CONTEXT_VALUES

const scopeKeySchema = z.object({
  tier: z.enum(scopeTierValues),
  key: z.string(),
}).strict()

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

/**
 * `runs.list`'s OUTPUT contract, named (2026-08-16, Phase 396 plan 04 · D-16).
 *
 * The array used to be composed inline in the op — `output: z.array(RunSummarySchema)` — which is
 * correct for the op and unusable for anything else, because the composed object existed only
 * inside that spec literal. D-16's claim is that the schema a surface ADVERTISES and the schema
 * `invokeFunction` VALIDATES are the same object rather than two derivations of it, and a surface
 * cannot name an object that was never bound to a name. So it is bound here, beside the element
 * schema it wraps, and `runs-list.ts` imports it instead of rebuilding it.
 *
 * Note what it is NOT: a second contract. `packages/agent`'s spec now names this one, so there is
 * still exactly one array-of-summaries schema in the system and nothing to keep in step.
 */
export const RunsListOutputSchema = z.array(RunSummarySchema)

export type RunsListOutput = z.infer<typeof RunsListOutputSchema>

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
 * `runs.postProcessing` addresses one run's post-run chain (Phase 388, D-14).
 *
 * The same one-field shape `runs.get` takes, and deliberately so: chip truth is a fact about a
 * RUN, derived from that run's id alone (RESEARCH Pattern 2). A filter, a job id or a stage
 * name on this contract would be a second way to address a chain, and the whole projection
 * rests on there being exactly one.
 */
export const RunsPostProcessingInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsPostProcessingInput = z.infer<typeof RunsPostProcessingInputSchema>

/**
 * The chain-terminal notification as a WIRE contract (Phase 388, D-09/D-11).
 *
 * A second validator over the record `guardRunNotification` also checks, and the duplication
 * is bounded rather than accidental: both are declared against the ONE `RunNotification` type
 * — this one by `satisfies`, that one by its return — so a field added to the record without a
 * home in both is a compile error rather than a divergence somebody has to notice. They are
 * two validators because they answer at two boundaries: the guard reads BYTES another build
 * may have written into a sqlite column, and this one describes the shape a surface receives
 * and the JSON-Schema projection a catalogue publishes.
 */
export const RunNotificationSchema = z.object({
  schemaVersion: z.literal(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION),
  runId: z.string(),
  outcome: z.enum(['done', 'failed']),
  verdictSummary: z.object({
    total: z.number().int().nonnegative(),
    // Partial on purpose (D-11): a class that did not occur is an ABSENT key, never a zero,
    // so "this class did not happen" and "this build does not know that class" stay different
    // bytes.
    byClass: z.partialRecord(z.enum(verdictClassValues), z.number().int().nonnegative()),
  }).strict(),
  stages: z.object({
    analysis: z.object({ status: z.enum(['done', 'failed']) }).strict(),
    curation: z.object({
      status: z.enum(['done', 'failed']),
      curated: z.number().int().nonnegative().optional(),
      deprecated: z.number().int().nonnegative().optional(),
    }).strict(),
  }).strict(),
}).strict() satisfies z.ZodType<RunNotification>

const PostProcessingChipsSchema = z.object({
  analysis: z.enum(POST_PROCESSING_CHIP_STATUSES),
  curation: z.enum(POST_PROCESSING_CHIP_STATUSES),
}).strict() satisfies z.ZodType<PostProcessingChips>

/**
 * The `runs.postProcessing` result: the two chips, plus the chain's one record once it
 * exists (Phase 388, D-14/D-15; narrowed to two — Phase 404, D-01).
 *
 * `notification` is OPTIONAL rather than nullable because absence is the ordinary state of a
 * chain still in flight. A surface that had to distinguish `null` from missing would be
 * learning a second spelling of "not yet"; the chips already say what stage the run is at.
 */
export const PostProcessingStatusSchema = z.object({
  runId: z.string(),
  chips: PostProcessingChipsSchema,
  notification: RunNotificationSchema.optional(),
}).strict() satisfies z.ZodType<PostProcessingStatus>

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
  /**
   * The run id to start under; absent means the composition mints one (Phase 401, D-02).
   *
   * ADDITIVE, and additive is what this object was built for: the strict shape refuses an
   * unrecognized key, so a field arrives as a contract change rather than as a silently ignored
   * request. Nothing about the acknowledgment law moves — every ack field is still read off the
   * durable record, and a run id nobody ran under still fails `RunNotRecordedError`.
   *
   * WHY A CALLER MAY NAME IT AT ALL. The retiring spawn port already let one: it minted the id and
   * handed it to the child through `AGENT_QA_RUN_ID`, so "the door that starts the run chooses its
   * id" is the shipped trust level, not a new one. Carrying it on the request is that same fact
   * with the child process removed from underneath it — which is the whole of D-01.
   */
  runId: runIdSchema.optional(),
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

/**
 * The `runs.liveurl` input (403 D-03). `handle` selects WHICH member of a parallel run the viewer
 * attaches to; absent means handle 0, the single-member case every non-suite run is.
 */
export const RunsLiveUrlInputSchema = z.object({
  runId: runIdSchema,
  handle: z.number().int().nonnegative().optional(),
}).strict()

export type RunsLiveUrlInput = z.infer<typeof RunsLiveUrlInputSchema>

/**
 * The `runs.liveurl` result (403 D-03/D-08). `liveUrl` carries the token in its FRAGMENT, so this
 * value is the one place the token exists outside the minting process's memory — which is why the
 * op's `classify` never interpolates it and no door logs this result.
 *
 * `stream` is the handle's DECLARED capability, echoed here so a caller can render the honest
 * no-preview state without opening a socket to find out.
 */
export const RunsLiveUrlResultSchema = z.object({
  liveUrl: z.string(),
  expiresAt: z.number().int(),
  handle: z.number().int().nonnegative(),
  stream: LiveStreamDeclarationSchema,
}).strict()

export type RunsLiveUrlResult = z.infer<typeof RunsLiveUrlResultSchema>

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

// ---- `runs.detail` — the durable run-detail projection (Phase 405 plan 01, D-03) ---------------
//
// THE WIRE MIRRORS THE BUS, FIELD FOR FIELD. Every name below is the name the producing payload
// already uses (`testIndex`, `cacheStatus`, `verifierVerdict`, `selfHealOccurred`, `briefDigest`,
// `screenStateHash`, `artifactRefs`), and that is D-01's "no field is re-derived, renamed or
// re-interpreted on the way in" applied on the way OUT. A projection that renamed anything here
// would be a second vocabulary for one run, free to drift from the events the same run recorded.

/**
 * One member test of a run, as the dashboard projection persisted it (D-01, D-18).
 *
 * `testIndex` IS THE HANDLE (RESEARCH D4): `handleId(runId, testIndex)` is how the product spells
 * run-scoped member identity, and minting a second id here would be a second spelling of it.
 *
 * EVERY DESCRIPTIVE FIELD IS OPTIONAL AND `attempts` IS NOT, which is the D-18 thin-member shape
 * stated as a type: a member whose stream begins with a terminal event has an outcome and nothing
 * else, and it must still be renderable. `attempts` is an ordinal that starts at 1 and rises on
 * `testRetryScheduled` (D-17), so it is always known.
 */
export interface RunDetailMember {
  testIndex: number
  testId?: string
  name?: string
  filePath?: string
  suiteId?: string
  suiteName?: string
  suiteIndex?: number
  totalSteps?: number
  outcome?: MemberTestOutcome
  durationMs?: number
  failureSummary?: string
  retryCount?: number
  attempts: number
}

/**
 * The per-step model spend (D-05), ABSENT when nothing was measured.
 *
 * Three numbers rather than one, mirroring the additive-optional field 405-04 appends to
 * `stepFinalized`. A cache hit, a bypass or a provider that reports no usage carries NO
 * `tokenUsage` at all — never a zero, which would be a measurement nobody made.
 */
export interface RunStepTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** One finalized step, carrying the whole `StepFinalizedPayload` as persisted (D-01). */
export interface RunDetailStep {
  testIndex: number
  stepIndex: number
  /** The instruction text, cached from this step's own `stepStarted`. */
  stepText?: string
  cacheStatus: 'hit' | 'miss' | 'bypass'
  verifierVerdict: VerifierVerdict
  selfHealOccurred: boolean
  briefDigest: string
  status?: 'passed' | 'failed' | 'healed' | 'skipped' | 'cancelled'
  durationMs?: number
  error?: string
  tokenUsage?: RunStepTokenUsage
}

/** One recorded sub-action, carrying the whole `SubActionRecordedPayload` as persisted (D-01). */
export interface RunDetailSubAction {
  testIndex: number
  stepIndex: number
  subActionIndex: number
  plan: string
  plannedAction: Action
  grounding?: GroundingEvidence
  result: RecordedActionResult
  screenStateHash: string
  screenStateHashAfter?: string
  artifactRefs?: readonly RunDetailArtifactRef[]
}

/**
 * A projected artifact ref, annotated with read-time presence (Phase 406, D-17).
 *
 * A DETAIL-SIDE EXTENSION RATHER THAN A WIDER `ArtifactRef`, because `ArtifactRef` is the shape
 * the RUNNER mints when it writes a blob, and a producer has nothing to say about whether the
 * bytes survive to be read. Presence is a fact about the moment of the read, so it is added by
 * the read.
 *
 * `present === false || evidenceIncomplete === true` IS ONE PAGE STATE, and the two arms are kept
 * apart only so the page can say which side reported it: the producer knew at emit time, or the
 * reader found it gone since. `present` ABSENT is presence UNKNOWN — a host that cannot stat its
 * blobs — and the predicate is `=== false` precisely so it never renders as a claimed absence.
 */
export interface RunDetailArtifactRef extends ArtifactRef {
  present?: boolean
}

/**
 * The run-level token sum, computed at READ time from the step rows (D-06).
 *
 * THE THREE SUMS ARE ABSENT WHEN `measuredSteps === 0`, and that asymmetry is the whole point:
 * "no step reported usage" and "every step reported zero" are different facts about a run, and a
 * page that printed `0 tokens` for the first would be reporting a measurement nobody took. The two
 * counts are always present, so a surface can honestly render "N tokens across M of K steps".
 */
export interface RunTokenTotals {
  measuredSteps: number
  unmeasuredSteps: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/**
 * What the run-detail READ PORT answers with — the rows and nothing derived (D-03).
 *
 * The token sum is DELIBERATELY NOT HERE. It is computed in the op by the exported pure
 * `projectRunTokenTotals`, so the sum has one producer in the layer that owns the contract rather
 * than one per composition root that happens to hold a database.
 */
export interface RunDetailRows {
  runId: string
  members: readonly RunDetailMember[]
  steps: readonly RunDetailStep[]
  subActions: readonly RunDetailSubAction[]
}

/** The `runs.detail` result: the rows plus the D-06 sum, in ONE unpaged answer. */
export interface RunDetailProjection extends RunDetailRows {
  tokens: RunTokenTotals
}

/**
 * `runs.detail` addresses exactly one run by id — the same one-field shape `runs.get` takes.
 *
 * Deliberately so: run detail is a fact about a RUN, derived from its id alone. A filter, a handle
 * or a page cursor on this contract would be a second way to address one page, and the projection
 * rests on there being exactly one.
 */
export const RunsDetailInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsDetailInput = z.infer<typeof RunsDetailInputSchema>

/**
 * The bus's own nested objects, carried VERBATIM across the wire.
 *
 * An open record with a cast rather than a re-declaration of `Action` / `RecordedActionResult` /
 * `GroundingEvidence` in zod: those three unions are the runner's contracts, they are large, and a
 * second declaration here would be a second answer to what an action IS — free to fall behind the
 * type the runner actually emits. This is the `RunEventEnvelopeSchema.payload` idiom in this same
 * file, for the same reason: the envelope contract describes the frame, and a consumer narrows the
 * payload against the exported union.
 */
const opaqueBusObject = <T>(): z.ZodType<T> =>
  z.record(z.string(), z.unknown()).transform((value) => value as T) as unknown as z.ZodType<T>

const ArtifactRefSchema = z.object({
  id: z.string(),
  sha: z.string(),
  evidenceIncomplete: z.boolean().optional(),
  present: z.boolean().optional(),
}).strict() satisfies z.ZodType<RunDetailArtifactRef>

const VerifierVerdictSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
}).strict() satisfies z.ZodType<VerifierVerdict>

/**
 * A WALL-CLOCK DURATION IS NOT AN INTEGER, and asserting that it is refuses every real run.
 *
 * Measured by 405-12 on the shipped binary: `runs.detail` answered `500 read_failed / ZodError` for
 * a populated run because both duration fields carried `.int()`, and the producer is a
 * `performance.now()` delta — the first real run through this contract reported
 * `227.4079999999999`. Every cell that had exercised these schemas built its rows by hand, and a
 * hand-written millisecond is a whole number, so the constraint held right up to the moment
 * somebody measured one.
 *
 * The interfaces beside these schemas type both fields as plain `number`; this is the schema
 * catching up to the type and to the producer, not a relaxation of either. `finite` stays because
 * a stored infinity is a real nonsense value and `nonnegative` because time does not run backwards.
 */
const durationMsSchema = z.number().finite().nonnegative()

export const RunDetailMemberSchema = z.object({
  testIndex: z.number().int().nonnegative(),
  testId: z.string().optional(),
  name: z.string().optional(),
  filePath: z.string().optional(),
  suiteId: z.string().optional(),
  suiteName: z.string().optional(),
  suiteIndex: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  outcome: z.enum(memberTestOutcomeValues).optional(),
  durationMs: durationMsSchema.optional(),
  failureSummary: z.string().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  attempts: z.number().int().positive(),
}).strict() satisfies z.ZodType<RunDetailMember>

export const RunStepTokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<RunStepTokenUsage>

export const RunDetailStepSchema = z.object({
  testIndex: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  stepText: z.string().optional(),
  cacheStatus: z.enum(['hit', 'miss', 'bypass']),
  verifierVerdict: VerifierVerdictSchema,
  selfHealOccurred: z.boolean(),
  briefDigest: z.string(),
  status: z.enum(['passed', 'failed', 'healed', 'skipped', 'cancelled']).optional(),
  durationMs: durationMsSchema.optional(),
  error: z.string().optional(),
  tokenUsage: RunStepTokenUsageSchema.optional(),
}).strict() satisfies z.ZodType<RunDetailStep>

export const RunDetailSubActionSchema = z.object({
  testIndex: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  subActionIndex: z.number().int().nonnegative(),
  plan: z.string(),
  plannedAction: opaqueBusObject<Action>(),
  grounding: opaqueBusObject<GroundingEvidence>().optional(),
  result: opaqueBusObject<RecordedActionResult>(),
  screenStateHash: z.string(),
  screenStateHashAfter: z.string().optional(),
  artifactRefs: z.array(ArtifactRefSchema).optional(),
}).strict() satisfies z.ZodType<RunDetailSubAction>

export const RunTokenTotalsSchema = z.object({
  measuredSteps: z.number().int().nonnegative(),
  unmeasuredSteps: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
}).strict() satisfies z.ZodType<RunTokenTotals>

export const RunDetailProjectionSchema = z.object({
  runId: z.string(),
  members: z.array(RunDetailMemberSchema),
  steps: z.array(RunDetailStepSchema),
  subActions: z.array(RunDetailSubActionSchema),
  tokens: RunTokenTotalsSchema,
}).strict() satisfies z.ZodType<RunDetailProjection>

/**
 * `runs.artifact` addresses ONE content-addressed evidence blob, run-scoped (405 D-12/D-13).
 *
 * TWO FIELDS AND NO PATH, EVER. The sha is the whole of the artifact's address inside the run, and
 * the regex here is the CONTRACT rather than a route guard: a malformed sha is refused by this
 * schema at the door, so the op never receives one and `FsEvidenceArtifactStore.getBlob` — which
 * answers `undefined` for a malformed sha and for an absent file alike — is never asked to
 * distinguish the two. Lowercase only, because the store content-addresses with
 * `createHash('sha256').digest('hex')` and an uppercase spelling would name a file that does not
 * exist while looking like a legitimate miss.
 *
 * RUN-SCOPED BY CONSTRUCTION (D-12, T-405-16). There is no global `artifacts/:sha` shape here,
 * because the store keeps no sha→run index and a route that pretended otherwise would be reading
 * one run's evidence under another run's authority.
 */
export const RunsArtifactInputSchema = z.object({
  runId: runIdSchema,
  sha: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

export type RunsArtifactInput = z.infer<typeof RunsArtifactInputSchema>

/**
 * What `runs.artifact` answers with — the bytes, base64'd, under a SNIFFED content type.
 *
 * BASE64 AND UNARY rather than a stream, because a decision screenshot is bounded by the runner's
 * own capture and a stream kind would buy a few hundred kilobytes nothing at the cost of a second
 * result vocabulary (RESEARCH Pattern 2). The adapter decodes once and writes the bytes.
 *
 * `contentType` IS DERIVED FROM THE BYTES, not from a name, an extension or anything the caller
 * said: the store keeps no metadata, and the only honest source for "what is this" is the head of
 * the blob itself. The op's sniffer answers PNG, JPEG or the opaque default and NOTHING a browser
 * renders as markup (T-405-15).
 *
 * `byteLength` IS THE DECODED SIZE, DECLARED RATHER THAN DERIVABLE. It is here so that neither the
 * op's own receipt fold nor the route's `Content-Length` has to reach into `bytesBase64` to learn
 * how big the blob is — reading a payload's content to compose a receipt is exactly what the fold
 * census in `refusal-classifiers.test.ts` refuses, and a size a consumer must decode to discover is
 * a size two consumers will compute two ways.
 */
export const RunsArtifactResultSchema = z.object({
  runId: z.string(),
  sha: z.string(),
  contentType: z.string(),
  byteLength: z.number().int().nonnegative(),
  bytesBase64: z.string(),
}).strict()

export type RunsArtifactResult = z.infer<typeof RunsArtifactResultSchema>

// ---- `runs.knowledge` — what one run USED and LEARNED (Phase 407, LERN-01/LERN-02 · D-05) -----
//
// ONE READ, ONE DTO, EVERY SURFACE. D-05's whole posture is that the Knowledge panel is a thin
// client over a single registry verb rather than a page composing N `knowledge.brief.why` calls,
// so this contract carries every fact the panel paints: per step the three served channels, the
// serve-time trace arm, the procedure plan source and the recorded rung; per run the curation
// word with its counts, the record changes attributable to this run, and the canary outcomes.
//
// THE SUBSTRATE IS THE RUN'S HANDOFF (D-06). Every field below is a projection of `StepEvidence`
// or of a sibling op invoked with the same deps — nothing here is re-derived by querying today's
// index, because a why-answer computed from the present would answer a different question than
// the one asked (KREV-02's founding argument, applied to a whole run).

/** `runs.knowledge` addresses exactly one recorded run, on `runs.postProcessing`'s one-field footing. */
export const RunsKnowledgeInputSchema = z.object({
  runId: runIdSchema,
}).strict()

export type RunsKnowledgeInput = z.infer<typeof RunsKnowledgeInputSchema>

/**
 * One channel-1 brief line as the panel renders it.
 *
 * PROJECTED FIELD BY FIELD rather than spread from `BriefLine`, so a field added to the serving
 * contract cannot silently reach a page. `servedAsCanary` rides along because it is the
 * serve-time half of D-08's attribution: the marker is always true of the line, the OUTCOME
 * arrives later on `learned.canaryAttributions`, and the two must stay separately readable.
 */
export const RunKnowledgeBriefLineSchema = z.object({
  id: z.string(),
  kind: z.string(),
  summary: z.string(),
  trust: z.number(),
  status: z.string(),
  servedAsCanary: z.boolean(),
  tier: z.string(),
}).strict()

/** One channel-2 read trace as the panel renders it. */
export const RunKnowledgeReadTraceSchema = z.object({
  id: z.string(),
  detailLevel: z.string(),
  bodyDigest: z.string(),
}).strict()

/**
 * One channel-3 caution as the panel renders it.
 *
 * `anchors` are DELIBERATELY NOT PROJECTED. The panel renders a caution's sentence and nothing
 * else, and an anchor list is structural routing detail that would arrive on the wire with no
 * reader — the projection carries what a surface paints, not everything the producer holds.
 */
export const RunKnowledgeCautionLineSchema = z.object({
  id: z.string(),
  summary: z.string(),
}).strict()

/**
 * Why this step's brief said what it said — the trace, or a NAMED absence (D-04).
 *
 * The two arms are the `knowledge.brief.why` vocabulary applied per step, and they reuse that
 * verb's own reason enum rather than a second spelling of it: one run answered through this op
 * and the same run answered through `knowledge.brief.why` can never disagree about what a
 * missing trace is called.
 */
export const RunKnowledgeTraceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answered'),
    trace: ServedRetrievalTraceV1Schema,
  }).strict(),
  z.object({
    kind: z.literal('no-trace'),
    reason: z.enum(BRIEF_WHY_NO_TRACE_REASONS),
  }).strict(),
])

export type RunKnowledgeTrace = z.infer<typeof RunKnowledgeTraceSchema>

/**
 * The step's plan source, mirroring `StepPlanSource` MEMBER FOR MEMBER (D-07).
 *
 * A replay row and a hint row stay structurally distinct on the wire because G-381-4's whole
 * lesson is that a demoted replay recommendation and an ordinary served hint are byte-identical
 * unless something keeps them apart. The guard fold travels intact so the panel can say
 * "replayed 5/5" or "broke at step 3: verifier rejection" without a second read.
 */
export const RunKnowledgePlanSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('procedure-replay'),
    procedureId: z.string(),
    guard: z.object({
      checksPassed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      miss: z.object({
        procedureStepIndex: z.number().int().nonnegative(),
        reason: z.enum([
          'descriptor-ambiguous',
          'descriptor-missing',
          'page-anchor-mismatch',
          'gate-refused',
          'parameter-unbound',
          'non-replayable-action',
        ]),
      }).strict().optional(),
      executionFailure: z.object({
        procedureStepIndex: z.number().int().nonnegative(),
      }).strict().optional(),
      verifierRejection: z.object({
        procedureStepIndex: z.number().int().nonnegative(),
      }).strict().optional(),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal('procedure-hint'),
    procedureId: z.string(),
    demotion: z.enum(['body-unreadable', 'body-unparseable', 'body-empty']).optional(),
  }).strict(),
])

export type RunKnowledgePlanSource = z.infer<typeof RunKnowledgePlanSourceSchema>

/**
 * ONE STEP of one member test, with everything the panel shows for it.
 *
 * `testIndex` AND `stepIndex` both ride, because `stepIndex` is numbered PER MEMBER TEST — a run
 * with two tests has two step 0s, and a row keyed on `stepIndex` alone would address neither
 * (the `StepEvidenceAddress` never-guess contract, restated as a wire shape).
 */
export const RunKnowledgeStepSchema = z.object({
  testId: z.string(),
  testIndex: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  stepText: z.string(),
  served: z.object({
    channel1: z.array(RunKnowledgeBriefLineSchema),
    channel2: z.array(RunKnowledgeReadTraceSchema),
    channel3: z.array(RunKnowledgeCautionLineSchema),
  }).strict(),
  trace: RunKnowledgeTraceSchema,
  planSource: RunKnowledgePlanSourceSchema.optional(),
  retrievalRung: RecordedRetrievalRungSchema.optional(),
}).strict()

export type RunKnowledgeStep = z.infer<typeof RunKnowledgeStepSchema>

/**
 * One served canary line that curation later attributed an outcome to (D-08).
 *
 * `recordId` is the served line's own id — which IS the curation candidate id, the pin
 * `emit-canary-outcomes.ts` already relies on — and `observationId` is the sha-derived id the
 * outcome event carries, so a surface can trace a badge back to the exact event that justified
 * it. Rows appear ONLY for tuples with a surviving attributed outcome; a canary line with no
 * outcome yet is absent here and the panel reads "attribution pending" from the curation word.
 */
export const RunKnowledgeCanaryAttributionSchema = z.object({
  testIndex: z.number().int().nonnegative(),
  stepIndex: z.number().int().nonnegative(),
  recordId: z.string(),
  observationId: z.string(),
  outcome: z.enum(['confirmed', 'contradicted', 'helpful', 'harmful']),
}).strict()

export type RunKnowledgeCanaryAttribution = z.infer<typeof RunKnowledgeCanaryAttributionSchema>

/**
 * The whole panel projection — TWO ARMS, and the second one is the point (D-06).
 *
 * `evidence-incomplete` is a RESULT, not a throw. A run whose handoff has been pruned is the
 * ordinary "go looking" case 406 D-17 gave a component to, and a refusal would make a legible
 * page state indistinguishable from a broken read.
 *
 * `knowledgeStore` distinguishes "this project has no knowledge store" from "retrieval ran and
 * served nothing", derived from the durable {@link NO_KNOWLEDGE_READER_TRUNCATION} marker rather
 * than from a handoff version — a version says when a run happened, not what was bound to it.
 *
 * NO `null` ANYWHERE. Absence is an absent key throughout (the layer's own idiom): `counts` is
 * missing when the frozen notification row did not record both numbers, `pendingProposalCount`
 * is missing when this host owns no proposals inbox, and neither reads as a zero somebody
 * measured.
 */
export const RunKnowledgeProjectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('evidence-incomplete'),
    runId: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('ready'),
    runId: z.string(),
    buildOrdinal: z.number().int().nonnegative(),
    knowledgeStore: z.enum(['bound', 'unbound']),
    retrievalRung: RecordedRetrievalRungSchema.optional(),
    steps: z.array(RunKnowledgeStepSchema),
    curation: z.object({
      status: z.enum(POST_PROCESSING_CHIP_STATUSES),
      counts: z.object({
        curated: z.number().int().nonnegative(),
        deprecated: z.number().int().nonnegative(),
      }).strict().optional(),
    }).strict(),
    learned: z.object({
      changes: z.array(RecordChangeSchema),
      canaryAttributions: z.array(RunKnowledgeCanaryAttributionSchema),
    }).strict(),
    pendingProposalCount: z.number().int().nonnegative().optional(),
  }).strict(),
])

export type RunKnowledgeProjection = z.infer<typeof RunKnowledgeProjectionSchema>

/**
 * What the evidence-blob READ PORT answers with — three arms, and absence is TWO of them.
 *
 * THE SPLIT IS THE WHOLE POINT (D-15). `FsEvidenceArtifactStore.getBlob` returns `undefined` for a
 * run that never existed and for a run that exists and holds no such blob, and those are different
 * operator situations: the first is a bad link, the second is a GC'd or never-written artifact that
 * the page must render as a visible "screenshot unavailable" state. A port that answered one word
 * for both would make that distinction unrecoverable above it.
 *
 * NEITHER ABSENCE IS AN ERROR HERE. Turning an arm into the layer's typed refusal is the op's job,
 * so the "not found" vocabulary lives in one place rather than in every composition root.
 */
export type EvidenceBlobLookup =
  | { readonly status: 'found'; readonly bytes: Uint8Array }
  | { readonly status: 'blob_absent' }
  | { readonly status: 'unknown_run' }

/**
 * The same three words, asked as a STAT rather than as a read (Phase 406, D-17).
 *
 * DERIVED FROM {@link EvidenceBlobLookup} RATHER THAN RESPELLED, because presence and the read
 * are one question asked at two costs: a durable read annotating every artifact ref on a run page
 * must not load a screenshot to decide whether to draw a link. A second literal union here would
 * be a second answer to which absences exist, free to fall behind the one the port already
 * serves — and the whole value of the split (D-15) is that the two arms stay distinguishable.
 */
export type EvidenceBlobPresence = EvidenceBlobLookup['status']
