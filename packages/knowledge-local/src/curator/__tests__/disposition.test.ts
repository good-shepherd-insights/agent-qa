import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BundleOutcomeEventSchema,
  asEvidenceToken,
  asRecordId,
  type Anchor,
  type CompareAndSet,
  type Delta,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  authoredCheckpointSchema,
  deriveBundleTrust,
  disposeDelta,
  loadBundle,
  parseAuthoredCheckpoint,
  publishBundle,
  resolveDispositionProfile,
  type AuthoredCheckpoint,
  type AuthorOutcome,
  type CurationJobView,
  type CuratorAuthor,
  type NeighborRecord,
} from '../../index.js'
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
  delta: {
    kind: 'Confirm',
    origin: 'agent',
    scope,
    citedIds: [citedRecordId],
    precondition: [precondition],
    targetId: citedRecordId,
    evidenceToken: asEvidenceToken('evidence-checkout-button'),
  },
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
): AuthoredCheckpoint {
  return parseAuthoredCheckpoint({
    schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
    delta,
    neighborIds,
    preconditions,
    authorship: {
      path: 'llm',
      model: { id: 'curator-model' },
      executionContext: 'local-interactive',
    },
  })
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
  return { anchors, buildOrdinal, scope: candidateScope }
}

function drainState(): { supersedesSeenByAnchorKey: Map<string, number> } {
  return { supersedesSeenByAnchorKey: new Map() }
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
      delta: parsedCheckpoint.delta,
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
      relationIntents: [
        { type: 'proposed-supersession-of', targetId: victim.id },
      ],
    })

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
