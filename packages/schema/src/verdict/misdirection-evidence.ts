// The circularity guard's evidence contracts (Phase 422, plan 11 — D-17/D-19/D-20).
//
// A no-trust-change verdict says "the served memory was not the problem". That is exactly the
// sentence a misdirected author would write to shield the record that misled it, so the claim
// has never been allowed to stand on its own word. Phase 389 made the CLAIM checkable: a bare
// boolean had to be `true` when candidate or low-trust memory sat on the failing path. This
// module makes the EVIDENCE checkable, in three pieces that are deliberately separate:
//
//   D-17 — MEMBERSHIP IS CODE-OWNED. `deriveMemoryOnPath` reads the run's OWN served briefs.
//          The verdict may DECLARE `memoryOnPath`, but the declaration is compared against
//          recomputation and never substituted for it: a forged array (naming fewer records,
//          or downgrading a pre-promotion candidate to a probation canary) and an omitted
//          array are both powerless, because the gate is keyed on what the briefs say.
//
//   D-20 — THE CROSS-CHECK IS COMPLETE OR IT IS NOT AN EXONERATION.
//          `aggregateMisdirectionEvidence` folds per-record rows under one law: ANY flipped
//          row makes the memory suspect and takes precedence; only ALL relevant rows held
//          permits the authored no-trust-change class; anything else — inconclusive, not-run,
//          or a record with no row at all — answers `unknown` with the unresolved siblings
//          DISCLOSED by name rather than quietly folded into the held majority.
//
//   D-19 — THE ONE EXEMPTION IS ABSENCE, NOT BREAKAGE. A run with no evaluation root cannot
//          cross-check anything, so it keeps the declared boolean under an explicit
//          `backing: 'declared-only'` marker. A run whose root is present-but-broken has the
//          same empty evidence and a completely different meaning: it is an unbacked gated
//          posture, and `declared-only` is refused there. Collapsing the two would let every
//          broken root borrow the BYOM exemption.
//
// WHY THE ROW CARRIES A SOURCE DIGEST AND NOT THE HANDOFF'S OWN. Each row binds the run,
// member test, failing step, decision ordinal and record it describes, plus the corpus,
// profile and brief identities the check ran under. It must also bind the HANDOFF it was
// computed against — but the handoff's final digest covers the verdicts, and a verdict now
// carries these rows, so digesting the finished document would hash a value that contains its
// own hash. `misdirectionSourceDigest` is the way out: the run's IDENTITY (id, scope, build
// ordinal, config digests) is fixed before the first member executes and cannot move when a
// later member outcome is appended, so it identifies the source without a self-hash cycle.
//
// Pure-sync over DTOs, no host APIs — the schema-package law.

import { z } from 'zod'

import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import type { BriefLine } from '../brief/served-brief'
import type { CompletedRunHandoff } from '../handoff/completed-run-handoff'
import type { StepEvidence } from '../handoff/step-evidence'
import type { RecordId } from '../ids/record-id'
import { CROSS_CHECKS } from '../knowledge/gate-receipt'
import type { CrossCheck } from '../knowledge/gate-receipt'

/**
 * The two ways the store itself declares a served record's trust was not established when it
 * was put on a step's path — `'candidate'` is the pre-promotion fold status, and
 * `'low-trust-active'` is an active record served as a CANARY, deliberately on probation to
 * gather outcome evidence. No minted threshold and no second spelling of the trust fold: both
 * words read a marker the serving path already wrote.
 */
export type MemoryOnPathTrust = 'candidate' | 'low-trust-active'
// prettier-ignore
export const MEMORY_ON_PATH_TRUSTS = ['candidate', 'low-trust-active'] as const satisfies readonly MemoryOnPathTrust[]

/** One low-trust record the run's own briefs put on a verdict's failing path. */
export interface MemoryOnPathEntry {
  readonly recordId: RecordId
  readonly trust: MemoryOnPathTrust
}

/**
 * One EXPOSURE — the same record served on two steps is two sites, because the cross-check
 * that clears it on one step says nothing about the other.
 */
export interface MemoryOnPathSite extends MemoryOnPathEntry {
  readonly stepIndex: number
}

