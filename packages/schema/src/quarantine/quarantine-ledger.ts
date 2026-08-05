// The committed quarantine ledger's event contract and state vocabulary (Phase 390, D-01/D-03).
//
// `quarantine.jsonl` is a COMMITTED append-only event log at the knowledge root — its own
// top-level artifact beside memory/ and policies/ — so a fresh CI checkout inherits quarantine
// state and FLAK-02's non-failing disposition holds on every machine. Every line carries its own
// `schemaVersion` (headerless, the outcomes.jsonl idiom) and crosses this one guard.
//
// TWO THINGS ARE DELIBERATE HERE:
//
//  1. The event list is append-only LIFECYCLE ACTIONS only. `'expired'` is NOT an event: it is a
//     COMPUTED state derived from an entry's `expiresAt` against the caller's `now` (D-11). Wall
//     clock enters the fold as an argument and is stamped into events at write time — this module
//     reads no clock at all, and neither does the fold that consumes it.
//  2. Stable test identity is `(product, filePath, testName)`, never `testId` (a per-run explicit
//     id, not a durable identity). Every event and every folded entry is keyed that way.
//
// Consumers: the knowledge-local ledger read/fold (`readQuarantineLedger`/
// `foldQuarantineLedgerState`), the CLI run-start snapshot (D-16), the quarantine list/add/release
// verbs, and the recurrence clause's ladder arms (D-17).

import {
  createVersionGuard,
  VersionGuardError,
} from '../versioning/create-version-guard'
import type { MigrationRegistry } from '../versioning/create-version-guard'
import { isVerdictClass } from '../verdict/verdict'
import type { VerdictClass } from '../verdict/verdict'

export const CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION = 1

/**
 * The closed lifecycle-action union, spelled ONCE (388 C13). `entered` opens a window,
 * `renewed` extends it (and may claim the owner), and the two `released-*` kinds close it —
 * `released-auto` from the M-consecutive-passes exit, `released-manual` from the human half of
 * the exit path. There is deliberately no `expired` member (see the module head).
 */
export const QUARANTINE_EVENT_KINDS = [
  'entered',
  'renewed',
  'released-manual',
  'released-auto',
] as const

export type QuarantineEventKind = (typeof QUARANTINE_EVENT_KINDS)[number]

const QUARANTINE_EVENT_KIND_SET: ReadonlySet<string> = new Set(QUARANTINE_EVENT_KINDS)

/** True for exactly the four closed lifecycle actions. */
export function isQuarantineEventKind(value: unknown): value is QuarantineEventKind {
  return typeof value === 'string' && QUARANTINE_EVENT_KIND_SET.has(value)
}

/**
 * The typed literal every auto-entry carries until a human claims it (D-12): honest absence over
 * invented attribution — no git-identity stamping, no CODEOWNERS guessing. The list verb surfaces
 * unassigned entries FIRST because they are the triage queue.
 */
export const QUARANTINE_UNASSIGNED_OWNER = 'unassigned'

/** An entry's owner: the unassigned literal, or whatever name a human claimed it under. */
export type QuarantineOwner = typeof QUARANTINE_UNASSIGNED_OWNER | (string & {})

/**
 * Every event carries the version stamp, its kind, the ISO instant it was authored at, and the
 * three legs of stable test identity. Kind-specific fields hang off the arms below.
 */
interface QuarantineEventBase {
  schemaVersion: number
  kind: QuarantineEventKind
  /** ISO-8601 instant, stamped by the CALLER at write time (this module reads no clock). */
  at: string
  /** The slugged product partition, matching the run-outcome projection's own key. */
  product: string
  filePath: string
  testName: string
}

/** A window opens: the fingerprint that crossed, its resolved class, an owner, and a deadline. */
export interface QuarantineEnteredEvent extends QuarantineEventBase {
  kind: 'entered'
  fingerprint: string
  verdictClass: VerdictClass
  owner: QuarantineOwner
  /** ISO-8601 deadline, stamped at write time. On lapse, suppression STOPS (D-11). */
  expiresAt: string
}

/** A window extends, and optionally gets claimed out of `unassigned` (D-13's renew-on-re-add). */
export interface QuarantineRenewedEvent extends QuarantineEventBase {
  kind: 'renewed'
  expiresAt: string
  owner?: QuarantineOwner
}

/** A window closes. Identity only — the reason lives in which of the two kinds it is. */
export interface QuarantineReleasedEvent extends QuarantineEventBase {
  kind: 'released-manual' | 'released-auto'
}

export type QuarantineLedgerEvent =
  | QuarantineEnteredEvent
  | QuarantineRenewedEvent
  | QuarantineReleasedEvent

/**
 * Thrown when a stored ledger line declares a `schemaVersion` this build cannot consume: newer
 * than {@link CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION}, or older with no registered migration.
 *
 * The ledger is COMMITTED truth, so this is a hard failure rather than a skipped line — only
 * derived projections heal. A skipped line would silently un-quarantine a test.
 */
