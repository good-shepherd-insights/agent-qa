import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { AuditSink, GuardrailAuditRow } from '@vostride/agent-qa-safety'

// 2026-10-01 (432-19, D-17): the sink writes guardrail rows only. The execution-audit trail has no
// writer; an old one in a workspace is left on disk and never read (D-22).
export class JsonlAuditSink implements AuditSink {
  constructor(private readonly baseDir: string = '.agent-qa') {}

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.append('guardrail_audit.jsonl', { ts: new Date().toISOString(), ...row })
  }

  private append(file: string, persisted: object): void {
    mkdirSync(this.baseDir, { recursive: true })
    appendFileSync(join(this.baseDir, file), `${JSON.stringify(persisted)}\n`)
  }
}
