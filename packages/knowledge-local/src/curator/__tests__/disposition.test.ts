import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  DELTA_ORIGINS,
  asEvidenceToken,
  asRecordId,
  type Anchor,
  type CompareAndSet,
  type Delta,
  type DeltaOrigin,
  type MeasurementBaseline,
  type MeasurementObservation,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  appendMeasurementObservation,
  appendOutcomeEvent,
  authoredCheckpointSchema,
  deriveBundleTrust,
  disposeDelta,
  loadBundle,
  parseAuthoredCheckpoint,
  resolveDispositionProfile,
  sliceAuthoredCheckpoint,
  writeMeasurementBaseline,
  type AuthoredDeltaCheckpoint,
  type AuthorOutcome,
  type CurationJobView,
  type CuratorAuthor,
  type NeighborRecord,
} from '../../index.js'
import { publishBundle } from '../../bundle-publish.test-helper.js'
import {
  makeBundleDraftFixture,
  makeDiscriminantFixture,
} from '../../__tests__/fixtures/bundle-fixture.js'

const scope = { tier: 'product', key: 'storefront' } as const
const citedRecordId = asRecordId('fact-checkout-button')
const precondition = {
  recordId: citedRecordId,
  observedStatus: 'active',
  observedOrdinal: 41,
}

const authoredCheckpoint = {
  schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  deltas: [{
    kind: 'Confirm',
    origin: 'agent',
    scope,
    citedIds: [citedRecordId],
    precondition: [precondition],
    targetId: citedRecordId,
    evidenceToken: asEvidenceToken('evidence-checkout-button'),
  }],
  neighborIds: [citedRecordId],
  preconditions: [precondition],
  authorship: {
    path: 'llm',
    model: { id: 'curator-model', family: 'test-family' },
    executionContext: 'local-interactive',
  },
} as const

let root: string
let knowledgeRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-disposition-'))
  knowledgeRoot = join(root, 'agent-qa-knowledge')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function checkpoint(
  delta: Delta,
  neighborIds: RecordId[],
  preconditions: CompareAndSet[],
): AuthoredDeltaCheckpoint {
  const parsed = parseAuthoredCheckpoint({
    schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
    deltas: [delta],
    neighborIds,
    preconditions,
    authorship: {
      path: 'llm',
      model: { id: 'curator-model' },
      executionContext: 'local-interactive',
    },
  })
  return sliceAuthoredCheckpoint(parsed)[0]!
}

function publishActive(
  anchors: Anchor[],
  createdAtOrdinal = 40,
  recordScope: ScopeKey = scope,
): { id: RecordId; dir: string } {
  const draft = makeBundleDraftFixture({ anchors, scope: recordScope })
  const published = publishBundle(
    {
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    },
    {
      draft,
      discriminant: makeDiscriminantFixture(),
      originClass: 'agent-verified',
      createdAtOrdinal,
      screenStates: [],
      initialEvents: [
        BundleOutcomeEventSchema.parse({
          type: 'promoted',
          evidenceToken: `promoted-${createdAtOrdinal}`,
          curationJobId: `publish-${createdAtOrdinal}`,
          buildOrdinal: createdAtOrdinal,
        }),
      ],
      relations: [],
      provenance: { mode: 'standalone', sourceDescription: 'disposition fixture' },
      artifacts: [],
    },
  )
  if (published.kind !== 'published') throw new Error(`expected publish, got ${published.kind}`)
  return { id: published.id, dir: published.dir }
}

function observed(recordId: RecordId, ordinal = 40, status = 'active'): CompareAndSet {
  return { recordId, observedStatus: status, observedOrdinal: ordinal }
}

function supersedeDelta(
  victimId: RecordId,
  anchors: Anchor[],
  precondition: CompareAndSet,
): Extract<Delta, { kind: 'Supersede' }> {
  return {
    kind: 'Supersede',
    origin: 'agent',
    scope,
    citedIds: [victimId],
    precondition: [precondition],
    victimId,
    newBundle: makeBundleDraftFixture({ anchors, scope }),
    evidenceToken: asEvidenceToken(`supersede-${victimId}`),
  }
}

function candidate(anchors: Anchor[], buildOrdinal = 41, candidateScope: ScopeKey = scope) {
  return {
    anchors,
    buildOrdinal,
    scope: candidateScope,
    curationJobId: 'candidate-job',
  }
}

function drainState(): { supersedesSeenByAnchorKey: Map<string, number> } {
  return { supersedesSeenByAnchorKey: new Map() }
}

const measurementAnchors: Anchor[] = [
  { t: 'flow', name: 'measurement:reported-value' },
  { t: 'platform', platform: 'web' },
]

