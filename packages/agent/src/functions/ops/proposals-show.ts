// `proposals.show` — the evidence, BEFORE the decision (Phase 391, PROP-03 / D-15).
//
// The verb that makes an inbox more than a queue. Its whole contract is that everything a human
// needs in order to decide is readable while the proposal is still pending: the payload the verb
// would commit, the forget receipt PREVIEW where there is one, the evidence refs to go and look
// at, and the origin that says who proposed it. A surface that could only show these after an
// accept would be asking people to approve first and read afterwards.
//
// TAKES AN ID, NEVER A DOCUMENT — the same rule `knowledge.proposal.apply` states. The id is
// parsed by `ProposalIdSchema` at the SCHEMA boundary, so the id-as-path law is enforced before
// this body runs and therefore before any value derived from a caller's string could reach a
// filesystem join (T-391-08).

import { ProposalsShowInputSchema, ProposalsShowOutputSchema } from '@vostride/agent-qa-schema'
import type { ProposalsShowInput, ProposalsShowOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

export const PROPOSALS_SHOW_FUNCTION_ID = 'proposals.show'

export const proposalsShowSpec: FunctionSpec<ProposalsShowInput, ProposalsShowOutput> = {
  id: PROPOSALS_SHOW_FUNCTION_ID,
  summary: 'Show one proposal in full — its payload, evidence refs and decision trail.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  boundThrough: 'proposalsInbox',
  input: ProposalsShowInputSchema,
  output: ProposalsShowOutputSchema,
  risk: { name: `fn:${PROPOSALS_SHOW_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(input, deps: FunctionDeps) {
    const inbox = deps.proposalsInbox
    if (inbox === undefined) {
      throw new FunctionNotBoundError(PROPOSALS_SHOW_FUNCTION_ID)
    }

    // NOT-FOUND IS THE PORT'S ANSWER, not a refusal assembled here. An id that names nothing is
    // an ordinary human mistake, and the arm carries the id back so a surface can say which one.
    return await inbox.show(input)
  },
}
