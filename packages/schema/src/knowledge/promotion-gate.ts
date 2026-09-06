import type { BundleKind, FactSubtype } from '../delta/envelope'
import type { Anchor } from '../identity/anchor'
import type { EvidenceToken } from '../ids/record-id'
import type { DistilledObservation } from './distilled-observation'
import type { OriginClass } from './outcome-event'
import type { BundleStatus } from './trust-fold'
import type { ScopeKey } from '../identity/scope-key'
import type { PromotionPath } from './promotion-path'
import { standingReceiptsByGate, type GateReceipt } from './gate-receipt'
export { PROMOTION_PATHS, PROMOTION_PATH_STRENGTH, strongerPromotionPath } from './promotion-path'
export type { PromotionPath } from './promotion-path'

export type PromotionOutcome =
  | { kind: 'promoted'; promotionPath: PromotionPath; citedReceiptDigests: readonly string[] }
  | { kind: 'already-active'; promotionPath?: PromotionPath }
export type GateReceiptRecordOutcome = { kind: 'appended' } | { kind: 'duplicate' }
export interface PromotionCandidateProvenance {
  runIds: readonly string[]
  receiptDigests: readonly string[]
  capturedAtOrdinals: readonly number[]
}
export interface PromotionPostureCandidate {
  id: string
  product: string
  scope: ScopeKey
  provenance: PromotionCandidateProvenance
}
export type ResolvePromotionPosture = (
  candidate: PromotionPostureCandidate,
) => PromotionGatePosture | undefined

export type PromotionGateObservation = Pick<DistilledObservation, 'element' | 'error'>

export const GATE_SET_VERDICT_WORDS = ['ok', 'empty-gate-set', 'unprovenanced-candidate'] as const
export type GateSetVerdictWord = (typeof GATE_SET_VERDICT_WORDS)[number]
export interface PromotionJudgePosture {
  capable: boolean
  reason: 'eligible' | 'no-judge-configured' | 'no-eligible-judge'
  judgeFamily?: string
}
export interface PromotionCanaryPosture {
  kind: 'provided' | 'not-provided'
  attributedRows?: number
  rarePathEligible: boolean
}
export interface PromotionPostureScope {
  partition: string
  resolution: 'product-key' | 'default-fallback'
}
interface PromotionSplitCounts {
  natural: number
  heldOutShared: number
  heldOutPrivate: number
  adversarial: number
}
export interface PromotionGateSetCounts extends PromotionSplitCounts {
  excludedCount: number
  remaining?: { before: PromotionSplitCounts; after: PromotionSplitCounts }
}
export interface ResolvedPromotionGatePosture {
  kind: 'resolved'
  replayGateAvailable: boolean
  gateSetNonEmpty: boolean
  gateSetVerdict: GateSetVerdictWord
  corpusDigest: string
  minimumGateSet: number
  counts: PromotionGateSetCounts
  scope: PromotionPostureScope
  judge: PromotionJudgePosture
  canary: PromotionCanaryPosture
}
export interface UnavailablePromotionGatePosture {
  kind: 'unavailable'
  replayGateAvailable: boolean
  refusals: readonly string[]
}
export type PromotionGatePosture = ResolvedPromotionGatePosture | UnavailablePromotionGatePosture

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
  /** V4: surviving code-derived confirmation identities from canonical outcome truth. */
  confirmedOutcomeEvidenceTokens: readonly EvidenceToken[]
  hasUserDeprecateInLineage: boolean
  memoryOffForAnchorGroup: boolean
  /**
   * 414 D-14: OPTIONAL and additive. Absent means "no replay gate exists on this host" — the
   * v51 BYOM floor of `spec/v2/memory.md` §12.2, whose verdicts must stay byte-identical — so
   * a caller that knows nothing about gate sets keeps the pre-414 answer for every input.
   */
  gatePosture?: PromotionGatePosture
  gateReceipts?: readonly GateReceipt[]
}

export type PromotionGateHoldReason =
  | 'kind-excluded'
  | 'not-candidate'
  | 'window-closed'
  | 'withheld'
  | 'needs-enrichment'
  | 'evidence-incomplete'
  | 'no-confirmed-evidence'
  | 'no-element-observation'
  | 'missing-root-cause'
  | 'memory-off-anchor'
  | 'user-deprecated'
  | 'empty-gate-set'
  | 'gate1-receipt-required'
  | 'gate2-receipt-required'
  | 'gate-failed'
  | 'gate-abstained'
  | 'receipt-stale'
  | 'unprovenanced-candidate'
  | 'posture-unavailable'

