// 422-19-T2: the SCORED population's generation mix, beside per-split scoring that does not move.
//
// `perSplit.adversarial` has always been present and always will be — a batch with no adversarial
// member states four complete zero cells rather than omitting one (420 D-05). The mix is the
// opposite kind of field, and deliberately so: it is present only when there is an adversarial
// population to describe, because a histogram of zeros beside an empty cell would read as "we
// scored adversarial cases and none came from anywhere".
//
// Two populations exist in this phase and they are NOT the same set. The census counts committed
// membership; this counts what was actually scored in one batch. The cells below therefore build
// the mix from the entries' own corpus generator metadata and check the count against the
// `perSplit.adversarial` denominators — never against a corpus census.
//
// And the denominators are the other half of the contract. Disclosure is additive: attaching
// generator metadata to an entry must not move an accuracy, a rate, a cost or a refusal count,
// because a number that changes when you describe it was never measuring what it claimed to.
import { describe, expect, it } from 'vitest'
import type { CorpusGenerator } from '../../labels/corpus-entry'
import { ADVERSARIAL_MUTATORS } from '../../labels/corpus-entry'
import { buildEvalReport, type ScoredBatchEntry } from '../metrics'
import { metricEntry, passLabel } from './fixtures/label-metric-fixtures'

const HASH_1 = '1'.repeat(64)
const HASH_2 = '2'.repeat(64)

function tableGenerator(over: Partial<CorpusGenerator> = {}): CorpusGenerator {
  return {
    kind: 'fuzz-label',
    seedCassetteId: 'seed-natural',
    generatorVersion: 2,
    mutator: 'confusable',
    tableVersion: 2,
    tableHash: HASH_2,
    ...over,
  }
}

function probeGenerator(over: Partial<CorpusGenerator> = {}): CorpusGenerator {
  return {
    kind: 'judge-targeted',
    seedCassetteId: 'seed-natural',
    generatorVersion: 2,
    authoringModel: { id: 'anthropic/claude-probe', family: 'anthropic' },
    promptVersion: 1,
    ...over,
  }
}

function adversarialEntry(
  cassetteId: string,
  generator?: CorpusGenerator,
  full = true,
): ScoredBatchEntry {
  return {
    ...metricEntry(cassetteId, full),
    split: 'adversarial' as const,
    ...(generator === undefined ? {} : { generator }),
  }
}

function sum(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0)
}

describe('422 scored adversarial generation mix', () => {
  it('discloses the mix of the scored population and leaves every existing metric untouched', () => {
    const bare = [
      adversarialEntry('adv-1'),
      adversarialEntry('adv-2', undefined, false),
      { ...metricEntry('nat-1'), split: 'natural' as const, label: passLabel() },
    ]
    const described = [
      adversarialEntry('adv-1', tableGenerator()),
      adversarialEntry('adv-2', tableGenerator({ mutator: 'invisible' }), false),
      { ...metricEntry('nat-1'), split: 'natural' as const, label: passLabel() },
    ]
    const plain = buildEvalReport(bare)
    const disclosed = buildEvalReport(described)

    const mix = disclosed.adversarialGenerationMix
    expect(mix).toBeDefined()
    expect(mix!.total).toBe(2)
    expect(mix!.byProvenance).toEqual({ absent: 0, table: 2, probe: 0, malformed: 0 })
    expect(mix!.byMutator.confusable).toBe(1)
    expect(mix!.byMutator.invisible).toBe(1)
    expect(mix!.byTableVersion).toEqual({ '2': 2 })

    // Additive: describing the population cannot move what the population measured.
    expect(disclosed.perSplit).toEqual(plain.perSplit)
    expect(disclosed.perSplit.adversarial.firstAttemptDecisionAccuracy)
      .toEqual({ numerator: 1, denominator: 2, rate: 0.5 })
    expect(disclosed.headline).toEqual(plain.headline)
    expect(disclosed.honesty).toEqual(plain.honesty)
    expect(disclosed.totalCost).toEqual(plain.totalCost)
    expect(disclosed.recovery).toEqual(plain.recovery)
    // ...and the mix counts the SCORED adversarial population, not the whole batch.
    expect(mix!.total).toBe(disclosed.perSplit.adversarial.perDecisionCost.decisionCount)
    expect(disclosed.headline.perDecisionCost.decisionCount).toBe(3)
  })

  it('keeps an empty adversarial score population explicit and states no mix for it', () => {
    const report = buildEvalReport([
      { ...metricEntry('nat-1'), split: 'natural' as const, label: passLabel() },
    ])
    // The cell is always present — four complete cells, zeros and all (420 D-05).
    expect(report.perSplit.adversarial).toEqual({
      firstAttemptDecisionAccuracy: { numerator: 0, denominator: 0 },
      verifierFalsePassRate: { numerator: 0, denominator: 0 },
      recovery: {
        selfHealPairCount: 0, recoveredPositiveCount: 0, eligiblePositiveCount: 0,
        negativeDecisionCount: 0, negativeFullMatchCount: 0, weightSum: 0, pairsWithoutWeight: 0,
      },
      perDecisionCost: { decisionCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, durationMs: 0 },
    })
    // The mix is the opposite: absent, because there is no population to describe.
    expect(report.adversarialGenerationMix).toBeUndefined()
    expect(JSON.stringify(report)).not.toContain('adversarialGenerationMix')
    expect(buildEvalReport([]).adversarialGenerationMix).toBeUndefined()
  })

  it('invents no generation metadata for a scored entry whose corpus membership is unresolved', () => {
    const report = buildEvalReport([
      adversarialEntry('adv-known', tableGenerator()),
      adversarialEntry('adv-unknown'),
    ])
    const mix = report.adversarialGenerationMix!
    expect(mix.total).toBe(2)
    // Unavailable is its OWN fact: it is not `absent` provenance, which would claim the committed
    // entry names no family when in truth nobody looked the entry up.
    expect(mix.metadataUnavailable).toBe(1)
    expect(mix.byProvenance).toEqual({ absent: 0, table: 1, probe: 0, malformed: 0 })
    expect(sum(mix.byKind)).toBe(1)
    expect(sum(mix.byMutator)).toBe(1)
    expect(sum(mix.byTableVersion)).toBe(1)
  })

  it('reports probe-authored and table-derived scored cases without summing them', () => {
    const report = buildEvalReport([
      adversarialEntry('adv-table', tableGenerator({ tableVersion: 1, tableHash: HASH_1 })),
      adversarialEntry('adv-probe', probeGenerator()),
      adversarialEntry('adv-legacy', { kind: 'fuzz-error', seedCassetteId: 'seed-natural', generatorVersion: 1 }),
    ])
    const mix = report.adversarialGenerationMix!
    expect(mix.total).toBe(3)
    expect(mix.byProvenance).toEqual({ absent: 1, table: 1, probe: 1, malformed: 0 })
    expect(mix.byTableVersion).toEqual({ '1': 1 })
    expect(mix.tableHashesByVersion).toEqual({ '1': [HASH_1] })
    expect(mix.byPromptVersion).toEqual({ '1': 1 })
    expect(mix.byAuthoringModel).toEqual({ 'anthropic/claude-probe': 1 })
    expect(mix.byAuthoringFamily).toEqual({ anthropic: 1 })
    // Every declared family is present so "scored nothing from this family" reads as zero, and
    // the legacy member reaches none of them.
    expect(Object.keys(mix.byMutator).sort()).toEqual([...ADVERSARIAL_MUTATORS].sort())
    expect(sum(mix.byMutator)).toBe(1)
  })
})
