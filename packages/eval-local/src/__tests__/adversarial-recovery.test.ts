// 422-03-T1 — bounding a refresh, and surviving one.
//
// A refresh over a grown corpus cannot stage every eligible seed at once: the eleven frozen
// families multiply, and an operator who is handed a thousand-case batch reviews none of them.
// So a refresh is capped. A cap on its own, however, creates the failure this file exists to
// prevent: if the SAME leading seeds are re-selected every time, the seeds behind them are
// never reached. That happens whenever a seed produces no publishable variant — a policy
// refusal, a family that does not apply — because nothing on disk records that the tuple was
// already decided. The cap then spends itself, refresh after refresh, on work already done.
//
// The fix is a durable per-product refresh record: every completed (seed, mutator) outcome is
// settled for the generation and the guardrail policy it was decided under, so a later refresh
// skips it and reaches the seeds behind it. The two keys are deliberate. A TABLE-VERSION bump
// is a new generation whose tuples are open again — and it retires nothing, so an id committed
// under generation 1 is never re-derived. A POLICY change reopens refusals specifically,
// because "the host blocked this" is a statement about a policy, not about the bytes.
//
// The records are published write-once, named by their own content digest, so two refreshes
// racing over one unchanged corpus publish one identical record rather than two histories.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH,
  ADVERSARIAL_TABLE_VERSION,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type ArtifactSource,
  type LeafCassette,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import { loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import {
  loadAdversarialGuardrailPolicy,
  stageAdversarialProposal,
  type StageAdversarialProposalResult,
} from '../adversarial-composition.js'
import {
  ADVERSARIAL_STATE_SUBDIR,
  adversarialRefreshRecordDigest,
  computeAdversarialPolicyDigest,
  derivedAdversarialCassetteIds,
  publishAdversarialRefreshRecord,
  readAdversarialRefreshRecords,
  resolveAdversarialSeedCap,
  settledAdversarialTuples,
  type AdversarialRefreshRecord,
} from '../adversarial-state.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import {
  LOCAL_FIXTURE_BLOB_BYTES,
  LOCAL_FIXTURE_BLOB_SHA,
  makeLocalV2Handoff,
} from './fixtures/local-handoff-fixture.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const ROUTE_POLICY = loadAdversarialGuardrailPolicy()
const BLOCK_POLICY = loadGuardrailPolicy({
  detectors: {
    awsKey: 'block',
    creditCard: 'block',
    pemKey: 'block',
    bearer: 'redact',
    apiKey: 'redact',
    email: 'redact',
    injectionShape: 'block',
  },
  allowlist: [],
})

/** More eligible seeds than the default cap, so the overflow is real rather than notional. */
const SEED_COUNT = 10

function proof(): LosslessServedBriefProofV1 {
  return {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 8,
    combinedBudget: 2048,
    admissionEvents: [],
    promptTurns: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-09-11',
        policyL0: 'policy',
        learnedL1: 'learned one',
        learnedL2: 'learned two',
        contextTier: 'context',
        volatileTier: 'volatile',
        policyDigest: '1'.repeat(64),
        contextTierDigest: '2'.repeat(64),
        volatileTierDigest: '3'.repeat(64),
      },
    ],
  }
}

const artifacts: ArtifactSource = {
  getBlob: sha => (sha === LOCAL_FIXTURE_BLOB_SHA ? LOCAL_FIXTURE_BLOB_BYTES : undefined),
}

interface Fixture {
  root: string
  committedRoot: string
  agentQaRoot: string
  seedIds: readonly string[]
}

/**
 * A committed root carrying `count` distinct proof-backed natural leaf seeds.
 *
 * Each seed comes from its own run, because the cassette id is a function of the run: two
 * seeds bred from one handoff would share an id and the "ten seeds" would be one (the false
 * RED 422-02 recorded). `seedIds` is returned ASCENDING — the order a refresh selects in.
 */
