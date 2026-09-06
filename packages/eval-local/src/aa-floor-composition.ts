// The ONE whole-corpus run composition in 415: the floor calls it for each repeat and the
// release gate calls it once. Reports and decisions stay in caller-owned local run roots.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  composeBaselineProfileKey,
  computeCorpusDigest,
  FLOOR_PROTOCOL_MINIMUM,
  foldNoiseFloorArtefact,
  guardBaselinePointer,
  projectDecisionVectorsDocument,
} from '@vostride/agent-qa-eval'
import type {
  DecisionCorrectnessVector,
  EvalBatchReport,
  ClassifierRepeatability,
  FloorRunInput,
  FloorSplit,
  FoldNoiseFloorInput,
  NoiseFloorArtefact,
} from '@vostride/agent-qa-eval'
import type { ModelProfile, ModelProviderOverrides, ResolvedModelAuth } from '@vostride/agent-qa-model'
import { slugBranch } from '@vostride/agent-qa-schema'

import {
  listBaselinePointers,
  listCommittedReports,
  readCommittedCorpus,
  readPartitionManifests,
} from './committed-corpus-source.js'
import type { CommittedReadRefusal } from './committed-corpus-source.js'
import { committedCorpusAdmissionRefusal } from './committed-corpus-admission.js'
import { writeNoiseFloorArtefact } from './noise-floor-writer.js'
import type { WriteNoiseFloorArtefactOutcome } from './noise-floor-writer.js'
import { readMeasuredCostReceipts, readMeasuredFloorRun } from './measured-floor-read.js'

import { assembleScoredBatch, projectAssembledBatch } from './replay-batch-assembly.js'
import { computeReplayProfileFingerprintFor } from './replay-composition.js'
import type { RunCassetteReplayInput } from './replay-composition.js'
import { FsReplayRecordStore } from './replay-record-store.js'
import { loadCassetteBundles, sweepCassetteReplays } from './replay-sweep.js'
import type { LoadedCassetteBundle, SweepCassetteReplaysResult } from './replay-sweep.js'
import { FsReportStore } from './report-store.js'
import { FsScoreStore } from './score-store.js'

export interface ReplayCorpusOnceInput {
  selected: readonly LoadedCassetteBundle[]
  /** Bundle-load refusals excluded from selected; never include returned replay refusals. */
  loadRefusals?: Readonly<Partial<EvalBatchReport['honesty']['refusalCounts']>>
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
  productByCassetteId?: ReadonlyMap<string, string>
  clock?: () => number
  onProgress?: (cassetteId: string) => void
}

export interface RunNoiseFloorMeasurementInput {
  committedRoot: string
  cassettesRoot: string
  agentQaRoot: string
  profile: ModelProfile
  auth?: ResolvedModelAuth
  /** Explicit read-only recovery from complete saved runs and the original cost log. */
  fromMeasured?: string
  modelOverrides?: ModelProviderOverrides
  judge?: RunCassetteReplayInput['judge']
  maskingContextFactory: RunCassetteReplayInput['maskingContextFactory']
  profileKeyInputs: {
    plannerModelId: string
    matcherVersion: number
    judgeModelId?: string
    judgeVersion?: number
  }
  seeds: readonly number[]
  repeats: number
  bootstrapSeed: number
  classifierRepeatability?: ClassifierRepeatability
  explanation?: string
  commit: boolean
  reportOutputBaseDir: string
  clock?: () => number
  onProgress?: (line: string) => void
}

export interface RunNoiseFloorMeasurementResult {
  artefact: NoiseFloorArtefact
  profileKey: string
  fingerprint: string
  runRoots: readonly string[]
  committed?: WriteNoiseFloorArtefactOutcome
  notices: string[]
  refusals: readonly CommittedReadRefusal[]
  /** Calls in this invocation, separate from the original observations retained in artefact.cost. */
  recovery?: { costLog: string; modelCalls: 0 }
}

export class FloorProtocolError extends Error {
  readonly code = 'FLOOR_PROTOCOL_MINIMUM'

  constructor() {
    super(`FLOOR_PROTOCOL_MINIMUM: require at least ${FLOOR_PROTOCOL_MINIMUM.repeats} ` +
      `whole-corpus repeats and ${FLOOR_PROTOCOL_MINIMUM.seeds} distinct integer seeds`)
    this.name = 'FloorProtocolError'
  }
}

