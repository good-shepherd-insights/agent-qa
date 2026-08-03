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
export const CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION = 1

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
  /**
   * Structurally true while the issue engine is unbuilt (D-15): no triage job will run, so
   * the honest answer is neither `pending` (something is coming) nor `done` (something
   * happened). When the slot is filled, `reserved` simply stops being produced.
   */
  issues: { status: 'reserved' }
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
 * The full-shape guard, checked by EXACT key set rather than by presence.
 *
 * Presence checks admit a record carrying an extra field, and an extra field on a row several
 * surfaces render is exactly how a payload grows a member nobody declared. The sorted-key
 * comparison is the `CurationTailReceipt` idiom for the same reason.
 */
export function guardRunNotification(value: unknown): RunNotification {
  if (!isRecord(value)) {
    throw new RunNotificationSchemaError('it is not an object')
  }
  if (Object.keys(value).sort().join(',') !== 'outcome,runId,schemaVersion,stages,verdictSummary') {
    throw new RunNotificationSchemaError(
      `its field set is ${JSON.stringify(Object.keys(value).sort())}`,
    )
  }
  if (value.schemaVersion !== CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION) {
    throw new RunNotificationSchemaError(
      `it declares schemaVersion ${String(value.schemaVersion)}, and this build reads ` +
        String(CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION),
    )
  }
  if (typeof value.runId !== 'string' || value.runId === '') {
    throw new RunNotificationSchemaError('it names no run')
  }
  if (value.outcome !== 'done' && value.outcome !== 'failed') {
    throw new RunNotificationSchemaError(`${String(value.outcome)} is not a chain outcome`)
  }

  const summary = value.verdictSummary
  if (!isRecord(summary) || !isCount(summary.total) || !isRecord(summary.byClass)) {
    throw new RunNotificationSchemaError('its verdict summary is not a summary')
  }
  for (const [className, count] of Object.entries(summary.byClass)) {
    if (!isCount(count)) {
      throw new RunNotificationSchemaError(`its ${className} count is not a count`)
    }
  }

  const stages = value.stages
  if (!isRecord(stages)) {
    throw new RunNotificationSchemaError('it reports no stages')
  }
  if (Object.keys(stages).sort().join(',') !== 'analysis,curation,issues') {
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
  const issues = stages.issues
  if (!isRecord(issues) || issues.status !== 'reserved') {
    throw new RunNotificationSchemaError('its issues stage is not the reserved slot')
  }

  return value as unknown as RunNotification
}
