// The session pin holder — `/pin`'s agent-side half (Phase 392, D-21, plan 05).
//
// THREE PROPERTIES, and each one closes a specific way this feature could be a lie.
//
// 1. TIGHTEN-ONLY BY TYPE. The holder publishes `pin`, `list`, `asGateDeny` and nothing else: no
//    unpin, no clear, no replace. A pin dies when the session does, and that is not a policy this
//    module remembers — it is the absence of a method. The DTO underneath carries a deny list and
//    no allow list (see the schema module), so "a pin loosened something" is not a state either
//    half can represent. The gate's own hook answers a boolean whose only true branch writes a
//    deny, which is the third independent place the same claim is structural rather than checked.
//
// 2. THE SPELLING IS VALIDATED AGAINST THE REGISTRY. Every registered op declares its risk name as
//    `fn:<id>`, and the gate compares against exactly those bytes. So an overlay holding a BARE op
//    id matches nothing at all: a person watches a pin be accepted, and it then denies nothing for
//    the rest of the conversation. That is the silent no-op 391-05 measured, and it is worse than
//    an error because the feature's whole value is that a person believes it worked. A class that
//    matches no registered op's risk name is therefore a NAMED refusal carrying the input verbatim
//    — never an accepted pin, never a normalisation that guesses.
//
// 3. THE PREDICATE IS A LIVE VIEW, NOT A SNAPSHOT. `asGateDeny()` reads the set at call time. The
//    composition root binds the gate hook ONCE, before the first turn of any conversation it will
//    serve (plan 08), and a person types `/pin` somewhere in the middle of one; a snapshot taken at
//    bind time would be empty forever, which is property 2's failure mode arriving by a different
//    road. WHICH holder that hook reads is a fact about the CALLER — one holder per session, chosen
//    by `caller.sessionId` (plan 13, W-03) — which is what makes property 1's "a pin dies when the
//    session does" literally true rather than true of the process.
//
// WHAT THIS MODULE IS NOT: a gate. It holds no verdict logic and reaches no capability. It walks
// DECLARATIONS — the capability-free view — so it cannot dispatch anything, and the only thing it
// hands out is a predicate over an action descriptor.

import { pinDenies } from '@vostride/agent-qa-schema'
import type {
  ChatPinOverlay,
  FunctionCaller,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { SessionDenyOverlay } from '@vostride/agent-qa-safety'

import type { FunctionDeclaration } from '../functions/spec.js'

/**
 * The prefix every registered op's risk name carries, and therefore the only spelling the gate
 * ever compares against. Declared here as the thing a typed input is normalised TO; the ops
 * themselves derive their risk names the same way, and the registry walk below is what keeps the
 * two from being two answers.
 */
export const PIN_ACTION_CLASS_PREFIX = 'fn:'

/**
 * A `/pin` input that names no action class this host has.
 *
 * NAMED, like every other refusal this subtree publishes, and carrying its two operands as data:
 * the input exactly as typed, and the classes that do exist. A REPL rendering a suggestion should
 * read {@link knownActionClasses} rather than walking the registry a second time — a second walk
 * is a second answer to what is pinnable.
 */
export class ChatPinError extends Error {
  constructor(
    readonly input: string,
    readonly knownActionClasses: readonly string[],
    detail: string,
  ) {
    super(`Cannot pin "${input}": ${detail}`)
    this.name = 'ChatPinError'
  }
}

/**
 * What the holder needs of a registry: the listing, and nothing else.
 *
 * The narrower shape is named here for the reason its sibling in the planner projection names one
 * — a module holding a type with no internals seam cannot acquire the registry's internals even by
 * accident, so "the pin set is drawn from what this host declares" is a fact about the argument
 * rather than a rule about the body.
 */
export interface PinOverlaySource {
  list(caller: FunctionCaller): readonly FunctionDeclaration[]
}

/**
 * The session-scoped pin set. Mutable, in memory, and gone when the process that holds it is.
 *
 * The three members are the whole surface. See the module head for why a fourth would be a
 * different feature.
 */
export interface ChatPinOverlayHolder {
  /**
   * Record a pin, returning the normalised action class actually recorded.
   *
   * The RETURN VALUE is what a session event should log: a person typed `proposals.accept` and
   * what now denies is `fn:proposals.accept`, and a log that recorded the typed form would be a
   * record of the request rather than of the effect.
   *
   * Idempotent — pinning a class twice records it once.
   *
   * @throws {ChatPinError} when the input names no registered op's action class.
   */
  pin(input: string): string
  /** The active pins, as the DTO the gate hook and the session log both read. */
  list(): ChatPinOverlay
  /** The tighten-only predicate this session hands the gate (plan 08 binds it). */
  asGateDeny(): SessionDenyOverlay
}

/**
 * Normalise a typed action class to the `fn:`-prefixed risk-name spelling.
 *
 * Deliberately the whole of the normalisation: trim, and add the prefix when it is absent. No case
 * folding, no separator repair, no nearest-match. Every one of those would make some WRONG input
 * succeed, and a pin that succeeded against a class the person did not mean is the same silent
 * failure as a pin that matches nothing, wearing a more convincing disguise.
 */
function normalisePinInput(input: string): string {
  const trimmed = input.trim()
  return trimmed.startsWith(PIN_ACTION_CLASS_PREFIX)
    ? trimmed
    : `${PIN_ACTION_CLASS_PREFIX}${trimmed}`
}

/**
 * Create the session's pin holder over the capabilities this host declares.
 *
 * The caller is the session's own — supplied rather than invented here, because the registry's
 * safe-mode filter is a property of who is asking, and a holder that minted its own caller could
 * validate a pin against a listing the session itself can never see.
 */
export function createPinOverlay(
  source: PinOverlaySource,
  caller: FunctionCaller,
): ChatPinOverlayHolder {
  // Insertion-ordered: this is the record of what a person pinned, in the order they pinned it,
  // and a sorted view would lose that at no gain — membership is the only question anyone asks of
  // it, and `Set` answers that regardless of order.
  const pinned = new Set<string>()

  const knownActionClasses = (): readonly string[] =>
    source.list(caller).map((declaration) => declaration.risk.name)

  // Named once and closed over by both members below. A `this`-qualified call would have made the
  // predicate depend on how the holder was called, and a predicate handed to a gate is exactly the
  // kind of value that gets destructured on its way there.
  const snapshot = (): ChatPinOverlay => ({
    // A fresh frozen array per call: handing out the live set would let a caller that only asked
    // what is pinned change what is pinned, which is the loosen path this type has no method for.
    deniedActionClasses: Object.freeze([...pinned]),
  })

  return {
    pin(input) {
      const actionClass = normalisePinInput(input)
      const known = knownActionClasses()
      if (actionClass === PIN_ACTION_CLASS_PREFIX) {
        throw new ChatPinError(input, known, 'an action class is required')
      }
      if (!known.includes(actionClass)) {
        throw new ChatPinError(
          input,
          known,
          `"${actionClass}" is not an action class this host declares — a pin recorded against a `
            + 'name nothing answers to would be accepted and then deny nothing at all',
        )
      }
      pinned.add(actionClass)
      return actionClass
    },
    list: snapshot,
    asGateDeny() {
      // Closes over the SET, not over a snapshot of it — see property 3 in the module head. The
      // question is asked through schema's own predicate so the gate hook and the `/pin` verb
      // compare the same bytes the same way.
      return (action: RiskActionDescriptor) => pinDenies(snapshot(), action.name)
    },
  }
}
