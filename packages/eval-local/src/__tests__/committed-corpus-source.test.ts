import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildEvalReport,
  buildSeedingPlan,
  committedFileText,
  extractRunCassettes,
  projectPartitionManifest,
  projectRunExclusion,
} from '@vostride/agent-qa-eval'
import type {
  ArtifactSource,
  ExtractedCassette,
  PartitionManifest,
  RunExclusionRecord,
  SeedingPlan,
} from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { asRef } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Decision, SubActionEvidence } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BLOBS_SUBDIR } from '../cassette-store.js'
import {
  COMMITTED_EXCLUSIONS_DIR,
  COMMITTED_REPORTS_DIR,
  COMMITTED_ROOT_MARKER_FILE,
  buildRootMarkerValue,
  committedCorpusPath,
  committedExclusionPath,
  committedPartitionManifestPath,
  committedReportPath,
} from '../committed-root-store.js'
import {
  listBaselinePointers,
  listCommittedReports,
  readCommittedCorpus,
  readPartitionManifests,
  readRunExclusions,
} from '../committed-corpus-source.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const PRODUCT = 'default'
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

/**
 * The 414-05 shared partition vector — the same salt and fractions this file,
 * `seeding-composition.test.ts` and `committed-root-proof.test.ts` now pass to
 * `buildSeedingPlan` (Plan 01 replaced the old `handoffPath` input with
 * `partition` DATA). The salt is 64 lowercase hex as the manifest guard
 * requires; `heldOutFraction` sits ABOVE the fixture silver leaf's bucket
 * fraction (0.9173881600032967 under this salt) so the seeded root carries a
 * held-out entry and the v2 read leg is exercised on a non-natural arm, while
 * `privateFraction` sits below it so that entry is held-out SHARED.
 */
const TEST_PARTITION = {
  saltHex: 'a3f'.repeat(21).concat('b'),
  heldOutFraction: 0.95,
  privateFraction: 0.5,
} as const

/** Plan 01's committed v1 bytes, read rather than duplicated (414-01 decision). */
const V1_FIXTURE_PATH = fileURLToPath(
  new URL('../../../eval/src/labels/__tests__/fixtures/v1-corpus-entry.json', import.meta.url),
)

const V1_PRODUCT = 'google-maps'

/** A v2 PRIVATE held-out entry — the arm the pre-414 local zod could not admit. */
const V2_PRIVATE_ENTRY = {
  schemaVersion: 2,
  cassetteId: 'r_probe-run-for-the-read-leg/test-00-step-00-d00-leaf',
  product: V1_PRODUCT,
  split: 'held-out',
  heldOutVisibility: 'private',
  captured_at_ordinal: 3,
  run_links: { runId: 'r_probe-run-for-the-read-leg', runSlug: 'r_probe-run-for-the-read-leg' },
  receiptDigest: '9c'.repeat(32),
} as const

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([[LOCAL_FIXTURE_BLOB_SHA, LOCAL_FIXTURE_BLOB_BYTES]])
  return { getBlob: (sha) => entries.get(sha) }
}

function decisionFor(subAction: SubActionEvidence): Decision {
  return {
    plan: subAction.plan,
    plannedAction: structuredClone(subAction.plannedAction),
    result: structuredClone(subAction.result),
  }
}

/**
 * The seeding-composition fixture verbatim: test 0 seeds one silver case and test 1 a resolvable
 * self-heal pair, so the root carries THREE cases — enough for the malformed-bytes cell to prove
 * that well-formed siblings still load. Timestamps are Luhn-proofed the same way.
 */
