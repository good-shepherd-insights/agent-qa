// The standing-approval reader the policy gate consults (Phase 391, PROP-01 / D-11).
//
// This is the read half of the grant loop: the committed ledger says which approvals are in force,
// and the gate's ask arm asks THIS for the ones covering the action in front of it.
//
// SYNCHRONOUS BY CONTRACT. The gate's reader port answers synchronously, so this reads and folds
// the file per call rather than caching. That is deliberate on a committed artifact a human may
// edit or a `git pull` may replace mid-session: a cache would answer with an approval the file no
// longer carries, and the direction of that error is the wrong one. The cost is one small file read
// per ASK — never per invocation, because only the ask tier reaches the reader at all.
//
// SCHEMA TYPES ONLY. The port is satisfied structurally rather than by importing it: this package
// may not depend on the policy layer (the arch direction rule), so the return type is schema's own
// `StandingApprovalGrant` and the shape of the object is what makes it a reader.
//
// EXACT MATCH ONLY (D-04). The filter below is `===` on the action name. No prefix, no wildcard, no
// family: a grant covers the one op it was minted for, and the gate re-checks the same rule through
// `grantCovers` afterwards. Scope is deliberately NOT filtered here — the gate owns scope matching,
// and re-implementing it would be a second spelling of the rule that decides whether an approval
// applies.
//
// A VERSION ERROR PROPAGATES. `readGrantLedger` hard-fails a line this build cannot consume, and
// that throw is allowed out of `grantsFor` rather than being swallowed into "no grants". Both
// arms fail closed — an unreadable ledger grants nothing either way — so the choice is only about
// whether the human is told. Silence would leave an operator staring at a denial with a perfectly
// good approval sitting in their file.

import {
  foldActiveGrants,
  readGrantLedger,
} from './ledger.js'
import type {
  RiskActionDescriptor,
  StandingApprovalGrant,
  TrustScope,
} from '@vostride/agent-qa-schema'

export interface StandingApprovalReaderOptions {
  /** The committed knowledge root the ledger lives directly under. */
  knowledgeRoot: string
}

/**
 * Structurally compatible with the policy layer's `StandingApprovalReader`. Named here so a
 * composition can spell the type it is binding without reaching across the package boundary.
 */
export interface GrantLedgerStandingApprovalReader {
  grantsFor(
    action: RiskActionDescriptor,
    actionScope: TrustScope,
  ): readonly StandingApprovalGrant[]
}

/**
 * Build a reader over one committed grant ledger.
 *
 * `actionScope` is accepted and deliberately unused: the gate applies it through `grantCovers`
 * immediately after this returns, and applying it twice — once here, once there — would be two
 * chances to disagree about whether an approval is in scope.
 */
export function createStandingApprovalReader(
  options: StandingApprovalReaderOptions,
): GrantLedgerStandingApprovalReader {
  return {
    grantsFor(action: RiskActionDescriptor): readonly StandingApprovalGrant[] {
      const { events } = readGrantLedger(options.knowledgeRoot)
      return foldActiveGrants(events)
        .filter((grant) => grant.actionClass === action.name)
        .map((grant) => ({ actionClass: grant.actionClass, scope: grant.scope }))
    },
  }
}
