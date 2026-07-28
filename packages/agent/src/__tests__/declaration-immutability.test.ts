// The enforcement record AND the contract vocabulary are read-only in FACT, not just in
// type (Phase 384, Plans 08 and 09 — CR-04 / BL-01 / D-14 / T-384-08).
//
// `registry.list()` hands a surface the record `invokeFunction` enforces against. Plan 08
// closed the escalation half: a zero-scope caller could delete `config.get`'s scope
// requirement in one line and then invoke it for real. Round 2 found the same mechanism
// alive one field over — `input` and `output` were passed to the view BY REFERENCE, and the
// object handed out was identity-equal to the schema package's own exported validator, so a
// single write through a permitted listing dispatched unvalidated input for every consumer
// in the process.
//
// Plan 09 closes that as a CLASS: the view carries an inert, deep-frozen JSON-Schema
// PROJECTION, and the live validator stays on `FunctionSpec`, which never leaves the
// functions directory. The sweeps below are written from the SHAPE of the view rather than
// a list of field names, because a guard generated out of the implementation's own
// vocabulary is exactly what left the previous round blind to its own open half (WR-05).

import type {
  ExecutionContext,
  FunctionCaller,
  FunctionScope,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  RunsGetInputSchema,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { FunctionInputError, FunctionScopeError, invokeFunction } from '../functions/invoke.js'
import { configGetSpec } from '../functions/ops/config-get.js'
import { createFunctionRegistry } from '../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../functions/spec.js'
import { CONTRACTS_BY_ID, expectProjectionDerivedFrom } from './projection-relation.js'

const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

/**
 * Every port resolves, nothing reaches a host API. The scope refusal several cases turn on
 * precedes dispatch, so no port is ever touched — the record exists because `FunctionDeps`
 * is required and non-partial (D-09), not because a case needs it.
 */
function fakeDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
    },
    knowledge: { listBundles: () => Promise.resolve([]) },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
  }
}

/** The sink is a REQUIRED construction field (D-11); nothing here asserts on rows. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

function buildRegistry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
    resolveExecutionContext: FIXED_CONTEXT,
  })
}

const ZERO_SCOPE_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [],
  safeMode: false,
}

const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

function byId(declarations: readonly FunctionDeclaration[], id: string): FunctionDeclaration {
  const declaration = declarations.find((candidate) => candidate.id === id)
  if (declaration === undefined) throw new Error(`${id} is not registered`)
  return declaration
}

function configGet(declarations: readonly FunctionDeclaration[]): FunctionDeclaration {
  return byId(declarations, 'config.get')
}

/**
 * Visit every node reachable through OWN enumerable properties, deriving the keys from the
 * value itself.
 *
 * This is the whole point of the two sweeps below: no field is ever named, so a seventh
 * `FunctionDeclaration` field added by a later phase is covered on the day it lands rather
 * than on the day someone remembers to extend a list. The `seen` set makes the walk safe
 * against a cyclic graph — which the LIVE zod objects this file used to be handed are.
 */
function eachReachableNode(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  visit: (node: unknown, nodePath: string) => void,
): void {
  visit(value, path)
  if (typeof value !== 'object' || value === null) return

  const node = value as Record<string, unknown>
  if (seen.has(node)) return
  seen.add(node)

  for (const [key, nested] of Object.entries(node)) {
    eachReachableNode(nested, `${path}.${key}`, seen, visit)
  }
}