function fixture(count = SEED_COUNT): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adversarial-recovery-'))
  roots.push(root)
  const committedRoot = join(root, 'committed')
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  const seedIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const runId = `run / adversarial-recovery ${String(index).padStart(2, '0')}`
    const handoff = makeLocalV2Handoff({ runId: asRunId(runId) })
    const member = handoff.tests[0]!
    member.steps = [member.steps[0]!]
    const brief = member.steps[0]!.servedBrief
    brief.proof = proof()
    // A proof alone is not proof-backing: the seed must have been served something.
    brief.channel3 = [{ id: 'adversarial-recovery-caution' as never, anchors: [], summary: 'served caution' }]
    brief.briefDigest = computeBriefDigest(brief)
    const extraction = extractRunCassettes({ handoff, artifacts })
    const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
    const seed = extracted.cassette as LeafCassette
    const plan: SeedingPlan = {
      product: 'default',
      runId: handoff.runId,
      runSlug: `adversarial-recovery-${String(index).padStart(2, '0')}`,
      cases: [
        {
          cassetteId: seed.id,
          labelRecord: projectSilverLabelRecord({ cassette: seed, runId: handoff.runId }),
          corpusEntry: projectCorpusEntry({
            cassette: seed,
            product: 'default',
            runId: handoff.runId,
            assignment: { split: 'natural' },
          }),
        },
      ],
      pairSkips: [],
      silverExclusions: [],
      pairCounts: { total: 0, sameState: 0, differingState: 0 },
      proceduresExcludedCount: 0,
    }
    const seeded = seedCommittedCorpus({
      plan,
      cassettes: [{ cassette: seed, blobs: extracted.blobs }],
      committedRoot,
      seedingOutputBaseDir: join(agentQaRoot, 'eval', 'audit', 'recovery-seed'),
    })
    expect(seeded.refusals).toEqual([])
    seedIds.push(seed.id)
  }
  // Distinct runs must yield distinct seeds, or "ten seeds" is a fiction.
  expect(new Set(seedIds).size).toBe(count)
  return { root, committedRoot, agentQaRoot, seedIds: [...seedIds].sort() }
}

function stage(
  f: Fixture,
  opts: {
    mutators: readonly ('confusable' | 'injection-template')[]
    policy?: Parameters<typeof stageAdversarialProposal>[0]['policy']
    maxSeeds?: number
    maxSeedsSource?: 'flag' | 'config'
    product?: string
    committedRoot?: string
  },
): StageAdversarialProposalResult {
  return stageAdversarialProposal({
    agentQaRoot: f.agentQaRoot,
    committedRoot: opts.committedRoot ?? f.committedRoot,
    product: opts.product ?? 'default',
    policy: opts.policy ?? ROUTE_POLICY,
    mutators: opts.mutators,
    ...(opts.maxSeeds === undefined ? {} : { maxSeeds: opts.maxSeeds }),
    ...(opts.maxSeedsSource === undefined ? {} : { maxSeedsSource: opts.maxSeedsSource }),
  })
}

function stagedSeedIds(result: StageAdversarialProposalResult): string[] {
  return [...new Set(result.staged.map(row => row.seedCassetteId))].sort()
}

function refusedSeedIds(result: StageAdversarialProposalResult): string[] {
  return [...new Set(result.refusals.map(row => row.seedCassetteId))].sort()
}

