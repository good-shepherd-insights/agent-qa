import { afterEach, describe, expect, it } from 'vitest'

import type { AuditSink, GuardrailAuditRow } from '../../ports/audit-sink'
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
  readonly guardrailRows: GuardrailAuditRow[] = []

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

// RE-SPELLED 2026-10-01 (432-19, D-17) from 'ExecutionAuditRow.executionContext (D-13 / SEAM-02
// correlation)'. The execution-audit row is deleted with the gate that wrote it, so the resolver
// hands out a GUARDRAIL sink: the only row it can carry is a guardrail row, and the run's context
// stays on the handoff, events and run DTOs rather than on an audit row.
describe('C432-AUDIT-UNREAD: the resolved sink is a guardrail sink', () => {
  it('C432-AUDIT-UNREAD: a resolved sink receives guardrail rows and has no execution-audit append', () => {
    const sink = new RecordingSink()
    setActiveAuditSinkResolver(() => sink)

    const resolved = getActiveAuditSink()
    resolved?.appendGuardrailAudit({ action: 'redact', detector: 'bearer', channel: 'prompt' })

    expect(sink.guardrailRows).toEqual([{ action: 'redact', detector: 'bearer', channel: 'prompt' }])
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(sink)).sort()).toEqual([
      'appendGuardrailAudit',
      'constructor',
    ])
    expect('appendExecutionAudit' in (resolved ?? {})).toBe(false)
  })
})
