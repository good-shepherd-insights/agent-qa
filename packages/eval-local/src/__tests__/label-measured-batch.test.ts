import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { computeCorpusDigest } from '@vostride/agent-qa-eval'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { sha256hex } from '@vostride/agent-qa-schema'
import { replayCorpusOnce } from '../aa-floor-composition.js'
import { readCommittedCorpus, listCommittedReports } from '../committed-corpus-source.js'
import { readMeasuredFloorRun } from '../measured-floor-read.js'
import { loadStagedReport } from '../report-store.js'
import { writeCommittedFloorFixture, warningStub, stubProfile, noneAuth, incrementingClock } from './fixtures/floor-fixtures.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-measured-label-')); roots.push(root)
  const corpus = writeCommittedFloorFixture(root)
  const read = readCommittedCorpus(corpus.committedRoot)
  const entries = new Map(read.snapshot.entries.map(entry => [entry.cassetteId, entry]))
  const stub = warningStub()
  const input = { ...corpus, agentQaRoot: root, runRoot: join(root, 'r0'),
    profile: stubProfile(), auth: noneAuth, modelOverrides: { languageModels: stub.languageModels },
    maskingContextFactory: createMaskingContext, seed: 11, replayOutputBaseDir: join(root, 'audit'),
    source: 'committed', clock: incrementingClock(), corpusDigest: computeCorpusDigest(read.snapshot.entries),
    productByCassetteId: new Map(read.snapshot.entries.map(entry => [entry.cassetteId, entry.product])),
    corpusEntriesById: entries, excludedLabelIds: new Set<string>(),
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
})
