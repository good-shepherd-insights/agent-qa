// The knowledge change ops' function ids (Phase 387, KREV-01; 432-12, D-05).
//
// In their own module for the same structural reason `entities-ids.ts` exists: the card action
// table advertises `knowledge.forget` (D-11, the MEM row), and an op file that declared its own id
// beside its spec would close that into an import cycle the moment a card action pointed at it.
// Declaring them here means each id is one value with one definition and every importer reaches it
// in one direction.
//
// 2026-09-30, 432-12 (D-02/D-05): the three verbs apply in the call. The `.propose` ids are gone
// with no alias; `knowledge.proposal.apply` stays only for the pre-432 records already on disk,
// until 432-17 deletes the inbox.

export const KNOWLEDGE_ACCEPT_FUNCTION_ID = 'knowledge.accept'

export const KNOWLEDGE_REJECT_FUNCTION_ID = 'knowledge.reject'

export const KNOWLEDGE_FORGET_FUNCTION_ID = 'knowledge.forget'

export const KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID = 'knowledge.proposal.apply'
