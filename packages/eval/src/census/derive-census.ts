/**
 * 413 D-14/D-16 corpus census — the static, model-free measurement of the committed root
 * (ROOT-05).
 *
 * Composition law: this file is a PURE FOLD over already-loaded legs. `eval-local` owns every
 * read of the committed root and hands the snapshot in; the cli composes the verb and renders.
 * Nothing here touches a host API, a clock, or a threshold — D-16 forbids a prose verdict and a
 * minimum-n constant alike, so the census states counts and rates and stops.
 *
 * Two axes are deliberately NOT derived from the cassette. The product is read from the corpus
 * entry, never from `servedBrief.scope` (every committed cassette resolves that to the `default`
 * partition — RESEARCH F5). The label tier is read from the committed label record, never from
 * the cassette's embedded label leg (which reads `silver` on all 24 while the record carries
 * `near-gold` for the self-heal pairs — RESEARCH F8).
 *
 * 414 D-17 widened the document to schema version 2: per product the four split x visibility
 * counts, the two D-04 field-coverage rates and the committed-exclusion tallies; top level the
 * per-product `partition` echo and `schemaVersionsSeen`. The two census directories committed at
 * version 1 stay exactly as they are — a committed census is write-once history, so a schema bump
 * lands as a NEW directory rather than a rewrite of the old ones.
 *
 * ROOT-10 stands over the partition echo: the manifest's salt decides which split every cassette
 * in a product lands in, so only `sha256hex(salt)` may appear here. A product with no committed
 * manifest is ABSENT from `partition` — a fabricated row would read as parameters nobody chose.
 *
 * D-16 still forbids interpretation: every number below is an integer count or a
 * numerator/denominator pair. No threshold, no minimum-n, no verdict — 415 prices the floor.
 */
import { RETRIEVAL_RUNGS, sha256hex } from '@vostride/agent-qa-schema'
import type { RetrievalRung } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../cassette/cassette'
import type { CassetteSidecarLeg } from '../cassette/sidecar-leg'
import type { LabelTier } from '../cassette/label-leg'
import { countGateSet } from '../gate/gate-set'
import type { GateSetCounts } from '../gate/gate-set'
import {
  ADVERSARIAL_MUTATORS,
  GENERATOR_KINDS,
  GENERATOR_PROVENANCES,
  generatorProvenance,
} from '../labels/corpus-entry'
import type {
  AdversarialMutator,
  CorpusEntry,
  CorpusGenerator,
  GeneratorKind,
  GeneratorProvenance,
} from '../labels/corpus-entry'
import type { StandaloneLabelRecord } from '../labels/label-record'
import { parseStandaloneLabelRecord } from '../labels/effective-labels'
import type { PartitionManifest } from '../labels/partition-manifest'
import { EXCLUSION_CLASSES, VERDICT_PRODUCERS } from '../labels/run-exclusion'
import type { ExclusionClass, RunExclusionRecord, VerdictProducer } from '../labels/run-exclusion'
import type { EvalBatchReport } from '../match/metrics'
import { computeCorpusDigest } from './corpus-digest'

/**
 * Single version gate for the census document (D-15), bumped to 2 by 414 D-17. The two census
 * directories already committed under version 1 are write-once history and stay at 1.
 */
export const CENSUS_SCHEMA_VERSION = 2 as const

type Counts<T extends string> = { [K in T]: number }

interface RateMetric {
  numerator: number
  denominator: number
  rate?: number
}

/**
 * One product's committed partition parameters, echoed as counts a reader can re-derive from
 * (414 D-17). `saltDigest` is `sha256hex` over the manifest's salt — never the salt itself.
 */
export interface PartitionCensusBlock {
  saltDigest: string
  heldOutFraction: number
  privateFraction: number
  partitionVersion: number
}

/**
 * What the committed `exclusions/**` records say about one product (414 D-02). Every class and
 * every producer is present at zero, seeded from the closed vocabularies rather than from the
 * records, so a class nothing excluded reads as `0` instead of vanishing.
 */
export interface ExclusionCensusBlock {
  total: number
  byClass: Readonly<Record<ExclusionClass, number>>
  byProducer: Readonly<Record<VerdictProducer, number>>
}

// 414 D-02: the two verdict vocabularies now live beside the committed
// run-exclusion document that admits them, and the census imports them back.
// The list the census COUNTS and the list a committed exclusion may NAME are
// therefore one spelling that cannot drift.

