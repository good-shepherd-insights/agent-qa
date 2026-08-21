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

import {
  remediesRenderableBy,
  type ClauseReceipt,
  type ClauseReceiptStatus,
  type GateRemedy,
  type RemedyKindFor,
} from '@vostride/agent-qa-schema'
import pc from 'picocolors'

/**
 * One receipt line: what ran, how it went, the op's own name — and what it cost.
 *
 * The outcome rides a second indented line rather than the tail of the first, because the sentence
 * it carries is a full clause on the ops that have something to report and would push the clause a
 * person typed off the edge of a terminal on the ones that do not.
 */
export function receiptLine(receipt: ClauseReceipt): string {
  return `  ${STATUS_STYLE[receipt.status](receipt.status)}  ${pc.bold(receipt.functionId)}`
    + `  ${pc.dim(receipt.clause)}\n    ${pc.dim(receipt.outcome)}`
}

/**
 * How each status reads on a terminal — TOTAL over the vocabulary, and that totality is the guard.
 *
 * IT WAS A TERNARY CHAIN UNTIL 399.1 (D-02, RESEARCH Pitfall 3), whose final `else` styled anything
 * it did not recognise as `pc.dim` — the `not-run` styling. `refused` would have landed there
 * silently: a security control's refusal wearing the "never attempted" affordance, on a build that
 * had just been changed specifically so a person could tell the difference. A record with no default
 * arm makes a FIFTH member a compile error at this line instead, which is the only version of this
 * guard that does not depend on somebody remembering to come here.
 *
 * THE FOUR STYLES ARE FOUR DIFFERENT FACTS, not a palette. `executed` is green because the thing was
 * carried out. `failed` is red because something went wrong and a person should look. `refused` is
 * yellow — a deliberate third colour, because a guardrail declining an op is neither of those: the
 * control worked, nothing is broken, and nothing happened. `not-run` is dim because the clause was
 * never attempted and is the one line here that is not about an act at all.
 */
const STATUS_STYLE = {
  executed: pc.green,
  failed: pc.red,
  refused: pc.yellow,
  'not-run': pc.dim,
} as const satisfies Record<ClauseReceiptStatus, (text: string) => string>

/**
 * A refusal as this door renders it: the canonical reason, then the ways forward A CLI READER CAN
 * ACTUALLY TAKE — and when there are none, the reason alone (400 D-15).
 *
 * WHY THIS IS NOT A SENTENCE THE GATE WRITES. Phase 399 measured the fail-closed denial telling an
 * MCP client to "opt in with --trust-session", a flag declared on `agent-qa run` and on no other
 * command. One string cannot be right for a terminal, a transcript, a protocol client and a
 * browser, and the shape of being wrong is always the same: one surface's instructions rendered to
 * a reader on another. The gate mints DATA now; this is the CLI's projection of it and nothing
 * else renders for the CLI (`399-friction-refusal-remedies-unreachable`).
 *
 * THE REASON IS RETURNED FIRST AND UNTOUCHED. It is the audit/log text and the previous phase
 * published its bytes; this function never edits it, only follows it.
 *
 * AN EMPTY PROJECTION APPENDS NOTHING, which is the half that had to be a decision rather than a
 * fallthrough. A render that reached for a line when it had nothing to offer would re-mint the
 * defect: a reader spending time on a way forward that is not there. `[reason]` is a complete
 * answer.
 *
 * NO PRINT SITE LIVES HERE, on this module's own charter: it returns strings, and the caller emits
 * them through the masker it already owns.
 */
export function denialDetailLines(
  reason: string,
  remedies: readonly GateRemedy[],
): readonly string[] {
  return [
    reason,
    ...remediesRenderableBy('cli', remedies).map(
      (remedy) => `  ${pc.dim(CLI_REMEDY_TEXT[remedy.kind as RemedyKindFor<'cli'>](remedy))}`,
    ),
  ]
}

/**
 * How each CLI-takeable remedy reads on a terminal — TOTAL over that set, and the totality is the
 * guard, on `STATUS_STYLE`'s argument one screen up.
 *
 * THE KEY SET IS DERIVED, NOT LISTED. `RemedyKindFor<'cli'>` is computed from the vocabulary's own
 * surface table, so the day a kind is added with `cli` among its surfaces, this record is missing
 * a required arm and THIS LINE fails to compile. A hand-written list of "the kinds the CLI
 * renders" would have been a second copy of that table, free to drift from it — and the drift
 * would present as a remedy the gate mints for this door and this door silently drops.
 *
 * THE FLAG'S NAME IS NOT SPELLED IN THIS FILE. It arrives in `params`, minted beside the gate arm
 * that knows it, because the one fact the todo turned on is WHICH COMMAND declares it — and a
 * render carrying its own copy of that answer is a third place for it to go stale.
 */
const CLI_REMEDY_TEXT = {
  'answer-confirm': () =>
    'answer the confirm prompt: re-run on an interactive terminal, with stdout not redirected',
  'trust-session-flag': (remedy: GateRemedy) => {
    const flag = remedy.params?.flag
    const command = remedy.params?.command
    if (flag === undefined) return 'opt in for this session with the trust-session flag'
    return command === undefined
      ? `opt in for this session with ${flag}`
      : `opt in for this session with \`agent-qa ${command} ${flag}\` `
        + '— declared on that command and no other'
  },
} as const satisfies Record<RemedyKindFor<'cli'>, (remedy: GateRemedy) => string>
