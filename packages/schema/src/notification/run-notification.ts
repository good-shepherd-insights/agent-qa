// The chain-terminal notification DTO (Phase 388, D-09 / D-11 / D-12).
//
// One record per run, written inside the transaction that lands the LAST job the post-run
// chain enqueued. It is the thing 392's chat and M5's dashboard read, which is why it is
// minted here rather than beside either of them: a payload shape that lived with one
// consumer would be re-derived by the second, and the two spellings would drift on the first
// field either of them wanted.
//
// What it deliberately does NOT carry (D-11; 385 D-01): no masked content, no rationale
// prose, no artifact bytes, no `agentqa://` refs. Counts, verdict classes and identifiers
// only. The reason is not size — it is that this row is read by surfaces that render it
// directly, and a payload that could carry a secret would need a masking boundary of its own
// at every one of them. Later surfaces resolve `runId` into an entity card at render time.
//
// `outcome` is a fact about the CHAIN, not about the run: a failed run whose analysis and
// curation both succeeded notifies `done`. The run's own verdict is the exit code, frozen
// long before anything here exists (JOBQ-06), and conflating the two would make this record
// a second, later, quieter answer to a question already answered.

import type { Verdict } from '../verdict/verdict'

/**
 * Stamped into every record and checked on every read.
 *
 * A literal type rather than `number` (the `CurationTailReceipt` idiom): a record built with
 * last version's shape then fails to typecheck at its construction site, which is where the
 * mistake is, instead of at the reader that could only report it as corrupt bytes.
 */
export const CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION = 2

/** Whether the chain as a whole finished clean. Every stage done ⇒ `done` (D-12). */
export type RunNotificationOutcome = 'done' | 'failed'

/** What became of one stage the chain actually ran. */
export type RunNotificationStageStatus = 'done' | 'failed'

/**
 * Per-class counts over the verdicts the analysis stage authored.
 *
 * `byClass` is PARTIAL on purpose: a run with no environment failures omits the key rather
 * than carrying a zero. A dense record would make "this class did not occur" and "this build
 * does not know that class yet" the same bytes, and the second is the one a later verdict
 * class introduces.
 */
export interface RunNotificationVerdictSummary {
  total: number
  byClass: Partial<Record<Verdict['class'], number>>
}

/**
 * The two stages the chain actually runs (narrowed to two in v2 — Phase 404, D-01).
 *
 * A stage record carries its STATUS and, for curation, the counts it committed. It carries NO
 * failure text, and that absence is a decision rather than an omission (404 D-21, T-404-01):
 * this row is stamped by whichever process drains the chain, INCLUDING the daemon's pump, which
 * folds with no run masking context at all (388 D-06's `no-masker` posture). A reason stored
 * here therefore could not be guaranteed masked at the moment it was written, and this row is
 * read by surfaces that render it directly — so a secret that reached the column would reach a
 * screen. The masked, bounded reason (`CHIP_ERROR_MAX_LENGTH`) lives instead on the in-process
 * `*Failed` chip envelope, which is itself durable (it is appended to the run's `events.jsonl`)
 * and reaches the page through the read route's `runs.events` fold. A `failed` chip with no
 * such envelope renders `failed` plus a posture-qualified "reason not recorded" line — never
 * blank. The job store's own per-job failure-reason column is a pump-internal field and is not
 * surfaced by this contract for the same masking reason.
 */
export interface RunNotificationStages {
  analysis: { status: RunNotificationStageStatus }
  /**
   * Counts are present only when the curation stage actually committed a bundle. A failed
   * curation reports its status and no counts at all — zeros would say it curated nothing,
   * which is a different claim from never having got that far.
   */
  curation: {
    status: RunNotificationStageStatus
    curated?: number
    deprecated?: number
  }
}

export interface RunNotification {
  schemaVersion: typeof CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION
  runId: string
  outcome: RunNotificationOutcome
  verdictSummary: RunNotificationVerdictSummary
  stages: RunNotificationStages
}

/** Refusal for bytes that do not describe a notification this build can read. */
export class RunNotificationSchemaError extends Error {
  override readonly name = 'RunNotificationSchemaError'

