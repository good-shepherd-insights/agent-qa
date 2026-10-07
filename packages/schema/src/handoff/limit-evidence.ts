// The per-step limit evidence (436 D-11..D-13). Type-only DTOs plus their key sets and the one
// reason formatter; the runner records them, readers keep reading whatever shipped.

import type { PlannerLimits } from '../config/planner-limits'

/**
 * The typed limit stop (D-12). Present only when a limit refused the next dispatch of its kind.
 * It is never an application failure, a planning failure, a termination or a verdict.
 */
export interface LimitStopEvidence {
  limit: 'actions' | 'planning-turns'
  configured: number
  used: number
  reason: string
  /** The step's requested outcome as a whole; no model call is made at exhaustion (D-13). */
  requestedOutcome: 'unverified'
  /** The last verifier rejection's reasoning, masked-before-record. */
  lastVerifierRejection?: string
  /** The planner's last stated reasoning, masked-before-record. */
  lastPlannerReasoning?: string
}

/** Inner inputs of one compound action, which count once against the action limit (D-07). */
export interface CompoundInputCount {
  subActionIndex: number
  kind: 'scroll' | 'fill'
  count: number
}

/** What a step execution used against its limits (D-11). */
export interface StepLimitUsage {
  limits: PlannerLimits
  actionsUsed: number
  planningCallsUsed: number
  verifierCalls: number
  judgeCalls: number
  compoundInputs?: CompoundInputCount[]
}

export const LIMIT_STOP_EVIDENCE_KEYS = [
  'limit',
  'configured',
  'used',
  'reason',
  'requestedOutcome',
  'lastVerifierRejection',
  'lastPlannerReasoning',
] as const satisfies readonly (keyof LimitStopEvidence)[]

export const STEP_LIMIT_USAGE_KEYS = [
  'limits',
  'actionsUsed',
  'planningCallsUsed',
  'verifierCalls',
  'judgeCalls',
  'compoundInputs',
] as const satisfies readonly (keyof StepLimitUsage)[]

/** The plain reason a limit stop reads with, e.g. "Stopped: action limit reached — 30 of 30 actions used". */
export function formatLimitStopReason(
  limit: LimitStopEvidence['limit'],
  configured: number,
  used: number,
): string {
  return limit === 'actions'
    ? `Stopped: action limit reached — ${used} of ${configured} actions used`
    : `Stopped: planning-turn limit reached — ${used} of ${configured} planner calls used`
}
