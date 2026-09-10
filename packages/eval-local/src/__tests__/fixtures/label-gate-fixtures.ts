import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildEvalReport, computeBatchKey, projectBaselinePointer } from '@vostride/agent-qa-eval'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { expect } from 'vitest'
import * as local from '../../index.js'
import { incrementingClock, noneAuth, stubProfile, warningStub, writeCommittedFloorFixture } from './floor-fixtures.js'

/** Real committed reports, vectors, pointer and measured floor; model work is simulated. */
export async function labelGateFixture(root: string) {
  const original = writeCommittedFloorFixture(root)
  const committedRoot = join(root, 'agent-qa-eval')
  renameSync(original.committedRoot, committedRoot)
  const corpus = { ...original, committedRoot, cassettesRoot: join(committedRoot, 'cassettes') }
  const stub = warningStub(), profile = stubProfile(), agentQaRoot = join(root, '.agent-qa')
  const profileKeyInputs = { plannerModelId: profile.model, matcherVersion: buildEvalReport([]).matcherVersion }
  const mode = { kind: 'fresh' as const, profile, auth: noneAuth,
    modelOverrides: { languageModels: stub.languageModels }, maskingContextFactory: createMaskingContext,
    seed: 11, cassettesRoot: corpus.cassettesRoot, replayOutputBaseDir: join(root, 'audit') }
  const floor = await local.runNoiseFloorMeasurement({ ...mode, committedRoot, agentQaRoot,
    profileKeyInputs, seeds: [11, 29], repeats: 3, bootstrapSeed: 97, commit: true,
    reportOutputBaseDir: mode.replayOutputBaseDir, clock: incrementingClock() })
  expect(floor.committed?.kind).toBe('written')
  const batchKey = computeBatchKey(corpus.selected.map(entry => entry.cassette.id))
  const stagedOutputDir = join(floor.runRoots[0]!, 'reports')
  const baseline = local.loadStagedReport(agentQaRoot, batchKey, stagedOutputDir)
  if (baseline.kind !== 'loaded' || baseline.decisions === undefined) throw new Error('expected fixture baseline')
  expect(local.commitEvalReport({ report: baseline.report, decisions: baseline.decisions,
    markdown: '# Fixture baseline\n', committedRoot, reportOutputBaseDir: mode.replayOutputBaseDir }).kind).toBe('committed')
  const pointer = projectBaselinePointer({ ...profileKeyInputs, batchKey,
    fingerprint: floor.fingerprint, corpusDigest: floor.artefact.corpusDigest })
  expect(local.writeBaselinePointer({ report: baseline.report, pointer, committedRoot,
    reportOutputBaseDir: mode.replayOutputBaseDir }).kind).toBe('written')
  stub.captured.length = 0
  return { root, corpus, stub, floor, pointer, baseline, stagedOutputDir,
    input: { committedRoot, agentQaRoot, profileKeyInputs, mode, clock: incrementingClock() },
    pointerFile: join(committedRoot, local.committedBaselinePointerPath(floor.profileKey)),
    baselineFile: join(committedRoot, local.committedReportPath(batchKey, 'report.json')) }
}

export function rewriteReport(file: string, change: (report: any) => void) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  change(report)
  writeFileSync(file, JSON.stringify(report))
}

export function legacyReport(report: any) {
  delete report.calibration
  delete report.perSplit
  delete report.headline.verifierFalsePassRate
  delete report.recovery.weightSum
  delete report.recovery.pairsWithoutWeight
  delete report.recovery.weightedAccuracy
}

export function measuredReport(report: any, rate: number) {
  const metric = { numerator: rate * 4, denominator: 4, rate }
  report.headline.verifierFalsePassRate = metric
  report.recovery = { ...report.recovery, recoveredPositiveCount: rate * 4,
    eligiblePositiveCount: 4, recoveryAccuracy: rate, weightSum: 2, weightedAccuracy: rate }
  for (const cell of [report.perSplit.natural, report.perSplit['held-out'].shared,
    report.perSplit['held-out'].private, report.perSplit.adversarial]) cell.firstAttemptDecisionAccuracy = metric
  report.calibration = { status: 'calibrated', n_gold: 20,
    verifierFalsePassRate: { numerator: 1, denominator: 20, rate: 0.05 } }
}

export const labelMetricIds = ['verifierFalsePassRate', 'recovery.raw', 'recovery.weighted',
  'perDecisionCost.promptTokens', 'perDecisionCost.completionTokens', 'perDecisionCost.totalTokens',
  'perDecisionCost.durationMs', 'perSplit.natural', 'perSplit.held-out.shared',
  'perSplit.held-out.private', 'perSplit.adversarial']
