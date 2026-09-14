// `runs.postprocessing` — one run's chip truth, read from durable job state (Phase 388, D-14).
//
// 2026-08-26 (Phase 404, D-01): the chip set is exactly two — `{analysis, curation}`.
// 2026-09-02 (Phase 412): the chain now derives exactly the two ids the chips read; the third
// derived id left with the Issue-slot cleanup — see `DELETION-INVENTORY.md`.
//
// THE single producer of a post-processing chip status. The CLI's exit summary line (plan 04),
// any later status verb, 392's chat and M5's dashboard all call this op; none of them opens
// `agent-jobs.db`, and none of them re-derives what a row status means. That is the L10
// thin-client law applied to the one value in this phase that three surfaces render: three
// spellings of four words is not a duplication a reviewer catches, it is the state in which the
// dashboard says one thing and the CLI another about the same row, with nothing wrong in either.
//
// Chip truth is DURABLE truth on purpose (ANLZ-05). The bus chips a drain emits are a push
// convenience for a socket that happens to be open; this is the answer a user who closed their
// laptop and came back gets, and it has to be the same answer.
//
// The projection is exported as a pure function beside the spec, in the `runs-get.ts` idiom:
// a total mapping with no capability, no port and nothing to await, so the exhaustive table
// that pins it costs a test file and not a store.

import { getActiveMaskingContext } from '@vostride/agent-qa-safety'
import { z } from 'zod'
import {
  maskedMarker,
  CurationSnapshotSchema,
  POST_PROCESSING_DETAIL_STAGES,
  PostProcessingStatusSchema,
  RunsPostProcessingInputSchema,
} from '@vostride/agent-qa-schema'
import type {
  PostProcessingChipStatus,
  PostProcessingChips,
  PostProcessingStatus,
  PostProcessingDetailStage,
  PostProcessingStageDetail,
  MaskFn,
  RunsPostProcessingInput,
  CurationSnapshot,
} from '@vostride/agent-qa-schema'

import { chainJobIdsForRun } from '../../jobs/chain-identity.js'
import { FunctionNotBoundError } from '../spec.js'
import type {
  ClauseVerdict,
  FunctionSpec,
  PostProcessingChainState,
  PostProcessingJobRow,
} from '../spec.js'

/**
 * All lowercase, and that is a measurement rather than a taste.
 *
 * D-15's id taxonomy is pinned by `parity-coverage.test.ts` as `/^[a-z]+(?:\.[a-z]+)+$/`, so a
 * camelCased verb segment is not a spelling this catalogue admits. The shape follows
 * `runs.events` — a domain and a noun — because what this op returns is a STATE and not an
 * action. The exported constant is what plan 04 and every later surface name; the literal
 * appears here once.
 */
export const RUNS_POST_PROCESSING_FUNCTION_ID = 'runs.postprocessing'

/**
 * What one job row means as a chip, plus what its ABSENCE means for that particular stage.
 *
 * The absence argument is what keeps this one function rather than one per stage: every stage
 * reads a present row identically, and a stage differs only in what "no row" says. For both
 * chips today that is "not yet" (`pending`). The parameter stays even though both call sites
 * now pass the same word — a stage whose absence means something else would otherwise have to
 * be written as a second projection, which is the duplication this shape exists to prevent.
 *
 * The claim is read only for a NON-terminal row. A terminal job's claim was released by the
 * transaction that ended it, so consulting it there would be reading a field that says nothing;
 * checking the terminal statuses first also means a row that somehow carried a stale claim
 * still reports what it durably is rather than what somebody was doing to it.
 */
function chipFor(
  row: PostProcessingJobRow | undefined,
  absent: PostProcessingChipStatus,
): PostProcessingChipStatus {
  if (row === undefined) return absent
  if (row.status === 'done') return 'done'
  // `cancelled` joins `failed` deliberately: both are terminal states in which the stage's work
  // did not happen, and a chip that told them apart would be reporting queue mechanics at a
  // reader who asked what became of their run.
  if (row.status === 'failed' || row.status === 'cancelled') return 'failed'
  return row.claimed ? 'running' : 'pending'
}

/**
 * THE projection: durable chain state → the two chips (D-14; narrowed Phase 404, D-01).
 *
 * Closed and total. `undefined` — this project holds no queue database — answers exactly as an
 * empty state does, because both are the same fact about THIS run: nothing was enqueued for it.
 * Distinguishing them here would report on the host rather than on the chain that was asked
 * about, and the caller asked about a chain.
 */
export function projectPostProcessingChips(
  state: PostProcessingChainState | undefined,
): PostProcessingChips {
  return {
    analysis: chipFor(state?.analyzeRun, 'pending'),
    curation: chipFor(state?.curateMemory, 'pending'),
  }
}

