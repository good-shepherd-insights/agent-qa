// Read-only recovery of complete floor runs. Never rewrites their reports, sidecars or records.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { canonicalJson, computeBatchKey } from '@vostride/agent-qa-eval'
import type { FloorRunInput, StandaloneLabelRecord, ScoringJudgeRequest, CorpusEntry, EvalBatchReport } from '@vostride/agent-qa-eval'
import { slugBranch } from '@vostride/agent-qa-schema'

import { assembleScoredBatch, projectAssembledBatch } from './replay-batch-assembly.js'
import { listReplayRecordDirs, loadReplayRecord, loadScoreRecord } from './replay-read.js'
import { loadStagedReport } from './report-store.js'
import { reportMetadataKind, legacyReportComparison } from './report-metadata-guard.js'

interface MeasuredCostReceipt {
  index: number
  seed: number
  decisions: number
  modelCalls: number
  promptTokens: number
  completionTokens: number
  wallClockMs: number
  seedHonored: boolean
  samplesMissingTokenUsage: number
  judgeOutcomesMissingUsage: number
  line: string
}

/** Cost observations come from the exact retained progress log, never sample-count inference. */
export function readMeasuredCostReceipts(path: string, runSeeds: readonly number[]): MeasuredCostReceipt[] {
  const receipts = new Map<number, MeasuredCostReceipt>()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('floor r')) continue
    const match = /^floor r(\d+) seed=(-?\d+): decisions=(\d+) modelCalls=(\d+) promptTokens=(\d+) completionTokens=(\d+) wallClock=(\d+)ms seedHonored=(true|false)(?: samplesMissingTokenUsage=(\d+) judgeOutcomesMissingUsage=(\d+))?$/.exec(line)
    if (match === null) throw new TypeError(`measured floor cost receipt malformed at ${path}`)
    const numbers = [1, 2, 3, 4, 5, 6, 7, 9, 10].map(i => Number(match[i] ?? 0))
    if (!numbers.every(Number.isSafeInteger)) throw new TypeError(`measured floor cost receipt exceeds safe integers at ${path}`)
    const [index, seed, decisions, modelCalls, promptTokens, completionTokens, wallClockMs,
      samplesMissingTokenUsage, judgeOutcomesMissingUsage] = numbers as [number, number, number, number, number, number, number, number, number]
    if (receipts.has(index)) throw new TypeError(`duplicate measured floor receipt r${index} at ${path}`)
    if (runSeeds[index] !== seed) throw new TypeError(`foreign measured floor receipt r${index} seed=${seed} at ${path}`)
    receipts.set(index, { index, seed, decisions, modelCalls, promptTokens, completionTokens, wallClockMs,
      samplesMissingTokenUsage, judgeOutcomesMissingUsage, seedHonored: match[8] === 'true', line })
  }
  if (receipts.size !== runSeeds.length) throw new TypeError(`incomplete measured floor cost receipts at ${path}`)
  return runSeeds.map((_, index) => receipts.get(index)!)
}