function measurementObservation(value: number, buildOrdinal: number): MeasurementObservation {
  return {
    value,
    buildOrdinal,
    evidenceToken: `measurement-${buildOrdinal}`,
    curationJobId: `measurement-job-${buildOrdinal}`,
  }
}

function publishMeasurement(
  baseline: MeasurementBaseline,
  observations: readonly MeasurementObservation[],
): { id: RecordId; dir: string } {
  const draft = makeBundleDraftFixture({
    subtype: 'measurement',
    anchors: measurementAnchors,
    scope,
    summary: 'reported-value measured as 100',
    body: 'Verified reported-value value: 100.',
  })
  const published = publishBundle(
    {
      knowledgeRoot,
      productKey: 'storefront',
      auditBaseDir: join(root, '.agent-qa'),
      commitArtifacts: 'none',
    },
    {
      draft,
      discriminant: makeDiscriminantFixture('fact', 'measurement'),
      originClass: 'agent-verified',
      createdAtOrdinal: baseline.openedAtOrdinal,
      screenStates: [],
      initialEvents: [
        BundleOutcomeEventSchema.parse({
          type: 'promoted',
          evidenceToken: `promoted-${baseline.openedAtOrdinal}`,
          curationJobId: `publish-${baseline.openedAtOrdinal}`,
          buildOrdinal: baseline.openedAtOrdinal,
        }),
      ],
      relations: [],
      provenance: { mode: 'standalone', sourceDescription: 'measurement fixture' },
      artifacts: [],
    },
  )
  if (published.kind !== 'published') throw new Error(`expected publish, got ${published.kind}`)

  const config = {
    knowledgeRoot,
    productKey: 'storefront',
    auditBaseDir: join(root, '.agent-qa'),
    commitArtifacts: 'none' as const,
  }
  expect(writeMeasurementBaseline(config, published.id, baseline).kind).toBe('appended')
  for (const observation of observations) {
    expect(appendMeasurementObservation(config, published.id, observation).kind).toBe('appended')
  }
  return { id: published.id, dir: published.dir }
}

function measurementSupersede(
  victimId: RecordId,
  value: string,
): Extract<Delta, { kind: 'Supersede' }> {
  return {
    kind: 'Supersede',
    origin: 'agent',
    scope,
    citedIds: [victimId],
    precondition: [observed(victimId)],
    victimId,
    newBundle: makeBundleDraftFixture({
      subtype: 'measurement',
      anchors: measurementAnchors,
      scope,
      summary: `reported-value measured as ${value}`,
      body: `Verified reported-value value: ${value}.`,
    }),
    evidenceToken: asEvidenceToken(`supersede-${victimId}-${value}`),
  }
}

function measurementCandidate(value: string, buildOrdinal: number) {
  return {
    ...candidate(measurementAnchors, buildOrdinal),
    measurementValue: value,
  }
}

describe('Curator author contract (CUR-01/SAFE-01)', () => {
  it('round-trips a structurally valid authored checkpoint with resolved ids', () => {
    expect(authoredCheckpointSchema.parse(authoredCheckpoint)).toEqual(authoredCheckpoint)
    expect(parseAuthoredCheckpoint(authoredCheckpoint)).toEqual(authoredCheckpoint)
  })

  it('leaves persisted-neighbor membership to disposition check 1', () => {
    const absentFromNeighborSet = {
      ...authoredCheckpoint,
      neighborIds: [asRecordId('different-neighbor')],
    }

    expect(() => authoredCheckpointSchema.parse(absentFromNeighborSet)).not.toThrow()
  })

  it('maps all SAFE-01 execution contexts to their authority mode', () => {
    expect(resolveDispositionProfile('local-interactive')).toEqual({
      mode: 'drain-to-active',
    })
    for (const executionContext of ['ci', 'cloud', 'local-headless'] as const) {
      expect(resolveDispositionProfile(executionContext)).toEqual({ mode: 'propose-only' })
    }
  })

  it('types the injected author seam and its complete outcome union', () => {
    expectTypeOf<CuratorAuthor>().toEqualTypeOf<
      (job: CurationJobView, neighbors: NeighborRecord[]) => Promise<AuthorOutcome>
    >()

    const parsedCheckpoint = parseAuthoredCheckpoint(authoredCheckpoint)
    const authored: AuthorOutcome = {
      kind: 'authored',
      deltas: parsedCheckpoint.deltas,
      authorship: parsedCheckpoint.authorship,
    }
    const fallbackReasons: Record<
      Extract<AuthorOutcome, { kind: 'fallback-required' }>['reason'],
      true
    > = {
      malformed: true,
      'no-model': true,
      'token-budget': true,
      'model-error': true,
    }

    expect(authored.kind).toBe('authored')
    expect(Object.keys(fallbackReasons).sort()).toEqual([
      'malformed',
      'model-error',
      'no-model',
      'token-budget',
    ])
  })
})

