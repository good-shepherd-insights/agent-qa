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
//
// THE READ HALF OF D-05 IS HERE (Phase 391 plan 04). A grant whose action class is PROTECTED never
// comes back from this filter, and the mint in `operations.ts` would never have produced one. Both
// halves are necessary and neither subsumes the other, which is the whole argument for spending
// two guards on one rule:
//
//  - the MINT guards what a producer may author. It cannot guard what is already in the file.
//  - THIS guards what a COMMITTED file may authorize. `grants.jsonl` travels in pull requests and
//    is meant to be read by humans, which means it can be edited by them — and by anything that
//    can write into a checkout. A line typed in by hand parses, folds, and lists exactly like a
//    minted one, because it IS exactly like a minted one; the only thing that can refuse it is a
//    rule applied at the moment it would authorize something.
//
// The predicate is IMPORTED from schema and never re-spelled here: one definition, two consumers,
// in two different packages (388 C13). A local copy of the membership list is how the two sides of
// a two-sided contract start disagreeing about what they are protecting.

import {
  isProtectedActionClass,
} from '@vostride/agent-qa-schema'
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
      const { events, refusedLines } = readGrantLedger(options.knowledgeRoot)
      // The version arm's rule one grain smaller: a build that cannot read the authorization truth
      // must not guess at it, and the refused line may be the REVOKE somebody already issued.
      if (refusedLines.length > 0) return []
      return foldActiveGrants(events)
        // The D-05 read half runs FIRST, on the fold rather than on the match: what is being
        // refused is a class no approval may ever cover, and that is true of the LINE regardless of
        // which action happens to be in front of the gate. Ordering it before the exact-match
        // filter also means the refusal cannot be mistaken for a near-miss.
        .filter((grant) => !isProtectedActionClass(grant.actionClass))
        .filter((grant) => grant.actionClass === action.name)
        .map((grant) => ({ actionClass: grant.actionClass, scope: grant.scope }))
    },
  }
}
