import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { computeCorpusDigest, projectSilverLabelRecord } from '@vostride/agent-qa-eval'
import type { StandaloneLabelRecord } from '@vostride/agent-qa-eval'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { sha256hex } from '@vostride/agent-qa-schema'
import { replayCorpusOnce } from '../aa-floor-composition.js'
import { readCommittedCorpus, listCommittedReports } from '../committed-corpus-source.js'
import { readMeasuredFloorRun } from '../measured-floor-read.js'
import { loadStagedReport } from '../report-store.js'
import { assembleScoredBatch, projectAssembledBatch } from '../replay-batch-assembly.js'
import { writeCommittedFloorFixture, warningStub, stubProfile, noneAuth, incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture(withLabels = false) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-measured-label-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root)
  const read = readCommittedCorpus(corpus.committedRoot)
  const entries = new Map(read.snapshot.entries.map(entry => [entry.cassetteId, entry]))
  const stub = warningStub()
  const labelRecords = new Map<string, StandaloneLabelRecord>()
  if (withLabels) {
    const [positive, negative] = corpus.selected
    for (const [member, partner, relation] of [[positive!, negative!, 'contrastive-positive'],
      [negative!, positive!, 'contrastive-negative']] as const) {
      if (member.cassette.granularity !== 'leaf') throw new Error('leaf fixture')
      const label = projectSilverLabelRecord({ cassette: member.cassette, runId: member.cassette.runId })
      label.label = { ...label.label, sourceChannel: 'self-heal-pair', tier: 'near-gold',
        pairing: { relation, pairedCassetteId: partner.cassette.id } }
      labelRecords.set(label.cassetteId, label)
    }
  }
  const input = { ...corpus, agentQaRoot: root, runRoot: join(root, 'r0'),
    profile: stubProfile(), auth: noneAuth, modelOverrides: { languageModels: stub.languageModels },
    maskingContextFactory: createMaskingContext, seed: 11, replayOutputBaseDir: join(root, 'audit'),
    source: 'committed', clock: incrementingClock(), corpusDigest: computeCorpusDigest(read.snapshot.entries),
    productByCassetteId: new Map(read.snapshot.entries.map(entry => [entry.cassetteId, entry.product])),
    corpusEntriesById: entries, labelRecords,
    excludedLabelIds: new Set(withLabels ? [corpus.selected[2]!.cassette.id] : []),
    calibration: { status: 'calibrated' as const, n_gold: 20,
      verifierFalsePassRate: { numerator: 2, denominator: 20, rate: 0.1 } } }
  const run = await replayCorpusOnce(input)
  const cost = run.report.totalCost, judge = run.report.honesty.judge.cost
  const receipt = { index: 0, seed: 11, decisions: run.vectors.length, modelCalls: run.modelCalls,
    promptTokens: cost.promptTokens + judge.inputTokens, completionTokens: cost.completionTokens + judge.outputTokens,
    wallClockMs: run.wallClockMs, seedHonored: run.report.seedHonored!,
    samplesMissingTokenUsage: cost.samplesMissingTokenUsage, judgeOutcomesMissingUsage: judge.outcomesMissingUsage, line: '' }
  const reportFile = join(input.runRoot, 'reports', `${run.report.batchKey}.json`)
  const publicationFile = reportFile.replace('.json', '.publication.json')
  const recover = () => readMeasuredFloorRun({ ...input, fingerprint: run.report.runIdentity!.fingerprint,
    plannerModelId: input.profile.model, matcherVersion: run.report.matcherVersion, receipt })
  const replace = (value: unknown) => {
    const text = JSON.stringify(value)
    writeFileSync(reportFile, text)
    const publication = JSON.parse(readFileSync(publicationFile, 'utf8'))
    publication.reportDigest = sha256hex(text)
    writeFileSync(publicationFile, JSON.stringify(publication))
  }
  return { input, run, recover, replace, reportFile, publicationFile }
}
function legacy(report: unknown): any {
  const copy = structuredClone(report) as any
  delete copy.headline.verifierFalsePassRate
  delete copy.calibration
  delete copy.perSplit
  delete copy.recovery.weightSum
  delete copy.recovery.pairsWithoutWeight
  delete copy.recovery.weightedAccuracy
  return copy
}

