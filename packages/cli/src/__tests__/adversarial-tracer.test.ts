// 422-01-T1 — the adversarial tracer: one confusable-derived natural seed travelling from the
// public `eval adversarial` verb, through local staging, to explicit operator admission.
//
// What this file is FOR: proving the authority split (D-01) end to end on real bytes. Staging
// must leave every committed byte and the corpus digest untouched; admission must be an
// explicit act naming ONE reviewed batch; and a FRESH reader — the proposer's own door — must
// then resolve the derived cassette with the seed's gold cloned onto it and its blob closure
// readable. Anything less and "propose, never commit" is a comment rather than a property.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import {
  ADVERSARIAL_MUTATORS,
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  deriveAdversarialCassetteId,
  effectiveGold,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type LeafCassette,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import {
  FsRunArtifactSource,
  committedBlobPath,
  seedCommittedCorpus,
} from '@vostride/agent-qa-eval-local'
import { openCorpusReader } from '@vostride/agent-qa-eval-local/reader'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'
import {
  adversarialHostOptions,
  resolveEvalSession,
  runAdversarialVerb,
} from '../eval-session-composition.js'

/**
 * The families this fixture's single recorded control can carry (422-02). Four benign
 * families need a distractor surface to land on without moving the gold's normalized
 * identity, and this observation has none — so they are reported, not derived.
 */
const DERIVED_ON_THIS_SEED = [
  'benign-case',
  'benign-digit',
  'benign-whitespace',
  'confusable',
  'injection-template',
  'invisible',
  'tag-block',
]

const INAPPLICABLE_ON_THIS_SEED = [
  { mutator: 'benign-plural', reason: 'no-table-entry-applies' },
  { mutator: 'benign-punctuation', reason: 'benign-surface-absent' },
  { mutator: 'benign-synonym', reason: 'benign-surface-absent' },
  { mutator: 'benign-truncate', reason: 'benign-surface-absent' },
]

function byMutator(left: { mutator?: string }, right: { mutator?: string }): number {
  return String(left.mutator).localeCompare(String(right.mutator))
}

const roots: string[] = []

beforeEach(() => {
  // The whole adversarial path is offline: generation is pure, staging and admission are file
  // IO. A provider call here would be a defect, not a cost.
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
    admissionEvents: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        surface: 'caution',
        id: 'adversarial-tracer-record' as never,
        sourceId: 'adversarial-tracer-record',
        clusterKey: '{"role":"button","name":"continue"}',
        renderedCost: 24,
        chargeRepeated: false,
      },
    ],
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

/** Every regular file under `root`, content-addressed — the "did anything move" oracle. */
function tree(root: string): Record<string, string> {
  if (!existsSync(root)) return {}
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const path = join(entry.parentPath, entry.name)
        return [relative(root, path), readFileSync(path).toString('base64')]
      }),
  )
}

function guardrailRows(agentQaRoot: string, product = 'default'): { channel: string; action: string; detector: string }[] {
  const file = join(agentQaRoot, 'eval/audit/adversarial', product, 'guardrail_audit.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { channel: string; action: string; detector: string })
}

/**
 * A committed root holding exactly ONE proof-backed natural leaf with a resolvable gold
 * anchor and a real blob in its closure — the D-07 seed population, minimal.
 */
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
  const seeded = seedCommittedCorpus({
    plan,
    cassettes: [{ cassette: seed, blobs: extracted.blobs }],
    committedRoot,
    seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'tracer-seed'),
  })
  expect(seeded.refusals).toEqual([])
  expect(seeded.seededCount).toBe(1)
  return { ...f, committedRoot, seed, extracted }
}

async function session(f: ReturnType<typeof fixture>) {
  return resolveEvalSession({ configPath: f.configPath, keyOnly: true })
}

