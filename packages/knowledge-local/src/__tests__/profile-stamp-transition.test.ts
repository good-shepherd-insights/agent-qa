import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  STATIC_FLOOR_EMBEDDING_PROFILE,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as knowledgeLocal from '../index.js'
import type {
  BundleStoreConfig,
  PublishBundleInput,
  PublishBundleOutcome,
} from '../index.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { makeFakeEmbedder } from './fixtures/fake-embedder.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

const LEGACY_DEFAULT_PROFILE_KEY = knowledgeLocal.embeddingProfileKey({
  ...DEFAULT_EMBEDDING_PROFILE,
  revision: 'main',
})
const LOCKED_DEFAULT_PROFILE_KEY = knowledgeLocal.embeddingProfileKey(
  DEFAULT_EMBEDDING_PROFILE,
)

describe('embedding profile stamp transitions', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knowledge-profile-transition-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    scaffoldKnowledgeRoot(knowledgeRoot)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function publishFixture(): PublishedBundle {
    const config: BundleStoreConfig = {
      knowledgeRoot,
      productKey: 'Profile Transition Product',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    }
    const input: PublishBundleInput = {
      draft: makeBundleDraftFixture(),
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal: 42,
      screenStates: [makeScreenStateFixture()],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'profile-transition-run',
        testId: 'profile-transition-test',
        stepIndex: 0,
      },
      artifacts: [],
    }
    const outcome = knowledgeLocal.publishBundle(config, input)
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') {
      throw new Error(`expected publication, got ${outcome.kind}`)
    }
    return outcome
  }

  async function publishAndBuild(): Promise<PublishedBundle> {
    const published = publishFixture()
    const report = await knowledgeLocal.rebuildIndex({
      knowledgeRoot,
      embedder: makeFakeEmbedder(),
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    expect(report).toMatchObject({ projected: 1, backfilled: 0, vec: 'brute' })
    return published
  }

  function rewriteProfileState(profileKey: string, embedding: Uint8Array): void {
    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    try {
      writer.db
        .prepare("UPDATE meta SET v = ? WHERE k = 'embedding_profile'")
        .run(profileKey)
      writer.db
        .prepare("UPDATE records SET embedding = ?, embed_status = 'present'")
        .run(embedding)
    } finally {
      writer.close()
    }
  }

  function readProfileState(): {
    stamp: unknown
    embedStatus: unknown
    embedding: unknown
  } {
    const reader = knowledgeLocal.openIndexReaderConnection(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    try {
      const meta = reader.db
        .prepare("SELECT v FROM meta WHERE k = 'embedding_profile'")
        .get()
      const record = reader.db
        .prepare('SELECT embed_status, embedding FROM records')
        .get()
      return {
        stamp: meta?.v,
        embedStatus: record?.embed_status,
        embedding: record?.embedding,
      }
    } finally {
      reader.db.close()
    }
  }

  it('invalidates present bytes before restamping a legacy main-revision index', async () => {
    await publishAndBuild()
    rewriteProfileState(
      LEGACY_DEFAULT_PROFILE_KEY,
      Buffer.alloc(DEFAULT_EMBEDDING_PROFILE.dim * Float32Array.BYTES_PER_ELEMENT, 0x7f),
    )

    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    try {
      expect(writer.db.prepare('SELECT 1 AS usable').get()?.usable).toBe(1)
    } finally {
      writer.close()
    }

    expect(readProfileState()).toEqual({
      stamp: LOCKED_DEFAULT_PROFILE_KEY,
      embedStatus: 'pending',
      embedding: null,
    })
  })

  it('invalidates present bytes under an unknown stored stamp', async () => {
    await publishAndBuild()
    rewriteProfileState(
      'attacker-controlled-profile',
      Buffer.alloc(DEFAULT_EMBEDDING_PROFILE.dim * Float32Array.BYTES_PER_ELEMENT, 0x7f),
    )

    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    writer.close()

    expect(readProfileState()).toEqual({
      stamp: LOCKED_DEFAULT_PROFILE_KEY,
      embedStatus: 'pending',
      embedding: null,
    })
  })

  it.each([
    ['locked default', DEFAULT_EMBEDDING_PROFILE],
    ['static floor', STATIC_FLOOR_EMBEDDING_PROFILE],
  ] as const)('leaves present bytes unchanged for a matching %s stamp', async (_name, profile) => {
    await publishAndBuild()
    const marker = Buffer.alloc(profile.dim * Float32Array.BYTES_PER_ELEMENT, 0x31)
    const profileKey = knowledgeLocal.embeddingProfileKey(profile)
    rewriteProfileState(profileKey, marker)

    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    writer.close()

    const state = readProfileState()
    expect(state.stamp).toBe(profileKey)
    expect(state.embedStatus).toBe('present')
    expect(Buffer.from(state.embedding as Uint8Array)).toEqual(marker)
  })

  it('opens a fresh knowledge root without rows and returns a usable writer', () => {
    const writer = knowledgeLocal.openIndexWriter(knowledgeRoot, {
      vecLoadablePath: join(root, 'missing-sqlite-vec-extension'),
    })
    try {
      expect(writer.db.prepare('SELECT COUNT(*) AS count FROM records').get()?.count).toBe(0)
      expect(
        writer.db
          .prepare("SELECT v FROM meta WHERE k = 'embedding_profile'")
          .get()?.v,
      ).toBe(LOCKED_DEFAULT_PROFILE_KEY)
    } finally {
      writer.close()
    }
  })
})
