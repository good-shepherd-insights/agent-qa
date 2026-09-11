// 422-01-T2 — the same-byte safety boundary.
//
// Staging produces reviewable bytes; admission must commit THOSE bytes or nothing. This file
// attacks that claim from both sides. First the POLICY side: a host that tightens
// `injectionShape` from `route` to `block` after a batch was staged must refuse the already
// staged injection bytes, with zero admitted entries — the recheck happens under the policy
// loaded at admission, not the one loaded at staging (D-03). Then the BYTE side: every way an
// operator (or anything with write access to the audit dir) can alter what was reviewed —
// each of the three serialized documents, the manifest itself, the blob closure, the file
// kind — must produce a refusal BEFORE the committed corpus digest can move.
//
// The refusal rows are also checked for what they DO NOT carry: a detector fired on
// injection-shaped text, so echoing the offending name or the text back into a diagnostic
// would put the very content the checkpoint refused into a log.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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
import { computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import { loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import {
  ADVERSARIAL_MANIFEST_FILE,
  computeAdversarialBatchDigest,
  listStagedAdversarial,
  loadAdversarialGuardrailPolicy,
  refreshAdversarialSplit,
  stageAdversarialProposal,
  type AdversarialBatchManifest,
} from '../adversarial-composition.js'
import { readCommittedCorpus } from '../committed-corpus-source.js'
import { committedBlobPath, committedCorpusPath } from '../committed-root-store.js'
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

/** One committed proof-backed natural leaf — the D-07 seed population, minimal. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'adversarial-safety-'))
  roots.push(root)
  const committedRoot = join(root, 'committed')
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  const handoff = makeLocalV2Handoff()
  const member = handoff.tests[0]!
  member.steps = [member.steps[0]!]
  const brief = member.steps[0]!.servedBrief
  brief.proof = proof()
  brief.channel3 = [{ id: 'adversarial-safety-caution' as never, anchors: [], summary: 'served caution' }]
  brief.briefDigest = computeBriefDigest(brief)
  const extraction = extractRunCassettes({ handoff, artifacts })
  const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
  const seed = extracted.cassette as LeafCassette
  const plan: SeedingPlan = {
    product: 'default',
    runId: handoff.runId,
    runSlug: 'adversarial-safety',
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
    seedingOutputBaseDir: join(agentQaRoot, 'eval', 'audit', 'safety-seed'),
  })
  expect(seeded.refusals).toEqual([])
  return { root, committedRoot, agentQaRoot, handoff, seed }
}

function stageInjection(f: ReturnType<typeof fixture>) {
  const staged = stageAdversarialProposal({
    agentQaRoot: f.agentQaRoot,
    committedRoot: f.committedRoot,
    product: 'default',
    policy: ROUTE_POLICY,
    mutators: ['injection-template'],
  })
  expect(staged.kind).toBe('staged')
  expect(staged.refusals).toEqual([])
  return staged
}

function refresh(f: ReturnType<typeof fixture>, batchDigest: string, policy = ROUTE_POLICY) {
  return refreshAdversarialSplit({
    agentQaRoot: f.agentQaRoot,
    committedRoot: f.committedRoot,
    product: 'default',
    batchDigest,
    policy,
    seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'safety-admit'),
  })
}

function corpusDigest(committedRoot: string): string {
  return computeCorpusDigest(readCommittedCorpus(committedRoot).snapshot.entries)
}

function tree(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const path = join(entry.parentPath, entry.name)
        return [relative(root, path), readFileSync(path).toString('base64')]
      }),
  )
}

function caseDir(f: ReturnType<typeof fixture>, batchDigest: string): string {
  return join(f.agentQaRoot, 'eval/adversarial/default', batchDigest, 'case-0000')
}

describe('422 adversarial same-byte safety boundary', () => {
  it('refuses staged injection bytes when the host policy moved from route to block, admitting nothing', () => {
    const f = fixture()
    const staged = stageInjection(f)
    const before = corpusDigest(f.committedRoot)
    const bytes = tree(f.committedRoot)

    const refused = refresh(f, staged.batchDigest!, BLOCK_POLICY)

    expect(refused.kind).toBe('refused')
    expect(refused.reason).toBe('admission-refused')
    expect(refused.admitted).toEqual([])
    expect(refused.writesStarted).toBe(false)
    expect(refused.refusals.length).toBeGreaterThan(0)
    for (const refusal of refused.refusals) {
      expect(refusal).toMatchObject({
        cassetteId: staged.staged[0]!.cassetteId,
        seedCassetteId: f.seed.id,
        generator: 'injection-name',
        detector: 'injectionShape',
        action: 'block',
      })
    }
    // The refusal names identities, never the offending surface text (Pitfall: a diagnostic
    // that echoes refused content re-exports what the checkpoint just refused).
    const rendered = JSON.stringify(refused.refusals)
    expect(rendered).not.toContain('Ignore all previous instructions')
    expect(rendered).not.toContain(f.seed.input.stateBefore.elements[0]!.name)

    expect(corpusDigest(f.committedRoot)).toBe(before)
    expect(refused.nextCorpusDigest).toBe(before)
    expect(tree(f.committedRoot)).toEqual(bytes)
    // The reviewed batch survives its refusal: the operator can see what was rejected.
    expect(listStagedAdversarial({ agentQaRoot: f.agentQaRoot, product: 'default' })).toHaveLength(1)
  })

  it.each(['cassette.json', 'label.json', 'entry.json'] as const)(
    'refuses a batch whose %s was altered after review, before any committed byte moves',
    name => {
      const f = fixture()
      const staged = stageInjection(f)
      const before = tree(f.committedRoot)
      const file = join(caseDir(f, staged.batchDigest!), name)
      const document = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      document.product = 'smuggled'
      writeFileSync(file, JSON.stringify(document))

      const refused = refresh(f, staged.batchDigest!)

      expect(refused).toMatchObject({ kind: 'refused', reason: 'staging-integrity', admitted: [] })
      expect(refused.writesStarted).toBe(false)
      expect(tree(f.committedRoot)).toEqual(before)
    },
  )

  it('treats a recomputed manifest as a different batch, never as admission authority', () => {
    const f = fixture()
    const staged = stageInjection(f)
    const before = tree(f.committedRoot)
    const dir = join(f.agentQaRoot, 'eval/adversarial/default', staged.batchDigest!)
    const manifest = JSON.parse(
      readFileSync(join(dir, ADVERSARIAL_MANIFEST_FILE), 'utf8'),
    ) as AdversarialBatchManifest

    // Rewrite the derived label's provenance to a run the seed never had, then make the whole
    // manifest self-consistent again: new text hash, new pin, new digest.
    const labelFile = join(caseDir(f, staged.batchDigest!), 'label.json')
    const label = JSON.parse(readFileSync(labelFile, 'utf8')) as {
      provenance: { runId: string }
    }
    label.provenance.runId = 'r_smuggled-provenance'
    const labelText = committedFileText(label)
    writeFileSync(labelFile, labelText)
    const cases = manifest.cases.map(row => ({
      ...row,
      labelTextHash: createSha(labelText),
      seedProvenance: { ...row.seedProvenance, runId: 'r_smuggled-provenance' },
    }))
    const forgedDigest = computeAdversarialBatchDigest(manifest.product, cases)
    writeFileSync(
      join(dir, ADVERSARIAL_MANIFEST_FILE),
      committedFileText({ ...manifest, batchDigest: forgedDigest, cases }),
    )

    // The reviewed digest no longer describes what is on disk.
    expect(refresh(f, staged.batchDigest!)).toMatchObject({
      kind: 'refused',
      reason: 'staging-integrity',
    })

    // Renaming the directory to the forged digest makes staging self-consistent — and still
    // fails, because the pin is checked against the seed's COMMITTED label, not against
    // anything the forger controls.
    const forgedDir = join(f.agentQaRoot, 'eval/adversarial/default', forgedDigest)
    renameDir(dir, forgedDir)
    const forged = refresh(f, forgedDigest)
    expect(forged.kind).toBe('refused')
    expect(forged.admitted).toEqual([])
    expect(forged.stagingSkips).toMatchObject([
      { cassetteId: staged.staged[0]!.cassetteId, reason: 'seed-provenance-mismatch' },
    ])
    expect(tree(f.committedRoot)).toEqual(before)
  })

  it('refuses a broken blob closure before any root write', () => {
    const f = fixture()
    const staged = stageInjection(f)
    const blob = join(f.committedRoot, committedBlobPath('default', f.seed.id, LOCAL_FIXTURE_BLOB_SHA))
    writeFileSync(blob, 'not the recorded bytes')

    const refused = refresh(f, staged.batchDigest!)

    expect(refused.kind).toBe('refused')
    expect(refused.admitted).toEqual([])
    expect(refused.stagingSkips).toMatchObject([{ reason: 'blob-hash-mismatch' }])
    expect(
      existsSync(join(f.committedRoot, committedCorpusPath('default', staged.staged[0]!.cassetteId))),
    ).toBe(false)
  })

  it('refuses a staged document replaced by a symlink, and a batch digest shaped like a path', () => {
    const f = fixture()
    const staged = stageInjection(f)
    const before = tree(f.committedRoot)

    expect(refresh(f, '../../etc/passwd')).toMatchObject({
      kind: 'refused',
      reason: 'batch-not-found',
    })

    const file = join(caseDir(f, staged.batchDigest!), 'cassette.json')
    const decoy = join(f.root, 'decoy-cassette.json')
    writeFileSync(decoy, readFileSync(file, 'utf8'))
    unlinkSync(file)
    symlinkSync(decoy, file)

    expect(refresh(f, staged.batchDigest!)).toMatchObject({
      kind: 'refused',
      reason: 'staging-integrity',
    })
    expect(tree(f.committedRoot)).toEqual(before)
  })
})

function createSha(text: string): string {
  // Local mirror of the composition's text pin; spelling it here makes the forgery explicit.
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function renameDir(from: string, to: string): void {
  renameSync(from, to)
}