function sourceHandoff(): CompletedRunHandoff {
  const handoff = makeLocalV2Handoff()
  for (const test of handoff.tests) {
    for (const step of test.steps) {
      for (const subAction of step.subActions) {
        subAction.stateBefore = { ...subAction.stateBefore, timestamp: 1_725_000_000 }
      }
    }
  }
  const silverTest = handoff.tests[0]!
  const pairTest = structuredClone(silverTest)
  pairTest.testId = 'eval-local::self-heal'
  pairTest.testIndex = 1
  pairTest.steps = [structuredClone(silverTest.steps[0]!)]
  const step = pairTest.steps[0]!
  const failedSub = step.subActions[0]!
  const continueRef2 = asRef('e-continue-2')
  const primaryElement = failedSub.stateBefore.elements[0]!
  failedSub.stateBefore.elements = [
    primaryElement,
    {
      ...structuredClone(primaryElement),
      ref: continueRef2,
      name: 'Continue again',
      nameNormalized: 'continue again',
      labels: { ariaLabel: 'Continue again' },
    },
  ]
  failedSub.stateBefore.refMap = {
    ...failedSub.stateBefore.refMap,
    [continueRef2]: structuredClone(failedSub.stateBefore.refMap[primaryElement.ref]!),
  }
  const recoveringSub = structuredClone(failedSub)
  recoveringSub.plannedAction = { type: 'click', ref: continueRef2 }
  step.subActions = [failedSub, recoveringSub]
  step.selfHeal = {
    failedDecision: decisionFor(failedSub),
    recoveringDecision: decisionFor(recoveringSub),
  }
  handoff.tests = [silverTest, pairTest]
  return handoff
}

function extract(handoff: CompletedRunHandoff): ExtractedCassette[] {
  return extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
}

function planFor(
  handoff: CompletedRunHandoff,
  cassettes: readonly ExtractedCassette[],
): SeedingPlan {
  return buildSeedingPlan({ handoff, cassettes, partition: TEST_PARTITION })
}

/** A bare committed root: the dir plus the D-15 schemaVersion marker, nothing else. */
function markedRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eval-local-read-leg-root-'))
  writeFileSync(
    join(root, COMMITTED_ROOT_MARKER_FILE),
    committedFileText(buildRootMarkerValue()),
    'utf8',
  )
  return root
}

/** Write committed bytes at a root-relative path, creating parents. Returns the abs path. */
function writeCommitted(root: string, relPath: string, value: unknown): string {
  const file = join(root, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, committedFileText(value), 'utf8')
  return file
}

function v1FixtureBytes(): Record<string, unknown> {
  return JSON.parse(readFileSync(V1_FIXTURE_PATH, 'utf8')) as Record<string, unknown>
}

function testManifest(overrides: Partial<PartitionManifest> = {}): PartitionManifest {
  return {
    ...projectPartitionManifest({
      product: 'example-web',
      saltHex: TEST_PARTITION.saltHex,
      heldOutFraction: TEST_PARTITION.heldOutFraction,
      privateFraction: TEST_PARTITION.privateFraction,
    }),
    ...overrides,
  }
}

function testExclusion(overrides: Partial<RunExclusionRecord> = {}): RunExclusionRecord {
  return {
    ...projectRunExclusion({
      runId: 'r_x',
      runSlug: 'r_x',
      product: 'automation-exercise',
      verdicts: [{ class: 'flake', producer: 'analyze-run' }],
      analysisDigest: '3d'.repeat(32),
    }),
    ...overrides,
  }
}

/** Every seeded cassette bundle dir under cassettes/, sorted. */
function bundleDirs(root: string): string[] {
  const found: string[] = []
  function walk(dir: string): void {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name === 'cassette.json')) found.push(dir)
    for (const entry of entries) if (entry.isDirectory()) walk(join(dir, entry.name))
  }
  walk(join(root, 'cassettes'))
  return found.sort()
}

