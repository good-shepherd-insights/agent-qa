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

import { toSchemaProjection } from './declaration-projection.js'
import { configGetSpec } from './ops/config-get.js'
import { knowledgeBundlesListSpec } from './ops/knowledge-bundles-list.js'
import { runsEventsSpec } from './ops/runs-events.js'
import { runsGetSpec } from './ops/runs-get.js'
import { runsListSpec } from './ops/runs-list.js'
import { runsStartSpec } from './ops/runs-start.js'
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
  runsGetSpec as FunctionSpec,
  runsEventsSpec as FunctionSpec,
  // Declared in full, bound by nothing here (D-09) — the registry lists it so the gap is
  // visible; `invokeFunction` refuses it by name.
  runsStartSpec as FunctionSpec,
  knowledgeBundlesListSpec as FunctionSpec,
  configGetSpec as FunctionSpec,
]

export interface CreateFunctionRegistryOptions {
  /** Host-backed implementations the ops read through; built at the composition root. */
  deps: FunctionDeps
  /**
   * Sink `evaluate()` appends its execution-audit row to. The gate is the single audit
   * author (v48): the function layer passes the sink and never writes a row itself.
   *
   * REQUIRED, on the same discipline `FunctionDeps` uses (see spec.ts): a composition that
   * omits it fails to typecheck rather than quietly arming the whole capability set with no
   * audit trail. An optional sink made the unaudited composition the EASIEST one to write,
   * which is the fast path D-11 exists to forbid.
   */
  auditSink: AuditSink
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
  auditSink: AuditSink
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

/**
 * Freeze the parts of a spec enforcement reads (CR-04).
 *
 * The specs are module-level singletons, so a write reached through ONE listing used to
 * change what every registry in the process enforced. Freezing is idempotent and happens
 * at registration, which closes the escalation by whatever route a caller reaches the spec.
 *
 * The live `input`/`output` zod objects are deliberately NOT frozen: freezing a schema's
 * internals would break zod's own lazy caching. That is safe now for a structural reason
 * rather than a hopeful one — a declaration carries an inert projection, so no surface is
 * ever handed the schema object in the first place (BL-01). The earlier rationale here,
 * that freezing the spec made those properties unwritable, was a category error: it sealed
 * the property SLOT while the object it pointed at stayed wide open.
 *
 * WR-03: registration FREEZES the spec objects it is given, permanently and in place. Pass
 * a fresh object if the caller needs a mutable one afterwards.
 */
function freezeSpec(spec: FunctionSpec): FunctionSpec {
  Object.freeze(spec.requiredScopes)
  Object.freeze(spec.risk)
  return Object.freeze(spec)
}

/**
 * Project one spec into the capability-free view a surface receives.
 *
 * Constructed field by field rather than spread-minus-invoke, so a future spec field can
 * never leak the implementation into a listing by accident.
 *
 * COPY or PROJECT, then freeze — the view aliases nothing on the spec. The scalars are
 * copied, the two contracts become inert JSON-Schema projections, and the whole graph is
 * frozen. What a caller holds after this is data: there is no live validator on it to
 * replace, so a permitted listing is no longer a write handle onto the contract vocabulary
 * every firewalled surface shares (T-384-14).
 */
function declarationView(spec: FunctionSpec): FunctionDeclaration {
  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    requiredScopes: Object.freeze([...spec.requiredScopes]),
    resultKind: spec.resultKind,
    bindingStatus: spec.bindingStatus,
    input: toSchemaProjection(spec.input),
    output: toSchemaProjection(spec.output),
    risk: Object.freeze({ ...spec.risk }),
  })
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
    byId.set(spec.id, freezeSpec(spec))
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
    auditSink: options.auditSink,
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
