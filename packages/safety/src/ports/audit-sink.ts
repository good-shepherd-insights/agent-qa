import type { PolicyVerdict, RiskTier, ScanAction } from '@vostride/agent-qa-schema'

export interface ExecutionAuditInput {
  action: string
  riskTier: RiskTier
  verdict: PolicyVerdict
  outcome: string
  reason: string
  trustSource?: string
}

export interface GuardrailAuditInput {
  path: string
  detector: string
  action: ScanAction
  redactedFingerprint?: string
}

export interface AuditSink {
  appendExecutionAudit(row: ExecutionAuditInput): void | Promise<void>
  appendGuardrailAudit(row: GuardrailAuditInput): void | Promise<void>
}