/**
 * 2026-09-12, 422 D-05/D-08/D-11/D-12: how an adversarial population was GENERATED.
 *
 * The shape is one projection used by two populations — the committed corpus (this file) and a
 * scored replay batch (`../match/metrics`) — because "which generations are in here" is one
 * question and two spellings of it would eventually answer it two ways. What each caller may NOT
 * do is hand the other's population in: the census counts committed membership, the report counts
 * what was actually scored, and the two are different sets.
 *
 * Three separations are structural rather than documented, and every one of them exists because a
 * plausible generation histogram is worse than a missing one:
 *
 *   - CLOSED sets read zero; OPEN sets read absent. `byKind` and `byMutator` are seeded from the
 *     closed vocabularies, so a declared family that produced nothing states `0` instead of
 *     vanishing. `byTableVersion`, `byPromptVersion`, `byAuthoringModel` and `byAuthoringFamily`
 *     are keyed by what was actually OBSERVED — nobody can enumerate the table generations that
 *     do not exist, so a generation with no member is ABSENT rather than a zero that would read
 *     as "that generation was attempted and produced nothing".
 *   - PROBE-AUTHORED never sums with TABLE-DERIVED. 422-04 made the two structurally
 *     distinguishable (a probe names `promptVersion` and carries no
 *     `mutator`/`tableVersion`/`tableHash`) precisely so a reader can tell a deterministic
 *     fuzzer's output from an LLM's. `byMutator` and `byTableVersion` therefore sum to
 *     `byProvenance.table`, and the two probe axes to `byProvenance.probe` — never to `total`.
 *   - A LEGACY stamp is binned into no family at all. A pre-422 entry names a kind and a seed and
 *     nothing else; it counts as `byProvenance.absent` and reaches no mutator and no generation,
 *     because its family is UNKNOWN and a guess dressed as a count is the failure this whole
 *     block exists to avoid.
 *
 * `tableHashesByVersion` is the tamper disclosure (T-422-19-01): a generation is supposed to name
 * exactly one frozen table, so two distinct hashes under one version is a fact a reader must be
 * able to SEE rather than a discrepancy that averages away inside a count.
 */
export interface AdversarialGenerationMix {
  /** Members of the population this mix describes; equals the adversarial arm's own total. */
  total: number
  /**
   * Members whose generator metadata the caller could not supply at all. Always `0` for the
   * committed census (an adversarial entry structurally carries a generator); nonzero only where
   * a scored entry's corpus membership was not resolvable, which is NOT the same fact as a
   * legacy entry that names no family.
   */
  metadataUnavailable: number
  /** Which provenance shape each member's stamp actually carries (422-04). */
  byProvenance: Counts<GeneratorProvenance>
  /** The perturbed FIELD, over every member that names a generator. Closed set; zeros retained. */
  byKind: Counts<GeneratorKind>
  /** The mutation FAMILY, over the table arm only. Closed set; zeros retained. */
  byMutator: Counts<AdversarialMutator>
  /** Frozen table generation → committed count. Open set; an uncommitted generation is absent. */
  byTableVersion: Readonly<Record<string, number>>
  /** Sorted distinct pinned table hashes seen under each generation (T-422-19-01). */
  tableHashesByVersion: Readonly<Record<string, readonly string[]>>
  /** Frozen prompt version → count, over the probe arm only. Open set. */
  byPromptVersion: Readonly<Record<string, number>>
  /** Authoring model identity → count, over the probe arm only (D-11 disclosure). */
  byAuthoringModel: Readonly<Record<string, number>>
  /** Resolved provider family → count, over the probe arm only. */
  byAuthoringFamily: Readonly<Record<string, number>>
}

function zeroGeneratorProvenances(): Counts<GeneratorProvenance> {
  const counts = {} as Counts<GeneratorProvenance>
  for (const value of GENERATOR_PROVENANCES) counts[value] = 0
  return counts
}

function zeroGeneratorKinds(): Counts<GeneratorKind> {
  const counts = {} as Counts<GeneratorKind>
  for (const value of GENERATOR_KINDS) counts[value] = 0
  return counts
}

function zeroAdversarialMutators(): Counts<AdversarialMutator> {
  const counts = {} as Counts<AdversarialMutator>
  for (const value of ADVERSARIAL_MUTATORS) counts[value] = 0
  return counts
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/** Sorted-key projection of an observed-value map; an unobserved key never appears (D-04). */
function sortedStringSets(
  sets: ReadonlyMap<string, Set<string>>,
): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, readonly string[]> = {}
  for (const key of [...sets.keys()].sort()) result[key] = [...sets.get(key)!].sort()
  return result
}