describe('422 adversarial tracer — stage, review, admit', () => {
  it('stages a reviewable batch and leaves every committed byte and the corpus digest unchanged', async () => {
    const f = fixture()
    const s = await session(f)
    const before = tree(f.committedRoot)

    const dry = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default', dryRun: true })
    expect(dry.kind).toBe('dry-run')
    expect(dry.staged.length).toBeGreaterThan(0)
    expect(existsSync(join(f.agentQaRoot, 'eval/adversarial'))).toBe(false)

    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    expect(staged.kind).toBe('staged')
    expect(staged.batchDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(staged.tableVersion).toBe(ADVERSARIAL_TABLE_VERSION)
    expect(staged.tableHash).toBe(ADVERSARIAL_TABLE_HASH)
    // One variant per (seed, mutator) — D-07's "exactly one", never N.
    // 422-02 expanded the derived set from two families to all eleven. This seed's single
    // recorded control supports seven of them; the four whose perturbation would move the
    // gold's normalized identity report an explicit inapplicability instead of a variant.
    expect(staged.staged.map(row => row.mutator).sort()).toEqual(DERIVED_ON_THIS_SEED)
    expect(staged.skips.map(row => ({ mutator: row.mutator, reason: row.reason })).sort(byMutator))
      .toEqual(INAPPLICABLE_ON_THIS_SEED)
    // Every declared family is accounted for exactly once — derived or explained.
    expect(
      [...staged.staged.map(row => row.mutator), ...staged.skips.map(row => row.mutator)].sort(),
    ).toEqual([...ADVERSARIAL_MUTATORS].sort())
    const confusable = staged.staged.find(row => row.mutator === 'confusable')!
    expect(confusable.seedCassetteId).toBe(f.seed.id)
    expect(confusable.cassetteId).toBe(
      deriveAdversarialCassetteId({
        seedCassetteId: f.seed.id,
        kind: 'fuzz-label',
        mutator: 'confusable',
        tableVersion: ADVERSARIAL_TABLE_VERSION,
      }),
    )

    // The whole point of D-01: proposing moved nothing a reader can see.
    expect(tree(f.committedRoot)).toEqual(before)
    expect(staged.previousCorpusDigest).toBeDefined()
    expect(staged.nextCorpusDigest).toBeUndefined()
    expect(openCorpusReader(f.committedRoot).listEntries('default').map(entry => entry.split)).toEqual(['natural'])

    // Re-staging an unchanged corpus is idempotent by derived id (D-04), not a second batch.
    const again = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    expect(again.kind).toBe('nothing-derived')
    expect(again.skips.some(skip => skip.reason === 'already-derived')).toBe(true)
  })

  it('admits only the reviewed batch, and a fresh reader then resolves the derived cassette with cloned gold and readable blob closure', async () => {
    const f = fixture()
    const s = await session(f)
    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    const batch = staged.batchDigest!

    // Admission is an explicit act naming ONE batch; it never picks one.
    const unnamed = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default', admit: true })
    expect(unnamed).toMatchObject({ kind: 'refused', reason: 'admit-requires-batch' })
    const foreign = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', admit: true, batch: 'f'.repeat(64),
    })
    expect(foreign).toMatchObject({ kind: 'refused', reason: 'batch-not-found' })

    const before = tree(f.committedRoot)
    const preview = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', admit: true, batch, dryRun: true,
    })
    expect(preview.kind).toBe('dry-run')
    expect(tree(f.committedRoot)).toEqual(before)

    const admitted = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', admit: true, batch,
    })
    expect(admitted.kind).toBe('admitted')
    expect(admitted.refusals).toEqual([])
    expect(admitted.stagingSkips).toEqual([])
    expect(admitted.admitted.map(row => row.mutator).sort()).toEqual(DERIVED_ON_THIS_SEED)
    expect(admitted.nextCorpusDigest).not.toBe(admitted.previousCorpusDigest)

    // A FRESH reader — the proposer's own door, opened after admission.
    const reader = openCorpusReader(f.committedRoot)
    const derivedId = admitted.admitted.find(row => row.mutator === 'confusable')!.cassetteId
    const entry = reader.listEntries('default').find(row => row.cassetteId === derivedId)!
    expect(entry.split).toBe('adversarial')
    expect(entry.split === 'adversarial' && entry.generator).toMatchObject({
      kind: 'fuzz-label',
      seedCassetteId: f.seed.id,
      mutator: 'confusable',
      tableVersion: ADVERSARIAL_TABLE_VERSION,
      tableHash: ADVERSARIAL_TABLE_HASH,
    })
    // D-06: the breeding run travels with the derived entry, so ROOT-03 still excludes it.
    expect(entry.run_links).toEqual({ runId: String(f.handoff.runId), runSlug: expect.any(String) })
    expect(entry.captured_at_ordinal).toBe(f.seed.receipt.buildOrdinal)

    const loaded = reader.loadCassette(derivedId)
    expect(loaded.kind).toBe('loaded')
    if (loaded.kind !== 'loaded') throw new Error('derived cassette unreadable')
    // The SURFACE moved and nothing else: same recorded action, rebuilt digests.
    expect(loaded.cassette.sidecar.goldAction).toEqual(f.seed.sidecar.goldAction)
    const derivedName = loaded.cassette.input.stateBefore.elements[0]!.name
    expect(derivedName).not.toBe(f.seed.input.stateBefore.elements[0]!.name)
    expect(loaded.cassette.receipt.promptInputHash).not.toBe(f.seed.receipt.promptInputHash)
    expect(loaded.cassette.receipt.screenStateHash).not.toBe(f.seed.receipt.screenStateHash)
    expect(loaded.cassette.receipt.buildOrdinal).toBe(f.seed.receipt.buildOrdinal)

    const label = reader.loadLabel(derivedId)
    expect(label.kind).toBe('loaded')
    if (label.kind !== 'loaded') throw new Error('derived label unreadable')
    const seedLabel = reader.loadLabel(f.seed.id)
    if (seedLabel.kind !== 'loaded') throw new Error('seed label unreadable')
    expect(label.record.label).toEqual(seedLabel.record.label)
    expect(label.record.provenance.runId).toBe(seedLabel.record.provenance.runId)
    expect(label.record.provenance.capturedAtOrdinal).toBe(seedLabel.record.provenance.capturedAtOrdinal)
    expect(label.record.derivedFrom).toMatchObject({ seedCassetteId: f.seed.id })
    expect(effectiveGold(loaded.cassette, label.record)).toMatchObject({ kind: 'eligible' })

    // Blob closure: the derived cassette's own committed blobs, byte-identical to the seed's.
    expect(loaded.cassette.blobs.length).toBeGreaterThan(0)
    for (const sha of loaded.cassette.blobs) {
      const derivedBlob = readFileSync(join(f.committedRoot, committedBlobPath('default', derivedId, sha)))
      const seedBlob = readFileSync(join(f.committedRoot, committedBlobPath('default', f.seed.id, sha)))
      expect(derivedBlob.equals(seedBlob)).toBe(true)
    }

    // The reviewed batch is retired once every case actually landed.
    expect(existsSync(join(f.agentQaRoot, 'eval/adversarial/default', batch))).toBe(false)
  })

  it('audits generation and admission on the eval-adversarial channel with injectionShape routed, never blocked', async () => {
    const f = fixture()
    const s = await session(f)
    const staged = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', mutators: ['injection-template'],
    })
    expect(staged.kind).toBe('staged')
    const generation = guardrailRows(f.agentQaRoot)
    expect(generation.length).toBeGreaterThan(0)
    expect(generation.every(row => row.channel.startsWith('eval-adversarial:'))).toBe(true)
    expect(generation.some(row => row.detector === 'injectionShape' && row.action === 'route')).toBe(true)
    // `route` is a SIGNAL, not a refusal: the injection variant is still reviewable.
    expect(staged.refusals).toEqual([])

    const admitted = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', admit: true, batch: staged.batchDigest!,
    })
    expect(admitted.kind).toBe('admitted')
    expect(admitted.refusals).toEqual([])
    const admission = guardrailRows(f.agentQaRoot).slice(generation.length)
    expect(admission.some(row => row.channel.startsWith('eval-adversarial:') && row.action === 'route')).toBe(true)
  })

  // 422-01-T2 at the public surface: the same-byte boundary must hold through the verb, not
  // only through the composition it calls.
  it('refuses a batch altered after review, leaving the committed corpus digest where it was', async () => {
    const f = fixture()
    const s = await session(f)
    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    const batch = staged.batchDigest!
    const before = tree(f.committedRoot)

    const caseFile = join(f.agentQaRoot, 'eval/adversarial/default', batch, 'case-0000', 'entry.json')
    const entry = JSON.parse(readFileSync(caseFile, 'utf8')) as Record<string, unknown>
    entry.product = 'smuggled'
    writeFileSync(caseFile, JSON.stringify(entry))

    const refused = await runAdversarialVerb(s, {
      ...adversarialHostOptions(s), product: 'default', admit: true, batch,
    })
    expect(refused).toMatchObject({ kind: 'refused', reason: 'staging-integrity' })
    expect(refused.admitted).toEqual([])
    expect(refused.writesStarted).toBe(false)
    expect(tree(f.committedRoot)).toEqual(before)
    expect(openCorpusReader(f.committedRoot).listEntries('default').map(row => row.split)).toEqual(['natural'])
  })
})

// Keep a reference so an unused-import lint never quietly drops the root-resolution helper.
void resolve
void mkdirSync
