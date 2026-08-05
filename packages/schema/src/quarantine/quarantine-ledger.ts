// The committed quarantine ledger's event contract and state vocabulary (Phase 390, D-01/D-03).
//
// `quarantine.jsonl` is a COMMITTED append-only event log at the knowledge root — its own
// top-level artifact beside memory/ and policies/ — so a fresh CI checkout inherits quarantine
// state and FLAK-02's non-failing disposition holds on every machine. Every line carries its own
// `schemaVersion` (headerless, the outcomes.jsonl idiom) and crosses this one guard.
//
// THREE THINGS ARE DELIBERATE HERE:
//
//  1. The event list is append-only LIFECYCLE ACTIONS only. `'expired'` is NOT an event: it is a
//     COMPUTED state derived from an entry's `expiresAt` against the caller's `now` (D-11). Wall
//     clock enters the fold as an argument and is stamped into events at write time — this module
//     reads no clock at all, and neither does the fold that consumes it.
//  2. Stable test identity is `(product, filePath, testName)`, never `testId` (a per-run explicit
//     id, not a durable identity). Every event and every folded entry is keyed that way.
//  3. The `filePath` leg is the WORKSPACE-RELATIVE source path — rooted at the config directory,
//     forward-slashed, no leading `./` — which is the same bytes on every checkout (390-08 / D-01).
//     This is what makes the inheritance claim above TRUE rather than asserted: the match at
//     `quarantineAppliesToTest` is an exact string compare, so an absolute path (the version-1
//     shape) could only ever match on the one machine that wrote it. The absolute form is refused
//     structurally by {@link hasQuarantineEventShape}, so a hand-edited machine-local line cannot
//     silently re-enter the committed file.
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

/**
 * Version 2 (390-08 / CR-02): the `filePath` identity leg is workspace-relative. Version 1 stamped
 * a machine-local ABSOLUTE path, which no other checkout can interpret — the bump moves the
 * contract while it is still FREE (zero `quarantine.jsonl` files exist in the wild, verified
 * 2026-08-05) rather than after entries start circulating through PRs and CI checkouts.
 */
export const CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION = 2

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
  /**
   * The WORKSPACE-RELATIVE source path: rooted at the config directory, forward-slashed, no
   * leading `./` — minted once by the CLI through `workspaceRelativeIdentityPath` (390-08). These
   * are the same bytes on every checkout, which is the whole reason the committed ledger can hand
   * a disposition to a machine that never saw the run that wrote it. An absolute path is refused
   * by {@link hasQuarantineEventShape}; it is never used for file access, only for identity.
   */
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

/**
 * The older-version migration seam — DELIBERATELY EMPTY, registered so growth is additive.
 *
 * There is no `1 -> 2` entry and there will never be one. A version-1 line's `filePath` is a
 * machine-local absolute path; migrating it to the workspace-relative identity would require
 * GUESSING the checkout root it was written under, and a wrong guess produces an entry that
 * silently suppresses the wrong test (or nothing at all) forever. Refusal through
 * {@link QuarantineLedgerVersionError} is the honest arm: the read fails loudly, the run-start
 * snapshot degrades to empty with a printed warning, and the human deletes three lines of a file
 * that — by construction — no repository actually has (zero v1 ledgers exist, verified 2026-08-05).
 */
export const QUARANTINE_LEDGER_MIGRATIONS: MigrationRegistry = {}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** A POSIX root, a Windows drive root (either slash direction), or a UNC/backslash root. */
const ABSOLUTE_PATH_PREFIX = /^([/\\]|[A-Za-z]:[/\\])/

/**
 * Is this `filePath` a checkout-portable identity — i.e. NOT an absolute path (390-08 / CR-02)?
 *
 * String predicates only, on purpose: this package bans host APIs, so the platform path module is
 * unavailable and the Windows forms have to be spelled here rather than delegated to
 * `isAbsolute` (which on a POSIX host would happily call `C:\repo\x.yaml` relative anyway).
 */
function isWorkspaceRelativeIdentity(value: string): boolean {
  return !ABSOLUTE_PATH_PREFIX.test(value)
}

/**
 * Fail-closed structural check on one stored event, at the depth the fold traverses: the kind
 * inside the closed union, all three identity legs present and non-empty, the `filePath` leg
 * workspace-relative rather than machine-local, and every kind-specific field the arm declares. An
 * `entered` event with no `expiresAt` would fold to a forever suppression, so its absence is
 * refused rather than defaulted; an absolute `filePath` would fold to an entry no other checkout
 * can match, so it is refused rather than normalized (this module cannot know the checkout root).
 */
export function hasQuarantineEventShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.schemaVersion !== 'number') return false
  if (!isQuarantineEventKind(value.kind)) return false
  if (!isNonEmptyString(value.at)) return false
  if (!isNonEmptyString(value.product)) return false
  if (!isNonEmptyString(value.filePath)) return false
  if (!isWorkspaceRelativeIdentity(value.filePath)) return false
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
