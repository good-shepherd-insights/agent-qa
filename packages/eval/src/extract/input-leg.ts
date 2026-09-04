import type {
  PerTestOutcome,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { CassetteInputLeg } from '../cassette/input-leg'

export interface ProjectInputLegInput {
  handoffTest: PerTestOutcome
  step: StepEvidence
  subAction: SubActionEvidence
  testIndex: number
  stepIndex: number
  decisionOrdinal: number
}

export function projectInputLeg({
  handoffTest,
  step,
  subAction,
  testIndex,
  stepIndex,
  decisionOrdinal,
}: ProjectInputLegInput): CassetteInputLeg {
  if (subAction.exchanges === undefined) {
    throw new TypeError('projectInputLeg requires a live decision with recorded exchanges')
  }

  return {
    testId: handoffTest.testId,
    testIndex,
    stepIndex,
    decisionOrdinal,
    stepText: step.stepText,
    stateBefore: subAction.stateBefore,
    servedBrief: step.servedBrief,
    ...(step.workingMemory === undefined ? {} : { workingMemory: step.workingMemory }),
    ...(step.retrievalRung === undefined ? {} : { retrievalRung: step.retrievalRung }),
    exchanges: [...subAction.exchanges],
    ...(step.modelProfile === undefined ? {} : { modelProfile: step.modelProfile }),
    ...(subAction.decisionScreenshotRef === undefined
      ? {}
      : { decisionScreenshotRef: subAction.decisionScreenshotRef }),
    ...(subAction.artifactRefs === undefined
      ? {}
      : { auxiliaryArtifactRefs: [...subAction.artifactRefs] }),
  }
}
