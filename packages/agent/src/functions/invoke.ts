// `invokeFunction` — THE surface-capability gate call-site (Phase 384, FUNC-01 / D-11).
//
// Two legitimate gate domains exist in this repo: in-run TOOL actions, gated by safety's
// own `createPolicyGateToolCallHook`; and surface CAPABILITIES, gated here. Nothing else
// may import `evaluate` (the arch pin asserts the exact file set).
//
// Uniform gating (D-11): every DISPATCHED invocation — reads included — computes a verdict,
// and `evaluate()` writes its execution-audit row through the injected sink. There is no
// fast path, in either sense: no op skips the gate, and no registry that could skip the
// sink can be constructed. That second clause is a RUNTIME property, not a promise the type
// checker makes to compiled callers only — `createRegistryFromSpecs` throws
// `MissingAuditSinkError` when the sink is absent or its two append methods are not
// callable, so a registry which exists at all has a usable sink, and every invocation this
// file dispatches therefore lands an execution-audit row. A read bypass would turn scope
// enforcement into a second gate in disguise and would leave read capabilities unauditable.
//
// What is NOT audited in 384, deliberately: the three refusals raised BEFORE the gate —
// unknown id, invalid input, and missing scopes — throw without writing a row, and the
// row `evaluate()` does write carries no caller identity. Both are real gaps, both are
// scoped work rather than oversights: refusal rows and caller attribution on the audit row
// are owned by Phases 386 and 396. The order this file implements is pinned by
// two-caller-parity.test.ts, which asserts a scope-refused caller leaves no audit row —
// so moving the scope check is a decision those phases make, not a local edit.
//
// Caller-as-data (FUNC-03): the caller record is read in exactly three places in this file —
// the scope subset check below, the actor-origin check beside it (391 D-06), and the
// credential passthrough into the gate — plus the registry's safe-mode listing filter.
// `if (caller.surface === 'cli')` is the anti-pattern this layer exists to make impossible,
// and the origin check is what keeps the self-grant rule from being written that way.

import { evaluate } from '@vostride/agent-qa-safety'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  FunctionCallerOrigin,
  FunctionScope,
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
 * before the gate is consulted. What a caller does next differs though, which is why it is a
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

