import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { commitIntentSchema, listCommitIntents, writeCommitIntent } from '../journal/intent-journal.js'
import { clearCommitIntent } from '../journal/intent-journal.js'
import { acquireWriterLease } from '../lease/writer-lease.js'
import { writeJobState } from '../queue/job-state.js'
import {
  COMPLETED_EFFECTS_SUBDIR,
  curationEffectReceiptSchema,
  effectIdentity,
  listCurationEffectReceipts,
  writeCurationEffectReceipt,
} from '../journal/curation-effect-receipt.js'

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), '423-curation-recovery-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('423 curation effect recovery', () => {
  function receipt() {
    const effect = { recordId: 'fact-fixture', change: 'added' as const, atOrdinal: 42, evidenceToken: 'synthetic-token', product: 'storefront' }
    const candidateId = 'a'.repeat(64)
    return { schemaVersion: 1 as const, candidateId, effectId: effectIdentity(candidateId, effect), ...effect,
      sourceRunId: 'synthetic-run', observationId: 'synthetic-observation', originalDeltaKind: 'Supersede' as const,
      appliedDeltaKind: 'Add' as const, disposition: 'downgraded' as const, downgradeReason: 'propose-only' }
  }
  function writer(root: string) {
    const lease = acquireWriterLease(root)
    if (lease.kind !== 'acquired') throw new Error('fixture requires fresh lease')
    return { leaseId: lease.leaseId, epoch: lease.epoch }
  }
  it('EFFECT-READ-NOTHING reads absence without creating any directory', () => {
    const root = join(temporaryRoot(), 'absent')
    expect(listCurationEffectReceipts(root)).toEqual([])
    expect(existsSync(root)).toBe(false)
  })
  it('EFFECT-RECEIPT-ROUNDTRIP survives intent and done-state cleanup', () => {
    const root = temporaryRoot()
    const authority = writer(root)
    const row = receipt()
    writeCurationEffectReceipt({ knowledgeRoot: root, authority, auditBaseDir: join(root, 'audit'), receipt: row })
    writeCommitIntent(root, { schemaVersion: 1, candidateId: row.candidateId, bundleId: row.recordId, deltaKind: 'Add', epoch: authority.epoch })
    clearCommitIntent(root, row.candidateId)
    writeJobState({ knowledgeRoot: root, authority, candidateId: row.candidateId, lifecycle: 'done' })
    expect(listCurationEffectReceipts(root)).toEqual([row])
    for (const invalid of [{ ...row, schemaVersion: 9 }, { ...row, unexpected: true }, { ...row, candidateId: '../escape' }, { ...row, effectId: 'f'.repeat(64) }]) {
      expect(curationEffectReceiptSchema.safeParse(invalid).success).toBe(false)
    }
  })
  it('EFFECT-IDEMPOTENT keeps exact bytes and refuses conflicting or malformed receipts', () => {
    const root = temporaryRoot()
    const authority = writer(root)
    const row = receipt()
    const options = { knowledgeRoot: root, authority, auditBaseDir: join(root, 'audit'), receipt: row }
    writeCurationEffectReceipt(options)
    const dir = join(root, COMPLETED_EFFECTS_SUBDIR)
    const file = join(dir, readdirSync(dir)[0]!)
    const before = readFileSync(file)
    writeCurationEffectReceipt(options)
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(dir)).toHaveLength(1)
    expect(() => writeCurationEffectReceipt({ ...options, receipt: { ...row, sourceRunId: 'foreign' } })).toThrow('conflicting')
    writeFileSync(file, '{"schemaVersion":99}')
    expect(() => listCurationEffectReceipts(root)).toThrow('invalid curation effect receipt')
  })
  it('INTENT-HISTORICAL preserves old intents and versioned original disposition', () => {
    const root = temporaryRoot()
    const legacy = { schemaVersion: 1 as const, candidateId: 'a'.repeat(64), bundleId: 'fixture', deltaKind: 'Add' as const, epoch: 1 }
    writeCommitIntent(root, legacy)
    expect(listCommitIntents(root)).toEqual([{ parsed: legacy }])
    expect(commitIntentSchema.safeParse({ ...legacy, schemaVersion: 99 }).success).toBe(false)
    expect(commitIntentSchema.safeParse({ ...legacy, observation: { schemaVersion: 99 } }).success).toBe(false)
    const observation = { schemaVersion: 1, effects: [], originalDeltaKind: 'Supersede', appliedDeltaKind: 'Add', disposition: 'downgraded', downgradeReason: 'propose-only', sourceRunId: 'synthetic-run', observationId: 'synthetic-observation' }
    const parsed = commitIntentSchema.safeParse({ ...legacy, observation })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data).toEqual({ ...legacy, observation })
  })
})
