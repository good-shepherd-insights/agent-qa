// 422-03-T2 — admission as RECOVERABLE work over a FIXED batch.
//
// 422-01 proved admission commits the reviewed bytes or nothing. That is the right law for a
// batch that either finishes or never starts. It is the wrong law for a batch interrupted in
// the middle: the disk does not roll back, so a run that dies after committing case one has
// already moved the corpus, and an admission that then reports "nothing admitted" is telling
// the operator something false about a git-tracked root.
//
// So the contract here is progress-preserving rather than all-or-nothing:
//
//   * the whole batch is preflighted — integrity, provenance, exact bytes, the loaded policy
//     and every referenced blob — BEFORE the first case is committed, so an interruption can
//     only ever happen between cases that were each already judged admissible;
//   * a case that landed stays landed, and the reviewed batch stays on disk;
//   * a retry resumes THAT manifest and nothing else, reporting the survivor as `unchanged`
//     rather than re-admitting it or refusing it;
//   * admitted, unchanged, refused and remaining are four separate counts, because collapsing
//     them is exactly how a partial admission comes to look like a complete one.
//
// Membership is fixed by the manifest, not by the corpus: a case staged WHILE an admission is
// running belongs to a different batch digest and is not admitted, not counted, and not
// retired. Nothing here derives anything — admission never calls the generator.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  committedFileText,
  computeCorpusDigest,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type ArtifactSource,
  type LeafCassette,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import {
  listStagedAdversarial,
  loadAdversarialGuardrailPolicy,
  refreshAdversarialSplit,
  stageAdversarialProposal,
  type AdversarialAdmissionResult,
} from '../adversarial-composition.js'
import { readCommittedCorpus } from '../committed-corpus-source.js'
import { committedCassettePath } from '../committed-root-store.js'
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

const POLICY = loadAdversarialGuardrailPolicy()

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

/** `count` committed proof-backed natural leaf seeds, one per run so the ids differ. */
function fixture(count: number): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adversarial-admission-'))
  roots.push(root)
  const committedRoot = join(root, 'committed')
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  const seedIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    const handoff = makeLocalV2Handoff({
      runId: asRunId(`run / adversarial-admission ${String(index).padStart(2, '0')}`),
    })
    const member = handoff.tests[0]!
    member.steps = [member.steps[0]!]
    const brief = member.steps[0]!.servedBrief
    brief.proof = proof()
    brief.channel3 = [{ id: 'adversarial-admission-caution' as never, anchors: [], summary: 'served caution' }]
    brief.briefDigest = computeBriefDigest(brief)
    const extraction = extractRunCassettes({ handoff, artifacts })
    const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
    const seed = extracted.cassette as LeafCassette
    const plan: SeedingPlan = {
      product: 'default',
      runId: handoff.runId,
      runSlug: `adversarial-admission-${String(index).padStart(2, '0')}`,
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
    expect(
      seedCommittedCorpus({
        plan,
        cassettes: [{ cassette: seed, blobs: extracted.blobs }],
        committedRoot,
        seedingOutputBaseDir: join(agentQaRoot, 'eval', 'audit', 'admission-seed'),
      }).refusals,
    ).toEqual([])
    seedIds.push(seed.id)
  }
  return { root, committedRoot, agentQaRoot, seedIds: [...seedIds].sort() }
}

async function stage(f: Fixture, mutator: 'confusable' | 'invisible' = 'confusable') {
  const staged = await stageAdversarialProposal({
    agentQaRoot: f.agentQaRoot,
    committedRoot: f.committedRoot,
    product: 'default',
    policy: POLICY,
    mutators: [mutator],
  })
  expect(staged.kind).toBe('staged')
  return staged
}

function admit(
  f: Fixture,
  batchDigest: string,
  opts: { afterCaseCommitted?: (cassetteId: string) => void; dryRun?: boolean } = {},
): AdversarialAdmissionResult {
  return refreshAdversarialSplit({
    agentQaRoot: f.agentQaRoot,
    committedRoot: f.committedRoot,
    product: 'default',
    batchDigest,
    policy: POLICY,
    seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'admission-admit'),
    ...(opts.afterCaseCommitted === undefined ? {} : { afterCaseCommitted: opts.afterCaseCommitted }),
    ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }),
  })
}

