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

import type { ClauseVerdict, FunctionSpec } from '../spec.js'
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
  // 391 D-02, and every field is load-bearing:
  //   `recognized: true` with `readOnly: false` puts the classifier's floor at mutating-local;
  //   `declaredTier` raises it above that floor, and the raise is the point;
  //   the name tokens hit neither destructive lexicon, so nothing lifts it further.
  //
  // WHY THE RAISE. `mutating-local` allows in EVERY execution context by ratified spec, so this op
  // — the ONE place in this layer where committed knowledge changes — was never asked about. A
  // standing approval can only ever satisfy an ASK, so at the local floor there was no ask for a
  // grant to satisfy and the whole approval loop was unreachable on the one verb that needs it.
  // `mutating-shared` is also the honest classification independently of that: applying a proposal
  // writes the committed knowledge tree, which travels in pull requests to everyone sharing the
  // repository. It is not this machine's business alone.
  //
  // WHAT THE RAISE COSTS, stated plainly rather than discovered later: in a fail-closed context —
  // which is every context except an interactive terminal — an apply with no covering grant and no
  // credential now DENIES rather than proceeding. That is the intended posture (a commit to shared
  // knowledge should not happen unasked in CI or under the daemon), and the way through it is a
  // recorded standing approval, an interactive confirmation, or session trust.
  //
  // The three KREV propose verbs deliberately stay at the recognized-mutating floor: a proposal
  // commits nothing, so gating it would be asking about the request rather than the act.
  risk: {
    name: `fn:${KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
    declaredTier: 'mutating-shared',
  },
  /**
   * `applied | already-applied` — idempotency, not refusal (399.1 D-01, plan 03's razor).
   *
   * The same union `config.proposal.apply` carries and the same reading: a second apply of one
   * proposal is the store reporting a state it found. The verb applied travels with it, because
   * `forget` and `write` are very different things to have committed.
   */
  classify(output): ClauseVerdict {
    if (output.outcome === 'policy-materialize-refused') {
      return { status: 'refused', outcome: 'policy-materialize-refused: policy text was not written; proposal remains pending' }
    }
    return {
      status: 'executed',
      outcome: `${output.outcome}: ${output.proposal.verb} ${output.proposal.proposalId}`,
    }
  },
  invoke(input, deps) {
    // Non-null: `boundThrough` makes an absent review port an `unbound` listing and a refusal at
    // the gate, both decided off this same `deps` record.
    return deps.knowledgeReview!.apply(input.proposalId)
  },
}
