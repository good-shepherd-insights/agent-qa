// 2026-09-07, 418 D-01: the credit pass; DATA crosses the eval/knowledge wall here.
import type { CanaryOutcome, CompletedRunHandoff, CrossCheck } from '@vostride/agent-qa-schema'
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

export type CreditedCanaryAttribution = ProjectedCanaryAttribution & { crossCheck?: CrossCheck }
export interface CanaryCreditInput {
  maxAblations?: number
  knowledgeRoot?: string
  readBundleStateDigests?: (input: { knowledgeRoot: string; candidateId: string }) => { kind: 'found'; digests: string[] } | { kind: 'not-found' }
  attributions: readonly ProjectedCanaryAttribution[]
  ablation?: CanaryAblation
  handoff: CompletedRunHandoff
  runDir: string
  observationIdOf: (outcome: CanaryOutcome) => string
}

export async function creditCanaryAttributions(
  input: CanaryCreditInput,
): Promise<{ attributions: CreditedCanaryAttribution[], counters: CanaryCreditCounters }> {
  const counters = emptyCanaryCreditCounters()
  const attributions: CreditedCanaryAttribution[] = []
  let digestRead = false
  let corpusDigest: string | undefined
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
    let crossCheck: CrossCheck = 'not-run'
    if (outcome.runOutcome === 'positive') {
      if (!served || input.ablation === undefined) {
        counters.rideAlongUncredited += 1
      } else {
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
    attributions.push({ ...row, outcome, crossCheck })
  }
  return { attributions, counters }
}
