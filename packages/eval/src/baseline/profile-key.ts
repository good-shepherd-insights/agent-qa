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
 * 415 FLOOR-05 (2026-09-05): v2 keys the resolved replay profile, including the seed POLICY,
 * never its value. A provider `system_fingerprint` is disclosure only (Plan 03 carries it on
 * the report); nothing here reads it. A changed profile names a new committed pointer, while
 * v1 pointers remain readable as history without an invented fingerprint.
 *
 * Composition law: pure string + pure projection, no IO and no clock. The pointer body carries
 * no `designatedAt`: a wall-clock field would make byte-identical re-designation a
 * write-conflict, and git already records when the pointer moved.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import { z } from 'zod'

import { canonicalJson } from '../canonical-json'
import { createPanelIdentity } from '../judge/panel'

/** Single version gate for the committed pointer document (D-19). */
export const BASELINE_POINTER_SCHEMA_VERSION = 2 as const

export type SeedPolicy = 'none' | 'declared'

// prettier-ignore
export const SEED_POLICIES = ['none', 'declared'] as const satisfies readonly SeedPolicy[]

export interface ReplayProfileFingerprintInput {
  provider: string
  modelId: string
  temperature: number
  seedPolicy: SeedPolicy
  capabilities: { vision: boolean; maxOutputTokens?: number }
  modelOverrideKeys: readonly string[]
}

/** The caller resolves capabilities and sorts override keys beside model composition (D-11). */
export function computeReplayProfileFingerprint(input: ReplayProfileFingerprintInput): string {
  return sha256hex(canonicalJson(input))
}

/** The stamped fields a profile key is composed from. */
export interface BaselineProfileKeyInput {
  plannerModelId: string
  fingerprint: string
  matcherVersion: number
  judgeModelId?: string
  judgeVersion?: number
  /** Raw declarations stay separate from their escaped composite; never parse a profile key. */
  judgeMemberModelIds?: readonly string[]
}

/** The committed body of `reports/baselines/<slugBranch(profileKey)>.json`. */
export interface BaselinePointer {
  schemaVersion: typeof BASELINE_POINTER_SCHEMA_VERSION
  profileKey: string
  batchKey: string
  fingerprint: string
  corpusDigest: string
  plannerModelId: string
  matcherVersion: number
  judgeModelId?: string
  judgeVersion?: number
}

/** Compose the D-19 profile key; absent judge fields read `none`, never empty. */
export function composeBaselineProfileKey(input: BaselineProfileKeyInput): string {
  const judge = profileJudgeIdentity(input)
  const judgeModelId = judge.judgeModelId ?? 'none'
  const judgeVersion = judge.judgeVersion ?? 'none'
  return `planner=${input.plannerModelId}|fingerprint=${input.fingerprint}|matcher=${input.matcherVersion}|judge=${judgeModelId}|judgeVersion=${judgeVersion}`
}

function profileJudgeIdentity(input: BaselineProfileKeyInput): { judgeModelId?: string; judgeVersion?: number } {
  if (input.judgeMemberModelIds === undefined) return input
  const identity = input.judgeMemberModelIds.length === 0 ? undefined : createPanelIdentity(input.judgeMemberModelIds)
  if ((input.judgeModelId !== undefined && input.judgeModelId !== identity?.judgeModelId)
    || (input.judgeVersion !== undefined && input.judgeVersion !== identity?.judgeVersion)) {
    throw new TypeError('Judge declaration and stamped profile identity differ')
  }
  return identity === undefined ? {} : { judgeModelId: identity.judgeModelId, judgeVersion: identity.judgeVersion }
}

/**
 * Project the committed pointer. Optional judge fields use the optional-spread idiom so an
 * absent judge omits the key entirely — `committedFileText` must stay byte-stable.
 */
export function projectBaselinePointer(
  input: BaselineProfileKeyInput & { batchKey: string; corpusDigest: string },
): BaselinePointer {
  const judge = profileJudgeIdentity(input)
  return {
    schemaVersion: BASELINE_POINTER_SCHEMA_VERSION,
    profileKey: composeBaselineProfileKey(input),
    batchKey: input.batchKey,
    fingerprint: input.fingerprint,
    corpusDigest: input.corpusDigest,
    plannerModelId: input.plannerModelId,
    matcherVersion: input.matcherVersion,
    ...(judge.judgeModelId === undefined ? {} : { judgeModelId: judge.judgeModelId }),
    ...(judge.judgeVersion === undefined ? {} : { judgeVersion: judge.judgeVersion }),
  }
}

export type BaselinePointerLoad =
  | { kind: 'v2'; pointer: BaselinePointer }
  | {
      kind: 'v1'
      pointer: {
        profileKey: string
        batchKey: string
        plannerModelId: string
        matcherVersion: number
        judgeModelId?: string
        judgeVersion?: number
      }
    }
  | { kind: 'rejected'; reason: string }

const pointerFields = {
  profileKey: z.string(),
  batchKey: z.string(),
  plannerModelId: z.string(),
  matcherVersion: z.number(),
  judgeModelId: z.string().optional(),
  judgeVersion: z.number().optional(),
}

const pointerSchema = z.discriminatedUnion('schemaVersion', [
  z.object({ ...pointerFields, schemaVersion: z.literal(1) }).strict(),
  z
    .object({
      ...pointerFields,
      schemaVersion: z.literal(BASELINE_POINTER_SCHEMA_VERSION),
      fingerprint: z.string(),
      corpusDigest: z.string(),
    })
    .strict(),
])

/** Strict per version: v1 is historical evidence, never a resolved-profile comparator. */
export function guardBaselinePointer(value: unknown): BaselinePointerLoad {
  const parsed = pointerSchema.safeParse(value)
  if (!parsed.success) {
    return {
      kind: 'rejected',
      reason: parsed.error.issues
        .map(issue => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    }
  }
  if (parsed.data.schemaVersion === 1) {
    const { schemaVersion: _schemaVersion, ...pointer } = parsed.data
    return { kind: 'v1', pointer }
  }
  return { kind: 'v2', pointer: parsed.data }
}