/** Copy only recorded DTO facts; queue state and cancellation requests are not detail fields. */
function projectStageDetails(
  state: PostProcessingChainState | undefined,
  mask: MaskFn,
): PostProcessingStatus['stageDetails'] {
  const rows = {
    analysis: state?.analyzeRun,
    curation: state?.curateMemory,
    proposals: state?.proposeImprovements,
  } satisfies Record<PostProcessingDetailStage, PostProcessingJobRow | undefined>
  const details: NonNullable<PostProcessingStatus['stageDetails']> = {}
  for (const stage of POST_PROCESSING_DETAIL_STAGES) {
    const row = rows[stage]
    if (row === undefined) continue
    details[stage] = {
      ...(row.attempts === undefined ? {} : { attempts: row.attempts }),
      ...(row.createdAt === undefined ? {} : { createdAt: row.createdAt }),
      ...(row.claimedAt === undefined ? {} : { claimedAt: row.claimedAt }),
      ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
      ...(row.conclusionKind === undefined ? {} : { conclusionKind: row.conclusionKind }),
      ...(row.lastFailureKind === undefined ? {} : { lastFailureKind: mask(row.lastFailureKind) }),
      ...(row.lastFailureReason === undefined ? {} : { lastFailureReason: mask(row.lastFailureReason) }),
    } satisfies PostProcessingStageDetail
  }
  return Object.keys(details).length === 0 ? undefined : details
}

function projectCurationSnapshot(snapshot: CurationSnapshot, mask: MaskFn): CurationSnapshot {
  const refuse = () => new z.ZodError([{
    code: 'custom', path: ['curationSnapshot'],
    message: 'The recorded curation snapshot cannot be projected safely.',
  }])
  const source = CurationSnapshotSchema.safeParse(snapshot)
  if (!source.success) throw refuse()
  const projected = {
    ...source.data,
    rows: source.data.rows.map(row => ({
      ...row,
      recordId: mask(row.recordId),
      ...(row.byRecordId === undefined ? {} : { byRecordId: mask(row.byRecordId) }),
      changes: row.changes.map(entry => ({
        ...entry,
        change: {
          ...entry.change,
          recordId: mask(entry.change.recordId),
          ...(entry.change.byRecordId === undefined ? {} : { byRecordId: mask(entry.change.byRecordId) }),
          ...(entry.change.evidenceToken === undefined ? {} : { evidenceToken: mask(entry.change.evidenceToken) }),
          ...(entry.change.sourceRunId === undefined ? {} : { sourceRunId: mask(entry.change.sourceRunId) }),
          ...(entry.change.observationId === undefined ? {} : { observationId: mask(entry.change.observationId) }),
        },
      })),
    })),
  }
  // Discriminants and constrained hex digests remain structural facts. If redaction
  // collapses identities, refuse rather than merge rows or fabricate a new breakdown.
  const result = CurationSnapshotSchema.safeParse(projected)
  if (!result.success) throw refuse()
  return result.data
}

export const runsPostProcessingSpec: FunctionSpec<RunsPostProcessingInput, PostProcessingStatus> = {
  id: RUNS_POST_PROCESSING_FUNCTION_ID,
  summary: "Read one run's post-processing chip statuses from durable job state.",
  requiredScopes: ['read'],
  resultKind: 'unary',
  // Bound exactly where a composition supplies durable queue storage (D-16 idiom). A host that
  // cannot see the queue lists this by name as `unbound` rather than answering all-pending
  // about a chain it has no way to observe.
  boundThrough: 'postProcessing',
  input: RunsPostProcessingInputSchema,
  output: PostProcessingStatusSchema,
  risk: { name: `fn:${RUNS_POST_PROCESSING_FUNCTION_ID}`, recognized: true, readOnly: true },
  /**
   * The two chips drive classification; recorded stage details do not change read success.
   *
   * A chip reading `failed` is this op reporting a CHAIN's state truthfully; the read succeeded.
   * Folding a red chip into the clause's own status would make "the post-run chain broke" and "I
   * could not tell you about the post-run chain" the same line on a receipt.
   */
  classify(output): ClauseVerdict {
    return {
      status: 'executed',
      outcome: `chain for ${output.runId} — analysis ${output.chips.analysis}, `
        + `curation ${output.chips.curation}`,
    }
  },
  async invoke(input, deps) {
    // `invokeFunction` already refused this composition on the same fact; reaching here with no
    // port means an in-layer caller holding the spec directly, and the refusal is the same
    // named error either way (384, D-09).
    const postProcessing = deps.postProcessing
    if (postProcessing === undefined) {
      throw new FunctionNotBoundError(RUNS_POST_PROCESSING_FUNCTION_ID)
    }

    const runId = String(input.runId)
    // The ONE derivation, imported rather than restated (RESEARCH Pattern 2). Derived HERE and
    // handed down, so the rows read are the rows the enqueue addressed through this same host's
    // id source — two copies of the hash input would be two chains that review identically.
    const ids = chainJobIdsForRun(runId, postProcessing.idSource)
    const state = await postProcessing.readChain(ids, runId)
    // Resolve at invocation time: the host can bind a different masking scope for each read.
    // Without that scope, free-text failure fields fail closed with the shared display marker.
    const masking = getActiveMaskingContext()
    const mask: MaskFn = masking === undefined
      ? () => maskedMarker('secret')
      : text => masking.mask(text)
    const stageDetails = projectStageDetails(
      state,
      mask,
    )
    const curationSnapshot = state?.curationSnapshot === undefined
      ? undefined
      : projectCurationSnapshot(state.curationSnapshot, mask)

    return {
      runId,
      chips: projectPostProcessingChips(state),
      ...(stageDetails === undefined ? {} : { stageDetails }),
      ...(curationSnapshot === undefined ? {} : { curationSnapshot }),
      // Absence is spread away rather than padded (the `runs-get.ts` idiom): a chain in flight
      // has no record yet, and a rendered `null` would be a second spelling of what a missing
      // key already says.
      ...(state?.notification === undefined ? {} : { notification: state.notification }),
    }
  },
}
