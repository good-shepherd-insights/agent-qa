// 414 Task 2 — the two committed documents the seed verb writes (D-02, D-05,
// D-06, D-07).
//
// Both are hand-editable committed JSON that enters eval core, so both are
// gated by a STRICT zod guard rather than by a cast. The manifest guard is
// what stops a variable-length or operator-shaped salt from reaching
// `assignSplit` (a fixed 64-hex salt is what makes salt-concat-id injective),
// and the exclusion guard is what stops a verdict class or producer outside
// the two committed vocabularies from becoming a membership decision.
//
// Test 7 is the one-spelling cell: the census imports the two vocabularies
// from here instead of keeping its own copies.
import { describe, expect, it } from 'vitest'

import { PARTITION_VERSION } from '../split-assignment'
import {
  PARTITION_MANIFEST_SCHEMA_VERSION,
  guardPartitionManifest,
  partitionParamsOf,
  projectPartitionManifest,
  type PartitionManifest,
} from '../partition-manifest'
import {
  EXCLUSION_CLASSES,
  RUN_EXCLUSION_SCHEMA_VERSION,
  VERDICT_PRODUCERS,
  guardRunExclusionRecord,
  projectRunExclusion,
  runExclusionCore,
  type RunExclusionRecord,
} from '../run-exclusion'

const SALT = 'a3f'.repeat(21).concat('b')
const ANALYSIS_DIGEST = '3d579e78'.padEnd(64, '0')

function manifestBytes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: PARTITION_MANIFEST_SCHEMA_VERSION,
    partitionVersion: PARTITION_VERSION,
    product: 'example-web',
    salt: SALT,
    heldOutFraction: 0.2,
    privateFraction: 0.5,
    ...overrides,
  }
}

function exclusionBytes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: RUN_EXCLUSION_SCHEMA_VERSION,
    runId: 'r_swiper-tele-modern-modal',
    runSlug: 'r_swiper-tele-modern-modal',
    product: 'example-web',
    verdicts: [{ class: 'flake', producer: 'analyze-run' }],
    analysisDigest: ANALYSIS_DIGEST,
    reason: 'excluded-verdict-class',
    ...overrides,
  }
}

describe('partitionManifest', () => {
  it('admits a well-formed manifest and projects its partition params', () => {
    expect(SALT).toHaveLength(64)

    const bytes = manifestBytes()
    const manifest = guardPartitionManifest(bytes)
    expect(manifest).toEqual(bytes)

    expect(partitionParamsOf(manifest)).toEqual({
      saltHex: SALT,
      heldOutFraction: 0.2,
      privateFraction: 0.5,
    })
  })

  it('refuses a salt that is not exactly 64 lowercase hex, and any fraction outside (0, 1)', () => {
    const badSalts = [
      SALT.slice(1), // 63
      `${SALT}a`, // 65
      SALT.toUpperCase(), // uppercase hex
      `g${SALT.slice(1)}`, // not hex
      '',
    ]
    for (const salt of badSalts) {
      expect(() => guardPartitionManifest(manifestBytes({ salt })), salt).toThrow(TypeError)
    }

    // The endpoints are OUT: a partition that holds out nothing, or
    // everything, is not a partition (D-07).
    for (const heldOutFraction of [0, 1, 1.2, -0.1]) {
      expect(() =>
        guardPartitionManifest(manifestBytes({ heldOutFraction })),
        String(heldOutFraction),
      ).toThrow(TypeError)
    }
    for (const privateFraction of [0, 1]) {
      expect(() =>
        guardPartitionManifest(manifestBytes({ privateFraction })),
        String(privateFraction),
      ).toThrow(TypeError)
    }

    // A partition recipe change is a named migration, never a silent re-read.
    expect(() => guardPartitionManifest(manifestBytes({ partitionVersion: 2 }))).toThrow(TypeError)
    expect(() => guardPartitionManifest(manifestBytes({ schemaVersion: 2 }))).toThrow(TypeError)
    expect(() => guardPartitionManifest(manifestBytes({ product: '' }))).toThrow(TypeError)
    expect(() => guardPartitionManifest(manifestBytes({ note: 'extra' }))).toThrow(TypeError)
  })

  it('projects a manifest from its four inputs and guards the result before returning it', () => {
    expect(
      projectPartitionManifest({
        product: 'example-web',
        saltHex: SALT,
        heldOutFraction: 0.2,
        privateFraction: 0.5,
      }),
    ).toEqual({
      schemaVersion: PARTITION_MANIFEST_SCHEMA_VERSION,
      partitionVersion: PARTITION_VERSION,
      product: 'example-web',
      salt: SALT,
      heldOutFraction: 0.2,
      privateFraction: 0.5,
    })

    // The projection is guard-checked, so a bad input cannot become bytes.
    expect(() =>
      projectPartitionManifest({
        product: 'example-web',
        saltHex: SALT,
        heldOutFraction: 1,
        privateFraction: 0.5,
      }),
    ).toThrow(TypeError)
    expect(() =>
      projectPartitionManifest({
        product: 'example-web',
        saltHex: 'not-a-salt',
        heldOutFraction: 0.2,
        privateFraction: 0.5,
      }),
    ).toThrow(TypeError)
  })
})

