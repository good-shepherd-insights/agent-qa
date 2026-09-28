// `runs.list` — the tracer capability (Phase 384, D-06), widened by 431 D-08.
//
// A pure function of (validated input, injected deps): it filters ONE completed-run snapshot,
// orders it newest-finished first under a total order (endedAt, then runId) so a fixed fixture
// always renders byte-identically, and caps what it returns only after every filter has run.

import {
  RUNS_LIST_DEFAULT_LIMIT,
  RunsListInputSchema,
  RunsListOutputSchema,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  RecordedTargets,
  RunSummary,
  RunsListInput,
} from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionSpec } from '../spec.js'

export const RUNS_LIST_FUNCTION_ID = 'runs.list'

export function toRunSummary(
  document: CompletedRunHandoff,
  recordedTargets: RecordedTargets = { status: 'unknown' },
): RunSummary {
  return {
    runId: document.runId,
    scope: document.scope,
    buildOrdinal: document.buildOrdinal,
    executionContext: document.executionContext,
    aggregateVerdict: document.aggregateVerdict,
    startedAt: document.startedAt,
    endedAt: document.endedAt,
    testCount: document.tests.length,
    tests: document.tests.map((test) => ({
      testIndex: test.testIndex,
      testId: test.testId,
      testName: test.testName,
    })),
    recordedTargets,
  }
}

/** Latest finished first: `endedAt` descending, then `runId` descending, so the order is total. */
export function compareLatestFinished(
  left: { readonly endedAt: number; readonly runId: string },
  right: { readonly endedAt: number; readonly runId: string },
): number {
  if (left.endedAt !== right.endedAt) return right.endedAt - left.endedAt
  return left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0
}

function namesTest(document: CompletedRunHandoff, filter: string): boolean {
  const needle = filter.toLowerCase()
  return document.tests.some((test) => (
    test.testId === filter || test.testName.toLowerCase().includes(needle)
  ))
}

function recordsTarget(targets: RecordedTargets, target: string): boolean {
  return targets.status === 'recorded' && targets.names.includes(target)
}

export const runsListSpec: FunctionSpec<RunsListInput, RunSummary[]> = {
  id: RUNS_LIST_FUNCTION_ID,
  summary:
    'List completed runs, newest finished first (20 by default, at most 200), each naming its '
    + 'tests; filter by verdict, test id or title, recorded target, or completion time.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: RunsListInputSchema,
  // 2026-08-16 (396-04, D-16): the NAMED array schema, not `z.array(RunSummarySchema)` composed
  // here. The two are the same shape; only one of them is an object a surface can also name, and
  // D-16's whole claim is that the advertised schema and the validated schema are one object.
  output: RunsListOutputSchema,
  // Read ops declare `readOnly` so the static classifier lands them on the read-only
  // tier — allow in every execution context. The verdict is still computed and audited
  // (D-11): there is no read bypass, only a read classification.
  risk: { name: `fn:${RUNS_LIST_FUNCTION_ID}`, recognized: true, readOnly: true },
  /**
   * A listing that answered — the count, and nothing out of a run (399.1 D-01).
   */
  classify(output): ClauseVerdict {
    return { status: 'executed', outcome: `${output.length} completed run(s)` }
  },
  async invoke(input, deps) {
    const limit = input.limit ?? RUNS_LIST_DEFAULT_LIMIT
    const candidates = (await deps.runs.list())
      .filter((document) => (
        (input.verdict === undefined || document.aggregateVerdict === input.verdict)
        && (input.since === undefined || document.endedAt >= input.since)
        && (input.test === undefined || namesTest(document, input.test))
      ))
      .sort(compareLatestFinished)
      .map((document) => toRunSummary(document))
    const selected = input.target === undefined
      ? candidates
      : candidates.filter((row) => recordsTarget(row.recordedTargets, input.target!))
    return selected.slice(0, limit)
  },
}