/**
 * Fold one adversarial population's generator stamps into the disclosed mix.
 *
 * `undefined` in the input means the CALLER had no generator for that member — a distinct fact
 * from a member whose stamp names no family, and kept distinct as `metadataUnavailable` so a
 * report over entries whose corpus membership was unresolvable cannot read as a corpus of
 * pre-422 legacy entries.
 */
export function projectAdversarialGenerationMix(
  generators: readonly (CorpusGenerator | undefined)[],
): AdversarialGenerationMix {
  const byProvenance = zeroGeneratorProvenances()
  const byKind = zeroGeneratorKinds()
  const byMutator = zeroAdversarialMutators()
  const byTableVersion = new Map<string, number>()
  const tableHashes = new Map<string, Set<string>>()
  const byPromptVersion = new Map<string, number>()
  const byAuthoringModel = new Map<string, number>()
  const byAuthoringFamily = new Map<string, number>()
  let metadataUnavailable = 0

  for (const generator of generators) {
    if (generator === undefined) {
      metadataUnavailable += 1
      continue
    }
    byKind[generator.kind] += 1
    const provenance = generatorProvenance(generator)
    byProvenance[provenance] += 1
    if (provenance === 'table') {
      // Guarded by the provenance rule: a `table` stamp names all three fields or it is not one.
      byMutator[generator.mutator!] += 1
      const version = String(generator.tableVersion!)
      bump(byTableVersion, version)
      const hashes = tableHashes.get(version) ?? new Set<string>()
      hashes.add(generator.tableHash!)
      tableHashes.set(version, hashes)
    } else if (provenance === 'probe') {
      bump(byPromptVersion, String(generator.promptVersion!))
      bump(byAuthoringModel, generator.authoringModel!.id)
      bump(byAuthoringFamily, generator.authoringModel!.family)
    }
  }

  return {
    total: generators.length,
    metadataUnavailable,
    byProvenance,
    byKind,
    byMutator,
    byTableVersion: sortedCounts(byTableVersion),
    tableHashesByVersion: sortedStringSets(tableHashes),
    byPromptVersion: sortedCounts(byPromptVersion),
    byAuthoringModel: sortedCounts(byAuthoringModel),
    byAuthoringFamily: sortedCounts(byAuthoringFamily),
  }
}

/**
 * The tier a cassette can reach from its committed bytes alone, mirroring the `runMatchTiers`
 * control flow (match/tiers.ts). Op-class agreement is a replay-time fact about a candidate
 * action, so it stays out of the static rule — every cassette reaches tier 1 by construction.
 */
export type StaticScorability = 'tier2-anchor' | 'tier3-annotation' | 'no-gold-evidence'

/** Rung as counted by the census; a cassette recorded before 413 has no rung to name. */
export type CensusRung = RetrievalRung | 'legacy-no-rung'

/** Loaded committed-root legs the census folds; eval-local produces this shape. */
export interface CommittedCorpusSnapshot {
  entries: readonly CorpusEntry[]
  /** Parsed persisted history, including refused records, for audit and calibration. */
  labelHistory?: readonly unknown[]
  /** Authoritative exclusion, distinct from the absence that permits legacy fallback. */
  excludedLabelIds?: ReadonlySet<string>
  labelsById: ReadonlyMap<string, StandaloneLabelRecord>
  cassettesById: ReadonlyMap<string, LeafCassette>
  blobPresentById: ReadonlyMap<string, boolean>
}

/**
 * The structural campaign shape the census folds run-level facts from. Plan 04's guarded
 * `CampaignManifest` is assignable to it; declaring it structurally here keeps this file
 * independent of the manifest module so either can land first.
 */
export interface CensusCampaignInput {
  legs: readonly {
    product: string
    testId: string
    excluded: boolean
    seeded: boolean
    verdicts: readonly { class: string; producer: string }[]
    wallClockMs: number
    modelCalls: number
    promptTokens: number
    completionTokens: number
  }[]
  manifestDigest: string
}

