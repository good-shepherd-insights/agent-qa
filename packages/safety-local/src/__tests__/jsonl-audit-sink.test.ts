import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { JsonlAuditSink } from '../index'

describe('JsonlAuditSink', () => {
  it('writes a timestamped execution audit line to the configured base dir', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agentqa-audit-'))
    const sink = new JsonlAuditSink(baseDir)

    sink.appendExecutionAudit({
      action: 'delete_resource',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'tier=destructive; no trust credential',
    })

    const raw = readFileSync(join(baseDir, 'execution_audit.jsonl'), 'utf8')
    const lines = raw.trimEnd().split('\n')
    const row = JSON.parse(lines[0]) as Record<string, unknown>

    expect(lines).toHaveLength(1)
    expect(typeof row.ts).toBe('string')
    expect(row).toMatchObject({
      action: 'delete_resource',
      riskTier: 'destructive',
      verdict: 'deny',
      outcome: 'fail-closed-denied',
      reason: 'tier=destructive; no trust credential',
    })
  })
})