/**
 * The v54 deletion bar on the hold-reason vocabulary (414 D-14 / D-22).
 *
 * This is a PROJECTION of the union above, not a second declaration of it: the `satisfies`
 * clause makes an entry that names no member a compile error, and the reverse direction (a
 * member no entry names) is pinned by the never-bar in `__tests__/promotion-gate.test-d.ts`.
 * The hand-spelled runtime cell in `__tests__/promotion-gate-hold-reasons.test.ts` catches the
 * third case — a member widened in through a cast, which satisfies both compile-time halves.
 *
 * `promotionHoldReason` is a PERSISTED value in knowledge-local commit outcomes and in CLI
 * output, so a member joining or leaving this list is a coordinated change, never a local
 * edit. Phase 416 (PROM-04) extends the vocabulary THROUGH this bar rather than creating it.
 */
export const PROMOTION_GATE_HOLD_REASONS = [
  'kind-excluded',
  'not-candidate',
  'window-closed',
  'withheld',
  'needs-enrichment',
  'evidence-incomplete',
  'no-confirmed-evidence',
  'no-element-observation',
  'missing-root-cause',
  'memory-off-anchor',
  'user-deprecated',
  'empty-gate-set',
  'gate1-receipt-required',
  'gate2-receipt-required',
  'gate-failed',
  'gate-abstained',
  'receipt-stale',
  'unprovenanced-candidate',
  'posture-unavailable',
] as const satisfies readonly PromotionGateHoldReason[]

export type PromotionGateVerdict =
  | { verdict: 'promote'; promotionPath: PromotionPath; citedReceiptDigests: readonly string[] }
  | { verdict: 'hold'; reason: PromotionGateHoldReason }

function hold(reason: PromotionGateHoldReason): PromotionGateVerdict {
  return { verdict: 'hold', reason }
}

function promoteVia(input: PromotionGateInput): PromotionGateVerdict {
  const posture = input.gatePosture
  if (posture === undefined || posture.kind !== 'resolved' || !posture.replayGateAvailable) {
    return { verdict: 'promote', promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [] }
  }
  const standing = standingReceiptsByGate(input.gateReceipts ?? [])
  const g1 = standing.find(receipt => receipt.gate === 1)
  if (g1 === undefined) return hold('gate1-receipt-required')
  if (g1.verdict === 'fail') return hold('gate-failed')
  if (g1.verdict === 'abstain') return hold('gate-abstained')
  if (g1.corpusVersion.corpusDigest !== posture.corpusDigest) return hold('receipt-stale')

  const g2 = standing.find(receipt => receipt.gate === 2)
  if (g2 !== undefined) {
    if (g2.verdict === 'fail') return hold('gate-failed')
    if (g2.verdict === 'abstain') return hold('gate-abstained')
    if (g2.corpusVersion.corpusDigest !== posture.corpusDigest) return hold('receipt-stale')
    if (g2.producedAtOrdinal >= g1.producedAtOrdinal) {
      return { verdict: 'promote', promotionPath: 'gate1+gate2',
        citedReceiptDigests: [g1.receiptDigest, g2.receiptDigest] }
    }
  }
  if (posture.canary.rarePathEligible === true) {
    return { verdict: 'promote', promotionPath: 'gate1-lower-trust',
      citedReceiptDigests: [g1.receiptDigest] }
  }
  return hold('gate2-receipt-required')
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
  const elements = input.distilledObservations.flatMap((observation) =>
    observation.element === undefined ? [] : [observation.element],
  )
  return elements.length === 1 && elements[0]?.naturalKey === naturalKey
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
  const posture = input.gatePosture
  if (posture?.kind === 'unavailable') return hold('posture-unavailable')
  if (posture?.replayGateAvailable === true && posture.gateSetVerdict === 'unprovenanced-candidate') {
    return hold('unprovenanced-candidate')
  }
  if (posture?.replayGateAvailable === true && posture.gateSetNonEmpty === false) {
    return hold('empty-gate-set')
  }
  const g3 = standingReceiptsByGate(input.gateReceipts ?? []).find(receipt => receipt.gate === 3)
  if (g3?.verdict === 'pass') {
    return { verdict: 'promote', promotionPath: 'user-sovereign',
      citedReceiptDigests: [g3.receiptDigest] }
  }
  if (input.withheld) return hold('withheld')
  if (input.needsEnrichment) return hold('needs-enrichment')
  if (input.evidenceIncomplete) return hold('evidence-incomplete')
  if (!input.confirmedOutcomeEvidenceTokens.some((token) => token.length > 0)) {
    return hold('no-confirmed-evidence')
  }
  if (input.memoryOffForAnchorGroup) return hold('memory-off-anchor')
  if (input.hasUserDeprecateInLineage) return hold('user-deprecated')

  if (input.kind === 'fact') {
    return hasMatchingElementObservation(input)
      ? promoteVia(input)
      : hold('no-element-observation')
  }

  return input.distilledObservations.some(
    (observation) => observation.error?.rootCauseClass !== undefined,
  )
    ? promoteVia(input)
    : hold('missing-root-cause')
}
