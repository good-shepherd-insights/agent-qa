import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'

export class JsonlAuditSink implements AuditSink {
  constructor(private readonly baseDir: string = '.agent-qa') {}

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.append('execution_audit.jsonl', { ts: new Date().toISOString(), ...row })
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.append('guardrail_audit.jsonl', { ts: new Date().toISOString(), ...row })
  }

  private append(file: string, persisted: object): void {
    mkdirSync(this.baseDir, { recursive: true })
    appendFileSync(join(this.baseDir, file), `${JSON.stringify(persisted)}\n`)
  }
}
