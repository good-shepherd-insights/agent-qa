// `proposals.list` — what is waiting on a human, enumerable (Phase 391, PROP-03 / D-15).
//
// §3.3's missing verb. A user cannot approve what they cannot enumerate, and until this op there
// was no way to ask: 387 wrote the proposals store and deliberately shipped no listing verb with
// it ("391 is the owner; this module is the substrate"), so a proposal minted by a KREV propose
// existed on disk with nothing in the system able to name it.
//
// THE OP RE-SORTS NOTHING. Deterministic order — minted-at, then id — is the STORE's law, pinned
// where it is implemented, for the same reason the quarantine ordering is: a second sort here
// would be a second declaration of it, free to agree today and disagree after the first tie-break
// change. What this op owns is the envelope and the filter.
//
// THE FILTER IS A PROJECTION over rows already in hand, never a second query. The port answers
// every row; this narrows them. That is what keeps "which name shape means which status" a rule
// in exactly one place while still letting a surface ask the question a human actually has.

import { ProposalsListInputSchema, ProposalsListOutputSchema } from '@vostride/agent-qa-schema'
import type { ProposalsListInput, ProposalsListOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

/**
 * Lowercase dot taxonomy (384 D-15): a new `proposals` domain, one noun.
 *
 * A taxonomy extension exactly as `quarantine.` and `entities.` were, and for the same reason:
 * a proposal is neither a run, a memory nor an analysis. Filing these under `knowledge.` would
 * have been the tempting move and is the wrong one — 393-396 add test-draft, config and MCP
 * kinds to the same envelope, and a verb named `knowledge.proposals.list` would then be listing
 * things that have nothing to do with knowledge.
 */
export const PROPOSALS_LIST_FUNCTION_ID = 'proposals.list'

export const proposalsListSpec: FunctionSpec<ProposalsListInput, ProposalsListOutput> = {
  id: PROPOSALS_LIST_FUNCTION_ID,
  summary: 'List every proposal awaiting, or already carrying, a human decision.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  // Bound exactly where a composition supplies the proposals store. An unbound host answering
  // `[]` would say "nothing is waiting on you" about a directory it has never been able to open,
  // which is a wrong answer wearing a correct one's clothes — and on this verb the wrong answer
  // is the one that makes a person stop checking (D-09).
  boundThrough: 'proposalsInbox',
  input: ProposalsListInputSchema,
  output: ProposalsListOutputSchema,
  risk: { name: `fn:${PROPOSALS_LIST_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(input, deps: FunctionDeps) {
    const inbox = deps.proposalsInbox
    if (inbox === undefined) {
      throw new FunctionNotBoundError(PROPOSALS_LIST_FUNCTION_ID)
    }

    const entries = await inbox.list()
    return {
      // An EMPTY listing is a result, not an absence (edge PROP-03/empty): a project with
      // nothing pending is the healthy state, and it reads identically to one that has never
      // proposed anything at all — because those are the same fact about the same project.
      entries: entries.filter(
        (entry) =>
          (input.status === undefined || entry.envelope.status === input.status)
          && (input.kind === undefined || entry.envelope.kind === input.kind),
      ),
    }
  },
}
