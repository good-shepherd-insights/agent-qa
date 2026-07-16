import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  asEvidenceToken,
  type Anchor,
  type BundleOutcomeEvent,
  type Delta,
  type RecordId,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const denseHarness = vi.hoisted(() => {
  const triggerToken = 'quartzjellyvaultneedle37914'
  const ftsIntent = [
    'ambercipher',
    'cobaltorbit',
    'denimquasar',
    'emeraldlattice',
    'fuchsiacompass',
    'goldenparallax',
    'hazelmonolith',
  ].join(' ')
  const denseIntent = 'semantic-only-retired-checkout-warning'

  function vector(axis: 0 | 1): Float32Array {
    const value = new Float32Array(384)
    value[axis] = 1
    return value
  }

  return {
    triggerToken,
    ftsIntent,
    denseIntent,
    embedder: {
      async embedDocument(rendering: string): Promise<Float32Array> {
        return vector(rendering.includes(triggerToken) ? 0 : 1)
      },
      async embedQuery(rendering: string): Promise<Float32Array> {
        return vector(rendering.includes(denseIntent) ? 0 : 1)
      },
    },
  }
})

vi.mock('../embedder-acquire.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embedder-acquire.js')>()
  const { DEFAULT_EMBEDDING_PROFILE } = await import('@vostride/agent-qa-schema')
  return {
    ...actual,
    acquireEmbedder: async () => ({
      kind: 'ready' as const,
      rung: 'native' as const,
      profile: DEFAULT_EMBEDDING_PROFILE,
      embedder: denseHarness.embedder,
    }),
  }
})

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  candidateContentAddress,
  commitCurationDelta,
  openIndexReaderConnection,
  openKnowledgeReader,
  publishBundle,
  rebuildIndex,
  retrieve,
  type AuthoredCheckpoint,
  type BuildCurationCandidateAddressFieldsInput,
  type BundleStoreConfig,
  type CommitCurationDependencies,
  type CommitCurationJob,
  type PublishBundleOutcome,
  type RetrievalQueryInput,
} from '../index.js'
import {
  makeBundleDraftFixture,
  makeScreenStateFixture,
  scaffoldKnowledgeRoot,
} from './fixtures/bundle-fixture.js'
import { candidateAddressFixture } from './fixtures/curation-candidate-fixture.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

interface ForgettingCorpus {
  trigger: PublishedBundle
  neighbors: readonly [PublishedBundle, PublishedBundle]
}

const PRODUCT = 'verified-forgetting-storefront'
const SCOPE = { tier: 'product', key: PRODUCT } as const
const SHARED_PAGE = { t: 'page', route: '/verified-forgetting' } as const satisfies Anchor
const PLATFORM = { t: 'platform', platform: 'web' } as const satisfies Anchor
const TRIGGER_ANCHOR = {
  t: 'error',
  message: `${denseHarness.triggerToken} ${denseHarness.ftsIntent} deprecated fallback`,
} as const satisfies Anchor
const NEIGHBOR_ANCHORS = [
  { t: 'el', role: 'button', name: 'Verified primary checkout', ordinal: 0 },
  { t: 'el', role: 'button', name: 'Verified backup checkout', ordinal: 0 },
] as const satisfies readonly Anchor[]
const TRIGGER_ORDINAL = 102
const DEPRECATION_ORDINAL = 105

let root: string
let knowledgeRoot: string
let auditBaseDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-verified-forgetting-'))
  knowledgeRoot = join(root, 'agent-qa-knowledge')
  auditBaseDir = join(root, '.agent-qa')
  scaffoldKnowledgeRoot(knowledgeRoot)
  writeFileSync(join(knowledgeRoot, '.epoch'), '1\n', 'utf8')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function config(): BundleStoreConfig {
  return {
    knowledgeRoot,
    productKey: PRODUCT,
    auditBaseDir,
    commitArtifacts: 'none',
  }
}

function activeEvents(identity: string, buildOrdinal: number): BundleOutcomeEvent[] {
  return [
    BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: `${identity}-confirmed`,
      curationJobId: `${identity}-confirmed-job`,
      buildOrdinal,
      origin: 'agent-verified',
    }),
    BundleOutcomeEventSchema.parse({
      type: 'promoted',
      evidenceToken: `${identity}-promoted`,
      curationJobId: `${identity}-promoted-job`,
      buildOrdinal,
    }),
  ]
}

