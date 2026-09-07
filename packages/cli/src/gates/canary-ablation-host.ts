// 2026-09-07, 418 D-01/D-08: lazy DATA bridge; declaration and corpus reads never resolve auth.
import type { CanaryAblation } from '../curation/canary-credit.js'

export function createCanaryAblationForHost(input: {
  configPath: string
  agentQaRoot: string
  maxAblations?: number
}): CanaryAblation & { resolveCaps(): Promise<{ maxAblations: number; source: string }> } {
  return {
    async ablate(target) {
      try {
        const { resolveEvalSession, runCanaryAblation } = await import('../eval-session-composition.js')
        const session = await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
        const result = await runCanaryAblation(session, {
          agentQaRoot: input.agentQaRoot, recordId: target.candidateId,
          target: { runId: target.runId, testId: target.testId, stepIndex: target.stepIndex },
          attributedObservationId: target.attributedObservationId,
        })
        return result.kind === 'ablated' ? { ...result, seeds: [...result.seeds] } : result
      } catch (error) {
        return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
      }
    },
    async corpusDigest() {
      try {
        const { resolveEvalSession, readCanaryCorpusDigest } = await import('../eval-session-composition.js')
        const session = await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
        return readCanaryCorpusDigest(session)
      } catch (error) {
        return { kind: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
      }
    },
    async resolveCaps() {
      const { resolveEvalSession, resolveGate2Caps } = await import('../eval-session-composition.js')
      const session = await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
      const caps = resolveGate2Caps(session, input)
      return { maxAblations: caps.maxAblations, source: caps.maxAblationsSource }
    },
  }
}
