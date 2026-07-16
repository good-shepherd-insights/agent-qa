import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  asRecordId,
  canonicalJson,
  supersessionKey,
  type Anchor,
  type BundleDraft,
  type BundleOutcomeEvent,
  type Delta,
  type RecordId,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  appendOutcomeEvent,
  artifactFreeCaptureReceipt,
  candidateContentAddress,
  commitCurationDelta,
  deriveBundleTrust,
  enumerateBundleDirs,
  loadBundle,
  publishBundle,
  type AuthoredCheckpoint,
  type CommitCurationDependencies,
  type CommitCurationJob,
  type LoadedBundle,
} from '../../index.js'
import { acquireWriterLease } from '../../lease/writer-lease.js'
import { candidateAddressFixture } from '../../__tests__/fixtures/curation-candidate-fixture.js'

const scope = { tier: 'product', key: 'storefront' } as const
const anchors: Anchor[] = [
  { t: 'el', role: 'button', name: 'Checkout' },
  { t: 'page', route: '/checkout' },
]

let root: string
let knowledgeRoot: string
let auditBaseDir: string
let epoch: number

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-thrash-guard-'))
  knowledgeRoot = join(root, 'agent-qa-knowledge')
  auditBaseDir = join(root, '.agent-qa')
  const lease = acquireWriterLease(knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error('expected a fresh writer lease')
  epoch = lease.epoch
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function draft(generation: number): BundleDraft {
  return {
    kind: 'fact',
    subtype: 'measurement',
    anchors: [...anchors],
    scope,
    summary: `Checkout lineage generation ${generation}`,
    body: `Canonical checkout lineage generation ${generation}.`,
    distilledEvidenceRef: {
      id: `thrash-generation-${generation}`,
      sha: generation.toString(16).padStart(64, '0'),
    },
    originStage: 'run-curation',
  }
}

function storeConfig(writerLeaseId?: string) {
  return {
    knowledgeRoot,
    productKey: scope.key,
    auditBaseDir,
    commitArtifacts: 'none' as const,
    ...(writerLeaseId === undefined ? {} : { writerLeaseId }),
  }
}

function publishGeneration(generation: number, buildOrdinal: number) {
  const published = publishBundle(storeConfig(), {
    draft: draft(generation),
    discriminant: {
      kind: 'fact',
      subtype: 'measurement',
      metricKey: `thrash-generation-${generation}`,
    },
    originClass: 'agent-verified',
    createdAtOrdinal: buildOrdinal,
    screenStates: [],
    initialEvents: [
      {
        type: 'promoted',
        evidenceToken: asEvidenceToken(`promoted-${generation}`),
        curationJobId: `seed-generation-${generation}`,
        buildOrdinal,
      },
    ],
    relations: [],
    provenance: { mode: 'standalone', sourceDescription: 'thrash fixture' },
    artifacts: [],
  })
  if (published.kind !== 'published') {
    throw new Error(`expected generation publish, got ${published.kind}`)
  }
  return published
}

function appendLifecycleEvent(recordId: RecordId, event: BundleOutcomeEvent): void {
  const appended = appendOutcomeEvent(storeConfig(), recordId, event)
  expect(appended.kind).toBe('appended')
}

function seedTwoSupersessions() {
  const first = publishGeneration(1, 1)
  const second = publishGeneration(2, 2)
  const third = publishGeneration(3, 3)

  for (const [victim, replacement, ordinal] of [
    [first.id, second.id, 2],
    [second.id, third.id, 3],
  ] as const) {
    appendLifecycleEvent(victim, {
      type: 'superseded',
      evidenceToken: asEvidenceToken(`seed-superseded-${ordinal}`),
      curationJobId: `seed-supersession-${ordinal}`,
      buildOrdinal: ordinal,
      byRecordId: replacement,
    })
    appendLifecycleEvent(victim, {
      type: 'window-close',
      evidenceToken: asEvidenceToken(`seed-window-close-${ordinal}`),
      curationJobId: `seed-supersession-${ordinal}`,
      buildOrdinal: ordinal,
      closedAtOrdinal: ordinal,
    })
  }

  return { first, second, third }
}

function job(generation: number, buildOrdinal: number): CommitCurationJob {
  const fields = candidateAddressFixture({
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: `run-thrash-${generation}`,
    scope,
    buildOrdinal,
    executionContext: 'local-interactive',
    secretFlagged: false,
    injectionFlagged: false,
    kind: 'fact',
    subtype: 'measurement',
    anchors,
    summarySeed: `Checkout lineage generation ${generation}`,
    bodySeed: `Canonical checkout lineage generation ${generation}.`,
    distilledObservations: [],
    evidenceToken: `thrash-evidence-${generation}-${buildOrdinal}`,
    attributingObservationId: `thrash-observation-${generation}-${buildOrdinal}`,
    artifactInventory: [],
    captureReceipt: artifactFreeCaptureReceipt(),
    emittedAt: '2026-07-16T00:00:00.000Z',
  })
  const payload = { candidateId: candidateContentAddress(fields), ...fields }
  const candidateDir = join(root, 'claimed', payload.candidateId)
  const artifactsDir = join(candidateDir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  return {
    kind: 'claimed',
    candidateId: payload.candidateId,
    leaseId: 'thrash-fixture-lease',
    payload,
    candidateDir,
    payloadPath: join(candidateDir, 'payload.json'),
    artifactsDir,
    screenStates: [],
  }
}

function checkpoint(delta: Delta): AuthoredCheckpoint {
  return {
    schemaVersion: 1,
    delta,
    neighborIds: [...delta.citedIds],
    preconditions: [],
    authorship: {
      path: 'llm',
      model: { id: 'curator-fixture' },
      executionContext: 'local-interactive',
    },
  }
}

function drainState(): CommitCurationDependencies['drainState'] {
  return { supersedesSeenByAnchorKey: new Map() }
}

function deps(state = drainState()): CommitCurationDependencies {
  return {
    knowledgeRoot,
    auditBaseDir,
    epoch,
    profile: { mode: 'drain-to-active' },
    drainState: state,
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
  }
}

function supersede(
  victimId: RecordId,
  generation: number,
  buildOrdinal: number,
) {
  const claimed = job(generation, buildOrdinal)
  const delta: Extract<Delta, { kind: 'Supersede' }> = {
    kind: 'Supersede',
    origin: 'agent',
    scope,
    citedIds: [victimId],
    victimId,
    newBundle: draft(generation),
    evidenceToken: asEvidenceToken(claimed.payload.evidenceToken),
    authorship: {
      path: 'llm',
      model: { id: 'curator-fixture' },
      executionContext: 'local-interactive',
    },
  }
  const authored = checkpoint(delta)
  return {
    claimed,
    delta,
    authored,
    outcome: commitCurationDelta(deps(), claimed, authored),
  }
}

function confirm(targetId: RecordId, buildOrdinal: number) {
  const claimed = job(100 + buildOrdinal, buildOrdinal)
  const delta: Extract<Delta, { kind: 'Confirm' }> = {
    kind: 'Confirm',
    origin: 'agent',
    scope,
    citedIds: [targetId],
    targetId,
    evidenceToken: asEvidenceToken(claimed.payload.evidenceToken),
    authorship: {
      path: 'llm',
      model: { id: 'curator-fixture' },
      executionContext: 'local-interactive',
    },
  }
  return commitCurationDelta(deps(), claimed, checkpoint(delta))
}

function loadedBundles(): LoadedBundle[] {
  return enumerateBundleDirs(knowledgeRoot).flatMap((entry) => {
    const loaded = loadBundle(entry.dir)
    return loaded.kind === 'loaded' ? [loaded.bundle] : []
  })
}

function unknowns(): LoadedBundle[] {
  return loadedBundles().filter((bundle) => bundle.frontmatter.kind === 'unknown')
}

function loadById(id: RecordId): LoadedBundle {
  const bundle = loadedBundles().find((candidate) => candidate.manifest.id === id)
  if (bundle === undefined) throw new Error(`missing bundle ${id}`)
  return bundle
}

function tripThrashGuard() {
  const lineage = seedTwoSupersessions()
  const tripping = supersede(lineage.third.id, 4, 4)
  expect(tripping.outcome.kind).toBe('applied')
  if (tripping.outcome.kind !== 'applied') throw new Error('expected applied tripping write')
  return { lineage, tripping, replacementId: tripping.outcome.bundleId }
}

describe('thrash guard lineage and lifecycle (DCAY-03)', () => {
  it('commits the third supersession and one self-contained anchor unknown', () => {
    const { lineage, tripping, replacementId } = tripThrashGuard()
    const committedUnknowns = unknowns()
    expect(committedUnknowns).toHaveLength(1)

    const unknown = committedUnknowns[0]!
    const triggerKey = supersessionKey(anchors)
    const evidenceRecordIds = [
      lineage.first.id,
      lineage.second.id,
      lineage.third.id,
      replacementId,
    ].sort()
    expect(unknown.frontmatter.anchors[0]?.normalized).toEqual({
      t: 'flow',
      name: `thrash:${triggerKey}:window:1`,
    })
    expect(JSON.parse(unknown.body)).toEqual({
      kind: 'thrash',
      triggerKey,
      windowOpenOrdinal: 1,
      windowCloseOrdinal: 4,
      evidenceRecordIds,
    })
    expect(
      unknown.relations.relations
        .filter((relation) => relation.type === 'conflicts-with')
        .map((relation) => relation.targetId)
        .sort(),
    ).toEqual(evidenceRecordIds)
    expect(deriveBundleTrust(unknown).status).toBe('candidate')

    const replay = commitCurationDelta(deps(), tripping.claimed, tripping.authored)
    expect(['noop', 'converted-confirm']).toContain(replay.kind)
    expect(unknowns()).toHaveLength(1)
  })

  it('continues Confirm and Supersede writes while the anchor is memory-off', () => {
    const { replacementId } = tripThrashGuard()

    expect(confirm(replacementId, 5).kind).toBe('applied')
    const next = supersede(replacementId, 5, 6)
    expect(next.outcome.kind).toBe('applied')
    expect(unknowns()).toHaveLength(1)
    expect(deriveBundleTrust(unknowns()[0]!).status).toBe('candidate')
  })

  it('resolves the unknown only after a five-build stable Confirm window', () => {
    const { replacementId } = tripThrashGuard()
    const unknownId = asRecordId(unknowns()[0]!.manifest.id)

    expect(confirm(replacementId, 6).kind).toBe('applied')
    expect(deriveBundleTrust(loadById(unknownId)).status).toBe('candidate')

    expect(confirm(replacementId, 9).kind).toBe('applied')
    const resolved = loadById(unknownId)
    expect(deriveBundleTrust(resolved).status).toBe('deprecated')
    expect(resolved.events).toContainEqual(expect.objectContaining({
      type: 'deprecated',
      buildOrdinal: 9,
      reason: 'thrash-stable-window',
    }))
  })

  it('keeps the expected trigger payload canonical and value-free', () => {
    const triggerKey = supersessionKey(anchors)
    expect(canonicalJson({ kind: 'thrash', triggerKey })).not.toContain('Checkout lineage')
  })
})