it('fresh and recovered measured reports carry identical authoritative splits and calibration', async () => {
  const f = await fixture()
  expect(f.run.report.perSplit.unassignedCount).toBe(0)
  expect(f.run.report.perSplit.natural.firstAttemptDecisionAccuracy.denominator).toBe(1)
  expect(f.run.report.calibration).toEqual(f.input.calibration)
  expect(f.recover().report).toEqual(f.run.report)
})

it('recovers legacy reports without adding fields or changing their saved bytes', async () => {
  const f = await fixture(), old = legacy(f.run.report)
  f.replace(old)
  const before = readFileSync(f.reportFile)
  expect(f.recover().report).toEqual(old)
  expect(readFileSync(f.reportFile)).toEqual(before)
  const committed = join(f.input.committedRoot, 'reports', f.run.report.batchKey)
  mkdirSync(committed, { recursive: true })
  writeFileSync(join(committed, 'report.json'), before)
  expect(listCommittedReports(f.input.committedRoot).reports[0]!.report).toEqual(old)
})

it('keeps authoritative pair metadata and excluded incurred work through fresh and recovered runs', async () => {
  const f = await fixture(true)
  expect(f.run.report.recovery).toMatchObject({ eligiblePositiveCount: 1, weightSum: 2 / 3, pairsWithoutWeight: 1 })
  expect(f.run.report.totalCost.sampleCount).toBe(3)
  expect(f.run.vectors).toHaveLength(2)
  expect(f.recover().report).toEqual(f.run.report)
})

it('requires equality of new fields even when the publication digest is updated', async () => {
  const f = await fixture(), changed = structuredClone(f.run.report)
  changed.calibration = { status: 'uncalibrated' }
  f.replace(changed)
  expect(f.recover).toThrow('do not reproduce')
})

it('never applies the legacy scope fallback to a complete new report', async () => {
  const f = await fixture()
  const generic = projectAssembledBatch(assembleScoredBatch({
    replaysRoot: join(f.input.runRoot, 'replays'), cassettesRoot: f.input.cassettesRoot,
    source: 'committed', calibration: f.input.calibration,
  }), { declaredSeed: f.input.seed, runIdentity: f.run.report.runIdentity })
  expect(generic.report.perSplit.unassignedCount).toBe(3)
  f.replace(generic.report)
  expect(f.recover).toThrow('do not reproduce')
})

it('reads finite fractional per-decision averages without rounding them', async () => {
  const f = await fixture(), report = structuredClone(f.run.report)
  report.perSplit.natural.perDecisionCost.promptTokens = 7 / 3
  f.replace(report)
  const loaded = loadStagedReport(f.input.agentQaRoot, f.run.report.batchKey, join(f.input.runRoot, 'reports'))
  expect(loaded.kind).toBe('loaded')
  if (loaded.kind === 'loaded') expect(loaded.report.perSplit.natural.perDecisionCost.promptTokens).toBe(7 / 3)
})

it.each(['headline', 'cost', 'unknown-field'])('rejects changed historical %s even with a matching publication digest', async field => {
  const f = await fixture(), old = legacy(f.run.report)
  if (field === 'headline') old.headline.firstAttemptDecisionAccuracy.denominator++
  if (field === 'cost') old.totalCost.totalTokens++
  if (field === 'unknown-field') old.unrecognizedHistoricalField = 1
  f.replace(old)
  expect(f.recover).toThrow('do not reproduce')
})

it.each(['calibration', 'perSplit', 'weightSum', 'falsePass'])('refuses partial new metadata %s rather than treating it as legacy', async field => {
  const f = await fixture(), old = legacy(f.run.report)
  if (field === 'calibration') old.calibration = { status: 'uncalibrated' }
  if (field === 'perSplit') old.perSplit = null
  if (field === 'weightSum') old.recovery.weightSum = 0
  if (field === 'falsePass') old.headline.verifierFalsePassRate = { numerator: 0, denominator: 0 }
  f.replace(old)
  expect(f.recover).toThrow()
  expect(loadStagedReport(f.input.agentQaRoot, f.run.report.batchKey, join(f.input.runRoot, 'reports')).kind).toBe('refused')
  const committed = join(f.input.committedRoot, 'reports', f.run.report.batchKey)
  mkdirSync(committed, { recursive: true })
  writeFileSync(join(committed, 'report.json'), JSON.stringify(old))
  expect(listCommittedReports(f.input.committedRoot)).toMatchObject({ reports: [], refusals: [expect.anything()] })
})
