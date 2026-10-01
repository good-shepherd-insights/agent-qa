import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import * as surface from '../index'
import { JsonlAuditSink, fingerprint } from '../index'

// 2026-10-01 (432-19, D-17/D-22). The sink writes GUARDRAIL rows only. `appendExecutionAudit` and the
// `execution_audit.jsonl` path left with the execution gate that produced their rows; the guardrail
// writer, its file, its class name and its export stay, because eval and knowledge egress append
// masking and egress rows through it. An old `execution_audit.jsonl` in a workspace is never read,
// rewritten, renamed or deleted. Every fixture below lives in its own temporary directory.

const LEGACY_EXECUTION_AUDIT = 'execution_audit.jsonl'
const GUARDRAIL_AUDIT = 'guardrail_audit.jsonl'

function tmpAuditDir(): string {
  return mkdtempSync(join(tmpdir(), 'agentqa-audit-'))
}

function readAuditFile(baseDir: string, file: string): string {
  return readFileSync(join(baseDir, file), 'utf8')
}

/** A pre-432 execution-audit trail as an old build left it, planted as literal bytes. */
function plantLegacyExecutionAudit(baseDir: string, body?: string): string {
  const bytes = body ?? [
    '{"ts":"2026-09-01T10:00:00.000Z","action":"delete_resource","riskTier":"destructive","verdict":"deny","outcome":"fail-closed-denied","reason":"tier=destructive; no trust credential"}',
    '{"ts":"2026-09-01T10:00:01.000Z","action":"run:start","riskTier":"mutating-shared","verdict":"allow","outcome":"prompted-approved","reason":"declared tier","trustSource":"tty-prompt"}',
    '',
  ].join('\n')
  writeFileSync(join(baseDir, LEGACY_EXECUTION_AUDIT), bytes)
  return bytes
}

describe('JsonlAuditSink', () => {
  // RE-SPELLED 2026-10-01 (432-19): the execution half of this cell wrote a row through the deleted
  // append; the claim survives on the guardrail row, and the execution trail is not created at all.
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

    const guardrailRaw = readAuditFile(baseDir, GUARDRAIL_AUDIT)

    expect(guardrailRaw).not.toContain(SECRET)
    expect(guardrailRaw).toContain(redactedFingerprint)
    expect(existsSync(join(baseDir, LEGACY_EXECUTION_AUDIT))).toBe(false)
  })

  // RE-SPELLED 2026-10-01 (432-19) from 'writes timestamped guardrail and execution row shapes'.
  it('writes timestamped guardrail row shapes, and no execution row shape exists to write', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)

    sink.appendGuardrailAudit({
      channel: 'planner',
      action: 'redact',
      detector: 'email',
      redactedFingerprint: fingerprint('person@example.com'),
    })

    const guardrailRow = JSON.parse(readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd()) as Record<string, unknown>

    expect(typeof guardrailRow.ts).toBe('string')
    expect(guardrailRow).toMatchObject({
      channel: 'planner',
      action: 'redact',
      detector: 'email',
    })
    expect(Object.getOwnPropertyNames(JsonlAuditSink.prototype).sort()).toEqual([
      'append',
      'appendGuardrailAudit',
      'constructor',
    ])
    expect(readdirSync(baseDir)).toEqual([GUARDRAIL_AUDIT])
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

    const raw = readAuditFile(baseDir, GUARDRAIL_AUDIT)

    expect(raw.endsWith('\n')).toBe(true)
    expect(raw.trimEnd().split('\n')).toHaveLength(2)
  })

  it('logs pass guardrail rows without detector or fingerprint fields', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir)

    sink.appendGuardrailAudit({ action: 'pass' })

    const row = JSON.parse(readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd()) as Record<string, unknown>

    expect(row.action).toBe('pass')
    expect(row).not.toHaveProperty('detector')
    expect(row).not.toHaveProperty('redactedFingerprint')
  })

  // 2026-09-16, 423-46: `ambientMaskingContextResolver` joins the roster. It is the resolver the
  // module's single install site already passed to `setActiveMaskingContextResolver` — naming and
  // exporting it adds no behaviour and no new authority, and it is what lets a caller that forces a
  // masking context put the real one back instead of pinning the process answer to absent.
  // 2026-10-01 (432-19, D-14): the readline confirm adapter leaves the roster with the confirm port.
  it('exports only the write-only sink, fingerprint helper, masking scope binding and its ambient resolver, and execution-context detector', () => {
    expect(Object.keys(surface).sort()).toEqual([
      'JsonlAuditSink',
      'ambientMaskingContextResolver',
      'detectExecutionContext',
      'fingerprint',
      'runSafetyScope',
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

    const lines = readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd().split('\n')
    const rows = lines.map(line => JSON.parse(line) as Record<string, unknown>)

    expect(lines).toHaveLength(appendCount)
    expect(rows).toHaveLength(appendCount)
    expect(rows.every(row => typeof row.ts === 'string' && row.action === 'pass')).toBe(true)
  })
})

