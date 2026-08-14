// Where a write_test request goes when the project has no target for it (395-08, D-14/D-15 ·
// CFGM-05).
//
// THIS IS THE SEAM, AND FINDING IT WAS THE FIRST THING THIS PLAN HAD TO DO. The plan's design note
// says "where the chat turn resolves a write_test request's target against configuredTargetNames".
// No such place exists. `AuthoringDraftWriteInputSchema` carries `intent` (free text) and an
// optional `scope`; the TARGET is decided inside the authoring loop, by a model, from a draft it
// compiled — `loop.ts:583` reads the vocabulary and `loop.ts:647` checks the emitted name against
// it, both AFTER an LLM call. So the pre-dispatch question cannot be "does the request's target
// match" (there is no target on the request). It is: given this project's configured vocabulary and
// the words the person actually typed, is there anything to author against at all?
//
// THE AUTHORING LOOP'S OWN BACKSTOP IS UNTOUCHED, WHICH IS RESEARCH PITFALL 6. This resolver runs
// BEFORE dispatch and answers about the REQUEST; `AuthoringDraftUnconfiguredTargetError` runs after
// compilation and answers about what the MODEL emitted. They guard different failures — a project
// with nothing to write for, and a model that named a target this project does not declare — and
// collapsing either into the other would leave one of them unguarded.
//
// THE PASSTHROUGH ARM IS THE COMMON CASE AND IT IS DELIBERATELY WIDE. "Write a test for the login
// flow" in a configured project names no target and no hostname, and it must reach authoring
// exactly as it does today: `deriveDefaultAuthoringScope` resolves the scope from the project's own
// targets and committed tests, and the loop's backstop catches an emission that goes wrong. A
// resolver that refused every intent it could not attribute would break the shipped path for the
// majority of real requests, in the name of a from-zero case none of them are.
//
// THE REFUSAL ARM IS THEREFORE NARROW, AND ITS PRECONDITION IS THE PROJECT RATHER THAN THE WORDING:
// a project that declares NO targets, and an utterance carrying no hostname. That is exactly D-15's
// sentence — "anything else with no configured-target match gets a typed refusal asking for a URL or
// target name" — read where it is actually true.
//
// TOKENS, NOT SUBSTRINGS. A configured target named `shop` must not match the word `workshop`, and
// a hostname must be a whole word rather than a fragment of one. The split is on characters that
// cannot appear in a hostname or in a target name, so the tokens this sees are the words a person
// typed.

import { parseHostnameToken } from './hostname-gate.js'

/** Everything a hostname and a registry key CAN hold. Splitting on the complement yields words. */
const TOKEN_SPLIT = /[^A-Za-z0-9.:/?=&@_-]+/

export type WriteTestRoute =
  | {
    /** A configured target is named in the utterance. Dispatch authoring, unchanged. */
    readonly kind: 'configured'
    readonly name: string
  }
  | {
    /** Nothing to decide here. The authoring loop derives its own scope, as it always has. */
    readonly kind: 'passthrough'
  }
  | {
    /** A hostname this project does not configure. Scaffold it, then author (D-14). */
    readonly kind: 'scaffold'
    readonly domain: string
    readonly targetName: string
  }
  | {
    /** No targets, no hostname. Ask; never guess (D-15). */
    readonly kind: 'refuse'
  }

/**
 * Route one write_test request, deterministically.
 *
 * ORDER IS THE CONTRACT. A configured name wins over a hostname, because a project that already
 * declares `booking-com` and is asked about `booking.com` wants the target it has — and scaffolding
 * would refuse `already-configured` one layer down anyway, which is a worse sentence for a request
 * that had a perfectly good answer.
 */
export function resolveWriteTestRoute(input: {
  readonly intent: string
  readonly configuredTargetNames: readonly string[]
}): WriteTestRoute {
  const tokens = input.intent.split(TOKEN_SPLIT).filter((token) => token.length > 0)
  const configured = new Set(input.configuredTargetNames)

  for (const token of tokens) {
    if (configured.has(token)) return { kind: 'configured', name: token }
  }

  for (const token of tokens) {
    const verdict = parseHostnameToken(token)
    if (verdict.kind !== 'hostname') continue
    // A hostname whose DERIVED name this project already declares is that target, spelled as a
    // domain. Answering `scaffold` here would send a person to a refusal for a target they have.
    if (configured.has(verdict.targetName)) {
      return { kind: 'configured', name: verdict.targetName }
    }
    return { kind: 'scaffold', domain: verdict.domain, targetName: verdict.targetName }
  }

  // A project with targets can author against them without being told which; a project with none
  // has nothing at all, and that is the one case where silence is unanswerable.
  return configured.size > 0 ? { kind: 'passthrough' } : { kind: 'refuse' }
}

/** The refusal a write_test request against an unconfigurable project earns (D-15, 387's posture). */
export const WRITE_TEST_UNCONFIGURED_DETAIL
  = 'this project has no agent-qa configuration, so there is no target to write a test against. '
    + 'Name the site\'s address (for example "write a test for example.com") and I will scaffold '
    + 'the configuration for review first — I will not guess which site you meant.'