describe('the listed view is inert (BL-01)', () => {
  it('freezes the whole reachable graph of every declaration, naming no field', () => {
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      eachReachableNode(declaration, declaration.id, new WeakSet(), (node, nodePath) => {
        if (typeof node !== 'object' || node === null) return
        expect(Object.isFrozen(node), nodePath).toBe(true)
      })
    }
  })

  it('exposes nothing runnable: no value reachable through a declaration is a function', () => {
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      eachReachableNode(declaration, declaration.id, new WeakSet(), (node, nodePath) => {
        expect(typeof node, nodePath).not.toEqual('function')
      })
    }
  })

  it('de-aliases the shared contract vocabulary: a listing is not a schema-package export', () => {
    const declaration = byId(buildRegistry().list(FULLY_GRANTED), 'runs.get')

    // The round-2 finding, inverted: this identity used to be `true`, which made a permitted
    // listing a write handle onto the validators every firewalled surface imports.
    expect(declaration.input as unknown).not.toBe(RunsGetInputSchema as unknown)
    expect((declaration.input as Record<string, unknown>)['safeParse']).toBeUndefined()
    expect((declaration.output as Record<string, unknown>)['parse']).toBeUndefined()
  })

  it('projects each contract FROM the schema it was declared with, naming no field', () => {
    // The shape-only version of this case was satisfied by a constant: the round-3 verifier
    // replaced `toSchemaProjection`'s body with a frozen `{$schema, type:'object',
    // properties:{}}` that discards its argument, and the whole agent suite stayed green.
    // A criterion a wrong implementation satisfies certifies nothing, so this one is a
    // RELATION between two artifacts — each projection and the live zod contract it came
    // from — with every expected key set read off the schema rather than written out.
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    // The growth seam: a capability with no paired spec reddens here, so a seventh op
    // cannot land with an unchecked projection.
    expect(Object.keys(CONTRACTS_BY_ID).sort())
      .toEqual(declarations.map((declaration) => declaration.id).sort())

    for (const declaration of declarations) {
      const contracts = CONTRACTS_BY_ID[declaration.id]!
      for (const side of ['input', 'output'] as const) {
        const label = `${declaration.id}.${side}`
        // The inertness clauses the case has always carried, kept beside the relation.
        expect(Object.getPrototypeOf(declaration[side]), label).toBe(Object.prototype)
        expectProjectionDerivedFrom(contracts[side], declaration[side], label)
      }
    }
  })

  it('kills the input-poisoning repro: dispatch still validates, in two registries', async () => {
    const attacked = buildRegistry()
    const declaration = byId(attacked.list(FULLY_GRANTED), 'runs.get')

    // The verifier's exploit verbatim. The projection is deep-frozen and carries no
    // validator to replace, so in strict-mode ESM the write THROWS.
    expect(() => {
      ;(declaration.input as Record<string, unknown>)['safeParse'] = () => ({
        success: true,
        data: {},
      })
    }).toThrow(TypeError)

    // Both halves. The throw alone would not prove enforcement survived the attempt.
    await expect(
      invokeFunction(attacked, 'runs.get', { runId: 42 }, FULLY_GRANTED),
    ).rejects.toBeInstanceOf(FunctionInputError)

    // A registry built AFTER the attempt, over the same module-level singleton specs.
    await expect(
      invokeFunction(buildRegistry(), 'runs.get', { runId: 42 }, FULLY_GRANTED),
    ).rejects.toBeInstanceOf(FunctionInputError)

    // And the shared vocabulary itself: the schema package's export still refuses.
    expect(RunsGetInputSchema.safeParse({ runId: 42 }).success).toBe(false)
  })

  it('kills the output-poisoning repro: a unary result is still the validated value', async () => {
    const attacked = buildRegistry()
    const declaration = byId(attacked.list(FULLY_GRANTED), 'runs.list')

    expect(() => {
      ;(declaration.output as Record<string, unknown>)['parse'] = () => 'ATTACKER-CHOSEN'
    }).toThrow(TypeError)

    await expect(invokeFunction(attacked, 'runs.list', {}, FULLY_GRANTED)).resolves.toEqual([])
    await expect(
      invokeFunction(buildRegistry(), 'runs.list', {}, FULLY_GRANTED),
    ).resolves.toEqual([])
  })
})

describe('declaration views are deeply frozen (CR-04)', () => {
  it('freezes every listed declaration, its requiredScopes, and its risk descriptor', () => {
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(Object.isFrozen(declaration), declaration.id).toBe(true)
      expect(Object.isFrozen(declaration.requiredScopes), `${declaration.id}.requiredScopes`)
        .toBe(true)
      expect(Object.isFrozen(declaration.risk), `${declaration.id}.risk`).toBe(true)
    }
  })

  it('kills the CR-04 escalation: the repro write throws and the caller is still refused', async () => {
    const registry = buildRegistry()
    const declaration = configGet(registry.list(ZERO_SCOPE_CALLER))

    // The exploit, verbatim: vacate the scope requirement the gate reads. In strict-mode ESM
    // a write to a frozen array THROWS — a silent no-op is not the shipped behaviour.
    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)

    // Both halves. The throw alone would not prove enforcement survived the attempt.
    await expect(
      invokeFunction(registry, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).rejects.toBeInstanceOf(FunctionScopeError)
  })

  it('refuses a forged risk name: the gate classification cannot be rewritten through a listing', () => {
    const declaration = configGet(buildRegistry().list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration.risk as RiskActionDescriptor).name = 'fn:totally.harmless'
    }).toThrow(TypeError)
    expect(declaration.risk.name).toBe('fn:config.get')
  })

  it('freezes the REGISTERED singleton spec, not only the copied view', () => {
    // The copy in `declarationView` already denies the listing route. This case covers the
    // "any other route" clause: after registration the module-level singleton itself is
    // frozen, so code holding the spec directly cannot rewrite what the gate enforces.
    buildRegistry()

    expect(Object.isFrozen(configGetSpec)).toBe(true)
    expect(Object.isFrozen(configGetSpec.requiredScopes)).toBe(true)
    expect(Object.isFrozen(configGetSpec.risk)).toBe(true)
    expect(() => {
      ;(configGetSpec.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)
  })

  it('contains the attempt to nothing: a second registry still lists the real requirement', async () => {
    const attacked = buildRegistry()
    const declaration = configGet(attacked.list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)
    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).push('read')
    }).toThrow(TypeError)

    // A registry built AFTER the attempt — the singleton specs the exploit reached for.
    const fresh = buildRegistry()
    expect(configGet(fresh.list(ZERO_SCOPE_CALLER)).requiredScopes).toEqual(['read'])
    await expect(
      invokeFunction(fresh, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).rejects.toBeInstanceOf(FunctionScopeError)
  })
})
