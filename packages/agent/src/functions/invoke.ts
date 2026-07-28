// `invokeFunction` — THE surface-capability gate call-site (Phase 384, FUNC-01 / D-11).
//
// Two legitimate gate domains exist in this repo: in-run TOOL actions, gated by safety's
// own `createPolicyGateToolCallHook`; and surface CAPABILITIES, gated here. Nothing else
// may import `evaluate` (the arch pin asserts the exact file set).
//
// Uniform gating (D-11): EVERY invocation — reads included — computes a verdict and has
// an execution-audit row written by `evaluate()` through the injected sink. There is no
// fast path. A read bypass would turn scope enforcement into a second gate in disguise
// and would leave read capabilities unauditable.
//
// Caller-as-data (FUNC-03): the caller record is read in exactly three places across the
// layer — the scope subset check below, the registry's safe-mode listing filter, and
// audit attribution. `if (caller.surface === 'cli')` is the anti-pattern this layer exists
// to make impossible.

import { evaluate } from '@vostride/agent-qa-safety'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

import { registryInternals } from './registry.js'
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

  const policy = await evaluate(
    spec.risk,
    internals.resolveExecutionContext(),
    caller.credential === undefined ? {} : { credential: caller.credential },
    internals.auditSink === undefined ? {} : { auditSink: internals.auditSink },
  )
  if (policy.verdict === 'deny') {
    throw new FunctionDeniedError(functionId, policy.reason)
  }

  // Binding is checked AFTER the gate on purpose (D-09/D-11): an attempt to run a
  // capability this composition cannot run is exactly the kind of thing an audit trail
  // must record. The DECLARATION is authoritative — a spec that says `unbound` never
  // dispatches, whatever its implementation happens to do.
  if (spec.bindingStatus === 'unbound') {
    throw new FunctionNotBoundError(functionId)
  }

  const result = await spec.invoke(parsed.data, internals.deps)

  // A stream result IS the declared async iterable and passes through untouched: the
  // spec's `output` describes one ELEMENT, so parsing the iterable against it would be a
  // category error. Elements carry their own resume token, and the gate verdict above
  // already landed an audit row before anything could be yielded (D-08 / D-11).
  return spec.resultKind === 'unary' ? spec.output.parse(result) : result
}
