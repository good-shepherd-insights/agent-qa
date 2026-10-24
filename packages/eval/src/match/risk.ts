import { projectRiskAction } from '@vostride/agent-qa-runner'
import { classifyRisk, TIER_ORDER } from '@vostride/agent-qa-safety'
import type { Action, RiskTier } from '@vostride/agent-qa-schema'

/**
 * The D-06 side-effect axis: a typed flag that stays structurally distinct from numeric axes.
 * A positive success score therefore cannot override a flagged risk verdict.
 */
export type SideEffectVerdict =
  | { kind: 'none' }
  | { kind: 'flagged'; reason: string; riskFamily: RiskTier }

/**
 * Compare gold and candidate actions through the live policy gate's D-05 risk vocabulary.
 * Classification is imported directly; the matcher deliberately owns no second risk lexicon.
 */
export function classifySideEffect(
  goldAction: Action,
  candidateAction: Action,
): SideEffectVerdict {
  const goldTier = classifyRisk(projectRiskAction(goldAction)).riskTier
  const candidateVerdict = classifyRisk(projectRiskAction(candidateAction))

  if (TIER_ORDER.indexOf(candidateVerdict.riskTier) <= TIER_ORDER.indexOf(goldTier)) {
    return { kind: 'none' }
  }

  return {
    kind: 'flagged',
    reason: candidateVerdict.reason,
    riskFamily: candidateVerdict.riskTier,
  }
}
