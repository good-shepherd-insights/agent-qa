// `runs.events` — the D-08 stream kind, wired against the recorded event log (FUNC-07).
//
// A pure function of (validated input, injected deps). The op owns the resume ARITHMETIC
// and the refusal vocabulary; the bytes arrive through `FunctionDeps.runs.readEvents`,
// which the composition root builds over the concrete JSONL event log.
//
// The stream this returns is contract-identical to the live attach 386 lands: elements are
// the same seq-stamped envelopes in the same order, and the resume token is the element's
// own `seq`. Replay of a completed run is simply the case where the producer has finished.

import { ReplayIncompleteError } from '@vostride/agent-qa-runner'
import { RunEventEnvelopeSchema, RunsEventsInputSchema } from '@vostride/agent-qa-schema'
import type { RunEventEnvelope, RunsEventsInput } from '@vostride/agent-qa-schema'

import type { FunctionStream, FunctionStreamSpec } from '../spec.js'

export const RUNS_EVENTS_FUNCTION_ID = 'runs.events'

/**
 * The requested resume point is below the lowest seq the log can still serve.
 *
 * A caller-facing refusal, and the ONE alternative to silently serving a gap: the caller
 * learns the exact seq replay can restart at, so it can decide whether to accept the loss
 * or re-read the run in full. `earliestAvailableSeq` is the documented resume floor the
 * v49 bus reports, carried across the layer boundary unchanged.
 */
export class StreamReplayFloorError extends Error {
  constructor(
    readonly runId: string,
    readonly requestedSeq: number,
    readonly earliestAvailableSeq: number,
  ) {
    super(
      `Events before seq ${earliestAvailableSeq} are no longer available for run ${runId} ` +
        `(replay requested at seq ${requestedSeq})`,
    )
    this.name = 'StreamReplayFloorError'
  }
}

/**
 * Yield the acquired envelopes one at a time.
 *
 * Acquisition happens BEFORE the generator is handed out (see `invoke`), so a floor
 * refusal is an invocation failure rather than a stream that dies mid-delivery. Iteration
 * itself stays lazy, which is the shape a live producer fills in unchanged.
 */
async function* replay(
  events: readonly RunEventEnvelope[],
): FunctionStream<RunEventEnvelope> {
  for (const event of events) {
    yield event
  }
}

export const runsEventsSpec: FunctionStreamSpec<RunsEventsInput, RunEventEnvelope> = {
  id: RUNS_EVENTS_FUNCTION_ID,
  summary: "Stream one run's recorded events in seq order, resuming after lastEventId.",
  requiredScopes: ['read'],
  resultKind: 'stream',
  bindingStatus: 'bound',
  input: RunsEventsInputSchema,
  output: RunEventEnvelopeSchema,
  risk: { name: `fn:${RUNS_EVENTS_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(input, deps) {
    // The token names the last envelope the caller ALREADY observed, so replay opens at
    // the next one. Absent means the caller has observed nothing, i.e. seq 1 onward.
    const fromSeq = (input.lastEventId ?? 0) + 1

    let events: readonly RunEventEnvelope[]
    try {
      events = await deps.runs.readEvents(input.runId, fromSeq)
    } catch (error) {
      if (error instanceof ReplayIncompleteError) {
        throw new StreamReplayFloorError(input.runId, fromSeq, error.earliestAvailableSeq)
      }
      throw error
    }

    return replay(events)
  },
}
