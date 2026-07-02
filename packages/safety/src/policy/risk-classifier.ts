import type { RiskActionDescriptor, RiskTier } from '@vostride/agent-qa-schema'

import { matchLexicon } from './lexicon'

export const TIER_ORDER: readonly RiskTier[] = [
  'read-only',
  'mutating-local',
  'mutating-shared',
  'destructive',
  'restricted',
]

interface Proposal {
  tier: RiskTier
  reason: string
}

type Signal = (action: RiskActionDescriptor) => Proposal | undefined

function rank(tier: RiskTier): number {
  return TIER_ORDER.indexOf(tier)
}

const proposeReadOnly: Signal = (action) =>
  action.readOnly === true ? { tier: 'read-only', reason: 'readOnly advisory flag' } : undefined

const proposeRecognizedMutating: Signal = (action) =>
  action.recognized && action.readOnly !== true
    ? { tier: 'mutating-local', reason: 'recognized mutating action floor' }
    : undefined

const proposeDeclaredTier: Signal = (action) =>
  action.declaredTier === undefined
    ? undefined
    : { tier: action.declaredTier, reason: `declared tier: ${action.declaredTier}` }

const proposeLexicon: Signal = (action) => {
  const hit = matchLexicon(action.name, action.command)
  if (hit === 'hard') {
    return { tier: 'restricted', reason: `hard destructive lexicon: ${action.name}` }
  }
  if (hit === 'soft') {
    return { tier: 'destructive', reason: `soft destructive lexicon: ${action.name}` }
  }
  return undefined
}

const proposeUnrecognizedFloor: Signal = (action) =>
  !action.recognized ? { tier: 'restricted', reason: 'unrecognized action fail-safe' } : undefined

const SIGNALS: readonly Signal[] = [
  proposeReadOnly,
  proposeRecognizedMutating,
  proposeDeclaredTier,
  proposeLexicon,
  proposeUnrecognizedFloor,
]

export function classifyRisk(action: RiskActionDescriptor): { riskTier: RiskTier; reason: string } {
  const proposals = SIGNALS.map((signal) => signal(action)).filter(
    (proposal): proposal is Proposal => proposal !== undefined,
  )

  if (proposals.length === 0) {
    return { riskTier: 'restricted', reason: 'no signal fail-safe' }
  }

  const winner = proposals.reduce((highest, proposal) =>
    rank(proposal.tier) > rank(highest.tier) ? proposal : highest,
  )

  return { riskTier: winner.tier, reason: winner.reason }
}
