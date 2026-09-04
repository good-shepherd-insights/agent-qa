import type {
  ActionAnnotation,
  CompletedRunHandoff,
  LosslessServedBriefProofV1,
  RecordedRetrievalRung,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { canonicalJson } from '../../canonical-json'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import type { CorpusEntry } from '../../labels/corpus-entry'
import type { StandaloneLabelRecord } from '../../labels/label-record'
import type { ArtifactSource } from '../../ports'
import { computeCorpusDigest } from '../corpus-digest'
import type { CommittedCorpusSnapshot } from '../derive-census'
import { CENSUS_SCHEMA_VERSION, classifyStaticScorability, deriveCensus } from '../derive-census'

const LEGACY_24: readonly (readonly [string, number])[] = [
  ['apple-maps', 2],
  ['automation-exercise', 6],
  ['example-web', 5],
  ['google-maps', 11],
]

const POINT_ANNOTATION: ActionAnnotation = {
  kind: 'point',
  viewport: { width: 1_280, height: 720 },
  point: { x: 12, y: 34 },
}

const PATH_ANNOTATION: ActionAnnotation = {
  kind: 'path',
  viewport: { width: 1_280, height: 720 },
  path: { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } },
}

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function baseLeaf(): LeafCassette {
  const handoff: CompletedRunHandoff = makeArtifactRefV2Handoff()
  const found = extractRunCassettes({ handoff, artifacts: fullArtifacts() })
    .cassettes.map((entry) => entry.cassette)
    .find((cassette): cassette is LeafCassette => cassette.granularity === 'leaf')
  if (found === undefined) throw new Error('missing fixture leaf cassette')
  return found
}

const FIXTURE_LEAF = baseLeaf()

function cassetteWith(id: string, mutate: (draft: LeafCassette) => void = () => {}): LeafCassette {
  const draft = structuredClone(FIXTURE_LEAF) as LeafCassette
  const withId = { ...draft, id } as LeafCassette
  mutate(withId)
  return withId
}

function entryFor(cassetteId: string, product: string): CorpusEntry {
  return {
    schemaVersion: 1,
    cassetteId,
    product,
    split: 'natural',
    captured_at_ordinal: 37,
    run_links: {
      runId: `run-${product}`,
      runSlug: `run-${product}`,
      handoffPath: `.agent-qa/runs/run-${product}/handoff.json`,
    },
    receiptDigest: 'd'.repeat(64),
  }
}

function labelFor(cassetteId: string, tier: 'gold' | 'near-gold' | 'silver'): StandaloneLabelRecord {
  const label = structuredClone(FIXTURE_LEAF.label)
  return {
    schemaVersion: 1,
    cassetteId,
    label: { ...label, tier },
    provenance: {
      runId: `run-${cassetteId}`,
      runSlug: `run-${cassetteId}`,
      capturedAtOrdinal: 37,
      receiptDigest: 'e'.repeat(64),
    },
  }
}

function snapshotOf(
  cassettes: readonly LeafCassette[],
  options: {
    products?: ReadonlyMap<string, string>
    tiers?: ReadonlyMap<string, 'gold' | 'near-gold' | 'silver'>
    omitLabelFor?: ReadonlySet<string>
    omitCassetteFor?: ReadonlySet<string>
    blobs?: ReadonlyMap<string, boolean>
    reverse?: boolean
  } = {},
): CommittedCorpusSnapshot {
  const entries: CorpusEntry[] = []
  const labelsById = new Map<string, StandaloneLabelRecord>()
  const cassettesById = new Map<string, LeafCassette>()
  const blobPresentById = new Map<string, boolean>()

  for (const cassette of cassettes) {
    const product = options.products?.get(cassette.id) ?? 'example-web'
    entries.push(entryFor(cassette.id, product))
    if (options.omitLabelFor?.has(cassette.id) !== true) {
      labelsById.set(cassette.id, labelFor(cassette.id, options.tiers?.get(cassette.id) ?? 'silver'))
    }
    if (options.omitCassetteFor?.has(cassette.id) !== true) {
      cassettesById.set(cassette.id, cassette)
    }
    blobPresentById.set(cassette.id, options.blobs?.get(cassette.id) ?? false)
  }

  return {
    entries: options.reverse === true ? [...entries].reverse() : entries,
    labelsById,
    cassettesById,
    blobPresentById,
  }
}