describe('disposeDelta deterministic authority (CUR-01/SAFE-01)', () => {
  const primary: Anchor = { t: 'el', role: 'button', name: 'Sign in' }
  const page: Anchor = { t: 'page', route: '/login' }

  it('runs cited-id integrity against both the persisted neighbor set and bundle tree', () => {
    const victim = publishActive([primary, page])
    const precondition = observed(victim.id)
    const delta: Delta = {
      kind: 'Confirm',
      origin: 'agent',
      scope,
      citedIds: [victim.id],
      precondition: [precondition],
      targetId: victim.id,
      evidenceToken: asEvidenceToken('confirm-victim'),
    }

    const neverRetrieved = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [], [precondition]),
      profile: { mode: 'drain-to-active' },
      knowledgeRoot,
      candidate: candidate([primary, page]),
      drainState: drainState(),
    })
    expect(neverRetrieved).toMatchObject({
      kind: 'downgraded',
      reason: 'cited-id-integrity',
      original: delta,
    })

    rmSync(victim.dir, { recursive: true, force: true })
    const missingFromDisk = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [victim.id], [precondition]),
      profile: { mode: 'drain-to-active' },
      knowledgeRoot,
      candidate: candidate([primary, page]),
      drainState: drainState(),
    })
    expect(missingFromDisk).toMatchObject({
      kind: 'downgraded',
      reason: 'cited-id-integrity',
      original: delta,
    })
  })

  it('checks candidate anchor evidence and permits only the deterministic rename bridge', () => {
    const contradictoryAnchors = [{ t: 'el', role: 'button', name: 'Checkout' }, page] as Anchor[]
    const add: Delta = {
      kind: 'Add',
      origin: 'agent',
      scope,
      citedIds: [],
      bundle: makeBundleDraftFixture({ anchors: contradictoryAnchors, scope }),
    }
    expect(
      disposeDelta({
        delta: add,
        checkpoint: checkpoint(add, [], []),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate([primary, page]),
        drainState: drainState(),
      }),
    ).toMatchObject({ kind: 'downgraded', reason: 'anchor-consistency', original: add })

    const ordinaryVictim = publishActive([primary, page])
    const ordinaryPrecondition = observed(ordinaryVictim.id)
    const unrelatedAnchors = [{ t: 'el', role: 'link', name: 'Help' }, page] as Anchor[]
    const unrelated = supersedeDelta(
      ordinaryVictim.id,
      unrelatedAnchors,
      ordinaryPrecondition,
    )
    expect(
      disposeDelta({
        delta: unrelated,
        checkpoint: checkpoint(unrelated, [ordinaryVictim.id], [ordinaryPrecondition]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate(unrelatedAnchors),
        drainState: drainState(),
      }),
    ).toMatchObject({
      kind: 'downgraded',
      reason: 'anchor-consistency',
      original: unrelated,
    })

    rmSync(ordinaryVictim.dir, { recursive: true, force: true })
    const selector: Anchor = { t: 'selector', literal: '[data-action="sign-in"]' }
    const renamedVictim = publishActive([primary, page, selector])
    const renamedPrecondition = observed(renamedVictim.id)
    const renamedAnchors = [
      { t: 'el', role: 'button', name: 'Log in' },
      page,
      selector,
    ] as Anchor[]
    const renamed = supersedeDelta(renamedVictim.id, renamedAnchors, renamedPrecondition)
    expect(
      disposeDelta({
        delta: renamed,
        checkpoint: checkpoint(renamed, [renamedVictim.id], [renamedPrecondition]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate(renamedAnchors),
        drainState: drainState(),
      }),
    ).toMatchObject({
      kind: 'apply',
      delta: renamed,
      relationIntents: [{ type: 'renamed-from', targetId: renamedVictim.id }],
    })
  })

  it('preserves rename lineage when propose-only downgrades Supersede to Add', () => {
    const originalAnchors = [
      primary,
      page,
      { t: 'selector', literal: '[data-action="sign-in"]' },
    ] as Anchor[]
    const victim = publishActive(originalAnchors)
    const victimPrecondition = observed(victim.id)
    const renamedAnchors = [
      { t: 'el', role: 'button', name: 'Log in' },
      page,
      originalAnchors[2]!,
    ] as Anchor[]
    const delta = supersedeDelta(victim.id, renamedAnchors, victimPrecondition)

    const proposed = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [victim.id], [victimPrecondition]),
      profile: { mode: 'propose-only' },
      knowledgeRoot,
      candidate: candidate(renamedAnchors),
      drainState: drainState(),
    })

    expect(proposed).toMatchObject({
      kind: 'downgraded',
      reason: 'propose-only',
      original: delta,
      delta: { kind: 'Add', bundle: delta.newBundle },
    })
    expect(proposed).toHaveProperty('relationIntents', [
      { type: 'proposed-supersession-of', targetId: victim.id },
      { type: 'renamed-from', targetId: victim.id },
    ])
  })

  it('requires the shared supersession key and a strictly greater candidate ordinal', () => {
    const victim = publishActive([primary, page])
    const precondition = observed(victim.id)
    const differentSecondary = [primary, { t: 'page', route: '/account' }] as Anchor[]
    const wrongKey = supersedeDelta(victim.id, differentSecondary, precondition)
    expect(
      disposeDelta({
        delta: wrongKey,
        checkpoint: checkpoint(wrongKey, [victim.id], [precondition]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate(differentSecondary),
        drainState: drainState(),
      }),
    ).toMatchObject({ kind: 'downgraded', reason: 'supersession-key' })

    const sameKey = supersedeDelta(victim.id, [primary, page], precondition)
    for (const newOrdinal of [40, 39]) {
      expect(
        disposeDelta({
          delta: sameKey,
          checkpoint: checkpoint(sameKey, [victim.id], [precondition]),
          profile: { mode: 'drain-to-active' },
          knowledgeRoot,
          candidate: candidate([primary, page], newOrdinal),
          drainState: drainState(),
        }),
      ).toMatchObject({ kind: 'downgraded', reason: 'supersession-key' })
    }
  })

  it('rejects an agent-origin Deprecate of active bundle truth', () => {
    const victim = publishActive([primary, page])
    const precondition = observed(victim.id)
    const delta: Delta = {
      kind: 'Deprecate',
      origin: 'agent',
      scope,
      citedIds: [victim.id],
      precondition: [precondition],
      targetId: victim.id,
      reason: 'model nominated removal',
    }

    expect(
      disposeDelta({
        delta,
        checkpoint: checkpoint(delta, [victim.id], [precondition]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate([primary, page]),
        drainState: drainState(),
      }),
    ).toMatchObject({ kind: 'downgraded', reason: 'autonomous-deprecate', original: delta })
  })

  it('requeues CAS movement from bundle truth even when a stale index fixture agrees', () => {
    const victim = publishActive([primary, page])
    const staleObservation = observed(victim.id, 40, 'candidate')
    const delta: Delta = {
      kind: 'Confirm',
      origin: 'agent',
      scope,
      citedIds: [victim.id],
      precondition: [staleObservation],
      targetId: victim.id,
      evidenceToken: asEvidenceToken('stale-index-confirm'),
    }
    const indexFixtureDir = join(knowledgeRoot, 'memory', 'index')
    mkdirSync(indexFixtureDir, { recursive: true })
    writeFileSync(
      join(indexFixtureDir, 'stale-index-truth.json'),
      JSON.stringify({ id: victim.id, status: 'candidate', ordinal: 40 }),
    )

    expect(
      disposeDelta({
        delta,
        checkpoint: checkpoint(delta, [victim.id], [staleObservation]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate([primary, page]),
        drainState: drainState(),
      }),
    ).toEqual({ kind: 'requeue-resynthesis', reason: 'compare-and-set' })
  })

  it('caps one Supersede per anchor per drain and confines candidate scope', () => {
    const victim = publishActive([primary, page])
    const precondition = observed(victim.id)
    const delta = supersedeDelta(victim.id, [primary, page], precondition)
    const sharedDrain = drainState()
    const input = {
      delta,
      checkpoint: checkpoint(delta, [victim.id], [precondition]),
      profile: { mode: 'drain-to-active' } as const,
      knowledgeRoot,
      candidate: candidate([primary, page]),
      drainState: sharedDrain,
    }

    expect(disposeDelta(input)).toMatchObject({ kind: 'apply', delta })
    expect(disposeDelta(input)).toMatchObject({
      kind: 'downgraded',
      reason: 'blast-radius-cap',
      original: delta,
      delta: { kind: 'MintUnknown', conflict: { kind: 'drift' } },
    })

    expect(
      disposeDelta({
        ...input,
        candidate: candidate(
          [primary, page],
          41,
          { tier: 'product', key: 'different-storefront' },
        ),
        drainState: drainState(),
      }),
    ).toMatchObject({ kind: 'downgraded', reason: 'blast-radius-scope' })
  })

  it('turns propose-only Supersede into a candidate plus relation intent', () => {
    const victim = publishActive([primary, page])
    const precondition = observed(victim.id)
    const delta = supersedeDelta(victim.id, [primary, page], precondition)

    const proposed = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [victim.id], [precondition]),
      profile: { mode: 'propose-only' },
      knowledgeRoot,
      candidate: candidate([primary, page]),
      drainState: drainState(),
    })
    expect(proposed).toMatchObject({
      kind: 'downgraded',
      reason: 'propose-only',
      original: delta,
      delta: { kind: 'Add', bundle: delta.newBundle },
    })
    expect(proposed).toHaveProperty('relationIntents', [
      { type: 'proposed-supersession-of', targetId: victim.id },
    ])

    const loadedVictim = loadBundle(victim.dir)
    expect(loadedVictim.kind).toBe('loaded')
    if (loadedVictim.kind !== 'loaded') throw new Error('expected loaded victim')
    expect(deriveBundleTrust(loadedVictim.bundle).status).toBe('active')

    expect(
      disposeDelta({
        delta,
        checkpoint: checkpoint(delta, [victim.id], [precondition]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate([primary, page]),
        drainState: drainState(),
      }),
    ).toMatchObject({ kind: 'apply', delta })
  })

  it('records every downgrade reason and original delta instead of dropping it', () => {
    const delta: Delta = {
      kind: 'Add',
      origin: 'agent',
      scope,
      citedIds: [],
      bundle: makeBundleDraftFixture({
        anchors: [{ t: 'el', role: 'link', name: 'Unverified' }, page],
        scope,
      }),
    }
    const outcome = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [], []),
      profile: { mode: 'drain-to-active' },
      knowledgeRoot,
      candidate: candidate([primary, page]),
      drainState: drainState(),
    })

    expect(outcome).toMatchObject({
      kind: 'downgraded',
      reason: expect.any(String),
      original: delta,
      delta: expect.objectContaining({ kind: expect.any(String) }),
    })
  })
})

