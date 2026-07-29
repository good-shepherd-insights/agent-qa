// `runs.list` — the tracer capability (Phase 384, D-06).
//
// A pure function of (validated input, injected deps): it maps completed-run handoffs
// into the schema-owned `RunSummary` projection and imposes a total order so a fixed
// fixture always renders byte-identically.

import { RunSummarySchema, RunsListInputSchema } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, RunSummary, RunsListInput } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import type { FunctionSpec } from '../spec.js'

export const RUNS_LIST_FUNCTION_ID = 'runs.list'

export function toRunSummary(document: CompletedRunHandoff): RunSummary {
  return {
    runId: document.runId,
    scope: document.scope,
    buildOrdinal: document.buildOrdinal,
    executionContext: document.executionContext,
    aggregateVerdict: document.aggregateVerdict,
    startedAt: document.startedAt,
    endedAt: document.endedAt,
    testCount: document.tests.length,
  }
}

export const runsListSpec: FunctionSpec<RunsListInput, RunSummary[]> = {
  id: RUNS_LIST_FUNCTION_ID,
  summary: 'List the completed runs recorded for this project.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: RunsListInputSchema,
  output: z.array(RunSummarySchema),
  // Read ops declare `readOnly` so the static classifier lands them on the read-only
  // tier — allow in every execution context. The verdict is still computed and audited
  // (D-11): there is no read bypass, only a read classification.
  risk: { name: `fn:${RUNS_LIST_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(_input, deps) {
    const documents = await deps.runs.list()
    return documents
      .map(toRunSummary)
      .sort((left, right) => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0))
  },
}