function stateFiles(f: Fixture, product = 'default'): string[] {
  const dir = join(f.agentQaRoot, ADVERSARIAL_STATE_SUBDIR, product)
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

describe('422 adversarial refresh bounding and recovery', () => {
  it('caps a refresh at eight novel seeds, records the overflow, and advances to the later seeds next time', () => {
    const f = fixture()
    // The recorded default is the number an operator's review budget is sized against: eight
    // seeds is at most 88 deterministic variants across the eleven frozen families.
    expect(ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH).toBe(8)

    const first = stage(f, { mutators: ['confusable'] })
    expect(first.kind).toBe('staged')
    expect(first.cap).toEqual({ value: 8, source: 'default' })
    expect(first.rootPosture).toBe('available')
    // Novel eligible seeds are counted BEFORE the cap, so the overflow is a number, not a gap.
    expect(first.eligibleSeeds).toBe(SEED_COUNT)
    expect(first.seedsConsidered).toBe(8)
    expect(first.seedsDeferred).toBe(SEED_COUNT - 8)
    expect(stagedSeedIds(first)).toEqual(f.seedIds.slice(0, 8))

    const records = readAdversarialRefreshRecords({ agentQaRoot: f.agentQaRoot, product: 'default' })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      product: 'default',
      tableVersion: ADVERSARIAL_TABLE_VERSION,
      policyDigest: computeAdversarialPolicyDigest(ROUTE_POLICY),
      sourceDigest: first.sourceDigest,
      cap: { value: 8, source: 'default' },
      eligibleSeeds: SEED_COUNT,
      excessSeeds: SEED_COUNT - 8,
    })
    expect(records[0]!.seedIds).toEqual(f.seedIds.slice(0, 8))
    expect(records[0]!.tuples.every(tuple => tuple.outcome === 'derived')).toBe(true)

    // The whole point: refresh two reaches the seeds the cap deferred instead of re-spending
    // itself on the eight it already settled.
    const second = stage(f, { mutators: ['confusable'] })
    expect(second.kind).toBe('staged')
    expect(second.eligibleSeeds).toBe(SEED_COUNT - 8)
    expect(second.seedsConsidered).toBe(SEED_COUNT - 8)
    expect(second.seedsDeferred).toBe(0)
    expect(stagedSeedIds(second)).toEqual(f.seedIds.slice(8))
    expect(second.batchDigest).not.toBe(first.batchDigest)

    const third = stage(f, { mutators: ['confusable'] })
    expect(third.kind).toBe('nothing-derived')
    expect(third.eligibleSeeds).toBe(0)
    expect(third.seedsConsidered).toBe(0)
    expect(third.seedsDeferred).toBe(0)
  })

  it('settles refusals durably so a later refresh advances past them, and reopens them under a new policy', () => {
    const f = fixture()
    const first = stage(f, { mutators: ['injection-template'], policy: BLOCK_POLICY })

    // Nothing publishable: every selected seed was refused by the host policy.
    expect(first.kind).toBe('nothing-derived')
    expect(first.staged).toEqual([])
    expect(first.seedsConsidered).toBe(8)
    expect(refusedSeedIds(first)).toEqual(f.seedIds.slice(0, 8))

    // A refused tuple is a COMPLETED outcome for this generation and this policy. Without that
    // record the same eight seeds would be re-selected and re-refused forever.
    const second = stage(f, { mutators: ['injection-template'], policy: BLOCK_POLICY })
    expect(second.seedsConsidered).toBe(SEED_COUNT - 8)
    expect(refusedSeedIds(second)).toEqual(f.seedIds.slice(8))
    expect(refusedSeedIds(second).some(id => refusedSeedIds(first).includes(id))).toBe(false)

    const third = stage(f, { mutators: ['injection-template'], policy: BLOCK_POLICY })
    expect(third.kind).toBe('nothing-derived')
    expect(third.seedsConsidered).toBe(0)
    expect(third.refusals).toEqual([])

    // "The host blocked this" is a statement about a POLICY. Loosen it and every refusal is
    // open again — the cap applies to the reopened population exactly as it did the first time.
    const relaxed = stage(f, { mutators: ['injection-template'], policy: ROUTE_POLICY })
    expect(relaxed.kind).toBe('staged')
    expect(relaxed.eligibleSeeds).toBe(SEED_COUNT)
    expect(stagedSeedIds(relaxed)).toEqual(f.seedIds.slice(0, 8))
  })

  it('publishes one identical record for a repeated refresh and refuses conflicting bytes under one digest', () => {
    const f = fixture(2)
    const first = stage(f, { mutators: ['confusable'] })
    expect(first.kind).toBe('staged')
    expect(stateFiles(f)).toHaveLength(1)

    // A second refresh over an UNCHANGED corpus derives the same ids and settles the same
    // tuples, so it re-publishes the identical record rather than a second history.
    const records = readAdversarialRefreshRecords({ agentQaRoot: f.agentQaRoot, product: 'default' })
    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(publishAdversarialRefreshRecord({ agentQaRoot: f.agentQaRoot, record })).toBe('unchanged')
    expect(stateFiles(f)).toHaveLength(1)
    expect(readAdversarialRefreshRecords({ agentQaRoot: f.agentQaRoot, product: 'default' })).toEqual(records)

    // Different bytes under the record's own content-addressed name is a conflict, never an
    // overwrite: the record is the audit trail a later refresh trusts.
    const file = join(
      f.agentQaRoot,
      ADVERSARIAL_STATE_SUBDIR,
      'default',
      `${adversarialRefreshRecordDigest(record)}.json`,
    )
    writeFileSync(file, `${JSON.stringify({ ...record, excessSeeds: 99 })}\n`)
    expect(() => publishAdversarialRefreshRecord({ agentQaRoot: f.agentQaRoot, record }))
      .toThrow(/conflict/)
    expect(JSON.parse(readFileSync(file, 'utf8')).excessSeeds).toBe(99)
  })

  it('keeps every older committed id while a new table generation reopens its tuples', () => {
    const policyDigest = computeAdversarialPolicyDigest(ROUTE_POLICY)
    const record: AdversarialRefreshRecord = {
      schemaVersion: 1,
      product: 'default',
      tableVersion: 1,
      policyDigest,
      sourceDigest: 'a'.repeat(64),
      cap: { value: 8, source: 'default' },
      eligibleSeeds: 1,
      excessSeeds: 0,
      seedIds: ['cassette-seed'],
      tuples: [
        { seedCassetteId: 'cassette-seed', mutator: 'confusable', cassetteId: 'gen1-derived', outcome: 'derived' },
        { seedCassetteId: 'cassette-seed', mutator: 'invisible', cassetteId: 'gen1-refused', outcome: 'refused', detail: 'injectionShape' },
      ],
    }

    // Same generation, same policy: both tuples are settled and neither is reconsidered.
    // The key joins on U+001F for the reason the draw key does: no component can contain
    // it, so (a, bc) and (ab, c) can never collide into one settled tuple.
    expect([...settledAdversarialTuples([record], { tableVersion: 1, policyDigest })].sort())
      .toEqual(['cassette-seed\u001Fconfusable', 'cassette-seed\u001Finvisible'])

    // A bumped generation addresses NEW ids beside the old ones, so its tuples are open...
    expect(settledAdversarialTuples([record], { tableVersion: 2, policyDigest }).size).toBe(0)
    // ...and a new policy reopens them within the same generation.
    expect(settledAdversarialTuples([record], { tableVersion: 1, policyDigest: 'b'.repeat(64) }).size)
      .toBe(0)

    // But an id already derived is NEVER retired, whatever the generation or the policy: it is
    // committed history, and re-deriving it would address bytes that already exist.
    expect([...derivedAdversarialCassetteIds([record])]).toEqual(['gen1-derived'])
  })

  it('resolves the seed cap with its source and refuses every invalid numeric boundary', () => {
    expect(resolveAdversarialSeedCap({})).toEqual({
      value: ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH,
      source: 'default',
    })
    expect(resolveAdversarialSeedCap({ value: 3 })).toEqual({ value: 3, source: 'flag' })
    expect(resolveAdversarialSeedCap({ value: 3, source: 'config' })).toEqual({ value: 3, source: 'config' })

    for (const value of [0, -1, 1.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 2]) {
      expect(() => resolveAdversarialSeedCap({ value }), `cap=${String(value)}`).toThrow(TypeError)
    }
  })

  it('distinguishes a healthy empty root from an unavailable one by gate posture, not reader length', () => {
    const f = fixture(1)

    // A product with no committed entries reads empty — and the ROOT is healthy, so the
    // refresh reports an honest empty result and a resolved source digest.
    const healthy = stage(f, { mutators: ['confusable'], product: 'other-product' })
    expect(healthy.rootPosture).toBe('available')
    expect(healthy.kind).toBe('nothing-derived')
    expect(healthy.eligibleSeeds).toBe(0)
    expect(healthy.sourceDigest).toMatch(/^[0-9a-f]{64}$/)

    // An unmarked root reads empty through exactly the same port. Reader length cannot tell
    // the two apart; the gate posture can, and a refresh that cannot establish the root
    // settles nothing — a settle record here would be evidence manufactured from silence.
    const broken = join(f.root, 'no-marker-root')
    mkdirSync(broken, { recursive: true })
    const unavailable = stage(f, { mutators: ['confusable'], product: 'default', committedRoot: broken })
    expect(unavailable.rootPosture).toBe('unavailable')
    expect(unavailable.kind).toBe('nothing-derived')
    expect(unavailable.sourceDigest).toBeUndefined()
    expect(unavailable.stateRecordDigest).toBeUndefined()
    expect(stateFiles(f, 'other-product')).toEqual([])
  })
})