/** Whole-corpus repetitions, then the pure floor fold and the existing write-once checkpoint. */
export async function runNoiseFloorMeasurement(
  input: RunNoiseFloorMeasurementInput,
): Promise<RunNoiseFloorMeasurementResult> {
  const seeds = [...new Set(input.seeds)]
  if (!Number.isSafeInteger(input.repeats) || input.repeats < FLOOR_PROTOCOL_MINIMUM.repeats ||
    seeds.length < FLOOR_PROTOCOL_MINIMUM.seeds || !seeds.every(Number.isSafeInteger)) {
    throw new FloorProtocolError()
  }
  const fingerprint = computeReplayProfileFingerprintFor({
    profile: input.profile, modelOverrides: input.modelOverrides, seedPolicy: 'declared',
  })
  const profileKey = composeBaselineProfileKey({ ...input.profileKeyInputs, fingerprint })
  const corpus = readCommittedCorpus(input.committedRoot)
  const partitions = readPartitionManifests(input.committedRoot)
  const notices = [...corpus.notices, ...partitions.notices]
  const refusals = [...corpus.refusals, ...partitions.refusals]
  const corpusDigest = computeCorpusDigest(corpus.snapshot.entries)
  const productByCassetteId = new Map(corpus.snapshot.entries.map(entry => [entry.cassetteId, entry.product]))
  const partitionVersions = [...new Set(partitions.manifests.map(manifest => manifest.partitionVersion))]
  const partitionVersion = partitionVersions.length === 1 ? partitionVersions[0]! : 1
  if (partitionVersions.length !== 1) {
    notices.push('partition manifests have no common version; using partitionVersion 1')
  }
  const splitByCassetteId = new Map<string, FloorSplit>()
  const census = new Map<string, { natural: number; heldOutShared: number; heldOutPrivate: number }>()
  for (const entry of corpus.snapshot.entries) {
    let counts = census.get(entry.product)
    if (counts === undefined) {
      counts = { natural: 0, heldOutShared: 0, heldOutPrivate: 0 }
      census.set(entry.product, counts)
    }
    if (entry.split === 'natural') {
      counts.natural++
      splitByCassetteId.set(entry.cassetteId, 'natural')
    } else if (entry.split === 'held-out') {
      if (entry.heldOutVisibility === 'shared') {
        counts.heldOutShared++
        splitByCassetteId.set(entry.cassetteId, 'held-out-shared')
      } else {
        counts.heldOutPrivate++
        splitByCassetteId.set(entry.cassetteId, 'held-out-private')
      }
    }
  }
  const baselineRate = readDesignatedBaselineRate(input, notices, refusals)
  const loaded = loadCassetteBundles(input.cassettesRoot)
  const admission = committedCorpusAdmissionRefusal(input.committedRoot, corpus, loaded)
    ?? partitions.refusals[0]
  if (admission !== undefined) {
    throw new TypeError(`floor requires the complete guarded committed corpus: ${admission.path}: ${admission.reason}`)
  }
  for (const [reason, count] of Object.entries(loaded.loadRefusals)) {
    notices.push(`cassette bundle load refused: ${reason}=${count}`)
  }
  const selected = loaded.loaded.sort((a, b) =>
    a.cassette.id < b.cassette.id ? -1 : a.cassette.id > b.cassette.id ? 1 : 0)
  const runSeeds = [...Array<number>(input.repeats).fill(seeds[0]!), ...seeds.slice(1)]
  const receipts = input.fromMeasured === undefined ? undefined : readMeasuredCostReceipts(input.fromMeasured, runSeeds)
  if (receipts !== undefined && refusals.length !== 0) {
    throw new TypeError('measured floor recovery requires the complete guarded committed corpus')
  }
  const runs: FloorRunInput[] = []
  const runRoots: string[] = []
  for (const [index, seed] of runSeeds.entries()) {
    const runRoot = join(input.agentQaRoot, 'eval', 'floor', slugBranch(profileKey), `r${index}-seed${seed}`)
    runRoots.push(runRoot)
    if (receipts !== undefined) {
      const receipt = receipts[index]!
      runs.push(readMeasuredFloorRun({ agentQaRoot: input.agentQaRoot, runRoot,
        cassettesRoot: input.cassettesRoot, fingerprint, corpusDigest,
        plannerModelId: input.profileKeyInputs.plannerModelId,
        matcherVersion: input.profileKeyInputs.matcherVersion, productByCassetteId, receipt }))
      input.onProgress?.(receipt.line)
      continue
    }
    if (input.auth === undefined) throw new TypeError('fresh floor measurement requires resolved model auth')
    const run = await replayCorpusOnce({
      selected,
      loadRefusals: loaded.loadRefusals,
      cassettesRoot: input.cassettesRoot,
      agentQaRoot: input.agentQaRoot,
      runRoot,
      profile: input.profile,
      auth: input.auth,
      modelOverrides: input.modelOverrides,
      judge: input.judge,
      maskingContextFactory: input.maskingContextFactory,
      seed,
      k: 1,
      replayOutputBaseDir: join(input.reportOutputBaseDir, `r${index}`),
      source: 'committed',
      corpusDigest,
      productByCassetteId,
      clock: input.clock,
      onProgress: input.onProgress,
    })
    runs.push({ index, seed, report: run.report, vectors: run.vectors,
      wallClockMs: run.wallClockMs, modelCalls: run.modelCalls })
    notices.push(...run.notices)
    const cost = run.report.totalCost
    const judgeCost = run.report.honesty.judge.cost
    const missingUsage = cost.samplesMissingTokenUsage > 0 || judgeCost.outcomesMissingUsage > 0
      ? ` samplesMissingTokenUsage=${cost.samplesMissingTokenUsage} judgeOutcomesMissingUsage=${judgeCost.outcomesMissingUsage}`
      : ''
    input.onProgress?.(`floor r${index} seed=${seed}: decisions=${run.vectors.length} ` +
      `modelCalls=${run.modelCalls} promptTokens=${cost.promptTokens + judgeCost.inputTokens} ` +
      `completionTokens=${cost.completionTokens + judgeCost.outputTokens} ` +
      `wallClock=${run.wallClockMs}ms seedHonored=${run.report.seedHonored}${missingUsage}`)
  }
  const artefact = foldNoiseFloorArtefact({
    profile: { profileKey, fingerprint, ...input.profileKeyInputs },
    corpusDigest, partitionVersion, seeds, repeats: input.repeats, bootstrapSeed: input.bootstrapSeed,
    runs, splitByCassetteId, censusByProduct: Object.fromEntries(census),
    ...(baselineRate === undefined ? {} : { baselineRate }),
    ...(input.classifierRepeatability === undefined ? {} : { classifierRepeatability: input.classifierRepeatability }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
  })
  return {
    artefact, profileKey, fingerprint, runRoots, notices, refusals,
    ...(input.fromMeasured === undefined ? {} : { recovery: { costLog: input.fromMeasured, modelCalls: 0 } as const }),
    ...(input.commit ? { committed: writeNoiseFloorArtefact({
      artefact, committedRoot: input.committedRoot, reportOutputBaseDir: input.reportOutputBaseDir,
    }) } : {}),
  }
}

/** Read actual pointer bodies: the census listing deliberately projects only index fields. */
function readDesignatedBaselineRate(
  input: RunNoiseFloorMeasurementInput,
  notices: string[],
  refusals: CommittedReadRefusal[],
): FoldNoiseFloorInput['baselineRate'] {
  const pointers = listBaselinePointers(input.committedRoot)
  const reports = listCommittedReports(input.committedRoot)
  refusals.push(...pointers.refusals, ...reports.refusals)
  for (const entry of pointers.pointers) {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(entry.path, 'utf8'))
    } catch (error) {
      refusals.push({ path: entry.path, reason: `baseline pointer unreadable: ${String(error)}` })
      continue
    }
    const guarded = guardBaselinePointer(value)
    if (guarded.kind === 'rejected') {
      refusals.push({ path: entry.path, reason: guarded.reason })
      continue
    }
    const pointer = guarded.pointer
    if (pointer.plannerModelId !== input.profileKeyInputs.plannerModelId) continue
    const found = reports.reports.find(report => report.batchKey === pointer.batchKey)
    if (found === undefined) {
      notices.push(`designated baseline report absent for ${pointer.batchKey}`)
      continue
    }
    if (found.report.batchKey !== pointer.batchKey) {
      refusals.push({ path: found.path, reason: 'report body batchKey does not match designated baseline directory' })
      continue
    }
    const rate = found.report.headline.firstAttemptDecisionAccuracy
    if (rate === undefined || !Number.isSafeInteger(rate.numerator) || !Number.isSafeInteger(rate.denominator) ||
      rate.numerator < 0 || rate.denominator < rate.numerator) {
      refusals.push({ path: found.path, reason: 'baseline decision accuracy counts are invalid' })
      continue
    }
    return { correct: rate.numerator, n: rate.denominator, batchKey: pointer.batchKey }
  }
  notices.push('no usable designated baseline for this planner; minimum gate set uses reference-run rate')
  return undefined
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
  const batch = assembleScoredBatch({
    replaysRoot,
    cassettesRoot: input.cassettesRoot,
    source: input.source,
    recordDirs: sweep.recordedDirs,
    productByCassetteId: input.productByCassetteId,
  })
  const { report, vectors, notices } = projectAssembledBatch(batch, {
    declaredSeed: input.seed,
    additionalHarnessErrorCount: sweep.replayRefusals['harness-error'] ?? 0,
    ...(input.loadRefusals === undefined ? {} : { additionalRefusalCounts: input.loadRefusals }),
    ...(runIdentity === undefined ? {} : { runIdentity }),
  })
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
