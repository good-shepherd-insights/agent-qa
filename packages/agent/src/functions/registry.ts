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
import type { FunctionBindingStatus } from './spec.js'
import { configGetSpec } from './ops/config-get.js'
import { entitiesGetSpec } from './ops/entities-get.js'
import { entitiesResolveSpec } from './ops/entities-resolve.js'
import { knowledgeBundlesListSpec } from './ops/knowledge-bundles-list.js'
import { knowledgeRecordShowSpec } from './ops/knowledge-record-show.js'
import { knowledgeRecordsDiffSpec } from './ops/knowledge-records-diff.js'
import { knowledgeRecordsInspectSpec } from './ops/knowledge-records-inspect.js'
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

/**
 * Thrown at construction when the registry is handed no usable audit sink (D-11).
 *
 * The type-level requirement below binds only the callers `tsc` gets to see. This is the
 * same guarantee stated as a RUNTIME property, so it also holds for an in-workspace cast
 * and for a plain-JS consumer of the published package. It is deliberately a REFUSAL and
 * not a default: silently substituting a no-op sink would make the unaudited composition
 * the one that constructs quietly, which is exactly the fast path D-11 abolishes.
 */
export class MissingAuditSinkError extends Error {
  constructor(readonly detail: string) {
    super(
      `createRegistryFromSpecs requires a usable AuditSink (D-11): ${detail}. ` +
        'The policy gate is the single audit author, so a registry built without one would ' +
        'arm every registered capability with no execution-audit trail at all.',
    )
    this.name = 'MissingAuditSinkError'
  }
}

/** The scopes safe mode is willing to list. Cosmetic only — see `FunctionCaller`. */
const SAFE_MODE_SCOPES: readonly FunctionScope[] = ['read']

/** The capabilities every composition of this layer registers. */
const BUILT_IN_FUNCTION_SPECS: readonly FunctionSpec[] = [
  runsListSpec as FunctionSpec,
  runsGetSpec as FunctionSpec,
  runsEventsSpec as FunctionSpec,
  // Bound exactly in the compositions that supply a `runInvocation` port (D-16); listed
  // either way, so a host that cannot start a run reports a visible `unbound` rather than a
  // hole in the catalog, and `invokeFunction` refuses it by name. `composeLocalAgent()` in
  // `@vostride/agent-qa-agent-local` is the binding site.
  runsStartSpec as FunctionSpec,
  knowledgeBundlesListSpec as FunctionSpec,
  // 387 KREV-01: the read half of the review-verb family. All three bind through the REQUIRED
  // `knowledge` port, so — unlike the mutating half 387-08 registers through the optional
  // `knowledgeReview` dep — there is no composition that lists these and cannot run them.
  knowledgeRecordsInspectSpec as FunctionSpec,
  knowledgeRecordsDiffSpec as FunctionSpec,
  knowledgeRecordShowSpec as FunctionSpec,
  configGetSpec as FunctionSpec,
  // 387 D-09: a new `entities.` domain, a taxonomy extension exactly as `knowledge.` was.
  // Both read-tier, both bound in every composition — the directory is a REQUIRED dep, so
  // there is no host that lists these and cannot run them.
  entitiesResolveSpec as FunctionSpec,
  entitiesGetSpec as FunctionSpec,
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
   *
   * Required at RUNTIME too, and that is the load-bearing half: `createRegistryFromSpecs`
   * throws {@link MissingAuditSinkError} when the sink is absent or its two append methods
   * are not callable. A type binds only the callers the compiler sees; the refusal binds a
   * cast and a plain-JS consumer of the published package as well.
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
 * Whether THIS composition can run the op (D-09/D-16) — the one place the answer is decided.
 *
 * A spec with no `boundThrough` needs only the required deps, which the type system already
 * guarantees, so it is bound wherever it is registered. A spec that names an optional dep is
 * bound iff this composition supplied one. Nothing is read off a static field, because there
 * is none to read: the alternative — a literal on the spec — is a claim a module-level
 * singleton makes about every composition in the process, and it would report `bound` from
 * the first host that omitted the implementation.
 *
 * Exported for `invokeFunction`, which refuses on the SAME answer a listing renders. Two
 * computations of "is it bound" would be two chances to disagree, and the disagreement a
 * caller would see is a capability that lists bound and refuses.
 */
export function resolveBindingStatus(
  spec: FunctionSpec,
  deps: FunctionDeps,
): FunctionBindingStatus {
  if (spec.boundThrough === undefined) return 'bound'
  return deps[spec.boundThrough] === undefined ? 'unbound' : 'bound'
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
function declarationView(spec: FunctionSpec, deps: FunctionDeps): FunctionDeclaration {
  return Object.freeze({
    id: spec.id,
    summary: spec.summary,
    requiredScopes: Object.freeze([...spec.requiredScopes]),
    resultKind: spec.resultKind,
    bindingStatus: resolveBindingStatus(spec, deps),
    input: toSchemaProjection(spec.input),
    output: toSchemaProjection(spec.output),
    risk: Object.freeze({ ...spec.risk }),
  })
}

/**
 * Refuse a construction that cannot produce an audit trail (BL-03 / D-11).
 *
 * One check at the ONE seam that populates the internals record, covering the three live
 * routes together: the field omitted or cast past the type, and a hollow object whose
 * append methods are absent or not callable. The methods are probed rather than the shape
 * asserted, because what the gate needs at dispatch time is two things it can call.
 */
function requireAuditSink(supplied: AuditSink | undefined | null): AuditSink {
  if (supplied === undefined || supplied === null) {
    throw new MissingAuditSinkError('no sink was supplied')
  }
  if (
    typeof supplied.appendExecutionAudit !== 'function' ||
    typeof supplied.appendGuardrailAudit !== 'function'
  ) {
    throw new MissingAuditSinkError(
      'the supplied sink does not implement callable appendExecutionAudit and ' +
        'appendGuardrailAudit methods',
    )
  }
  return supplied
}

/**
 * INTERNAL: registry construction over an explicit spec set. Exported for tests and
 * future in-layer compositions, and deliberately absent from the package barrel — a
 * surface that could supply its own specs could mint capabilities the catalog never
 * declared.
 *
 * WR-03: every spec handed here is FROZEN in place, permanently. Pass a fresh object if
 * the caller needs a mutable one afterwards.
 */
export function createRegistryFromSpecs(
  specs: readonly FunctionSpec[],
  options: CreateFunctionRegistryOptions,
): FunctionRegistry {
  // Before anything is registered: a registry that cannot audit must not come to exist,
  // rather than come to exist and dispatch silently.
  const auditSink = requireAuditSink(options.auditSink as AuditSink | undefined | null)

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
        .map((spec) => declarationView(spec, options.deps))
    },
  }

  REGISTRY_INTERNALS.set(registry, {
    specs: byId,
    deps: options.deps,
    auditSink,
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
