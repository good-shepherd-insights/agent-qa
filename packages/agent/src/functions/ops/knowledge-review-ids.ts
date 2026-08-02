// The mutating review verbs' function ids (Phase 387, KREV-01 / D-17).
//
// Four ids in their own module for the same structural reason `entities-ids.ts` exists: the card
// action table advertises `knowledge.forget.propose` (D-11, the MEM row), and an op file that
// declared its own id beside its spec would close that into an import cycle the moment a card
// action pointed at it. Declaring them here means each id is one value with one definition and
// every importer reaches it in one direction.
//
// FOUR ids and THREE verbs, because the mutating half is two STEPS rather than three one-shot
// calls (D-17): each verb proposes, and one shared `knowledge.proposal.apply` commits. A surface
// that could reach a verb without an apply would be the L1/L2 violation KREV-01 exists to
// prevent, and there is deliberately no id here for one.

export const KNOWLEDGE_ACCEPT_PROPOSE_FUNCTION_ID = 'knowledge.accept.propose'

export const KNOWLEDGE_REJECT_PROPOSE_FUNCTION_ID = 'knowledge.reject.propose'

export const KNOWLEDGE_FORGET_PROPOSE_FUNCTION_ID = 'knowledge.forget.propose'

export const KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID = 'knowledge.proposal.apply'
