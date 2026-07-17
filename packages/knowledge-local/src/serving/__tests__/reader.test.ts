import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  APP_OBSERVED_DATA_CLOSE,
  APP_OBSERVED_DATA_OPEN,
} from '@vostride/agent-qa-safety'
import {
  asEvidenceToken,
  asRecordId,
  BundleOutcomeEventSchema,
  type Anchor,
  type BundleDiscriminant,
  type BundleDraft,
  type BundleOutcomeEvent,
  type CanaryOutcome,
  type DistilledObservation,
  type OriginClass,
  type RecordId,
  type ScopeKey,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeScreenStateFixture } from '../../__tests__/fixtures/bundle-fixture.js'
import {
  publishBundle,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '../../bundle-publish.js'
import { rebuildIndex } from '../../index-rebuild.js'
import { listQueuedCandidates } from '../../queue/curation-queue.js'
import {
  KnowledgeRecordNotFoundError,
  openKnowledgeReader,
} from '../reader.js'

const PRODUCT = 'reader-storefront'
const SCOPE: ScopeKey = { tier: 'product', key: PRODUCT }
const CHECKOUT_ANCHOR: Anchor = {
  t: 'el',
  role: 'button',
  name: 'Checkout',
  ordinal: 0,
}

type SeedStatus = 'active' | 'candidate' | 'deprecated' | 'superseded'

interface SeedRecordOptions {
  key: string
  kind?: BundleDraft['kind']
  status?: SeedStatus
  originClass?: OriginClass
  summary?: string
  body?: string
  anchors?: Anchor[]
  scope?: ScopeKey
}

interface SeededStore {
  activeFact: RecordId
  observedFact: RecordId
  candidateFact: RecordId
  supersededFact: RecordId
  deprecatedFact: RecordId
  policy: RecordId
  cautions: RecordId[]
}

function event(
  type: BundleOutcomeEvent['type'],
  key: string,
  buildOrdinal: number,
): BundleOutcomeEvent {
  const base = {
    evidenceToken: asEvidenceToken(`${type}-${key}`),
    curationJobId: `reader-${type}-${key}`,
    buildOrdinal,
  }
  switch (type) {
    case 'confirmed':
      return BundleOutcomeEventSchema.parse({ ...base, type, origin: 'agent-verified' })
    case 'superseded':
      return BundleOutcomeEventSchema.parse({
        ...base,
        type,
        byRecordId: asRecordId(`replacement-${key}`),
      })
    case 'deprecated':
      return BundleOutcomeEventSchema.parse({ ...base, type, reason: 'reader fixture' })
    case 'window-close':
      return BundleOutcomeEventSchema.parse({ ...base, type, closedAtOrdinal: buildOrdinal })
    default:
      return BundleOutcomeEventSchema.parse({ ...base, type })
  }
}

function discriminant(
  kind: BundleDraft['kind'],
  key: string,
): BundleDiscriminant {
  switch (kind) {
    case 'fact':
      return {
        kind,
        subtype: 'selector',
        elementRef: { role: 'button', name: `Checkout ${key}` },
      }
    case 'caution':
      return { kind, errorKey: `checkout-${key}` }
    case 'procedure':
      return { kind, flowName: `Checkout ${key}`, stepSignature: `cart>${key}` }
    case 'policy':
      return { kind, ruleKey: `checkout-${key}` }
    case 'unknown':
      return { kind, conflictRecordIds: [`checkout-${key}`] }
  }
}

describe('openKnowledgeReader synchronous serving port', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string
  let seeded: SeededStore

  beforeEach(async () => {
    root = join(tmpdir(), `knowledge-serving-reader-${randomUUID()}`)
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    seeded = await seedStore()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir,
      commitArtifacts: 'none',
      writerLeaseId: 'reader-test',
    }
  }

  function seedRecord(options: SeedRecordOptions): RecordId {
    const kind = options.kind ?? 'fact'
    const status = options.status ?? 'active'
    const anchors = options.anchors ?? [
      { t: 'el', role: 'button', name: `Checkout ${options.key}`, ordinal: 0 },
      { t: 'page', route: '/checkout' },
    ]
    const draft: BundleDraft = {
      kind,
      ...(kind === 'fact' ? { subtype: 'selector' as const } : {}),
      anchors,
      scope: options.scope ?? SCOPE,
      summary: options.summary ?? `Checkout ${options.key} summary`,
      body: options.body ?? `Checkout ${options.key} body.`,
      distilledEvidenceRef: {
        id: `reader-${options.key}`,
        sha: options.key.padEnd(64, 'a').slice(0, 64),
      },
      originStage: 'run-curation',
    }
    const primary = anchors[0]
    const observations: DistilledObservation[] = primary?.t === 'el'
      ? [{
          schemaVersion: 1,
          step: { naturalKey: `reader-${options.key}`, ordinal: 0 },
          platform: 'web',
          element: {
            naturalKey: `${primary.role.toLowerCase()}:${primary.name.toLowerCase()}:${primary.ordinal ?? 0}`,
          },
          observedAtOrdinal: 10,
        }]
      : []
    const initialEvents: BundleOutcomeEvent[] = status === 'candidate'
      ? [event('confirmed', options.key, 10)]
      : [event('promoted', options.key, 10)]
    if (status === 'deprecated') {
      initialEvents.push(event('deprecated', options.key, 11))
    }
    if (status === 'superseded') {
      initialEvents.push(
        event('superseded', options.key, 11),
        event('window-close', options.key, 11),
      )
    }

    const input: PublishBundleInput = {
      draft,
      discriminant: discriminant(kind, options.key),
      originClass: options.originClass ?? 'agent-verified',
      createdAtOrdinal: 10,
      screenStates: [],
      initialEvents,
      relations: [],
      provenance: { mode: 'standalone', sourceDescription: 'reader fixture' },
      artifacts: [],
      evidenceMarkdown: `Evidence for ${options.key}.\n`,
      ...(observations.length === 0 ? {} : { distilledObservations: observations }),
    }
    const outcome = publishBundle(storeConfig(), input)
    if (outcome.kind !== 'published') {
      throw new Error(`expected ${options.key} publication, got ${outcome.kind}`)
    }
    return outcome.id
  }

  async function seedStore(reversePublicationOrder = false): Promise<SeededStore> {
    mkdirSync(join(knowledgeRoot, 'policies'), { recursive: true })
    writeFileSync(
      join(knowledgeRoot, 'policies', 'global.md'),
      'GLOBAL POLICY: preserve checkout safety.\n',
      'utf8',
    )
    writeFileSync(
      join(knowledgeRoot, 'policies', `${PRODUCT}.md`),
      'PRODUCT POLICY: use the test checkout only.\n',
      'utf8',
    )

    const definitions: SeedRecordOptions[] = [
      { key: 'active-fact' },
      {
        key: 'observed-fact',
        originClass: 'agent-observed',
        body: 'First observed checkout line.\nSecond observed checkout line.\nThird observed checkout line.',
      },
      { key: 'candidate-fact', status: 'candidate' },
      { key: 'superseded-fact', status: 'superseded' },
      { key: 'deprecated-fact', status: 'deprecated' },
      { key: 'stored-policy', kind: 'policy' },
      ...['a', 'b', 'c'].map((key): SeedRecordOptions => ({
        key: `caution-${key}`,
        kind: 'caution',
        anchors: [CHECKOUT_ANCHOR],
        summary: `Checkout caution ${key}`,
      })),
    ]
    const orderedDefinitions = reversePublicationOrder
      ? [...definitions].reverse()
      : definitions
    const ids = new Map(
      orderedDefinitions.map((definition) => [definition.key, seedRecord(definition)]),
    )
    const id = (key: string): RecordId => {
      const recordId = ids.get(key)
      if (recordId === undefined) throw new Error(`missing seeded record ${key}`)
      return recordId
    }

    await rebuildIndex({ knowledgeRoot })
    return {
      activeFact: id('active-fact'),
      observedFact: id('observed-fact'),
      candidateFact: id('candidate-fact'),
      supersededFact: id('superseded-fact'),
      deprecatedFact: id('deprecated-fact'),
      policy: id('stored-policy'),
      cautions: ['a', 'b', 'c'].map((key) => id(`caution-${key}`)),
    }
  }

  it('assembles policy L0 and learned L1/L2 deterministically from the real index', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    const first = reader.getRunBrief(SCOPE, 200)
    const second = reader.getRunBrief(SCOPE, 200)

    expect(second).toEqual(first)
    expect(first.tiers.L0).toContain('GLOBAL POLICY: preserve checkout safety.')
    expect(first.tiers.L0).toContain('PRODUCT POLICY: use the test checkout only.')
    expect(first.tiers.L1).toContain('Checkout caution')
    expect(first.tiers.L2).toContain('Checkout active-fact summary')
  })

  it('enforces default walls while retaining explicit candidate and audit reads', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    const ordinary = reader.search('checkout', { scope: SCOPE })
    expect(ordinary.map(({ id }) => id)).toContain(seeded.activeFact)
    expect(ordinary.map(({ id }) => id)).not.toContain(seeded.candidateFact)
    expect(ordinary.map(({ id }) => id)).not.toContain(seeded.supersededFact)
    expect(ordinary.map(({ id }) => id)).not.toContain(seeded.deprecatedFact)
    expect(ordinary.map(({ id }) => id)).not.toContain(seeded.policy)

    expect(
      reader.search('checkout', { scope: SCOPE, includeCandidates: true }),
    ).toContainEqual(expect.objectContaining({
      id: seeded.candidateFact,
      status: 'candidate',
      unverified: true,
      servedAsCanary: true,
    }))
    expect(
      reader.search('checkout', { scope: SCOPE, includeSuperseded: true }),
    ).toContainEqual(expect.objectContaining({
      id: seeded.supersededFact,
      status: 'superseded',
      audit: expect.objectContaining({ status: 'superseded' }),
    }))
  })

  it('bounds read bodies on whole lines and DATA-wraps app-observed content', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    const whole = reader.read(seeded.observedFact)
    const bounded = reader.read(seeded.observedFact, { budget: 35 })

    expect(whole.body).toContain('Third observed checkout line.')
    expect(whole.body.startsWith(APP_OBSERVED_DATA_OPEN)).toBe(true)
    expect(whole.body.endsWith(APP_OBSERVED_DATA_CLOSE)).toBe(true)
    expect(Math.ceil(bounded.body.length / 4)).toBeLessThanOrEqual(35)
    expect(bounded.body).toContain('First observed checkout line.')
    expect(bounded.body).not.toContain('Second observed checkout line.')
    expect(bounded.body.startsWith(APP_OBSERVED_DATA_OPEN)).toBe(true)
    expect(bounded.body.endsWith(APP_OBSERVED_DATA_CLOSE)).toBe(true)
  })

  it('synchronously coalesces duplicate canary outcomes into one queue entry', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    const payload: CanaryOutcome = {
      candidateId: seeded.candidateFact,
      runOutcome: 'positive',
      runId: 'reader-canary-run',
      buildOrdinal: 12,
      stepIndex: 3,
      briefDigest: 'reader-canary-brief',
      attribution: 'The checkout hypothesis was exercised by the passing step.',
      exercisedAnchor: CHECKOUT_ANCHOR,
    }

    reader.emitCanaryOutcome(payload)
    reader.emitCanaryOutcome(payload)

    expect(listQueuedCandidates(knowledgeRoot)).toHaveLength(1)
  })

  it('keeps procedure retrieval as the typed Phase-381 stub', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    expect(reader.getProcedure('complete checkout', makeScreenStateFixture())).toBeUndefined()
  })

  it('crosses caution overflow with one accurate reserved terminal line', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    const overflow = reader.getCautions([CHECKOUT_ANCHOR], 1)
    const complete = reader.getCautions([CHECKOUT_ANCHOR], 100)

    expect(overflow.cautions.at(-1)).toEqual({
      id: 'caution:truncated',
      anchors: [],
      summary: 'truncated 0 of 3',
    })
    expect(complete.cautions.map(({ id }) => id)).toEqual(
      expect.arrayContaining(seeded.cautions),
    )
    expect(complete.cautions).not.toContainEqual(expect.objectContaining({
      id: 'caution:truncated',
    }))
  })

  it('keeps brief bytes stable when committed bundles arrive in reverse order', async () => {
    const forward = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
      .getRunBrief(SCOPE, 200)
    const primaryKnowledgeRoot = knowledgeRoot
    const primaryAuditBaseDir = auditBaseDir

    try {
      knowledgeRoot = join(root, 'reverse-agent-qa-knowledge')
      auditBaseDir = join(root, '.reverse-agent-qa')
      await seedStore(true)
      const reverse = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
        .getRunBrief(SCOPE, 200)

      expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward))
    } finally {
      knowledgeRoot = primaryKnowledgeRoot
      auditBaseDir = primaryAuditBaseDir
    }
  })

  it('serves an empty L0 when the store has no authored policy files', () => {
    rmSync(join(knowledgeRoot, 'policies'), { recursive: true, force: true })
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    expect(reader.getRunBrief(SCOPE, 200).tiers.L0).toBe('')
  })

  it('returns a structured empty result for an empty search query', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })

    expect(reader.search('', { scope: SCOPE })).toEqual([])
  })

  it('throws the typed reader not-found error for a missing record id', () => {
    const reader = openKnowledgeReader({ knowledgeRoot, product: PRODUCT })
    const missingId = asRecordId('reader-record-does-not-exist')

    // The non-optional RecordBody contract uses a typed throw; the tool wrapper maps it.
    expect(() => reader.read(missingId)).toThrow(
      expect.objectContaining({
        name: 'KnowledgeRecordNotFoundError',
        recordId: missingId,
      }),
    )
    expect(() => reader.read(missingId)).toThrow(KnowledgeRecordNotFoundError)
  })
})
