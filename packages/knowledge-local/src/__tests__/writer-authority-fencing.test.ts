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

import { BundleOutcomeEventSchema, slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as publicSurface from '../index.js'
import {
  finalizeStagedBundle,
  publishBundle,
  stageBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.test-helper.js'
import {
  acquireWriterLease,
  EPOCH_FILE,
  heartbeatLease,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
  MUTATION_LOCK_TAKEOVER_MS,
  readCurrentEpoch,
  WriterAuthorityLostError,
} from '../lease/writer-lease.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
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

const expectedSurface = publicSurface as typeof publicSurface
  & ExpectedAuthoritySurface
  & ExpectedCorruptEpochSurface
const acquireWithDeadline = acquireWriterLease as AcquireWithDeadline
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
    const draft = makeBundleDraftFixture({
      scope: { tier: 'product', key: PRODUCT },
      summary: `${label} checkout control`,
      body: `${label} is the currently verified checkout control.`,
      distilledEvidenceRef: { id: `${label}-evidence`, sha: 'a'.repeat(64) },
    })
    return {
      draft,
      discriminant: makeDiscriminantFixture(),
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

  it('refuses a generation reclaimed after the final authority comparison', () => {
    const authority = acquireAuthority()
    let successorEpoch = 0
    let successorId = ''
    const staleStage = stageBundle(config(authority), input('stale-drainer'))
    expect(staleStage.kind).toBe('staged')
    if (staleStage.kind !== 'staged') throw new Error('expected stale staged bundle')

    expect(() =>
      expectedSurface.withCurrentWriterAuthority(
        knowledgeRoot,
        authority,
        () => finalizeStagedBundle(staleStage),
        {
          mutationLockTakeoverMs: 0,
          afterFinalAuthorityCompare: () => {
            makeStale()
            const successor = acquireWithDeadline(knowledgeRoot, {
              mutationLockTakeoverMs: 0,
            })
            expect(successor.kind).toBe('acquired')
            if (successor.kind !== 'acquired') throw new Error('expected successor takeover')
            successorEpoch = successor.epoch
            const successorAuthority = {
              leaseId: successor.leaseId,
              epoch: successor.epoch,
            }
            const successorStage = stageBundle(
              config(successorAuthority),
              input('successor-daemon'),
            )
            expect(successorStage.kind).toBe('staged')
            if (successorStage.kind !== 'staged') {
              throw new Error('expected successor staged bundle')
            }
            const published = expectedSurface.withCurrentWriterAuthority(
              knowledgeRoot,
              successorAuthority,
              () => finalizeStagedBundle(successorStage),
              { mutationLockTakeoverMs: 0 },
            )
            expect(published.kind).toBe('published')
            if (published.kind !== 'published') {
              throw new Error('expected successor publication')
            }
            successorId = published.id
            publicSurface.applyIndexDeltaForBundle({
              knowledgeRoot,
              product: PRODUCT,
              bundleId: published.id,
            })
          },
        },
      ),
    ).toThrow(WriterAuthorityLostError)

    expect(successorEpoch).toBe(2)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('2\n')
    const bundlesDir = join(
      knowledgeRoot,
      'memory',
      slugBranch(PRODUCT),
      'bundles',
    )
    expect(readdirSync(bundlesDir).filter((entry) => entry !== '.staging')).toEqual([
      successorId,
    ])
    const reader = publicSurface.openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT bundle_id FROM records').all(),
      ).toEqual([{ bundle_id: successorId }])
    } finally {
      reader.db.close()
    }
  })

  it('takes over a live mutation-lock generation only after its bounded deadline', () => {
    const authority = acquireAuthority()
    const lockFile = join(
      knowledgeRoot,
      'memory',
      'index',
      '.writer-lease-mutation-lock',
    )
    const takeoverMs = 35
    let originalOwner: Record<string, unknown> | undefined
    let successorOwner: Record<string, unknown> | undefined
    let successorMutationAtMs = 0
    let staleMutationCount = 0
    let refusal: unknown

    try {
      expectedSurface.withCurrentWriterAuthority(
        knowledgeRoot,
        authority,
        () => ++staleMutationCount,
        {
          mutationLockTakeoverMs: takeoverMs,
          afterMutationLockAcquired: () => {
            originalOwner = JSON.parse(readFileSync(lockFile, 'utf8')) as Record<
              string,
              unknown
            >
            expectedSurface.withCurrentWriterAuthority(
              knowledgeRoot,
              authority,
              () => {
                successorMutationAtMs = Date.now()
                successorOwner = JSON.parse(readFileSync(lockFile, 'utf8')) as Record<
                  string,
                  unknown
                >
              },
              { mutationLockTakeoverMs: takeoverMs },
            )
          },
        },
      )
    } catch (error) {
      refusal = error
    }

    expect(originalOwner).toMatchObject({ pid: process.pid })
    expect(successorOwner).toMatchObject({ pid: process.pid })
    expect(successorOwner?.generationToken).not.toBe(originalOwner?.generationToken)
    expect(successorMutationAtMs - Number(originalOwner?.acquiredAtMs)).toBeGreaterThanOrEqual(
      takeoverMs,
    )
    expect(staleMutationCount).toBe(0)
    expect(refusal).toBeInstanceOf(WriterAuthorityLostError)
    expect(refusal).toMatchObject({ reason: 'mutation-lock-generation-lost' })
  })

  it('recovers a dead-PID mutation-lock owner immediately without waiting for the deadline', () => {
    const authority = acquireAuthority()
    const lockParent = join(knowledgeRoot, 'memory', 'index')
    const lockFile = join(lockParent, '.writer-lease-mutation-lock')
    mkdirSync(lockParent, { recursive: true })
    writeFileSync(lockFile, `${JSON.stringify({
      pid: 2_147_483_647,
      acquiredAtMs: Date.now(),
      generationToken: 'dead-owner-generation',
    })}\n`, 'utf8')
    const startedAtMs = Date.now()

    const result = expectedSurface.withCurrentWriterAuthority(
      knowledgeRoot,
      authority,
      () => 'recovered',
      { mutationLockTakeoverMs: MUTATION_LOCK_TAKEOVER_MS },
    )

    expect(result).toBe('recovered')
    expect(Date.now() - startedAtMs).toBeLessThan(1_000)
    expect(existsSync(lockFile)).toBe(false)
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