describe('runExclusionRecord', () => {
  it('admits an exclusion with, without, and with a partial backfill block', () => {
    const withoutBackfill = guardRunExclusionRecord(exclusionBytes())
    expect(withoutBackfill.backfill).toBeUndefined()

    const full = guardRunExclusionRecord(
      exclusionBytes({
        backfill: {
          deletionCommit: '0a2b6f87',
          entriesRemoved: 4,
          recordedBy: '414 D-02 backfill',
        },
      }),
    )
    expect(full.backfill?.entriesRemoved).toBe(4)

    // A backfill that removed nothing and has no deletion commit is still a
    // recorded backfill — the honest answer, not an omission.
    const noDeletion = guardRunExclusionRecord(
      exclusionBytes({ backfill: { entriesRemoved: 0, recordedBy: '414 D-02 backfill' } }),
    )
    expect(noDeletion.backfill).toEqual({ entriesRemoved: 0, recordedBy: '414 D-02 backfill' })

    // The projection stamps the version and the reason; the caller supplies
    // the facts, and `backfill` only appears when it was actually given.
    expect(
      projectRunExclusion({
        runId: 'r_swiper-tele-modern-modal',
        runSlug: 'r_swiper-tele-modern-modal',
        product: 'example-web',
        verdicts: [{ class: 'flake', producer: 'analyze-run' }],
        analysisDigest: ANALYSIS_DIGEST,
      }),
    ).toEqual(withoutBackfill)
    expect(
      projectRunExclusion({
        runId: 'r_swiper-tele-modern-modal',
        runSlug: 'r_swiper-tele-modern-modal',
        product: 'example-web',
        verdicts: [{ class: 'flake', producer: 'analyze-run' }],
        analysisDigest: ANALYSIS_DIGEST,
        backfill: {
          deletionCommit: '0a2b6f87',
          entriesRemoved: 4,
          recordedBy: '414 D-02 backfill',
        },
      }),
    ).toEqual(full)
  })

  it('refuses a class, producer, digest, reason or shape outside the committed vocabulary', () => {
    // `app_bug` is a real verdict class — it is not an EXCLUSION class.
    const refusals = [
      exclusionBytes({ verdicts: [{ class: 'app_bug', producer: 'analyze-run' }] }),
      exclusionBytes({ verdicts: [{ class: 'flake', producer: 'human' }] }),
      exclusionBytes({ analysisDigest: ANALYSIS_DIGEST.slice(1) }),
      exclusionBytes({ reason: 'other' }),
      // An exclusion with no excluding verdict is not an exclusion.
      exclusionBytes({ verdicts: [] }),
      exclusionBytes({ note: 'extra' }),
    ]
    for (const bytes of refusals) {
      expect(() => guardRunExclusionRecord(bytes), JSON.stringify(bytes)).toThrow(TypeError)
    }
  })

  it('reduces to the same core with and without a backfill — the write-once identity', () => {
    const withBackfill = guardRunExclusionRecord(
      exclusionBytes({
        backfill: { deletionCommit: '0a2b6f87', entriesRemoved: 4, recordedBy: 'x' },
      }),
    )
    const withoutBackfill = guardRunExclusionRecord(exclusionBytes())

    expect(runExclusionCore(withBackfill)).toEqual(runExclusionCore(withoutBackfill))
    expect(runExclusionCore(withBackfill)).not.toHaveProperty('backfill')
  })

  it('is the ONE spelling of the two verdict vocabularies', () => {
    expect(EXCLUSION_CLASSES).toEqual(['environment', 'flake', 'timeout'])
    expect(VERDICT_PRODUCERS).toEqual(['analyze-run', 'deterministic-classifier'])

    // Every member admits through the guard, so the arrays and the schema
    // cannot drift apart.
    for (const exclusionClass of EXCLUSION_CLASSES) {
      for (const producer of VERDICT_PRODUCERS) {
        const record: RunExclusionRecord = guardRunExclusionRecord(
          exclusionBytes({ verdicts: [{ class: exclusionClass, producer }] }),
        )
        expect(record.verdicts[0]).toEqual({ class: exclusionClass, producer })
      }
    }
  })
})

describe('the two documents together', () => {
  it('carry independent version gates', () => {
    const manifest: PartitionManifest = guardPartitionManifest(manifestBytes())
    expect(manifest.schemaVersion).toBe(PARTITION_MANIFEST_SCHEMA_VERSION)
    expect(manifest.partitionVersion).toBe(PARTITION_VERSION)
    expect(RUN_EXCLUSION_SCHEMA_VERSION).toBe(1)
  })
})
