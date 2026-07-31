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
  releaseLease,
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