function publishFact(identity: string, anchor: Anchor, buildOrdinal: number): PublishedBundle {
  const outcome = publishBundle(config(), {
    draft: makeBundleDraftFixture({
      anchors: [anchor, SHARED_PAGE, PLATFORM],
      scope: SCOPE,
      summary: `${identity} is a live checkout control`,
      body: `${identity} remains valid while the verified-forgetting fixture is active.`,
    }),
    discriminant: {
      kind: 'fact',
      subtype: 'selector',
      elementRef: anchor.t === 'el'
        ? { role: anchor.role, name: anchor.name }
        : { role: 'button', name: identity },
    },
    originClass: 'agent-verified',
    createdAtOrdinal: buildOrdinal,
    screenStates: [makeScreenStateFixture(buildOrdinal % 3)],
    initialEvents: activeEvents(identity, buildOrdinal),
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: 'verified-forgetting-fixture-run',
      testId: `verified-forgetting-${identity}`,
      stepIndex: buildOrdinal,
    },
    artifacts: [],
  })
  if (outcome.kind !== 'published') {
    throw new Error(`expected ${identity} publication, got ${outcome.kind}`)
  }
  return outcome
}

function publishCorpus(): ForgettingCorpus {
  const neighbors = [
    publishFact('primary-neighbor', NEIGHBOR_ANCHORS[0], 100),
    publishFact('backup-neighbor', NEIGHBOR_ANCHORS[1], 101),
  ] as const
  const outcome = publishBundle(config(), {
    draft: makeBundleDraftFixture({
      kind: 'caution',
      anchors: [TRIGGER_ANCHOR, SHARED_PAGE, PLATFORM],
      scope: SCOPE,
      summary: `Never serve ${denseHarness.triggerToken} after deprecation`,
      body: `The ${denseHarness.ftsIntent} fallback is poison once its lifecycle closes.`,
    }),
    discriminant: {
      kind: 'caution',
      errorKey: `${denseHarness.triggerToken}-checkout-fallback`,
    },
    originClass: 'agent-verified',
    createdAtOrdinal: TRIGGER_ORDINAL,
    screenStates: [makeScreenStateFixture()],
    initialEvents: activeEvents('forgetting-trigger', TRIGGER_ORDINAL),
    relations: neighbors.map((neighbor, index) => ({
      type: 'relates-to' as const,
      targetId: neighbor.id,
      addedAtOrdinal: TRIGGER_ORDINAL,
      curationJobId: `forgetting-trigger-relation-${index}`,
    })),
    provenance: {
      mode: 'run-linked',
      runId: 'verified-forgetting-fixture-run',
      testId: 'verified-forgetting-trigger',
      stepIndex: 2,
    },
    artifacts: [],
  })
  if (outcome.kind !== 'published') {
    throw new Error(`expected trigger publication, got ${outcome.kind}`)
  }
  return { trigger: outcome, neighbors }
}