/** Per-product counters; markedGold is the presence-conditional compatibility extension. */
export interface CensusProductBlock {
  /** Committed membership and label audit, separate from the scorable population below. */
  labelAudit?: {
    committedMembers: number
    scorableMembers: number
    rerunPairs: number
    rerunMarkedLabels: number
    rerunOverturnedOriginals: number
    rerunOverturnQuarantined: number
    refusedHistories: number
    retiredMarkedLabels: number
  }
  markedGold?: { 'user-mark': number; 'overturned-verdict': number }
  total: number
  scorableByTier: { tier1: number; tier2: number; tier3: number }
  goldEvidence: number
  staticScorability: Counts<StaticScorability>
  labelTiers: Counts<LabelTier>
  proofCoverage: RateMetric
  rungMix: Counts<CensusRung>
  briefContent: Counts<'empty-brief' | 'populated-brief'>
  blobsPresentLocally: RateMetric
  missingLabelRecord: number
  missingCassette: number
  runsSeeded: number
  runsExcluded: Counts<ExclusionClass>
  runsExcludedByProducer: Counts<VerdictProducer>
  seededByProducer: Counts<VerdictProducer | 'no-verdict'>
  repeatCounts: Readonly<Record<string, number>>
  /** The four split x visibility arms, counted by the ONE shared counter (414 D-03/D-17). */
  splits: GateSetCounts
  /** How many entries carry each OPTIONAL D-04 field, over the product total. */
  fieldCoverage: { capturedAt: RateMetric; targetEnvironment: RateMetric }
  /** What the committed exclusion records say about this product (414 D-02). */
  exclusions: ExclusionCensusBlock
  /**
   * 422 D-05/D-08/D-11: how this product's COMMITTED adversarial members were generated.
   *
   * Present only when the product actually holds at least one committed adversarial entry —
   * absent is not zero. A product that has never admitted an adversarial case carries no block
   * at all, so a census of a root that never refreshed cannot be mistaken for a census of a
   * refresh that produced nothing, and every census document committed before 422 keeps its
   * bytes under the existing write-once schema-version-2 key.
   */
  adversarialGenerationMix?: AdversarialGenerationMix
}

/**
 * One committed report set beside the corpus. `membershipComparable` is always false: a report
 * carries only a batchKey, never its cassette-id list, so the two populations can be PRINTED
 * side by side but never reconciled (RESEARCH F7). The `comparator` verdict is computed by the
 * caller — this module must not import from `../baseline`.
 */
export interface CensusCrossCheckLine {
  batchKey: string
  decisionCount: number
  corpusCassetteCount: number
  membershipComparable: false
  unscorableIdentityCounts: Readonly<Record<string, number>>
  refusalCounts: Readonly<Record<string, number>>
  /**
   * The refusal is restated STRUCTURALLY, not imported: 413-15 widened the comparator's kind
   * union to two members whose payloads differ (`same-family-override` names one judge and its
   * family; `mixed-judge-identity` names the list of distinct ids), so every payload field but
   * `kind` and `batchKey` is optional here. The census still never imports from `../baseline`.
   */
  comparator:
    | { ok: true }
    | {
        ok: false
        refusal: {
          kind: string
          batchKey: string
          judgeModelId?: string
          judgeFamily?: string
          judgeModelIds?: readonly string[]
        }
      }
  designatedBy: readonly string[]
}

/** Campaign roll-up; absent campaigns state their absence rather than printing zeros. */
export interface CensusCampaignSummary {
  present: true
  manifestDigest: string
  legs: number
  runsSeeded: number
  runsExcluded: number
  modelCalls: number
  promptTokens: number
  completionTokens: number
  wallClockMs: number
}

/** The committed census document (D-15/D-16, widened by 414 D-17). */
export interface CorpusCensus {
  schemaVersion: 2
  corpusDigest: string
  entryCount: number
  products: Readonly<Record<string, CensusProductBlock>>
  campaign: CensusCampaignSummary | { present: false }
  crossCheck: readonly CensusCrossCheckLine[]
  /** One entry per PARTITIONED product, sorted; an unpartitioned product is absent (D-17). */
  partition: Readonly<Record<string, PartitionCensusBlock>>
  /**
   * How many committed corpus FILES declared each entry schema version, echoed verbatim from the
   * read leg. Every entry is the v2 shape in memory, so this is the only place the byte version
   * survives into a report a reader can cite.
   */
  schemaVersionsSeen: Readonly<Record<string, number>>
}

