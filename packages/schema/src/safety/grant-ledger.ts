// The committed standing-grant ledger's event contract (Phase 391, D-04/D-11).
//
// `grants.jsonl` is a COMMITTED append-only event log at the knowledge root — its own top-level
// artifact beside memory/ and policies/, exactly as `quarantine.jsonl` is. The reason it is
// committed rather than machine-local is sovereignty you can review: a pull request shows every
// widening of agent autonomy as a diff, the headless daemon and any fresh checkout inherit the
// same grants, and a revoke is one more committed line. Every line carries its own `schemaVersion`
// (headerless, the outcomes.jsonl idiom) and crosses this one guard.
//
// THREE THINGS ARE DELIBERATE HERE:
//
//  1. The event list is append-only LIFECYCLE ACTIONS only — `grant` opens a standing approval and
//     `revoke` closes it. There is no `expired` member: a grant has no wall-clock lifetime in 391,
//     and inventing one here would be a second expiry vocabulary competing with the proposal
//     lifetime D-12 pins.
//  2. Events address each other by `grantId`, never by re-stating the covered class. A revoke that
//     re-spelled `actionClass` plus `scope` would be a second copy of the match rule, and two
//     copies of a match rule is how a revoke starts missing the grant it was written for.
//  3. `actionClass` is stored EXACTLY as the gate sees it. The policy gate compares
//     `grant.actionClass === action.name`, and a function op's action name is the prefixed form
//     (`fn:` followed by the op id) rather than the bare op id. A grant minted under the bare id
//     would parse, fold, list, and never match anything — the silent-no-op failure mode this note
//     exists to prevent. Mints read the class off the target op's own risk descriptor.
//
// Consumers: the knowledge-local ledger read/fold (`readGrantLedger`/`foldActiveGrants`), the
// standing-approval reader the function layer binds into the gate, and the grant list/revoke verbs.

import {
  createVersionGuard,
  VersionGuardError,
} from '../versioning/create-version-guard'
import type { MigrationRegistry } from '../versioning/create-version-guard'
import type { TrustScope } from './trust-credential'

/**
 * Version 1: the first shape. No ledger exists in the wild yet, so the contract is still free to
 * move; once grant events start circulating through pull requests it is not, which is why the
 * fields below are the minimum a match and a revoke need and nothing more.
 */
export const CURRENT_GRANT_LEDGER_SCHEMA_VERSION = 1

/**
 * The closed lifecycle-action union, spelled ONCE (388 C13). `grant` records a standing approval
 * for one action class within one scope; `revoke` withdraws the grant with that id. Nothing else
 * is an event — see the module head for why there is no expiry member.
 */
export const GRANT_LEDGER_EVENT_KINDS = ['grant', 'revoke'] as const

export type GrantLedgerEventKind = (typeof GRANT_LEDGER_EVENT_KINDS)[number]

const GRANT_LEDGER_EVENT_KIND_SET: ReadonlySet<string> = new Set(GRANT_LEDGER_EVENT_KINDS)

/** True for exactly the two closed lifecycle actions. */
export function isGrantLedgerEventKind(value: unknown): value is GrantLedgerEventKind {
  return typeof value === 'string' && GRANT_LEDGER_EVENT_KIND_SET.has(value)
}

/**
 * The canonical action scope every standing approval in this build is minted and matched under
 * (386 D-15's pinned-constant idiom — a constant with a retune note, never a config knob).
 *
 * WHY A PINNED LITERAL RATHER THAN ANYTHING DERIVED. The gate's `scopeMatches` refuses a scope with
 * zero populated keys on EITHER side and otherwise demands an equal populated key set carrying
 * equal values, so two things must hold at once: the scope must carry at least one populated key,
 * and the mint side and the read side must produce the same bytes. A filesystem path would satisfy
 * the first and break the second — the committed ledger is inherited by checkouts whose absolute
 * paths differ, so a path-derived scope would mint a grant that only the machine that wrote it
 * could ever match, which is the committed-artifact failure the quarantine ledger already had to
 * fix once. A single literal is the same bytes on every checkout.
 *
 * RETUNE NOTE: real scope issuance belongs to M5's cloud-auth model, which owns what an org and a
 * project identifier actually mean. Until then every grant in a repository shares this one scope,
 * so scope is not yet a narrowing dimension — `actionClass` carries the whole of the narrowing
 * (D-04's exact-op-id rule). When M5 lands, this constant is replaced by issued scope and the mint
 * and the invoke side both move together, because they both read THIS symbol and never re-spell it.
 */
export const STANDING_APPROVAL_SCOPE: TrustScope = Object.freeze({
  project: 'local-workspace',
})

/**
 * Every event carries the version stamp, its kind, the ISO instant it was authored at, and the id
 * that ties a revoke to the grant it withdraws.
 */
interface GrantLedgerEventBase {
  /**
   * The CURRENT version literal, not `number`. The literal closes the one producer no runtime check
   * on the write path can reach: an in-tree TypeScript author hand-stamping a superseded version.
   * That producer is not hypothetical — phase 390 got it wrong twice on the sibling ledger, in
   * fixtures that survived review because of where the objects happened to go rather than because
   * anything stopped them.
   *
   * The literal is free only while {@link GRANT_LEDGER_MIGRATIONS} stays empty. If a migration is
   * ever registered, this type becomes a UNION of the current version plus every version carrying
   * one — the rule {@link guardGrantLedgerEvent} already enforces on the read — and the append's
   * version pre-check widens the same way.
   */
  schemaVersion: typeof CURRENT_GRANT_LEDGER_SCHEMA_VERSION
  kind: GrantLedgerEventKind
  /** ISO-8601 instant, stamped by the CALLER at write time (this module reads no clock). */
  at: string
  /** The grant's durable identity. A revoke addresses this and nothing else. */
  grantId: string
}

