import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  buildSeedingPlan,
  JUDGE_CONFIG,
  extractRunCassettes,
  projectJudgeConfigContract,
  projectMatcherConfigContract,
} from '@vostride/agent-qa-eval'
import type { ArtifactSource, ExtractedCassette, SeedingPlan } from '@vostride/agent-qa-eval'
import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import { asRef, computeBriefDigest } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  Decision,
  LosslessServedBriefProofV1,
  ServedPromptTurn,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  committedBlobPath,
  committedCassettePath,
  committedContractPath,
  committedCorpusPath,
  committedLabelPath,
} from '../committed-root-store.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import type { SeedingReport } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

/**
 * The 414-05 shared partition vector (Plan 01 replaced buildSeedingPlan's old
 * `handoffPath` input with `partition` DATA). Same salt and fractions as
 * `committed-corpus-source.test.ts`: a 64-lowercase-hex salt, and a
 * `heldOutFraction` above the fixture silver leaf's bucket fraction under that
 * salt so the seeded root carries a held-out entry.
 */
const TEST_PARTITION = {
  saltHex: 'a3f'.repeat(21).concat('b'),
  heldOutFraction: 0.95,
  privateFraction: 0.5,
} as const
const PRODUCT = 'default'

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
 * The seeding composition fixture: test 0 stays the fixture's verified-pass
 * test (one live decision → one silver case); test 1 becomes a fully
 * resolvable self-heal pair (two live decisions → two near-gold cases).
 * Both pair decisions share a byte-identical stateBefore carrying BOTH
 * anchors, so each cassette is complete and the pair stamps sameState.
 */
