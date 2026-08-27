import type {
  RunDetailStep,
  RunDetailSubAction,
  RunStepTokenUsage,
  VerifierVerdict,
} from '@vostride/agent-qa-schema'

import type { StepRow, SubActionData, StepAnnotation } from './api'
import type { RunDetailGroup } from './run-detail-view'
import { runDetailStepKey } from './selection'
import type { EditorStep } from '@/hooks/use-live-editor'
import { normalizeStepStatus } from '@/lib/status'

// The live editor's phase record — relocated from the retired `use-execution-events` hook by 405
// (D-19/D-20). The census measured that the editor executes in-process via core `executeStep` and
// never used the retired spawn, so the editor stays; only this type moved to its consumer's home.
export interface LivePhase {
  phase: 'observe' | 'plan' | 'execute' | 'verify' | 'heal'
  subActionIndex?: number
  phaseOrdinal?: number
  text?: string
  confidence?: number
  action?: unknown
  success?: boolean
  duration?: number
  timestamp: string
}

/**
 * What a step looks like to the run-detail tree and panels.
 *
 * TWO PRODUCERS, ONE SHAPE, MID-MIGRATION (405-08). {@link fromRunDetailStep} builds this from the
 * durable projection — the rebuilt page's only source — while {@link fromStepRow} and
 * {@link fromEditorStep} still build it from the v1 row and the live editor. The v1-only fields are
 * therefore OPTIONAL rather than null-filled: a durable step genuinely has no
 * `screenshotPath`, no `variableSnapshot` and no `accessibilityViolations`, and filling them with
 * `null` would spell "the v1 read happened and found nothing" where the truth is "that read no
 * longer exists". 405-11 deletes them together with their consumers.
 */
export interface DisplayStep {
  /** `<testIndex>:<stepIndex>` for a durable step (see `runDetailStepKey`); the row id for a v1 one. */
  id: string
  name: string
  status: string
  duration: number
  error?: string | null
  stepOrder: number
  rawStepOrder: number
  displayStepOrder: number
  displayStepTotal: number | null

  // ---- the durable projection's own fields (405-08) ----
  /** The member handle this step belongs to — present only on a durable step. */
  testIndex?: number
  /** The step's ordinal within its member — present only on a durable step. */
  stepIndex?: number
  /** The sub-actions recorded under this step, in the producer's order. */
  subActions?: readonly RunDetailSubAction[]
  cacheStatus?: RunDetailStep['cacheStatus']
  verifierVerdict?: VerifierVerdict
  selfHealOccurred?: boolean
  /** ABSENT when the step reported no usage — never a zero (D-05/D-06). */
  tokenUsage?: RunStepTokenUsage

  // ---- v1 / live-editor fields, deleted with their consumers by 405-11 ----
  subActionsData?: SubActionData[] | null
  originalStepName?: string | null
  variableSnapshot?: Record<string, { value: string; source: string }> | null
  screenshotPath?: string | null
  screenshotBeforePath?: string | null
  annotationData?: StepAnnotation | null
  observation?: string | null
  reasoning?: string | null
  plannedAction?: unknown | null
  action?: unknown | null
  confidence?: number | null
  runId?: string | null
  consoleLogs?: Array<{
    level: string
    text: string
    location?: { url: string; lineNumber: number; columnNumber: number }
    timestamp: number
  }> | null
  networkLogs?: Array<{
    url: string
    method: string
    status: number
    requestHeaders: Record<string, string>
    responseHeaders: Record<string, string>
    body?: string
    requestBody?: string
    startTime: number
    endTime: number
    timing?: Record<string, number>
  }> | null
  accessibilityViolations?: StepRow['accessibilityViolations']
  screenContextBefore?: string | null
  screenContextAfter?: string | null
  rawRunId?: string | null
}

/** What a step with no recorded text is called, so the tree never renders a blank row. */
export const UNNAMED_STEP_LABEL = 'Untitled step'

/**
 * Build a display step out of the DURABLE projection (405-08 · D-16).
 *
 * THE STATUS FALLS BACK TO THE VERDICT, NOT TO A GUESS. `status` is optional on the wire because a
 * producer may finalize a step without one; the verifier's own `pass` is the next most direct fact
 * about the same step, and it is a fact the projection actually carries. Nothing here invents a
 * `running` or a `skipped` the read did not report.
 *
 * A SELF-HEALED STEP KEEPS ITS OWN WORD. `selfHealOccurred` is carried through rather than folded
 * into `status`, so the tree can show the heal without the panels losing whether the step passed.
 *
 * `tokenUsage` IS FORWARDED AS-IS, absent and all (D-06). There is no `?? 0` on this path: a step
 * that reported nothing must not read as a step that spent nothing.
 */
export function fromRunDetailStep(
  step: RunDetailStep,
  subActions: readonly RunDetailSubAction[],
): DisplayStep {
  return {
    id: runDetailStepKey(step.testIndex, step.stepIndex),
    name: step.stepText ?? UNNAMED_STEP_LABEL,
    status: step.status ?? (step.verifierVerdict.pass ? 'passed' : 'failed'),
    duration: step.durationMs ?? 0,
    error: step.error,
    stepOrder: step.stepIndex,
    rawStepOrder: step.stepIndex,
    displayStepOrder: step.stepIndex + 1,
    displayStepTotal: null,
    testIndex: step.testIndex,
    stepIndex: step.stepIndex,
    subActions,
    cacheStatus: step.cacheStatus,
    verifierVerdict: step.verifierVerdict,
    selfHealOccurred: step.selfHealOccurred,
    tokenUsage: step.tokenUsage,
  }
}

