import { JUDGE_CONFIG } from './config'
import { assessJudgeEligibility } from './adjudicate'
import type { JudgeEligibility } from './adjudicate'
import { displayJudgeFamilies, judgeFamiliesIntersect, resolveJudgeFamilies } from './family'
import type { JudgePort } from './port'
import type { JudgeIdentityBlock, JudgeMemberOutcome, JudgePairwiseOutcome } from '../match/score'

/** Ordered existing bindings; a panel never manufactures its own transport. */
export interface JudgePanelPort {
  judgeModelId: string
  members: readonly JudgePort[]
}

export type PanelMemberOutcome = JudgeMemberOutcome
export type PanelPoolingMode = 'max' | 'avg'

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, char => char.codePointAt(0)!)
  const right = Array.from(b, char => char.codePointAt(0)!)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}

/** Escape every delimiter per component before joining; raw IDs remain the eligibility input. */
export function createPanelIdentity(memberModelIds: readonly string[]): JudgeIdentityBlock {
  const members = [...memberModelIds].sort(compareCodePoints).map(judgeModelId => ({
    judgeModelId, judgeFamily: displayJudgeFamilies(resolveJudgeFamilies(judgeModelId)) ?? '',
  }))
  const common = { judgeVersion: JUDGE_CONFIG.judgeVersion,
    confidenceThreshold: JUDGE_CONFIG.confidenceThreshold }
  if (members.length === 1) return { ...members[0], ...common }
  return { judgeModelId: `panel:${members.map(member => encodeURIComponent(member.judgeModelId)).join('+')}`,
    judgeFamily: members.map(member => member.judgeFamily).sort().join('+'),
    ...common, panelSize: members.length, members }
}

/** Whole declaration refusal: never prune a member or apply a panel family override. */
export function assessPanelEligibility(input: {
  memberModelIds: readonly string[]
  replayedModelId: string
  recordedModelId?: string
  allowSameFamily?: boolean
}): JudgeEligibility {
  const { replayedModelId, recordedModelId } = input
  // Stable disclosure and first collision, without deduplicating resolved aliases.
  const memberModelIds = [...input.memberModelIds].sort(compareCodePoints)
  if (memberModelIds.length <= 1) return assessJudgeEligibility({ ...input, judgeModelId: memberModelIds[0] })
  const sets = memberModelIds.map(resolveJudgeFamilies)
  const replayed = resolveJudgeFamilies(replayedModelId)
  const recorded = recordedModelId === undefined ? undefined : resolveJudgeFamilies(recordedModelId)
  const families = {
    replayed: displayJudgeFamilies(replayed),
    ...(recorded === undefined ? {} : { recorded: displayJudgeFamilies(recorded) }),
    members: memberModelIds.map((judgeModelId, index) => ({ judgeModelId,
      ...(sets[index].size === 0 ? {} : { judgeFamily: displayJudgeFamilies(sets[index]) }) })),
  }
  const refuse = (offendingPair?: readonly [string, string]): JudgeEligibility => ({
    eligible: false, reason: 'no-eligible-judge',
    families: { ...families, ...(offendingPair === undefined ? {} : { offendingPair }) },
  })
  if (memberModelIds.length > JUDGE_CONFIG.maxPanelMembers || replayed.size === 0 ||
    recorded?.size === 0 || sets.some(set => set.size === 0)) return refuse()
  for (let i = 0; i < sets.length; i++) {
    if (judgeFamiliesIntersect(sets[i], replayed)) return refuse([memberModelIds[i], replayedModelId])
    if (recorded !== undefined && judgeFamiliesIntersect(sets[i], recorded)) {
      return refuse([memberModelIds[i], recordedModelId!])
    }
    for (let j = 0; j < i; j++) {
      if (judgeFamiliesIntersect(sets[i], sets[j])) return refuse([memberModelIds[j], memberModelIds[i]])
    }
  }
  return { eligible: true, ...createPanelIdentity(memberModelIds) }
}

/** Binary max means a strict settled majority with a quorum of two, never a confidence sum. */
export function poolPanel(members: readonly PanelMemberOutcome[], mode?: 'max'): JudgePairwiseOutcome
export function poolPanel(scores: readonly number[], mode: 'avg'):
  | number
  | { kind: 'abstained'; cause: 'below-quorum' }
  | { kind: 'invalid-input'; reason: 'invalid-score'; index: number }
export function poolPanel(input: readonly PanelMemberOutcome[] | readonly number[], mode: PanelPoolingMode = 'max'):
  | JudgePairwiseOutcome | number
  | { kind: 'invalid-input'; reason: 'invalid-score'; index: number } {
  if (mode === 'avg') {
    const scores = input as readonly number[]
    const index = scores.findIndex(score => !Number.isFinite(score) || score < 0 || score > 1)
    if (index !== -1) return { kind: 'invalid-input', reason: 'invalid-score', index }
    if (scores.length < 2) return { kind: 'abstained', cause: 'below-quorum' }
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }
  const settled = (input as readonly PanelMemberOutcome[]).map(member => member.outcome)
    .filter((outcome): outcome is Extract<JudgePairwiseOutcome, { kind: 'settled' }> => outcome.kind === 'settled')
  if (settled.length < 2) return { kind: 'abstained', cause: 'below-quorum' }
  const equivalent = settled.filter(outcome => outcome.resolution === 'equivalent')
  const majority = equivalent.length > settled.length / 2 ? equivalent
    : settled.filter(outcome => outcome.resolution === 'different')
  if (majority.length <= settled.length / 2) return { kind: 'abstained', cause: 'panel-disagreement' }
  const ranks = { low: 0, medium: 1, high: 2 }
  const confidence = majority.reduce((min, outcome) => ranks[outcome.confidence] < ranks[min] ? outcome.confidence : min, majority[0].confidence)
  return { kind: 'settled', resolution: majority[0].resolution, confidence }
}