/** The committed legacy-24 shape: 14 neither, 1 point-annotation only, 9 goldAnchor(+annotation). */
function legacy24(): LeafCassette[] {
  const cassettes: LeafCassette[] = []
  let ordinal = 0
  for (const [product, count] of LEGACY_24) {
    for (let index = 0; index < count; index += 1) {
      const id = `${product}/run-${product}/leaf-${String(index).padStart(2, '0')}`
      const position = ordinal
      cassettes.push(
        cassetteWith(id, (draft) => {
          delete (draft.input as { retrievalRung?: RecordedRetrievalRung }).retrievalRung
          delete (draft.input.servedBrief as { proof?: LosslessServedBriefProofV1 }).proof
          draft.input.servedBrief.channel1 = []
          draft.input.servedBrief.channel2 = []
          draft.input.servedBrief.channel3 = []
          delete (draft.sidecar as { goldAnchor?: unknown }).goldAnchor
          delete (draft.sidecar as { annotation?: unknown }).annotation
          if (position < 9) {
            ;(draft.sidecar as { goldAnchor?: unknown }).goldAnchor = {
              role: 'button',
              nameNormalized: 'continue',
              ordinal: 0,
            }
            ;(draft.sidecar as { annotation?: ActionAnnotation }).annotation = POINT_ANNOTATION
          } else if (position === 9) {
            ;(draft.sidecar as { annotation?: ActionAnnotation }).annotation = POINT_ANNOTATION
          }
        }),
      )
      ordinal += 1
    }
  }
  return cassettes
}

function legacy24Products(cassettes: readonly LeafCassette[]): Map<string, string> {
  const products = new Map<string, string>()
  for (const cassette of cassettes) products.set(cassette.id, cassette.id.split('/')[0]!)
  return products
}

