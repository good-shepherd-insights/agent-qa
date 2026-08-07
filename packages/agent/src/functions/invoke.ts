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
// Caller-as-data (FUNC-03): the caller record is read in exactly two places in this file —
// the scope subset check below and the credential passthrough into the gate — plus the
// registry's safe-mode listing filter. `if (caller.surface === 'cli')` is the anti-pattern
// this layer exists to make impossible.

import { evaluate } from '@vostride/agent-qa-safety'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

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
 *   4. evaluate()              — verdict + audit row, for every op without exception
 *   5. binding check           — a declared-but-unbound op refuses AFTER it is audited
 *   6. dispatch                — the only place a spec implementation ever runs
 *   7. validate the output     — unary results honour their declared contract
 *
 * Stream ops (D-08) run through the SAME six steps: the gate verdict and its audit row are
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
  const policy = await evaluate(
    spec.risk,
    internals.resolveExecutionContext(),
    {
      actionScope: STANDING_APPROVAL_SCOPE,
      ...(caller.credential === undefined ? {} : { credential: caller.credential }),
    },
    {
      auditSink: internals.auditSink,
      ...(reader === undefined ? {} : { reader }),
      ...(internals.confirm === undefined ? {} : { confirm: internals.confirm }),
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
