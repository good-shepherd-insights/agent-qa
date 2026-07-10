import type {
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type {
  CassetteLabelLeg,
  RecordedFailureContext,
} from '../cassette/label-leg'

export interface ProjectLabelLegInput {
  step: StepEvidence
  subAction: SubActionEvidence
}

export function projectLabelLeg({ step }: ProjectLabelLegInput): CassetteLabelLeg {
  const recordedFailure: RecordedFailureContext = {
    ...(step.verifierVerdict.pass
      ? {}
      : { verifierReasoning: step.verifierVerdict.reasoning }),
    ...(step.planningFailure === undefined
      ? {}
      : { planningFailureReason: step.planningFailure.reason }),
    ...(step.termination === undefined
      ? {}
      : { termination: step.termination.reason }),
  }
  const hasRecordedFailure = Object.keys(recordedFailure).length > 0

  return {
    verdict: step.verifierVerdict,
    sourceChannel: 'recorded-verdict',
    tier: 'silver',
    ...(hasRecordedFailure ? { recordedFailure } : {}),
  }
}
