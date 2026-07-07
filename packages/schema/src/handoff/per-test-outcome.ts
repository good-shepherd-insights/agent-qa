import type { MemberTestOutcome } from '../run/member-outcome'
import type { StepEvidence } from './step-evidence'

export interface PerTestOutcome {
  testId: string
  testIndex: number
  outcome: MemberTestOutcome
  steps: StepEvidence[]
}
