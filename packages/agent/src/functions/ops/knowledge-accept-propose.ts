// `knowledge.accept.propose` — promote a candidate the reviewer stands behind (Phase 387, KREV-01 / D-17).
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

import {
  KnowledgeAcceptProposeInputSchema,
  KnowledgeProposeOutcomeSchema,
} from '@vostride/agent-qa-schema'
import type {
  KnowledgeAcceptProposeInput,
  KnowledgeProposeOutcomeDto,
} from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionSpec } from '../spec.js'
import { KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID } from './knowledge-review-ids.js'

export { KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID } from './knowledge-review-ids.js'

export const knowledgeAcceptProposeSpec: FunctionSpec<KnowledgeAcceptProposeInput, KnowledgeProposeOutcomeDto> = {
  id: KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID,
  summary: 'Compute what accepting a knowledge candidate would change, committing nothing.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  input: KnowledgeAcceptProposeInputSchema,
  output: KnowledgeProposeOutcomeSchema,
  boundThrough: 'knowledgeReview',
  risk: { name: `fn:${KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID}`, recognized: true, readOnly: false },
  /**
   * `target-not-found` IS ABSENCE, WHICH IS AN ANSWER (399.1 D-01, plan 03's razor).
   *
   * A ref that names nothing is an ordinary human mistake — pasted out of a stale message, typed
   * from a screenshot — and the store is intact. `refused` would send a person hunting for a
   * guardrail. The echoed target travels on `results[]`, which D-04 renders in full.
   */
  classify(output): ClauseVerdict {
    switch (output.kind) {
      case 'proposed':
        return { status: 'executed', outcome: `proposed ${output.proposal.proposalId}` }
      case 'target-not-found':
        return { status: 'executed', outcome: 'target-not-found: nothing was proposed' }
      default:
        return output satisfies never
    }
  },
  invoke({ runId, ...input }, deps) {
    // Non-null: `boundThrough` makes an absent review port an `unbound` listing and a refusal at
    // the gate, so dispatch is only reached in a composition that supplied one. The two answers
    // come from the SAME `deps` record `resolveBindingStatus` reads, so they cannot disagree.
    // 391 D-15: the mint carries THIS op's id into the envelope, so the inbox can say where
    // the proposal came from. The id literal is the one in `knowledge-review-ids.ts` — never
    // re-spelled here, where a typo would be attribution nothing could resolve.
    // 391-07: `runId` is destructured OFF the input and travels in the origin instead, because
    // the run is a fact about the call rather than about the verb — the verb input below stays
    // exactly what `knowledge.proposal.apply` will replay. It is what the per-run digest groups
    // by; `emittedBy` distinguishes the job types WITHIN a run and groups nothing.
    return deps.knowledgeReview!.propose(
      { verb: 'accept', input },
      {
        emittedBy: KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID,
        // Spread rather than `runId` outright: an explicitly present `undefined` is a different
        // value from an absent key to `.strict()` schemas and to key-set comparisons downstream.
        ...(runId === undefined ? {} : { runId }),
      },
    )
  },
}