export class QuarantineLedgerVersionError extends VersionGuardError {
  constructor(found: number, supported: number) {
    super('QuarantineLedgerEvent', found, supported)
    this.name = 'QuarantineLedgerVersionError'
  }
}

/** The older-version migration seam — empty at version 1, registered so growth is additive. */
export const QUARANTINE_LEDGER_MIGRATIONS: MigrationRegistry = {}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Fail-closed structural check on one stored event, at the depth the fold traverses: the kind
 * inside the closed union, all three identity legs present and non-empty, and every kind-specific
 * field the arm declares. An `entered` event with no `expiresAt` would fold to a forever
 * suppression, so its absence is refused rather than defaulted.
 */
export function hasQuarantineEventShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.schemaVersion !== 'number') return false
  if (!isQuarantineEventKind(value.kind)) return false
  if (!isNonEmptyString(value.at)) return false
  if (!isNonEmptyString(value.product)) return false
  if (!isNonEmptyString(value.filePath)) return false
  if (!isNonEmptyString(value.testName)) return false

  switch (value.kind) {
    case 'entered':
      return (
        isNonEmptyString(value.fingerprint) &&
        isVerdictClass(value.verdictClass) &&
        isNonEmptyString(value.owner) &&
        isNonEmptyString(value.expiresAt)
      )
    case 'renewed':
      return (
        isNonEmptyString(value.expiresAt) &&
        (!('owner' in value) || isNonEmptyString(value.owner))
      )
    case 'released-manual':
    case 'released-auto':
      return true
  }
}

/**
 * The read side of the ledger version discipline: parse → reject-newer with a typed
 * {@link QuarantineLedgerVersionError} → migrate-older through
 * {@link QUARANTINE_LEDGER_MIGRATIONS} → structural check. Every ledger consumer routes here.
 */
export const guardQuarantineLedgerEvent = createVersionGuard<QuarantineLedgerEvent>({
  name: 'QuarantineLedgerEvent',
  current: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  migrations: QUARANTINE_LEDGER_MIGRATIONS,
  error: QuarantineLedgerVersionError,
  shape: hasQuarantineEventShape,
})

/**
 * The state vocabulary, minted ONCE (388 C13) so the fold, the list verb, the entity card and the
 * sentence clause all speak the same three words.
 *
 * `'quarantined'` suppresses; `'expired'` does NOT (the entry stays listed, renewable and
 * releasable — the forcing function that makes quarantine a lifecycle rather than a graveyard);
 * `'released'` is a closed window kept for the history the event log answers for free.
 */
export const QUARANTINE_ENTRY_STATE_NAMES = ['quarantined', 'expired', 'released'] as const

export type QuarantineEntryStateName = (typeof QUARANTINE_ENTRY_STATE_NAMES)[number]

/** One folded entry: the durable identity, the entry's own facts, and its computed state. */
export interface QuarantineEntryState {
  product: string
  filePath: string
  testName: string
  fingerprint: string
  verdictClass: VerdictClass
  owner: QuarantineOwner
  enteredAt: string
  expiresAt: string
  state: QuarantineEntryStateName
}

/**
 * The detection ladder's visible rungs (D-06/D-17). `'flagged'` is detection-layer visibility only
 * — one build of warning before action — and NEVER appears in the ledger; it exists in this union
 * because the recurrence answer renders all three arms from one vocabulary.
 */
export type QuarantineLadderState = 'flagged' | 'quarantined' | 'expired'

/**
 * What a run records about the ledger entries it applied at run start (D-16, Open Q2): minimal
 * identity plus the expiry that says how long the disposition was licensed for. The handoff is
 * schema-versioned and every field on it is forever, so this stays deliberately small — owner,
 * fingerprint and history live in the ledger, which is the durable truth.
 */
export interface QuarantineAppliedEntry {
  product: string
  filePath: string
  testName: string
  expiresAt: string
}

/**
 * The STABLE test identity a snapshot entry is matched against — `(filePath, testName)`, never
 * `testId`, which is a per-run explicit id that does not survive to the next build.
 */
export interface QuarantineSnapshotMatch {
  filePath: string
  testName: string
}

/**
 * Does the run-start snapshot license this test's failure (390 D-14/D-16)?
 *
 * ONE spelling of the match, consumed by everything that has to agree about it: the runner's
 * aggregate verdict rule (which decides the exit code) and both CLI reporters (which tell the human
 * and the CI parser why a red row did not fail the build). Two spellings could disagree without
 * failing to compile, and the disagreement would surface as a reporter announcing a suppression
 * that never happened — precisely the un-quarantine evidence FLAK-02 exists to keep flowing.
 *
 * `product` is deliberately NOT compared: the composition layer filters the snapshot to the run's
 * product before handing it over (D-16), so re-deriving product bytes downstream would be a second,
 * drift-prone spelling of that rule.
 */
export function quarantineAppliesToTest(
  applied: readonly QuarantineAppliedEntry[] | undefined,
  test: QuarantineSnapshotMatch,
): boolean {
  if (applied === undefined) return false
  return applied.some(
    (entry) => entry.filePath === test.filePath && entry.testName === test.testName,
  )
}
