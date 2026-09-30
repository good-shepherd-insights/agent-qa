// `invokeFunction` — the single dispatch path every surface crosses (Phase 384, FUNC-01).
//
// 2026-09-30 (432-13, D-01/D-14/D-15): THERE IS NO OP GATE. The surface-capability `evaluate()`
// call that used to sit here — the ask ladder, its confirm port, the standing-approval reader and the
// chat session's deny overlay — is gone, and so is its `EVALUATE_PIN` entry. An op a caller may
// invoke runs once, in every execution context, and no execution-audit row is written for it.
//
// What stays is everything that is not an approval: the unknown-id refusal, input validation, the
// declared scope and origin checks (retired with the permission wave, 432-20/39), the binding
// check, the host's read scope, dispatch, and output validation for unary results.
//
// Caller-as-data (FUNC-03): the caller record is read in exactly two places in this file — the
// scope subset check and the actor-origin check beside it (391 D-06) — plus the registry's safe-mode
// listing filter. `if (caller.surface === 'cli')` is the anti-pattern this layer exists to make
// impossible, and the origin check is what keeps the self-grant rule from being written that way.

import type {
  FunctionCaller,
  FunctionCallerOrigin,
  FunctionScope,
  GateRemedy,
} from '@vostride/agent-qa-schema'

import { registryInternals, resolveBindingStatus } from './registry.js'
import type { FunctionRegistry } from './registry.js'
import { FunctionNotBoundError } from './spec.js'

// Declared next to `FunctionBindingStatus` (see spec.ts) and surfaced here so every
// caller-facing refusal this pipeline can raise is importable as one set.
export { FunctionNotBoundError }

/** No capability with this id is registered. Thrown before any dependency is touched. */
export class UnknownFunctionError extends Error {
  constructor(readonly functionId: string) {
    super(`Unknown function: ${functionId}`)
    this.name = 'UnknownFunctionError'
  }
}

/** The supplied input failed the op's declared input contract (D-14). */
export class FunctionInputError extends Error {
  constructor(
    readonly functionId: string,
    readonly issues: string,
  ) {
    super(`Invalid input for ${functionId}: ${issues}`)
    this.name = 'FunctionInputError'
  }
}

/** The caller's minted grants do not cover the op's required scopes (FUNC-03). */
export class FunctionScopeError extends Error {
  constructor(
    readonly functionId: string,
    readonly missingScopes: readonly FunctionScope[],
  ) {
    super(`Caller lacks required scopes for ${functionId}: ${missingScopes.join(', ')}`)
    this.name = 'FunctionScopeError'
  }
}

/**
 * The op declares a human-origin requirement and this caller is agent-origin (391 D-06).
 *
 * Mirrors {@link FunctionScopeError} deliberately, because it is the same KIND of refusal: a
 * caller-capability check against a composition-minted field, decided from op-declared data
 * before anything is dispatched. What a caller does next differs though, which is why it is a
 * distinct class rather than a scope error with a different message — a missing scope is
 * something a composition could grant, and a missing human is not.
 */
export class FunctionOriginError extends Error {
  readonly requiredOrigin: FunctionCallerOrigin = 'human'

  constructor(
    readonly functionId: string,
    readonly callerOrigin: FunctionCallerOrigin,
  ) {
    super(
      `${functionId} requires a human-origin caller; this call is ${callerOrigin}-origin`,
    )
    this.name = 'FunctionOriginError'
  }
}

/**
 * An invocation was refused with a decision's own reason.
 *
 * NO GATE RAISES THIS SINCE 432-13; the class stays for the doors and wire codecs that still
 * reconstruct it, and 432-19 narrows it with the remedy vocabulary.
 *
 * `remedies` CARRIES A DECISION'S OWN ANSWER TO "now what" (400 D-15), unprojected. Each surface
 * applies `remediesRenderableBy` at its render; this class does not choose for them, because it
 * cannot know which door it will be caught on — the same object reaches a terminal, a chat
 * transcript, an MCP client and the daemon's wire, and the whole finding
 * (`399-friction-refusal-remedies-unreachable`) is what happens when one of them is shown
 * another's instructions.
 *
 * IT IS AN ENUMERABLE OWN PROPERTY, which is load-bearing across the daemon: `wireError` preserves
 * exactly those, so the remedies survive the hop and the client reconstructs them. It DEFAULTS to
 * empty so a caller that has no gate decision in hand cannot be forced to invent one — and an
 * empty list renders as honest absence rather than as a wrong remedy.
 *
 * `neutralReason` IS THE PROSE HALF OF THE SAME REPAIR (400 gap round 1). `reason` is the gate's
 * canonical sentence and stays the message this error carries; `neutralReason` is that decision
 * said without naming a surface's affordance, for the doors whose reader cannot take the one the
 * canonical sentence names. It defaults to `reason` — a caller with no gate decision in hand has
 * only one sentence and copying it is the honest answer, where inventing a neutral one would be
 * this class writing policy prose it did not compose. The parameter is APPENDED so every existing
 * construction site stays valid positionally.
 */
