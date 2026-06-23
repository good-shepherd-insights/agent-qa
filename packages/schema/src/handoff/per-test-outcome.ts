import type { RunStatus } from '../run/run-status'
import type { StepEvidence } from './step-evidence'

export interface PerTestOutcome {
  testId: string
  testIndex: number
  outcome: RunStatus
  steps: StepEvidence[]
}