describe('C432-GUARDRAIL-AUDIT-RETAINED: guardrail rows are durable', () => {
  // The mutation witness for B16: suppressing the durable append in `appendGuardrailAudit` must RED
  // exactly this cell. It reads the FILE back through a second, independent sink's directory rather
  // than trusting any in-memory echo, so a write that only pretended to land is caught.
  it('C432-GUARDRAIL-AUDIT-RETAINED: a guardrail row lands on disk, survives a new sink and appends across instances', () => {
    const baseDir = tmpAuditDir()
    const first = new JsonlAuditSink(baseDir)
    first.appendGuardrailAudit({ runId: 'run-a', channel: 'prompt', action: 'block', detector: 'aws-access-key' })

    const afterFirst = readAuditFile(baseDir, GUARDRAIL_AUDIT)
    expect(afterFirst.endsWith('\n')).toBe(true)
    expect(JSON.parse(afterFirst.trimEnd())).toMatchObject({
      runId: 'run-a',
      channel: 'prompt',
      action: 'block',
      detector: 'aws-access-key',
    })

    // A second instance over the same directory appends; it never truncates the first row.
    const second = new JsonlAuditSink(baseDir)
    second.appendGuardrailAudit({ runId: 'run-b', action: 'redact', detector: 'bearer' })
    const lines = readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(afterFirst.trimEnd())
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ runId: 'run-b', action: 'redact' })
  })

  it('C432-GUARDRAIL-AUDIT-RETAINED: the directory is created on first append, and a retry appends rather than rewrites', () => {
    const baseDir = join(tmpAuditDir(), 'nested', '.agent-qa')
    const sink = new JsonlAuditSink(baseDir)
    const row = { action: 'pass' as const, channel: 'planner' }
    sink.appendGuardrailAudit(row)
    sink.appendGuardrailAudit(row)
    const parsed = readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(parsed).toHaveLength(2)
    expect(parsed.map(({ ts: _ts, ...rest }) => rest)).toEqual([row, row])
  })
})

describe('C432-AUDIT-UNREAD: a legacy execution-audit trail is never written, read, rewritten or removed', () => {
  it('C432-AUDIT-UNREAD: a planted legacy trail stays byte-identical, with its mtime, across guardrail appends', async () => {
    const baseDir = tmpAuditDir()
    const legacy = plantLegacyExecutionAudit(baseDir)
    const before = statSync(join(baseDir, LEGACY_EXECUTION_AUDIT))

    const sink = new JsonlAuditSink(baseDir)
    sink.appendGuardrailAudit({ action: 'redact', detector: 'bearer', channel: 'prompt' })
    await Promise.all(Array.from({ length: 8 }, (_, index) => Promise.resolve().then(() => {
      sink.appendGuardrailAudit({ action: 'pass', runId: `run-${index}` })
    })))

    expect(readAuditFile(baseDir, LEGACY_EXECUTION_AUDIT)).toBe(legacy)
    const after = statSync(join(baseDir, LEGACY_EXECUTION_AUDIT))
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
    expect(readdirSync(baseDir).sort()).toEqual([LEGACY_EXECUTION_AUDIT, GUARDRAIL_AUDIT].sort())
    // Nothing from the legacy trail leaks into the guardrail trail.
    expect(readAuditFile(baseDir, GUARDRAIL_AUDIT)).not.toContain('prompted-approved')
  })

  it('C432-AUDIT-UNREAD: a damaged or unreadable-as-JSON legacy trail changes nothing about a guardrail append', () => {
    const baseDir = tmpAuditDir()
    const damaged = plantLegacyExecutionAudit(baseDir, '{"ts":"2026-09-01T10:00:00Z","verdict":"deny"\n\u0000\u0001 not json at all\n')
    const sink = new JsonlAuditSink(baseDir)

    expect(() => sink.appendGuardrailAudit({ action: 'pass' })).not.toThrow()
    expect(readAuditFile(baseDir, LEGACY_EXECUTION_AUDIT)).toBe(damaged)
    expect(readAuditFile(baseDir, GUARDRAIL_AUDIT).trimEnd().split('\n')).toHaveLength(1)
  })

  it('C432-AUDIT-UNREAD: a fresh workspace never gets an execution-audit trail, and no append can create one', () => {
    const baseDir = tmpAuditDir()
    const sink = new JsonlAuditSink(baseDir) as unknown as Record<string, unknown>

    expect(sink.appendExecutionAudit).toBeUndefined()
    ;(sink.appendGuardrailAudit as (row: { action: 'pass' }) => void)({ action: 'pass' })
    expect(existsSync(join(baseDir, LEGACY_EXECUTION_AUDIT))).toBe(false)
  })
})
