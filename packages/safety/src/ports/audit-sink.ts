import type { ContentOrigin, PolicyVerdict, RiskTier, ScanAction } from '@vostride/agent-qa-schema'

export interface ExecutionAuditRow {
  runId?: string
  actionId?: string
  /**
   * Secret-free coded action value, e.g. tool_call or delete_resource.
   */
  action: string
  riskTier: RiskTier
  verdict: PolicyVerdict
  /**
   * Secret-free coded outcome value, e.g. proceeded, blocked, prompted-then-approved, or fail-closed-denied.
   */
  outcome: string
  reason: string
  trustSource?: string
}

export interface GuardrailAuditRow {
  runId?: string
  channel?: string
  action: ScanAction
  detector?: string
  redactedFingerprint?: string
  overridden?: boolean
  origin?: ContentOrigin
  reason?: string
}

export interface AuditSink {
  appendExecutionAudit(row: ExecutionAuditRow): void | Promise<void>
  appendGuardrailAudit(row: GuardrailAuditRow): void | Promise<void>
}
