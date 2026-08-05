// `quarantine.add` — manual entry, renewal and the owner claim, in one verb (Phase 390, D-13).
//
// The counterpart that makes D-05's narrow auto-gate livable. Automatic quarantine is reserved
// for the A3-routed classes (flake, environment, timeout) precisely so a real regression is
// never auto-silenced; a persistent `app_bug` keeps failing the build. This verb is how a human
// deliberately quarantines a test anyway — a known-broken one, a flake the ladder has not
// caught up with — which is a different act from the machine deciding to, and it is a different
// act because a person put their name on it.
//
// RE-ADDING RENEWS; IT DOES NOT THROW, AND IT IS NOT A SECOND VERB. In an append-only event log
// entry and renewal are one gesture with different prior state: an identity with an open window
// gets a `renewed` event extending the deadline and claiming the owner when one was supplied,
// and the result says `renewed` so the caller LEARNS which happened. Splitting claim and renew
// into their own verbs would have forced every caller to read the ledger's current state before
// it could choose a verb — a read whose answer can change between the two calls.
//
// A DIRECT GATED WRITE, NOT A PROPOSE+APPLY PAIR (D-13): see `quarantine-release.ts`. 391 may
// wrap both verbs in the proposal engine; this plan mints the direct form the engine would wrap.
//
// ---- WHY `knowledge-write` AND NOT A NEW SCOPE MEMBER --------------------------------------
//
// The question is real rather than clerical, because `knowledge-write` was itself minted (387,
// KREV-01) to avoid spending `config-write` on knowledge verbs — a PRIVILEGE CONFLATION, where
// one grant reaches a power it was never issued for. Asking the same question one level down:
// does "can edit knowledge records" belong with "can stop a failing test from failing builds"?
//
// It does, on the axis that argument turns on. The 387 split separated two powers that differ
// in KIND and in RECOVERABILITY — editing a config file back is not the §7.7 tombstone a forget
// leaves. Quarantine writes differ from knowledge writes on neither: both append to committed,
// human-reviewable text under the same knowledge root, both appear in PRs, and each of these
// two verbs REVERSES the other — which makes them strictly less consequential than the forget
// the same scope already covers. D-13's own words for them are deterministic, reversible, and
// low-risk. Suppression is additionally bounded by the D-11 expiry and loud in reporter output
// (D-15), so the power this scope licenses cannot become silent or permanent.
//
// Against that, minting a fifth member would have widened a closed union whose own dated note
// reserves further extension to 397 (the scope-lattice phase), and would have withheld nothing
// today: every shipped host — the CLI caller record and the daemon's — grants the full set, and
// says in writing that the scope's job locally is to make a capability's cost legible in the
// catalogue and the audit row rather than to withhold it. A new member would have been a
// cross-surface commitment made for a distinction no host currently draws.
//
// So: `knowledge-write`, deliberately, and 397 inherits the question with this reasoning
// attached rather than a pattern-match. The moment a host grants scopes selectively, splitting
// quarantine out becomes a real decision with a real consequence, and that is when to make it.

import {
  QuarantineAddInputSchema,
  QuarantineAddOutputSchema,
} from '@vostride/agent-qa-schema'
import type { QuarantineAddInput, QuarantineAddOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

/** The literal appears here once; every surface names the constant (384 D-15). */
export const QUARANTINE_ADD_FUNCTION_ID = 'quarantine.add'

export const quarantineAddSpec: FunctionSpec<QuarantineAddInput, QuarantineAddOutput> = {
  id: QUARANTINE_ADD_FUNCTION_ID,
  summary: 'Quarantine one test by hand, renewing and claiming an existing entry.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  boundThrough: 'quarantine',
  input: QuarantineAddInputSchema,
  output: QuarantineAddOutputSchema,
  risk: { name: `fn:${QUARANTINE_ADD_FUNCTION_ID}`, recognized: true, readOnly: false },
  async invoke(input, deps: FunctionDeps) {
    const quarantine = deps.quarantine
    if (quarantine === undefined) {
      // The loudest of the three refusals to get right: an unbound add that no-opped would
      // report a test as quarantined while it kept failing every build, and the operator would
      // read the next red as the quarantine not working rather than as never having existed.
      throw new FunctionNotBoundError(QUARANTINE_ADD_FUNCTION_ID)
    }

    // An absent `expiresAt` is left absent on purpose — the implementation stamps the pinned
    // default lifetime at write time. Defaulting it here would put a deadline into the request
    // the caller never asked for, and would be a second place the lifetime constant is spelled.
    return await quarantine.add(input)
  },
}
