import type { ContentOrigin, ScanAction } from '@vostride/agent-qa-schema'

// 2026-10-01 (432-19, D-17): the audit contract is the GUARDRAIL contract. The execution-policy row
// and its append method left with the gate that wrote them; nothing produces an execution-audit
// trail any more, and an old one on disk is never read (D-22). Masking and egress rows land here.

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
  appendGuardrailAudit(row: GuardrailAuditRow): void | Promise<void>
}
