import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  BundleOutcomeEventSchema,
  asEvidenceToken,
  asRecordId,
  slugBranch,
  type Anchor,
  type BundleDraft,
  type Delta,
  type MeasurementObservation,
  type RecordId,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as publicSurface from '../index.js'
import { loadBundle, readMeasurements } from '../bundle-read.js'
import { enumerateBundleDirs } from '../bundle-scan.js'
import {
  finalizeStagedBundle,
  publishBundle,
  stageBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.test-helper.js'
import { candidateAddressFixture } from './fixtures/curation-candidate-fixture.js'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  candidateContentAddress,
  type BuildCurationCandidateAddressFieldsInput,
} from '../queue/queue-payload.js'
import {
  commitCurationDelta,
  type CommitCurationDependencies,
  type CommitCurationJob,
} from '../curator/commit.js'
import type {
  AuthoredDeltaCheckpoint,
  DispositionProfile,
} from '../curator/author-contract.js'
import {
  acquireWriterLease,
  EPOCH_FILE,
  heartbeatLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  MUTATION_LOCK_TAKEOVER_MS,
  readCurrentEpoch,
  releaseLease,
  WriterAuthorityLostError,
} from '../lease/writer-lease.js'
import {
  makeBundleDraftFixture,
} from './fixtures/bundle-fixture.js'

interface ExpectedAuthoritySurface {
  withCurrentWriterAuthority<T>(
    knowledgeRoot: string,
    authority: { leaseId: string; epoch: number },
    mutate: () => T,
    hooks?: {
      afterMutationLockAcquired?: () => void
      afterFinalAuthorityCompare?: () => void
      mutationLockTakeoverMs?: number
    },
  ): T
}

interface ExpectedCorruptEpochStateError extends Error {
  readonly path: string
  readonly reason: 'unreadable' | 'malformed' | 'overflow'
  readonly rawPreview: string
}

interface ExpectedCorruptEpochSurface {
  CorruptEpochStateError: new (...args: never[]) => ExpectedCorruptEpochStateError
}

type ExpectedAcquireOutcome = ReturnType<typeof acquireWriterLease> | {
  kind: 'refused'
  reason: 'corrupt-epoch-state'
  error: ExpectedCorruptEpochStateError
}

type AcquireWithDeadline = (
  knowledgeRoot: string,
  hooks?: {
    afterMutationLockAcquired?: () => void
    mutationLockTakeoverMs?: number
  },
) => ReturnType<typeof acquireWriterLease>

type AcquireWithClaimHook = (
  knowledgeRoot: string,
  hooks: {
    afterMutationLockClaimed?: (generationToken: string) => void
    mutationLockTakeoverMs?: number
  },
) => ReturnType<typeof acquireWriterLease>

const expectedSurface = publicSurface as typeof publicSurface
  & ExpectedAuthoritySurface
  & ExpectedCorruptEpochSurface
const acquireWithDeadline = acquireWriterLease as AcquireWithDeadline
const acquireWithClaimHook = acquireWriterLease as AcquireWithClaimHook
const acquireFailClosed = acquireWriterLease as (
  knowledgeRoot: string,
) => ExpectedAcquireOutcome

const PRODUCT = 'writer-authority-fencing'

