import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  canonicalJson,
  guardBundleManifest,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  claimNextJob,
  CURATION_QUEUE_SCHEMA_VERSION,
  persistAuthoredCheckpoint,
  queuedCandidateDir,
  readCurationCandidatePayload,
  readJobState,
  verifyBundleIntegrity,
  writeJobState,
  type CurationCandidatePayload,
} from '../index.js'
import { appendOutcomeEventWithEnrichment } from '../bundle-append.js'
import {
  acquireWriterLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  readCurrentEpoch,
} from '../lease/writer-lease.js'
import {
  COMMIT_INTENT_SCHEMA_VERSION,
  JOURNAL_SUBDIR,
  listCommitIntents,
  writeCommitIntent,
  type CommitIntent,
} from '../journal/intent-journal.js'
import {
  reconcileOnDrainStart,
  type ReconcileOnDrainStartDependencies,
} from '../journal/reconcile.js'
import {
  publishBundle,
  type PublishBundleInput,
  type PublishBundleOutcome,
} from '../bundle-publish.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
} from './fixtures/bundle-fixture.js'
import {
  enqueueArtifactFreeCandidateProjection,
  type ArtifactFreeCandidateProjectionInput,
} from './fixtures/curation-candidate-fixture.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

describe('drain-start crash reconciliation (CUR-04)', () => {
  let root: string
  let knowledgeRoot: string
  let indexRows: Set<string>
  let applyIndexDelta: ReturnType<typeof vi.fn<(intent: CommitIntent) => void>>
  let deriveIndexRowFromBundle: ReturnType<typeof vi.fn<(bundleId: string) => void>>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-reconcile-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    indexRows = new Set()
    applyIndexDelta = vi.fn((intent: CommitIntent) => {
      indexRows.add(intent.bundleId)
    })
    deriveIndexRowFromBundle = vi.fn((bundleId: string) => {
      indexRows.add(bundleId)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function deps(): ReconcileOnDrainStartDependencies {
    return {
      knowledgeRoot,
      hasIndexRow: (bundleId) => indexRows.has(bundleId),
      applyIndexDelta,
      deriveIndexRowFromBundle,
    }
  }

  function bundleInput(): PublishBundleInput {
    return {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'reconcile-run',
        testId: 'reconcile-test',
        stepIndex: 0,
      },
      artifacts: [],
    }
  }

  function enrichmentBundleInput(): PublishBundleInput {
    return {
      ...bundleInput(),
      provenance: {
        mode: 'run-linked',
        runId: 'reconcile-run',
        testId: 'reconcile-test',
        stepIndex: 0,
        authorship: {
          path: 'deterministic-fallback',
          executionContext: 'local-headless',
        },
        needsEnrichment: true,
      },
    }
  }

  function publishBundleTruth(): PublishedBundle {
    const outcome = publishBundle(
      {
        knowledgeRoot,
        productKey: 'fixture-storefront',
        auditBaseDir: join(root, '.agent-qa'),
        commitArtifacts: 'none',
      },
      bundleInput(),
    )
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error(`expected publish, got ${outcome.kind}`)
    return outcome
  }

  function projectionInput(seed: string): ArtifactFreeCandidateProjectionInput {
    return {
      sourceRunId: `run-${seed}`,
      scope: { tier: 'product', key: 'fixture-storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: seed }],
      summarySeed: `${seed} selector`,
      bodySeed: `${seed} was verified`,
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: seed, ordinal: 0 },
          platform: 'web',
          element: { naturalKey: `button:${seed}` },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: `evidence-${seed}`,
      attributingObservationId: `observation-${seed}`,
      emittedAt: '2026-07-15T10:00:00.000Z',
    }
  }

  function claimWithAuthoredCheckpoint(
    seed: string,
    leaseId: string,
  ): CurationCandidatePayload {
    const outcome = enqueueArtifactFreeCandidateProjection({
      knowledgeRoot,
      projectionInput: projectionInput(seed),
    })
    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued projection')
    const { candidateId } = outcome
    const queued = readCurationCandidatePayload(
      queuedCandidateDir(knowledgeRoot, candidateId),
    )
    expect(queued.kind).toBe('parsed')
    if (queued.kind !== 'parsed') throw new Error('expected parsed projection payload')
    expect(queued.payload.candidateId).toBe(candidateId)

    const claim = claimNextJob({ knowledgeRoot, leaseId })
    expect(claim?.kind).toBe('claimed')
    if (claim?.kind !== 'claimed') throw new Error('expected claimed candidate')
    expect(claim.candidateId).toBe(candidateId)
    expect(claim.payload).toEqual(queued.payload)

    const authored = { delta: { kind: 'Add', body: seed }, neighborIds: ['record-1'] }
    const persisted = persistAuthoredCheckpoint({
      knowledgeRoot,
      candidateId,
      authored,
    })
    expect(persisted.kind).toBe('persisted')
    writeJobState({
      knowledgeRoot,
      candidateId,
      lifecycle: 'bundling',
      authored,
    })
    return queued.payload
  }

  function intent(candidateId: string, bundleId: string): CommitIntent {
    return {
      schemaVersion: COMMIT_INTENT_SCHEMA_VERSION,
      candidateId,
      bundleId,
      deltaKind: 'Add',
      epoch: 2,
    }
  }

  it('state 1 reprojects an existing row from canonical bundle truth before clearing intent', () => {
    const published = publishBundleTruth()
    const entry = intent('a'.repeat(64), published.id)
    writeCommitIntent(knowledgeRoot, entry)
    indexRows.add(published.id)

    expect(reconcileOnDrainStart(deps())).toEqual({
      intentsCleared: 1,
      intentsReplayed: 1,
      intentsDiscarded: 0,
      jobsRequeued: 0,
      orphansRemoved: 0,
      mutationsRecovered: 0,
      malformed: 0,
    })
    expect(listCommitIntents(knowledgeRoot)).toEqual([])
    expect(applyIndexDelta).toHaveBeenCalledOnce()
    expect(applyIndexDelta).toHaveBeenCalledWith(entry)
    expect(deriveIndexRowFromBundle).not.toHaveBeenCalled()
  })

  it('state 2 replays a persisted intent before clearing it when the row is missing', () => {
    const published = publishBundleTruth()
    const entry = intent('b'.repeat(64), published.id)
    writeCommitIntent(knowledgeRoot, entry)

    const report = reconcileOnDrainStart(deps())

    expect(applyIndexDelta).toHaveBeenCalledOnce()
    expect(applyIndexDelta).toHaveBeenCalledWith(entry)
    expect(indexRows.has(published.id)).toBe(true)
    expect(listCommitIntents(knowledgeRoot)).toEqual([])
    expect(report).toMatchObject({ intentsCleared: 1, intentsReplayed: 1 })
  })

  it('state 3 discards an intent without bundle truth and returns the job to queued', () => {
    const payload = claimWithAuthoredCheckpoint(
      'missing-bundle',
      'dead-lease',
    )
    writeCommitIntent(
      knowledgeRoot,
      intent(payload.candidateId, 'fact-never-published-0123456789abcdef'),
    )

    const report = reconcileOnDrainStart(deps())

    expect(report).toMatchObject({ intentsDiscarded: 1, jobsRequeued: 1 })
    expect(listCommitIntents(knowledgeRoot)).toEqual([])
    expect(existsSync(queuedCandidateDir(knowledgeRoot, payload.candidateId))).toBe(true)
    const state = readJobState(knowledgeRoot, payload.candidateId)
    expect(state.kind).toBe('parsed')
    if (state.kind !== 'parsed') throw new Error('expected requeued state')
    expect(state.state.lifecycle).toBe('queued')
    expect(state.state.authored).toEqual({
      delta: { kind: 'Add', body: 'missing-bundle' },
      neighborIds: ['record-1'],
    })
    expect(applyIndexDelta).not.toHaveBeenCalled()
  })

  it('state 4 re-derives an orphan bundle row and a second pass is a no-op', () => {
    const published = publishBundleTruth()

    const first = reconcileOnDrainStart(deps())

    expect(deriveIndexRowFromBundle).toHaveBeenCalledOnce()
    expect(deriveIndexRowFromBundle).toHaveBeenCalledWith(published.id)
    expect(indexRows.has(published.id)).toBe(true)
    expect(first).toEqual({
      intentsCleared: 0,
      intentsReplayed: 0,
      intentsDiscarded: 0,
      jobsRequeued: 0,
      orphansRemoved: 0,
      mutationsRecovered: 0,
      malformed: 0,
    })

    applyIndexDelta.mockClear()
    deriveIndexRowFromBundle.mockClear()
    expect(reconcileOnDrainStart(deps())).toEqual(first)
    expect(applyIndexDelta).not.toHaveBeenCalled()
    expect(deriveIndexRowFromBundle).not.toHaveBeenCalled()
  })

  it('state 5 leaves an indexed bundle with pending vector healing to the writer pass', () => {
    const published = publishBundleTruth()
    indexRows.add(published.id)

    reconcileOnDrainStart(deps())

    expect(applyIndexDelta).not.toHaveBeenCalled()
    expect(deriveIndexRowFromBundle).not.toHaveBeenCalled()
  })

  it('discards malformed intent bytes and fails toward re-processing the candidate', () => {
    const payload = claimWithAuthoredCheckpoint(
      'malformed-intent',
      'dead-malformed',
    )
    const file = join(
      knowledgeRoot,
      JOURNAL_SUBDIR,
      `${payload.candidateId}.intent.json`,
    )
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '{torn-intent', 'utf8')

    const report = reconcileOnDrainStart(deps())

    expect(report).toMatchObject({
      intentsDiscarded: 1,
      jobsRequeued: 1,
      malformed: 1,
    })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(queuedCandidateDir(knowledgeRoot, payload.candidateId))).toBe(true)
  })

  it('reclaims a stale lease, preserves authored work, and GCs only its staging dirs', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const stale = acquireWriterLease(knowledgeRoot)
    expect(stale.kind).toBe('acquired')
    if (stale.kind !== 'acquired') throw new Error('expected stale holder setup')
    const payload = claimWithAuthoredCheckpoint(
      'stale-reclaim',
      stale.leaseId,
    )

    now.mockReturnValue(1_000_000 + LEASE_HEARTBEAT_TTL_MS)
    const current = acquireWriterLease(knowledgeRoot)
    expect(current.kind).toBe('acquired')
    if (current.kind !== 'acquired') throw new Error('expected reclaimed current holder')
    expect(readCurrentEpoch(knowledgeRoot)).toBe(2)

    const stagingRoot = join(
      knowledgeRoot,
      'memory',
      'fixture-storefront',
      'bundles',
      '.staging',
    )
    const staleStaging = join(stagingRoot, `${stale.leaseId}-orphan-bundle`)
    const freshStaging = join(stagingRoot, `${current.leaseId}-active-bundle`)
    mkdirSync(staleStaging, { recursive: true })
    mkdirSync(freshStaging, { recursive: true })
    writeFileSync(join(staleStaging, 'partial'), 'stale', 'utf8')
    writeFileSync(join(freshStaging, 'partial'), 'fresh', 'utf8')

    const report = reconcileOnDrainStart(deps())

    expect(report).toMatchObject({ jobsRequeued: 1, orphansRemoved: 1 })
    expect(existsSync(staleStaging)).toBe(false)
    expect(existsSync(freshStaging)).toBe(true)
    expect(existsSync(join(knowledgeRoot, LEASE_FILE))).toBe(true)
    expect(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')).toContain(current.leaseId)
    expect(existsSync(queuedCandidateDir(knowledgeRoot, payload.candidateId))).toBe(true)
    const state = readJobState(knowledgeRoot, payload.candidateId)
    expect(state.kind).toBe('parsed')
    if (state.kind !== 'parsed') throw new Error('expected stale job to be requeued')
    expect(state.state.authored).toEqual({
      delta: { kind: 'Add', body: 'stale-reclaim' },
      neighborIds: ['record-1'],
    })
  })

  it('recovers a partial expired-lease enrichment before stale GC and refreshes its existing row', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    const stale = acquireWriterLease(knowledgeRoot)
    expect(stale.kind).toBe('acquired')
    if (stale.kind !== 'acquired') throw new Error('expected stale holder setup')
    const payload = claimWithAuthoredCheckpoint(
      'partial-enrichment',
      stale.leaseId,
    )
    const published = publishBundle(
      {
        knowledgeRoot,
        productKey: 'fixture-storefront',
        auditBaseDir: join(root, '.agent-qa'),
        commitArtifacts: 'none',
        writerLeaseId: stale.leaseId,
      },
      enrichmentBundleInput(),
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected enrichment fixture bundle')
    writeCommitIntent(knowledgeRoot, intent(payload.candidateId, published.id))
    indexRows.add(published.id)

    expect(() =>
      appendOutcomeEventWithEnrichment(
        {
          knowledgeRoot,
          productKey: 'fixture-storefront',
          auditBaseDir: join(root, '.agent-qa'),
          commitArtifacts: 'none',
          writerLeaseId: stale.leaseId,
          hooks: {
            afterMutableReplacement(relPath) {
              if (relPath === 'record.md') throw new Error('injected partial enrichment')
            },
          },
        },
        published.id,
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: 'recovered-enrichment',
          curationJobId: payload.candidateId,
          buildOrdinal: 43,
          origin: 'agent-verified',
        }),
        {
          summary: 'Recovered capable-model selector',
          body: 'The recovered mutation contains verified capable-model prose.',
          authorship: {
            path: 'llm',
            model: { id: 'recovery-curator' },
            executionContext: 'local-interactive',
          },
        },
      ),
    ).toThrow('injected partial enrichment')
    expect(verifyBundleIntegrity(published.dir).ok).toBe(false)

    const stagingRoot = join(published.dir, '..', '.staging')
    const mutationDir = join(
      stagingRoot,
      readdirSync(stagingRoot).find((name) => name.includes('-mutation-'))!,
    )
    const ordinaryStaging = join(stagingRoot, `${stale.leaseId}-unpublished-bundle`)
    mkdirSync(ordinaryStaging)
    writeFileSync(join(ordinaryStaging, 'partial'), 'ordinary stale staging', 'utf8')

    let projectedMutableStateHash: string | undefined
    applyIndexDelta.mockImplementation((entry) => {
      indexRows.add(entry.bundleId)
      projectedMutableStateHash = guardBundleManifest(
        JSON.parse(readFileSync(join(published.dir, 'manifest.json'), 'utf8')),
      ).mutableStateHash
    })
    now.mockReturnValue(2_000_000 + LEASE_HEARTBEAT_TTL_MS)
    expect(acquireWriterLease(knowledgeRoot).kind).toBe('acquired')

    const report = reconcileOnDrainStart(deps())

    expect(report).toMatchObject({
      mutationsRecovered: 1,
      orphansRemoved: 1,
      intentsCleared: 1,
      intentsReplayed: 1,
      jobsRequeued: 1,
    })
    expect(existsSync(mutationDir)).toBe(false)
    expect(existsSync(ordinaryStaging)).toBe(false)
    expect(verifyBundleIntegrity(published.dir)).toEqual({ ok: true, violations: [] })
    const repairedManifest = guardBundleManifest(
      JSON.parse(readFileSync(join(published.dir, 'manifest.json'), 'utf8')),
    )
    expect(projectedMutableStateHash).toBe(repairedManifest.mutableStateHash)
    expect(applyIndexDelta).toHaveBeenCalledWith(intent(payload.candidateId, published.id))
    expect(listCommitIntents(knowledgeRoot)).toEqual([])

    applyIndexDelta.mockClear()
    expect(reconcileOnDrainStart(deps())).toMatchObject({ mutationsRecovered: 0 })
    expect(applyIndexDelta).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'malformed journal',
      tamper(transactionDir: string) {
        writeFileSync(join(transactionDir, 'mutation.json'), '{torn-journal', 'utf8')
      },
    },
    {
      label: 'digest-mismatched recovery copy',
      tamper(transactionDir: string) {
        writeFileSync(join(transactionDir, 'recovery', '0001'), 'tampered', 'utf8')
      },
    },
    {
      label: 'path-escaping target',
      tamper(transactionDir: string) {
        const journalPath = join(transactionDir, 'mutation.json')
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          replacements: { targetRelPath: string }[]
        }
        journal.replacements[0]!.targetRelPath = '../record.md'
        writeFileSync(journalPath, `${canonicalJson(journal)}\n`, 'utf8')
      },
    },
  ])('preserves expired mutation evidence for a $label', ({ tamper }) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000_000)
    const stale = acquireWriterLease(knowledgeRoot)
    expect(stale.kind).toBe('acquired')
    if (stale.kind !== 'acquired') throw new Error('expected stale holder setup')
    claimWithAuthoredCheckpoint(
      'malformed-mutation',
      stale.leaseId,
    )
    const published = publishBundle(
      {
        knowledgeRoot,
        productKey: 'fixture-storefront',
        auditBaseDir: join(root, '.agent-qa'),
        commitArtifacts: 'none',
        writerLeaseId: stale.leaseId,
      },
      enrichmentBundleInput(),
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected mutation fixture bundle')

    expect(() =>
      appendOutcomeEventWithEnrichment(
        {
          knowledgeRoot,
          productKey: 'fixture-storefront',
          auditBaseDir: join(root, '.agent-qa'),
          commitArtifacts: 'none',
          writerLeaseId: stale.leaseId,
          hooks: {
            afterMutableReplacement() {
              throw new Error('leave mutation journal')
            },
          },
        },
        published.id,
        BundleOutcomeEventSchema.parse({
          type: 'confirmed',
          evidenceToken: 'malformed-recovery',
          curationJobId: 'malformed-recovery-job',
          buildOrdinal: 43,
          origin: 'agent-verified',
        }),
        {
          summary: 'Recovery evidence',
          body: 'Recovery evidence must remain durable.',
          authorship: {
            path: 'llm',
            model: { id: 'recovery-curator' },
            executionContext: 'local-interactive',
          },
        },
      ),
    ).toThrow('leave mutation journal')
    const stagingRoot = join(published.dir, '..', '.staging')
    const transactionDir = join(stagingRoot, readdirSync(stagingRoot)[0]!)
    tamper(transactionDir)

    now.mockReturnValue(3_000_000 + LEASE_HEARTBEAT_TTL_MS)
    expect(acquireWriterLease(knowledgeRoot).kind).toBe('acquired')

    expect(() => reconcileOnDrainStart(deps())).toThrow()
    expect(existsSync(transactionDir)).toBe(true)
  })

  it('has no author or model invocation slot in its dependency surface', () => {
    type HasNoAuthor = 'author' extends keyof ReconcileOnDrainStartDependencies ? false : true
    const hasNoAuthor: HasNoAuthor = true

    expect(hasNoAuthor).toBe(true)
    expect(Object.keys(deps()).sort()).toEqual([
      'applyIndexDelta',
      'deriveIndexRowFromBundle',
      'hasIndexRow',
      'knowledgeRoot',
    ])
  })
})
