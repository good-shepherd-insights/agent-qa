import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import * as surface from '../index'
import { JsonlAuditSink, fingerprint } from '../index'

function tmpAuditDir(): string {
  return mkdtempSync(join(tmpdir(), 'agentqa-audit-'))
}

function readAuditFile(baseDir: string, file: 'execution_audit.jsonl' | 'guardrail_audit.jsonl'): string {
  return readFileSync(join(baseDir, file), 'utf8')
}

describe('JsonlAuditSink', () => {
  it('stores fingerprints without writing matched secrets into raw audit bytes', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)
    const SECRET = 'AKIAIOSFODNN7EXAMPLE'
    const redactedFingerprint = fingerprint(SECRET)

    sink.appendGuardrailAudit({
      channel: 'planner',
      action: 'redact',
      detector: 'aws-access-key',
      redactedFingerprint,
    })
    sink.appendExecutionAudit({
      action: 'delete_resource',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'tier=destructive; no trust credential',
    })

    const guardrailRaw = readAuditFile(baseDir, 'guardrail_audit.jsonl')
    const executionRaw = readAuditFile(baseDir, 'execution_audit.jsonl')

    expect(guardrailRaw).not.toContain(SECRET)
    expect(executionRaw).not.toContain(SECRET)
    expect(guardrailRaw).toContain(redactedFingerprint)
  })

  it('writes timestamped guardrail and execution row shapes', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)

    sink.appendGuardrailAudit({
      channel: 'planner',
      action: 'redact',
      detector: 'email',
      redactedFingerprint: fingerprint('person@example.com'),
    })
    sink.appendExecutionAudit({
      action: 'delete_resource',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'tier=destructive; no trust credential',
    })

    const guardrailRow = JSON.parse(readAuditFile(baseDir, 'guardrail_audit.jsonl').trimEnd()) as Record<string, unknown>
    const executionRaw = readAuditFile(baseDir, 'execution_audit.jsonl')
    const executionRow = JSON.parse(executionRaw.trimEnd()) as Record<string, unknown>

    expect(typeof guardrailRow.ts).toBe('string')
    expect(guardrailRow).toMatchObject({
      channel: 'planner',
      action: 'redact',
      detector: 'email',
    })
    expect(executionRaw).toContain('"verdict":"deny"')
    expect(typeof executionRow.ts).toBe('string')
    expect(executionRow).toMatchObject({
      action: 'delete_resource',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'tier=destructive; no trust credential',
    })
  })

  it('appends one newline-terminated line per guardrail row without truncating', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)

    sink.appendGuardrailAudit({ action: 'pass', channel: 'planner' })
    sink.appendGuardrailAudit({
      action: 'redact',
      channel: 'verifier',
      detector: 'email',
      redactedFingerprint: fingerprint('another-person@example.com'),
    })

    const raw = readAuditFile(baseDir, 'guardrail_audit.jsonl')

    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.trimEnd().split('\n')).toHaveLength(2)
  })

  it('logs pass guardrail rows without detector or fingerprint fields', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)

    sink.appendGuardrailAudit({ action: 'pass' })

    const row = JSON.parse(readAuditFile(baseDir, 'guardrail_audit.jsonl').trimEnd()) as Record<string, unknown>

    expect(row.action).toBe('pass')
    expect(row).not.toHaveProperty('detector')
    expect(row).not.toHaveProperty('redactedFingerprint')
  })

  it('exports only the write-only sink, fingerprint helper, masking scope binding, execution-context detector, and readline confirm adapter', () => {
    expect(Object.keys(surface).sort()).toEqual([
      'JsonlAuditSink',
      'createReadlineConfirm',
      'detectExecutionContext',
      'fingerprint',
      'runMaskingScope',
    ])
  })

  it('keeps small same-file appends parseable on local POSIX filesystems', async () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)
    const appendCount = 32

    // Best-effort local-fs O_APPEND bound; NFS/Windows multi-process semantics are not target guarantees.
    await Promise.all(
      Array.from({ length: appendCount }, (_, index) => Promise.resolve().then(() => {
        sink.appendGuardrailAudit({
          runId: `run-${index}`,
          action: 'pass',
        })
      })),
    )

    const lines = readAuditFile(baseDir, 'guardrail_audit.jsonl').trimEnd().split('\n')
    const rows = lines.map(line => JSON.parse(line) as Record<string, unknown>)

    expect(lines).toHaveLength(appendCount)
    expect(rows).toHaveLength(appendCount)
    expect(rows.every(row => typeof row.ts === 'string' && row.action === 'pass')).toBe(true)
  })
})
