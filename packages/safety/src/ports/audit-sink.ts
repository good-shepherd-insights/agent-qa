import type { PolicyVerdict, RiskTier, ScanAction } from '@vostride/agent-qa-schema'

export interface ExecutionAuditRow {
  runId?: string
  actionId?: string
  riskTier: RiskTier
  verdict: PolicyVerdict
  reason: string
}

export interface GuardrailAuditRow {
  runId?: string
  channel?: string
  action: ScanAction
  detector?: string
  redactedFingerprint?: string
}

export interface AuditSink {
  appendExecutionAudit(row: ExecutionAuditRow): void | Promise<void>
  appendGuardrailAudit(row: GuardrailAuditRow): void | Promise<void>
}