/**
 * Flatten the member-grouped tree into the page's ONE numbered step list (405-08).
 *
 * The tree and the page must agree on both the ids and the "step N of M" counters, so there is one
 * producer of both and both surfaces call it. Two independent flattenings that happened to agree
 * today are two flattenings that can disagree tomorrow, and the disagreement would show up as a
 * deep link selecting a row the tree is not highlighting.
 */
export function displayStepsForGroups(groups: readonly RunDetailGroup[]): DisplayStep[] {
  return withDisplayStepProgress(
    groups.flatMap((group) =>
      group.steps.map((stepGroup) => fromRunDetailStep(stepGroup.step, stepGroup.subActions)),
    ),
  )
}

export function fromStepRow(step: StepRow): DisplayStep {
  return {
    id: step.id,
    name: step.name,
    status: step.status,
    duration: step.duration,
    subActionsData: step.subActionsData,
    originalStepName: step.originalStepName,
    variableSnapshot: step.variableSnapshot,
    screenshotPath: step.screenshotPath,
    screenshotBeforePath: step.screenshotBeforePath,
    annotationData: step.annotationData,
    observation: step.observation,
    reasoning: step.reasoning,
    plannedAction: step.plannedAction,
    action: step.action,
    error: step.error,
    confidence: step.confidence,
    runId: step.runId,
    stepOrder: step.stepOrder,
    consoleLogs: step.consoleLogs,
    networkLogs: step.networkLogs,
    accessibilityViolations: step.accessibilityViolations,
    screenContextBefore: step.screenContextBefore,
    screenContextAfter: step.screenContextAfter,
    rawRunId: step.runId,
    rawStepOrder: step.stepOrder,
    displayStepOrder: step.stepOrder + 1,
    displayStepTotal: null,
  }
}

export function fromEditorStep(step: EditorStep, index: number): DisplayStep {
  const observe = step.phases.find(p => p.phase === 'observe')
  const plan = step.phases.find(p => p.phase === 'plan')
  const execute = step.phases.find(p => p.phase === 'execute')
  const fallbackSubAction = step.subActionsData?.find((subAction) =>
    Boolean(
      subAction.observation
      || subAction.reasoning
      || subAction.plannedAction != null,
    ),
  )

  return {
    id: step.id,
    name: step.instruction,
    status: normalizeStepStatus(step.status),
    duration: step.duration ?? 0,
    subActionsData: step.subActionsData ?? groupPhasesIntoSubActions(step.phases),
    originalStepName: step.originalStepName,
    variableSnapshot: step.variableSnapshot,
    screenshotPath: null,
    screenshotBeforePath: null,
    annotationData: null,
    observation: observe?.text ?? fallbackSubAction?.observation ?? null,
    reasoning: plan?.text ?? fallbackSubAction?.reasoning ?? null,
    plannedAction: execute?.action ?? fallbackSubAction?.plannedAction ?? null,
    action: execute?.action ?? fallbackSubAction?.plannedAction ?? null,
    error: step.error ?? null,
    confidence: plan?.confidence ?? fallbackSubAction?.confidence ?? null,
    runId: null,
    stepOrder: index,
    consoleLogs: step.consoleLogs,
    networkLogs: step.networkLogs,
    accessibilityViolations: null,
    screenContextBefore: null,
    screenContextAfter: null,
    rawRunId: null,
    rawStepOrder: index,
    displayStepOrder: index + 1,
    displayStepTotal: null,
  }
}

export function withDisplayStepProgress<T extends DisplayStep>(steps: T[]): T[] {
  const total = steps.length
  return steps.map((step, index) => ({
    ...step,
    displayStepOrder: index + 1,
    displayStepTotal: total,
  }))
}

export function groupPhasesIntoSubActions(phases: LivePhase[]): SubActionData[] | null {
  if (phases.length === 0) return null

  const groups: LivePhase[][] = []
  let current: LivePhase[] = []

  for (const phase of phases) {
    if ((phase.phase === 'observe' || phase.phase === 'heal') && current.length > 0) {
      groups.push(current)
      current = []
    }
    current.push(phase)
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, index) => {
    const observe = group.find(p => p.phase === 'observe')
    const plan = group.find(p => p.phase === 'plan')
    const execute = group.find(p => p.phase === 'execute')
    const verify = group.find(p => p.phase === 'verify')

    return {
      index,
      observation: observe?.text ?? '',
      reasoning: plan?.text ?? '',
      plannedAction: execute?.action ?? null,
      result: verify
        ? (verify.success ? 'success' : 'failure')
        : (index === groups.length - 1 ? 'in-progress' : 'failure'),
      error: undefined,
      screenStateBefore: '',
      cached: false,
      confidence: plan?.confidence,
      verifierReasoning: verify?.text,
      phaseDurations: {
        observe: observe?.duration,
        plan: plan?.duration,
        execute: execute?.duration,
        verify: verify?.duration,
      },
    }
  })
}
