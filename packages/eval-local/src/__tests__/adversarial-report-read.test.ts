// 422-19-T2 at the READ boundary — what a stored report may say about how its cases were made.
//
// `report-metadata-guard.ts` is the wall that decides whether persisted bytes are a legacy
// report, a current one, or not a report at all. Widening what a report may CARRY without
// widening the guard would leave the new field unvalidated on the one path where bytes arrive
// from outside this process: a count read off disk is a count nobody computed here.
//
// So the guard is extended in the same commit, and strictly in both directions:
//
//   - ABSENT stays admissible forever. Every report committed before 422 carries no mix, and a
//     reader must not invent one — that is the whole reason the field is optional rather than
//     defaulted to a block of zeros. `legacyReportComparison` therefore strips it too, exactly as
//     it strips the six 420 additions, so a fresh re-derivation still reproduces legacy bytes.
//   - PRESENT must be well-formed. Counts are nonnegative safe integers, and every closed-set key
//     is a generator word this build actually knows — an unknown mutator or provenance arm read
//     off disk is a vocabulary from some other build, not a value to pass through.
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildEvalReport } from '@vostride/agent-qa-eval'
import type { CorpusGenerator, EvalBatchReport, ScoredBatchEntry } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'

import { FsReportStore, loadStagedReport } from '../report-store.js'
import { legacyReportComparison, reportMetadataKind } from '../report-metadata-guard.js'

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

function scoredEntry(cassetteId: string, generator?: CorpusGenerator): ScoredBatchEntry {
  return {
    cassetteId,
    split: 'adversarial',
    ...(generator === undefined ? {} : { generator }),
    outcome: {
      granularity: 'leaf', cassetteId, briefSource: 'empty',
      samples: [{ sampleIndex: 0, durationMs: 10,
        outcome: { kind: 'planner-failure', reason: 'no_action_tool_called', message: 'fixture' },
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }],
      agreement: { k: 1, agreementRate: 1, noConsensus: false, harnessErrorCount: 0 },
      promptDrift: { drift: false, harnessDrift: false, recordedHash: 'same', recomputedHash: 'same' },
      replayedModel: { provider: 'fixture', modelId: 'fixture' },
      unconsumedExchanges: [], totalDurationMs: 10,
    },
    score: { kind: 'leaf', cassetteId, entry: { kind: 'decision', decisionOrdinal: 0, score: {
      kind: 'scored', matcherVersion: buildEvalReport([]).matcherVersion,
      axes: {
        elementIdentity: { kind: 'scored', level: 'full', numeric: 1, tier: 2 },
        opClass: { kind: 'match', opClass: 'activate' }, value: { kind: 'not-applicable' },
      }, sideEffect: { kind: 'none' }, loop: { kind: 'none' }, tierReached: 2,
    } } },
  }
}

