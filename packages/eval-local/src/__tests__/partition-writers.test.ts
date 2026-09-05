import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  committedFileText,
  projectPartitionManifest,
  projectRunExclusion,
} from '@vostride/agent-qa-eval'
import type { PartitionManifest, RunExclusionRecord } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FsCommittedRootStore,
  committedExclusionPath,
  committedPartitionManifestPath,
} from '../committed-root-store.js'
import {
  SEEDING_EGRESS_CHANNEL,
  writePartitionManifest,
  writeRunExclusion,
} from '../seeding-composition.js'
import type {
  WritePartitionManifestOutcome,
  WriteRunExclusionOutcome,
} from '../seeding-composition.js'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const SALT = 'a3f'.repeat(21).concat('b')
const OTHER_SALT = 'b4e'.repeat(21).concat('c')
const ANALYSIS_DIGEST = '3d'.repeat(32)
const OTHER_DIGEST = '7f'.repeat(32)

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

function manifest(overrides: Partial<PartitionManifest> = {}): PartitionManifest {
  return {
    ...projectPartitionManifest({
      product: 'example-web',
      saltHex: SALT,
      heldOutFraction: 0.2,
      privateFraction: 0.5,
    }),
    ...overrides,
  }
}

function exclusion(
  overrides: Partial<Parameters<typeof projectRunExclusion>[0]> = {},
): RunExclusionRecord {
  return projectRunExclusion({
    runId: 'r_x',
    runSlug: 'r_x',
    product: 'automation-exercise',
    verdicts: [{ class: 'flake', producer: 'analyze-run' }],
    analysisDigest: ANALYSIS_DIGEST,
    ...overrides,
  })
}

