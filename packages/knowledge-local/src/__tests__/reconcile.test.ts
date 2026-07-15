import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  candidateContentAddress,
  claimNextJob,
  CURATION_QUEUE_SCHEMA_VERSION,
  enqueueCurationCandidate,
  persistAuthoredCheckpoint,
  queuedCandidateDir,
  readJobState,
  writeJobState,
  type CurationCandidateAddressFields,
  type CurationCandidatePayload,
} from '../index.js'
import {
  acquireWriterLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  readCurrentEpoch,
} from '../lease/writer-lease.js'
import {
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

  function queuePayload(seed: string): CurationCandidatePayload {
    const fields: CurationCandidateAddressFields = {
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
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
      artifactInventory: [],
      emittedAt: '2026-07-15T10:00:00.000Z',
    }
    return { candidateId: candidateContentAddress(fields), ...fields }
  }

  function claimWithAuthoredCheckpoint(seed: string, leaseId: string): CurationCandidatePayload {
    const payload = queuePayload(seed)
    expect(
      enqueueCurationCandidate({ knowledgeRoot, payload, artifactSources: [] }),
    ).toBe('enqueued')
    const claim = claimNextJob({ knowledgeRoot, leaseId })
    expect(claim?.kind).toBe('claimed')
    if (claim?.kind !== 'claimed') throw new Error('expected claimed candidate')
    const authored = { delta: { kind: 'Add', body: seed }, neighborIds: ['record-1'] }
    const persisted = persistAuthoredCheckpoint({
      knowledgeRoot,
      candidateId: payload.candidateId,
      authored,
    })
    expect(persisted.kind).toBe('persisted')
    writeJobState({
      knowledgeRoot,
      candidateId: payload.candidateId,
      lifecycle: 'bundling',
      authored,
    })
    return payload
  }

  function intent(candidateId: string, bundleId: string): CommitIntent {
    return {
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      candidateId,
      bundleId,
      deltaKind: 'Add',
      epoch: 2,
    }
  }

  it('state 1 clears an intent when both bundle and index row are present', () => {
    const published = publishBundleTruth()
    const entry = intent('a'.repeat(64), published.id)
    writeCommitIntent(knowledgeRoot, entry)
    indexRows.add(published.id)

    expect(reconcileOnDrainStart(deps())).toEqual({
      intentsCleared: 1,
      intentsReplayed: 0,
      intentsDiscarded: 0,
      jobsRequeued: 0,
      orphansRemoved: 0,
      malformed: 0,
    })
    expect(listCommitIntents(knowledgeRoot)).toEqual([])
    expect(applyIndexDelta).not.toHaveBeenCalled()
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
    const payload = claimWithAuthoredCheckpoint('missing-bundle', 'dead-lease')
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
    const payload = claimWithAuthoredCheckpoint('malformed-intent', 'dead-malformed')
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
    const payload = claimWithAuthoredCheckpoint('stale-reclaim', stale.leaseId)

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
