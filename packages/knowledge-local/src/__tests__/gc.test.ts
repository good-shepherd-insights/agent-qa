import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asEvidenceToken,
  type Anchor,
  type OriginClass,
  type RecordId,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  GC_SUPERSEDED_RETAIN_K,
  appendOutcomeEvent,
  openIndexReaderConnection,
  publishBundle,
  rebuildIndex,
  runKnowledgeGc,
  type PublishBundleOutcome,
} from '../index.js'
import { makeBundleDraftFixture } from './fixtures/bundle-fixture.js'

type PublishedBundle = Extract<PublishBundleOutcome, { kind: 'published' }>

const PRODUCT = 'gc-storefront'
const SCOPE = { tier: 'product', key: PRODUCT } as const

let root: string
let knowledgeRoot: string
let auditBaseDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-gc-'))
  knowledgeRoot = join(root, 'agent-qa-knowledge')
  auditBaseDir = join(root, '.agent-qa')
  mkdirSync(knowledgeRoot, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function config() {
  return {
    knowledgeRoot,
    productKey: PRODUCT,
    auditBaseDir,
    commitArtifacts: 'none' as const,
  }
}

function chainAnchors(chain: string): Anchor[] {
  return [
    { t: 'el', role: 'button', name: `${chain} control` },
    { t: 'page', route: `/gc/${chain}` },
    { t: 'platform', platform: 'web' },
  ]
}

function publishGeneration(
  chain: string,
  generation: number,
  originClass: OriginClass,
): PublishedBundle {
  const anchors = chainAnchors(chain)
  const outcome = publishBundle(config(), {
    draft: makeBundleDraftFixture({
      subtype: 'measurement',
      anchors,
      scope: SCOPE,
      summary: `${chain} generation ${generation}`,
      body: `Canonical ${chain} generation ${generation}.`,
    }),
    discriminant: {
      kind: 'fact',
      subtype: 'measurement',
      metricKey: `${chain}-generation-${generation}`,
    },
    originClass,
    createdAtOrdinal: generation,
    screenStates: [],
    initialEvents: [
      {
        type: 'promoted',
        evidenceToken: asEvidenceToken(`${chain}-promoted-${generation}`),
        curationJobId: `${chain}-publish-${generation}`,
        buildOrdinal: generation,
      },
    ],
    relations: [],
    provenance: { mode: 'standalone', sourceDescription: `${chain} GC fixture` },
    artifacts: [],
  })
  if (outcome.kind !== 'published') {
    throw new Error(`expected ${chain} generation ${generation} publication, got ${outcome.kind}`)
  }
  return outcome
}

function publishChain(
  chain: string,
  supersededGenerations: number,
  originAtGeneration: ReadonlyMap<number, OriginClass> = new Map(),
): { superseded: PublishedBundle[]; head: PublishedBundle } {
  const generations = Array.from(
    { length: supersededGenerations + 1 },
    (_, index) => publishGeneration(
      chain,
      index + 1,
      originAtGeneration.get(index + 1) ?? 'agent-verified',
    ),
  )

  for (let index = 0; index < supersededGenerations; index += 1) {
    const victim = generations[index]!
    const replacement = generations[index + 1]!
    const buildOrdinal = index + 2
    expect(appendOutcomeEvent(config(), victim.id, {
      type: 'superseded',
      evidenceToken: asEvidenceToken(`${chain}-superseded-${buildOrdinal}`),
      curationJobId: `${chain}-supersede-job-${buildOrdinal}`,
      buildOrdinal,
      byRecordId: replacement.id,
    }).kind).toBe('appended')
    expect(appendOutcomeEvent(config(), victim.id, {
      type: 'window-close',
      evidenceToken: asEvidenceToken(`${chain}-window-close-${buildOrdinal}`),
      curationJobId: `${chain}-supersede-job-${buildOrdinal}`,
      buildOrdinal,
      closedAtOrdinal: buildOrdinal,
    }).kind).toBe('appended')
  }

  return {
    superseded: generations.slice(0, -1),
    head: generations.at(-1)!,
  }
}

function publishUnknown(
  name: string,
  conflictRecordIds: readonly RecordId[],
  relationTargets: readonly RecordId[],
): PublishedBundle {
  const outcome = publishBundle(config(), {
    draft: makeBundleDraftFixture({
      kind: 'unknown',
      anchors: [{ t: 'flow', name: `gc-unknown-${name}` }],
      scope: SCOPE,
      summary: `Unresolved GC evidence ${name}`,
      body: `The ${name} evidence chain must stay intact.`,
    }),
    discriminant: { kind: 'unknown', conflictRecordIds },
    originClass: 'agent-verified',
    createdAtOrdinal: 20,
    screenStates: [],
    initialEvents: [
      {
        type: 'confirmed',
        evidenceToken: asEvidenceToken(`gc-unknown-${name}-confirmed`),
        curationJobId: `gc-unknown-${name}-job`,
        buildOrdinal: 20,
        origin: 'agent-verified',
      },
    ],
    relations: relationTargets.map((targetId) => ({
      type: 'conflicts-with' as const,
      targetId,
      addedAtOrdinal: 20,
      curationJobId: `gc-unknown-${name}-job`,
    })),
    provenance: { mode: 'standalone', sourceDescription: `${name} unknown fixture` },
    artifacts: [],
  })
  if (outcome.kind !== 'published') {
    throw new Error(`expected unknown ${name} publication, got ${outcome.kind}`)
  }
  return outcome
}

function existingRecordIds(): string[] {
  const reader = openIndexReaderConnection(knowledgeRoot)
  try {
    return reader.db
      .prepare('SELECT bundle_id FROM records ORDER BY bundle_id')
      .all()
      .map((row) => String(row.bundle_id))
  } finally {
    reader.close()
  }
}

describe('runKnowledgeGc gate-keyed retention (DCAY-05)', () => {
  it('retains the latest K superseded generations plus the live head and lets rebuild remove orphans', async () => {
    const chain = publishChain('depth', 6)
    await rebuildIndex({ knowledgeRoot })

    const summary = runKnowledgeGc({ knowledgeRoot, horizon: { kind: 'none' } })

    const trimmed = chain.superseded.slice(0, 3)
    const retained = [...chain.superseded.slice(3), chain.head]
    expect(GC_SUPERSEDED_RETAIN_K).toBe(3)
    expect(summary).toEqual({
      trimmedRecordIds: trimmed.map(({ id }) => id).sort(),
      skipped: { unknownRef: 0, withinK: 3, userOrigin: 0, horizon: 0 },
    })
    expect(trimmed.every(({ dir }) => !existsSync(dir))).toBe(true)
    expect(retained.every(({ dir }) => existsSync(dir))).toBe(true)

    const rebuilt = await rebuildIndex({ knowledgeRoot })
    expect(rebuilt.removed).toBe(3)
    expect(existingRecordIds()).toEqual(retained.map(({ id }) => id).sort())
  })

  it('protects both conflict-record and relation-target references until the unknown resolves', () => {
    const chain = publishChain('unknown-wall', 8)
    const conflictTarget = chain.superseded[0]!
    const relationTarget = chain.superseded[1]!
    const unknown = publishUnknown(
      'two-reference-shapes',
      [conflictTarget.id],
      [relationTarget.id],
    )

    const first = runKnowledgeGc({ knowledgeRoot, horizon: { kind: 'none' } })

    expect(first.skipped.unknownRef).toBe(2)
    expect(existsSync(conflictTarget.dir)).toBe(true)
    expect(existsSync(relationTarget.dir)).toBe(true)
    expect(appendOutcomeEvent(config(), unknown.id, {
      type: 'deprecated',
      evidenceToken: asEvidenceToken('gc-unknown-resolved'),
      curationJobId: 'gc-unknown-resolved-job',
      buildOrdinal: 21,
      reason: 'unknown-resolved',
    }).kind).toBe('appended')

    const second = runKnowledgeGc({ knowledgeRoot, horizon: { kind: 'none' } })
    expect(second.trimmedRecordIds).toEqual([conflictTarget.id, relationTarget.id].sort())
    expect(existsSync(conflictTarget.dir)).toBe(false)
    expect(existsSync(relationTarget.dir)).toBe(false)
  })

  it('retains old generations whose half-open validity window intersects the ordinal horizon', () => {
    const chain = publishChain('horizon-wall', 6)
    const horizonTarget = chain.superseded[2]!

    const guarded = runKnowledgeGc({
      knowledgeRoot,
      horizon: { kind: 'ordinal', deepestGateOrdinal: 3 },
    })

    expect(guarded.skipped.horizon).toBe(1)
    expect(existsSync(horizonTarget.dir)).toBe(true)

    const unguarded = runKnowledgeGc({ knowledgeRoot, horizon: { kind: 'none' } })
    expect(unguarded.trimmedRecordIds).toEqual([horizonTarget.id])
    expect(existsSync(horizonTarget.dir)).toBe(false)
  })

  it('never trims an origin-user generation at any supersession depth', () => {
    const chain = publishChain(
      'user-wall',
      4,
      new Map([[1, 'user']]),
    )
    const userGeneration = chain.superseded[0]!

    const summary = runKnowledgeGc({ knowledgeRoot, horizon: { kind: 'none' } })

    expect(summary).toEqual({
      trimmedRecordIds: [],
      skipped: { unknownRef: 0, withinK: 3, userOrigin: 1, horizon: 0 },
    })
    expect(existsSync(userGeneration.dir)).toBe(true)
  })
})
