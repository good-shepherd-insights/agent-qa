// `proposals.reject` — the decision only a person may make (Phase 391, PROP-03 / D-06 · D-12).
//
// `requiresHumanOrigin: true`, and this is the mechanism's first real client. 391-02 built the
// axis and enforced it at one line of `invokeFunction` against synthetic fixture specs; from here
// it guards a shipped verb.
//
// WHY THIS VERB AND NOT THE PROPOSE VERBS. Rejecting is not a smaller version of proposing — it
// is the act of DISPOSING of somebody else's proposal, and the proposal in question is usually
// the agent's own. An agent that could reject would be able to quietly retire every suggestion it
// no longer felt like standing behind, and the inbox a human checks would show the subset the
// agent chose to leave there. That is not a hypothetical failure of trust; it is the exact shape
// L5 names — the LLM proposes, code disposes — inverted. So the refusal is DATA on this op,
// checked once at the single dispatch pipeline, and never a branch on which surface called.
//
// `approval-write`, NOT `knowledge-write`, and the departure from the plan's wording is measured
// rather than stylistic. `knowledge-write` is the power to change what the system LEARNED; this
// verb changes nothing a knowledge reader can see — it commits no delta, scrubs no projection,
// and the payload it declines stays on disk forever. What it does is answer a standing question
// about what the system may do, which is what 391-02 minted `approval-write` for. The scope also
// has to survive 393-396: the envelope is kind-generic by construction, so a `knowledge-write`
// spelling here would be the one op in the family whose scope stops making sense the moment a
// config-kind or test-draft-kind proposal reaches the same inbox.
//
// RECOGNIZED MUTATING FLOOR, not an ask tier. Unlike `knowledge.proposal.apply` — which was
// raised to `mutating-shared` in 391-01 precisely because it commits — a reject commits nothing.
// It is a durable, retained, reversible-by-re-proposing record that somebody said no, and pricing
// it at the tier that demands a standing grant would put an approval in front of declining an
// approval.

import { ProposalsRejectInputSchema, ProposalsRejectOutputSchema } from '@vostride/agent-qa-schema'
import type { ProposalsRejectInput, ProposalsRejectOutput } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionDeps, FunctionSpec } from '../spec.js'

export const PROPOSALS_REJECT_FUNCTION_ID = 'proposals.reject'

export const proposalsRejectSpec: FunctionSpec<ProposalsRejectInput, ProposalsRejectOutput> = {
  id: PROPOSALS_REJECT_FUNCTION_ID,
  summary: 'Decline a pending proposal, recording the decision permanently.',
  requiredScopes: ['approval-write'],
  requiresHumanOrigin: true,
  resultKind: 'unary',
  boundThrough: 'proposalsInbox',
  input: ProposalsRejectInputSchema,
  output: ProposalsRejectOutputSchema,
  risk: { name: `fn:${PROPOSALS_REJECT_FUNCTION_ID}`, recognized: true, readOnly: false },
  /**
   * FIVE ARMS, NONE OF THEM A CONTROL DECLINING (399.1 D-01/D-02, plan 03's census).
   *
   * Four of them are the ways a proposal is already spoken for, and the contract keeps them apart
   * because a person acts differently on each. Not one is a guardrail refusing a reject it would
   * otherwise have carried out: they are the inbox reporting the state the caller found, which is
   * the same reading `proposals.accept` applies to its own `already-rejected` and `apply-in-flight`.
   * The refusals at THAT verb (`not-applyable`, `expired`) have no counterpart here — rejecting is
   * the decision a blocked or expired proposal is still available for.
   */
  classify(output): ClauseVerdict {
    switch (output.outcome) {
      case 'rejected':
        return { status: 'executed', outcome: `rejected ${output.entry.envelope.id}` }
      case 'already-applied':
        return { status: 'executed', outcome: 'already-applied: nothing was rejected' }
      case 'already-rejected':
        return { status: 'executed', outcome: 'already-rejected: somebody got there first' }
      case 'apply-in-flight':
        return { status: 'executed', outcome: `apply-in-flight: ${output.proposalId}` }
      case 'not-found':
        return { status: 'executed', outcome: `not-found: ${output.proposalId}` }
      default:
        return output satisfies never
    }
  },
  async invoke(input, deps: FunctionDeps) {
    const inbox = deps.proposalsInbox
    if (inbox === undefined) {
      throw new FunctionNotBoundError(PROPOSALS_REJECT_FUNCTION_ID)
    }

    // EVERY ALREADY-DECIDED SITUATION IS AN ARM, never a throw — the same posture
    // `knowledge.proposal.apply` takes toward a second apply. A retrying surface, two humans on
    // two machines and a race with an in-flight apply are all ordinary, and each one is answered
    // with what actually happened rather than with an error a caller has to parse.
    return await inbox.reject(input)
  },
}
