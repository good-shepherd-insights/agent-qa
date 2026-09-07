// 2026-09-07, 418 D-02: the ablation composition. The live decision becomes sample one
// only here; every fresh model call delegates to runCassetteReplay's safety scope.
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  applyBriefDelta,
  buildEvalReport,
  computeCorpusDigest,
  computeDecisionIdentity,
  deriveSampleSeeds,
  type ReplaySample,
} from '@vostride/agent-qa-eval'
import { slugBranch, type CrossCheck } from '@vostride/agent-qa-schema'
import { readCommittedCorpus } from './committed-corpus-source.js'
import {
  locateTargetCassettes,
  removalFlipsOutcome,
  resolveActiveRecordRemoval,
  type ReplayBag,
} from './replay-gate-composition.js'
import { runCassetteReplay } from './replay-composition.js'
import { FsReplayRecordStore } from './replay-record-store.js'
import { FsScoreStore } from './score-store.js'
import { loadScoreRecord } from './replay-read.js'
import { buildRootMarkerValue, COMMITTED_ROOT_MARKER_FILE } from './committed-root-store.js'

export const GATE2_AUDIT_SUBDIR = 'eval/gate2'
export const GATE2_TARGET_SUBDIR = 'target'

export interface AblateCanaryStepInput {
  agentQaRoot: string
  committedRoot: string
  recordId: string
  target: { runId: string; testId: string; stepIndex: number }
  attributedObservationId: string
  k: number
  baseSeed: number
  replay: ReplayBag
}
export type CommittedCorpusDigestRead =
  | { kind: 'digest'; corpusDigest: string }
  | { kind: 'unavailable'; reason: 'corpus-unreadable'; detail: string }
export type AblateCanaryStepResult =
  | {
      kind: 'ablated'
      crossCheck: CrossCheck
      corpusDigest: string
      k: number
      baseSeed: number
      seeds: number[]
      seedHonored: boolean
      spend: { modelCalls: number; screens: number; promptTokens: number; completionTokens: number }
      gate2Dir: string
      notices: string[]
    }
  | {
      kind: 'unavailable'
      reason: 'target-unavailable' | 'brief-line-not-found' | 'no-live-decision' | 'corpus-unreadable'
      detail: string
    }

function readDigestSnapshot(committedRoot: string) {
  const corpus = readCommittedCorpus(committedRoot)
  // 418 D-08: the general census reader accepts an absent tree as empty data. A gate
  // citation must establish the root itself, or a broken host could mint an empty digest.
  try {
    const marker = JSON.parse(readFileSync(join(committedRoot, COMMITTED_ROOT_MARKER_FILE), 'utf8'))
    if (marker?.schemaVersion !== buildRootMarkerValue().schemaVersion) {
      throw new Error('invalid eval root marker schemaVersion')
    }
  } catch (error) {
    return { corpus, result: { kind: 'unavailable', reason: 'corpus-unreadable',
      detail: error instanceof Error ? error.message : String(error),
    } as const }
  }
  const result: CommittedCorpusDigestRead =
    corpus.refusals.length > 0
      ? {
          kind: 'unavailable',
          reason: 'corpus-unreadable',
          detail: corpus.refusals.map((row) => `${row.path}: ${row.reason}`).join('\n'),
        }
      : { kind: 'digest', corpusDigest: computeCorpusDigest(corpus.snapshot.entries) }
  return { corpus, result }
}

/** D-07: the same committed corpus definition the posture resolver cites, including negatives. */
export function readCommittedCorpusDigest(input: {
  committedRoot: string
}): CommittedCorpusDigestRead {
  return readDigestSnapshot(input.committedRoot).result
}

