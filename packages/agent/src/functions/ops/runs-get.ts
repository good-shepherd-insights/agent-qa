// `runs.get` — one completed run, projected in full (Phase 384, D-06).
//
// A pure function of (validated input, injected deps). The port resolves the id against the
// runs it already enumerates and reports absence as `undefined`; turning that absence into a
// typed refusal is this module's job, so every surface sees the same error vocabulary.

import { RunDetailSchema, RunsGetInputSchema } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  PerTestOutcome,
  RunDetail,
  RunTestDetail,
  RunsGetInput,
} from '@vostride/agent-qa-schema'

import type { FunctionSpec } from '../spec.js'

export const RUNS_GET_FUNCTION_ID = 'runs.get'

/**
 * No completed run is recorded under the requested id.
 *
 * A caller-facing refusal rather than an internal invariant violation: asking for a run that
 * has not happened is an ordinary thing for a surface to do, and the answer has to be
 * distinguishable from a run that exists and recorded no member tests.
 */
export class RunNotFoundError extends Error {
  constructor(readonly runId: string) {
    super(`No completed run recorded for id: ${runId}`)
    this.name = 'RunNotFoundError'
  }
}

function toRunTestDetail(test: PerTestOutcome): RunTestDetail {
  return {
    testId: test.testId,
    testName: test.testName,
    filePath: test.filePath,
    testIndex: test.testIndex,
    outcome: test.outcome,
    // Step evidence stays in the handoff document; 389's evidence links address it by
    // runId + testIndex. Projecting it here would make the cheapest read the most expensive.
    stepCount: test.steps.length,
    ...(test.rootCause === undefined ? {} : {
      rootCause: {
        class: test.rootCause.class,
        producer: test.rootCause.producer,
        confidence: test.rootCause.confidence,
        rationale: test.rootCause.evidence.rationale,
      },
    }),
  }
}

export function toRunDetail(document: CompletedRunHandoff): RunDetail {
  return {
    runId: document.runId,
    scope: document.scope,
    buildOrdinal: document.buildOrdinal,
    executionContext: document.executionContext,
    aggregateVerdict: document.aggregateVerdict,
    configDigests: document.configDigests,
    startedAt: document.startedAt,
    endedAt: document.endedAt,
    // Both durable markers are copied VERBATIM and stay independent axes: absence in the
    // handoff is absence in the projection, never a rendered `false`.
    ...(document.gateRun === undefined ? {} : { gateRun: document.gateRun }),
    ...(document.excludedFromOutcomes === undefined
      ? {}
      : { excludedFromOutcomes: document.excludedFromOutcomes }),
    tests: document.tests.map(toRunTestDetail),
  }
}

export const runsGetSpec: FunctionSpec<RunsGetInput, RunDetail> = {
  id: RUNS_GET_FUNCTION_ID,
  summary: 'Read one completed run in full, including its member-test outcomes.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: RunsGetInputSchema,
  output: RunDetailSchema,
  risk: { name: `fn:${RUNS_GET_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(input, deps) {
    const document = await deps.runs.get(input.runId)
    if (document === undefined) {
      throw new RunNotFoundError(input.runId)
    }
    return toRunDetail(document)
  },
}
