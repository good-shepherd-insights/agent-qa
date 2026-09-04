/**
 * 413 D-19 baseline profile key and committed pointer body.
 *
 * A baseline is designated per PROFILE, not globally: a number produced by one planner under
 * one matcher and one judge is only a comparator for the same combination. The key is composed
 * from fields the report already stamps (`matcherVersion`, `judge.judgeModelId`,
 * `judge.judgeVersion`) plus the replay planner's resolved model id — nothing is minted here.
 * Honest abstention gets its OWN key (`judge=none|judgeVersion=none`) rather than sharing a
 * judged profile's slot, because a no-judge batch is a different measurement, not a missing one.
 *
 * Hand-off: Phase 415 FLOOR-05 formalises this key and MAY extend it (a planner fingerprint
 * beyond the model id is not stamped on the report today). Extending it changes the committed
 * file name, which is exactly the write-once behaviour we want — a new profile is a new pointer.
 *
 * Composition law: pure string + pure projection, no IO and no clock. The pointer body carries
 * no `designatedAt`: a wall-clock field would make byte-identical re-designation a
 * write-conflict, and git already records when the pointer moved.
 */

/** Single version gate for the committed pointer document (D-19). */
export const BASELINE_POINTER_SCHEMA_VERSION = 1 as const

/** The stamped fields a profile key is composed from. */
export interface BaselineProfileKeyInput {
  plannerModelId: string
  matcherVersion: number
  judgeModelId?: string
  judgeVersion?: number
}

/** The committed body of `reports/baselines/<slugBranch(profileKey)>.json`. */
export interface BaselinePointer {
  schemaVersion: typeof BASELINE_POINTER_SCHEMA_VERSION
  profileKey: string
  batchKey: string
  plannerModelId: string
  matcherVersion: number
  judgeModelId?: string
  judgeVersion?: number
}

/** Compose the D-19 profile key; absent judge fields read `none`, never empty. */
export function composeBaselineProfileKey(input: BaselineProfileKeyInput): string {
  const judgeModelId = input.judgeModelId ?? 'none'
  const judgeVersion = input.judgeVersion ?? 'none'
  return `planner=${input.plannerModelId}|matcher=${input.matcherVersion}|judge=${judgeModelId}|judgeVersion=${judgeVersion}`
}

/**
 * Project the committed pointer. Optional judge fields use the optional-spread idiom so an
 * absent judge omits the key entirely — `committedFileText` must stay byte-stable.
 */
export function projectBaselinePointer(
  input: BaselineProfileKeyInput & { batchKey: string },
): BaselinePointer {
  return {
    schemaVersion: BASELINE_POINTER_SCHEMA_VERSION,
    profileKey: composeBaselineProfileKey(input),
    batchKey: input.batchKey,
    plannerModelId: input.plannerModelId,
    matcherVersion: input.matcherVersion,
    ...(input.judgeModelId === undefined ? {} : { judgeModelId: input.judgeModelId }),
    ...(input.judgeVersion === undefined ? {} : { judgeVersion: input.judgeVersion }),
  }
}
