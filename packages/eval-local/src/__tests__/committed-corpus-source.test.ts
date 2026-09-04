import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildEvalReport,
  buildSeedingPlan,
  committedFileText,
  extractRunCassettes,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { asRef } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Decision, SubActionEvidence } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BLOBS_SUBDIR } from '../cassette-store.js'
import {
  COMMITTED_REPORTS_DIR,
  committedCorpusPath,
  committedReportPath,
} from '../committed-root-store.js'
import {
  listBaselinePointers,
  listCommittedReports,
  readCommittedCorpus,
} from '../committed-corpus-source.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const HANDOFF_PATH = '.agent-qa/runs/run---eval-local-standalone/handoff.json'
const PRODUCT = 'default'
const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

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
  return buildSeedingPlan({ handoff, cassettes, handoffPath: HANDOFF_PATH })
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