export class FunctionDeniedError extends Error {
  constructor(
    readonly functionId: string,
    readonly reason: string,
    readonly remedies: readonly GateRemedy[] = [],
    readonly neutralReason: string = reason,
  ) {
    super(`Denied ${functionId}: ${reason}`)
    this.name = 'FunctionDeniedError'
  }
}

function issueSummary(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join('.')
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`
    })
    .join('; ')
}

/**
 * Run one registered capability on behalf of one caller.
 *
 * Order is load-bearing and asserted by tests:
 *   1. resolve the spec        — unknown id fails before any dependency is touched
 *   2. validate the input      — malformed input never reaches an implementation
 *   3. scope subset check      — computed here from composition-minted grants
 *   4. actor-origin check      — op-declared, against the composition-minted origin (391 D-06)
 *   5. binding check           — a declared-but-unbound op refuses by name
 *   6. dispatch                — the only place a spec implementation ever runs
 *   7. validate the output     — unary results honour their declared contract
 *
 * Stream ops (D-08) run through the SAME steps. Nothing between the refusals and dispatch asks
 * anybody anything (432-13).
 */
export async function invokeFunction(
  registry: FunctionRegistry,
  functionId: string,
  input: unknown,
  caller: FunctionCaller,
): Promise<unknown> {
  const internals = registryInternals(registry)
  const spec = internals?.specs.get(functionId)
  if (internals === undefined || spec === undefined) {
    throw new UnknownFunctionError(functionId)
  }

  const parsed = spec.input.safeParse(input)
  if (!parsed.success) {
    throw new FunctionInputError(functionId, issueSummary(parsed.error.issues))
  }

  const missingScopes = spec.requiredScopes.filter(
    (scope) => !caller.grantedScopes.includes(scope),
  )
  if (missingScopes.length > 0) {
    throw new FunctionScopeError(functionId, missingScopes)
  }

  // 391 D-06: the actor-origin check, beside the scope check because it is the same kind of thing:
  // a caller-capability question answered from op-declared data and a composition-minted field,
  // with no dependency touched and no implementation reachable. It comes AFTER the scope check so
  // the cheaper, more actionable refusal wins.
  //
  // Two fields are read and neither is `surface`. `if (caller.surface === 'chat')` would have
  // been the same behaviour today and the wrong mechanism forever: it makes the rule a property
  // of where a call came from rather than of what the op is.
  if (spec.requiresHumanOrigin === true && caller.origin !== 'human') {
    throw new FunctionOriginError(functionId, caller.origin)
  }

  // The DECLARATION is authoritative — an op this composition reports as `unbound` never
  // dispatches, whatever its implementation happens to do — and it is the SAME
  // `resolveBindingStatus` a listing renders, so what a caller was shown and what dispatch
  // enforces cannot disagree (D-16).
  if (resolveBindingStatus(spec, internals.deps) === 'unbound') {
    throw new FunctionNotBoundError(functionId)
  }

  const dispatch = () => spec.invoke(parsed.data, internals.deps)
  const result = spec.resultKind === 'unary' && spec.risk.readOnly === true
    && internals.withReadScope !== undefined
    ? await internals.withReadScope(functionId, dispatch)
    : await dispatch()

  // A stream result IS the declared async iterable and passes through untouched: the
  // spec's `output` describes one ELEMENT, so parsing the iterable against it would be a
  // category error. Elements carry their own resume token.
  return spec.resultKind === 'unary' ? spec.output.parse(result) : result
}
