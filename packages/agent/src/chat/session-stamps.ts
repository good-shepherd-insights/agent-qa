// The session facts this surface owns, as a value two modules read (Phase 394, gap round 3, G-1).
//
// A LEAF MODULE rather than a direct planner-tools → turn-engine import. The stamp writes these
// fields at the invoke; the model-facing projection must withhold the same ones before the model
// decides. Both sides reading ONE value is the two-sided contract pin; keeping that value here
// keeps the chat subtree's import graph acyclic by construction rather than by luck.

import { AUTHORING_DRAFT_WRITE_FUNCTION_ID } from '../functions/ops/authoring-draft-write.js'
import { AUTHORING_DRAFT_VERIFY_FUNCTION_ID } from '../functions/ops/authoring-verify-draft.js'
import { AUTHORING_FUNNEL_GET_FUNCTION_ID } from '../functions/ops/authoring-funnel-get.js'

/**
 * The ops whose `sessionRef` this surface OWNS (394-17 / 394-19, D-12 · T-394-66 · T-394-74).
 *
 * A SET RATHER THAN AN ID, and that is CR-02's adjudicated fix rather than a generalisation for
 * its own sake. `authoring.draft.verify` carries the same field, spreads it onto the receipt it
 * persists, and is planner-reachable like every registered op — so a guard naming only the write
 * op left the identical forgery open one function id over. Membership makes the guarded vocabulary
 * a value `session-stamp-vocabulary.test.ts` can compare SET-EQUAL against the registry ops that
 * actually carry the field, so a future sibling gaining it reds a cell by the omitted name instead
 * of shipping unguarded. Dropping the field from the verify schema is NOT the alternative fix:
 * `shelf.verifyDraft` needs it to thread the loop's own ref.
 */
export const SESSION_STAMPED_FUNCTION_IDS: ReadonlySet<string> = new Set([
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  AUTHORING_DRAFT_VERIFY_FUNCTION_ID,
])

/** The ops whose `window` this surface may scope to the session it knows (394-19, D-12). */
export const WINDOW_STAMPED_FUNCTION_IDS: ReadonlySet<string> = new Set([
  AUTHORING_FUNNEL_GET_FUNCTION_ID,
])
