// `knowledge.proposal.apply` — the SECOND step, and the only op that commits (Phase 387,
// KREV-01 / D-17 · D-18).
//
// One apply for three verbs. Which verb is being applied is data on the PROPOSAL, not on this
// op, which is why a fourth review verb later is a new arm rather than a new capability every
// surface has to be re-taught — and why there is exactly one place in this layer where committed
// knowledge can change.
//
// It takes an ID and never a proposal document. A caller that could hand back an edited proposal
// would be able to apply deltas nothing ever computed, which is the whole reason the two steps
// are two steps: the deltas that get committed are the ones a propose wrote down and a reviewer
// looked at, read back off the durable store by the process doing the commit.
//
// The already-applied answer is an ARM of the result rather than a throw. A retrying surface —
// a dropped socket, a re-issued MCP call, an operator pressing the key twice — must be able to
// learn that its apply already happened AND what it did; a throw would say the first half while
// discarding the receipt, which is the one thing the caller asked for.

import { KnowledgeApplyOutcomeSchema, KnowledgeProposalApplyInputSchema } from '@vostride/agent-qa-schema'
import type { KnowledgeApplyOutcomeDto, KnowledgeProposalApplyInput } from '@vostride/agent-qa-schema'

import type { FunctionSpec } from '../spec.js'
import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from './knowledge-review-ids.js'

export { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from './knowledge-review-ids.js'

export const knowledgeProposalApplySpec: FunctionSpec<
  KnowledgeProposalApplyInput,
  KnowledgeApplyOutcomeDto
> = {
  id: KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
  summary: 'Apply a minted knowledge proposal through the Curator\'s one commit path.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  input: KnowledgeProposalApplyInputSchema,
  output: KnowledgeApplyOutcomeSchema,
  boundThrough: 'knowledgeReview',
  risk: { name: `fn:${KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID}`, recognized: true, readOnly: false },
  invoke(input, deps) {
    // Non-null: `boundThrough` makes an absent review port an `unbound` listing and a refusal at
    // the gate, both decided off this same `deps` record.
    return deps.knowledgeReview!.apply(input.proposalId)
  },
}
