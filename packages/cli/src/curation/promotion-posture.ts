import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ReplayGatePort } from '@vostride/agent-qa-agent'
import { selectGateSet, type JudgeCapabilityInput } from '@vostride/agent-qa-eval'
import {
  readCommittedCorpus,
  readGatePostureFor,
  resolveMinimumGateSet,
} from '@vostride/agent-qa-eval-local'
import type {
  PromotionCanaryPosture,
  PromotionJudgePosture,
  ResolvePromotionPosture,
  UnavailablePromotionGatePosture,
} from '@vostride/agent-qa-schema'
import { resolveEvalSession, resolveGateProfileIdentity } from '../eval-session-composition.js'

export interface PromotionPostureHostFacts {
  replayGateAvailable: boolean
  judge: PromotionJudgePosture
  canary: PromotionCanaryPosture
  corpusDigest: string
  minimumGateSet: number
  profileKey: string
}

export type PromotionPostureResolution =
  | { kind: 'no-eval-root'; committedRoot: string }
  | { kind: 'unavailable'; committedRoot: string; refusals: readonly string[]; resolve: ResolvePromotionPosture }
  | { kind: 'ready'; committedRoot: string; host: PromotionPostureHostFacts; resolve: ResolvePromotionPosture }

/** Await once before draining; the returned candidate resolver runs synchronously under authority. */
export async function buildPromotionPostureResolver(input: {
  configPath: string
  replayGate?: ReplayGatePort
}): Promise<PromotionPostureResolution> {
  const { configPath, replayGate } = input
  const committedRoot = resolve(dirname(resolve(configPath)), 'agent-qa-eval')
  if (!existsSync(committedRoot)) return { kind: 'no-eval-root', committedRoot }
  const replayGateAvailable = replayGate !== undefined
  const unavailable = (refusals: readonly string[]): UnavailablePromotionGatePosture => ({
    kind: 'unavailable', replayGateAvailable, refusals,
  })
  const refused = (refusals: readonly string[]): PromotionPostureResolution => ({
    kind: 'unavailable', committedRoot, refusals, resolve: () => unavailable(refusals),
  })
  const refusalLines = (rows: readonly { path: string; reason: string }[]) =>
    rows.map(row => `${row.path}: ${row.reason}`)
  const judgeFacts = (judge: PromotionJudgePosture): PromotionJudgePosture => ({
    capable: judge.capable, reason: judge.reason,
    ...(judge.judgeFamily === undefined ? {} : { judgeFamily: judge.judgeFamily }),
  })
  try {
    const session = await resolveEvalSession({ configPath, keyOnly: true })
    const identity = await resolveGateProfileIdentity(session)
    const floor = resolveMinimumGateSet({ committedRoot, profileKey: identity.profileKey })
    if (floor.kind === 'no-floor') {
      return refused([`noise-floor: no artefact for profile ${identity.profileKey}`])
    }
    if (floor.kind === 'no-value') {
      return refused([`noise-floor: no minimumGateSet value at ${floor.path}`])
    }
    const minimumGateSet = floor.minimumGateSet
    const corpus = readCommittedCorpus(committedRoot)
    if (corpus.refusals.length > 0) return refused(refusalLines(corpus.refusals))
    const judge: JudgeCapabilityInput = {
      plannerModelId: identity.plannerModelId,
      ...(identity.judgeModelId === undefined ? {} : { judgeModelId: identity.judgeModelId }),
      allowSameFamily: session.evalConfig.judgeAllowSameFamily === true,
    }
    const canary = { kind: 'not-provided' as const, rarePathEligible: false }
    // Probe once so even a host with no candidates discloses refused manifests.
    const hostRead = readGatePostureFor({
      committedRoot, scope: { tier: 'global', key: 'global' }, minimumGateSet, judge, canary,
    })
    if (hostRead.refusals.length > 0) return refused(refusalLines(hostRead.refusals))
    const resolvePosture: ResolvePromotionPosture = candidate => {
      try {
        const read = readGatePostureFor({ committedRoot, scope: candidate.scope, minimumGateSet, judge, canary })
        if (read.refusals.length > 0) return unavailable(refusalLines(read.refusals))
        const verdict = selectGateSet({ entries: corpus.snapshot.entries, product: candidate.product, candidate: candidate.provenance, minimumGateSet })
        return {
          kind: 'resolved', replayGateAvailable,
          gateSetVerdict: verdict.verdict, gateSetNonEmpty: verdict.verdict === 'ok',
          counts: {
            ...read.posture.counts,
            excludedCount: verdict.verdict === 'unprovenanced-candidate' ? 0 : verdict.excluded.length,
            ...(verdict.verdict === 'empty-gate-set' ? { remaining: verdict.counts } : {}),
          },
          corpusDigest: read.posture.corpusDigest, minimumGateSet,
          scope: { partition: read.posture.scope.partition, resolution: read.posture.scope.resolution },
          judge: judgeFacts(read.posture.judge), canary,
        }
      } catch (error) {
        return unavailable([error instanceof Error ? error.message : String(error)])
      }
    }
    return {
      kind: 'ready', committedRoot, resolve: resolvePosture,
      host: { replayGateAvailable, judge: judgeFacts(hostRead.posture.judge), canary,
        corpusDigest: hostRead.posture.corpusDigest, minimumGateSet, profileKey: identity.profileKey },
    }
  } catch (error) {
    return refused([error instanceof Error ? error.message : String(error)])
  }
}
