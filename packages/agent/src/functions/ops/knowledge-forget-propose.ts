// `knowledge.forget` — tombstone a record or an addressed bundle and scrub its projections (Phase 387, KREV-01; 432-12, D-05/D-09).
//
// 2026-09-30, 432-12 (D-04/D-05/D-09): the change APPLIES IN THE CALL, and it is the explicit
// removal D-09 names. The op validates its input, hands the review port one direct change and
// answers the existing forget receipt: every record tombstoned, with its provenance, and the
// projections scrubbed. Tombstoned, never destroyed, so the record stays enumerable. The retired
// `knowledge.forget.propose` id has no alias (D-02). This file keeps its name until the later
// rename audit, so its consumers move first.
//
// `readOnly: false`, at the recognized-mutating floor: an explicit change to this machine's
// knowledge runs in every execution context (D-01, D-08). 2026-10-01 (432-23, D-12): it declares
// no `knowledge-write` scope any more; every door can call it. It binds through the OPTIONAL
// `knowledgeReview` dep, so a host with no review port lists it `unbound` BY NAME.

import {
  KnowledgeForgetChangeInputSchema,
  KnowledgeChangeOutputSchema,
} from '@vostride/agent-qa-schema'
import type {
  KnowledgeForgetChangeInput,
  KnowledgeChangeOutput,
} from '@vostride/agent-qa-schema'

import type { ClauseVerdict, FunctionSpec } from '../spec.js'
import { KNOWLEDGE_FORGET_FUNCTION_ID } from './knowledge-review-ids.js'

export { KNOWLEDGE_FORGET_FUNCTION_ID } from './knowledge-review-ids.js'

export const knowledgeForgetSpec: FunctionSpec<KnowledgeForgetChangeInput, KnowledgeChangeOutput> = {
  id: KNOWLEDGE_FORGET_FUNCTION_ID,
  summary: 'Forget a knowledge record or bundle, tombstoning it in the call.',
  resultKind: 'unary',
  input: KnowledgeForgetChangeInputSchema,
  output: KnowledgeChangeOutputSchema,
  boundThrough: 'knowledgeReview',
  risk: { name: `fn:${KNOWLEDGE_FORGET_FUNCTION_ID}`, recognized: true, readOnly: false },
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
    // `invokeFunction`'s binding check, so dispatch is only reached in a composition that supplied
    // one. The identity is
    // lifted off the input because it names the change, not the verb: the verb input below is
    // exactly what the explicit writer validates.
    return deps.knowledgeReview!.change({
      verb: 'forget',
      input,
      ...(operationId === undefined ? {} : { operationId }),
    })
  },
}
