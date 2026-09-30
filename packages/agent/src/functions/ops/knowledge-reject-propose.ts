// `knowledge.reject` — deprecate a candidate the caller does not stand behind (Phase 387, KREV-01; 432-12, D-05).
//
// 2026-09-30, 432-12 (D-04/D-05/D-09): the change APPLIES IN THE CALL. The op validates its input,
// hands the review port one direct change and answers what the explicit writer changed. Nothing is
// proposed and nothing waits for a second call; the retired `knowledge.reject.propose` id has no
// alias (D-02). This file keeps its name until the later rename audit, so its consumers move first.
//
// `knowledge-write` scope and `readOnly: false`, at the recognized-mutating floor: an explicit
// change to this machine's knowledge allows in every execution context (D-01, D-08). It binds
// through the OPTIONAL `knowledgeReview` dep, so a host with no review port lists it `unbound` BY
// NAME.
//
// The reason is REQUIRED by the input contract because the `Deprecate` delta this becomes
// requires one: a verb that admitted an empty reason would be inventing a justification for a
// decision somebody made.

import {
  KnowledgeRejectChangeInputSchema,
  KnowledgeChangeOutputSchema,
} from '@vostride/agent-qa-schema'
import type {
  KnowledgeRejectChangeInput,
  KnowledgeChangeOutput,
} from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionSpec } from '../spec.js'
import { KNOWLEDGE_REJECT_FUNCTION_ID } from './knowledge-review-ids.js'

export { KNOWLEDGE_REJECT_FUNCTION_ID } from './knowledge-review-ids.js'

export const knowledgeRejectSpec: FunctionSpec<KnowledgeRejectChangeInput, KnowledgeChangeOutput> = {
  id: KNOWLEDGE_REJECT_FUNCTION_ID,
  summary: 'Reject a knowledge candidate with a reason, applying the change in the call.',
  requiredScopes: ['knowledge-write'],
  resultKind: 'unary',
  input: KnowledgeRejectChangeInputSchema,
  output: KnowledgeChangeOutputSchema,
  boundThrough: 'knowledgeReview',
  risk: { name: `fn:${KNOWLEDGE_REJECT_FUNCTION_ID}`, recognized: true, readOnly: false },
  /**
   * `target-not-found` IS ABSENCE, WHICH IS AN ANSWER (399.1 D-01, plan 03's razor): a ref that
   * names nothing is an ordinary mistake and the store is intact. A policy text the writer refused
   * to materialize is a refusal: nothing was changed.
   */
  classify(output): ClauseVerdict {
    switch (output.outcome) {
      case 'applied':
        return { status: 'executed', outcome: `${output.verb} applied: ${output.recordIds.length} record(s) changed` }
      case 'target-not-found':
        return { status: 'executed', outcome: 'target-not-found: nothing was changed' }
      case 'refused':
        return { status: 'refused', outcome: `${output.reason}: nothing was changed` }
      default:
        return output satisfies never
    }
  },
  invoke({ operationId, ...input }, deps) {
    // Non-null: `boundThrough` makes an absent review port an `unbound` listing and a refusal at
    // the gate, so dispatch is only reached in a composition that supplied one. The identity is
    // lifted off the input because it names the change, not the verb: the verb input below is
    // exactly what the explicit writer validates.
    return deps.knowledgeReview!.change({
      verb: 'reject',
      input,
      ...(operationId === undefined ? {} : { operationId }),
    })
  },
}