describe('disposeDelta measurement mechanism #9 (DCAY-02)', () => {
  const baseline: MeasurementBaseline = {
    mu0: 100,
    sigma0: 1,
    n0: 5,
    openedAtOrdinal: 40,
  }

  function disposeMeasurementSupersede(
    victimId: RecordId,
    value: string,
    buildOrdinal: number,
    mode: 'drain-to-active' | 'propose-only' = 'drain-to-active',
  ) {
    const delta = measurementSupersede(victimId, value)
    const precondition = observed(victimId)
    return {
      delta,
      outcome: disposeDelta({
        delta,
        checkpoint: checkpoint(delta, [victimId], [precondition]),
        profile: { mode },
        knowledgeRoot,
        candidate: measurementCandidate(value, buildOrdinal),
        drainState: drainState(),
      }),
    }
  }

  it('widens a below-minimum measurement Supersede into Confirm plus append intent', () => {
    const victim = publishMeasurement(baseline, [
      measurementObservation(101, 41),
      measurementObservation(99, 42),
    ])
    const { delta, outcome } = disposeMeasurementSupersede(victim.id, '100', 43)

    expect(outcome).toMatchObject({
      kind: 'apply',
      delta: {
        kind: 'Confirm',
        targetId: victim.id,
        evidenceToken: delta.evidenceToken,
      },
      measurementAppend: {
        victimId: victim.id,
        observation: {
          value: 100,
          buildOrdinal: 43,
          evidenceToken: delta.evidenceToken,
          curationJobId: 'candidate-job',
        },
      },
    })
    expect(outcome).not.toHaveProperty('bornActive')
  })

  it('arms bornActive for confirmed drift only in drain-to-active', () => {
    const victim = publishMeasurement(baseline, [
      measurementObservation(200, 41),
      measurementObservation(201, 42),
      measurementObservation(202, 43),
      measurementObservation(203, 44),
    ])
    const { delta, outcome } = disposeMeasurementSupersede(victim.id, '204', 45)

    expect(outcome).toMatchObject({ kind: 'apply', delta, bornActive: true })
    expect(outcome).not.toHaveProperty('measurementAppend')
  })

  it('keeps the same confirmed drift candidate-only under propose-only', () => {
    const victim = publishMeasurement(baseline, [
      measurementObservation(200, 41),
      measurementObservation(201, 42),
      measurementObservation(202, 43),
      measurementObservation(203, 44),
    ])
    const { delta, outcome } = disposeMeasurementSupersede(
      victim.id,
      '204',
      45,
      'propose-only',
    )

    expect(outcome).toMatchObject({
      kind: 'downgraded',
      reason: 'propose-only',
      original: delta,
      delta: { kind: 'Add', bundle: delta.newBundle },
      relationIntents: [
        { type: 'proposed-supersession-of', targetId: victim.id },
      ],
    })
    expect(outcome).not.toHaveProperty('bornActive')
  })

  it('widens an oscillating two-band measurement instead of superseding it', () => {
    const bimodalBaseline: MeasurementBaseline = {
      mu0: 10,
      sigma0: 1,
      n0: 5,
      openedAtOrdinal: 40,
    }
    const victim = publishMeasurement(bimodalBaseline, [
      measurementObservation(10, 41),
      measurementObservation(100, 42),
      measurementObservation(11, 43),
      measurementObservation(101, 44),
      measurementObservation(12, 45),
    ])
    const { outcome } = disposeMeasurementSupersede(victim.id, '102', 46)

    expect(outcome).toMatchObject({
      kind: 'apply',
      delta: { kind: 'Confirm', targetId: victim.id },
      measurementAppend: {
        victimId: victim.id,
        observation: { value: 102, buildOrdinal: 46 },
      },
    })
    expect(outcome).not.toHaveProperty('bornActive')
  })

  it('bypasses numeric drift for non-numeric measurement values', () => {
    const victim = publishMeasurement(baseline, [
      measurementObservation(200, 41),
      measurementObservation(201, 42),
      measurementObservation(202, 43),
      measurementObservation(203, 44),
    ])
    const { delta, outcome } = disposeMeasurementSupersede(victim.id, 'not-a-number', 45)

    expect(outcome).toMatchObject({ kind: 'apply', delta })
    expect(outcome).not.toHaveProperty('measurementAppend')
    expect(outcome).not.toHaveProperty('bornActive')
  })

  it('routes a measurement Confirm through the same append discipline', () => {
    const victim = publishMeasurement(baseline, [
      measurementObservation(101, 41),
      measurementObservation(99, 42),
    ])
    const precondition = observed(victim.id)
    const delta: Delta = {
      kind: 'Confirm',
      origin: 'agent',
      scope,
      citedIds: [victim.id],
      precondition: [precondition],
      targetId: victim.id,
      evidenceToken: asEvidenceToken('confirm-measurement-100'),
    }

    const outcome = disposeDelta({
      delta,
      checkpoint: checkpoint(delta, [victim.id], [precondition]),
      profile: { mode: 'drain-to-active' },
      knowledgeRoot,
      candidate: measurementCandidate('100', 43),
      drainState: drainState(),
    })

    expect(outcome).toMatchObject({
      kind: 'apply',
      delta,
      measurementAppend: {
        victimId: victim.id,
        observation: {
          value: 100,
          buildOrdinal: 43,
          evidenceToken: delta.evidenceToken,
          curationJobId: 'candidate-job',
        },
      },
    })
  })
})