export interface DeriveCensusInput {
  snapshot: CommittedCorpusSnapshot
  /** Guarded full membership, including excluded owners; never used to admit scoring rows. */
  corpusEntriesById?: ReadonlyMap<string, CorpusEntry>
  retiredMarkedCassetteIds?: ReadonlySet<string>
  campaign?: CensusCampaignInput
  reports?: readonly {
    report: EvalBatchReport
    comparator: CensusCrossCheckLine['comparator']
    designatedBy: readonly string[]
  }[]
  /** Committed partition manifests, read by eval-local and handed in as DATA (414 D-05). */
  manifests?: readonly PartitionManifest[]
  /** Committed run-exclusion records, read by eval-local and handed in as DATA (414 D-02). */
  exclusions?: readonly RunExclusionRecord[]
  /** The read leg's byte-version census; absent means an empty record, never a guess. */
  schemaVersionsSeen?: Readonly<Record<string, number>>
}

function rateMetric(numerator: number, denominator: number): RateMetric {
  return {
    numerator,
    denominator,
    ...(denominator === 0 ? {} : { rate: numerator / denominator }),
  }
}

function sortedCounts(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const key of [...counts.keys()].sort()) result[key] = counts.get(key) ?? 0
  return result
}

/**
 * The static half of `runMatchTiers` (match/tiers.ts): a gold anchor makes tier 2 reachable, a
 * point annotation alone makes tier 3 reachable, and anything else is `no-gold-evidence`. A
 * sidecar carrying BOTH is tier 2 — the same precedence the router applies — so the three arms
 * partition the corpus and always sum to the total.
 */
export function classifyStaticScorability(sidecar: CassetteSidecarLeg): StaticScorability {
  if (sidecar.goldAnchor !== undefined) return 'tier2-anchor'
  if (sidecar.annotation !== undefined && sidecar.annotation.kind === 'point') {
    return 'tier3-annotation'
  }
  return 'no-gold-evidence'
}

/** The `firstNonEmptyChannel` rule from replay/reconstruct.ts, counted rather than refused. */
function hasPopulatedBrief(cassette: LeafCassette): boolean {
  const brief = cassette.input.servedBrief
  return brief.channel1.length > 0 || brief.channel2.length > 0 || brief.channel3.length > 0
}

function zeroRungMix(): Counts<CensusRung> {
  const mix = { 'legacy-no-rung': 0 } as Counts<CensusRung>
  for (const rung of RETRIEVAL_RUNGS) mix[rung] = 0
  return mix
}

/**
 * Seed the exclusion zeros from the CLOSED VOCABULARIES, never from the records in hand — a class
 * or producer nothing excluded must read as `0` rather than vanish from the block (D-04).
 */
function zeroExclusionClasses(): Counts<ExclusionClass> {
  const counts = {} as Counts<ExclusionClass>
  for (const value of EXCLUSION_CLASSES) counts[value] = 0
  return counts
}

function zeroVerdictProducers(): Counts<VerdictProducer> {
  const counts = {} as Counts<VerdictProducer>
  for (const value of VERDICT_PRODUCERS) counts[value] = 0
  return counts
}

interface ProductAccumulator {
  markedGold: { 'user-mark': number; 'overturned-verdict': number }
  total: number
  entries: CorpusEntry[]
  capturedAtPresent: number
  targetEnvironmentPresent: number
  exclusionTotal: number
  exclusionByClass: Counts<ExclusionClass>
  exclusionByProducer: Counts<VerdictProducer>
  staticScorability: Counts<StaticScorability>
  labelTiers: Counts<LabelTier>
  proofCarrying: number
  proofDenominator: number
  rungMix: Counts<CensusRung>
  briefContent: Counts<'empty-brief' | 'populated-brief'>
  blobsPresent: number
  blobDenominator: number
  missingLabelRecord: number
  missingCassette: number
  runsSeeded: number
  runsExcluded: Counts<ExclusionClass>
  runsExcludedByProducer: Counts<VerdictProducer>
  seededByProducer: Counts<VerdictProducer | 'no-verdict'>
  repeatCounts: Map<string, number>
}

