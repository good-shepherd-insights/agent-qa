// 414 ROOT-07 SC2 — the relocation half.
//
// A committed corpus travels: it is cloned onto another machine, checked out at another path,
// mounted at another prefix in CI. If ANY of the split assignment, the gate set or the corpus
// digest read the root's location, two machines gate the same candidate against two different
// corpora and neither of them knows. So the whole read/assign/exclude path is re-run over a
// byte-identical COPY of the root at a different absolute path and required to answer identically.
//
// Every negative assertion is paired with a positive control (the `committed-root-proof.test.ts`
// discipline, T-371-19): "no committed JSON mentions the original root" is worth nothing unless
// the scan that says so can be shown to find such a mention when one is planted.

import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assignSplit,
  buildSeedingPlan,
  canonicalJson,
  computeCorpusDigest,
  extractRunCassettes,
  partitionParamsOf,
  projectPartitionManifest,
  selectGateSet,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { asRef } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, Decision, SubActionEvidence } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BLOBS_SUBDIR } from '../cassette-store.js'
import { readCommittedCorpus, readPartitionManifests } from '../committed-corpus-source.js'
import { seedCommittedCorpus, writePartitionManifest } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const PRODUCT = 'default'

/** The 414-05 shared partition vector — same salt and fractions as the sibling suites. */
const TEST_PARTITION = {
  saltHex: 'a3f'.repeat(21).concat('b'),
  heldOutFraction: 0.95,
  privateFraction: 0.5,
} as const

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

/** The `committed-corpus-source.test.ts` fixture: one silver test plus one self-heal pair. */
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

/** Every `*.json` under `dir` at any depth, skipping gitignored `blobs/` trees. */
function committedJsonFiles(dir: string): string[] {
  const found: string[] = []
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === BLOBS_SUBDIR) continue
        walk(join(current, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        found.push(join(current, entry.name))
      }
    }
  }
  walk(dir)
  return found.sort()
}

/** Committed JSON files under `dir` whose bytes mention `needle`. */
function jsonFilesMentioning(dir: string, needle: string): string[] {
  return committedJsonFiles(dir).filter((file) => readFileSync(file, 'utf8').includes(needle))
}