/** The persisted bytes of a report, read back exactly as a later process would see them. */
function persisted(root: string, report: EvalBatchReport): unknown {
  new FsReportStore({ root }).save(report)
  const file = join(root, 'eval', 'reports', `${slugBranch(report.batchKey)}.json`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

describe('422 stored adversarial generation mix — the strict read boundary', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eval-local-adversarial-report-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('round-trips the mix beside unchanged per-split denominators', () => {
    const report = buildEvalReport([
      scoredEntry('adv-1', tableGenerator()),
      scoredEntry('adv-2', tableGenerator({ mutator: 'invisible' })),
    ])
    expect(report.adversarialGenerationMix).toBeDefined()

    const store = new FsReportStore({ root })
    store.save(report)
    const load = loadStagedReport(root, report.batchKey)
    expect(load.kind).toBe('loaded')
    const read = (load as Extract<typeof load, { kind: 'loaded' }>).report

    // The addition survives the strict reader intact...
    expect(read.adversarialGenerationMix).toEqual(report.adversarialGenerationMix)
    expect(read.adversarialGenerationMix!.byTableVersion).toEqual({ '2': 2 })
    // ...and the metrics it sits beside are the ones that were written.
    expect(read.perSplit).toEqual(report.perSplit)
    expect(read.perSplit.adversarial.perDecisionCost.decisionCount).toBe(2)
    expect(read.headline).toEqual(report.headline)
    expect(reportMetadataKind(persisted(root, report))).toBe('current')
  })

  it('reads a historical report without inventing generation metadata', () => {
    const report = buildEvalReport([scoredEntry('adv-1')])
    // No generator was resolvable, so the population is disclosed as unavailable rather than
    // stamped with a family nobody recorded.
    expect(report.adversarialGenerationMix!.metadataUnavailable).toBe(1)

    const historical = JSON.parse(JSON.stringify(persisted(root, report))) as Record<string, unknown>
    delete historical.adversarialGenerationMix
    // A pre-422 report is still a CURRENT report; the mix is optional, not a completeness marker.
    expect(reportMetadataKind(historical)).toBe('current')
    expect(historical.adversarialGenerationMix).toBeUndefined()

    // A genuinely pre-420 report stays legacy, and the fresh candidate's 422 addition is stripped
    // for the comparison exactly as the 420 additions are — otherwise the new field alone would
    // make every legacy report stop reproducing from its own retained records.
    const legacy = JSON.parse(JSON.stringify(historical)) as Record<string, unknown>
    delete legacy.calibration
    delete legacy.perSplit
    delete (legacy.headline as Record<string, unknown>).verifierFalsePassRate
    for (const key of ['weightSum', 'pairsWithoutWeight', 'weightedAccuracy']) {
      delete (legacy.recovery as Record<string, unknown>)[key]
    }
    expect(reportMetadataKind(legacy)).toBe('legacy')
    expect(legacyReportComparison(report)).not.toHaveProperty('adversarialGenerationMix')
    expect(JSON.stringify(legacyReportComparison(report))).toBe(JSON.stringify(legacy))
  })

  it('refuses a stored mix carrying an impossible count or an unknown generator word', () => {
    const report = buildEvalReport([scoredEntry('adv-1', tableGenerator())])
    const bytes = persisted(root, report) as Record<string, unknown>
    expect(reportMetadataKind(bytes)).toBe('current')

    const withMix = (mutate: (mix: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(bytes)) as Record<string, unknown>
      mutate(copy.adversarialGenerationMix as Record<string, unknown>)
      return copy
    }

    expect(reportMetadataKind(withMix(mix => { mix.total = -1 }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => { mix.total = 1.5 }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => { mix.metadataUnavailable = -1 }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => {
      (mix.byMutator as Record<string, number>)['not-a-family'] = 1
    }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => {
      (mix.byKind as Record<string, number>)['not-a-kind'] = 1
    }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => {
      (mix.byProvenance as Record<string, number>)['not-a-provenance'] = 1
    }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => {
      (mix.byTableVersion as Record<string, number>)['2'] = -3
    }))).toBe('invalid')
    expect(reportMetadataKind(withMix(mix => { mix.byAuthoringModel = 'anthropic' }))).toBe('invalid')
    // A mix that arrives WITHOUT the rest of the current shape is not evidence of a legacy report.
    expect(reportMetadataKind({ adversarialGenerationMix: bytes.adversarialGenerationMix })).toBe('invalid')
  })

  it('refuses the stored report on disk when its mix is malformed', () => {
    const report = buildEvalReport([scoredEntry('adv-1', tableGenerator())])
    const store = new FsReportStore({ root })
    store.save(report)
    const file = join(root, 'eval', 'reports', `${slugBranch(report.batchKey)}.json`)
    const bytes = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    ;(bytes.adversarialGenerationMix as Record<string, unknown>).total = -1
    writeFileSync(file, `${JSON.stringify(bytes, null, 2)}\n`)

    const load = loadStagedReport(root, report.batchKey)
    expect(load.kind).toBe('refused')
    expect((load as Extract<typeof load, { kind: 'refused' }>).reason)
      .toContain('report label metadata incomplete or malformed')
  })
})
