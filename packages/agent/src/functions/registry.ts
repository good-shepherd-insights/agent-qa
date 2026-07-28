// The function registry (Phase 384, FUNC-01 / FUNC-03).
//
// The registry OWNS the specs and hands out declaration views only. Its internals —
// the spec map, the injected deps, the audit sink, and the execution-context resolver
// — live in a module-private WeakMap that only `invokeFunction` reads. A surface holding
// a `FunctionRegistry` therefore has exactly one way to run a capability, and that way
// crosses the gate.

import { getActiveExecutionContext } from '@vostride/agent-qa-safety'
import type { AuditSink } from '@vostride/agent-qa-safety'
import type { ExecutionContext, FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'

import { runsListSpec } from './ops/runs-list.js'
import type { FunctionDeclaration, FunctionDeps, FunctionSpec } from './spec.js'

/** Thrown at construction when two declarations claim the same id — never last-wins. */
export class DuplicateFunctionIdError extends Error {
  constructor(readonly functionId: string) {
    super(`Duplicate function id: ${functionId}`)
    this.name = 'DuplicateFunctionIdError'
  }
}

/** The scopes safe mode is willing to list. Cosmetic only — see `FunctionCaller`. */
const SAFE_MODE_SCOPES: readonly FunctionScope[] = ['read']

/** The capabilities every composition of this layer registers. */
const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [
  runsListSpec as FunctionSpec,
]

export interface CreateFunctionRegistryOptions {
  /** Host-backed implementations the ops read through; built at the composition root. */
  deps: FunctionDeps
  /**
   * Sink `evaluate()` appends its execution-audit row to. The gate is the single audit
   * author (v48): the function layer passes the sink and never writes a row itself.
   */
  auditSink?: AuditSink
  /** Defaults to safety's ambient resolver; injected in tests for determinism. */
  resolveExecutionContext?: () => ExecutionContext
}

export interface FunctionRegistry {
  /**
   * Declaration views, sorted lexicographically by id. When `caller.safeMode` is true
   * the listing hides ops whose required scopes exceed `read` — a COSMETIC filter;
   * enforcement stays server-side in `invokeFunction` (FUNC-03).
   */
  list(caller: FunctionCaller): readonly FunctionDeclaration[]
}

interface RegistryInternals {
  specs: ReadonlyMap<string, FunctionSpec>
  deps: FunctionDeps
  auditSink?: AuditSink
  resolveExecutionContext: () => ExecutionContext
}

const REGISTRY_INTERNALS = new WeakMap<FunctionRegistry, RegistryInternals>()

/**
 * INTERNAL seam for `invokeFunction`. Returns `undefined` for any object that did not
 * come out of `createFunctionRegistry` — such an object registers no specs at all, so
 * every id looks unknown to it.
 */
export function registryInternals(registry: FunctionRegistry): RegistryInternals | undefined {
  return REGISTRY_INTERNALS.get(registry)
}

function declarationView(spec: FunctionSpec): FunctionDeclaration {
  // Constructed field by field rather than spread-minus-invoke so a future spec field
  // can never leak the implementation into a listing by accident.
  return {
    id: spec.id,
    summary: spec.summary,
    requiredScopes: spec.requiredScopes,
    resultKind: spec.resultKind,
    bindingStatus: spec.bindingStatus,
    input: spec.input,
    output: spec.output,
    risk: spec.risk,
  }
}

/**
 * INTERNAL: registry construction over an explicit spec set. Exported for tests and
 * future in-layer compositions, and deliberately absent from the package barrel — a
 * surface that could supply its own specs could mint capabilities the catalog never
 * declared.
 */
export function createRegistryFromSpecs(
  specs: readonly FunctionSpec[],
  options: CreateFunctionRegistryOptions,
): FunctionRegistry {
  const byId = new Map<string, FunctionSpec>()
  for (const spec of specs) {
    if (byId.has(spec.id)) {
      throw new DuplicateFunctionIdError(spec.id)
    }
    byId.set(spec.id, spec)
  }

  const sorted = [...byId.values()].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))

  const registry: FunctionRegistry = {
    list(caller) {
      return sorted
        .filter((spec) => (
          !caller.safeMode ||
          spec.requiredScopes.every((scope) => SAFE_MODE_SCOPES.includes(scope))
        ))
        .map(declarationView)
    },
  }

  REGISTRY_INTERNALS.set(registry, {
    specs: byId,
    deps: options.deps,
    ...(options.auditSink === undefined ? {} : { auditSink: options.auditSink }),
    resolveExecutionContext: options.resolveExecutionContext ?? getActiveExecutionContext,
  })

  return registry
}

/** Build the registry of built-in capabilities over composition-supplied dependencies. */
export function createFunctionRegistry(
  options: CreateFunctionRegistryOptions,
): FunctionRegistry {
  return createRegistryFromSpecs(BUILT_IN_FUNCTION_SPECS, options)
}