/** A standing approval opens: the exact class it covers, the scope it covers it in, its origin. */
export interface GrantRecordedEvent extends GrantLedgerEventBase {
  kind: 'grant'
  /**
   * The gate-seen action name, verbatim — see the module head. Exact match only: no wildcard, no
   * prefix, no family (D-04). One more ask per distinct op is the accepted cost of that.
   */
  actionClass: string
  /** The scope the class is pre-approved in; today always {@link STANDING_APPROVAL_SCOPE}. */
  scope: TrustScope
  /** The proposal whose accept-with-always form minted this grant, when there was one. */
  proposalId?: string
}

/** A standing approval closes. Identity only — the class it covered is on the grant event. */
export interface GrantRevokedEvent extends GrantLedgerEventBase {
  kind: 'revoke'
}

export type GrantLedgerEvent = GrantRecordedEvent | GrantRevokedEvent

/**
 * Thrown when a stored ledger line declares a `schemaVersion` this build cannot consume: newer than
 * {@link CURRENT_GRANT_LEDGER_SCHEMA_VERSION}, or older with no registered migration.
 *
 * The ledger is COMMITTED truth, so this is a hard failure rather than a skipped line. Skipping
 * would be safe in one direction and catastrophic in the other: a skipped `revoke` leaves an
 * approval standing that a human already withdrew.
 */
export class GrantLedgerVersionError extends VersionGuardError {
  constructor(found: number, supported: number) {
    super('GrantLedgerEvent', found, supported)
    this.name = 'GrantLedgerVersionError'
  }
}

/**
 * The older-version migration seam — DELIBERATELY EMPTY, registered so growth is additive. There is
 * no earlier version to migrate from: version 1 is the first.
 */
export const GRANT_LEDGER_MIGRATIONS: MigrationRegistry = {}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * A scope the gate could ever match on: an object carrying at least one populated key.
 *
 * The gate refuses an all-empty scope outright, so a grant carrying one is a line that folds,
 * lists, reads as authorization — and satisfies nothing, forever. Refusing it structurally keeps
 * the committed file free of approvals that only look like approvals.
 */
function isMatchableScope(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  const populated = (['org', 'project'] as const).filter((key) => isNonEmptyString(value[key]))
  if (populated.length === 0) return false
  return (['org', 'project'] as const).every(
    (key) => value[key] === undefined || isNonEmptyString(value[key]),
  )
}

/**
 * Fail-closed structural check on one stored event, at the depth the fold traverses: the kind
 * inside the closed union, the version field a number, the instant and the grant id present and
 * non-empty, and — on a `grant` — a non-empty action class, a scope the gate could match, and a
 * provenance id that is either absent or a real string.
 *
 * This is also the predicate the WRITE side ranges: the knowledge-local append pre-checks every
 * event with it, so no caller can commit bytes THIS guard will refuse. Note the scope — this is the
 * STRUCTURAL leg only, and its version clause asks merely that `schemaVersion` be a number.
 * {@link guardGrantLedgerEvent} wraps it in a version identity check, which the append ranges
 * SEPARATELY against {@link CURRENT_GRANT_LEDGER_SCHEMA_VERSION} rather than through this
 * predicate (the sibling ledger's 390-14 lesson: a structural predicate that only asks for a number
 * admits five versions the read then refuses).
 */
export function hasGrantEventShape(value: unknown): boolean {
  if (!isNonArrayObject(value)) return false
  if (typeof value.schemaVersion !== 'number') return false
  if (!isGrantLedgerEventKind(value.kind)) return false
  if (!isNonEmptyString(value.at)) return false
  if (!isNonEmptyString(value.grantId)) return false

  switch (value.kind) {
    case 'grant':
      return (
        isNonEmptyString(value.actionClass) &&
        isMatchableScope(value.scope) &&
        (!('proposalId' in value) || isNonEmptyString(value.proposalId))
      )
    case 'revoke':
      return true
  }
}

/**
 * The read side of the ledger version discipline: parse, reject-newer with a typed
 * {@link GrantLedgerVersionError}, migrate-older through {@link GRANT_LEDGER_MIGRATIONS}, then the
 * structural check. Every grant-ledger consumer routes here.
 */
export const guardGrantLedgerEvent = createVersionGuard<GrantLedgerEvent>({
  name: 'GrantLedgerEvent',
  current: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  migrations: GRANT_LEDGER_MIGRATIONS,
  error: GrantLedgerVersionError,
  shape: hasGrantEventShape,
})

/**
 * One folded standing approval: the durable identity, the class and scope it covers, when it was
 * recorded, and where it came from. This is what a `grants.list` verb renders and what the
 * standing-approval reader projects into the gate's own grant DTO.
 */
export interface ActiveStandingGrant {
  grantId: string
  actionClass: string
  scope: TrustScope
  /** The `at` of the `grant` event that recorded it. */
  grantedAt: string
  proposalId?: string
}