describe('writePartitionManifest / writeRunExclusion (414 D-02/D-05/D-06, ROOT-07/ROOT-08)', () => {
  let root: string
  let outDir: string

  function writeManifest(value: PartitionManifest): WritePartitionManifestOutcome {
    return writePartitionManifest({
      manifest: value,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
      policy,
    })
  }

  function writeExclusion(record: RunExclusionRecord): WriteRunExclusionOutcome {
    return writeRunExclusion({
      record,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
      policy,
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-partition-writers-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-partition-writers-out-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('writes the manifest once; disagreeing flags are a write-conflict, not an overwrite (D-05)', () => {
    const base = manifest()
    const relPath = committedPartitionManifestPath(base.product)
    expect(relPath).toBe('contracts/partition-example-web.json')

    expect(writeManifest(base)).toEqual({ kind: 'written', path: relPath })
    expect(readFileSync(join(root, relPath), 'utf8')).toBe(committedFileText(base))

    // Identical regen is an idempotent no-op (371 D-17).
    expect(writeManifest(base)).toEqual({ kind: 'unchanged', path: relPath })

    // The D-05 refusal: a second manifest for the same product whose flags
    // disagree re-partitions a committed corpus, so it is refused and the
    // committed bytes are untouched. Changing them is a named migration.
    const committed = readFileSync(join(root, relPath))
    expect(writeManifest(manifest({ heldOutFraction: 0.3 }))).toEqual({
      kind: 'write-conflict',
      path: relPath,
    })
    expect(writeManifest(manifest({ salt: OTHER_SALT }))).toEqual({
      kind: 'write-conflict',
      path: relPath,
    })
    expect(readFileSync(join(root, relPath)).equals(committed)).toBe(true)
  })

  it('writes the exclusion once at exclusions/<product>/<runSlug>.json (D-02)', () => {
    const record = exclusion()
    const relPath = committedExclusionPath(record.product, record.runSlug)
    expect(relPath).toBe('exclusions/automation-exercise/r_x.json')

    expect(writeExclusion(record)).toEqual({ kind: 'written', path: relPath })
    expect(readFileSync(join(root, relPath), 'utf8')).toBe(committedFileText(record))
    expect(writeExclusion(record)).toEqual({ kind: 'unchanged', path: relPath })

    const committed = readFileSync(join(root, relPath))
    expect(
      writeExclusion(exclusion({ verdicts: [{ class: 'timeout', producer: 'analyze-run' }] })),
    ).toEqual({ kind: 'write-conflict', path: relPath })
    expect(writeExclusion(exclusion({ analysisDigest: OTHER_DIGEST }))).toEqual({
      kind: 'write-conflict',
      path: relPath,
    })
    expect(readFileSync(join(root, relPath)).equals(committed)).toBe(true)
  })

  it('compares the exclusion CORE, so a backfill block never looks like a new decision (D-02)', () => {
    const record = exclusion()
    const relPath = committedExclusionPath(record.product, record.runSlug)
    const backfilled = exclusion({
      backfill: { entriesRemoved: 2, recordedBy: 'growth-campaign-414' },
    })

    // Committed WITHOUT backfill, re-excluded WITH one: same decision.
    writeExclusion(record)
    const withoutBackfill = readFileSync(join(root, relPath))
    expect(writeExclusion(backfilled)).toEqual({ kind: 'unchanged', path: relPath })
    expect(readFileSync(join(root, relPath)).equals(withoutBackfill)).toBe(true)

    // And the mirror: committed WITH a backfill, re-excluded WITHOUT one.
    const mirrorRoot = new FsCommittedRootStore({ committedRoot: root })
    const mirrorPath = committedExclusionPath('example-web', 'r_y')
    const mirrorRecord = exclusion({
      runId: 'r_y',
      runSlug: 'r_y',
      product: 'example-web',
      backfill: { deletionCommit: 'abc1234', entriesRemoved: 1, recordedBy: 'operator' },
    })
    mirrorRoot.writeText(mirrorPath, committedFileText(mirrorRecord))
    const withBackfill = readFileSync(join(root, mirrorPath))

    expect(
      writeExclusion(exclusion({ runId: 'r_y', runSlug: 'r_y', product: 'example-web' })),
    ).toEqual({ kind: 'unchanged', path: mirrorPath })
    expect(readFileSync(join(root, mirrorPath)).equals(withBackfill)).toBe(true)
  })

  it('blocks secret-shaped bytes at the eval-seeding checkpoint — audited, nothing lands', async () => {
    const leakyExclusion = exclusion({ runSlug: AWS_KEY })
    const exclusionLabel = `exclusion:${leakyExclusion.product}/${leakyExclusion.runSlug}`

    expect(writeExclusion(leakyExclusion)).toEqual({
      kind: 'egress-blocked',
      detections: [{ label: exclusionLabel, detector: 'awsKey' }],
    })
    expect(
      existsSync(join(root, committedExclusionPath(leakyExclusion.product, leakyExclusion.runSlug))),
    ).toBe(false)

    const leakyManifest = manifest({ product: `example-web-${AWS_KEY}` })
    expect(writeManifest(leakyManifest)).toEqual({
      kind: 'egress-blocked',
      detections: [{ label: `partition-manifest:${leakyManifest.product}`, detector: 'awsKey' }],
    })
    expect(existsSync(join(root, committedPartitionManifestPath(leakyManifest.product)))).toBe(false)

    const rows = (await readFile(join(outDir, 'guardrail_audit.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { channel: string; detector: string; action: string })
    for (const label of [exclusionLabel, `partition-manifest:${leakyManifest.product}`]) {
      expect(
        rows.some(
          (row) =>
            row.channel === `${SEEDING_EGRESS_CHANNEL}:${label}` &&
            row.detector === 'awsKey' &&
            row.action === 'block',
        ),
      ).toBe(true)
    }
    // The seeding channel, never the report channel — one audit trail per surface.
    expect(rows.every((row) => row.channel.startsWith(`${SEEDING_EGRESS_CHANNEL}:`))).toBe(true)
  })
})