describe('414 ROOT-07 — relocation: the split and the exclusion set are functions of committed bytes, not of where the root lives', () => {
  let rootA: string
  let rootB: string
  let outDir: string
  let plan: SeedingPlan

  beforeEach(async () => {
    rootA = await mkdtemp(join(tmpdir(), 'relocation-a-'))
    outDir = await mkdtemp(join(tmpdir(), 'relocation-out-'))
    const handoff = sourceHandoff()
    const cassettes = extract(handoff)
    plan = buildSeedingPlan({ handoff, cassettes, partition: TEST_PARTITION })
    seedCommittedCorpus({
      plan,
      cassettes,
      committedRoot: rootA,
      seedingOutputBaseDir: outDir,
      policy,
    })
    writePartitionManifest({
      manifest: projectPartitionManifest({
        product: PRODUCT,
        saltHex: TEST_PARTITION.saltHex,
        heldOutFraction: TEST_PARTITION.heldOutFraction,
        privateFraction: TEST_PARTITION.privateFraction,
      }),
      committedRoot: rootA,
      seedingOutputBaseDir: outDir,
      policy,
    })

    // The move. A DIFFERENT mkdtemp prefix, so the two absolute paths share no suffix and a
    // path that leaked into the bytes could not accidentally still resolve.
    rootB = await mkdtemp(join(tmpdir(), 'relocation-b-'))
    cpSync(rootA, rootB, { recursive: true })
  })

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('reproduces every committed split from the MOVED manifest, byte for byte', () => {
    const manifestsB = readPartitionManifests(rootB)
    expect(manifestsB.refusals).toEqual([])
    const manifestB = manifestsB.manifests.find((manifest) => manifest.product === PRODUCT)
    expect(manifestB).toBeDefined()

    const readB = readCommittedCorpus(rootB)
    expect(readB.snapshot.entries.length).toBe(plan.cases.length)
    expect(readB.snapshot.entries.length).toBeGreaterThan(0)

    // Non-vacuity: the corpus really carries a non-natural arm, so "reproduces the split" is a
    // claim about more than one answer.
    expect(readB.snapshot.entries.some((entry) => entry.split === 'held-out')).toBe(true)

    for (const entry of readB.snapshot.entries) {
      // D-08: a self-heal pair member is exempt from bucketing, and the committed LABEL is where
      // that fact lives — the entry does not carry it. `near-gold` is the pair channel's tier.
      const isPairMember =
        readB.snapshot.labelsById.get(entry.cassetteId)?.label.tier === 'near-gold'
      const assignment = assignSplit({
        ...partitionParamsOf(manifestB!),
        cassetteId: entry.cassetteId,
        isPairMember,
      })

      expect(assignment.split).toBe(entry.split)
      if (assignment.split === 'held-out' && entry.split === 'held-out') {
        expect(assignment.heldOutVisibility).toBe(entry.heldOutVisibility)
      }
    }
  })

  it('selects an identical gate set and identical excludedCassetteIds from either root', () => {
    const readA = readCommittedCorpus(rootA)
    const readB = readCommittedCorpus(rootB)

    // Keyed on ONE entry's receiptDigest rather than the run id: a run-keyed candidate excludes
    // every entry of that run, which empties the gate set and makes "identical excluded ids" a
    // comparison of two total sets rather than of a real partition of them.
    const pivot = readA.snapshot.entries[0]!
    const candidate = {
      runIds: [] as readonly string[],
      receiptDigests: [pivot.receiptDigest],
      capturedAtOrdinals: [] as readonly number[],
    }

    const verdictA = selectGateSet({
      entries: readA.snapshot.entries,
      product: PRODUCT,
      candidate,
      minimumGateSet: 1,
    })
    const verdictB = selectGateSet({
      entries: readB.snapshot.entries,
      product: PRODUCT,
      candidate,
      minimumGateSet: 1,
    })

    expect(verdictA.verdict).toBe('ok')
    expect(verdictB.verdict).toBe('ok')
    expect(canonicalJson(verdictB)).toEqual(canonicalJson(verdictA))

    if (
      verdictA.verdict === 'unprovenanced-candidate' ||
      verdictB.verdict === 'unprovenanced-candidate'
    ) {
      throw new Error('the candidate names a receipt digest, so it is provenanced by construction')
    }

    // Non-vacuity: the exclusion really removed something, and it removed the pivot.
    const excludedA = [...verdictA.excluded].map((row) => row.cassetteId).sort()
    const excludedB = [...verdictB.excluded].map((row) => row.cassetteId).sort()
    expect(excludedA).toEqual([pivot.cassetteId])
    expect(excludedB).toEqual(excludedA)
  })

  it('computes an identical corpus digest from either root', () => {
    const readA = readCommittedCorpus(rootA)
    const readB = readCommittedCorpus(rootB)

    const digestA = computeCorpusDigest(readA.snapshot.entries)

    expect(digestA).toMatch(/^[0-9a-f]{64}$/)
    expect(computeCorpusDigest(readB.snapshot.entries)).toBe(digestA)
  })

  it('committed no absolute path of the original root, and the scan that says so can find one', () => {
    // The scan is non-empty: a walk that found no files would report zero mentions of anything.
    expect(committedJsonFiles(rootB).length).toBeGreaterThan(0)
    expect(jsonFilesMentioning(rootB, rootA)).toEqual([])

    // The positive control (RESEARCH Pitfall 6): plant the original root's path in a committed
    // JSON file under the moved root and require the SAME scan to find exactly it.
    const planted = join(rootB, 'planted-control.json')
    writeFileSync(planted, `${JSON.stringify({ leaked: rootA })}\n`, 'utf8')
    expect(jsonFilesMentioning(rootB, rootA)).toEqual([planted])
    rmSync(planted)

    expect(jsonFilesMentioning(rootB, rootA)).toEqual([])
  })

  it('reads the moved root with no refusals and the same version census', () => {
    const readA = readCommittedCorpus(rootA)
    const readB = readCommittedCorpus(rootB)

    expect(readB.refusals).toEqual([])
    expect(readB.schemaVersionsSeen).toEqual({ 2: plan.cases.length })
    expect(readB.schemaVersionsSeen).toEqual(readA.schemaVersionsSeen)
    expect(readB.productsSeen).toEqual(readA.productsSeen)
  })
})
