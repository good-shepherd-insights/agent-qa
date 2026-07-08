import { afterEach, describe, expect, it } from 'vitest'

import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import {
  getActiveAuditSink,
  setActiveAuditSinkResolver,
  type AuditSinkResolver,
} from '../audit-sink-resolver'

// The third instance of the shipped active-resolver idiom (D-01), mirroring the
// masking-context resolver tests: default returns undefined (safety is host-API-free;
// the D-03 process-default JsonlAuditSink fallback is installed by safety-local in
// plan 362-02, never here) and the resolver is consulted per call.
class RecordingSink implements AuditSink {
  readonly executionRows: ExecutionAuditRow[] = []
  readonly guardrailRows: GuardrailAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.guardrailRows.push(row)
  }
}

const restoreDefault: AuditSinkResolver = () => undefined

afterEach(() => {
  setActiveAuditSinkResolver(restoreDefault)
})

describe('audit-sink resolver (D-01 third active resolver)', () => {
  it('returns undefined before any resolver is installed', () => {
    expect(getActiveAuditSink()).toBeUndefined()
  })

  it('returns the sink an installed resolver supplies', () => {
    const sink = new RecordingSink()
    setActiveAuditSinkResolver(() => sink)

    expect(getActiveAuditSink()).toBe(sink)
  })

  it('consults the resolver on every call (invocation-time resolution)', () => {
    const first = new RecordingSink()
    const second = new RecordingSink()
    const sinks = [first, second]
    let index = 0
    setActiveAuditSinkResolver(() => sinks[index++])

    expect(getActiveAuditSink()).toBe(first)
    expect(getActiveAuditSink()).toBe(second)
  })
})

describe('ExecutionAuditRow.executionContext (D-13 / SEAM-02 correlation)', () => {
  it('accepts an optional executionContext field that round-trips', () => {
    const row: ExecutionAuditRow = {
      action: 'tool_call',
      riskTier: 'mutating-local',
      verdict: 'allow',
      outcome: 'proceeded',
      reason: 'recognized in-test verb',
      executionContext: 'ci',
    }

    expect(row.executionContext).toBe('ci')
  })
})
