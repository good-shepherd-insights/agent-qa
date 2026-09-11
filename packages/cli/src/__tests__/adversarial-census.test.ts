// 422-19-T1 at the public surface — what the CENSUS says about a corpus that actually grew.
//
// The sibling cells in `packages/eval/src/census/__tests__/adversarial-census.test.ts` pin the
// fold. These commit real bytes into a temporary root and then ask the public `eval census` verb,
// because the two facts this task owes are facts about COMMITTED MEMBERSHIP and neither of them
// can be observed by handing a synthetic DTO to the renderer:
//
//   - A staged batch is not a census member. `eval adversarial` writes its reviewed batch to the
//     local staging tree, and an operator who never admitted it has committed nothing. A census
//     that counted staged cases would report a corpus that does not exist.
//   - A table generation bump ADDS a generation. The older generation's committed entries keep
//     gating until a reviewed rotation retires them (D-08), so both generations must appear, and
//     their counts must still sum to the adversarial split total rather than replacing it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import {
  committedFileText,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type LeafCassette,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import {
  committedCorpusPath,
  FsRunArtifactSource,
  seedCommittedCorpus,
} from '@vostride/agent-qa-eval-local'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'
import {
  adversarialHostOptions,
  resolveEvalSession,
  runAdversarialVerb,
  runCensusVerb,
} from '../eval-session-composition.js'
import { rmSync } from 'node:fs'

const roots: string[] = []

beforeEach(() => {
  // The whole adversarial path is offline; a provider call here would be a defect, not a cost.
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('provider access forbidden')
  })
  vi.spyOn(model, 'createModel').mockImplementation(() => {
    throw new Error('model creation forbidden')
  })
})

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

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

function fixture() {
  const f = markFixture()
  roots.push(f.root)
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  const member = f.handoff.tests[0]!
  const brief = member.steps[0]!.servedBrief
  brief.proof = proof()
  brief.briefDigest = computeBriefDigest(brief)
  f.save()

  const committedRoot = join(f.root, 'agent-qa-eval')
  const artifacts = new FsRunArtifactSource({ root: f.agentQaRoot, runId: f.handoff.runId })
  const extraction = extractRunCassettes({ handoff: f.handoff, artifacts })
  const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
  const seed = extracted.cassette as LeafCassette
  const plan: SeedingPlan = {
    product: 'default',
    runId: f.handoff.runId,
    runSlug: member.testId,
    cases: [
      {
        cassetteId: seed.id,
        labelRecord: projectSilverLabelRecord({ cassette: seed, runId: f.handoff.runId }),
        corpusEntry: projectCorpusEntry({
          cassette: seed,
          product: 'default',
          runId: f.handoff.runId,
          assignment: { split: 'natural' },
        }),
      },
    ],
    pairSkips: [],
    silverExclusions: [],
    pairCounts: { total: 0, sameState: 0, differingState: 0 },
    proceduresExcludedCount: 0,
  }
  expect(
    seedCommittedCorpus({
      plan,
      cassettes: [{ cassette: seed, blobs: extracted.blobs }],
      committedRoot,
      seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'census-seed'),
    }).refusals,
  ).toEqual([])
  return { ...f, committedRoot, seed }
}

async function session(f: ReturnType<typeof fixture>) {
  return resolveEvalSession({ configPath: f.configPath, keyOnly: true })
}

/**
 * A committed entry from the PREVIOUS frozen generation, written straight into the root the way
 * a generation-1 refresh would have left it. The whole point of D-08 is that these bytes stay
 * committed across a table bump, so the census must be asked about a root that holds both.
 */
function commitGenerationOneEntry(f: ReturnType<typeof fixture>, cassetteId: string): void {
  const entry = projectCorpusEntry({
    cassette: { ...f.seed, id: cassetteId },
    product: 'default',
    runId: f.handoff.runId,
    assignment: {
      split: 'adversarial',
      generator: {
        kind: 'fuzz-label',
        seedCassetteId: f.seed.id,
        generatorVersion: 1,
        mutator: 'confusable',
        tableVersion: 1,
        tableHash: '1'.repeat(64),
      },
    },
  })
  const path = join(f.committedRoot, committedCorpusPath('default', cassetteId))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, committedFileText(entry), { flag: 'wx' })
}

describe('422 adversarial census — committed generation mix at the public verb', () => {
  it('counts no staged case, then counts exactly the admitted batch', async () => {
    const f = fixture()
    const s = await session(f)

    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    expect(staged.staged.length).toBeGreaterThan(0)

    // A reviewed batch on the staging tree is not membership: nothing has been committed, so the
    // census reports no adversarial member at all — ABSENT, never a block of zeros.
    const beforeAdmit = await runCensusVerb(s)
    expect(beforeAdmit.census.products.default!.splits.adversarial).toBe(0)
    expect(beforeAdmit.census.products.default!.adversarialGenerationMix).toBeUndefined()

    const admitted = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s),
      product: 'default',
      admit: true,
      batch: staged.batchDigest!,
    })
    expect(admitted.kind).toBe('admitted')

    const afterAdmit = await runCensusVerb(s)
    const block = afterAdmit.census.products.default!
    const mix = block.adversarialGenerationMix
    expect(mix).toBeDefined()
    expect(mix!.total).toBe(block.splits.adversarial)
    expect(mix!.total).toBe(admitted.admitted.length)
    // This refresh derived under the live generation, and only under it.
    expect(mix!.byTableVersion).toEqual({ [String(staged.tableVersion!)]: admitted.admitted.length })
    expect(mix!.tableHashesByVersion).toEqual({ [String(staged.tableVersion!)]: [staged.tableHash!] })
    expect(mix!.byProvenance.table).toBe(admitted.admitted.length)
    expect(mix!.byProvenance.probe).toBe(0)
    // Every declared family is present; the ones this seed could not carry read as explicit zeros.
    const families = Object.entries(mix!.byMutator)
    expect(families.filter(([, count]) => count > 0).length).toBeGreaterThan(0)
    expect(families.filter(([, count]) => count === 0).length).toBeGreaterThan(0)
  })

  it('keeps the older generation beside the new one, still summing to the adversarial total', async () => {
    const f = fixture()
    const s = await session(f)
    commitGenerationOneEntry(f, 'adversarial-generation-one-case')

    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    const admitted = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s),
      product: 'default',
      admit: true,
      batch: staged.batchDigest!,
    })
    expect(admitted.kind).toBe('admitted')

    const block = (await runCensusVerb(s)).census.products.default!
    const mix = block.adversarialGenerationMix!
    expect(Object.keys(mix.byTableVersion).sort()).toEqual(['1', String(staged.tableVersion!)])
    expect(mix.byTableVersion['1']).toBe(1)
    expect(mix.byTableVersion[String(staged.tableVersion!)]).toBe(admitted.admitted.length)
    // A bump adds a generation; the total is the sum of both, not the newest one alone.
    expect(Object.values(mix.byTableVersion).reduce((total, value) => total + value, 0))
      .toBe(block.splits.adversarial)
    expect(mix.total).toBe(admitted.admitted.length + 1)
    expect(mix.tableHashesByVersion['1']).toEqual(['1'.repeat(64)])
  })
})
