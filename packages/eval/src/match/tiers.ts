import type { Action, ScreenStateMetadata } from '@vostride/agent-qa-schema'

import type { CassetteSidecarLeg } from '../cassette/sidecar-leg'
import type { DecisionIdentity } from '../replay/identity'
import { MATCHER_CONFIG } from './config'
import type { IdentityLadderLevel } from './config'
import { classifyAnchorLadder } from './ladder'
import { classifyOpClass, opClassEquivalent } from './op-class'

/** Match-time operation-class verdict from the D-01 hard gate. */
export type OpClassVerdict =
  | { kind: 'match'; opClass: string }
  | { kind: 'mismatch'; goldClass: string; candidateClass: string }

/** Named D-11 element-identity evidence, including every counted degradation cause. */
export type ElementIdentityVerdict =
  | { kind: 'scored'; level: IdentityLadderLevel; numeric: number; tier: 2 | 3 }
  | {
      kind: 'unscorable'
      cause: 'no-gold-evidence' | 'no-candidate-geometry' | 'coordspace-mismatch'
    }
  | { kind: 'not-evaluated' }

/** Highest deterministic tier reached together with the two verdict axes produced here. */
export interface TierMatchResult {
  tierReached: 1 | 2 | 3
  opClass: OpClassVerdict
  elementIdentity: ElementIdentityVerdict
}

export interface MatchTierCandidate {
  identity: DecisionIdentity
  action: Action
}

function scoredIdentity(level: IdentityLadderLevel, tier: 2 | 3): ElementIdentityVerdict {
  return {
    kind: 'scored',
    level,
    numeric: MATCHER_CONFIG.identityLadder[level],
    tier,
  }
}

function hasCandidatePoint(action: Action): boolean {
  const view = action as unknown as Record<string, unknown>
  return typeof view.x === 'number' && typeof view.y === 'number'
}

function scoreTier3(
  _action: Action,
  _stateMetadata?: ScreenStateMetadata,
): ElementIdentityVerdict {
  return { kind: 'unscorable', cause: 'no-candidate-geometry' }
}

/**
 * Run the D-01/D-11 tier router. The operation-class check is the first operation and returns
 * immediately on mismatch, so neither identity ladder nor geometry work can run after a hard
 * tier-1 miss. Matcher constants flow only from the frozen MATCHER_CONFIG import.
 */
export function runMatchTiers(
  sidecar: CassetteSidecarLeg,
  candidate: MatchTierCandidate,
  stateMetadata?: ScreenStateMetadata,
): TierMatchResult {
  const goldClass = classifyOpClass(sidecar.opClass)
  const candidateClass = classifyOpClass(candidate.identity.opClass)

  if (!opClassEquivalent(sidecar.opClass, candidate.identity.opClass)) {
    return {
      tierReached: 1,
      opClass: { kind: 'mismatch', goldClass, candidateClass },
      elementIdentity: { kind: 'not-evaluated' },
    }
  }

  const opClass: OpClassVerdict = { kind: 'match', opClass: goldClass }

  if (sidecar.goldAnchor !== undefined) {
    if (candidate.identity.target !== undefined) {
      const level = classifyAnchorLadder(
        candidate.identity.target,
        sidecar.goldAnchor,
        sidecar.equivalenceSet,
      )
      return { tierReached: 2, opClass, elementIdentity: scoredIdentity(level, 2) }
    }

    if (sidecar.annotation !== undefined && hasCandidatePoint(candidate.action)) {
      return {
        tierReached: 3,
        opClass,
        elementIdentity: scoreTier3(candidate.action, stateMetadata),
      }
    }

    return { tierReached: 2, opClass, elementIdentity: scoredIdentity('miss', 2) }
  }

  if (sidecar.annotation !== undefined) {
    return {
      tierReached: 3,
      opClass,
      elementIdentity: scoreTier3(candidate.action, stateMetadata),
    }
  }

  return {
    tierReached: 1,
    opClass,
    elementIdentity: { kind: 'unscorable', cause: 'no-gold-evidence' },
  }
}
