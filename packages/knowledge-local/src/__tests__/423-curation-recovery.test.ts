import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { commitIntentSchema, listCommitIntents, writeCommitIntent } from '../journal/intent-journal.js'

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), '423-curation-recovery-'))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('423 curation effect recovery', () => {
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