describe('readCommittedCorpus / listCommittedReports / listBaselinePointers (413 D-14/D-08)', () => {
  let root: string
  let outDir: string
  let plan: SeedingPlan

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-corpus-source-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-corpus-source-out-'))
    const handoff = sourceHandoff()
    const cassettes = extract(handoff)
    plan = planFor(handoff, cassettes)
    seedCommittedCorpus({
      plan,
      cassettes,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
      policy,
    })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('round-trips a seeded committed root into a joined snapshot', () => {
    const read = readCommittedCorpus(root)

    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toHaveLength(plan.cases.length)
    expect(read.productsSeen).toEqual([PRODUCT])

    for (const entry of read.snapshot.entries) {
      expect(entry.product).toBe(PRODUCT)
      expect(read.snapshot.labelsById.get(entry.cassetteId)?.cassetteId).toBe(entry.cassetteId)
      expect(read.snapshot.cassettesById.get(entry.cassetteId)?.id).toBe(entry.cassetteId)
      expect(read.snapshot.blobPresentById.get(entry.cassetteId)).toBe(true)
    }

    const ids = read.snapshot.entries.map((entry) => entry.cassetteId)
    expect(ids).toEqual([...ids].sort())
  })

  it('reads every seeded v2 entry back through eval\'s guard and censuses the versions seen', () => {
    const read = readCommittedCorpus(root)

    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toHaveLength(plan.cases.length)
    // Every byte in this root is v2, so the census names version 2 only (D-13:
    // Plan 09's `--check` refuses while any `1` remains in a live root).
    expect(read.schemaVersionsSeen).toEqual({ 2: plan.cases.length })

    // Typed round-trip: the read leg returns exactly what the seeder committed,
    // including the non-natural arm the pre-414 local zod could not admit.
    const seededById = new Map(plan.cases.map((planCase) => [planCase.cassetteId, planCase.corpusEntry]))
    for (const entry of read.snapshot.entries) {
      expect(entry).toEqual(seededById.get(entry.cassetteId))
    }
    expect(read.snapshot.entries.some((entry) => entry.split === 'held-out')).toBe(true)
    // D-08: both self-heal pair members are exempt from bucketing.
    expect(read.snapshot.entries.filter((entry) => entry.split === 'natural')).toHaveLength(2)
  })

  it('returns an empty snapshot with a notice when the root does not exist', () => {
    const read = readCommittedCorpus(join(root, 'does-not-exist'))

    expect(read.snapshot.entries).toEqual([])
    expect(read.snapshot.cassettesById.size).toBe(0)
    expect(read.productsSeen).toEqual([])
    expect(read.notices.some((notice) => notice.includes('does-not-exist'))).toBe(true)
  })

  it('folds malformed entry and cassette bytes into typed refusals without throwing', () => {
    expect(plan.cases.length).toBeGreaterThanOrEqual(3)
    const brokenEntryCase = plan.cases[0]!
    const corpusFile = join(root, committedCorpusPath(PRODUCT, brokenEntryCase.cassetteId))
    writeFileSync(corpusFile, '{"schemaVersion":1}\n', 'utf8')

    const brokenBundle = bundleDirs(root)[0]!
    const brokenBundleId = (
      JSON.parse(readFileSync(join(brokenBundle, 'cassette.json'), 'utf8')) as { id: string }
    ).id
    writeFileSync(join(brokenBundle, 'cassette.json'), 'not json', 'utf8')

    const read = readCommittedCorpus(root)

    expect(read.refusals.length).toBeGreaterThanOrEqual(2)
    expect(read.refusals.some((refusal) => refusal.path === corpusFile)).toBe(true)
    expect(
      read.refusals.some((refusal) => refusal.path === join(brokenBundle, 'cassette.json')),
    ).toBe(true)
    for (const refusal of read.refusals) expect(refusal.reason.length).toBeGreaterThan(0)

    // The two broken files dropped out; every well-formed sibling still loaded.
    expect(read.snapshot.entries).toHaveLength(plan.cases.length - 1)
    expect(
      read.snapshot.entries.some((entry) => entry.cassetteId === brokenEntryCase.cassetteId),
    ).toBe(false)
    expect(read.snapshot.cassettesById.has(brokenBundleId)).toBe(false)
    expect(read.snapshot.cassettesById.size).toBe(plan.cases.length - 1)
  })

  it('reports a cassette whose blobs dir was removed as blob-absent but still loaded', async () => {
    const bundle = bundleDirs(root)[0]!
    const id = (JSON.parse(readFileSync(join(bundle, 'cassette.json'), 'utf8')) as { id: string })
      .id
    await rm(join(bundle, BLOBS_SUBDIR), { recursive: true, force: true })

    const read = readCommittedCorpus(root)

    expect(read.snapshot.blobPresentById.get(id)).toBe(false)
    expect(read.snapshot.cassettesById.has(id)).toBe(true)
  })

  it('lists committed reports and baseline pointers, skipping the census and baselines dirs', () => {
    const report = buildEvalReport([])
    const reportPath = join(root, committedReportPath(report.batchKey, 'report.json'))
    mkdirSync(join(reportPath, '..'), { recursive: true })
    writeFileSync(reportPath, committedFileText(report), 'utf8')

    const censusDir = join(root, COMMITTED_REPORTS_DIR, 'census', 'digest-0')
    mkdirSync(censusDir, { recursive: true })
    writeFileSync(join(censusDir, 'census.json'), '{"schemaVersion":1}\n', 'utf8')

    const baselinesDir = join(root, COMMITTED_REPORTS_DIR, 'baselines')
    mkdirSync(baselinesDir, { recursive: true })
    writeFileSync(
      join(baselinesDir, 'p.json'),
      `${JSON.stringify({ schemaVersion: 1, profileKey: 'p', batchKey: report.batchKey })}\n`,
      'utf8',
    )

    const reports = listCommittedReports(root)
    expect(reports.refusals).toEqual([])
    expect(reports.reports).toHaveLength(1)
    expect(reports.reports[0]?.batchKey).toBe(report.batchKey)
    expect(reports.reports[0]?.report.batchKey).toBe(report.batchKey)

    const pointers = listBaselinePointers(root)
    expect(pointers.refusals).toEqual([])
    expect(pointers.pointers).toHaveLength(1)
    expect(pointers.pointers[0]?.profileKey).toBe('p')
    expect(pointers.pointers[0]?.batchKey).toBe(report.batchKey)
  })
})