export function readMeasuredFloorRun(input: {
  agentQaRoot: string
  runRoot: string
  cassettesRoot: string
  fingerprint: string
  corpusDigest: string
  plannerModelId: string
  matcherVersion: number
  productByCassetteId: ReadonlyMap<string, string>
  labelRecords?: ReadonlyMap<string, StandaloneLabelRecord>
  corpusEntriesById?: ReadonlyMap<string, CorpusEntry>
  excludedLabelIds?: ReadonlySet<string>
  calibration?: EvalBatchReport['calibration']
  expectedJudgeRequest?: ScoringJudgeRequest
  receipt: MeasuredCostReceipt
}): FloorRunInput {
  const { receipt, productByCassetteId } = input
  function refuse(reason: string): never { throw new TypeError(`measured floor r${receipt.index}: ${reason}`) }
  const replaysRoot = join(input.runRoot, 'replays')
  const recordDirs = listReplayRecordDirs(replaysRoot)
  if (recordDirs.length !== productByCassetteId.size) refuse('incomplete replay membership')
  const seen = new Set<string>()
  for (const dir of recordDirs) {
    const loaded = loadReplayRecord(dir)
    if (loaded.kind !== 'loaded') refuse(`unreadable replay at ${dir}`)
    const outcome = loaded.outcome
    if (outcome === null || typeof outcome !== 'object' || typeof outcome.cassetteId !== 'string') {
      refuse(`malformed replay identity at ${dir}`)
    }
    const id = outcome.cassetteId
    if (!productByCassetteId.has(id) || seen.has(id)) refuse(`foreign or duplicate replay ${id}`)
    seen.add(id)
    if (dir !== join(replaysRoot, ...id.split('/').map(segment => slugBranch(segment)))) {
      refuse(`replay identity does not match its path at ${dir}`)
    }
    const score = loadScoreRecord(dir)
    if ('granularity' in outcome) {
      const decisions = outcome.granularity === 'leaf' ? [outcome]
        : outcome.granularity === 'procedure' && Array.isArray(outcome.steps)
          ? outcome.steps.flatMap(step => step.kind === 'decision' ? [step.result] : []) : refuse(`malformed replay ${id}`)
      for (const decision of decisions) {
        if (decision.replayedModel?.modelId !== input.plannerModelId ||
          decision.agreement?.k !== 1 || !Array.isArray(decision.samples) || decision.samples.length !== 1) {
          refuse(`replay model or k=1 protocol differs for ${id}`)
        }
      }
      if (score.kind !== 'loaded' || score.record.cassetteId !== id ||
        score.record.matcherVersion !== input.matcherVersion || score.record.score.cassetteId !== id) {
        refuse(`missing or mismatched score for ${id}`)
      }
    } else if (outcome.kind !== 'integrity-refusal' || score.kind !== 'absent') {
      refuse(`malformed refusal or unexpected score for ${id}`)
    }
  }
  const batchKey = computeBatchKey([...productByCassetteId.keys()])
  const saved = loadStagedReport(input.agentQaRoot, batchKey, join(input.runRoot, 'reports'))
  if (saved.kind !== 'loaded') refuse(`saved report ${saved.kind}: ${saved.file}`)
  if (saved.decisions === undefined) refuse('saved decision sidecar absent')
  const runIdentity = { fingerprint: input.fingerprint, corpusDigest: input.corpusDigest }
  if (canonicalJson(saved.report.runIdentity) !== canonicalJson(runIdentity) ||
    saved.report.matcherVersion !== input.matcherVersion) refuse('saved report identity differs')
  const assemble = (products?: ReadonlyMap<string, string>) => {
    const batch = assembleScoredBatch({ replaysRoot, cassettesRoot: input.cassettesRoot,
      source: 'committed', recordDirs, productByCassetteId: products, expectedJudgeRequest: input.expectedJudgeRequest,
      labelRecords: input.labelRecords, excludedLabelIds: input.excludedLabelIds,
      calibration: input.calibration,
      ...(products === undefined ? {} : { corpusEntriesById: input.corpusEntriesById,
        eligibleCassetteIds: new Set(products.keys()) }) })
    if (batch.missingBundleCount !== 0 || batch.notices.length !== 0) refuse('cassette or score read refused')
    return projectAssembledBatch(batch, { declaredSeed: receipt.seed, runIdentity })
  }
  // Both current committed ownership and the historical scope join are recognized. Every
  // other field must reproduce exactly from retained records before any in-memory correction.
  const corrected = assemble(productByCassetteId)
  const legacy = reportMetadataKind(saved.report) === 'legacy'
  const matches = (candidate: typeof corrected) =>
    canonicalJson(legacy ? legacyReportComparison(candidate.report) : candidate.report) === canonicalJson(saved.report) &&
    canonicalJson(candidate.vectors) === canonicalJson(saved.decisions!.vectors)
  if (!matches(corrected) && (!legacy || !matches(assemble()))) refuse('saved report/decisions do not reproduce from complete records')
  const report = legacy ? saved.report : corrected.report
  const { vectors } = corrected
  const cost = report.totalCost
  const judge = report.honesty.judge.cost
  if (receipt.decisions !== vectors.length || receipt.seedHonored !== report.seedHonored ||
    receipt.promptTokens !== cost.promptTokens + judge.inputTokens ||
    receipt.completionTokens !== cost.completionTokens + judge.outputTokens ||
    receipt.samplesMissingTokenUsage !== cost.samplesMissingTokenUsage ||
    receipt.judgeOutcomesMissingUsage !== judge.outcomesMissingUsage ||
    receipt.modelCalls < cost.sampleCount + judge.calls) refuse('cost receipt differs from saved report evidence')
  return { index: receipt.index, seed: receipt.seed, report, vectors,
    wallClockMs: receipt.wallClockMs, modelCalls: receipt.modelCalls }
}