describe('writer authority and bundle publication are one indivisible protocol (CR-01)', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-writer-authority-fencing-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function acquireAuthority(): { leaseId: string; epoch: number } {
    const outcome = acquireWriterLease(knowledgeRoot)
    expect(outcome.kind).toBe('acquired')
    if (outcome.kind !== 'acquired') throw new Error('expected acquired writer authority')
    return { leaseId: outcome.leaseId, epoch: outcome.epoch }
  }

  function makeStale(): void {
    const file = join(knowledgeRoot, LEASE_FILE)
    const holder = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    writeFileSync(
      file,
      `${JSON.stringify({
        ...holder,
        heartbeatAtMs: Date.now() - LEASE_HEARTBEAT_TTL_MS,
      })}\n`,
      'utf8',
    )
  }

  function config(
    authority: { leaseId: string; epoch: number },
    beforePublishRename?: () => void,
  ): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: authority.leaseId,
      writerEpoch: authority.epoch,
      ...(beforePublishRename === undefined
        ? {}
        : { hooks: { beforePublishRename } }),
    } as BundleStoreConfig
  }

  function input(label: string): PublishBundleInput {
    const key = slugBranch(label)
    const draft = makeBundleDraftFixture({
      anchors: [
        { t: 'el', role: 'Button', name: label },
        { t: 'page', route: `/${key}` },
      ],
      scope: { tier: 'product', key: PRODUCT },
      summary: `${label} checkout control`,
      body: `${label} is the currently verified checkout control.`,
      distilledEvidenceRef: { id: `${label}-evidence`, sha: 'a'.repeat(64) },
    })
    return {
      draft,
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: label },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [],
      initialEvents: [BundleOutcomeEventSchema.parse({
        type: 'confirmed',
        evidenceToken: `${label}-confirmed`,
        curationJobId: `${label}-job`,
        buildOrdinal: 42,
        origin: 'agent-verified',
      })],
      relations: [],
      provenance: { mode: 'standalone', sourceDescription: `${label} authority fixture` },
      artifacts: [],
      evidenceMarkdown: `${label} authority evidence.\n`,
    }
  }

  function publishIndexFixture(label: string): Extract<
    ReturnType<typeof publishBundle>,
    { kind: 'published' }
  > {
    const published = publishBundle(
      config({ leaseId: 'fixture-writer', epoch: 0 }),
      input(label),
    )
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected published index fixture')
    return published
  }

  function readIndexMeta(key: string): string | undefined {
    const db = new DatabaseSync(publicSurface.indexDbPath(knowledgeRoot), {
      readOnly: true,
    })
    try {
      return db.prepare('SELECT v FROM meta WHERE k = ?').get(key)?.v as
        | string
        | undefined
    } finally {
      db.close()
    }
  }

  function writeIndexMeta(key: string, value: string): void {
    const db = new DatabaseSync(publicSurface.indexDbPath(knowledgeRoot))
    try {
      db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(value, key)
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
    }
  }

  function indexRecordExists(bundleId: string): boolean {
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      return reader.db
        .prepare('SELECT 1 FROM records WHERE bundle_id = ?')
        .get(bundleId) !== undefined
    } finally {
      reader.db.close()
    }
  }

  function indexRecordCount(): number {
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      return Number(reader.db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count)
    } finally {
      reader.db.close()
    }
  }

  const measurementAnchors: Anchor[] = [
    { t: 'flow', name: 'measurement:reported-value' },
    { t: 'platform', platform: 'web' },
  ]

  function measurementDraft(value: string): BundleDraft {
    return {
      kind: 'fact',
      subtype: 'measurement',
      anchors: measurementAnchors,
      scope: { tier: 'product', key: PRODUCT },
      summary: `reported-value measured as ${value}`,
      body: `Verified reported-value value: ${value}.`,
      distilledEvidenceRef: {
        id: `measurement-${value}`,
        sha: 'a'.repeat(64),
      },
      originStage: 'run-curation',
    }
  }

  function measurementJob(
    authority: { leaseId: string; epoch: number },
    value: string,
    buildOrdinal: number,
  ): CommitCurationJob {
    const fields = candidateAddressFixture({
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: `run-measurement-${buildOrdinal}`,
      scope: { tier: 'product', key: PRODUCT },
      buildOrdinal,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'measurement',
      anchors: measurementAnchors,
      summarySeed: `reported-value measured as ${value}`,
      bodySeed: `Verified reported-value value: ${value}.`,
      distilledObservations: [],
      evidenceToken: `measurement-evidence-${buildOrdinal}-${value}`,
      attributingObservationId: `measurement-observation-${buildOrdinal}-${value}`,
      artifactInventory: [],
      captureReceipt: artifactFreeCaptureReceipt(),
      emittedAt: '2026-07-31T10:00:00.000Z',
    } satisfies BuildCurationCandidateAddressFieldsInput)
    const payload = {
      candidateId: candidateContentAddress(fields),
      ...fields,
    }
    const candidateDir = join(root, 'claimed', payload.candidateId)
    const artifactsDir = join(candidateDir, 'artifacts')
    mkdirSync(artifactsDir, { recursive: true })
    writeFileSync(join(candidateDir, 'payload.json'), JSON.stringify(payload), 'utf8')
    return {
      kind: 'claimed',
      candidateId: payload.candidateId,
      leaseId: authority.leaseId,
      payload,
      candidateDir,
      payloadPath: join(candidateDir, 'payload.json'),
      artifactsDir,
      screenStates: [],
    }
  }

  function checkpoint(delta: Delta): AuthoredDeltaCheckpoint {
    return {
      schemaVersion: 1,
      delta,
      neighborIds: [...delta.citedIds],
      preconditions: [...(delta.precondition ?? [])],
      authorship: delta.authorship ?? {
        path: 'llm',
        model: { id: 'writer-authority-fixture' },
        executionContext: 'local-interactive',
      },
    }
  }

  function curationDependencies(
    authority: { leaseId: string; epoch: number },
    profile: DispositionProfile = { mode: 'drain-to-active' },
    overrides: Partial<CommitCurationDependencies> = {},
  ): CommitCurationDependencies {
    return {
      knowledgeRoot,
      auditBaseDir,
      epoch: authority.epoch,
      profile,
      drainState: { supersedesSeenByAnchorKey: new Map() },
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      ...overrides,
    }
  }

  function addMeasurementDelta(value: string): Extract<Delta, { kind: 'Add' }> {
    return {
      kind: 'Add',
      origin: 'agent',
      scope: { tier: 'product', key: PRODUCT },
      citedIds: [],
      authorship: {
        path: 'llm',
        model: { id: 'writer-authority-fixture' },
        executionContext: 'local-interactive',
      },
      bundle: measurementDraft(value),
    }
  }

  function seedMeasurementVictim(
    authority: { leaseId: string; epoch: number },
    value: string,
  ): Extract<ReturnType<typeof commitCurationDelta>, { kind: 'applied' }> {
    const claimed = measurementJob(authority, value, 42)
    const outcome = commitCurationDelta(
      curationDependencies(authority),
      claimed,
      checkpoint(addMeasurementDelta(value)),
    )
    if (outcome.kind !== 'applied') throw new Error('expected applied measurement Add')
    return outcome
  }

  function measurementSupersede(
    authority: { leaseId: string; epoch: number },
    victimId: string,
    value: string,
    buildOrdinal: number,
  ): { claimed: CommitCurationJob; authored: AuthoredDeltaCheckpoint } {
    const claimed = measurementJob(authority, value, buildOrdinal)
    claimed.targetProducts = { [victimId]: PRODUCT }
    const delta: Extract<Delta, { kind: 'Supersede' }> = {
      kind: 'Supersede',
      origin: 'agent',
      scope: claimed.payload.scope,
      citedIds: [asRecordId(victimId)],
      precondition: [{
        recordId: asRecordId(victimId),
        observedStatus: 'candidate',
        observedOrdinal: 42,
      }],
      authorship: {
        path: 'llm',
        model: { id: 'writer-authority-fixture' },
        executionContext: 'local-interactive',
      },
      victimId: asRecordId(victimId),
      newBundle: measurementDraft(value),
      evidenceToken: asEvidenceToken(claimed.payload.evidenceToken),
    }
    return { claimed, authored: checkpoint(delta) }
  }

  function appendVictimObservation(
    authority: { leaseId: string; epoch: number },
    bundleId: RecordId,
    value: number,
    buildOrdinal: number,
  ): void {
    const observation: MeasurementObservation = {
      value,
      buildOrdinal,
      evidenceToken: `seed-measurement-${buildOrdinal}`,
      curationJobId: `seed-measurement-job-${buildOrdinal}`,
    }
    expect(publicSurface.appendMeasurementObservation(
      config(authority),
      bundleId,
      observation,
    ).kind).toBe('appended')
  }

  function durableTailSnapshot(): unknown {
    const bundles = enumerateBundleDirs(knowledgeRoot).map(({ product, dir }) => ({
      product,
      bundleId: dir.slice(dir.lastIndexOf('/') + 1),
      outcomes: readFileSync(join(dir, 'evidence/outcomes.jsonl'), 'utf8'),
      measurements: existsSync(join(dir, 'evidence/measurements.json'))
        ? readFileSync(join(dir, 'evidence/measurements.json'), 'utf8')
        : undefined,
      relations: readFileSync(join(dir, 'relations.json'), 'utf8'),
    }))
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      return {
        bundles,
        rows: reader.db.prepare('SELECT * FROM records ORDER BY bundle_id').all(),
      }
    } finally {
      reader.db.close()
    }
  }

  it('accepts the current authority and runs its governed mutation exactly once', () => {
    const authority = acquireAuthority()
    let mutations = 0

    expect(expectedSurface.withCurrentWriterAuthority).toBeTypeOf('function')
    const result = expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => ++mutations,
    )

    expect(result).toBe(1)
    expect(mutations).toBe(1)
  })

  it('keeps a contender out while the current authority is inside mutate past its final guard', () => {
    const authority = acquireAuthority()
    let mutations = 0
    let contenderResult: 'busy' | 'entered' | undefined

    expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => {
        mutations += 1
        const contender = new DatabaseSync(
          join(knowledgeRoot, '.writer-authority.sqlite'),
          { timeout: 5 },
        )
        let contenderTransactionOpen = false
        try {
          contender.exec('BEGIN IMMEDIATE')
          contenderTransactionOpen = true
          contenderResult = 'entered'
        } catch (error) {
          contenderResult = (error as NodeJS.ErrnoException).code === 'ERR_SQLITE_ERROR'
            && /database is locked/i.test((error as Error).message)
            ? 'busy'
            : undefined
        } finally {
          if (contenderTransactionOpen) contender.exec('ROLLBACK')
          contender.close()
        }
      },
      {
        afterFinalAuthorityCompare: () => {
          expect(mutations).toBe(0)
        },
      },
    )

    expect(contenderResult).toBe('busy')
    expect(mutations).toBe(1)
  })

  it('keeps the current generation non-stealable after the final authority comparison', () => {
    const authority = acquireAuthority()
    const staged = stageBundle(config(authority), input('current-drainer'))
    expect(staged.kind).toBe('staged')
    if (staged.kind !== 'staged') throw new Error('expected staged bundle')
    let whileHeld: ReturnType<typeof acquireWriterLease> | undefined

    const published = expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => finalizeStagedBundle(staged),
      {
        mutationLockTakeoverMs: 0,
        afterFinalAuthorityCompare: () => {
          whileHeld = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    )

    expect(whileHeld).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(published.kind).toBe('published')
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('1\n')
    if (published.kind !== 'published') throw new Error('expected current publication')
    publicSurface.applyIndexDeltaForBundle({
      knowledgeRoot,
      product: PRODUCT,
      bundleId: published.id,
    })
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT bundle_id FROM records').all(),
      ).toEqual([{ bundle_id: published.id }])
    } finally {
      reader.db.close()
    }
  })

  it('keeps index authority held through the before-COMMIT failpoint', async () => {
    const authority = acquireAuthority()
    const published = publishBundle(config(authority), input('index-commit-fence'))
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected published index fixture')
    let hookCalls = 0
    let contenderDuringCommit: ReturnType<typeof acquireWriterLease> | undefined

    const report = await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeTransactionCommit: () => {
          hookCalls += 1
          makeStale()
          contenderDuringCommit = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    })

    expect(hookCalls).toBe(1)
    expect(contenderDuringCommit).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(report.projected).toBe(1)
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT bundle_id FROM records WHERE bundle_id = ?').get(published.id),
      ).toEqual({ bundle_id: published.id })
    } finally {
      reader.db.close()
    }

    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
  })

  it('refuses a stale index authority before its transaction and leaves zero rows', async () => {
    await publicSurface.rebuildIndex({ knowledgeRoot })
    const authority = acquireAuthority()
    const published = publishBundle(config(authority), input('index-successor-first'))
    expect(published.kind).toBe('published')
    if (published.kind !== 'published') throw new Error('expected published index fixture')
    makeStale()
    expect(acquireWithDeadline(knowledgeRoot, {
      mutationLockTakeoverMs: 0,
    })).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })

    await expect(publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
    })).rejects.toBeInstanceOf(WriterAuthorityLostError)

    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT 1 FROM records WHERE bundle_id = ?').get(published.id),
      ).toBeUndefined()
    } finally {
      reader.db.close()
    }
  })

  it('refuses takeover before rendering-epoch completion without stamping it current', async () => {
    await publicSurface.rebuildIndex({ knowledgeRoot })
    const staleRenderingEpoch = String(publicSurface.INDEX_RENDERING_SCHEMA_VERSION - 1)
    writeIndexMeta('rendering_schema_version', staleRenderingEpoch)
    const authority = acquireAuthority()
    let targetCalls = 0

    await expect(publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeMutationAuthority: (family) => {
          if (family !== 'complete-rendering-epoch') return
          targetCalls += 1
          makeStale()
          expect(acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })).toMatchObject({ kind: 'acquired', epoch: authority.epoch + 1 })
        },
      },
    })).rejects.toBeInstanceOf(WriterAuthorityLostError)

    expect(targetCalls).toBe(1)
    expect(readIndexMeta('rendering_schema_version')).toBe(staleRenderingEpoch)
  })

  it('holds authority while rendering-epoch completion stamps the current version', async () => {
    await publicSurface.rebuildIndex({ knowledgeRoot })
    writeIndexMeta(
      'rendering_schema_version',
      String(publicSurface.INDEX_RENDERING_SCHEMA_VERSION - 1),
    )
    const authority = acquireAuthority()
    let contender: ReturnType<typeof acquireWriterLease> | undefined

    await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        insideMutationAuthority: (family) => {
          if (family !== 'complete-rendering-epoch') return
          makeStale()
          contender = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    })

    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(readIndexMeta('rendering_schema_version')).toBe(
      String(publicSurface.INDEX_RENDERING_SCHEMA_VERSION),
    )
    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
  })

  it('refuses takeover before rebuild-request removal and preserves the marker', async () => {
    await publicSurface.rebuildIndex({ knowledgeRoot })
    publicSurface.requestRebuild({
      knowledgeRoot,
      reason: 'corrupt',
      detail: 'authority refusal must retain this rebuild request',
    })
    const authority = acquireAuthority()
    let targetCalls = 0

    await expect(publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeMutationAuthority: (family) => {
          if (family !== 'clear-rebuild-request') return
          targetCalls += 1
          makeStale()
          expect(acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })).toMatchObject({ kind: 'acquired', epoch: authority.epoch + 1 })
        },
      },
    })).rejects.toBeInstanceOf(WriterAuthorityLostError)

    expect(targetCalls).toBe(1)
    expect(publicSurface.readRebuildRequest(knowledgeRoot).present).toBe(true)
  })

  it('holds authority while rebuild-request removal consumes the marker', async () => {
    await publicSurface.rebuildIndex({ knowledgeRoot })
    publicSurface.requestRebuild({
      knowledgeRoot,
      reason: 'corrupt',
      detail: 'authority hold must cover rebuild request removal',
    })
    const authority = acquireAuthority()
    let contender: ReturnType<typeof acquireWriterLease> | undefined

    await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        insideMutationAuthority: (family) => {
          if (family !== 'clear-rebuild-request') return
          makeStale()
          contender = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    })

    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(publicSurface.readRebuildRequest(knowledgeRoot)).toEqual({ present: false })
    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
  })

  it('refuses takeover before checkpointPassive and retains every indexed row', async () => {
    const bundleCount = publicSurface.CHECKPOINT_EVERY_N_BUNDLES
    for (let index = 0; index < bundleCount; index += 1) {
      publishIndexFixture(`checkpoint-refusal-${index}`)
    }
    expect(await publicSurface.rebuildIndex({ knowledgeRoot })).toMatchObject({
      projected: bundleCount,
    })
    const authority = acquireAuthority()
    let targetCalls = 0

    await expect(publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeMutationAuthority: (family) => {
          if (family !== 'checkpoint-passive') return
          targetCalls += 1
          makeStale()
          expect(acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })).toMatchObject({ kind: 'acquired', epoch: authority.epoch + 1 })
        },
      },
    })).rejects.toBeInstanceOf(WriterAuthorityLostError)

    expect(targetCalls).toBe(1)
    expect(indexRecordCount()).toBe(bundleCount)
  })

  it('holds authority through checkpointPassive and releases it before later units', async () => {
    const bundleCount = publicSurface.CHECKPOINT_EVERY_N_BUNDLES
    for (let index = 0; index < bundleCount; index += 1) {
      publishIndexFixture(`checkpoint-held-${index}`)
    }
    await publicSurface.rebuildIndex({ knowledgeRoot })
    const authority = acquireAuthority()
    let contender: ReturnType<typeof acquireWriterLease> | undefined

    const report = await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        insideMutationAuthority: (family) => {
          if (family !== 'checkpoint-passive') return
          makeStale()
          contender = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    })

    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(report).toMatchObject({ projected: 0, removed: 0 })
    expect(indexRecordCount()).toBe(bundleCount)
    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
  })

  it('refuses takeover before removeMissingBundles and preserves the stale row', async () => {
    const published = publishIndexFixture('remove-missing-refusal')
    await publicSurface.rebuildIndex({ knowledgeRoot })
    rmSync(published.dir, { recursive: true, force: true })
    const authority = acquireAuthority()
    let targetCalls = 0

    await expect(publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeMutationAuthority: (family) => {
          if (family !== 'remove-missing-bundles') return
          targetCalls += 1
          makeStale()
          expect(acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })).toMatchObject({ kind: 'acquired', epoch: authority.epoch + 1 })
        },
      },
    })).rejects.toBeInstanceOf(WriterAuthorityLostError)

    expect(targetCalls).toBe(1)
    expect(indexRecordExists(published.id)).toBe(true)
  })

  it('holds authority through removeMissingBundles and commits the stale-row deletion', async () => {
    const published = publishIndexFixture('remove-missing-held')
    await publicSurface.rebuildIndex({ knowledgeRoot })
    rmSync(published.dir, { recursive: true, force: true })
    const authority = acquireAuthority()
    let contender: ReturnType<typeof acquireWriterLease> | undefined

    const report = await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        insideMutationAuthority: (family) => {
          if (family !== 'remove-missing-bundles') return
          makeStale()
          contender = acquireWithDeadline(knowledgeRoot, {
            mutationLockTakeoverMs: 0,
          })
        },
      },
    })

    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })
    expect(report).toMatchObject({ projected: 0, removed: 1 })
    expect(indexRecordExists(published.id)).toBe(false)
    expect(acquireWriterLease(knowledgeRoot)).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
  })

  it('releases authority between multi-bundle projection units and stays idempotent', async () => {
    for (let index = 0; index < 3; index += 1) {
      publishIndexFixture(`between-unit-heartbeat-${index}`)
    }
    const authority = acquireAuthority()
    let projectBoundaries = 0
    const heartbeatOutcomes: ReturnType<typeof heartbeatLease>[] = []

    const first = await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
      hooks: {
        beforeMutationAuthority: (family) => {
          if (family !== 'project-bundle') return
          projectBoundaries += 1
          if (projectBoundaries === 1) return
          heartbeatOutcomes.push(heartbeatLease({
            knowledgeRoot,
            leaseId: authority.leaseId,
          }))
        },
      },
    })

    expect(first).toMatchObject({ projected: 3, removed: 0 })
    expect(projectBoundaries).toBe(3)
    expect(heartbeatOutcomes).toHaveLength(2)
    expect(heartbeatOutcomes.every(({ kind }) => kind === 'heartbeated')).toBe(true)

    const second = await publicSurface.rebuildIndex({
      knowledgeRoot,
      writerAuthority: { knowledgeRoot, ...authority },
    })
    expect(second).toMatchObject({ projected: 0, removed: 0 })
  })

  it('does not replace a live lock row when a fresh holder re-enters acquisition', () => {
    const authority = acquireAuthority()
    const dbFile = join(knowledgeRoot, '.writer-authority.sqlite')
    let before: Record<string, unknown> | undefined
    let after: Record<string, unknown> | undefined
    let mutationCount = 0

    expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => ++mutationCount,
      {
        mutationLockTakeoverMs: 0,
        afterMutationLockAcquired: () => {
          const reader = new DatabaseSync(dbFile, { readOnly: true })
          try {
            before = reader.prepare('SELECT * FROM mutation_lock WHERE id = 1').get()
            expect(acquireWithDeadline(knowledgeRoot, {
              mutationLockTakeoverMs: 0,
            })).toMatchObject({ kind: 'held' })
            after = reader.prepare('SELECT * FROM mutation_lock WHERE id = 1').get()
          } finally {
            reader.close()
          }
        },
      },
    )

    expect(mutationCount).toBe(1)
    expect(before).toEqual(after)
    expect(before).toMatchObject({ pid: process.pid })
  })

  it('recovers a dead-PID mutation-lock owner immediately without waiting for the deadline', () => {
    const authority = acquireAuthority()
    const db = new DatabaseSync(join(knowledgeRoot, '.writer-authority.sqlite'))
    db.exec(`
      CREATE TABLE IF NOT EXISTS mutation_lock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        generation_token TEXT NOT NULL,
        pid INTEGER NOT NULL CHECK (pid > 0),
        acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0)
      ) STRICT
    `)
    db.prepare(`
      INSERT INTO mutation_lock (id, generation_token, pid, acquired_at_ms)
      VALUES (1, ?, ?, ?)
    `).run('dead-owner-generation', 2_147_483_647, Date.now())
    db.close()
    const startedAtMs = Date.now()

    const result = expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => 'recovered',
      { mutationLockTakeoverMs: MUTATION_LOCK_TAKEOVER_MS },
    )

    expect(result).toBe('recovered')
    expect(Date.now() - startedAtMs).toBeLessThan(1_000)
    const verifier = new DatabaseSync(join(knowledgeRoot, '.writer-authority.sqlite'), {
      readOnly: true,
    })
    try {
      expect(verifier.prepare('SELECT * FROM mutation_lock').get()).toBeUndefined()
    } finally {
      verifier.close()
    }
  })

  it('fails a stale expected-token CAS closed without changing the replacement owner row', () => {
    let releasedOwnerToken = ''
    const first = acquireWithClaimHook(knowledgeRoot, {
      afterMutationLockClaimed: (generationToken) => {
        releasedOwnerToken = generationToken
      },
    })
    expect(first.kind).toBe('acquired')
    if (first.kind !== 'acquired') throw new Error('expected first owner')
    expect(releaseLease({
      knowledgeRoot,
      leaseId: first.leaseId,
    })).toEqual({ kind: 'released' })

    let replacementToken = ''
    let staleCasChanges: number | bigint | undefined
    let rowBefore: Record<string, unknown> | undefined
    let rowAfter: Record<string, unknown> | undefined
    const second = acquireWithClaimHook(knowledgeRoot, {
      afterMutationLockClaimed: (generationToken) => {
        replacementToken = generationToken
        const staleContender = new DatabaseSync(
          join(knowledgeRoot, '.writer-authority.sqlite'),
          { timeout: 5 },
        )
        try {
          rowBefore = staleContender
            .prepare('SELECT * FROM mutation_lock WHERE id = 1')
            .get()
          staleCasChanges = staleContender.prepare(`
            UPDATE mutation_lock
            SET generation_token = ?, pid = ?, acquired_at_ms = ?
            WHERE id = 1 AND generation_token = ?
          `).run(
            'stale-contender-generation',
            process.pid,
            Date.now(),
            releasedOwnerToken,
          ).changes
          rowAfter = staleContender
            .prepare('SELECT * FROM mutation_lock WHERE id = 1')
            .get()
        } finally {
          staleContender.close()
        }
      },
    })

    expect(second.kind).toBe('acquired')
    if (second.kind !== 'acquired') throw new Error('expected replacement owner')
    expect(replacementToken).not.toBe(releasedOwnerToken)
    expect(staleCasChanges).toBe(0)
    expect(rowAfter).toEqual(rowBefore)
    expect(rowAfter).toMatchObject({ generation_token: replacementToken })

    expect(releaseLease({
      knowledgeRoot,
      leaseId: second.leaseId,
    })).toEqual({ kind: 'released' })
    const third = acquireWriterLease(knowledgeRoot)
    expect(third).toMatchObject({ kind: 'acquired', epoch: 3 })
  })

  it('exports the pinned production mutation-lock takeover bound without a config seam', () => {
    expect(MUTATION_LOCK_TAKEOVER_MS).toBe(45_000)
    expect(publicSurface.MUTATION_LOCK_TAKEOVER_MS).toBe(MUTATION_LOCK_TAKEOVER_MS)
  })

  it.each([
    ['garbage bytes', 'not-an-integer\n', 'malformed'],
    ['fractional bytes', '1.5\n', 'malformed'],
    ['negative bytes', '-1\n', 'malformed'],
    ['unsafe-integer overflow', '9007199254740992\n', 'overflow'],
  ] as const)('refuses acquisition for %s instead of rolling the epoch back', (_, raw, reason) => {
    mkdirSync(knowledgeRoot, { recursive: true })
    const file = join(knowledgeRoot, EPOCH_FILE)
    writeFileSync(file, raw, 'utf8')

    const outcome = acquireFailClosed(knowledgeRoot)

    expect(outcome.kind).toBe('refused')
    if (outcome.kind !== 'refused') throw new Error('corrupt epoch acquisition was not refused')
    expect(expectedSurface.CorruptEpochStateError).toBeTypeOf('function')
    expect(outcome).toMatchObject({ reason: 'corrupt-epoch-state' })
    expect(outcome.error).toBeInstanceOf(expectedSurface.CorruptEpochStateError)
    expect(outcome.error).toMatchObject({ path: file, reason })
    expect(outcome.error.rawPreview.length).toBeGreaterThan(0)
    expect(readFileSync(file, 'utf8')).toBe(raw)
    expect(existsSync(join(knowledgeRoot, LEASE_FILE))).toBe(false)
  })

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'refuses acquisition when the epoch file is unreadable',
    () => {
      mkdirSync(knowledgeRoot, { recursive: true })
      const file = join(knowledgeRoot, EPOCH_FILE)
      writeFileSync(file, '1\n', 'utf8')
      chmodSync(file, 0o000)
      try {
        const outcome = acquireFailClosed(knowledgeRoot)

        expect(outcome.kind).toBe('refused')
        if (outcome.kind !== 'refused') throw new Error('unreadable epoch acquisition was not refused')
        expect(outcome).toMatchObject({
          reason: 'corrupt-epoch-state',
          error: { path: file, reason: 'unreadable' },
        })
        expect(outcome.error).toBeInstanceOf(expectedSurface.CorruptEpochStateError)
      } finally {
        chmodSync(file, 0o600)
      }
    },
  )

  it('keeps the never-initialized ENOENT path at epoch zero and first acquisition at epoch one', () => {
    expect(readCurrentEpoch(knowledgeRoot)).toBe(0)

    const outcome = acquireFailClosed(knowledgeRoot)

    expect(outcome).toMatchObject({ kind: 'acquired', epoch: 1 })
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('1\n')
  })

  it('refuses heartbeat and governed mutation when epoch bytes become corrupt', () => {
    const authority = acquireAuthority()
    const leaseBefore = readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')
    writeFileSync(join(knowledgeRoot, EPOCH_FILE), 'torn-epoch\n', 'utf8')
    let mutationCount = 0

    const heartbeat = heartbeatLease({ knowledgeRoot, leaseId: authority.leaseId }) as unknown as {
      kind: 'refused'
      reason: 'corrupt-epoch-state'
      error: ExpectedCorruptEpochStateError
    }

    expect(heartbeat).toMatchObject({
      kind: 'refused',
      reason: 'corrupt-epoch-state',
      error: { reason: 'malformed' },
    })
    expect(() => expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => ++mutationCount,
    )).toThrow(expectedSurface.CorruptEpochStateError)
    expect(mutationCount).toBe(0)
    expect(readFileSync(join(knowledgeRoot, LEASE_FILE), 'utf8')).toBe(leaseBefore)
  })

  it('never re-mints epoch one over corrupt state held by a hypothetical stale epoch-one writer', () => {
    acquireAuthority()
    makeStale()
    const leaseFile = join(knowledgeRoot, LEASE_FILE)
    const epochFile = join(knowledgeRoot, EPOCH_FILE)
    const leaseBefore = readFileSync(leaseFile, 'utf8')
    const corruptBytes = 'corrupt-after-epoch-one\n'
    writeFileSync(epochFile, corruptBytes, 'utf8')

    const outcome = acquireFailClosed(knowledgeRoot)

    expect(outcome).toMatchObject({
      kind: 'refused',
      reason: 'corrupt-epoch-state',
      error: { reason: 'malformed' },
    })
    expect(readFileSync(epochFile, 'utf8')).toBe(corruptBytes)
    expect(readFileSync(leaseFile, 'utf8')).toBe(leaseBefore)
  })

  it('stages bundle bytes under an epoch-keyed reader-invisible directory', () => {
    const authority = acquireAuthority()
    let stagedEntries: string[] = []

    const outcome = publishBundle(
      config(authority, () => {
        stagedEntries = readdirSync(join(
          knowledgeRoot,
          'memory',
          slugBranch(PRODUCT),
          'bundles',
          '.staging',
        ))
      }),
      input('epoch-one'),
    )

    expect(outcome.kind).toBe('published')
    expect(stagedEntries).toHaveLength(1)
    expect(stagedEntries[0]).toMatch(/^\.staged-epoch-1-[0-9a-f-]+$/)
  })

  it('sweeps stale epoch-keyed staging when authority advances', () => {
    acquireAuthority()
    const staleDir = join(
      knowledgeRoot,
      'memory',
      slugBranch(PRODUCT),
      'bundles',
      '.staging',
      '.staged-epoch-1-orphan',
    )
    mkdirSync(staleDir, { recursive: true })
    writeFileSync(join(staleDir, 'manifest.json'), '{}\n', 'utf8')
    makeStale()

    const successor = acquireWriterLease(knowledgeRoot)

    expect(successor).toMatchObject({ kind: 'acquired', epoch: 2 })
    expect(existsSync(staleDir)).toBe(false)
  })

  it('lets a successor win after intent but before the held tail with zero durable writes', () => {
    const authority = acquireAuthority()
    const victim = seedMeasurementVictim(authority, '100')
    const replacement = measurementSupersede(authority, victim.bundleId, '204', 47)
    const before = durableTailSnapshot()
    let successor: ReturnType<typeof acquireWriterLease> | undefined

    const outcome = commitCurationDelta(
      curationDependencies(authority, undefined, {
        hooks: {
          afterIntentWritten: () => {
            makeStale()
            successor = acquireWithDeadline(knowledgeRoot, {
              mutationLockTakeoverMs: 0,
            })
          },
          mutationLockTakeoverMs: 0,
        },
      }),
      replacement.claimed,
      replacement.authored,
    )

    expect(successor).toMatchObject({
      kind: 'acquired',
      epoch: authority.epoch + 1,
    })
    expect(outcome).toMatchObject({
      kind: 'abandoned-stale-epoch',
      observedEpoch: authority.epoch + 1,
    })
    expect(durableTailSnapshot()).toEqual(before)
  })

  it('keeps a successor out from publication through every replay-safe commit-tail family', () => {
    const authority = acquireAuthority()
    const victim = seedMeasurementVictim(authority, '100')
    appendVictimObservation(authority, victim.bundleId, 200, 43)
    appendVictimObservation(authority, victim.bundleId, 201, 44)
    appendVictimObservation(authority, victim.bundleId, 202, 45)
    appendVictimObservation(authority, victim.bundleId, 203, 46)
    const replacement = measurementSupersede(authority, victim.bundleId, '204', 47)
    let contender: ReturnType<typeof acquireWriterLease> | undefined

    const outcome = commitCurationDelta(
      curationDependencies(authority, undefined, {
        hooks: {
          afterBundlePublished: () => {
            makeStale()
            contender = acquireWithDeadline(knowledgeRoot, {
              mutationLockTakeoverMs: 0,
            })
          },
          mutationLockTakeoverMs: 0,
        },
      }),
      replacement.claimed,
      replacement.authored,
    )

    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') throw new Error('expected applied drift Supersede')
    expect(contender).toMatchObject({
      kind: 'held',
      holder: { leaseId: authority.leaseId, epoch: authority.epoch },
    })

    const loadedReplacement = loadBundle(outcome.bundleDir)
    const loadedVictim = loadBundle(victim.bundleDir)
    expect(loadedReplacement.kind).toBe('loaded')
    expect(loadedVictim.kind).toBe('loaded')
    if (loadedReplacement.kind !== 'loaded' || loadedVictim.kind !== 'loaded') {
      throw new Error('expected both supersede bundles to load')
    }
    expect(loadedReplacement.bundle.events.filter(
      (event) => event.curationJobId === replacement.claimed.candidateId,
    ).map((event) => event.type)).toEqual(['confirmed', 'promoted'])
    expect(loadedVictim.bundle.events.filter(
      (event) => event.curationJobId === replacement.claimed.candidateId,
    ).map((event) => event.type)).toEqual(['superseded', 'window-close'])
    expect(loadedReplacement.bundle.relations.relations).toEqual([{
      type: 'supersedes',
      targetId: victim.bundleId,
      addedAtOrdinal: 47,
      curationJobId: replacement.claimed.candidateId,
    }])
    expect(readMeasurements(outcome.bundleDir)).toEqual({
      baseline: { mu0: 204, sigma0: 0, n0: 1, openedAtOrdinal: 47 },
      observations: [],
    })
    expect(readMeasurements(victim.bundleDir)?.observations).toHaveLength(4)

    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(reader.db.prepare(`
        SELECT bundle_id FROM records
        WHERE bundle_id IN (?, ?)
        ORDER BY bundle_id
      `).all(victim.bundleId, outcome.bundleId)).toEqual(
        [victim.bundleId, outcome.bundleId]
          .sort()
          .map((bundleId) => ({ bundle_id: bundleId })),
      )
    } finally {
      reader.db.close()
    }

    const after = durableTailSnapshot()
    expect(
      commitCurationDelta(
        curationDependencies(authority),
        replacement.claimed,
        replacement.authored,
      ),
    ).toMatchObject({ kind: 'requeue-resynthesis', reason: 'compare-and-set' })
    expect(durableTailSnapshot()).toEqual(after)
  })

  it('routes commit publication through the lock-held primitive instead of a detached read', () => {
    const source = readFileSync(new URL('../curator/commit.ts', import.meta.url), 'utf8')

    expect(source).toContain('withCurrentWriterAuthority(')
    expect(source).not.toContain('const beforePublish = staleEpoch(deps)')
  })

  it('keeps the unfenced compatibility publisher out of the public and commit surfaces', () => {
    const source = readFileSync(new URL('../curator/commit.ts', import.meta.url), 'utf8')

    expect(publicSurface).not.toHaveProperty('publishBundle')
    expect(publicSurface.publishBundleForTest).toBeTypeOf('function')
    expect(source).not.toMatch(/import\s*\{[^}]*\bpublishBundle\b[^}]*\}/s)
    expect(source).not.toMatch(/\bpublishBundle\s*\(\s*config\s*,/)
    expect(source).not.toContain('publishBundleForTest')
  })
})
