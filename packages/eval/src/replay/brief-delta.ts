import type { BriefLine, ServedBrief } from '@vostride/agent-qa-schema'
import { OBSERVATION_LINE_PREFIX } from '@vostride/agent-qa-runner'
import { APP_OBSERVED_DATA_CLOSE, APP_OBSERVED_DATA_OPEN } from '@vostride/agent-qa-safety'
import { canonicalJson } from '../canonical-json'
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
  /** Index of exactly one rendered line within the selected proof turn's tier text. */
  position: number
  /** Channel-1 insertion/removal index, distinct from the rendered tier-line position. */
  channel1Position: number
}

export type LocateBriefLineOutcome =
  | { kind: 'located'; tier: BriefTier; index: number }
  | { kind: 'brief-line-not-found'; id: string; tier: BriefTier }
  | { kind: 'ambiguous'; id: string; tier: BriefTier; matches: number[] }

export function locateBriefLine(
  tierText: string,
  line: BriefLine,
  tier: BriefTier,
): LocateBriefLineOutcome {
  const prefix = OBSERVATION_LINE_PREFIX + line.summary
  const matches = tierText.split('\n').flatMap((text, index) =>
    text !== APP_OBSERVED_DATA_OPEN && text !== APP_OBSERVED_DATA_CLOSE && text.startsWith(prefix)
      ? [index]
      : [],
  )
  if (matches.length === 0) return { kind: 'brief-line-not-found', id: line.id, tier }
  if (matches.length > 1) return { kind: 'ambiguous', id: line.id, tier, matches }
  return { kind: 'located', tier, index: matches[0]! }
}

const TIER_FIELDS = { L0: 'policyL0', L1: 'learnedL1', L2: 'learnedL2' } as const

function assertPosition(position: number, maximum: number): void {
  if (!Number.isSafeInteger(position) || position < 0 || position > maximum) {
    throw new TypeError('Brief delta position is out of range')
  }
}

function editBriefDelta<T extends { servedBrief: ServedBrief }>(
  leg: T,
  delta: DeclaredBriefDelta,
  inject: boolean,
): T {
  if (delta.renderedLine.length === 0 || delta.renderedLine.includes('\n')) {
    throw new TypeError('Brief delta must carry exactly one nonempty rendered line')
  }
  if (delta.line.tier !== delta.tier || !Object.hasOwn(TIER_FIELDS, delta.tier)) {
    throw new TypeError('Brief delta tier must match its line')
  }
  assertPosition(delta.position, Number.MAX_SAFE_INTEGER)
  const clone = structuredClone(leg)
  const channel = clone.servedBrief.channel1
  const matches = channel.flatMap((line, index) => line.id === delta.line.id ? [index] : [])
  assertPosition(delta.channel1Position, channel.length - (inject ? 0 : 1))
  if (inject) {
    if (matches.length !== 0) throw new TypeError('Brief delta ID is already present')
    channel.splice(delta.channel1Position, 0, structuredClone(delta.line))
  } else {
    if (matches.length !== 1 || matches[0] !== delta.channel1Position ||
      canonicalJson(channel[delta.channel1Position]) !== canonicalJson(delta.line)) {
      throw new TypeError('Brief delta removal must match the located channel1 line')
    }
    channel.splice(delta.channel1Position, 1)
  }

  const proof = clone.servedBrief.proof
  if (proof !== undefined) {
    const turns = proof.promptTurns.filter(turn => turn.turnOrdinal === delta.turnOrdinal)
    if (turns.length !== 1) throw new TypeError('Brief delta must identify exactly one proof turn')
    const turn = turns[0]!
    const field = TIER_FIELDS[delta.tier]
    const lines = turn[field] === '' ? [] : turn[field].split('\n')
    assertPosition(delta.position, lines.length - (inject ? 0 : 1))
    if (inject) lines.splice(delta.position, 0, delta.renderedLine)
    else {
      if (lines[delta.position] !== delta.renderedLine) {
        throw new TypeError('Brief delta removal must match the located rendered line')
      }
      lines.splice(delta.position, 1)
    }
    turn[field] = lines.join('\n')
  }
  return clone
}

/** Apply only the declared structural edit; all other evidence remains verbatim on a clone. */
export function applyBriefDelta(
  leg: CassetteInputLeg,
  delta: DeclaredBriefDelta,
): CassetteInputLeg {
  return editBriefDelta(leg, delta, delta.kind === 'injected')
}

/** Restore the exact canonical leg using both recorded positions, without retained hidden state. */
export function reverseBriefDelta<T extends { servedBrief: ServedBrief }>(
  leg: T,
  delta: DeclaredBriefDelta,
): T {
  return editBriefDelta(leg, delta, delta.kind === 'removed')
}
