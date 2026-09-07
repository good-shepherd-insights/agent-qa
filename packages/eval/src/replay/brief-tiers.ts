import { assembleBriefTiers, renderObservationLine } from '@vostride/agent-qa-runner'
import type { ServedBrief } from '@vostride/agent-qa-schema'
import { reverseBriefDelta, type DeclaredBriefDelta } from './brief-delta'

export type BriefSource = 'proof' | 'rendered' | 'empty'
export const BRIEF_SOURCES = [
  'proof',
  'rendered',
  'empty',
] as const satisfies readonly BriefSource[]

export type TurnMatch = 'exact' | 'uniform'
export const TURN_MATCHES = ['exact', 'uniform'] as const satisfies readonly TurnMatch[]

/** A populated brief whose recorded evidence cannot supply faithful replay tiers. */
export class UnrenderableBriefError extends Error {
  readonly detail: string

  constructor(detail: string) {
    super(detail)
    this.name = 'UnrenderableBriefError'
    this.detail = detail
  }
}

export interface RebuiltKnowledgeTiers {
  briefSource: BriefSource
  turnMatch?: TurnMatch
  knowledgePolicyL0?: string
  knowledgeBriefL1?: string
  knowledgeBriefL2?: string
}

/** Rebuild only recorded tier ingredients; proof text already carries its serving frame. */
export function rebuildKnowledgeTiers(
  brief: ServedBrief,
  decisionOrdinal: number,
  declaredBriefDelta?: DeclaredBriefDelta,
): RebuiltKnowledgeTiers {
  // Validate selection on the exactly reversed proof. One declared turn edit may
  // break uniformity, but cannot confer authority to select an unrelated turn.
  let selected: { turnOrdinal: number; turnMatch: TurnMatch } | undefined
  if (declaredBriefDelta !== undefined && brief.proof !== undefined) {
    const original = reverseBriefDelta({ servedBrief: brief }, declaredBriefDelta).servedBrief
    const turns = original.proof!.promptTurns
    const first = turns[0]
    const exact = turns.find((turn) => turn.turnOrdinal === decisionOrdinal)
    const uniform =
      first !== undefined &&
      turns.every(
        (turn) =>
          turn.policyL0 === first.policyL0 &&
          turn.learnedL1 === first.learnedL1 &&
          turn.learnedL2 === first.learnedL2,
      )
    const turn = exact ?? (uniform ? first : undefined)
    if (
      turn === undefined ||
      turn.turnOrdinal !== declaredBriefDelta.turnOrdinal ||
      turns.filter((row) => row.turnOrdinal === turn.turnOrdinal).length !== 1
    ) {
      throw new UnrenderableBriefError(
        'declared brief delta does not select the original proof turn',
      )
    }
    selected = {
      turnOrdinal: turn.turnOrdinal,
      turnMatch: exact === undefined ? 'uniform' : 'exact',
    }
  }
  if (brief.channel1.length + brief.channel2.length + brief.channel3.length === 0) {
    return { briefSource: 'empty' }
  }

  const turns = brief.proof?.promptTurns ?? []
  const first = turns[0]
  if (first !== undefined) {
    const exact = turns.find((turn) => turn.turnOrdinal === decisionOrdinal)
    const uniform = turns.every(
      (turn) =>
        turn.policyL0 === first.policyL0 &&
        turn.learnedL1 === first.learnedL1 &&
        turn.learnedL2 === first.learnedL2,
    )
    const turn =
      selected === undefined
        ? (exact ?? (uniform ? first : undefined))
        : turns.find((turn) => turn.turnOrdinal === selected.turnOrdinal)
    if (turn === undefined) {
      throw new UnrenderableBriefError(
        `no promptTurn matches decisionOrdinal ${decisionOrdinal} (turnOrdinals ${turns.map((item) => item.turnOrdinal).join(',')} differ)`,
      )
    }
    return {
      briefSource: 'proof',
      turnMatch: selected?.turnMatch ?? (exact !== undefined ? 'exact' : 'uniform'),
      ...(turn.policyL0.trim() ? { knowledgePolicyL0: turn.policyL0 } : {}),
      ...(turn.learnedL1.trim() ? { knowledgeBriefL1: turn.learnedL1 } : {}),
      ...(turn.learnedL2.trim() ? { knowledgeBriefL2: turn.learnedL2 } : {}),
    }
  }

  if (brief.channel1.length === 0) {
    throw new UnrenderableBriefError(
      'brief populated on channel2/channel3 only and carries no proof',
    )
  }
  // BriefLine lacks serving annotations, so the shared renderer's approximation is explicit.
  const rendered = brief.channel1.map((line) => ({
    line: renderObservationLine(line),
    tier: line.tier,
  }))
  const tiers = assembleBriefTiers(
    '',
    brief.channel1.filter((line) => line.tier === 'L0').map((line) => line.summary),
    rendered,
  )
  return {
    briefSource: 'rendered',
    ...(tiers.L0.trim() ? { knowledgePolicyL0: tiers.L0 } : {}),
    ...(tiers.L1.trim() ? { knowledgeBriefL1: tiers.L1 } : {}),
    ...(tiers.L2.trim() ? { knowledgeBriefL2: tiers.L2 } : {}),
  }
}
