import type { Action } from '../action/index'
import type { ServedBrief } from '../brief/served-brief'
import type { RecordedActionResult } from '../result/index'
import type { SubActionEvidence } from './sub-action-evidence'

export interface VerifierVerdict {
  pass: boolean
  reasoning: string
}

export interface Decision {
  plan: string
  plannedAction: Action
  result: RecordedActionResult
}

export interface StepEvidence {
  stepIndex: number
  stepText: string
  cacheStatus: 'hit' | 'miss' | 'bypass'
  servedBrief: ServedBrief
  subActions: SubActionEvidence[]
  verifierVerdict: VerifierVerdict
  selfHeal?: {
    failedDecision: Decision
    recoveringDecision: Decision
  }
}
