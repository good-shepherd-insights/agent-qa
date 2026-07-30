import {
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
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../bundle-publish.js'
import {
  acquireWriterLease,
  EPOCH_FILE,
  LEASE_FILE,
  LEASE_HEARTBEAT_TTL_MS,
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
      afterFinalAuthorityCompare?: () => void
      mutationLockTakeoverMs?: number
    },
  ): T
}

type AcquireWithDeadline = (
  knowledgeRoot: string,
  hooks?: {
    afterMutationLockAcquired?: () => void
    mutationLockTakeoverMs?: number
  },
) => ReturnType<typeof acquireWriterLease>

const expectedSurface = publicSurface as typeof publicSurface & ExpectedAuthoritySurface
const acquireWithDeadline = acquireWriterLease as AcquireWithDeadline

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
    let mutations = 0
    let successorEpoch = 0

    expect(() =>
      expectedSurface.withCurrentWriterAuthority(
        knowledgeRoot,
        authority,
        () => ++mutations,
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
          },
        },
      ),
    ).toThrow(WriterAuthorityLostError)

    expect(successorEpoch).toBe(2)
    expect(mutations).toBe(0)
    expect(readFileSync(join(knowledgeRoot, EPOCH_FILE), 'utf8')).toBe('2\n')
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
})
