import { readFileSync } from 'node:fs'
import type {
  ActionAnnotation,
  CompletedRunHandoff,
  LosslessServedBriefProofV1,
  RecordedRetrievalRung,
} from '@vostride/agent-qa-schema'
import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { canonicalJson } from '../../canonical-json'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import { countGateSet } from '../../gate/gate-set'
import type { CorpusEntry, TargetEnvironment } from '../../labels/corpus-entry'
import type { StandaloneLabelRecord } from '../../labels/label-record'
import type { PartitionManifest } from '../../labels/partition-manifest'
import type { ExclusionClass, RunExclusionRecord, VerdictProducer } from '../../labels/run-exclusion'
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

/** Which split arm a fixture entry lands on — the four the census counts (414 D-03/D-21). */
type EntryShape =
  | { split: 'natural' }
  | { split: 'held-out'; heldOutVisibility: 'shared' | 'private' }
  | { split: 'adversarial' }

/** The two OPTIONAL D-04 provenance fields, omitted (never undefined) when not supplied. */
interface EntryFields {
  captured_at?: string
  targetEnvironment?: TargetEnvironment
}

function entryFor(
  cassetteId: string,
  product: string,
  shape: EntryShape = { split: 'natural' },
  fields: EntryFields = {},
): CorpusEntry {
  const base = {
    schemaVersion: 2 as const,
    cassetteId,
    product,
    captured_at_ordinal: 37,
    run_links: {
      runId: `run-${product}`,
      runSlug: `run-${product}`,
    },
    receiptDigest: 'd'.repeat(64),
    ...(fields.captured_at === undefined ? {} : { captured_at: fields.captured_at }),
    ...(fields.targetEnvironment === undefined
      ? {}
      : { targetEnvironment: fields.targetEnvironment }),
  }

  if (shape.split === 'natural') return { ...base, split: 'natural' }
  if (shape.split === 'adversarial') {
    return {
      ...base,
      split: 'adversarial',
      generator: { kind: 'fuzz-selector', seedCassetteId: cassetteId, generatorVersion: 1 },
    }
  }
  return { ...base, split: 'held-out', heldOutVisibility: shape.heldOutVisibility }
}

