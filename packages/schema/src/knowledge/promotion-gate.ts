import type { BundleKind, FactSubtype } from '../delta/envelope'
import type { Anchor } from '../identity/anchor'
import type { DistilledObservation } from './distilled-observation'
import type { OriginClass } from './outcome-event'
import type { BundleStatus } from './trust-fold'

export type PromotionGateObservation = Pick<DistilledObservation, 'element' | 'error'>

/** Bundle-derivable evidence only; callers assemble this view from canonical bundle truth. */
export interface PromotionGateInput {
  kind: BundleKind
  subtype?: FactSubtype
  status: BundleStatus
  validityOpen: boolean
  anchors: readonly Anchor[]
  originClass: OriginClass
  withheld: boolean
  needsEnrichment: boolean
  evidenceIncomplete: boolean
  distilledObservations: readonly PromotionGateObservation[]
  hasUserDeprecateInLineage: boolean
  memoryOffForAnchorGroup: boolean
}

export type PromotionGateHoldReason =
  | 'kind-excluded'
  | 'not-candidate'
  | 'window-closed'
  | 'withheld'
  | 'needs-enrichment'
  | 'evidence-incomplete'
  | 'no-element-observation'
  | 'missing-root-cause'
  | 'memory-off-anchor'
  | 'user-deprecated'

export type PromotionGateVerdict =
  | { verdict: 'promote' }
  | { verdict: 'hold'; reason: PromotionGateHoldReason }

function hold(reason: PromotionGateHoldReason): PromotionGateVerdict {
  return { verdict: 'hold', reason }
}

function promotionElementAnchor(
  input: PromotionGateInput,
): Extract<Anchor, { t: 'el' }> | undefined {
  const primary = input.anchors[0]
  if (primary?.t === 'el') return primary
  if (primary?.t !== 'page' || input.subtype !== 'navigational') return undefined
  return input.anchors.find(
    (anchor): anchor is Extract<Anchor, { t: 'el' }> => anchor.t === 'el',
  )
}

function hasMatchingElementObservation(input: PromotionGateInput): boolean {
  const anchor = promotionElementAnchor(input)
  if (anchor?.ordinal === undefined) return false
  const naturalKey = `${anchor.role}:${anchor.name}:${anchor.ordinal}`
  return input.distilledObservations.some(
    (observation) => observation.element?.naturalKey === naturalKey,
  )
}

/**
 * 379 A2 / D-16 / D-18 RATIFICATION: promotion keys on durable evidence, not the authorship
 * path. An evidence-complete deterministic-fallback fact promotes; a fallback Add lacking the
 * gate evidence (for example, needs-enrichment or ambiguous element evidence) remains candidate.
 * This pure predicate performs no loading and has no provider, port, or model dependency.
 */
export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateVerdict {
  if (input.kind !== 'fact' && input.kind !== 'caution') return hold('kind-excluded')
  if (input.status !== 'candidate') return hold('not-candidate')
  if (!input.validityOpen) return hold('window-closed')
  if (input.withheld) return hold('withheld')
  if (input.needsEnrichment) return hold('needs-enrichment')
  if (input.evidenceIncomplete) return hold('evidence-incomplete')
  if (input.memoryOffForAnchorGroup) return hold('memory-off-anchor')
  if (input.hasUserDeprecateInLineage) return hold('user-deprecated')

  if (input.kind === 'fact') {
    return hasMatchingElementObservation(input)
      ? { verdict: 'promote' }
      : hold('no-element-observation')
  }

  return input.distilledObservations.some(
    (observation) => observation.error?.rootCauseClass !== undefined,
  )
    ? { verdict: 'promote' }
    : hold('missing-root-cause')
}