/** The policy gate returned `deny` for this invocation. */
export class FunctionDeniedError extends Error {
  constructor(
    readonly functionId: string,
    readonly reason: string,
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
 *   5. evaluate()              — verdict + audit row, for every op without exception
 *   6. binding check           — a declared-but-unbound op refuses AFTER it is audited
 *   7. dispatch                — the only place a spec implementation ever runs
 *   8. validate the output     — unary results honour their declared contract
 *
 * Stream ops (D-08) run through the SAME steps: the gate verdict and its audit row are
 * therefore computed before a single event can be observed.
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

  // 391 D-06: the actor-origin check, placed HERE and not elsewhere — the choice is stated
  // because it is a choice, and because the file's order is a pinned contract.
  //
  // It sits in the pre-gate band beside the scope check because it is the same kind of thing: a
  // caller-capability question answered from op-declared data and a composition-minted field,
  // with no dependency touched and no implementation reachable. It therefore inherits that
  // band's audit posture — no row — which is the same gap 384 named for the other three
  // pre-gate refusals and which the same phases own closing. It comes AFTER the scope check so
  // the cheaper, more actionable refusal wins: a caller told which scopes it lacks has
  // something to do about it, and being told "this needs a human" first would have buried that.
  //
  // Two fields are read and neither is `surface`. `if (caller.surface === 'chat')` would have
  // been the same behaviour today and the wrong mechanism forever: it makes the rule a property
  // of where a call came from rather than of what the op is, so a new surface arrives
  // unprotected and an op that stops needing a human keeps being refused.
  if (spec.requiresHumanOrigin === true && caller.origin !== 'human') {
    throw new FunctionOriginError(functionId, caller.origin)
  }

  // 391 PROP-01: the ask arm's two dependencies, resolved here because this is the only place the
  // gate is ever called from. Before this, the call passed neither — and it also passed no action
  // scope, which the gate defaults to the empty object. An empty scope matches NOTHING on either
  // side of the comparison, so a standing approval was structurally unconsumable through this layer
  // whatever a reader returned. The scope below is the ONE pinned constant both the mint and this
  // call-site read; neither ever re-spells it, because the match demands byte equality.
  //
  // The scope is COMPOSITION-supplied, never caller input. A caller that could name the scope its
  // own action is evaluated under could widen any grant into a match by claiming the grant's scope.
  const reader =
    internals.standingApprovalReader === undefined
      ? undefined
      : await internals.standingApprovalReader()
  // 394-08 D-03 / WTST-08: the per-invocation DISCLOSURE, composed here because this is the only
  // place that holds both the spec and the parsed input at the moment the gate is called.
  //
  // IT IS A MESSAGE AND NOTHING ELSE. The descriptor handed to `evaluate` is `spec.risk` with one
  // extra display-only field: the name, the tier flags and the recognition are copied unchanged, so
  // the classification, the audit row, the standing-grant match and the session deny overlay all
  // see exactly what they saw before. Spread CONDITIONALLY, so an op with nothing to disclose hands
  // the gate the identical object it always did rather than one carrying `disclosure: undefined`.
  const action = spec.disclose === undefined
    ? spec.risk
    : { ...spec.risk, disclosure: spec.disclose(parsed.data) }
  const policy = await evaluate(
    action,
    internals.resolveExecutionContext(),
    {
      actionScope: STANDING_APPROVAL_SCOPE,
      ...(caller.credential === undefined ? {} : { credential: caller.credential }),
    },
    {
      auditSink: internals.auditSink,
      ...(reader === undefined ? {} : { reader }),
      ...(internals.confirm === undefined ? {} : { confirm: internals.confirm }),
      // 392 D-21 / plan 13: the session's deny overlay, threaded at the ONE `evaluate()` call-site
      // there is. Conditionally spread like its neighbours — an absent overlay must leave the
      // gate's ladder untouched, and a present-but-undefined field would be a second place the
      // default lives.
      //
      // THE ADAPTATION IS THE WHOLE OF W-03'S FIX AT THIS LAYER, and it is three tokens wide on
      // purpose. The composition's overlay wants to know WHICH SESSION is asking, so that a pin
      // belongs to the conversation that typed it; `evaluate()`'s hook takes an action and nothing
      // else. Closing over the caller here narrows the wider contract to the narrower one at the
      // boundary, which is why `gate.ts` and `SessionDenyOverlay` are byte-identical after this
      // change. A `sessionId` on the descriptor, or a gate that read callers, would have made the
      // policy engine depend on the function layer's vocabulary in order to answer one question.
      ...(() => {
        const overlay = internals.deny
        return overlay === undefined
          ? {}
          : { deny: (action: Parameters<typeof overlay>[0]) => overlay(action, caller) }
      })(),
    },
  )
  if (policy.verdict === 'deny') {
    throw new FunctionDeniedError(functionId, policy.reason)
  }

  // Binding is checked AFTER the gate on purpose (D-09/D-11): an attempt to run a
  // capability this composition cannot run is exactly the kind of thing an audit trail
  // must record. The DECLARATION is authoritative — an op this composition reports as
  // `unbound` never dispatches, whatever its implementation happens to do — and it is the
  // SAME `resolveBindingStatus` a listing renders, so what a caller was shown and what the
  // gate enforces cannot disagree (D-16).
  if (resolveBindingStatus(spec, internals.deps) === 'unbound') {
    throw new FunctionNotBoundError(functionId)
  }

  const result = await spec.invoke(parsed.data, internals.deps)

  // A stream result IS the declared async iterable and passes through untouched: the
  // spec's `output` describes one ELEMENT, so parsing the iterable against it would be a
  // category error. Elements carry their own resume token, and the gate verdict above
  // already landed an audit row before anything could be yielded (D-08 / D-11).
  return spec.resultKind === 'unary' ? spec.output.parse(result) : result
}
