// RED scaffold (Wave 0, Phase 358 · WM-02 · D-13 · Pattern 7 · Open Q2 · Pitfall 5). Pins the
// run-end redacted flush BEFORE Plan 07 lands it. The flush composes the already-shipped
// mask() + assertCommittedEgressSafe committed-egress checkpoint (Phase 347) into a JSON
// artifact — the first LIVE composition of that checkpoint (discharges MASK-FUT-02). Open Q2
// disposition: a blocked entry's value is replaced by a `[blocked:<detector>:<fingerprint>]`
// placeholder — the artifact ALWAYS exists, no secret ever lands, the run exit code is
// untouched (Pitfall 5: never throws out of the flush).
//
// RED BY DESIGN: `../wm-flush` does not exist until Plan 07 — the unresolved import IS the
// intended failure. Pinned API:
//   flushWorkingMemory(store, { artifactsDir, mask, policy, auditSink? })
//     → Promise<{ path, entriesWritten, blocked }>  (store.dispose() called after write)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadGuardrailPolicy, defaultGuardrailPolicyInput } from '@vostride/agent-qa-safety'
import type { GuardrailAuditRow } from '@vostride/agent-qa-safety'
// Plan-07 flush helper — intentionally unresolved today (the RED reason for this suite):
import { flushWorkingMemory } from '../wm-flush.js'

const TMP_DIR = join(tmpdir(), 'agent-qa-wm-flush-test-' + process.pid)
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBg\n-----END PRIVATE KEY-----'

interface Entry { key: string; value: string; kind: string; provenance: string }

function fakeStore(entries: Entry[]) {
  let disposed = false
  return {
    entries: () => entries,
    dispose: () => { disposed = true },
    get disposed() { return disposed },
  }
}

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true })
})
afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true })
})

describe('flushWorkingMemory — happy path (D-13)', () => {
  it('writes a JSON artifact with masked values + kind/provenance, then disposes the store', async () => {
    const store = fakeStore([
      { key: 'otp', value: '4821', kind: 'extracted-value', provenance: 'observation' },
      { key: 'file', value: 'report.pdf', kind: 'filename', provenance: 'observation' },
    ])
    const result = await flushWorkingMemory(store, { artifactsDir: TMP_DIR, mask: (v: string) => `MASKED(${v})`, policy })

    const written = JSON.parse(await readFile(result.path, 'utf8')) as { entries: Entry[] }
    expect(written.entries).toHaveLength(2)
    const otp = written.entries.find((e) => e.key === 'otp')
    expect(otp?.value).toBe('MASKED(4821)') // masked, never verbatim
    expect(otp?.kind).toBe('extracted-value')
    expect(otp?.provenance).toBe('observation')
    expect(store.disposed).toBe(true)
    expect(result.entriesWritten).toBe(2)
  })
})

describe('flushWorkingMemory — guardrail composition + blocked-entry placeholder (Open Q2)', () => {
  it('invokes assertCommittedEgressSafe on channel working-memory-flush and fingerprints a blocked entry', async () => {
    const auditRows: GuardrailAuditRow[] = []
    const store = fakeStore([
      { key: 'safe', value: 'ordinary note', kind: 'progress-marker', provenance: 'plannerInference' },
      { key: 'leak', value: PEM, kind: 'extracted-value', provenance: 'toolResult' }, // trips pemKey (block)
    ])
    // Identity mask so the PEM reaches the block-class detector deterministically.
    const result = await flushWorkingMemory(store, {
      artifactsDir: TMP_DIR,
      mask: (v: string) => v,
      policy,
      auditSink: { appendGuardrailAudit: (row: GuardrailAuditRow) => { auditRows.push(row) }, appendExecutionAudit: () => {} },
    })

    const raw = await readFile(result.path, 'utf8')
    const written = JSON.parse(raw) as { entries: Entry[] }
    const leak = written.entries.find((e) => e.key === 'leak')
    // The raw private key never lands anywhere in the artifact.
    expect(raw).not.toContain('BEGIN PRIVATE KEY')
    // The blocked entry's value is a fingerprinted placeholder naming the detector.
    expect(leak?.value).toMatch(/^\[blocked:pemKey:/)
    expect(result.blocked.some((b: { detector: string }) => b.detector === 'pemKey')).toBe(true)
    // The checkpoint was composed on the WM channel and its audit rows were preserved.
    expect(auditRows.some((r) => r.channel?.includes('working-memory-flush'))).toBe(true)
  })
})

describe('flushWorkingMemory — never throws (Pitfall 5)', () => {
  it('resolves best-effort with the artifact when an entry is blocked (exit code untouched)', async () => {
    const store = fakeStore([{ key: 'leak', value: PEM, kind: 'extracted-value', provenance: 'toolResult' }])
    await expect(
      flushWorkingMemory(store, { artifactsDir: TMP_DIR, mask: (v: string) => v, policy }),
    ).resolves.toMatchObject({ entriesWritten: 1 })
    expect(store.disposed).toBe(true)
  })
})