/**
 * The one backing word, and it is an ABSENCE claim: "no evaluation root existed, so nothing
 * was measured and the author's declaration is all there is". Never a quality grade.
 */
export type MisdirectionBacking = 'declared-only'
// prettier-ignore
export const MISDIRECTION_BACKINGS = ['declared-only'] as const satisfies readonly MisdirectionBacking[]

/** The evaluation-root posture a cross-check ran under (D-19). */
export type MisdirectionRootPosture = 'eval-root' | 'no-eval-root' | 'broken-eval-root'
// prettier-ignore
export const MISDIRECTION_ROOT_POSTURES = ['eval-root', 'no-eval-root', 'broken-eval-root'] as const satisfies readonly MisdirectionRootPosture[]

/** Disclosed sampling of one cross-check row; `seedHonored` sits on the row beside it. */
export interface MisdirectionSamples {
  readonly k: number
  readonly seeds: readonly number[]
  readonly modelCalls: number
}

/**
 * ONE record's cross-check at ONE exposure. Every identity the check depended on is bound
 * here, so a row cannot be lifted from another run, member, step or corpus generation and
 * replayed as this verdict's exoneration.
 */
export interface MisdirectionRecordResult {
  readonly runId: string
  /** The member test index — the phase's join key, same axis as `Verdict.perTest`. */
  readonly perTest: number
  /** The failing step this exposure happened on. */
  readonly stepIndex: number
  /** Decision identity within the step. */
  readonly decisionOrdinal: number
  readonly recordId: RecordId
  /** {@link misdirectionSourceDigest} of the handoff — the run's identity, not its bytes. */
  readonly handoffBaseDigest: string
  readonly briefDigest: string
  readonly corpusDigest: string
  readonly profileDigest: string
  readonly crossCheck: CrossCheck
  readonly seedHonored: boolean
  readonly reason?: string
  readonly samples?: MisdirectionSamples
}

/**
 * The optional evidence block a verdict carries beside the frozen boolean. `crossCheck`,
 * `recordId`, `reason` and `samples` are the single-record summary shape the gate receipts
 * already speak; `results` is the ADDITIVE complete per-record ledger this plan requires, and
 * `backing` is the D-19 absence marker.
 */
export interface MisdirectionEvidence {
  readonly crossCheck: CrossCheck
  readonly results: readonly MisdirectionRecordResult[]
  readonly recordId?: RecordId
  readonly reason?: string
  readonly samples?: MisdirectionSamples
  readonly backing?: MisdirectionBacking
}

/** What {@link aggregateMisdirectionEvidence} folds: the recomputed sites and the claimed rows. */
export interface MisdirectionAggregationInput {
  readonly runId: string
  readonly perTest: number
  readonly handoffBaseDigest: string
  readonly sites: readonly MemoryOnPathSite[]
  readonly results: readonly MisdirectionRecordResult[]
}

/**
 * The fold's answer. `'held'` is the ONLY arm that permits a no-trust-change class; every
 * other arm names what is unresolved so a reader can see it rather than infer it.
 */
export type MisdirectionAggregate =
  | { readonly outcome: 'held'; readonly records: readonly RecordId[] }
  | { readonly outcome: 'flipped'; readonly suspect: readonly RecordId[] }
  | {
      readonly outcome: 'unknown'
      readonly inconclusive: readonly RecordId[]
      readonly notRun: readonly RecordId[]
      readonly unchecked: readonly RecordId[]
    }
  | { readonly outcome: 'evidence-refused'; readonly problems: readonly string[] }

/** Thrown by {@link guardMisdirectionEvidence} on bytes that are not a complete block. */
export class MisdirectionEvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MisdirectionEvidenceError'
  }
}

/**
 * The trust word for one served brief line, or `undefined` when the store's own markers say
 * the record's trust WAS established. Pre-promotion status is checked first: a candidate that
 * also rode a canary slot is still a candidate, which is the stronger disclosure.
 */
export function memoryOnPathTrustOf(line: BriefLine): MemoryOnPathTrust | undefined {
  if (line.status === 'candidate') return 'candidate'
  if (line.servedAsCanary) return 'low-trust-active'
  return undefined
}

