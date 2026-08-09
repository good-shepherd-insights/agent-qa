// The deterministic conjunction grammar (Phase 392, D-09 / RESEARCH Pitfall 5).
//
// One utterance in, the clauses a person meant out. This is stage 1's other half: the closed
// resolver table decides what a clause MEANS, and this file decides what a clause IS. Both are
// deterministic and both are capped, because the mapper they feed OVERRIDES a model's plan (D-12)
// and an overriding path with a false-positive rate is worse than no overriding path at all.
//
// IT IS A CHARACTER SCAN, NOT A REGEX SPLIT, and that is the whole reason the module exists rather
// than one line at the call site. `utterance.split(/ and |;|,/)` passes every simple case and then
// tears `write a test for "add and remove items"` into two clauses, the second of which no
// capability handles — so the turn fails closed, loudly, on a request that was never compound.
// That is not a cosmetic bug: CHAT-03 measures the `mark_unhandled` rate over the frozen corpus,
// and a splitter that manufactures phantom clauses inflates the very number the ceiling exists to
// hold down (RESEARCH Pitfall 5). Quote state is therefore explicit and the scan is character-wise.
//
// RECONCILIATION RUNS UNIFORMLY ON SINGLE-CLAUSE TURNS. A one-clause utterance is a compound of
// one, and it takes the identical path through stages 2-4. There is no fast lane, because a fast
// lane is a second implementation of the turn contract that nothing keeps in step with the first.

import type { ChatClause } from './ports.js'

/**
 * The closed separator set.
 *
 * A PINNED CONSTANT, never config (386 D-15). RETUNE COMMENT: these four are the separators a
 * person actually types between two requests in one breath. Widening the set is a real decision
 * with a real cost — every token added is a token that can now split a clause that meant one
 * thing, and the failure is silent in the direction that matters (a phantom clause reads as a
 * refusal of something the person never asked for). Add a token only with a scenario that shows
 * the utterance it rescues, and re-run the ceiling measurement afterwards.
 *
 * The word tokens carry their own whitespace, which IS the word-boundary rule: ` and ` cannot
 * match inside `sandbox` or `android` because neither has a space where the token needs one. A
 * separate boundary check would be a second answer to a question the token spelling already
 * answers, free to disagree with it.
 *
 * Order is the order the scanner tries them. It is not load-bearing today — no token is a prefix
 * of another — and it is written longest-first anyway so that it stays not load-bearing.
 */
export const CONJUNCTION_TOKENS = [' and ', ' then ', ';', ','] as const

/** The quote characters that protect a span. Both, because people type both. */
const QUOTE_CHARACTERS = ['"', "'"] as const

type QuoteCharacter = (typeof QUOTE_CHARACTERS)[number]

function isQuoteCharacter(character: string): character is QuoteCharacter {
  return (QUOTE_CHARACTERS as readonly string[]).includes(character)
}

/**
 * The separator starting at `at`, or nothing.
 *
 * Case-insensitive on the word tokens, because `run X AND status` is the same request as its
 * lowercase twin and a person typing at a prompt is not thinking about case.
 */
function separatorAt(utterance: string, at: number): string | undefined {
  const lowered = utterance.toLowerCase()
  for (const token of CONJUNCTION_TOKENS) {
    if (lowered.startsWith(token, at)) return token
  }
  return undefined
}

/**
 * Split one utterance into the clauses stage 1 routes.
 *
 * Pure, total and host-free: no clock, no config, no I/O, and no input throws. An unterminated
 * quote is not an error a person should have to hear about — it protects to end-of-utterance,
 * which over-protects (one clause where two were meant) rather than under-protects (a phantom
 * clause and a spurious refusal). Pitfall 5 says which way to be wrong.
 *
 * Empty pieces are elided rather than preserved, so `status,,proposals` and `status, proposals`
 * are the same request. A clause whose text is empty could name nothing in a refusal, and D-08
 * requires that a fail-closed turn name what it could not do.
 */
export function splitClauses(utterance: string): readonly ChatClause[] {
  const pieces: string[] = []
  let current = ''
  let openQuote: QuoteCharacter | undefined
  let at = 0

  while (at < utterance.length) {
    const character = utterance[at]!

    if (openQuote !== undefined) {
      // Inside a quoted span nothing separates. The closing quote is kept in the clause text
      // because the text is what a refusal quotes back and what an arg parser reads.
      current += character
      if (character === openQuote) openQuote = undefined
      at += 1
      continue
    }

    if (isQuoteCharacter(character)) {
      openQuote = character
      current += character
      at += 1
      continue
    }

    const separator = separatorAt(utterance, at)
    if (separator !== undefined) {
      pieces.push(current)
      current = ''
      at += separator.length
      continue
    }

    current += character
    at += 1
  }
  pieces.push(current)

  const clauses: ChatClause[] = []
  for (const piece of pieces) {
    const text = piece.trim()
    if (text === '') continue
    // The index is the clause's position among the clauses that SURVIVED elision, which is what
    // the engine and the reconciler key on. It is a clause's identity within one turn, not an
    // offset into the utterance, and D-12's override depends on exactly that: a planner entry for
    // a clause the table already resolved cannot displace it, whatever the model called it.
    clauses.push({ text, index: clauses.length })
  }
  return clauses
}
