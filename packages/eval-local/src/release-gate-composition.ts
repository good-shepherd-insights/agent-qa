// Fresh gate replay delegates to replayCorpusOnce → sweepCassetteReplays → runCassetteReplay,
// retaining its ONE planner createModel site inside runSafetyScope and the existing judge binding.
// The gate's report and decisions are local audit artifacts, never committed. Committed evidence
// is read through guarded legs and compared by eval core; no verdict policy is reimplemented here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  composeBaselineProfileKey,
  computeCorpusDigest,
  computeGateVerdict,
  guardBaselinePointer,
  renderGateLines,
} from '@vostride/agent-qa-eval'
import type { ComputeGateVerdictInput, EvalBatchReport, GateVerdict } from '@vostride/agent-qa-eval'
import type { ModelProfile, ModelProviderOverrides, ResolvedModelAuth } from '@vostride/agent-qa-model'
import { slugBranch } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { replayCorpusOnce } from './aa-floor-composition.js'
import {
  listBaselinePointers,
  listCommittedReports,
  listNoiseFloorArtefacts,
  readActiveCommittedCorpus,
  readCommittedDecisionVectors,
} from './committed-corpus-source.js'
import type { CommittedReadRefusal } from './committed-corpus-source.js'
import { committedCorpusAdmissionRefusal } from './committed-corpus-admission.js'
import {
  committedBaselinePointerPath,
  committedNoiseFloorPath,
  committedReportPath,
} from './committed-root-store.js'
import { computeReplayProfileFingerprintFor } from './replay-composition.js'
import type { RunCassetteReplayInput } from './replay-composition.js'
import { loadCassetteBundles } from './replay-sweep.js'
import { loadStagedReport } from './report-store.js'

export type ReleaseGateMode =
  | {
      kind: 'fresh'
      profile: ModelProfile
      auth: ResolvedModelAuth
      modelOverrides?: ModelProviderOverrides
      judge?: RunCassetteReplayInput['judge']
      maskingContextFactory: RunCassetteReplayInput['maskingContextFactory']
      seed: number
      cassettesRoot: string
      replayOutputBaseDir: string
      onProgress?: (line: string) => void
    }
  | {
      kind: 'report'
      batchKey: string
      /** Exactly one report directory; the CLI owns any search order. */
      stagedOutputDir?: string
      profile: ModelProfile
      modelOverrides?: ModelProviderOverrides
    }

export interface RunReleaseGateInput {
  committedRoot: string
  agentQaRoot: string
  profileKeyInputs: {
    plannerModelId: string
    matcherVersion: number
    judgeModelId?: string
    judgeVersion?: number
  }
  mode: ReleaseGateMode
  clock?: () => number
}

export type RunReleaseGateResult =
  | {
      kind: 'verdict'
      verdict: GateVerdict
      lines: string[]
      mode: 'fresh' | 'report'
      profileKey: string
      fingerprint: string
      currentReport: EvalBatchReport
      currentReportFile: string
      /** Actual calls in this invocation, including retries and judge calls; offline is zero. */
      modelCalls: number
      /** Fresh helper replay duration, or offline read/compare duration; never historical cost. */
      wallClockMs: number
      notices: string[]
      refusals: readonly CommittedReadRefusal[]
    }
  | { kind: 'refused'; refusal: CommittedReadRefusal; notices: string[] }

const runIdentitySchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  corpusDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).passthrough()

