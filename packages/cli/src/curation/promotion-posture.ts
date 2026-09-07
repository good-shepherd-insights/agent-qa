import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ReplayGatePort } from '@vostride/agent-qa-agent'
import type { LocalCurationCapabilities } from '@vostride/agent-qa-agent-local'
import type { JudgeCapabilityInput } from '../eval-session-composition.js'
import type {
  PromotionCanaryPosture,
  PromotionJudgePosture,
  PromotionGateHoldReason,
  PromotionPath,
  ResolvePromotionPosture,
  UnavailablePromotionGatePosture,
} from '@vostride/agent-qa-schema'

export interface PromotionPostureHostFacts {
  replayGateAvailable: boolean
  judge: PromotionJudgePosture
  canary: PromotionCanaryPosture
  corpusDigest: string
  minimumGateSet: number
  profileKey: string
  lowerTrustShares: ReturnType<LocalCurationCapabilities['readLowerTrustShares']>
  canaryHorizonBuilds: number
  canaryHorizonBuildsSource: 'config' | 'default'
  maxLowerTrustPerScope: number
  maxLowerTrustPerScopeSource: 'config' | 'default'
  notices: string[]
}

// A run-bound override reuses prepared identity, while each candidate still reads
// current bundle/corpus facts. Non-run hosts read the product's latest ordinal.
type ResolveAtBuildOrdinal = (
  candidate: Parameters<ResolvePromotionPosture>[0], currentBuildOrdinal?: number,
) => ReturnType<ResolvePromotionPosture>

export type PromotionPostureResolution =
  | { kind: 'no-eval-root'; committedRoot: string }
  | { kind: 'unavailable'; committedRoot: string; refusals: readonly string[]; resolve: ResolvePromotionPosture }
  | { kind: 'ready'; committedRoot: string; host: PromotionPostureHostFacts; resolve: ResolveAtBuildOrdinal }

/** Prepare before each operation or drain; candidate reads stay synchronous under authority. */
export async function buildPromotionPostureResolver(input: {
  configPath: string
  replayGate?: ReplayGatePort
  canaryFacts?: LocalCurationCapabilities['readCanaryPostureFacts']
  lowerTrustShares?: LocalCurationCapabilities['readLowerTrustShares']
  knowledgeRoot?: string
  agentQaRoot?: string
  currentBuildOrdinal?: number | ((product: string) => number | undefined)
  notice?: (message: string) => void
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
    const { resolveEvalSession, resolveGateProfileIdentity, readCommittedCorpus,
      readGatePostureFor, resolveMinimumGateSet, selectGateSet, computeCorpusDigest, resolveGate2Caps,
    } = await import('../eval-session-composition.js')
    const session = await resolveEvalSession({ configPath, keyOnly: true })
    const identity = await resolveGateProfileIdentity(session)
    const caps = resolveGate2Caps(session)
    const notices: string[] = []
    const validOrdinal = (value: number | undefined): value is number =>
      value !== undefined && Number.isSafeInteger(value) && value > 0
    const noticeNoOrdinal = () => {
      if (!notices.includes('no-current-build-ordinal')) notices.push('no-current-build-ordinal')
      input.notice?.('no-current-build-ordinal')
    }
    if (typeof input.currentBuildOrdinal !== 'function' && !validOrdinal(input.currentBuildOrdinal)) noticeNoOrdinal()
    const lowerTrustShares = input.knowledgeRoot === undefined ? []
      : input.lowerTrustShares?.({ knowledgeRoot: input.knowledgeRoot }) ?? []
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
    const resolvePosture: ResolveAtBuildOrdinal = (candidate, ordinalOverride) => {
      try {
        if (!existsSync(committedRoot)) return undefined
        // A drain can retain this resolver across candidates. Both selection inputs
        // must follow disk; a prepared floor cannot outlive its measured artefact.
        const currentFloor = resolveMinimumGateSet({ committedRoot, profileKey: identity.profileKey })
        if (currentFloor.kind === 'no-floor') {
          return unavailable([`noise-floor: no artefact for profile ${identity.profileKey}`])
        }
        if (currentFloor.kind === 'no-value') {
          return unavailable([`noise-floor: no minimumGateSet value at ${currentFloor.path}`])
        }
        const minimumGateSet = currentFloor.minimumGateSet
        const currentCorpus = readCommittedCorpus(committedRoot)
        if (currentCorpus.refusals.length > 0) return unavailable(refusalLines(currentCorpus.refusals))
        const currentBuildOrdinal = ordinalOverride ?? (typeof input.currentBuildOrdinal === 'function'
          ? input.currentBuildOrdinal(candidate.product) : input.currentBuildOrdinal)
        if (!validOrdinal(currentBuildOrdinal)) noticeNoOrdinal()
        else notices.splice(0, notices.length)
        const facts = input.knowledgeRoot === undefined ? undefined : input.canaryFacts?.({
          knowledgeRoot: input.knowledgeRoot, candidateId: candidate.id, scope: candidate.scope,
        })
        const canary: PromotionCanaryPosture = {
          kind: facts === undefined ? 'not-provided' : 'provided',
          rarePathEligible: facts?.kind === 'found' && facts.gate1PassOrdinal !== undefined
            && validOrdinal(currentBuildOrdinal)
            && currentBuildOrdinal - facts.gate1PassOrdinal >= caps.canaryHorizonBuilds
            && (facts.latestAttributionOrdinal === undefined || facts.latestAttributionOrdinal <= facts.gate1PassOrdinal)
            && (facts.latestGate2Ordinal === undefined || facts.latestGate2Ordinal <= facts.gate1PassOrdinal)
            && facts.lowerTrustActiveInScope < caps.maxLowerTrustPerScope,
        }
        // The eval reader's canary census has a different contract (attributedRows
        // plus skippedBundles). Eligibility is our candidate DATA, returned below.
        const read = readGatePostureFor({ committedRoot, scope: candidate.scope, minimumGateSet, judge,
          canary: { kind: 'not-provided' } })
        if (read.refusals.length > 0) return unavailable(refusalLines(read.refusals))
        if (computeCorpusDigest(currentCorpus.snapshot.entries) !== read.posture.corpusDigest) {
          return unavailable([`${committedRoot}: corpus changed during posture resolution`])
        }
        const floorAfterRead = resolveMinimumGateSet({ committedRoot, profileKey: identity.profileKey })
        if (floorAfterRead.kind !== 'resolved' || floorAfterRead.minimumGateSet !== minimumGateSet
          || floorAfterRead.path !== currentFloor.path) {
          return unavailable([`${committedRoot}: noise floor changed during posture resolution`])
        }
        const verdict = selectGateSet({ entries: currentCorpus.snapshot.entries, product: candidate.product, candidate: candidate.provenance, minimumGateSet })
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
        corpusDigest: hostRead.posture.corpusDigest, minimumGateSet, profileKey: identity.profileKey,
        lowerTrustShares, canaryHorizonBuilds: caps.canaryHorizonBuilds,
        canaryHorizonBuildsSource: caps.canaryHorizonBuildsSource,
        maxLowerTrustPerScope: caps.maxLowerTrustPerScope,
        maxLowerTrustPerScopeSource: caps.maxLowerTrustPerScopeSource, notices },
    }
  } catch (error) {
    return refused([error instanceof Error ? error.message : String(error)])
  }
}

