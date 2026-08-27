// `runs.detail` — one run's durable members, steps and sub-actions (Phase 405 plan 01, D-03).
//
// THE FOURTH-DOOR LAW APPLIED TO RUN DETAIL (404 D-16). The dashboard's run-detail page used to
// read SQLite from inside `routes.ts`; a private store read is a capability the function layer
// cannot see, cannot audit and cannot offer to the CLI, MCP or chat. So the page reads through
// this op, the HTTP arm formats nothing, and every surface that wants "what did that run do"
// asks the same question of the same registry.
//
// ONE RESULT, NOT PAGED. A run's projection is bounded by the run — members by the suite, steps
// by the member's instruction count, sub-actions by the loop's own budget — and a cursor would
// buy a page that renders a whole run all at once nothing except a second way to be wrong about
// where a step belongs. RESEARCH's alternatives table records the measurement.
//
// THE TOKEN SUM IS COMPUTED HERE (D-06) and is exported beside the spec as a pure function, in
// the `runs-post-processing.ts` idiom: a total mapping with no capability, no port and nothing to
// await, so the exhaustive table that pins it costs a test file and not a store. Computing it in
// the port would put the sum in whichever composition happens to hold a database — which is one
// producer per host of a number the page prints as though there were one.

import {
  RunDetailProjectionSchema,
  RunsDetailInputSchema,
} from '@vostride/agent-qa-schema'
import type {
  RunDetailProjection,
  RunDetailStep,
  RunTokenTotals,
  RunsDetailInput,
} from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionSpec } from '../spec.js'
import { RunNotFoundError } from './runs-get.js'

/**
 * All lowercase and two segments, because D-15's id taxonomy is pinned as
 * `/^[a-z]+(?:\.[a-z]+)+$/` — a camelCased segment is not a spelling this catalogue admits. The
 * exported constant is what the dashboard composition hands its server as DATA;
 * `packages/dashboard-server` may not import this package, so the literal appears here once.
 */
export const RUNS_DETAIL_FUNCTION_ID = 'runs.detail'

/**
 * THE run-level token sum (D-06). Pure, total, and the ONE producer of "M of K steps unmeasured".
 *
 * A step counts as MEASURED exactly when it carries a `tokenUsage` — the additive-optional field
 * the runner appends only for a step whose model calls reported usage. A cache hit, a bypass or a
 * provider that reports nothing has no field, and that is a different fact from a step that spent
 * zero tokens.
 *
 * THE THREE SUMS ARE SPREAD IN ONLY WHEN SOMETHING WAS MEASURED, which is the whole of "absent ≠
 * zero". With no measured step the answer is `{ measuredSteps: 0, unmeasuredSteps: K }` and no
 * `totalTokens` key at all, so a page cannot render `0 tokens` for a run nobody measured. The v1
 * `prompt_tokens INTEGER DEFAULT 0` column is exactly the lie this shape refuses to be able to
 * tell.
 */
export function projectRunTokenTotals(steps: readonly RunDetailStep[]): RunTokenTotals {
  let measuredSteps = 0
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  for (const step of steps) {
    const usage = step.tokenUsage
    if (usage === undefined) continue
    measuredSteps += 1
    promptTokens += usage.promptTokens
    completionTokens += usage.completionTokens
    totalTokens += usage.totalTokens
  }

  return {
    measuredSteps,
    unmeasuredSteps: steps.length - measuredSteps,
    ...(measuredSteps === 0 ? {} : { promptTokens, completionTokens, totalTokens }),
  }
}

export const runsDetailSpec: FunctionSpec<RunsDetailInput, RunDetailProjection> = {
  id: RUNS_DETAIL_FUNCTION_ID,
  summary: "Read one run's durable members, steps and sub-actions as the dashboard projected them.",
  requiredScopes: ['read'],
  resultKind: 'unary',
  // Bound exactly where a composition owns the dashboard's projection database (the D-16 idiom). A
  // host that holds no such database lists this by name as `unbound` rather than answering an
  // empty run about a projection it has no way to observe.
  boundThrough: 'runDetail',
  input: RunsDetailInputSchema,
  output: RunDetailProjectionSchema,
  risk: { name: `fn:${RUNS_DETAIL_FUNCTION_ID}`, recognized: true, readOnly: true },
  /**
   * The three counts, which are what a receipt can honestly say about a read like this one.
   *
   * NOT THE TOKEN SUM: a receipt line quoting a number the caller is about to render would be a
   * second place that number is stated, and D-06 exists because two producers of one total drift.
   */
  classify(output): ClauseVerdict {
    return {
      status: 'executed',
      outcome: `${String(output.members.length)} member(s), `
        + `${String(output.steps.length)} step(s), `
        + `${String(output.subActions.length)} sub-action(s)`,
    }
  },
  async invoke(input, deps) {
    // `invokeFunction` already refused this composition on the same fact; reaching here with no
    // port means an in-layer caller holding the spec directly, and the refusal is the same named
    // error either way (384, D-09).
    const port = deps.runDetail
    if (port === undefined) {
      throw new FunctionNotBoundError(RUNS_DETAIL_FUNCTION_ID)
    }

    const rows = await port.read(input.runId)
    // REUSED, NEVER RE-MINTED. `runs.get` already owns "no run is recorded under that id" as a
    // caller-facing refusal, and a second not-found class would give one surface two words for one
    // answer — which is how a page ends up rendering "unknown run" and "run not found" from the
    // same door depending on which read it tried first.
    if (rows === undefined) {
      throw new RunNotFoundError(String(input.runId))
    }

    return {
      runId: rows.runId,
      members: [...rows.members],
      steps: [...rows.steps],
      subActions: [...rows.subActions],
      tokens: projectRunTokenTotals(rows.steps),
    }
  },
}