function labelFor(
  cassetteId: string,
  tier: 'gold' | 'near-gold' | 'silver',
): StandaloneLabelRecord {
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
      labelsById.set(
        cassette.id,
        labelFor(cassette.id, options.tiers?.get(cassette.id) ?? 'silver'),
      )
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
  it('keeps the pre-419 unmarked census bytes and omits markedGold entirely', () => {
    const census = deriveCensus({ snapshot: snapshotOf([cassetteWith('unmarked')]) })
    const baseline = readFileSync(new URL('./fixtures/pre419-unmarked-census.json', import.meta.url), 'utf8')
    expect(`${JSON.stringify(census)}\n`).toBe(baseline)
    expect(Object.hasOwn(census.products['example-web']!, 'markedGold')).toBe(false)
  })

  it.each([0, 1])('counts user-mark and %i overturned-verdict labels in the committed record', overturnedCount => {
    const snapshot = snapshotOf([cassetteWith('user'), ...(overturnedCount ? [cassetteWith('overturned')] : [])])
    const labelsById = new Map(snapshot.labelsById)
    for (const [id, sourceChannel] of [['user', 'user-mark'], ['overturned', 'overturned-verdict']] as const) {
      const label = labelsById.get(id)
      if (label) labelsById.set(id, { ...label, label: { ...label.label, tier: 'gold', sourceChannel } })
    }
    const census = deriveCensus({ snapshot: { ...snapshot, labelsById } })
    expect(census.products['example-web']!.markedGold).toEqual({ 'user-mark': 1, 'overturned-verdict': overturnedCount })
    expect(census.schemaVersion).toBe(2)
  })
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

// ---- 414-11 Task 1: the v2 census — splits, D-04 coverage, exclusions, partition, versions ----

/** 64 lowercase hex, the shape `guardPartitionManifest` pins (414-05's TEST_PARTITION salt). */
const FIXTURE_SALT = 'a3f'.repeat(21).concat('b')
const OTHER_SALT = 'c1d'.repeat(21).concat('e')

/** An entries-only snapshot: splits, coverage and exclusions are entry/record facts, not cassette ones. */
function entriesSnapshot(entries: readonly CorpusEntry[]): CommittedCorpusSnapshot {
  return {
    entries,
    labelsById: new Map(),
    cassettesById: new Map(),
    blobPresentById: new Map(),
  }
}

function manifestFor(
  product: string,
  salt: string,
  fractions: { heldOutFraction: number; privateFraction: number } = {
    heldOutFraction: 0.2,
    privateFraction: 0.5,
  },
): PartitionManifest {
  return {
    schemaVersion: 1,
    partitionVersion: 1,
    product,
    salt,
    heldOutFraction: fractions.heldOutFraction,
    privateFraction: fractions.privateFraction,
  }
}

function exclusionFor(
  product: string,
  runSlug: string,
  verdict: { class: ExclusionClass; producer: VerdictProducer },
): RunExclusionRecord {
  return {
    schemaVersion: 1,
    runId: runSlug,
    runSlug,
    product,
    verdicts: [verdict],
    analysisDigest: 'f'.repeat(64),
    reason: 'excluded-verdict-class',
  }
}

/** Product P's four arms, one entry each — the population `countGateSet` counts. */
function fourArmEntries(product: string): CorpusEntry[] {
  return [
    entryFor(`${product}/natural`, product, { split: 'natural' }),
    entryFor(`${product}/shared`, product, { split: 'held-out', heldOutVisibility: 'shared' }),
    entryFor(`${product}/private`, product, { split: 'held-out', heldOutVisibility: 'private' }),
    entryFor(`${product}/adversarial`, product, { split: 'adversarial' }),
  ]
}

describe('deriveCensus v2 — splits, D-04 coverage, exclusions and the partition echo (414 D-17)', () => {
  it('counts the four split x visibility arms per product and the two D-04 field rates', () => {
    // Two of P's four entries carry captured_at; exactly one also carries targetEnvironment.
    const entries: CorpusEntry[] = [
      entryFor('p/natural', 'p', { split: 'natural' }, { captured_at: '2026-01-01T00:00:00.000Z' }),
      entryFor(
        'p/shared',
        'p',
        { split: 'held-out', heldOutVisibility: 'shared' },
        { captured_at: '2026-01-02T00:00:00.000Z', targetEnvironment: 'shared' },
      ),
      entryFor('p/private', 'p', { split: 'held-out', heldOutVisibility: 'private' }),
      entryFor('p/adversarial', 'p', { split: 'adversarial' }),
      // A second product holding only natural entries — every split key present at zero.
      entryFor('q/one', 'q', { split: 'natural' }),
      entryFor('q/two', 'q', { split: 'natural' }),
    ]

    const census = deriveCensus({ snapshot: entriesSnapshot(entries) })

    expect(census.schemaVersion).toBe(2)
    expect(CENSUS_SCHEMA_VERSION).toBe(2)

    const p = census.products.p!
    expect(p.splits).toEqual(countGateSet(entries.filter(entry => entry.product === 'p')))
    expect(p.splits).toEqual({ natural: 1, heldOutShared: 1, heldOutPrivate: 1, adversarial: 1 })

    // A product with only natural entries still names every arm — absence is never a missing key.
    const q = census.products.q!
    expect(q.splits).toEqual({ natural: 2, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 })
    expect(Object.keys(q.splits).sort()).toEqual([
      'adversarial',
      'heldOutPrivate',
      'heldOutShared',
      'natural',
    ])

    // D-04 coverage is a numerator/denominator over the product total — never a verdict.
    expect(p.fieldCoverage.capturedAt).toEqual({ numerator: 2, denominator: 4, rate: 0.5 })
    expect(p.fieldCoverage.targetEnvironment).toEqual({ numerator: 1, denominator: 4, rate: 0.25 })
    expect(q.fieldCoverage.capturedAt).toEqual({ numerator: 0, denominator: 2, rate: 0 })
    expect(q.fieldCoverage.targetEnvironment).toEqual({ numerator: 0, denominator: 2, rate: 0 })
  })

  it('echoes each partitioned product as a salt DIGEST, and never fabricates a row (ROOT-10)', () => {
    const manifest = manifestFor('p', FIXTURE_SALT, {
      heldOutFraction: 0.3,
      privateFraction: 0.4,
    })

    const census = deriveCensus({
      snapshot: entriesSnapshot([...fourArmEntries('p'), entryFor('q/one', 'q')]),
      manifests: [manifest],
    })

    expect(census.partition.p).toEqual({
      saltDigest: sha256hex(manifest.salt),
      heldOutFraction: 0.3,
      privateFraction: 0.4,
      partitionVersion: 1,
    })
    // T-414-29: only the digest leaves the manifest file, in the JSON as in the markdown.
    expect(JSON.stringify(census)).not.toContain(manifest.salt)
    // A product with no manifest is ABSENT, never a fabricated row of zeros or nulls (D-17).
    expect(Object.hasOwn(census.partition, 'q')).toBe(false)
    expect(Object.keys(census.partition)).toEqual(['p'])

    const unpartitioned = deriveCensus({ snapshot: entriesSnapshot(fourArmEntries('p')) })
    expect(unpartitioned.partition).toEqual({})
  })

  it('tallies committed exclusion records per product with every class and producer at zero', () => {
    const census = deriveCensus({
      snapshot: entriesSnapshot([...fourArmEntries('p'), entryFor('q/one', 'q')]),
      exclusions: [
        exclusionFor('p', 'run-flaky', { class: 'flake', producer: 'analyze-run' }),
        exclusionFor('p', 'run-env', {
          class: 'environment',
          producer: 'deterministic-classifier',
        }),
      ],
    })

    expect(census.products.p!.exclusions).toEqual({
      total: 2,
      byClass: { environment: 1, flake: 1, timeout: 0 },
      byProducer: { 'analyze-run': 1, 'deterministic-classifier': 1 },
    })
    // A product nothing excluded reports zeros, not an absent block.
    expect(census.products.q!.exclusions).toEqual({
      total: 0,
      byClass: { environment: 0, flake: 0, timeout: 0 },
      byProducer: { 'analyze-run': 0, 'deterministic-classifier': 0 },
    })
  })

  it('echoes schemaVersionsSeen verbatim, answering an absent input with an empty record', () => {
    const seen = deriveCensus({
      snapshot: entriesSnapshot(fourArmEntries('p')),
      schemaVersionsSeen: { '1': 3, '2': 152 },
    })
    expect(seen.schemaVersionsSeen).toEqual({ '1': 3, '2': 152 })
    expect(Object.keys(seen.schemaVersionsSeen)).toEqual(['1', '2'])

    const absent = deriveCensus({ snapshot: entriesSnapshot(fourArmEntries('p')) })
    expect(absent.schemaVersionsSeen).toEqual({})
  })

  it('is a pure fold: shuffled entries, manifests and exclusions serialise identically', () => {
    const entries = [...fourArmEntries('p'), ...fourArmEntries('q')]
    const manifests = [manifestFor('p', FIXTURE_SALT), manifestFor('q', OTHER_SALT)]
    const exclusions = [
      exclusionFor('p', 'run-a', { class: 'flake', producer: 'analyze-run' }),
      exclusionFor('q', 'run-b', { class: 'timeout', producer: 'deterministic-classifier' }),
      exclusionFor('p', 'run-c', { class: 'environment', producer: 'analyze-run' }),
    ]
    const schemaVersionsSeen = { '2': 8, '1': 1 }

    const forward = deriveCensus({
      snapshot: entriesSnapshot(entries),
      manifests,
      exclusions,
      schemaVersionsSeen,
    })
    const reversed = deriveCensus({
      snapshot: entriesSnapshot([...entries].reverse()),
      manifests: [...manifests].reverse(),
      exclusions: [...exclusions].reverse(),
      schemaVersionsSeen: { '1': 1, '2': 8 },
    })

    expect(canonicalJson(forward)).toBe(canonicalJson(reversed))
    expect(Object.keys(forward.partition)).toEqual(['p', 'q'])
    expect(forward.products.p!.exclusions.total).toBe(2)
    expect(forward.products.q!.exclusions.total).toBe(1)
  })
})