function corpusDigest(committedRoot: string): string {
  return computeCorpusDigest(readCommittedCorpus(committedRoot).snapshot.entries)
}

function committedIds(committedRoot: string): string[] {
  return readCommittedCorpus(committedRoot)
    .snapshot.entries.filter(entry => entry.split === 'adversarial')
    .map(entry => entry.cassetteId)
    .sort()
}

describe('422 adversarial admission — fixed batch, recoverable commit', () => {
  it('keeps the case committed before an injected failure and finishes the original batch on retry', async () => {
    const f = fixture(3)
    const staged = await stage(f)
    expect(staged.staged).toHaveLength(3)
    const batch = staged.batchDigest!
    const reviewed = staged.staged.map(row => row.cassetteId).sort()
    const before = corpusDigest(f.committedRoot)

    // Interrupt AFTER the first case's bytes land — the disk does not roll back, so neither
    // may the report.
    let committed = 0
    const interrupted = admit(f, batch, {
      afterCaseCommitted: () => {
        committed += 1
        if (committed === 1) throw new Error('injected IO interruption')
      },
    })

    expect(interrupted.kind).toBe('partial')
    expect(interrupted.reason).toBe('admission-interrupted')
    expect(interrupted.writesStarted).toBe(true)
    expect(interrupted.admitted).toHaveLength(1)
    expect(interrupted.unchanged).toEqual([])
    expect(interrupted.remaining).toHaveLength(2)
    // Four separate counts: collapsing them is how a partial admission passes for a whole one.
    expect([...interrupted.admitted, ...interrupted.remaining].map(row => row.cassetteId).sort())
      .toEqual(reviewed)
    expect(committedIds(f.committedRoot)).toEqual([interrupted.admitted[0]!.cassetteId])
    expect(interrupted.nextCorpusDigest).not.toBe(before)

    // The reviewed batch survives so the operator can resume exactly it.
    const surviving = listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })
    expect(surviving.map(row => row.manifest.batchDigest)).toEqual([batch])

    const resumed = admit(f, batch)

    expect(resumed.kind).toBe('admitted')
    expect(resumed.admitted).toHaveLength(2)
    // The survivor is UNCHANGED — neither re-admitted (which would double-count) nor refused
    // (which would call the operator's own committed bytes a conflict).
    expect(resumed.unchanged.map(row => row.cassetteId))
      .toEqual([interrupted.admitted[0]!.cassetteId])
    expect(resumed.remaining).toEqual([])
    expect(resumed.refusals).toEqual([])
    expect(committedIds(f.committedRoot)).toEqual(reviewed)
    // Every reviewed member landed, so the batch is retired.
    expect(listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })).toEqual([])
  })

  it('refuses a committed id whose bytes differ, overwriting no history and moving no digest', async () => {
    const f = fixture(2)
    const staged = await stage(f)
    const batch = staged.batchDigest!

    // Land exactly one case, then let its committed bytes drift — a hand edit, or a case
    // committed under some other generator. The id is the same; the bytes are not.
    let committed = 0
    const partial = admit(f, batch, {
      afterCaseCommitted: () => {
        committed += 1
        if (committed === 1) throw new Error('injected IO interruption')
      },
    })
    const drifted = partial.admitted[0]!.cassetteId
    const file = join(f.committedRoot, committedCassettePath('default', drifted))
    const document = JSON.parse(readFileSync(file, 'utf8')) as { input: { stateBefore: { url: string } } }
    document.input.stateBefore.url = 'https://example.test/edited-after-commit'
    const foreign = committedFileText(document)
    writeFileSync(file, foreign)
    const before = corpusDigest(f.committedRoot)

    const retried = admit(f, batch)

    // Admission does not get to decide which of two versions of one id is right.
    expect(retried.stagingSkips).toMatchObject([{ cassetteId: drifted, reason: 'committed-conflict' }])
    expect(retried.unchanged).toEqual([])
    expect(retried.admitted.map(row => row.cassetteId)).not.toContain(drifted)
    expect(readFileSync(file, 'utf8')).toBe(foreign)
    // The conflicting member never lands, so the batch is neither complete nor retired.
    expect(retried.kind).toBe('partial')
    expect(retried.remaining.map(row => row.cassetteId)).toEqual([drifted])
    expect(listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })).toHaveLength(1)
    // The OTHER case still landed, so the digest moves for it and only for it.
    expect(corpusDigest(f.committedRoot)).not.toBe(before)
    expect(retried.nextCorpusDigest).toBe(corpusDigest(f.committedRoot))
  })

  it('leaves the digest stable for an absent batch and for one already fully committed', async () => {
    const f = fixture(2)
    const staged = await stage(f)
    const batch = staged.batchDigest!

    // An absent batch admits nothing and touches nothing.
    const before = corpusDigest(f.committedRoot)
    const absent = admit(f, 'a'.repeat(64))
    expect(absent).toMatchObject({ kind: 'refused', reason: 'batch-not-found' })
    expect(absent.admitted).toEqual([])
    expect(absent.unchanged).toEqual([])
    expect(absent.remaining).toEqual([])
    expect(absent.writesStarted).toBe(false)
    expect(corpusDigest(f.committedRoot)).toBe(before)

    // Interrupt after the LAST case, so every member landed but the batch was never retired —
    // the duplicate-admission case an interrupted run actually produces.
    let committed = 0
    const interrupted = admit(f, batch, {
      afterCaseCommitted: () => {
        committed += 1
        if (committed === 2) throw new Error('injected IO interruption after the last case')
      },
    })
    expect(interrupted.admitted).toHaveLength(2)
    const settled = corpusDigest(f.committedRoot)

    const duplicate = admit(f, batch)
    expect(duplicate.kind).toBe('admitted')
    expect(duplicate.admitted).toEqual([])
    expect(duplicate.unchanged).toHaveLength(2)
    expect(duplicate.remaining).toEqual([])
    expect(corpusDigest(f.committedRoot)).toBe(settled)
    expect(duplicate.nextCorpusDigest).toBe(settled)
  })

  it('never draws a case staged during the admission into the reviewed batch', async () => {
    const f = fixture(2)
    const reviewedBatch = await stage(f, 'confusable')
    const reviewedIds = reviewedBatch.staged.map(row => row.cassetteId).sort()

    let later: ReturnType<typeof stage> | undefined
    const admitted = admit(f, reviewedBatch.batchDigest!, {
      afterCaseCommitted: () => {
        // A second batch appears mid-admission. It is real, reviewable, and none of this
        // admission's business: membership was fixed by the manifest, not by the corpus.
        //
        // 422-06: staging is now `async` because it may author probes. This host binds NO
        // author, so the coroutine reaches no `await` and its whole body — the derivation, the
        // scan and the publishing rename — runs synchronously inside this hook, exactly as it
        // did before. The `expect` on the next line is the proof, not the assumption: the batch
        // directory has to exist at this instant for the scenario to be the one under test.
        later ??= stage(f, 'invisible')
        expect(listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })).toHaveLength(2)
      },
    })

    expect(admitted.kind).toBe('admitted')
    expect(admitted.admitted.map(row => row.cassetteId).sort()).toEqual(reviewedIds)
    expect(admitted.remaining).toEqual([])
    expect(later).toBeDefined()
    const laterBatch = await later!
    const laterIds = laterBatch.staged.map(row => row.cassetteId)
    expect(laterIds.length).toBeGreaterThan(0)
    expect(laterIds.some(id => reviewedIds.includes(id))).toBe(false)
    expect(committedIds(f.committedRoot)).toEqual(reviewedIds)

    // Only the admitted batch is retired; the new one is still there to be reviewed.
    expect(
      listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })
        .map(row => row.manifest.batchDigest),
    ).toEqual([laterBatch.batchDigest])
  })
})
