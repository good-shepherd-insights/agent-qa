import type {
  PerTestOutcome,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'

export type SubActionClassification = 'extract' | 'cache-hit'
export type SelectionSkipReason = 'cache-hit' | 'actionless'

export interface SelectionSkip {
  testId: string
  testIndex: number
  stepIndex: number
  decisionOrdinal?: number
  reason: SelectionSkipReason
}

export interface SubActionSelection {
  testId: string
  testIndex: number
  stepIndex: number
  decisionOrdinal: number
  subAction: SubActionEvidence
}

export interface StepSelections {
  selections: SubActionSelection[]
  skips: SelectionSkip[]
}

export interface CollectStepSelectionsInput {
  handoffTest: PerTestOutcome
  step: StepEvidence
}

export function classifySubAction(subAction: SubActionEvidence): SubActionClassification {
  return subAction.exchanges === undefined ? 'cache-hit' : 'extract'
}

export function collectStepSelections({
  handoffTest,
  step,
}: CollectStepSelectionsInput): StepSelections {
  if (step.subActions.length === 0) {
    return {
      selections: [],
      skips: [
        {
          testId: handoffTest.testId,
          testIndex: handoffTest.testIndex,
          stepIndex: step.stepIndex,
          reason: 'actionless',
        },
      ],
    }
  }

  const selections: SubActionSelection[] = []
  const skips: SelectionSkip[] = []

  step.subActions.forEach((subAction, decisionOrdinal) => {
    if (classifySubAction(subAction) === 'extract') {
      selections.push({
        testId: handoffTest.testId,
        testIndex: handoffTest.testIndex,
        stepIndex: step.stepIndex,
        decisionOrdinal,
        subAction,
      })
      return
    }

    skips.push({
      testId: handoffTest.testId,
      testIndex: handoffTest.testIndex,
      stepIndex: step.stepIndex,
      decisionOrdinal,
      reason: 'cache-hit',
    })
  })

  return { selections, skips }
}