function newAccumulator(): ProductAccumulator {
  return {
    markedGold: { 'user-mark': 0, 'overturned-verdict': 0 },
    total: 0,
    entries: [],
    capturedAtPresent: 0,
    targetEnvironmentPresent: 0,
    exclusionTotal: 0,
    exclusionByClass: zeroExclusionClasses(),
    exclusionByProducer: zeroVerdictProducers(),
    staticScorability: { 'no-gold-evidence': 0, 'tier2-anchor': 0, 'tier3-annotation': 0 },
    labelTiers: { gold: 0, 'near-gold': 0, silver: 0 },
    proofCarrying: 0,
    proofDenominator: 0,
    rungMix: zeroRungMix(),
    briefContent: { 'empty-brief': 0, 'populated-brief': 0 },
    blobsPresent: 0,
    blobDenominator: 0,
    missingLabelRecord: 0,
    missingCassette: 0,
    runsSeeded: 0,
    runsExcluded: { environment: 0, flake: 0, timeout: 0 },
    runsExcludedByProducer: { 'analyze-run': 0, 'deterministic-classifier': 0 },
    seededByProducer: { 'analyze-run': 0, 'deterministic-classifier': 0, 'no-verdict': 0 },
    repeatCounts: new Map(),
  }
}

function accumulatorFor(
  accumulators: Map<string, ProductAccumulator>,
  product: string,
): ProductAccumulator {
  const existing = accumulators.get(product)
  if (existing !== undefined) return existing
  const created = newAccumulator()
  accumulators.set(product, created)
  return created
}

function isExclusionClass(value: string): value is ExclusionClass {
  return (EXCLUSION_CLASSES as readonly string[]).includes(value)
}

function isVerdictProducer(value: string): value is VerdictProducer {
  return (VERDICT_PRODUCERS as readonly string[]).includes(value)
}

function foldCampaign(
  accumulators: Map<string, ProductAccumulator>,
  campaign: CensusCampaignInput,
): CensusCampaignSummary {
  let runsSeeded = 0
  let runsExcluded = 0
  let modelCalls = 0
  let promptTokens = 0
  let completionTokens = 0
  let wallClockMs = 0

  for (const leg of campaign.legs) {
    const accumulator = accumulatorFor(accumulators, leg.product)
    accumulator.repeatCounts.set(leg.testId, (accumulator.repeatCounts.get(leg.testId) ?? 0) + 1)

    modelCalls += leg.modelCalls
    promptTokens += leg.promptTokens
    completionTokens += leg.completionTokens
    wallClockMs += leg.wallClockMs

    if (leg.excluded) {
      runsExcluded += 1
      for (const verdict of leg.verdicts) {
        if (!isExclusionClass(verdict.class)) continue
        accumulator.runsExcluded[verdict.class] += 1
        if (isVerdictProducer(verdict.producer)) {
          accumulator.runsExcludedByProducer[verdict.producer] += 1
        }
      }
    }

    if (leg.seeded) {
      runsSeeded += 1
      accumulator.runsSeeded += 1
      const producer = leg.verdicts[0]?.producer
      if (producer !== undefined && isVerdictProducer(producer)) {
        accumulator.seededByProducer[producer] += 1
      } else {
        accumulator.seededByProducer['no-verdict'] += 1
      }
    }
  }

  return {
    present: true,
    manifestDigest: campaign.manifestDigest,
    legs: campaign.legs.length,
    runsSeeded,
    runsExcluded,
    modelCalls,
    promptTokens,
    completionTokens,
    wallClockMs,
  }
}

function projectBlock(accumulator: ProductAccumulator): CensusProductBlock {
  const tier2 = accumulator.staticScorability['tier2-anchor']
  const tier3 = accumulator.staticScorability['tier3-annotation']
  // 422 D-05/D-08: the COMMITTED adversarial members, and nothing else. A staged or refused case
  // never reached `accumulator.entries` — the census folds the committed root — so the arithmetic
  // below cannot count work an operator has not admitted.
  const adversarialGenerators = accumulator.entries
    .filter(entry => entry.split === 'adversarial')
    .map(entry => entry.generator)

  return {
    total: accumulator.total,
    scorableByTier: { tier1: accumulator.total, tier2, tier3 },
    goldEvidence: tier2 + tier3,
    staticScorability: accumulator.staticScorability,
    labelTiers: accumulator.labelTiers,
    // 2026-09-08, 419 D-05: omit on unmarked corpora so the same digest retains
    // byte-identical census documents under the existing version-2 write-once key.
    ...(accumulator.markedGold['user-mark'] > 0 || accumulator.markedGold['overturned-verdict'] > 0
      ? { markedGold: accumulator.markedGold }
      : {}),
    proofCoverage: rateMetric(accumulator.proofCarrying, accumulator.proofDenominator),
    rungMix: accumulator.rungMix,
    briefContent: accumulator.briefContent,
    blobsPresentLocally: rateMetric(accumulator.blobsPresent, accumulator.blobDenominator),
    missingLabelRecord: accumulator.missingLabelRecord,
    missingCassette: accumulator.missingCassette,
    runsSeeded: accumulator.runsSeeded,
    runsExcluded: accumulator.runsExcluded,
    runsExcludedByProducer: accumulator.runsExcludedByProducer,
    seededByProducer: accumulator.seededByProducer,
    repeatCounts: sortedCounts(accumulator.repeatCounts),
    splits: countGateSet(accumulator.entries),
    fieldCoverage: {
      capturedAt: rateMetric(accumulator.capturedAtPresent, accumulator.total),
      targetEnvironment: rateMetric(accumulator.targetEnvironmentPresent, accumulator.total),
    },
    exclusions: {
      total: accumulator.exclusionTotal,
      byClass: accumulator.exclusionByClass,
      byProducer: accumulator.exclusionByProducer,
    },
    // Absent, never a block of zeros: a product with no committed adversarial member has no
    // generation mix to state, and the omission keeps pre-422 census bytes byte-identical.
    ...(adversarialGenerators.length === 0
      ? {}
      : { adversarialGenerationMix: projectAdversarialGenerationMix(adversarialGenerators) }),
  }
}