  constructor(readonly detail: string) {
    super(
      `a stored run notification cannot be read: ${detail}. The row is written inside the ` +
        'chain-terminal transaction from a typed record, so bytes that fail this guard were ' +
        'written by another build rather than by a caller that got a field wrong.',
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * The older-version migration seam, in the handoff loader's `HANDOFF_MIGRATIONS` idiom.
 *
 * Keyed by SOURCE version, one version-step per entry, so the next bump has a home instead of
 * an `if` somewhere in the guard. Migration is READ-SIDE and in-memory: rows already in a
 * user's `agent-jobs.db` are never rewritten in place, and the table's own PRAGMA
 * `user_version` is unchanged by this bump — the column's bytes are what moved, not the
 * schema of the table holding them. Both store readers call the guard below, so a reader
 * racing a writer that still stamps the older shape sees the current shape either way.
 */
export const RUN_NOTIFICATION_MIGRATIONS: Record<number, (doc: unknown) => unknown> = {
  /**
   * v1 → v2 (Phase 404, D-01, 2026-08-26): the chain's stage set narrows to the two stages that
   * actually run. Written as an ALLOW-LIST over the members this build reads rather than as a
   * deletion of the member that left: a v1 row that was missing a stage migrates to a stage set
   * that is missing it too, and is then refused BY NAME by the shape guard, instead of being
   * quietly admitted because the one key we thought to delete was absent.
   */
  1: (doc) => {
    const record = isRecord(doc) ? doc : {}
    const stages = isRecord(record.stages) ? record.stages : {}
    return {
      ...record,
      schemaVersion: 2,
      stages: {
        ...('analysis' in stages ? { analysis: stages.analysis } : {}),
        ...('curation' in stages ? { curation: stages.curation } : {}),
      },
    }
  },
}

/**
 * The full-shape guard, checked by EXACT key set rather than by presence, with a
 * migrate-older/reject-newer version walk in front of it (385 D-04; Phase 404 D-01).
 *
 * Presence checks admit a record carrying an extra field, and an extra field on a row several
 * surfaces render is exactly how a payload grows a member nobody declared. The sorted-key
 * comparison is the `CurationTailReceipt` idiom for the same reason.
 *
 * The version walk runs FIRST and only forwards: a record stamped older than this build walks
 * the registry above one step at a time and is then checked against the CURRENT shape in full,
 * so a migration that produced something malformed is refused here rather than travelling. A
 * record stamped NEWER is refused by name — this build cannot know what a later contract means,
 * and guessing is how a reader renders a field it does not understand.
 */
export function guardRunNotification(value: unknown): RunNotification {
  if (!isRecord(value)) {
    throw new RunNotificationSchemaError('it is not an object')
  }

  const declared = value.schemaVersion
  let migrated: Record<string, unknown> = value
  if (
    typeof declared === 'number' &&
    Number.isInteger(declared) &&
    declared < CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION
  ) {
    for (let from = declared; from < CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION; from += 1) {
      const step = RUN_NOTIFICATION_MIGRATIONS[from]
      if (step === undefined) break
      const next = step(migrated)
      if (!isRecord(next)) {
        throw new RunNotificationSchemaError(
          `migrating it from schemaVersion ${String(from)} produced no record`,
        )
      }
      migrated = next
    }
  }

  if (
    Object.keys(migrated).sort().join(',') !== 'outcome,runId,schemaVersion,stages,verdictSummary'
  ) {
    throw new RunNotificationSchemaError(
      `its field set is ${JSON.stringify(Object.keys(migrated).sort())}`,
    )
  }
  if (migrated.schemaVersion !== CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION) {
    throw new RunNotificationSchemaError(
      `it declares schemaVersion ${String(migrated.schemaVersion)}, and this build reads ` +
        String(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION),
    )
  }
  if (typeof migrated.runId !== 'string' || migrated.runId === '') {
    throw new RunNotificationSchemaError('it names no run')
  }
  if (migrated.outcome !== 'done' && migrated.outcome !== 'failed') {
    throw new RunNotificationSchemaError(`${String(migrated.outcome)} is not a chain outcome`)
  }

  const summary = migrated.verdictSummary
  if (!isRecord(summary) || !isCount(summary.total) || !isRecord(summary.byClass)) {
    throw new RunNotificationSchemaError('its verdict summary is not a summary')
  }
  for (const [className, count] of Object.entries(summary.byClass)) {
    if (!isCount(count)) {
      throw new RunNotificationSchemaError(`its ${className} count is not a count`)
    }
  }

  const stages = migrated.stages
  if (!isRecord(stages)) {
    throw new RunNotificationSchemaError('it reports no stages')
  }
  if (Object.keys(stages).sort().join(',') !== 'analysis,curation') {
    throw new RunNotificationSchemaError(
      `its stage set is ${JSON.stringify(Object.keys(stages).sort())}`,
    )
  }
  const analysis = stages.analysis
  if (!isRecord(analysis) || (analysis.status !== 'done' && analysis.status !== 'failed')) {
    throw new RunNotificationSchemaError('its analysis stage reports no outcome')
  }
  const curation = stages.curation
  if (!isRecord(curation) || (curation.status !== 'done' && curation.status !== 'failed')) {
    throw new RunNotificationSchemaError('its curation stage reports no outcome')
  }
  if ('curated' in curation && !isCount(curation.curated)) {
    throw new RunNotificationSchemaError('its curated count is not a count')
  }
  if ('deprecated' in curation && !isCount(curation.deprecated)) {
    throw new RunNotificationSchemaError('its deprecated count is not a count')
  }

  return migrated as unknown as RunNotification
}