/**
 * Every low-trust EXPOSURE across the given steps, in step order then brief order. One record
 * served on two steps yields two sites; one record served twice within a single step's brief
 * yields one.
 */
export function deriveMemoryOnPathSites(steps: readonly StepEvidence[]): MemoryOnPathSite[] {
  const sites: MemoryOnPathSite[] = []
  const seen = new Set<string>()
  for (const step of steps) {
    for (const line of step.servedBrief.channel1) {
      const trust = memoryOnPathTrustOf(line)
      if (trust === undefined) continue
      const key = `${step.stepIndex}${line.id}`
      if (seen.has(key)) continue
      seen.add(key)
      sites.push({ stepIndex: step.stepIndex, recordId: line.id, trust })
    }
  }
  return sites
}

/**
 * The record-level fold of {@link deriveMemoryOnPathSites} — the exact shape a verdict's
 * `memoryOnPath` declares, computed from the briefs so the declaration can be CHECKED. A
 * record exposed as both a candidate and a canary reads `'candidate'`: the stronger of the two
 * disclosures survives the fold, so folding can never soften what a site recorded.
 */
export function deriveMemoryOnPath(steps: readonly StepEvidence[]): MemoryOnPathEntry[] {
  const byRecord = new Map<RecordId, MemoryOnPathTrust>()
  for (const site of deriveMemoryOnPathSites(steps)) {
    const previous = byRecord.get(site.recordId)
    if (previous === 'candidate') continue
    byRecord.set(site.recordId, site.trust)
  }
  return [...byRecord].map(([recordId, trust]) => ({ recordId, trust }))
}

/**
 * The run IDENTITY digest a cross-check row binds (see the header): id, scope, build ordinal
 * and config digests — all fixed before the first member executes. Deliberately NOT the
 * handoff's own digest, which would cover the verdicts that carry these rows.
 */
export function misdirectionSourceDigest(handoff: CompletedRunHandoff): string {
  return sha256hex(
    canonicalJson({
      runId: handoff.runId,
      scope: handoff.scope,
      buildOrdinal: handoff.buildOrdinal,
      configDigests: handoff.configDigests,
    }),
  )
}

/** The evidence key: one EXPOSURE, not one record (see {@link MemoryOnPathSite}). */
function siteKey(stepIndex: number, recordId: RecordId): string {
  return `${stepIndex}${recordId}`
}

/**
 * Fold the claimed rows against the recomputed sites (D-20).
 *
 * THE KEY IS THE EXPOSURE, NOT THE RECORD. A record served on two steps is cross-checked
 * twice, and the run that cleared it on the first step says nothing about the second: keying
 * by record would read the second row as a duplicate of the first and REFUSE the pair, which
 * is how a real second-step flip disappears behind a first-step hold. Keying by exposure keeps
 * both rows, so the flip survives to the law below and a record covered on only one of its two
 * exposures reads `unchecked` rather than held.
 *
 * Key integrity runs FIRST and is fail-closed: a row minted against another run or member, a
 * row whose source-digest identity is not this handoff's, a row naming an exposure no brief
 * recorded, and two rows for one exposure are each `'evidence-refused'`. Only then does the
 * cross-check law apply — flipped takes precedence, all-held permits the class, and every
 * other shape answers `'unknown'` naming its unresolved records.
 *
 * Every answer is stated at RECORD level even though the fold is keyed per exposure, because
 * trust moves against a record. Harm names only the records a flip actually supports; a held
 * sibling of a flipped record is never labelled causal, and it stays visible in `memoryOnPath`
 * regardless — disclosed, not accused.
 */
