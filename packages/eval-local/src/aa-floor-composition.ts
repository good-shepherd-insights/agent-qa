// The ONE whole-corpus run composition in 415: the floor calls it for each repeat and the
// release gate calls it once. Reports and decisions stay in caller-owned local run roots.
import { join } from 'node:path'

import {
  buildEvalReport,
  canonicalJson,
  decisionCorrectnessVectors,
  projectDecisionVectorsDocument,
} from '@vostride/agent-qa-eval'
import type {
  DecisionCorrectnessVector,
  EvalBatchReport,
  JudgeIdentityBlock,
} from '@vostride/agent-qa-eval'
import type { ModelProfile, ModelProviderOverrides, ResolvedModelAuth } from '@vostride/agent-qa-model'

import { assembleScoredBatch } from './replay-batch-assembly.js'
import { computeReplayProfileFingerprintFor } from './replay-composition.js'
import type { RunCassetteReplayInput } from './replay-composition.js'
import { FsReplayRecordStore } from './replay-record-store.js'
import { sweepCassetteReplays } from './replay-sweep.js'
import type { LoadedCassetteBundle, SweepCassetteReplaysResult } from './replay-sweep.js'
import { FsReportStore } from './report-store.js'
import { FsScoreStore } from './score-store.js'

export interface ReplayCorpusOnceInput {
  selected: readonly LoadedCassetteBundle[]
  cassettesRoot: string
  agentQaRoot: string
  runRoot: string
  profile: ModelProfile
  auth: ResolvedModelAuth
  modelOverrides?: ModelProviderOverrides
  judge?: RunCassetteReplayInput['judge']
  maskingContextFactory: RunCassetteReplayInput['maskingContextFactory']
  seed: number
  k?: number
  replayOutputBaseDir: string
  source: string
  /** Digest of the committed snapshot supplying this run, when the caller read one. */
  corpusDigest?: string
  clock?: () => number
  onProgress?: (cassetteId: string) => void
}

export interface ReplayCorpusOnceResult {
  report: EvalBatchReport
  vectors: DecisionCorrectnessVector[]
  replaysRoot: string
  reportFile: string
  decisionsFile: string
  sweep: SweepCassetteReplaysResult
  wallClockMs: number
  modelCalls: number
  notices: string[]
}

export async function replayCorpusOnce(
  input: ReplayCorpusOnceInput,
): Promise<ReplayCorpusOnceResult> {
  const replaysRoot = join(input.runRoot, 'replays')
  const recordStore = new FsReplayRecordStore({ root: input.agentQaRoot, outputDir: replaysRoot })
  const scoreStore = new FsScoreStore({ root: input.agentQaRoot, outputDir: replaysRoot })
  const clock = input.clock ?? Date.now
  // Capture before replay begins: model creation may resolve capabilities on its own copy.
  const runIdentity = input.corpusDigest === undefined ? undefined : {
    fingerprint: computeReplayProfileFingerprintFor({
      profile: input.profile, modelOverrides: input.modelOverrides, seedPolicy: 'declared',
    }),
    corpusDigest: input.corpusDigest,
  }
  let modelCalls = 0
  const started = clock()
  const sweep = await sweepCassetteReplays({
    selected: input.selected,
    profile: input.profile,
    auth: input.auth,
    modelOverrides: input.modelOverrides,
    modelCallObservation: { onProviderCall: () => { modelCalls++ } },
    ...(input.clock === undefined ? {} : { clock: { now: input.clock } }),
    k: input.k ?? 1,
    seed: input.seed,
    judge: input.judge,
    maskingContextFactory: input.maskingContextFactory,
    replayOutputBaseDir: input.replayOutputBaseDir,
    recordStore,
    scoreStore,
    replaysRoot,
    onProgress: input.onProgress,
  })
  const wallClockMs = clock() - started
  // A new store does not empty a directory. Only completed writes from THIS sweep may enter
  // its report, including typed refusals; stale and partially written failed records stay out.
  const { entries, judgeBlocks, partitionsById, notices } = assembleScoredBatch({
    replaysRoot,
    cassettesRoot: input.cassettesRoot,
    source: input.source,
    recordDirs: sweep.recordedDirs,
  })
  entries.sort((a, b) => a.cassetteId < b.cassetteId ? -1 : a.cassetteId > b.cassetteId ? 1 : 0)
  let judge: JudgeIdentityBlock | undefined
  let identity: { judgeIdentity: 'mixed'; judgeModelIds: readonly string[] } | undefined
  if (judgeBlocks.length === 0) {
    notices.push('no judge identity on any persisted score record — the report carries no judge block')
  } else if (judgeBlocks.every(block => canonicalJson(block) === canonicalJson(judgeBlocks[0]))) {
    judge = judgeBlocks[0]
  } else {
    identity = {
      judgeIdentity: 'mixed',
      judgeModelIds: [...new Set(judgeBlocks.map(block => block.judgeModelId))].sort(),
    }
    notices.push('mixed judge identities across persisted score records — the report carries no judge block')
  }
  const report = buildEvalReport(entries, judge, identity, {
    declaredSeed: input.seed,
    additionalHarnessErrorCount: sweep.replayRefusals['harness-error'] ?? 0,
    ...(runIdentity === undefined ? {} : { runIdentity }),
  })
  const vectors = decisionCorrectnessVectors(entries, partitionsById)
  const staged = new FsReportStore({
    root: input.agentQaRoot, outputDir: join(input.runRoot, 'reports'),
  }).save(report, projectDecisionVectorsDocument({
    batchKey: report.batchKey, matcherVersion: report.matcherVersion, vectors,
  }))
  if (staged.decisionsFile === undefined) throw new Error('report store did not stage decisions')
  return {
    report, vectors, replaysRoot, reportFile: staged.file, decisionsFile: staged.decisionsFile,
    sweep, wallClockMs, modelCalls, notices: [...sweep.notices, ...notices],
  }
}
