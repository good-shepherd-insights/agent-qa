// `knowledge.reject.propose` — deprecate a candidate the reviewer does not stand behind (Phase 387, KREV-01 / D-17).
//
// The FIRST of two steps, and the split is the requirement rather than a style. A one-shot
// mutating call would mean the only way to find out what a verb was about to do is to let it do
// it, and this op is the half that answers that question: it computes the §7.3 deltas the verb
// would commit, mints a durable proposal, and returns it having changed NOTHING in the knowledge
// store. `knowledge.proposal.apply` is the only op that commits.
//
// `knowledge-write` scope and `readOnly: false`, because proposing is the gesture that ARMS a
// change even though it performs none — the proposal it mints is directly applicable, so a
// caller who may not change knowledge may not mint one either. It binds through the OPTIONAL
// `knowledgeReview` dep and never `deps.knowledge`: the reader port is physically write-free and
// widening it here would hand a write path to every read-only surface (Pitfall 2). A host that
// supplies no review port lists this verb as `unbound` BY NAME and refuses it by name.
//
// The reason is REQUIRED by the input contract because the `Deprecate` delta this becomes
// requires one: a verb that admitted an empty reason would be inventing a justification for a
// human decision.

import { KnowledgeRejectInputSchema, KnowledgeProposeOutcomeSchema } from '@vostride/agent-qa-schema'
import type { KnowledgeRejectInput, KnowledgeProposeOutcomeDto } from '@vostride/agent-qa-schema'

import type { FunctionSpec } from '../spec.js'
import { KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID } from './knowledge-review-ids.js'

export { KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID } from './knowledge-review-ids.js'

export const knowledgeRejectProposeSpec: FunctionSpec<KnowledgeRejectInput, KnowledgeProposeOutcomeDto> = {
  id: KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID,
  summary: 'Compute what rejecting a knowledge candidate would change, committing nothing.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  input: KnowledgeRejectInputSchema,
  output: KnowledgeProposeOutcomeSchema,
  boundThrough: 'knowledgeReview',
  risk: { name: `fn:${KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID}`, recognized: true, readOnly: false },
  invoke(input, deps) {
    // Non-null: `boundThrough` makes an absent review port an `unbound` listing and a refusal at
    // the gate, so dispatch is only reached in a composition that supplied one. The two answers
    // come from the SAME `deps` record `resolveBindingStatus` reads, so they cannot disagree.
    // 391 D-15: the mint carries THIS op's id into the envelope, so the inbox can say where
    // the proposal came from and the digest can group by it. The id literal is the one in
    // `knowledge-review-ids.ts` — never re-spelled here, where a typo would be attribution
    // nothing could resolve.
    return deps.knowledgeReview!.propose(
      { verb: 'reject', input },
      { emittedBy: KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID },
    )
  },
}