/** Compose guarded disk evidence with eval core's single comparison law. */
export async function runReleaseGate(input: RunReleaseGateInput): Promise<RunReleaseGateResult> {
  const clock = input.clock ?? Date.now
  const started = clock()
  const { mode } = input
  // The gate always declares a seed, matching the floor's policy; seed values do not key profiles.
  const fingerprint = computeReplayProfileFingerprintFor({
    profile: mode.profile, modelOverrides: mode.modelOverrides, seedPolicy: 'declared',
  })
  const expectedProfileKey = composeBaselineProfileKey({ ...input.profileKeyInputs, fingerprint })
  const corpus = readActiveCommittedCorpus(input.committedRoot, input.agentQaRoot)
  const pointers = listBaselinePointers(input.committedRoot)
  const floors = listNoiseFloorArtefacts(input.committedRoot)
  const reports = listCommittedReports(input.committedRoot)
  const notices = [...corpus.notices]
  const refusals = [...corpus.refusals, ...pointers.refusals, ...floors.refusals, ...reports.refusals]
  const corpusDigest = computeCorpusDigest(corpus.snapshot.entries)

  // D-11: the filename IS the designation. In particular, a v1 body here must reach the
  // no-fingerprint arm; a body naming this profile at some other filename is not its pointer.
  const pointerFile = join(input.committedRoot, committedBaselinePointerPath(expectedProfileKey))
  const pointer = readPointer(pointerFile, pointers.pointers.filter(entry =>
    entry.profileKey.startsWith(`planner=${input.profileKeyInputs.plannerModelId}|`)), refusals)
  const floorFile = join(input.committedRoot, committedNoiseFloorPath(expectedProfileKey))
  const floor = floors.artefacts.find(entry => entry.path === floorFile)?.artefact
  let baseline: ComputeGateVerdictInput['baseline']
  if (pointer.kind === 'v1' || pointer.kind === 'v2') {
    const reportFile = join(input.committedRoot, committedReportPath(pointer.pointer.batchKey, 'report.json'))
    const report = reports.reports.find(entry => entry.path === reportFile)
    const decisions = readCommittedDecisionVectors(input.committedRoot, pointer.pointer.batchKey)
    if (decisions.kind === 'refused') refusals.push(decisions.refusal)
    if (report !== undefined) {
      baseline = { report: report.report,
        ...(decisions.kind === 'loaded' ? { vectors: decisions.document } : {}),
      }
    }
  }

  let current: ComputeGateVerdictInput['current']
  let currentReportFile: string
  let modelCalls = 0
  let freshWallClockMs: number | undefined
  if (mode.kind === 'fresh') {
    const loaded = loadCassetteBundles(mode.cassettesRoot)
    const admission = committedCorpusAdmissionRefusal(input.committedRoot, corpus, loaded)
    if (admission !== undefined) return { kind: 'refused', refusal: admission, notices }
    for (const [reason, count] of Object.entries(loaded.loadRefusals)) {
      notices.push(`cassette bundle load refused: ${reason}=${count}`)
    }
    const eligibleIds = new Set(corpus.snapshot.entries.map(entry => entry.cassetteId))
    const selected = loaded.loaded.filter(entry => eligibleIds.has(entry.cassette.id)).sort((a, b) =>
      a.cassette.id < b.cassette.id ? -1 : a.cassette.id > b.cassette.id ? 1 : 0)
    let run: Awaited<ReturnType<typeof replayCorpusOnce>>
    try {
      run = await replayCorpusOnce({
        selected,
        loadRefusals: loaded.loadRefusals,
        cassettesRoot: mode.cassettesRoot,
        agentQaRoot: input.agentQaRoot,
        runRoot: join(input.agentQaRoot, 'eval', 'gate', slugBranch(expectedProfileKey)),
        profile: mode.profile,
        auth: mode.auth,
        modelOverrides: mode.modelOverrides,
        judge: mode.judge,
        maskingContextFactory: mode.maskingContextFactory,
        seed: mode.seed,
        k: 1,
        replayOutputBaseDir: mode.replayOutputBaseDir,
        source: 'committed',
        corpusDigest,
        productByCassetteId: new Map(corpus.snapshot.entries.map(entry => [entry.cassetteId, entry.product])),
        labelRecords: corpus.snapshot.labelsById,
        corpusEntriesById: corpus.corpusEntriesById, excludedLabelIds: corpus.snapshot.excludedLabelIds,
        calibration: corpus.calibration,
        clock: input.clock,
        onProgress: mode.onProgress,
      })
    } catch (error) {
      // Per-cassette failures already live in the helper's report. Filesystem failures in
      // final staging retain the OS's exact failed path; caller-contract errors still throw.
      const io = error as NodeJS.ErrnoException
      if (typeof io?.code !== 'string' || typeof io.path !== 'string') throw error
      return { kind: 'refused', refusal: { path: io.path, reason: `gate staging failed: ${io.message}` }, notices }
    }
    current = { report: run.report, vectors: run.vectors, fingerprint, corpusDigest }
    currentReportFile = run.reportFile
    modelCalls = run.modelCalls
    freshWallClockMs = run.wallClockMs
    notices.push(...run.notices)
    const cost = run.report.totalCost
    const judgeCost = run.report.honesty.judge.cost
    const missing = cost.samplesMissingTokenUsage > 0 || judgeCost.outcomesMissingUsage > 0
      ? ` samplesMissingTokenUsage=${cost.samplesMissingTokenUsage} judgeOutcomesMissingUsage=${judgeCost.outcomesMissingUsage}` : ''
    mode.onProgress?.(`gate seed=${mode.seed}: decisions=${run.vectors.length} modelCalls=${modelCalls} ` +
      `promptTokens=${cost.promptTokens + judgeCost.inputTokens} ` +
      `completionTokens=${cost.completionTokens + judgeCost.outputTokens} ` +
      `wallClock=${run.wallClockMs}ms seedHonored=${run.report.seedHonored}${missing}`)
  } else {
    const loaded = loadStagedReport(input.agentQaRoot, mode.batchKey, mode.stagedOutputDir)
    if (loaded.kind !== 'loaded') {
      return { kind: 'refused', refusal: { path: loaded.file,
        reason: loaded.kind === 'absent' ? 'staged report absent' : loaded.reason }, notices }
    }
    currentReportFile = loaded.file
    const vectors = loaded.decisions?.vectors ?? []
    if (loaded.decisions === undefined) {
      notices.push('staged report carries no decisions sidecar — the verdict is inconclusive (no-decision-vector: current); re-run eval report to stage vectors')
    }
    // A report with no vectors cannot compare anyway. Preserve the historical no-vector
    // outcome; any populated offline comparison must establish its actual saved provenance.
    let identity = { fingerprint, corpusDigest }
    if (vectors.length > 0) {
      const saved = runIdentitySchema.safeParse(loaded.report.runIdentity)
      if (!saved.success) {
        return { kind: 'refused', refusal: { path: loaded.file,
          reason: 'staged report runIdentity absent or malformed; re-run eval gate to stage identified evidence' }, notices }
      }
      for (const field of ['fingerprint', 'corpusDigest'] as const) {
        if (saved.data[field] !== identity[field]) {
          return { kind: 'refused', refusal: { path: loaded.file,
            reason: `staged report runIdentity ${field} mismatch: saved=${saved.data[field]} current=${identity[field]}; re-run eval gate` }, notices }
        }
      }
      identity = saved.data
    }
    current = { report: loaded.report, vectors, ...identity }
  }
  const verdict = computeGateVerdict({ expectedProfileKey, pointer, floor, baseline, current })
  return {
    kind: 'verdict', verdict, lines: renderGateLines(verdict), mode: mode.kind,
    profileKey: expectedProfileKey, fingerprint, currentReport: current.report,
    currentReportFile, modelCalls, wallClockMs: freshWallClockMs ?? clock() - started,
    notices, refusals,
  }
}

function readPointer(
  path: string,
  others: readonly { profileKey: string }[],
  refusals: CommittedReadRefusal[],
): ComputeGateVerdictInput['pointer'] {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent', others }
    const reason = `baseline pointer unreadable: ${(error as Error).message}`
    if (!refusals.some(refusal => refusal.path === path)) refusals.push({ path, reason })
    return { kind: 'rejected', reason }
  }
  const guarded = guardBaselinePointer(value)
  if (guarded.kind === 'rejected' && !refusals.some(refusal => refusal.path === path)) {
    refusals.push({ path, reason: guarded.reason })
  }
  return guarded
}