/**
 * Fold the committed exclusion records into their products. A record for a product with no
 * committed entry still mints its accumulator — that IS the D-02 point: a run excluded before
 * anything was seeded leaves no entry behind, and the census must still be able to count it.
 */
function foldExclusions(
  accumulators: Map<string, ProductAccumulator>,
  exclusions: readonly RunExclusionRecord[],
): void {
  for (const record of exclusions) {
    const accumulator = accumulatorFor(accumulators, record.product)
    accumulator.exclusionTotal += 1
    for (const verdict of record.verdicts) {
      accumulator.exclusionByClass[verdict.class] += 1
      accumulator.exclusionByProducer[verdict.producer] += 1
    }
  }
}

/**
 * Echo the committed partition parameters per product, salt DIGEST only (ROOT-10 / T-414-29).
 * Only products that actually carry a manifest appear; keys are sorted so two folds over the same
 * manifests serialise identically.
 */
function foldPartition(
  manifests: readonly PartitionManifest[],
): Readonly<Record<string, PartitionCensusBlock>> {
  const byProduct = new Map<string, PartitionCensusBlock>()
  for (const manifest of manifests) {
    byProduct.set(manifest.product, {
      saltDigest: sha256hex(manifest.salt),
      heldOutFraction: manifest.heldOutFraction,
      privateFraction: manifest.privateFraction,
      partitionVersion: manifest.partitionVersion,
    })
  }

  const partition: Record<string, PartitionCensusBlock> = {}
  for (const product of [...byProduct.keys()].sort()) partition[product] = byProduct.get(product)!
  return partition
}

/** Effective labels count once; raw refused history can name only a known committed owner. */
function foldLabelAudit(input: DeriveCensusInput, products: Record<string, CensusProductBlock>): void {
  const { snapshot } = input
  const members = input.corpusEntriesById ?? new Map(snapshot.entries.map(row => [row.cassetteId, row]))
  const scorable = new Set(snapshot.entries.map(row => row.cassetteId))
  const refused = new Set<string>()
  for (const id of snapshot.excludedLabelIds ?? []) {
    if (!snapshot.labelsById.has(id)) refused.add(id)
  }
  for (const raw of snapshot.labelHistory ?? []) {
    if (!parseStandaloneLabelRecord(raw).ok && typeof raw === 'object' && raw !== null
      && 'cassetteId' in raw && typeof raw.cassetteId === 'string') refused.add(raw.cassetteId)
  }
  const audits = new Map<string, NonNullable<CensusProductBlock['labelAudit']>>()
  const pairs = new Map<string, Set<string>>()
  for (const [id, entry] of members) {
    const audit = audits.get(entry.product) ?? { committedMembers: 0, scorableMembers: 0,
      rerunPairs: 0, rerunMarkedLabels: 0, rerunOverturnedOriginals: 0,
      rerunOverturnQuarantined: 0, refusedHistories: 0, retiredMarkedLabels: 0 }
    audits.set(entry.product, audit)
    audit.committedMembers += 1
    if (scorable.has(id)) audit.scorableMembers += 1
    if (refused.has(id)) audit.refusedHistories += 1
    if (input.retiredMarkedCassetteIds?.has(id)) audit.retiredMarkedLabels += 1
    const label = snapshot.labelsById.get(id)
    if (label?.quarantine === 'rerun-overturned') {
      audit.rerunOverturnedOriginals += 1
      if (snapshot.excludedLabelIds?.has(id)) audit.rerunOverturnQuarantined += 1
    }
    if (label?.provenance.rerun === undefined) continue
    audit.rerunMarkedLabels += 1
    const pairedId = label.label.pairing?.pairedCassetteId
    const sibling = pairedId === undefined ? undefined : snapshot.labelsById.get(pairedId)
    if (pairedId === undefined || pairedId === id || members.get(pairedId)?.product !== entry.product
      || sibling?.label.pairing?.pairedCassetteId !== id
      || label.label.sourceChannel !== 'self-heal-pair' || sibling.label.sourceChannel !== 'self-heal-pair') continue
    const seen = pairs.get(entry.product) ?? new Set<string>()
    seen.add(JSON.stringify([id, pairedId].sort()))
    pairs.set(entry.product, seen)
    audit.rerunPairs = seen.size
  }
  for (const [product, audit] of audits) {
    if (audit.rerunMarkedLabels === 0 && audit.rerunOverturnedOriginals === 0
      && audit.refusedHistories === 0 && audit.retiredMarkedLabels === 0) continue
    const block = products[product] ?? projectBlock(newAccumulator())
    block.labelAudit = audit
    products[product] = block
  }
}

