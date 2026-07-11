// D-12/D-14 judge eligibility. Never-self-judge is a pure, total, two-sided check:
// disjointness is assessed against BOTH the replayed planner's family (the direct
// self-preference circuit) and the recorded model's family when one is supplied (the
// gold-familiarity bias). D-12 posture: validated ONCE at composition time by the caller,
// soft-but-loud — the refusal is data carried on every tie's stamp, never a thrown error,
// and the batch always proceeds deterministically. D-13 ratification note: the ratified
// "provider -> family" phrasing is implemented as model-id token matching because a
// ModelProfile provider value is a transport id ('openai-compatible' serves Llama, Qwen,
// and DeepSeek alike) and can never establish family; unknown resolves undefined and is
// treated as same-family, therefore forbidden — never a guess.

import { resolveJudgeFamily } from './family'
import type { JudgeFamily } from './family'

/**
 * Closed eligibility union. The no-eligible-judge variant carries every ATTEMPTED family
 * resolution as plain strings (undefined entries omitted, typed-absent) so the D-12 refusal
 * is loud enough to reconstruct exactly why the judge was refused.
 */
export type JudgeEligibility =
  | { eligible: true; judgeModelId: string; judgeFamily: JudgeFamily }
  | { eligible: false; reason: 'no-judge-configured' }
  | {
      eligible: false
      reason: 'no-eligible-judge'
      families: { judge?: string; replayed?: string; recorded?: string }
    }

/**
 * Assess judge eligibility once for a scoring run. Pure and total: never throws for any
 * input combination. Forbidden when the judge family is unknown, the replayed family is
 * unknown, the two are equal, or a supplied recorded model resolves unknown or equal to the
 * judge family. An absent recorded model skips that side entirely (D-14 "when resolvable").
 */
export function assessJudgeEligibility(input: {
  judgeModelId?: string
  replayedModelId: string
  recordedModelId?: string
}): JudgeEligibility {
  const { judgeModelId, replayedModelId, recordedModelId } = input
  if (judgeModelId === undefined) {
    return { eligible: false, reason: 'no-judge-configured' }
  }

  const judge = resolveJudgeFamily(judgeModelId)
  const replayed = resolveJudgeFamily(replayedModelId)
  const recorded =
    recordedModelId === undefined ? undefined : resolveJudgeFamily(recordedModelId)

  const forbidden =
    judge === undefined ||
    replayed === undefined ||
    judge === replayed ||
    (recordedModelId !== undefined && (recorded === undefined || recorded === judge))

  if (forbidden) {
    return {
      eligible: false,
      reason: 'no-eligible-judge',
      families: {
        ...(judge === undefined ? {} : { judge }),
        ...(replayed === undefined ? {} : { replayed }),
        ...(recorded === undefined ? {} : { recorded }),
      },
    }
  }

  return { eligible: true, judgeModelId, judgeFamily: judge }
}
