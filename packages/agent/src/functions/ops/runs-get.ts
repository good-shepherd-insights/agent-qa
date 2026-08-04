// `runs.get` — one completed run, projected in full (Phase 384, D-06).
//
// A pure function of (validated input, injected deps). The port resolves the id against the
// runs it already enumerates and reports absence as `undefined`; turning that absence into a
// typed refusal is this module's job, so every surface sees the same error vocabulary.

import { RunDetailSchema, RunsGetInputSchema, resolveRunVerdicts } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  PerTestOutcome,
  RunDetail,
  RunTestDetail,
  RunsGetInput,
  Verdict,
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

function toRunTestDetail(
  test: PerTestOutcome,
  resolved: Verdict | undefined,
): RunTestDetail {
  return {
    testId: test.testId,
    testName: test.testName,
    filePath: test.filePath,
    testIndex: test.testIndex,
    outcome: test.outcome,
    // Step evidence stays in the handoff document; 389's evidence links address it by
    // runId + testIndex. Projecting it here would make the cheapest read the most expensive.
    // The same law covers sentences (389 D-11): this projection carries class/producer/
    // confidence from the resolved verdict and NEVER a rendered sentence — an unbound
    // analysis port answers as artifact-absent (the deterministic floor), so the cheapest
    // read stays cheap in every composition.
    stepCount: test.steps.length,
    ...(resolved === undefined ? {} : {
      rootCause: {
        class: resolved.class,
        producer: resolved.producer,
        confidence: resolved.confidence,
        rationale: resolved.evidence.rationale,
      },
    }),
  }
}

/**
 * Project one handoff over its RESOLVED verdicts (389 D-10/D-11): the summary block sources
 * class/producer/confidence from `resolveRunVerdicts` — artifact verdicts when the analysis
 * upgraded them, the handoff's deterministic floor when not — joined per member by `perTest`.
 * A member the accessor holds no verdict for (clean pass, skipped, cancelled) projects no
 * `rootCause`, exactly as the handoff's own absence used to read.
 */
export function toRunDetail(
  document: CompletedRunHandoff,
  resolvedVerdicts: readonly Verdict[] = resolveRunVerdicts(undefined, document),
): RunDetail {
  const verdictByPerTest = new Map(
    resolvedVerdicts.map((verdict) => [verdict.perTest, verdict]),
  )
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
    tests: document.tests.map((test) => (
      toRunTestDetail(test, verdictByPerTest.get(test.testIndex))
    )),
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
    // 389 D-11: the rootCause block reads through the ONE accessor. An unbound analysis
    // port is treated as artifact-absent — the floor — never as a refusal: this op stays
    // bound in every composition, and its answer off the floor is honest, not degraded.
    return toRunDetail(
      document,
      resolveRunVerdicts(deps.analysis?.getArtifact(String(input.runId)), document),
    )
  },
}
