// The deterministic stage-1 resolver table (Phase 392, D-05 / D-06).
//
// One module, hand-authored, CLOSED. Each entry is a pattern and the registry op it names — never a
// second capability vocabulary. The rule is 387 D-11's and it is absolute: EVERY function id below
// is IMPORTED from the module that declares it, never written as a literal. An op renamed at its
// declaration must break this file's compile rather than leave an alias pointing at a string
// nothing dispatches (`functions/entity-cards/actions.ts:10-14`).
//
// SEEDED WITH EXACTLY ONE ENTRY, and the smallness is the tracer's discipline rather than an
// omission. D-06's canon — `run <test>`, `status`, `test 42`, `digest`, `/model`, the `/fn`
// passthrough and the REPL chrome — is plan 02's, and it arrives with the meta-test that fails the
// build when a table entry has no scenario file. Adding six aliases here first would mean six
// untested branches before the mechanism that makes untested branches impossible exists.

import { PROPOSALS_LIST_FUNCTION_ID } from '../functions/ops/proposals-list.js'

/**
 * What one alias resolves to.
 *
 * `parseArgs` takes the whole clause rather than a pre-extracted remainder because the argument
 * grammar is per-alias — `run <test>` and `test 42` bind different things out of different
 * positions — and a shared extractor would be a second grammar to keep in step with the patterns.
 */
export interface ChatResolverEntry {
  readonly functionId: string
  readonly parseArgs: (clause: string) => unknown
}

/**
 * The table: a pattern predicate paired with what it resolves to.
 *
 * A predicate rather than a `RegExp` field, because plan 02's canon includes forms a regular
 * expression describes badly (a quoted test name, an entity short-id) and a table half of whose
 * entries carry a regex and half a function is a table with two matching rules.
 */
export interface ChatResolverRule {
  /** Human-readable name of the alias, used in the log and in the meta-test's scenario lookup. */
  readonly alias: string
  readonly matches: (clause: string) => boolean
  readonly entry: ChatResolverEntry
}

export type ChatResolverTable = readonly ChatResolverRule[]

/** Case- and whitespace-insensitive equality, the one comparison the tracer's single alias needs. */
function isExactly(word: string): (clause: string) => boolean {
  return (clause) => clause.trim().toLowerCase() === word
}

export const CHAT_RESOLVER_TABLE: ChatResolverTable = Object.freeze([
  Object.freeze({
    alias: 'proposals',
    matches: isExactly('proposals'),
    entry: Object.freeze({
      functionId: PROPOSALS_LIST_FUNCTION_ID,
      // No filter: "proposals" with nothing after it is the whole inbox, which is the question a
      // person asking that word has. The `--status`/`--kind` forms are the alias grammar plan 02
      // owns, and inventing one here would be inventing it twice.
      parseArgs: () => ({}),
    }),
  }),
])

/**
 * Stage 1 for one clause: the FIRST rule that matches, or nothing.
 *
 * First-match rather than unique-match, and the table is ordered rather than a map, because D-06's
 * canon has forms that legitimately overlap (`status` and `status <run>`), and "the earlier, more
 * specific rule wins" is a rule a reader of the table can see. Precision is 1.0 by construction —
 * every rule is an exact predicate over the clause, so a miss is a miss and never a guess (D-09).
 */
export function resolveClause(
  table: ChatResolverTable,
  clause: string,
): ChatResolverRule | undefined {
  return table.find((rule) => rule.matches(clause))
}
