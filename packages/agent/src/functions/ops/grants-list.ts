// `grants.list` — what the agent may currently do without asking (Phase 391, D-03).
//
// A standing approval you cannot enumerate is the same hole PROP-03 names for proposals, reversed:
// a person who cannot see which classes are pre-approved cannot know what a run is allowed to do on
// their behalf, and the committed ledger — readable in a diff — is exactly the wrong thing to make
// them read by hand. So the enumeration ships in the same phase as the mint, and beside the revoke
// that acts on what it shows.
//
// READ TIER, and that is not a concession. Listing approvals discloses which op classes are
// pre-approved in this repository; it discloses nothing about what any of them would do, and the
// file it reads is committed and PR-visible by design. Pricing the read above `read` would put an
// approval in front of finding out what has been approved.
//
// THE LISTING IS UNFILTERED, including any grant whose class is protected. The port's own note
// carries the argument in full: `list` is a REPORT about the committed file while the reader's
// `grantsFor` is an AUTHORIZATION answer, and a protected line that reached the ledger by a
// hand-edit authorizes nothing but is precisely the line a reviewer has to be able to find — and
// the id `grants.revoke` needs to name.
//
// THE INPUT CARRIES NO FILTER. Here the `quarantine.list` precedent transfers rather than departing
// as the inbox's did: that argument is about a bounded set, and the grant fold is bounded by
// construction — a revoked approval leaves the fold rather than accumulating in it.

import { GrantsListInputSchema, GrantsListOutputSchema } from '@vostride/agent-qa-schema'
import type { GrantsListInput, GrantsListOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

/** The literal appears here once; every surface names the constant (384 D-15). */
export const GRANTS_LIST_FUNCTION_ID = 'grants.list'

export const grantsListSpec: FunctionSpec<GrantsListInput, GrantsListOutput> = {
  id: GRANTS_LIST_FUNCTION_ID,
  summary: 'List the standing approvals currently in force, with their provenance.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  boundThrough: 'standingGrants',
  input: GrantsListInputSchema,
  output: GrantsListOutputSchema,
  risk: { name: `fn:${GRANTS_LIST_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(_input, deps: FunctionDeps) {
    const grants = deps.standingGrants
    if (grants === undefined) {
      // An unbound host must refuse BY NAME. Answering `[]` would say "the agent has no standing
      // permissions" about a ledger it has never been able to open, which is a wrong answer wearing
      // a correct one's clothes — and the one that makes a person stop looking.
      throw new FunctionNotBoundError(GRANTS_LIST_FUNCTION_ID)
    }

    // An EMPTY listing is a result, not an absence: a project where nobody has granted standing
    // approval is the default state, and it reads identically to one whose ledger was never created.
    return { grants: [...await grants.list()] }
  },
}
