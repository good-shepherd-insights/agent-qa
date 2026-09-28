// `runs.overview` — one completed run's compact address map (Phase 431, D-06).
//
// THE COMPLETED HANDOFF IS THE GATE. A run with no completed handoff is refused before any
// projection row is read, so an in-progress run can never answer with a partial dashboard tree.
// The handoff also owns the member list; the run-detail rows add what the projection recorded.
//
// BUILT FIELD BY FIELD. Nothing below spreads a producer or dashboard value into the result, so a
// field added upstream cannot reach this contract without being named here.

import { getActiveMaskingContext } from '@vostride/agent-qa-safety'
import {
  RUN_OVERVIEW_TEXT_MAX_CODE_POINTS,
  RUN_OVERVIEW_TRUNCATION_INDICATOR,
  RunOverviewProjectionSchema,
  RunsOverviewInputSchema,
  maskedMarker,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  MaskFn,
  RecordedTargets,
  RunDetailRows,
  RunDetailStep,
  RunOverviewProjection,
  RunOverviewStep,
  RunOverviewText,
  RunsOverviewInput,
} from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionSpec } from '../spec.js'
import { RunNotFoundError } from './runs-get.js'

export const RUNS_OVERVIEW_FUNCTION_ID = 'runs.overview'

/**
 * Mask first, then cut: truncating before masking could split a declared secret so the mask no
 * longer recognises it. Code points, not UTF-16 units, so a cut never lands inside a pair.
 */
export function overviewText(raw: string, mask: MaskFn): RunOverviewText {
  const masked = mask(raw.replace(/\s*[\r\n]+\s*/g, ' '))
  const points = [...masked]
  if (points.length <= RUN_OVERVIEW_TEXT_MAX_CODE_POINTS) return { text: masked }
  return {
    text: points.slice(0, RUN_OVERVIEW_TEXT_MAX_CODE_POINTS).join('')
      + RUN_OVERVIEW_TRUNCATION_INDICATOR,
    truncated: true,
  }
}

function activeMask(): MaskFn {
  const masking = getActiveMaskingContext()
  return masking === undefined ? () => maskedMarker('secret') : (text) => masking.mask(text)
}

function projectSteps(
  test: CompletedRunHandoff['tests'][number],
  rows: RunDetailRows | undefined,
  mask: MaskFn,
): RunOverviewStep[] {
  const detail = new Map<number, RunDetailStep>()
  for (const step of rows?.steps ?? []) {
    if (step.testIndex === test.testIndex) detail.set(step.stepIndex, step)
  }
  const recorded = new Map(test.steps.map((step) => [step.stepIndex, step]))
  const indices = [...new Set([...recorded.keys(), ...detail.keys()])].sort((a, b) => a - b)
  return indices.map((stepIndex) => {
    const label = recorded.get(stepIndex)?.stepText ?? detail.get(stepIndex)?.stepText
    const status = detail.get(stepIndex)?.status
    return {
      stepIndex,
      ...(label === undefined ? {} : { label: overviewText(label, mask) }),
      ...(status === undefined ? {} : { status }),
    }
  })
}

export const runsOverviewSpec: FunctionSpec<RunsOverviewInput, RunOverviewProjection> = {
  id: RUNS_OVERVIEW_FUNCTION_ID,
  summary: 'Map one completed run: its tests and steps with verdicts, and the address of '
    + 'everything recorded at each, without bodies, traces or bytes.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  boundThrough: 'runDetail',
  input: RunsOverviewInputSchema,
  output: RunOverviewProjectionSchema,
  risk: { name: `fn:${RUNS_OVERVIEW_FUNCTION_ID}`, recognized: true, readOnly: true },
  classify(output): ClauseVerdict {
    const steps = output.tests.reduce((total, test) => total + test.steps.length, 0)
    return {
      status: 'executed',
      outcome: `overview of ${output.runId} — ${String(output.tests.length)} test(s), `
        + `${String(steps)} step(s)`,
    }
  },
  async invoke(input, deps) {
    const port = deps.runDetail
    if (port === undefined) throw new FunctionNotBoundError(RUNS_OVERVIEW_FUNCTION_ID)

    const document = await deps.runs.get(input.runId)
    if (document === undefined) throw new RunNotFoundError(String(input.runId))

    const read = await port.read(input.runId)
    const rows = read?.runId === String(input.runId) ? read : undefined
    const recordedTargets: RecordedTargets = deps.runs.getRecordedTargets === undefined
      ? { status: 'unknown' }
      : await deps.runs.getRecordedTargets(input.runId)
    const mask = activeMask()

    return {
      runId: String(document.runId),
      scope: { tier: document.scope.tier, key: document.scope.key },
      recordedTargets: recordedTargets.status === 'recorded'
        ? { status: 'recorded', names: [...recordedTargets.names] }
        : { status: 'unknown' },
      aggregateVerdict: document.aggregateVerdict,
      buildOrdinal: document.buildOrdinal,
      startedAt: document.startedAt,
      endedAt: document.endedAt,
      tests: [...document.tests]
        .sort((left, right) => left.testIndex - right.testIndex)
        .map((test) => ({
          testIndex: test.testIndex,
          testId: test.testId,
          name: overviewText(test.testName, mask),
          outcome: test.outcome,
          steps: projectSteps(test, rows, mask),
        })),
    }
  },
}
