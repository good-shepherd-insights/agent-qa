// The receipt line both chat surfaces render (Phase 394 plan 36, SC-5's reporting half).
//
// ONE RENDER, TWO SURFACES. `chat.ts` and `ask.ts` each carried a private copy of this function,
// byte-identical by intention (D-01: the one-shot and the REPL are the same turn, so a person's
// scripted run and their conversation must not disagree about what happened) and free to drift by
// construction. They import this module now, and `chat-command.test.ts`'s source pin fails if
// either surface re-grows a local `receiptLine` — the sharing is structural rather than promised.
//
// WHY THE OUTCOME IS RENDERED, AND WHY UNCONDITIONALLY (WINDOWS 124, owner-ratified 2026-08-13:
// the RENDERED LINE governs, not the persisted artifact). `Runs consumed: N (previewed up to M)` is
// composed into `ClauseReceipt.outcome` at `turn-engine.ts:176` and reaches the persisted clause
// receipt verbatim — and no surface ever printed it. A person who approved "up to 7 runs" was shown
// the worst case and never told it cost 1, which is the half of WTST-08's disclosure that makes the
// other half checkable. The field is rendered for EVERY receipt with no "only when it differs from
// the plain summary" branch, because a conditional render is a drop path with a condition on it,
// and a drop path is the defect this module closes.
//
// STILL NEVER A PAYLOAD (D-18). `outcome` is a one-line summary by its schema's own contract — for
// a failure the function layer's refusal NAME, for a fan-out the report's own sentence — so what
// this adds to the line is the same class of fact the line already carried, not a result body.
//
// NO PRINT SITE LIVES HERE. This returns a string; each surface emits it through the masker it
// already owns (`ask`'s `emitHuman`, chat's own masked write). A render that printed for itself
// would be a disclosure boundary with none of `unmaskForHumanOutput`'s cover.

import type { ClauseReceipt } from '@vostride/agent-qa-schema'
import pc from 'picocolors'

/**
 * One receipt line: what ran, how it went, the op's own name — and what it cost.
 *
 * The outcome rides a second indented line rather than the tail of the first, because the sentence
 * it carries is a full clause on the ops that have something to report and would push the clause a
 * person typed off the edge of a terminal on the ones that do not.
 */
export function receiptLine(receipt: ClauseReceipt): string {
  const status =
    receipt.status === 'executed'
      ? pc.green(receipt.status)
      : receipt.status === 'failed'
        ? pc.red(receipt.status)
        : pc.dim(receipt.status)
  return `  ${status}  ${pc.bold(receipt.functionId)}  ${pc.dim(receipt.clause)}\n`
    + `    ${pc.dim(receipt.outcome)}`
}