function deprecationJob(identity: string): CommitCurationJob {
  const address: BuildCurationCandidateAddressFieldsInput = candidateAddressFixture({
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: `verified-forgetting-${identity}-run`,
    scope: SCOPE,
    buildOrdinal: DEPRECATION_ORDINAL,
    executionContext: 'local-interactive',
    secretFlagged: false,
    injectionFlagged: false,
    kind: 'fact',
    subtype: 'selector',
    anchors: [TRIGGER_ANCHOR, SHARED_PAGE, PLATFORM],
    summarySeed: `Withdraw ${denseHarness.triggerToken}`,
    bodySeed: 'The user withdrew the deprecated checkout fallback.',
    distilledObservations: [
      {
        schemaVersion: 1,
        step: { naturalKey: 'withdraw deprecated checkout fallback', ordinal: 0 },
        platform: 'web',
        error: { naturalKey: denseHarness.triggerToken },
        observedAtOrdinal: DEPRECATION_ORDINAL,
      },
    ],
    evidenceToken: `verified-forgetting-${identity}-evidence`,
    attributingObservationId: `verified-forgetting-${identity}:step-0`,
    artifactInventory: [],
    captureReceipt: artifactFreeCaptureReceipt(),
    emittedAt: '2026-07-16T00:00:00.000Z',
  })
  const payload = {
    candidateId: candidateContentAddress(address),
    ...address,
  }
  const candidateDir = join(root, 'claimed', payload.candidateId)
  const artifactsDir = join(candidateDir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  return {
    kind: 'claimed',
    candidateId: payload.candidateId,
    leaseId: `verified-forgetting-${identity}-lease`,
    payload,
    candidateDir,
    payloadPath: join(candidateDir, 'payload.json'),
    artifactsDir,
    screenStates: [makeScreenStateFixture()],
  }
}

function deprecationCheckpoint(
  triggerId: RecordId,
  job: CommitCurationJob,
): AuthoredCheckpoint {
  const authorship = {
    path: 'llm' as const,
    model: { id: 'verified-forgetting-maintenance' },
    executionContext: 'local-interactive' as const,
  }
  const precondition = {
    recordId: triggerId,
    observedStatus: 'active' as const,
    observedOrdinal: TRIGGER_ORDINAL,
  }
  const delta: Extract<Delta, { kind: 'Deprecate' }> = {
    kind: 'Deprecate',
    origin: 'user',
    scope: SCOPE,
    citedIds: [triggerId],
    precondition: [precondition],
    authorship,
    targetId: triggerId,
    reason: 'user withdrew a verified poisoned checkout fallback',
  }
  return {
    schemaVersion: 1,
    delta,
    neighborIds: [triggerId],
    preconditions: [precondition],
    authorship,
  }
}

function dependencies(
  hooks?: CommitCurationDependencies['hooks'],
): CommitCurationDependencies {
  return {
    knowledgeRoot,
    auditBaseDir,
    epoch: 1,
    profile: { mode: 'drain-to-active' },
    drainState: { supersedesSeenByAnchorKey: new Map() },
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    ...(hooks === undefined ? {} : { hooks }),
  }
}

async function query(
  input: RetrievalQueryInput,
  asOfBuild: number,
): Promise<Awaited<ReturnType<typeof retrieve>>> {
  const reader = openKnowledgeReader(knowledgeRoot)
  try {
    return await retrieve(reader, input, {
      n: 16,
      product: PRODUCT,
      asOfBuild,
    })
  } finally {
    reader.close()
  }
}

async function recallByServingLegs(asOfBuild: number): Promise<{
  fts: Awaited<ReturnType<typeof retrieve>>
  dense: Awaited<ReturnType<typeof retrieve>>
  graph: Awaited<ReturnType<typeof retrieve>>
}> {
  return {
    fts: await query({ intent: denseHarness.ftsIntent, anchors: [] }, asOfBuild),
    dense: await query({ intent: denseHarness.denseIntent, anchors: [] }, asOfBuild),
    graph: await query({ intent: '', anchors: [NEIGHBOR_ANCHORS[0]] }, asOfBuild),
  }
}

function neighborSituatingLines(corpus: ForgettingCorpus): string[] {
  const connection = openIndexReaderConnection(knowledgeRoot)
  try {
    return corpus.neighbors.map((neighbor) => {
      const row = connection.db.prepare(`
        SELECT situating_line
        FROM records
        WHERE bundle_id = ?
      `).get(neighbor.id)
      if (row === undefined) throw new Error(`missing neighbor projection ${neighbor.id}`)
      return String(row.situating_line)
    })
  } finally {
    connection.db.close()
  }
}

function ids(entries: Awaited<ReturnType<typeof retrieve>>): string[] {
  return entries.map(({ id }) => String(id))
}

describe('verified forgetting acceptance (DCAY-04 D-12)', () => {
  it('proves positive then zero recall across FTS, dense, graph, renderings, and anchors', async () => {
    const corpus = publishCorpus()
    await expect(
      rebuildIndex({ knowledgeRoot, embedder: denseHarness.embedder }),
    ).resolves.toMatchObject({ projected: 3, scanIssues: [], pendingEmbeddings: 0 })

    const before = await recallByServingLegs(DEPRECATION_ORDINAL - 1)
    expect(ids(before.fts)).toContain(corpus.trigger.id)
    expect(ids(before.dense)).toContain(corpus.trigger.id)
    expect(ids(before.graph)).toContain(corpus.trigger.id)
    expect(
      neighborSituatingLines(corpus).every((line) =>
        line.includes(denseHarness.triggerToken)),
    ).toBe(true)

    const job = deprecationJob('production-path')
    const committed = commitCurationDelta(
      dependencies(),
      job,
      deprecationCheckpoint(corpus.trigger.id, job),
    )
    expect(committed).toMatchObject({
      kind: 'applied',
      bundleId: corpus.trigger.id,
      deltaKind: 'Deprecate',
    })

    await expect(
      rebuildIndex({ knowledgeRoot, embedder: denseHarness.embedder }),
    ).resolves.toMatchObject({ scanIssues: [], pendingEmbeddings: 0 })

    const after = await recallByServingLegs(DEPRECATION_ORDINAL + 1)
    expect(ids(after.fts)).not.toContain(corpus.trigger.id)
    expect(ids(after.dense)).not.toContain(corpus.trigger.id)
    expect(ids(after.graph)).not.toContain(corpus.trigger.id)
    expect(
      neighborSituatingLines(corpus).every((line) =>
        !line.includes(denseHarness.triggerToken)),
    ).toBe(true)

    const anchorResults = await query(
      { intent: '', anchors: [SHARED_PAGE] },
      DEPRECATION_ORDINAL + 1,
    )
    expect(ids(anchorResults)).toEqual(
      expect.arrayContaining(corpus.neighbors.map(({ id }) => id)),
    )
    expect(ids(anchorResults)).not.toContain(corpus.trigger.id)
    expect(anchorResults.every(({ status }) => status === 'active')).toBe(true)
  })
})