describe('deriveCensus (413 D-14/D-16, ROOT-05)', () => {
  it('reproduces the legacy-24 split 14 / 1 / 9 with per-product totals', () => {
    const base = FIXTURE_LEAF.sidecar
    const anchor = { role: 'button', nameNormalized: 'continue', ordinal: 0 }
    expect(
      classifyStaticScorability({ ...base, goldAnchor: anchor, annotation: POINT_ANNOTATION }),
    ).toBe('tier2-anchor')
    expect(
      classifyStaticScorability({ ...base, goldAnchor: undefined, annotation: POINT_ANNOTATION }),
    ).toBe('tier3-annotation')
    expect(
      classifyStaticScorability({ ...base, goldAnchor: undefined, annotation: PATH_ANNOTATION }),
    ).toBe('no-gold-evidence')
    expect(
      classifyStaticScorability({ ...base, goldAnchor: undefined, annotation: undefined }),
    ).toBe('no-gold-evidence')

    const cassettes = legacy24()
    const census = deriveCensus({
      snapshot: snapshotOf(cassettes, { products: legacy24Products(cassettes) }),
    })

    expect(census.schemaVersion).toBe(CENSUS_SCHEMA_VERSION)
    expect(census.entryCount).toBe(24)
    expect(Object.keys(census.products)).toEqual([
      'apple-maps',
      'automation-exercise',
      'example-web',
      'google-maps',
    ])
    expect(census.products['apple-maps']?.total).toBe(2)
    expect(census.products['automation-exercise']?.total).toBe(6)
    expect(census.products['example-web']?.total).toBe(5)
    expect(census.products['google-maps']?.total).toBe(11)

    const summed = { 'tier2-anchor': 0, 'tier3-annotation': 0, 'no-gold-evidence': 0 }
    let goldEvidence = 0
    for (const block of Object.values(census.products)) {
      summed['tier2-anchor'] += block.staticScorability['tier2-anchor']
      summed['tier3-annotation'] += block.staticScorability['tier3-annotation']
      summed['no-gold-evidence'] += block.staticScorability['no-gold-evidence']
      goldEvidence += block.goldEvidence
      expect(block.scorableByTier.tier1).toBe(block.total)
      expect(block.proofCoverage).toEqual({ numerator: 0, denominator: block.total, rate: 0 })
      expect(block.rungMix['legacy-no-rung']).toBe(block.total)
      expect(block.briefContent['empty-brief']).toBe(block.total)
      expect(block.briefContent['populated-brief']).toBe(0)
    }

    expect(summed).toEqual({
      'tier2-anchor': 9,
      'tier3-annotation': 1,
      'no-gold-evidence': 14,
    })
    expect(goldEvidence).toBe(10)
  })

  it('keys the product axis on the corpus entry, never on the served-brief scope', () => {
    const a = cassetteWith('a', (draft) => {
      draft.input.servedBrief.scope = { tier: 'test', key: '' }
    })
    const b = cassetteWith('b', (draft) => {
      draft.input.servedBrief.scope = { tier: 'test', key: '' }
    })

    const census = deriveCensus({
      snapshot: snapshotOf([a, b], {
        products: new Map([
          ['a', 'google-maps'],
          ['b', 'example-web'],
        ]),
      }),
    })

    expect(Object.keys(census.products)).toEqual(['example-web', 'google-maps'])
    expect(Object.keys(census.products)).not.toContain('default')
  })

  it('counts proof coverage beside the rung, tallying rung-less cassettes as legacy-no-rung', () => {
    const proven = cassetteWith('proven', (draft) => {
      draft.input.retrievalRung = { schemaVersion: 1, rung: 'lexical-only' }
      draft.input.servedBrief.proof = {
        schemaVersion: 1,
        completeness: 'lossless',
        recordCap: 8,
        combinedBudget: 64,
        admissionEvents: [],
        promptTurns: [],
      }
    })

    const provenCensus = deriveCensus({
      snapshot: snapshotOf([proven], { products: new Map([['proven', 'example-web']]) }),
    })
    const provenBlock = provenCensus.products['example-web']!
    expect(provenBlock.proofCoverage).toEqual({ numerator: 1, denominator: 1, rate: 1 })
    expect(provenBlock.rungMix).toEqual({
      'bundle-scan': 0,
      'legacy-no-rung': 0,
      'lexical-only': 1,
      memidex: 0,
      'static-floor': 0,
    })

    const rungOnly = cassetteWith('rung-only', (draft) => {
      draft.input.retrievalRung = { schemaVersion: 1, rung: 'memidex' }
      delete (draft.input.servedBrief as { proof?: LosslessServedBriefProofV1 }).proof
    })
    const legacy = cassetteWith('legacy', (draft) => {
      delete (draft.input as { retrievalRung?: RecordedRetrievalRung }).retrievalRung
      delete (draft.input.servedBrief as { proof?: LosslessServedBriefProofV1 }).proof
    })

    const mixed = deriveCensus({
      snapshot: snapshotOf([rungOnly, legacy], {
        products: new Map([
          ['rung-only', 'example-web'],
          ['legacy', 'example-web'],
        ]),
      }),
    })
    const mixedBlock = mixed.products['example-web']!
    expect(mixedBlock.proofCoverage).toEqual({ numerator: 0, denominator: 2, rate: 0 })
    expect(mixedBlock.rungMix.memidex).toBe(1)
    expect(mixedBlock.rungMix['legacy-no-rung']).toBe(1)
  })

  it('counts a non-empty channel as a populated brief and an all-empty one as empty', () => {
    const populated = cassetteWith('populated')
    const empty = cassetteWith('empty', (draft) => {
      draft.input.servedBrief.channel1 = []
      draft.input.servedBrief.channel2 = []
      draft.input.servedBrief.channel3 = []
    })

    const census = deriveCensus({
      snapshot: snapshotOf([populated, empty], {
        products: new Map([
          ['populated', 'example-web'],
          ['empty', 'example-web'],
        ]),
      }),
    })

    expect(census.products['example-web']?.briefContent).toEqual({
      'empty-brief': 1,
      'populated-brief': 1,
    })
  })

  it('counts an anchor-and-annotation sidecar once, so tier2 + tier3 + none === total', () => {
    const cassettes = legacy24()
    const census = deriveCensus({
      snapshot: snapshotOf(cassettes, { products: legacy24Products(cassettes) }),
    })

    for (const block of Object.values(census.products)) {
      expect(
        block.scorableByTier.tier2 +
          block.scorableByTier.tier3 +
          block.staticScorability['no-gold-evidence'],
      ).toBe(block.total)
      expect(block.goldEvidence).toBe(block.scorableByTier.tier2 + block.scorableByTier.tier3)
    }
  })

  it('handles the empty snapshot and a zero denominator without minting a rate', () => {
    const empty = deriveCensus({
      snapshot: {
        entries: [],
        labelsById: new Map(),
        cassettesById: new Map(),
        blobPresentById: new Map(),
      },
    })

    expect(empty.entryCount).toBe(0)
    expect(empty.products).toEqual({})
    expect(empty.corpusDigest).toBe(computeCorpusDigest([]))

    const orphan = cassetteWith('orphan')
    const missing = deriveCensus({
      snapshot: snapshotOf([orphan], {
        products: new Map([['orphan', 'example-web']]),
        omitCassetteFor: new Set(['orphan']),
      }),
    })
    const block = missing.products['example-web']!
    expect(block.missingCassette).toBe(1)
    expect(block.proofCoverage).toEqual({ numerator: 0, denominator: 0 })
    expect(Object.hasOwn(block.proofCoverage, 'rate')).toBe(false)
  })

  it('is order-insensitive: reversed insertion order yields byte-identical output', () => {
    const cassettes = legacy24()
    const products = legacy24Products(cassettes)

    const forward = deriveCensus({ snapshot: snapshotOf(cassettes, { products }) })
    const reversed = deriveCensus({
      snapshot: snapshotOf([...cassettes].reverse(), { products, reverse: true }),
    })

    expect(canonicalJson(forward)).toBe(canonicalJson(reversed))

    const entries = cassettes.map((cassette) => entryFor(cassette.id, products.get(cassette.id)!))
    expect(computeCorpusDigest(entries)).toBe(computeCorpusDigest([...entries].reverse()))
  })

  it('reads the label tier from the committed record, counting a missing record honestly', () => {
    const overturned = cassetteWith('overturned')
    expect(overturned.label.tier).toBe('silver')
    const unlabelled = cassetteWith('unlabelled')

    const census = deriveCensus({
      snapshot: snapshotOf([overturned, unlabelled], {
        products: new Map([
          ['overturned', 'example-web'],
          ['unlabelled', 'example-web'],
        ]),
        tiers: new Map([['overturned', 'near-gold']]),
        omitLabelFor: new Set(['unlabelled']),
      }),
    })

    const block = census.products['example-web']!
    expect(block.labelTiers).toEqual({ gold: 0, 'near-gold': 1, silver: 0 })
    expect(block.missingLabelRecord).toBe(1)
  })

  it('folds an absent campaign and no reports into structurally honest empties', () => {
    const census = deriveCensus({
      snapshot: snapshotOf([cassetteWith('solo')], {
        products: new Map([['solo', 'example-web']]),
      }),
    })

    expect(census.campaign).toEqual({ present: false })
    expect(census.crossCheck).toEqual([])

    const block = census.products['example-web']!
    expect(block.runsSeeded).toBe(0)
    expect(block.runsExcluded).toEqual({ environment: 0, flake: 0, timeout: 0 })
    expect(block.repeatCounts).toEqual({})
  })
})
