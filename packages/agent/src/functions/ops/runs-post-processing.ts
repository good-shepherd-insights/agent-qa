// `runs.postprocessing` — one run's chip truth, read from durable job state (Phase 388, D-14).
//
// THE single producer of a post-processing chip status. The CLI's exit summary line (plan 04),
// any later status verb, 392's chat and M5's dashboard all call this op; none of them opens
// `agent-jobs.db`, and none of them re-derives what a row status means. That is the L10
// thin-client law applied to the one value in this phase that three surfaces render: three
// spellings of five words is not a duplication a reviewer catches, it is the state in which the
// dashboard says one thing and the CLI another about the same row, with nothing wrong in either.
//
// Chip truth is DURABLE truth on purpose (ANLZ-05). The bus chips a drain emits are a push
// convenience for a socket that happens to be open; this is the answer a user who closed their
// laptop and came back gets, and it has to be the same answer.
//
// The projection is exported as a pure function beside the spec, in the `runs-get.ts` idiom:
// a total mapping with no capability, no port and nothing to await, so the exhaustive table
// that pins it costs a test file and not a store.

import {
  PostProcessingStatusSchema,
  RunsPostProcessingInputSchema,
} from '@vostride/agent-qa-schema'
import type {
  PostProcessingChipStatus,
  PostProcessingChips,
  PostProcessingStatus,
  RunsPostProcessingInput,
} from '@vostride/agent-qa-schema'

import { chainJobIdsForRun } from '../../jobs/chain-identity.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec, PostProcessingChainState, PostProcessingJobRow } from '../spec.js'

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
 * The absence argument is the whole reason this is one function and not three. Every stage
 * reads a present row identically — that is D-04's rule surviving the triage slot being filled
 * — and the stages differ only in what "no row" says: for analysis and curation it is "not yet"
 * (`pending`), for issues it is "no job will run" (`reserved`, D-15). Pinning `reserved` to the
 * KIND instead would leave the issues chip claiming nothing will run on the day something does.
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
 * THE projection: durable chain state → the three chips (D-14).
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
    issues: chipFor(state?.triageIssues, 'reserved'),
  }
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

    return {
      runId,
      chips: projectPostProcessingChips(state),
      // Absence is spread away rather than padded (the `runs-get.ts` idiom): a chain in flight
      // has no record yet, and a rendered `null` would be a second spelling of what a missing
      // key already says.
      ...(state?.notification === undefined ? {} : { notification: state.notification }),
    }
  },
}