export async function ablateCanaryStep(
  input: AblateCanaryStepInput,
): Promise<AblateCanaryStepResult> {
  // Validate before extraction or spend, using the canonical odd-k contract.
  deriveSampleSeeds(input.baseSeed, input.k)
  const gate2Dir = join(
    input.agentQaRoot,
    GATE2_AUDIT_SUBDIR,
    slugBranch(input.attributedObservationId),
  )
  const { corpus, result: digest } = readDigestSnapshot(input.committedRoot)
  if (digest.kind === 'unavailable') return digest
  const located = await locateTargetCassettes({
    committedRoot: input.committedRoot,
    agentQaRoot: input.agentQaRoot,
    gate1Dir: gate2Dir,
    corpusEntries: corpus.snapshot.entries,
    target: input.target,
    source: 'handoff',
  })
  if (located.kind === 'unavailable')
    return {
      kind: 'unavailable',
      reason:
        located.detail.reason === 'no live decision at target'
          ? 'no-live-decision'
          : 'target-unavailable',
      detail: JSON.stringify(located.detail),
    }
  // The input identifies a step, not a sub-action. Never guess which decision earned credit.
  if (located.cassettes.length !== 1)
    return {
      kind: 'unavailable',
      reason: 'target-unavailable',
      detail: 'ambiguous live step: multiple recorded decisions',
    }
  const target = located.cassettes[0]!
  const { cassette, artifacts } = target
  // Extraction's sidecar.goldAction is the exact recorded SubActionEvidence.plannedAction.
  const action = cassette.sidecar.goldAction
  if (action === undefined)
    return { kind: 'unavailable', reason: 'no-live-decision', detail: 'recorded planned action absent' }
  const withRecord: ReplaySample = {
    sampleIndex: 0,
    durationMs: 0,
    outcome: {
      kind: 'decision',
      action,
      identity: computeDecisionIdentity(action, cassette.input.stateBefore.elements),
    },
  }
  const removal = resolveActiveRecordRemoval({
    cassette,
    recordId: input.recordId,
    servedCanary: true,
  })
  if (removal.kind === 'unavailable')
    return { kind: 'unavailable', reason: 'brief-line-not-found', detail: removal.reason }
  const outputDir = join(gate2Dir, 'cross-check', 'without', 'sample-0', 'replays')
  let modelCalls = 0
  const firstReplay = await runCassetteReplay({
    ...input.replay,
    cassette: { ...cassette, input: applyBriefDelta(cassette.input, removal.delta) },
    artifacts,
    declaredBriefDelta: removal.delta,
    k: 1,
    seed: input.baseSeed,
    replayOutputBaseDir: gate2Dir,
    modelCallObservation: {
      onProviderCall: () => {
        modelCalls++
        input.replay.modelCallObservation?.onProviderCall?.()
      },
    },
    recordStore: new FsReplayRecordStore({ root: gate2Dir, outputDir }),
    scoreStore: new FsScoreStore({ root: gate2Dir, outputDir }),
  })
  const firstSample =
    'granularity' in firstReplay && firstReplay.granularity === 'leaf'
      ? firstReplay.samples[0]
      : undefined
  const withoutRecord: ReplaySample = firstSample ?? {
    sampleIndex: 0,
    durationMs: 0,
    outcome: { kind: 'harness-error', message: 'replay produced no sample' },
  }
  const score = loadScoreRecord(join(outputDir, ...cassette.id.split('/').map(slugBranch)))
  const judgeCost =
    score.kind === 'loaded' && firstSample !== undefined
      ? buildEvalReport([
          { cassetteId: cassette.id, outcome: firstReplay, score: score.record.score },
        ]).honesty.judge.cost
      : { inputTokens: 0, outputTokens: 0 }
  const checked = await removalFlipsOutcome({
    recordId: input.recordId,
    cassettes: [target],
    mode: { kind: 'active-record', servedCanary: true },
    k: input.k,
    baseSeed: input.baseSeed,
    existing: { withRecord, withoutRecord },
    replay: input.replay,
    gate1Dir: gate2Dir,
  })
  if (
    checked.crossCheck === 'inconclusive' &&
    checked.notices.some((line) => line.startsWith('brief-line-not-found:'))
  )
    return { kind: 'unavailable', reason: 'brief-line-not-found', detail: checked.notices.join('\n') }
  return {
    kind: 'ablated',
    crossCheck: checked.crossCheck,
    corpusDigest: digest.corpusDigest,
    k: input.k,
    baseSeed: input.baseSeed,
    seeds: checked.seeds,
    seedHonored: checked.seedHonored,
    spend: {
      modelCalls: modelCalls + checked.modelCalls,
      screens: 1 + checked.screens,
      promptTokens:
        (withoutRecord.tokenUsage?.promptTokens ?? 0) + judgeCost.inputTokens + checked.promptTokens,
      completionTokens:
        (withoutRecord.tokenUsage?.completionTokens ?? 0) + judgeCost.outputTokens + checked.completionTokens,
    },
    gate2Dir,
    notices: [
      'with-record sample 1 is the recorded live decision; its seed was not replayed or verified. seedHonored describes fresh replay samples only.',
      ...checked.notices,
      ...(!checked.seedHonored
        ? ['seedHonored=false: fresh samples measure repeat variance on this provider']
        : []),
    ],
  }
}