export function renderPromotionLine(entry: {
  candidateId: string
  promotionPath?: PromotionPath
  promotionHoldReason?: PromotionGateHoldReason
}): string {
  return entry.promotionPath === undefined
    ? `curation: ${entry.candidateId} held: ${entry.promotionHoldReason}`
    : `curation: ${entry.candidateId} promoted via ${entry.promotionPath}`
}

/** Keep refusal detail visible even when disk reads fail after successful host preparation. */
export function promotionPostureResolverForHost(
  resolution: PromotionPostureResolution,
  warn?: (message: string) => void,
  currentBuildOrdinal?: number,
  /** null means a handoff without product-tier scope; never borrow its ordinal. */
  product?: string | null,
): ResolvePromotionPosture | undefined {
  if (resolution.kind === 'unavailable') {
    warn?.(`curation: posture unavailable: ${resolution.refusals.join('; ')}`)
  }
  return candidate => {
    // Identity preparation is async, so a root that appears mid-drain must wait
    // for the next preparation boundary instead of borrowing the absent-root floor.
    const posture = resolution.kind === 'no-eval-root'
      ? existsSync(resolution.committedRoot)
        ? { kind: 'unavailable' as const, replayGateAvailable: false,
          refusals: [`${resolution.committedRoot}: eval root appeared after posture preparation; retry with fresh posture`] }
        : undefined
      : resolution.kind === 'ready' ? resolution.resolve(candidate,
        product === undefined || product === candidate.product ? currentBuildOrdinal : undefined,
      ) : resolution.resolve(candidate)
    if (resolution.kind === 'ready' && resolution.host.notices.includes('no-current-build-ordinal')) {
      warn?.('curation: no-current-build-ordinal')
    }
    if (posture?.kind === 'unavailable') {
      warn?.(`curation: ${candidate.id} posture unavailable: ${posture.refusals.join('; ')}`)
    }
    return posture
  }
}
