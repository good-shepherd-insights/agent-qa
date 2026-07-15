import type {
  ContentOrigin,
  ExecutionContext,
  PolicyVerdict,
  RiskTier,
  ScanAction,
} from '@vostride/agent-qa-schema'

export interface ExecutionAuditRow {
  runId?: string
  actionId?: string
  /**
   * Coded execution context the decision resolved under
   * (local-interactive, local-headless, ci, or cloud). Additive SEAM-02
   * correlation (D-13): the run stamps it so gate rows are self-describing.
   */
  executionContext?: ExecutionContext
  /**
   * Secret-free coded action value, e.g. tool_call or delete_resource.
   */
  action: string
  riskTier: RiskTier
  verdict: PolicyVerdict
  /**
   * Secret-free coded outcome value:
   * proceeded, prompted-approved, prompted-denied, fail-closed-denied, or blocked.
   */
  outcome: string
  reason: string
  /**
   * Trust source that satisfied an ask:
   * session-trust-mode, trust-credential, standing-approval, or tty-prompt.
   * Omitted for allow, deny, and fail-closed outcomes.
   */
  trustSource?: string
}

export interface GuardrailAuditRow {
  runId?: string
  channel?: string
  /** Route is a reported soft-review signal, never a ScanResult verdict. */
  action: ScanAction | 'route'
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
