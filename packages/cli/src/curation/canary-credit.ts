// 2026-09-07, 418 D-01: the credit pass; DATA crosses the eval/knowledge wall here.
import type { Benefit, CanaryOutcome, CompletedRunHandoff, CrossCheck } from '@vostride/agent-qa-schema'
import { canonicalJson, distilledScreenStateDigest, exercisedAnchors, normalizeAnchor } from '@vostride/agent-qa-schema'
import type { LocalCurationCapabilities } from '@vostride/agent-qa-agent-local'
import type { NonSignalClass, ProjectedCanaryAttribution } from './emit-canary-outcomes.js'

export interface CanaryAblationInput {
  handoff: CompletedRunHandoff
  runDir: string
  candidateId: string
  runId: string
  testId: string
  testIndex: number
  stepIndex: number
  attributedObservationId: string
}

export type CanaryAblationResult =
  | {
      kind: 'ablated'
      crossCheck: CrossCheck
      corpusDigest: string
      k: number
      baseSeed: number
      seeds: number[]
      seedHonored: boolean
      spend: {
        modelCalls: number
        screens: number
        promptTokens: number
        completionTokens: number
      }
      gate2Dir: string
    }
  | { kind: 'no-eval-root' }
  | { kind: 'unavailable', reason: string }
  | { kind: 'error', message: string }

export type CanaryCorpusDigestResult =
  | { kind: 'digest', corpusDigest: string }
  | { kind: 'no-eval-root' }
  | { kind: 'unavailable', reason: string }

export interface CanaryAblation {
  isNovel(input: { product: string; stateDigest: string }): Promise<boolean>
  stage(input: CanaryAblationInput & { product: string; stateDigest: string; benefit: Benefit }): Promise<
    { kind: 'staged' | 'already-staged' | 'not-novel' | 'no-eval-root' | 'egress-blocked' | 'target-unavailable' | 'write-conflict' }
    | { kind: 'unavailable'; reason: string } | { kind: 'error'; message: string }
  >
  ablate(input: CanaryAblationInput): Promise<CanaryAblationResult>
  corpusDigest(): Promise<CanaryCorpusDigestResult>
  resolveCaps?(): Promise<{ maxAblations: number; source: string }>
}

export interface CanaryCreditCounters {
  credited: number
  rideAlongUncredited: number
  ablationCapExceeded: number
  ablationHeld: number
  ablationInconclusive: number
  ablationError: number
  rerunExcluded: number
  nonSignal: Record<NonSignalClass, number>
  staged: number
  stagingRefused: number
}

export function emptyCanaryCreditCounters(): CanaryCreditCounters {
  return { credited: 0, rideAlongUncredited: 0, ablationCapExceeded: 0,
    ablationHeld: 0, ablationInconclusive: 0, ablationError: 0, rerunExcluded: 0,
    nonSignal: { environment: 0, timeout: 0, flake: 0 }, staged: 0, stagingRefused: 0 }
}

export type CreditedCanaryAttribution = ProjectedCanaryAttribution & {
  staged?: true
  crossCheck?: CrossCheck
  corpusDigestMoved?: true
}
export interface CanaryCreditInput {
  maxAblations: number
  knowledgeRoot: string
  readBundleStateDigests: LocalCurationCapabilities['readCanonicalBundleStateDigests']
  attributions: readonly ProjectedCanaryAttribution[]
  ablation?: CanaryAblation
  handoff: CompletedRunHandoff
  runDir: string
  observationIdOf: (outcome: CanaryOutcome) => string
}

