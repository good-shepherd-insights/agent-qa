// The op-result render both chat surfaces print (Phase 399.1 plan 01, D-04 · RC-1).
//
// ONE RENDER, TWO SURFACES, on `receipt-line.ts`'s charter and for its reason (D-01: the one-shot
// and the REPL are the same turn, so a person's scripted run and their conversation must not
// disagree about what happened). `chat.ts` and `ask.ts` import this module; a source pin fails if
// either surface grows a local copy, so the sharing is structural rather than promised.
//
// WHAT THIS CLOSES. Chat executed ops and printed `<op> completed` — for forty of the forty-three,
// the result reached nobody at all. The turn contract had no member that could carry a payload
// until 399.1's `results[]`, so the render had nothing to print even in principle; this is the
// other half of that repair.
//
// THE DEFAULT IS THE COMPLETE PAYLOAD, PRETTY-PRINTED, AND THAT IS THE DECISION (D-04). It mirrors
// `fn.ts`'s `emitHuman(JSON.stringify(result, null, 2))` — the door the UAT called honest — and it
// is chosen for a property no curated render has: it is STRUCTURALLY INCAPABLE of withholding a
// field. A hand-picked join of the fields somebody thought mattered is a drop site with a list
// attached, and RC-2 is that exact shape caught dropping `crossBoundary` above a confirm prompt.
// The forty-third op is covered here by construction rather than by somebody remembering it.
//
// PER-OP FOLDS ADD AND NEVER SUPPRESS. A registry-declared `renderResult` composes a human sentence
// on top of this; it does not filter, replace or elide it. That is a law rather than a convention
// (D-04/D-06): any future elision must be ANNOUNCED — "N bytes elided, `agent-qa fn <op>` for the
// full result" — and never silent. There is no size cap in this phase and no knob for one; 386
// D-15's pinned-constants law says no knob ships before evidence says what to set it to.
//
// NO PRINT SITE LIVES HERE, and no masking either. This returns strings; each surface emits them
// through the masker it already owns (`ask`'s `emitHuman`, chat's own masked write), which is where
// `unmaskForHumanOutput` belongs and the only place it may run. A render that printed for itself
// would be a disclosure boundary with none of that cover, and a render that unmasked for itself
// would put cleartext into whatever a caller did with the returned string.

import type { ClauseResult } from '@vostride/agent-qa-schema'
import pc from 'picocolors'

/**
 * Every executed clause's payload, as the lines a surface prints.
 *
 * EMPTY IN, EMPTY OUT. A turn where nothing ran renders nothing — not `[]`, not a header over
 * nothing. The receipts already say what happened, and an empty payload block would be noise on
 * every refused turn and every turn answered in prose.
 *
 * THE OP IS NAMED ONLY WHEN A TURN HAS MORE THAN ONE RESULT. A single-clause turn already has the
 * op's name on the receipt line directly above; repeating it would put the same word twice on two
 * consecutive lines. A compound turn needs it, because two payloads in sequence with no labels is
 * two documents a reader has to tell apart by content.
 */
export function renderClauseResults(results: readonly ClauseResult[]): string[] {
  if (results.length === 0) return []
  const lines: string[] = []
  for (const result of results) {
    if (results.length > 1) lines.push(pc.dim(result.functionId))
    lines.push(renderPayload(result.payload))
  }
  return lines
}

/**
 * One payload, whole.
 *
 * `JSON.stringify` CAN ANSWER `undefined` — for an undefined value, and for a function or symbol —
 * and a render that pushed that would print the word `undefined` where a result belongs. An op that
 * returned nothing is a real, ordinary thing (`resultKind: 'unary'` with a void-ish contract), and
 * what a person needs to read then is that there was nothing rather than a JavaScript keyword.
 */
function renderPayload(payload: unknown): string {
  const rendered = JSON.stringify(payload, null, 2)
  return rendered === undefined ? pc.dim('(no result)') : rendered
}
