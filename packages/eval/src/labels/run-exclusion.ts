/**
 * 414 D-02 run-exclusion record — the committed document that turns "was this
 * run excluded from the corpus" from a fact about a runbook session into a
 * fact about the repository.
 *
 * WHY A DOCUMENT. 413's growth campaign dropped runs whose verdict class was
 * `environment`, `flake` or `timeout` before anything was committed, so an
 * excluded run left NO trace in the root — the exclusion was real and
 * unauditable. One record per excluded run makes membership a function of a
 * committed list: the census can count what never arrived, and 422's curator
 * can ask why a run is missing without reconstructing the campaign.
 *
 * WRITE-ONCE IDENTITY. `backfill` records a LATER act — entries deleted from
 * the root after the fact because the run turned out to be excludable. The
 * rest of the record is the original decision. `runExclusionCore` drops the
 * backfill block so the writer can compare "is this the same exclusion I
 * already recorded" without a backfill making an identical decision look new.
 *
 * STRICT BY CONSTRUCTION. The record is hand-editable committed JSON that
 * decides corpus membership, so every object is `.strict()` and both
 * vocabularies below are closed. `verdicts` must carry at least one entry: an
 * exclusion with no excluding verdict is not an exclusion, it is a deletion
 * with no reason.
 *
 * ONE SPELLING (moved here by 414 Task 2). `EXCLUSION_CLASSES` and
 * `VERDICT_PRODUCERS` used to be private consts inside `derive-census.ts`.
 * They now live beside the document that commits them and the census imports
 * them back, so the vocabulary the census counts and the vocabulary the
 * record admits cannot drift apart.
 *
 * Pure: no IO, no clock.
 */
import { z } from 'zod'

/** Single version gate for the run-exclusion document (D-02). */
export const RUN_EXCLUSION_SCHEMA_VERSION = 1 as const

/** Verdict classes D-04 excludes a growth run for; every other class seeds. */
export const EXCLUSION_CLASSES = ['environment', 'flake', 'timeout'] as const
export type ExclusionClass = (typeof EXCLUSION_CLASSES)[number]

/** The two producers that can author a run verdict (D-04, 413 RESEARCH F13). */
export const VERDICT_PRODUCERS = ['analyze-run', 'deterministic-classifier'] as const
export type VerdictProducer = (typeof VERDICT_PRODUCERS)[number]

/** The later deletion act, recorded when entries were removed after the fact. */
export interface RunExclusionBackfill {
  /** Commit that removed the entries, when one exists. */
  deletionCommit?: string
  /** How many committed entries the backfill removed; 0 is an honest answer. */
  entriesRemoved: number
  /** Who or what recorded the backfill, verbatim. */
  recordedBy: string
}

/** One excluded run, as the committed bytes. */
export interface RunExclusionRecord {
  schemaVersion: typeof RUN_EXCLUSION_SCHEMA_VERSION
  runId: string
  runSlug: string
  product: string
  /** At least one excluding verdict; an empty list is not an exclusion. */
  verdicts: readonly { class: ExclusionClass; producer: VerdictProducer }[]
  /** Digest of the analysis the decision was read from. */
  analysisDigest: string
  reason: 'excluded-verdict-class'
  backfill?: RunExclusionBackfill
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/

const exclusionVerdictSchema = z
  .object({
    class: z.enum(EXCLUSION_CLASSES),
    producer: z.enum(VERDICT_PRODUCERS),
  })
  .strict()

const backfillSchema = z
  .object({
    deletionCommit: z.string().min(1).optional(),
    entriesRemoved: z.number().int().nonnegative(),
    recordedBy: z.string().min(1),
  })
  .strict()

export const runExclusionRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_EXCLUSION_SCHEMA_VERSION),
    runId: z.string().min(1),
    runSlug: z.string().min(1),
    product: z.string().min(1),
    verdicts: z.array(exclusionVerdictSchema).min(1),
    analysisDigest: z
      .string()
      .regex(LOWER_HEX_64, 'must be a 64-character lowercase hexadecimal digest'),
    reason: z.literal('excluded-verdict-class'),
    backfill: backfillSchema.optional(),
  })
  .strict()

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.')
}

/** Parse committed exclusion bytes into the closed shape, or throw with every issue named. */
export function guardRunExclusionRecord(value: unknown): RunExclusionRecord {
  const parsed = runExclusionRecordSchema.safeParse(value)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `${issuePath(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new TypeError(`run exclusion rejected: ${issues}`)
  }

  return parsed.data
}

/** The facts a caller supplies; the version and the reason this module stamps. */
export interface ProjectRunExclusionInput {
  runId: string
  runSlug: string
  product: string
  verdicts: readonly { class: ExclusionClass; producer: VerdictProducer }[]
  analysisDigest: string
  backfill?: RunExclusionBackfill
}

/**
 * Build the committed document and run it through the guard before returning
 * it. `backfill` is optional-spread, never an undefined key — a committed
 * document must not carry a key it has no value for.
 */
export function projectRunExclusion(input: ProjectRunExclusionInput): RunExclusionRecord {
  return guardRunExclusionRecord({
    schemaVersion: RUN_EXCLUSION_SCHEMA_VERSION,
    runId: input.runId,
    runSlug: input.runSlug,
    product: input.product,
    verdicts: input.verdicts,
    analysisDigest: input.analysisDigest,
    reason: 'excluded-verdict-class',
    ...(input.backfill === undefined ? {} : { backfill: input.backfill }),
  })
}

/**
 * The record WITHOUT its backfill block — the write-once identity Plan 05's
 * writer compares, so recording a later deletion never looks like a new
 * exclusion decision.
 */
export function runExclusionCore(record: RunExclusionRecord): Omit<RunExclusionRecord, 'backfill'> {
  return {
    schemaVersion: record.schemaVersion,
    runId: record.runId,
    runSlug: record.runSlug,
    product: record.product,
    verdicts: record.verdicts,
    analysisDigest: record.analysisDigest,
    reason: record.reason,
  }
}