/** Fold the loaded committed root into the D-16 per-product census. */
export function deriveCensus(input: DeriveCensusInput): CorpusCensus {
  const { snapshot } = input
  const accumulators = new Map<string, ProductAccumulator>()

  for (const entry of snapshot.entries) {
    const accumulator = accumulatorFor(accumulators, entry.product)
    accumulator.total += 1
    accumulator.entries.push(entry)
    if (entry.captured_at !== undefined) accumulator.capturedAtPresent += 1
    if (entry.targetEnvironment !== undefined) accumulator.targetEnvironmentPresent += 1

    const label = snapshot.labelsById.get(entry.cassetteId)
    if (label === undefined) accumulator.missingLabelRecord += 1
    else {
      accumulator.labelTiers[label.label.tier] += 1
      const channel = label.label.sourceChannel
      if (channel === 'user-mark' || channel === 'overturned-verdict') {
        accumulator.markedGold[channel] += 1
      }
    }

    const cassette = snapshot.cassettesById.get(entry.cassetteId)
    if (cassette === undefined) {
      accumulator.missingCassette += 1
      continue
    }

    accumulator.staticScorability[classifyStaticScorability(cassette.sidecar)] += 1

    accumulator.proofDenominator += 1
    if (cassette.input.servedBrief.proof !== undefined) accumulator.proofCarrying += 1

    accumulator.rungMix[cassette.input.retrievalRung?.rung ?? 'legacy-no-rung'] += 1
    accumulator.briefContent[hasPopulatedBrief(cassette) ? 'populated-brief' : 'empty-brief'] += 1

    accumulator.blobDenominator += 1
    if (snapshot.blobPresentById.get(entry.cassetteId) === true) accumulator.blobsPresent += 1
  }

  foldExclusions(accumulators, input.exclusions ?? [])

  const campaign =
    input.campaign === undefined
      ? ({ present: false } as const)
      : foldCampaign(accumulators, input.campaign)

  const products: Record<string, CensusProductBlock> = {}
  for (const product of [...accumulators.keys()].sort()) {
    products[product] = projectBlock(accumulators.get(product)!)
  }
  foldLabelAudit(input, products)

  const crossCheck: CensusCrossCheckLine[] = (input.reports ?? []).map((entry) => ({
    batchKey: entry.report.batchKey,
    decisionCount: entry.report.headline.perDecisionCost.decisionCount,
    corpusCassetteCount: snapshot.entries.length,
    membershipComparable: false,
    unscorableIdentityCounts: entry.report.honesty.unscorableIdentityCounts,
    refusalCounts: entry.report.honesty.refusalCounts,
    comparator: entry.comparator,
    designatedBy: entry.designatedBy,
  }))

  return {
    schemaVersion: CENSUS_SCHEMA_VERSION,
    corpusDigest: computeCorpusDigest(snapshot.entries),
    entryCount: snapshot.entries.length,
    products,
    campaign,
    crossCheck,
    partition: foldPartition(input.manifests ?? []),
    schemaVersionsSeen: sortedCounts(
      new Map(Object.entries(input.schemaVersionsSeen ?? {})),
    ),
  }
}