// ── CR-02′: what a cited-id-integrity failure FALLS BACK TO is decided by origin ──────────────
//
// `checkCitedIdIntegrity` used to have exactly one answer for every delta that failed it:
// downgrade to `MintUnknown`. For a pipeline-authored delta that is the right answer — a broken
// citation legitimately degrades an agent's proposed change into a clarification candidate a
// person can look at. For a delta a PERSON authored it fabricates authorship: the mint is a
// verbatim clone of the cited record's own content, republished as a fresh `candidate`, and a
// human's `accept` over a record they had already rejected therefore RESURRECTED the fact they
// removed and reported success (CR-02′, reproduced end-to-end in apply-review.test.ts).
//
// So the fallback is chosen from a TOTAL mapping over `DELTA_ORIGINS` rather than from a
// hand-picked member set, and this corpus walks the same runtime registry: every origin the
// vocabulary has gets an executed row, and a fifth origin reds this walk by existing.
//
// The expectation table below is declared INDEPENDENTLY of the production mapping on purpose —
// importing `CITED_ID_INTEGRITY_FALLBACK_BY_ORIGIN` and asserting against itself would be a
// tautology, and mutation probe m1 (flipping the `user` member to `mint-unknown`) has to red.
//
// RED BASELINE, observed against unmodified disposition.ts before the mapping landed:
//
//   × user-origin Confirm citing a deprecated record → refuses
//     → AssertionError: a user delta must be REFUSED rather than converted into minted content:
//       expected [Function] to throw an error
//   (same failure for each of the three failure conditions; the agent/import/system rows were
//   GREEN throughout, which is the preservation half of the claim and the reason they are here.)
//
// SECOND RED BASELINE, 387-17, observed against the shipped origin mapping when the condition
// axis was added — the four user rows and the directed message case, transcribed from the run:
//
//   × user-origin Confirm whose cited id is not-a-persisted-neighbor → refuses
//     → AssertionError: the refusal must name the condition it actually failed on:
//       expected undefined to be 'not-a-persisted-neighbor'
//   (…the same for missing-from-disk, deprecated and scope-mismatch)
//   × the refusal message names the record, the delta kind and the failing condition
//     → AssertionError: expected 'The record fact-el-button-sign-in-f8b263d47587b23a this Confirm
//       cites is tombstoned or cannot be resolved in this store, …' to contain 'scope-mismatch'
//
// Note what did NOT red: the scope-mismatch ROW's refusal itself was green from the first run.
// The shipped mapping already refused it — it was simply never EXECUTED, which is why round 2's
// carve-out mutation could delete that behaviour and leave 70 tests green. That row is therefore
// a coverage widening rather than a defect reproduction, and its load is measured by probe m1
// rather than by its own first run. The stated limit belongs here, not in a claim about it.
describe('cited-id integrity: the fallback is total over DeltaOrigin (CR-02′)', () => {
  const primary: Anchor = { t: 'el', role: 'button', name: 'Sign in' }
  const page: Anchor = { t: 'page', route: '/login' }

  type CitedIdIntegrityOutcome = 'refuses' | 'downgrades-to-mint-unknown'

  const EXPECTED_OUTCOME_BY_ORIGIN = {
    agent: 'downgrades-to-mint-unknown',
    user: 'refuses',
    import: 'downgrades-to-mint-unknown',
    system: 'downgrades-to-mint-unknown',
  } satisfies Record<DeltaOrigin, CitedIdIntegrityOutcome>

  /**
   * The ways `checkCitedIdIntegrity` can fail — COUNTED BY THE REGISTRY, not by this comment.
   *
   * The previous version of this block said "the THREE ways", and it was wrong when it was
   * written: the check's second return is a three-way disjunction (`truth === undefined ||
   * status === 'deprecated' || !sameScope(…)`), so there were always four. Round 2's verifier
   * proved the omission by mutation — carving `scope-mismatch` out of the refusal for EVERY
   * origin left 3 files / 70 tests green, because no row in this corpus ever reached it.
   *
   * So the walk is driven by a registry rather than by a list somebody keeps in step. A fifth
   * condition added to the union reds this walk by EXISTING: the fixture table below is
   * `satisfies Record<CitedIdIntegrityCondition, …>`, so a member with no fixture is a compile
   * error, and a fixture naming no member is the same.
   *
   * Scoping the refusal to `status === 'deprecated'` alone would be the same one-axis-out error
   * this phase keeps paying for: the check's failure domain is "this delta cites something this
   * store cannot stand behind", and a vanished record, an unpersisted neighbour or a record
   * addressed at a scope it does not carry is that fact just as much as a tombstoned one.
   */
  type CitedIdIntegrityCondition =
    | 'not-a-persisted-neighbor'
    | 'missing-from-disk'
    | 'deprecated'
    | 'scope-mismatch'

  const FAILURE_CONDITIONS = [
    'not-a-persisted-neighbor',
    'missing-from-disk',
    'deprecated',
    'scope-mismatch',
  ] as const satisfies readonly CitedIdIntegrityCondition[]

  function confirmCiting(origin: DeltaOrigin, targetId: RecordId): Delta {
    return {
      kind: 'Confirm',
      origin,
      scope,
      citedIds: [targetId],
      precondition: [observed(targetId)],
      targetId,
      evidenceToken: asEvidenceToken(`confirm-${origin}-${targetId}`),
    }
  }

  function deprecate(recordId: RecordId): void {
    const appended = appendOutcomeEvent(
      {
        knowledgeRoot,
        productKey: 'storefront',
        auditBaseDir: join(root, '.agent-qa'),
        commitArtifacts: 'none',
      },
      recordId,
      BundleOutcomeEventSchema.parse({
        type: 'deprecated',
        evidenceToken: `disposition-deprecated-${recordId}`,
        curationJobId: `disposition-deprecated-job-${recordId}`,
        buildOrdinal: 42,
        reason: 'the reviewer removed it',
      }),
    )
    if (appended.kind !== 'appended') throw new Error(`fixture deprecate failed: ${appended.kind}`)
  }

  /** A scope key no fixture bundle is published under, so `sameScope` cannot accidentally hold. */
  const OTHER_SCOPE: ScopeKey = { tier: 'product', key: 'checkout-lane' }

  /**
   * How each condition is REACHED, declared locally and per-member.
   *
   * Only the keys come from the production vocabulary; every fixture and every expectation here
   * is the corpus's own, on the 387-14 pattern-3 discipline — a table that imported production
   * values to assert against would be a tautology no mutation could red.
   *
   * `scope-mismatch` is the member round 2 proved missing, and it is the only one that fails on a
   * record this store can READ perfectly well: the bundle is intact, active, and in the persisted
   * neighbour set, and the delta simply addresses it at a scope it does not carry. The other
   * three all break the record's availability in some way, which is why a corpus built from them
   * alone could believe availability was the whole failure domain.
   *
   * BOTH of the check's return sites are reached across this walk, and the split is exactly two:
   * `not-a-persisted-neighbor` takes the early return that fires before the record is even looked
   * up, and the other three share the or-ed second return. The earlier version of this note said
   * "all three return sites", counting conditions as if each had its own — the miscount that let
   * the fourth condition hide inside the second return without anybody noticing it was there.
   */
  const CONDITION_FIXTURES = {
    'not-a-persisted-neighbor': () => {
      const victim = publishActive([primary, page])
      return { victim, delta: confirmCiting('agent', victim.id), neighborIds: [] as RecordId[] }
    },
    'missing-from-disk': () => {
      const victim = publishActive([primary, page])
      rmSync(victim.dir, { recursive: true, force: true })
      return { victim, delta: confirmCiting('agent', victim.id), neighborIds: [victim.id] }
    },
    deprecated: () => {
      const victim = publishActive([primary, page])
      deprecate(victim.id)
      return { victim, delta: confirmCiting('agent', victim.id), neighborIds: [victim.id] }
    },
    'scope-mismatch': () => {
      const victim = publishActive([primary, page], 40, OTHER_SCOPE)
      return { victim, delta: confirmCiting('agent', victim.id), neighborIds: [victim.id] }
    },
  } satisfies Record<CitedIdIntegrityCondition, () => {
    victim: { id: RecordId; dir: string }
    delta: Delta
    neighborIds: RecordId[]
  }>

  for (const origin of DELTA_ORIGINS) {
    const expected = EXPECTED_OUTCOME_BY_ORIGIN[origin]
    for (const condition of FAILURE_CONDITIONS) {
      it(`${origin}-origin Confirm whose cited id is ${condition} → ${expected}`, () => {
        const { victim, neighborIds } = CONDITION_FIXTURES[condition]()
        const delta = confirmCiting(origin, victim.id)

        const dispose = () => disposeDelta({
          delta,
          checkpoint: checkpoint(delta, neighborIds, [observed(victim.id)]),
          profile: { mode: 'drain-to-active' },
          knowledgeRoot,
          candidate: candidate([primary, page]),
          drainState: drainState(),
        })

        if (expected === 'refuses') {
          let thrown: unknown
          expect(
            () => { try { dispose() } catch (error) { thrown = error; throw error } },
            'a user delta must be REFUSED rather than converted into minted content: minting '
              + 'from a human instruction about existing records fabricates authorship',
          ).toThrow()
          expect((thrown as Error).name).toBe('UserDeltaCitationIntegrityError')
          expect((thrown as { recordId?: RecordId }).recordId).toBe(victim.id)
          expect((thrown as { deltaKind?: string }).deltaKind).toBe('Confirm')
          // WHICH condition fired, per row. Asserting merely that the field EXISTS would pass
          // against an error that carried the same token for all four, which is the difference
          // between naming the failure and appearing to.
          expect(
            (thrown as { condition?: string }).condition,
            'the refusal must name the condition it actually failed on',
          ).toBe(condition)
        } else {
          // PRESERVED, and this half is drawn from OUTSIDE the refusal's own assumption: the
          // pipeline's clarification-candidate behaviour is untouched. A mapping that
          // over-broadened into the drain path would red here, not in the user rows.
          const outcome = dispose()
          expect(outcome).toMatchObject({
            kind: 'downgraded',
            reason: 'cited-id-integrity',
            original: delta,
          })
          expect(
            outcome.kind === 'downgraded' ? outcome.delta.kind : undefined,
            'the pipeline fallback is still a MintUnknown clarification candidate',
          ).toBe('MintUnknown')
        }
      })
    }
  }

  /**
   * The MESSAGE tells the truth for every member of the domain — one directed case, not a row.
   *
   * The old message said the cited record "is tombstoned or cannot be resolved in this store",
   * which is FALSE for exactly the condition round 2 found missing: a scope-mismatched record is
   * neither tombstoned nor unresolvable, it is perfectly readable and addressed wrongly. A
   * message that names half its domain sends an operator looking for a tombstone that is not
   * there. This case is directed rather than per-row because what it pins is the phrasing, and a
   * per-row copy of it would just re-assert the same three interpolations four times.
   */
  it('the refusal message names the record, the delta kind and the failing condition', () => {
    const { victim } = CONDITION_FIXTURES['scope-mismatch']()
    const delta = confirmCiting('user', victim.id)

    let thrown: unknown
    try {
      disposeDelta({
        delta,
        checkpoint: checkpoint(delta, [victim.id], [observed(victim.id)]),
        profile: { mode: 'drain-to-active' },
        knowledgeRoot,
        candidate: candidate([primary, page]),
        drainState: drainState(),
      })
    } catch (error) { thrown = error }

    const message = (thrown as Error | undefined)?.message ?? ''
    expect(message).toContain(victim.id)
    expect(message).toContain('Confirm')
    expect(message, 'the condition token is what makes the message actionable').toContain(
      'scope-mismatch',
    )
    expect(
      message,
      'the old phrasing claimed a tombstone that a scope-mismatched record does not have',
    ).not.toContain('tombstoned')
  })
})
