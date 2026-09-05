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
 */
import { RETRIEVAL_RUNGS } from '@vostride/agent-qa-schema'
import type { RetrievalRung } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../cassette/cassette'
import type { CassetteSidecarLeg } from '../cassette/sidecar-leg'
import type { LabelTier } from '../cassette/label-leg'
import type { CorpusEntry } from '../labels/corpus-entry'
import type { StandaloneLabelRecord } from '../labels/label-record'
import { EXCLUSION_CLASSES, VERDICT_PRODUCERS } from '../labels/run-exclusion'
import type { ExclusionClass, VerdictProducer } from '../labels/run-exclusion'
import type { EvalBatchReport } from '../match/metrics'
import { computeCorpusDigest } from './corpus-digest'

/** Single version gate for the census document (D-15). */
export const CENSUS_SCHEMA_VERSION = 1 as const

type Counts<T extends string> = { [K in T]: number }

interface RateMetric {
  numerator: number
  denominator: number
  rate?: number
}

// 414 D-02: the two verdict vocabularies now live beside the committed
// run-exclusion document that admits them, and the census imports them back.
// The list the census COUNTS and the list a committed exclusion may NAME are
// therefore one spelling that cannot drift.

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

/** Per-product counters; every key is present even at zero, so absence is never silent. */
export interface CensusProductBlock {
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

/** The committed census document (D-15/D-16). */
export interface CorpusCensus {
  schemaVersion: 1
  corpusDigest: string
  entryCount: number
  products: Readonly<Record<string, CensusProductBlock>>
  campaign: CensusCampaignSummary | { present: false }
  crossCheck: readonly CensusCrossCheckLine[]
}

export interface DeriveCensusInput {
  snapshot: CommittedCorpusSnapshot
  campaign?: CensusCampaignInput
  reports?: readonly {
    report: EvalBatchReport
    comparator: CensusCrossCheckLine['comparator']
    designatedBy: readonly string[]
  }[]
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

interface ProductAccumulator {
  total: number
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
    total: 0,
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

  return {
    total: accumulator.total,
    scorableByTier: { tier1: accumulator.total, tier2, tier3 },
    goldEvidence: tier2 + tier3,
    staticScorability: accumulator.staticScorability,
    labelTiers: accumulator.labelTiers,
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
  }
}

/** Fold the loaded committed root into the D-16 per-product census. */
export function deriveCensus(input: DeriveCensusInput): CorpusCensus {
  const { snapshot } = input
  const accumulators = new Map<string, ProductAccumulator>()

  for (const entry of snapshot.entries) {
    const accumulator = accumulatorFor(accumulators, entry.product)
    accumulator.total += 1

    const label = snapshot.labelsById.get(entry.cassetteId)
    if (label === undefined) accumulator.missingLabelRecord += 1
    else accumulator.labelTiers[label.label.tier] += 1

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

  const campaign =
    input.campaign === undefined
      ? ({ present: false } as const)
      : foldCampaign(accumulators, input.campaign)

  const products: Record<string, CensusProductBlock> = {}
  for (const product of [...accumulators.keys()].sort()) {
    products[product] = projectBlock(accumulators.get(product)!)
  }

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
  }
}