describe('the v2 read leg on committed bytes (414 D-03/D-13/D-02/D-05, ROOT-06)', () => {
  let root: string

  beforeEach(() => {
    root = markedRoot()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('admits v1 bytes as a natural entry beside a v2 private held-out entry, censusing both (D-13)', () => {
    const v1 = v1FixtureBytes()
    const v1CassetteId = v1.cassetteId as string
    writeCommitted(root, committedCorpusPath(V1_PRODUCT, v1CassetteId), v1)
    writeCommitted(
      root,
      committedCorpusPath(V1_PRODUCT, V2_PRIVATE_ENTRY.cassetteId),
      V2_PRIVATE_ENTRY,
    )

    const read = readCommittedCorpus(root)

    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toHaveLength(2)
    // The census is over the BYTES, not over the in-memory shape: both live
    // versions are present and both are counted.
    expect(read.schemaVersionsSeen).toEqual({ 1: 1, 2: 1 })

    const normalised = read.snapshot.entries.find((entry) => entry.cassetteId === v1CassetteId)
    expect(normalised).toBeDefined()
    expect(normalised?.schemaVersion).toBe(2)
    expect(normalised?.split).toBe('natural')
    // D-13: `handoffPath` is accepted off disk and DISCARDED in memory.
    expect(normalised?.run_links).toEqual({
      runId: (v1.run_links as { runId: string }).runId,
      runSlug: (v1.run_links as { runSlug: string }).runSlug,
    })

    const priv = read.snapshot.entries.find(
      (entry) => entry.cassetteId === V2_PRIVATE_ENTRY.cassetteId,
    )
    expect(priv).toEqual(V2_PRIVATE_ENTRY)
  })

  it('refuses a v2 entry smuggling a handoff path as a typed row and completes the read', () => {
    writeCommitted(
      root,
      committedCorpusPath(V1_PRODUCT, V2_PRIVATE_ENTRY.cassetteId),
      V2_PRIVATE_ENTRY,
    )
    const badPath = writeCommitted(root, committedCorpusPath(V1_PRODUCT, 'r_bad/leaf'), {
      ...V2_PRIVATE_ENTRY,
      cassetteId: 'r_bad/leaf',
      run_links: {
        runId: 'r_bad',
        runSlug: 'r_bad',
        handoffPath: '/Users/someone/.agent-qa/runs/r_bad/handoff.json',
      },
    })

    const read = readCommittedCorpus(root)

    expect(read.refusals).toHaveLength(1)
    expect(read.refusals[0]?.path).toBe(badPath)
    expect(read.refusals[0]?.reason.startsWith('corpus entry rejected:')).toBe(true)
    expect(read.refusals[0]?.reason).toContain('run_links')
    // The read completed: the well-formed sibling still loaded.
    expect(read.snapshot.entries).toHaveLength(1)
    expect(read.schemaVersionsSeen).toEqual({ 2: 1 })
  })

  it('reads partition manifests from contracts/, refusing a bad one by path (D-05)', () => {
    const manifest = testManifest()
    writeCommitted(root, committedPartitionManifestPath(manifest.product), manifest)
    const badPath = writeCommitted(root, 'contracts/partition-bad.json', {
      ...manifest,
      product: 'bad',
      salt: 'a'.repeat(63),
    })

    const read = readPartitionManifests(root)

    expect(read.manifests).toEqual([manifest])
    expect(read.refusals).toHaveLength(1)
    expect(read.refusals[0]?.path).toBe(badPath)
    expect(read.refusals[0]?.reason).toContain('salt')

    // T-414-20: manifests live under contracts/, which the corpus walk never
    // enters — neither file reaches `parseCorpusEntry`.
    const corpus = readCommittedCorpus(root)
    expect(corpus.snapshot.entries).toEqual([])
    expect(corpus.refusals).toEqual([])
    expect(corpus.schemaVersionsSeen).toEqual({})
  })

  it('reads run exclusions from exclusions/<product>/, refusing an unknown class (D-02)', () => {
    const record = testExclusion()
    writeCommitted(root, committedExclusionPath(record.product, record.runSlug), record)
    const badPath = writeCommitted(root, committedExclusionPath('automation-exercise', 'r_bad'), {
      ...record,
      runId: 'r_bad',
      runSlug: 'r_bad',
      verdicts: [{ class: 'app_bug', producer: 'analyze-run' }],
    })

    const read = readRunExclusions(root)

    expect(read.exclusions).toEqual([record])
    expect(read.refusals).toHaveLength(1)
    expect(read.refusals[0]?.path).toBe(badPath)
    expect(read.refusals[0]?.reason.startsWith('run exclusion rejected:')).toBe(true)
  })

  it('slugs every segment of the two committed paths — nothing escapes the root (T-414-16)', () => {
    expect(committedPartitionManifestPath('example-web')).toBe(
      'contracts/partition-example-web.json',
    )
    expect(committedExclusionPath('automation-exercise', 'r_x')).toBe(
      'exclusions/automation-exercise/r_x.json',
    )

    const escapedManifest = committedPartitionManifestPath('../../etc/passwd')
    expect(escapedManifest).not.toContain('..')
    expect(escapedManifest.split('/')).toHaveLength(2)
    expect(escapedManifest.startsWith('contracts/partition-')).toBe(true)

    const escapedExclusion = committedExclusionPath('../../etc', '../passwd')
    expect(escapedExclusion).not.toContain('..')
    expect(escapedExclusion.split('/')).toHaveLength(3)
    expect(escapedExclusion.startsWith(`${COMMITTED_EXCLUSIONS_DIR}/`)).toBe(true)
  })

  it('reports an absent root as empty everywhere, with no refusal (F6 posture)', () => {
    const absent = join(root, 'does-not-exist')

    const corpus = readCommittedCorpus(absent)
    expect(corpus.snapshot.entries).toEqual([])
    expect(corpus.schemaVersionsSeen).toEqual({})
    expect(corpus.refusals).toEqual([])
    expect(corpus.notices.some((notice) => notice.includes('does-not-exist'))).toBe(true)

    const manifests = readPartitionManifests(absent)
    expect(manifests.manifests).toEqual([])
    expect(manifests.refusals).toEqual([])

    const exclusions = readRunExclusions(absent)
    expect(exclusions.exclusions).toEqual([])
    expect(exclusions.refusals).toEqual([])
  })
})