export async function creditCanaryAttributions(
  input: CanaryCreditInput,
): Promise<{ attributions: CreditedCanaryAttribution[], counters: CanaryCreditCounters }> {
  if (!Number.isSafeInteger(input.maxAblations) || input.maxAblations < 1) {
    throw new TypeError('--max-ablations must be a positive integer')
  }
  const counters = emptyCanaryCreditCounters()
  const attributions: CreditedCanaryAttribution[] = []
  let digestRead = false
  let corpusDigest: string | undefined
  const ablatedCandidates = new Set<string>()
  let ablationsRun = 0
  for (const row of input.attributions) {
    if (row.kind !== 'outcome') {
      attributions.push(row)
      continue
    }
    const served = row.source === 'served-brief'
    if (served && input.ablation !== undefined && !digestRead) {
      digestRead = true
      try {
        const digest = await input.ablation.corpusDigest()
        if (digest.kind === 'digest') corpusDigest = digest.corpusDigest
      } catch { /* Digest availability is not a credit decision. */ }
    }
    const outcome: CanaryOutcome = { ...row.outcome, stateValidity: 'unknown',
      benefit: row.outcome.runOutcome === 'negative' ? 'exercised-harmed' : 'rode-along',
      ...(served && corpusDigest !== undefined ? { corpusDigest } : {}) }
    // Recompute evidence from this pass rather than inheriting a prior projection's citation.
    if (!served || corpusDigest === undefined) delete outcome.corpusDigest
    delete outcome.observedStateDigest
    delete outcome.ablation
    if (served) {
      const step = input.handoff.tests.find((test) =>
        test.testIndex === outcome.testIndex && test.testId === outcome.testId)
        ?.steps.find((candidate) => candidate.stepIndex === outcome.stepIndex)
      // Match the live target used by Gate2 extraction/staging. Cache-prefix state is not
      // the live decision's input, and the step-only replay address cannot disambiguate
      // multiple live decisions. The unique live action must exercise THIS row's anchor.
      const live = step?.subActions?.filter(action => action.exchanges !== undefined) ?? []
      const action = live.length === 1 ? live[0] : undefined
      const observed = step !== undefined && action !== undefined
        && exercisedAnchors({ ...step, subActions: [action] }).some(anchor =>
          canonicalJson(normalizeAnchor(anchor)) === canonicalJson(normalizeAnchor(outcome.exercisedAnchor)))
        ? action.stateBefore : undefined
      if (observed !== undefined) outcome.observedStateDigest = distilledScreenStateDigest(observed)
      const bundle = input.readBundleStateDigests({
        knowledgeRoot: input.knowledgeRoot, candidateId: outcome.candidateId,
      })
      if (outcome.observedStateDigest !== undefined && bundle.kind === 'found' && bundle.digests.length > 0) {
        outcome.stateValidity = bundle.digests.includes(outcome.observedStateDigest) ? 'valid' : 'stale'
      }
    }
    let crossCheck: CrossCheck = 'not-run'
    let corpusDigestMoved: true | undefined
    if (outcome.runOutcome === 'positive') {
      if (!served || input.ablation === undefined) {
        counters.rideAlongUncredited += 1
      } else if (outcome.observedStateDigest === undefined) {
        counters.ablationInconclusive += 1
      } else if (ablatedCandidates.has(outcome.candidateId)) {
        counters.rideAlongUncredited += 1
      } else if (ablationsRun >= input.maxAblations) {
        counters.ablationCapExceeded += 1
      } else {
        ablatedCandidates.add(outcome.candidateId)
        ablationsRun += 1
        let result: CanaryAblationResult
        try {
          result = await input.ablation.ablate({ handoff: input.handoff, runDir: input.runDir,
            candidateId: outcome.candidateId, runId: outcome.runId, testId: outcome.testId,
            testIndex: outcome.testIndex, stepIndex: outcome.stepIndex,
            attributedObservationId: input.observationIdOf(outcome) })
        } catch (error) {
          result = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
        }
        switch (result.kind) {
          case 'ablated':
            crossCheck = result.crossCheck
            if (corpusDigest !== undefined && corpusDigest !== result.corpusDigest) corpusDigestMoved = true
            outcome.corpusDigest = result.corpusDigest
            outcome.ablation = { crossCheck, k: result.k, baseSeed: result.baseSeed,
              seeds: result.seeds, seedHonored: result.seedHonored, spend: result.spend }
            if (crossCheck === 'flipped') {
              outcome.benefit = 'exercised-benefited'
              counters.credited += 1
            } else if (crossCheck === 'held') counters.ablationHeld += 1
            else counters.ablationInconclusive += 1
            break
          case 'no-eval-root':
            counters.rideAlongUncredited += 1
            break
          case 'unavailable':
            counters.ablationInconclusive += 1
            break
          case 'error':
            counters.ablationError += 1
            break
        }
      }
    }
    let staged: true | undefined
    if (served && input.ablation !== undefined && outcome.observedStateDigest !== undefined) {
      try {
        const product = input.handoff.scope.tier === 'product' && input.handoff.scope.key !== '' && input.handoff.scope.key !== 'unknown'
          ? input.handoff.scope.key : 'default'
        const stateDigest = outcome.observedStateDigest
        if (await input.ablation.isNovel({ product, stateDigest })) {
          const stage = await input.ablation.stage({ handoff: input.handoff, runDir: input.runDir,
            candidateId: outcome.candidateId, runId: outcome.runId, testId: outcome.testId,
            testIndex: outcome.testIndex, stepIndex: outcome.stepIndex,
            attributedObservationId: input.observationIdOf(outcome), product, stateDigest, benefit: outcome.benefit })
          if (stage.kind === 'staged') { counters.staged += 1; staged = true }
          else if (!['already-staged', 'not-novel', 'no-eval-root'].includes(stage.kind)) counters.stagingRefused += 1
        }
      } catch { counters.stagingRefused += 1 }
    }
    attributions.push({ ...row, outcome, crossCheck, ...(staged === undefined ? {} : { staged }),
      ...(corpusDigestMoved === undefined ? {} : { corpusDigestMoved }) })
  }
  return { attributions, counters }
}
