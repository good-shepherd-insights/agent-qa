import type { BriefLine } from '@vostride/agent-qa-schema'
import type { CassetteInputLeg } from '../cassette/input-leg'

export type BriefDeltaKind = 'injected' | 'removed'
export const BRIEF_DELTA_KINDS = ['injected', 'removed'] as const satisfies readonly BriefDeltaKind[]
export type BriefTier = 'L0' | 'L1' | 'L2'

export interface DeclaredBriefDelta {
  kind: BriefDeltaKind
  line: BriefLine
  tier: BriefTier
  renderedLine: string
  turnOrdinal: number
  position: number
  /** Channel-1 insertion/removal index, distinct from the rendered tier-line position. */
  channel1Position: number
}

export type LocateBriefLineOutcome =
  | { kind: 'located'; tier: BriefTier; index: number }
  | { kind: 'brief-line-not-found'; id: string; tier: BriefTier }
  | { kind: 'ambiguous'; id: string; tier: BriefTier; matches: number[] }

export function locateBriefLine(
  _tierText: string,
  _line: BriefLine,
  _tier: BriefTier,
): LocateBriefLineOutcome {
  throw new Error('RED: brief-line location is not implemented')
}

export function applyBriefDelta(
  _leg: CassetteInputLeg,
  _delta: DeclaredBriefDelta,
): CassetteInputLeg {
  throw new Error('RED: brief delta application is not implemented')
}

export function reverseBriefDelta(
  _leg: CassetteInputLeg,
  _delta: DeclaredBriefDelta,
): CassetteInputLeg {
  throw new Error('RED: brief delta reversal is not implemented')
}