export function aggregateMisdirectionEvidence(
  input: MisdirectionAggregationInput,
): MisdirectionAggregate {
  const exposedRecords: RecordId[] = []
  for (const site of input.sites) {
    if (!exposedRecords.includes(site.recordId)) exposedRecords.push(site.recordId)
  }
  const requiredKeys = new Set(input.sites.map((site) => siteKey(site.stepIndex, site.recordId)))

  const problems: string[] = []
  const byKey = new Map<string, MisdirectionRecordResult>()
  for (const row of input.results) {
    const where = `${row.recordId} at step ${row.stepIndex}`
    if (row.runId !== input.runId) {
      problems.push(`row for ${where} was minted against run ${row.runId}`)
      continue
    }
    if (row.perTest !== input.perTest) {
      problems.push(`row for ${where} was minted against member test ${row.perTest}`)
      continue
    }
    if (row.handoffBaseDigest !== input.handoffBaseDigest) {
      problems.push(`row for ${where} names a source-digest identity from another run`)
      continue
    }
    const key = siteKey(row.stepIndex, row.recordId)
    if (!requiredKeys.has(key)) {
      problems.push(`row for ${where}, an exposure no served brief recorded on this path`)
      continue
    }
    if (byKey.has(key)) {
      problems.push(`a second, conflicting row for ${where}`)
      continue
    }
    byKey.set(key, row)
  }
  if (problems.length > 0) return { outcome: 'evidence-refused', problems }

  /** Records with at least one exposure whose row reads `check`. */
  const recordsWithCheck = (check: CrossCheck): RecordId[] =>
    exposedRecords.filter((recordId) =>
      input.sites.some(
        (site) =>
          site.recordId === recordId &&
          byKey.get(siteKey(site.stepIndex, site.recordId))?.crossCheck === check,
      ),
    )

  const suspect = recordsWithCheck('flipped')
  if (suspect.length > 0) return { outcome: 'flipped', suspect }

  const inconclusive = recordsWithCheck('inconclusive')
  const notRun = recordsWithCheck('not-run')
  const unchecked = exposedRecords.filter((recordId) =>
    input.sites.some(
      (site) => site.recordId === recordId && !byKey.has(siteKey(site.stepIndex, site.recordId)),
    ),
  )
  if (inconclusive.length > 0 || notRun.length > 0 || unchecked.length > 0) {
    return { outcome: 'unknown', inconclusive, notRun, unchecked }
  }

  return { outcome: 'held', records: exposedRecords }
}

const recordIdSchema = z.custom<RecordId>(
  (value) => typeof value === 'string' && value.length > 0,
  { message: 'expected a non-empty RecordId' },
)
const nonEmpty = z.string().min(1)
const samplesSchema = z
  .object({
    k: z.number().int().min(1),
    seeds: z.array(z.number().int()),
    modelCalls: z.number().int().nonnegative(),
  })
  .strict()

/** The wire shape of one per-record row — every identity required, nothing extra tolerated. */
export const MisdirectionRecordResultSchema = z
  .object({
    runId: nonEmpty,
    perTest: z.number().int().nonnegative(),
    stepIndex: z.number().int().nonnegative(),
    decisionOrdinal: z.number().int().nonnegative(),
    recordId: recordIdSchema,
    handoffBaseDigest: nonEmpty,
    briefDigest: nonEmpty,
    corpusDigest: nonEmpty,
    profileDigest: nonEmpty,
    crossCheck: z.enum(CROSS_CHECKS),
    seedHonored: z.boolean(),
    reason: z.string().optional(),
    samples: samplesSchema.optional(),
  })
  .strict()

/** The wire shape of the whole block. `results` is REQUIRED — an absent ledger is not a block. */
export const MisdirectionEvidenceSchema = z
  .object({
    crossCheck: z.enum(CROSS_CHECKS),
    results: z.array(MisdirectionRecordResultSchema),
    recordId: recordIdSchema.optional(),
    reason: z.string().optional(),
    samples: samplesSchema.optional(),
    backing: z.literal('declared-only').optional(),
  })
  .strict()

/**
 * The one gate stored or foreign evidence bytes cross. Strict on purpose: an unrecognised
 * member is REFUSED rather than dropped, because a dropped member is a claim a reader never
 * sees, and this block exists to make a claim visible.
 */
export function guardMisdirectionEvidence(value: unknown): MisdirectionEvidence {
  const parsed = MisdirectionEvidenceSchema.safeParse(value)
  if (!parsed.success) {
    throw new MisdirectionEvidenceError(
      `misdirectionRuledOut is not a complete evidence block: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
        .join('; ')}`,
    )
  }
  return parsed.data as MisdirectionEvidence
}