function seedingHandoff(): CompletedRunHandoff {
  const handoff = makeLocalV2Handoff()
  // Luhn-proof the fixture timestamps: the default guardrail's credit-card detector
  // Luhn-checks every 13-19 digit run, and the fixture's 1725000000100 happens to
  // pass — a 10-digit epoch keeps the committed text free of card-shaped numbers.
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

function planFor(handoff: CompletedRunHandoff, cassettes: readonly ExtractedCassette[]): SeedingPlan {
  return buildSeedingPlan({ handoff, cassettes, partition: TEST_PARTITION })
}

function casePaths(cassetteId: string): { cassette: string; label: string; corpus: string } {
  return {
    cassette: committedCassettePath(PRODUCT, cassetteId),
    label: committedLabelPath(PRODUCT, cassetteId),
    corpus: committedCorpusPath(PRODUCT, cassetteId),
  }
}

/** Recursive byte snapshot of every file under dir, keyed by relative path. */
function snapshotTree(dir: string, prefix = ''): Map<string, Buffer> {
  const snapshot = new Map<string, Buffer>()
  for (const name of readdirSync(join(dir, prefix))) {
    const rel = prefix === '' ? name : `${prefix}/${name}`
    const abs = join(dir, rel)
    if (statSync(abs).isDirectory()) {
      for (const [innerRel, bytes] of snapshotTree(dir, rel)) snapshot.set(innerRel, bytes)
    } else {
      snapshot.set(rel, readFileSync(abs))
    }
  }
  return snapshot
}

describe('seedCommittedCorpus (ROOT-02, D-13/D-14/D-15/D-16/D-17)', () => {
  let root: string
  let outDir: string
  let handoff: CompletedRunHandoff
  let cassettes: ExtractedCassette[]
  let plan: SeedingPlan

  function seed(overrides: {
    plan?: SeedingPlan
    cassettes?: readonly ExtractedCassette[]
  } = {}): SeedingReport {
    return seedCommittedCorpus({
      plan: overrides.plan ?? plan,
      cassettes: overrides.cassettes ?? cassettes,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-seeding-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-seeding-out-'))
    handoff = seedingHandoff()
    cassettes = extract(handoff)
    plan = planFor(handoff, cassettes)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('seeds scaffold + contracts + every case atomically into the committed root (happy path)', () => {
    expect(plan.cases).toHaveLength(3)

    const report = seed()

    expect(report.product).toBe(PRODUCT)
    expect(report.runId).toBe(handoff.runId)
    expect(report.committedRoot).toBe(root)
    expect(report.seededCount).toBe(3)
    expect(report.unchangedCount).toBe(0)
    expect(report.refusals).toEqual([])
    expect(report.scaffold).toEqual({ gitignore: 'written', marker: 'written' })
    expect(report.contracts).toEqual([
      { fileName: 'matcher-config.v1.json', outcome: 'written' },
      { fileName: `judge-config.v${JUDGE_CONFIG.judgeVersion}.json`, outcome: 'written' },
    ])

    // Never-silent pass-through of the plan's accounting, verbatim.
    expect(report.pairSkips).toEqual(plan.pairSkips)
    expect(report.silverExclusions).toEqual(plan.silverExclusions)
    expect(report.pairCounts).toEqual(plan.pairCounts)
    expect(report.pairCounts).toEqual({ total: 1, sameState: 1, differingState: 0 })
    expect(report.proceduresExcludedCount).toBe(plan.proceduresExcludedCount)

    // D-15 scaffold + D-04 contracts land at the store's anatomy.
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('**/blobs/')
    expect(JSON.parse(readFileSync(join(root, 'eval-root.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
    })
    expect(existsSync(join(root, committedContractPath('matcher-config.v1.json')))).toBe(true)
    expect(existsSync(join(root, committedContractPath(`judge-config.v${JUDGE_CONFIG.judgeVersion}.json`)))).toBe(true)

    // Every case's whole unit landed: cassette + label + corpus + blob.
    for (const planCase of plan.cases) {
      const paths = casePaths(planCase.cassetteId)
      expect(existsSync(join(root, paths.cassette))).toBe(true)
      expect(existsSync(join(root, paths.label))).toBe(true)
      expect(existsSync(join(root, paths.corpus))).toBe(true)
      expect(
        existsSync(join(root, committedBlobPath(PRODUCT, planCase.cassetteId, LOCAL_FIXTURE_BLOB_SHA))),
      ).toBe(true)
      expect(JSON.parse(readFileSync(join(root, paths.label), 'utf8')).cassetteId).toBe(
        planCase.cassetteId,
      )
      expect(JSON.parse(readFileSync(join(root, paths.corpus), 'utf8')).cassetteId).toBe(
        planCase.cassetteId,
      )
    }
  })

  it('re-seeding identical input is a byte-identical idempotent no-op everywhere (D-17)', () => {
    seed()
    const before = snapshotTree(root)

    const second = seed()

    expect(second.seededCount).toBe(0)
    expect(second.unchangedCount).toBe(3)
    expect(second.refusals).toEqual([])
    expect(second.scaffold).toEqual({ gitignore: 'unchanged', marker: 'unchanged' })
    expect(second.contracts).toEqual([
      { fileName: 'matcher-config.v1.json', outcome: 'unchanged' },
      { fileName: `judge-config.v${JUDGE_CONFIG.judgeVersion}.json`, outcome: 'unchanged' },
    ])

    // Read-back byte comparison, not just report counts.
    const after = snapshotTree(root)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [rel, bytes] of before) {
      expect(after.get(rel)!.equals(bytes)).toBe(true)
    }
  })

  it('refuses a mutated case with a typed write-conflict before anything lands (D-17)', () => {
    seed()
    const before = snapshotTree(root)

    const mutated = structuredClone(plan)
    const target = mutated.cases[0]!
    // 414 D-13 removed run_links.handoffPath, so the divergence this cell needs
    // now comes from the runSlug — any byte difference is the same refusal.
    target.corpusEntry = {
      ...target.corpusEntry,
      run_links: { ...target.corpusEntry.run_links, runSlug: 'run---seeded-elsewhere' },
    }

    const report = seed({ plan: mutated })

    expect(report.seededCount).toBe(0)
    expect(report.unchangedCount).toBe(2)
    expect(report.refusals).toEqual([
      {
        cassetteId: target.cassetteId,
        kind: 'write-conflict',
        path: committedCorpusPath(PRODUCT, target.cassetteId),
      },
    ])

    // Original bytes intact everywhere — never an overwrite.
    const after = snapshotTree(root)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [rel, bytes] of before) {
      expect(after.get(rel)!.equals(bytes)).toBe(true)
    }
  })

  it('commits the matcher and judge constitutions verbatim as versioned contracts (D-04)', async () => {
    seed()

    const matcher = JSON.parse(
      await readFile(join(root, committedContractPath('matcher-config.v1.json')), 'utf8'),
    )
    expect(matcher).toEqual(JSON.parse(JSON.stringify(projectMatcherConfigContract())))

    const judge = JSON.parse(
      await readFile(join(root, committedContractPath(`judge-config.v${JUDGE_CONFIG.judgeVersion}.json`)), 'utf8'),
    )
    expect(judge).toEqual(JSON.parse(JSON.stringify(projectJudgeConfigContract())))
  })

  it('refuses a plan case whose cassette is absent and continues the batch', () => {
    const missingCase = plan.cases[0]!
    const withoutOne = cassettes.filter((entry) => entry.cassette.id !== missingCase.cassetteId)

    const report = seed({ cassettes: withoutOne })

    expect(report.refusals).toEqual([
      { cassetteId: missingCase.cassetteId, kind: 'missing-cassette' },
    ])
    expect(report.seededCount).toBe(2)
    const missingPaths = casePaths(missingCase.cassetteId)
    expect(existsSync(join(root, missingPaths.cassette))).toBe(false)
    expect(existsSync(join(root, missingPaths.label))).toBe(false)
    expect(existsSync(join(root, missingPaths.corpus))).toBe(false)
    for (const planCase of plan.cases) {
      if (planCase.cassetteId === missingCase.cassetteId) continue
      expect(existsSync(join(root, casePaths(planCase.cassetteId).cassette))).toBe(true)
    }
  })
})

/**
 * 413 SC2 / T-413-01: the growth campaign records `ServedBrief.proof` — the exact model-visible
 * prompt material of every turn — and the seeder commits it as recorded. A declared value in it
 * was masked at record time by the run's redactor, so the committed prose carries the marker and
 * never the value (441 D-06, D-15: the seeder runs no content check of its own).
 */
function losslessProof(text: string): LosslessServedBriefProofV1 {
  const turn: ServedPromptTurn = {
    ordinal: 0,
    turnOrdinal: 0,
    runDate: '2026-09-04',
    policyL0: 'Prefer the recorded Continue button.',
    learnedL1: text,
    learnedL2: '',
    contextTier: '',
    volatileTier: '',
    policyDigest: 'a'.repeat(64),
    contextTierDigest: 'b'.repeat(64),
    volatileTierDigest: 'c'.repeat(64),
  }
  return {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 8,
    combinedBudget: 4_096,
    admissionEvents: [],
    promptTurns: [turn],
  }
}

describe('413 SC2 — lossless proof text is committed as recorded, its declared value masked (D-10, T-413-01)', () => {
  let root: string
  let outDir: string
  let handoff: CompletedRunHandoff

  function seed(
    plan: SeedingPlan,
    seedCassettes: readonly ExtractedCassette[],
  ): SeedingReport {
    return seedCommittedCorpus({
      plan,
      cassettes: seedCassettes,
      committedRoot: root,
      seedingOutputBaseDir: outDir,
    })
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-sc2-root-'))
    outDir = await mkdtemp(join(tmpdir(), 'eval-local-sc2-out-'))
    handoff = seedingHandoff()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outDir, { recursive: true, force: true })
  })

  it('commits a masking-registered value in proof.promptTurns as its placeholder, never raw', () => {
    const REGISTERED = 'melon-proof-turn-registered-secret-4k2v'
    const redactor = new SecretRedactor(SecretStore.fromEnvContent(`TURN_TOKEN=${REGISTERED}`))

    const rawTurnText = `Reuse the checkout token ${REGISTERED} on the next turn.`
    // Positive controls: the unmasked prose carries the value and the mask rewrites it.
    expect(rawTurnText).toContain(REGISTERED)
    const maskedTurnText = redactor.redactString(rawTurnText)
    expect(maskedTurnText).not.toContain(REGISTERED)
    expect(maskedTurnText).toContain('[secret:TURN_TOKEN]')

    // Apply the mask at the RECORD boundary — upstream of extraction, exactly as live recording
    // masks evidence before anything is staged (committed-root-proof.test.ts:342 idiom). The
    // brief digest is recomputed because the proof participates in it.
    for (const test of handoff.tests) {
      for (const step of test.steps) {
        const brief = { ...step.servedBrief, proof: losslessProof(maskedTurnText) }
        step.servedBrief = { ...brief, briefDigest: computeBriefDigest(brief) }
      }
    }
    const cassettes = extract(handoff)
    const plan = planFor(handoff, cassettes)

    const report = seed(plan, cassettes)

    expect(report.refusals).toEqual([])
    expect(report.seededCount).toBe(3)

    const committed = readFileSync(join(root, casePaths(plan.cases[0]!.cassetteId).cassette), 'utf8')
    expect(committed).toContain('[secret:TURN_TOKEN]')
    expect(committed).not.toContain(REGISTERED)
  })
})

// 441 D-15 (landed in 441-12): seeds are committed as authored, with no content check.
describe('C441-COMMITTED', () => {
  it('a seeded cassette with credential-shaped text is committed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eval-local-c441-root-'))
    const outDir = await mkdtemp(join(tmpdir(), 'eval-local-c441-out-'))
    try {
      const handoff = seedingHandoff()
      const cassettes = structuredClone(extract(handoff))
      const plan = planFor(handoff, cassettes)
      const target = cassettes.find((entry) => entry.cassette.id === plan.cases[0]!.cassetteId)!
      const cassette = target.cassette
      if (cassette.granularity !== 'leaf') throw new Error('fixture case must be a leaf')
      cassette.input.stateBefore.tree += '\n- text "Card 4242 4242 4242 4242 with Bearer abc123def456ghi789"'

      const report = seedCommittedCorpus({ plan, cassettes, committedRoot: root, seedingOutputBaseDir: outDir })

      expect(report.refusals.map((refusal) => refusal.kind).join(', ')).toBe('')
      const committed = readFileSync(join(root, casePaths(cassette.id).cassette), 'utf8')
      expect(committed).toContain('4242 4242 4242 4242')
      expect(committed).toContain('Bearer abc123def456ghi789')
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
