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
//
// 2026-10-01 (432-20, D-10/D-12): the escalation CR-04 closed — vacating `requiredScopes` through
// a listing — has nothing left to reach. Declarations carry no permission metadata at all (the
// registry omits `requiredScopes` and `requiresHumanOrigin` even while an old spec still spells
// them), and `invokeFunction` reads none. The freezing claims survive on the risk descriptor and
// the spec singleton, and C432-DECLARATION-KEYS pins the exact runtime key set beside its type.

import type {
  FunctionCaller,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  RunsGetInputSchema,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FunctionInputError, invokeFunction } from '../functions/invoke.js'
import { configGetSpec } from '../functions/ops/config-get.js'
import {
  createFunctionRegistry,
  createRegistryFromSpecs,
  registryInternals,
} from '../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps, FunctionSpec } from '../functions/spec.js'
import { CONTRACTS_BY_ID, expectProjectionDerivedFrom } from './projection-relation.js'

/**
 * Every port resolves, nothing reaches a host API. The record exists because `FunctionDeps` is
 * required and non-partial (D-09).
 */
function fakeDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) => Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    // 387: `entities` is a REQUIRED read port on FunctionDeps. Stated here so the record
    // typechecks, and stated as an ANSWERING stub rather than a refusing one: these cases
    // exercise other ops, and nothing in this file mints an address, so an honest miss and a
    // reported absence are the truthful answers.
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
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
    appendGuardrailAudit() {},
  }
}

function buildRegistry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
  })
}

const ZERO_SCOPE_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [],
  safeMode: false,
  origin: 'agent',
}

const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
  origin: 'agent',
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

// Phase 397 (D-05, research Pitfall 1): the golden registry snapshot pins a disclose flag per op,
// and the suite that writes it lives in `packages/cli`, where neither `FunctionSpec` nor the
// internals seam is reachable. The declaration therefore carries the ANSWER as data. These two
// cells are the relation between the two artifacts — every op's declaration and the spec it was
// projected from — so a hand-maintained flag, or a projection that drifts off the spec, reds here
// rather than rotting into a golden nobody can falsify.
describe('the disclose presence flag is projected from the spec (D-05)', () => {
  function specsOf(registry: ReturnType<typeof buildRegistry>): ReadonlyMap<string, FunctionSpec> {
    const internals = registryInternals(registry)
    if (internals === undefined) throw new Error('the registry exposes no internals')
    return internals.specs
  }

  it('lists discloses: true for exactly the ops whose spec defines disclose', () => {
    const registry = buildRegistry()
    const specs = specsOf(registry)
    const declarations = registry.list(FULLY_GRANTED)

    // Both sides produced: the expectation is read off the spec table, never written out. An op-id
    // list here would be the hand-typed literal this field exists to replace.
    const definesDisclose = declarations
      .filter((declaration) => typeof specs.get(declaration.id)?.disclose === 'function')
      .map((declaration) => declaration.id)
    const flagged = declarations
      .filter((declaration) => declaration.discloses === true)
      .map((declaration) => declaration.id)

    // Non-vacuity, both directions: a registry where nothing disclosed, or where everything did,
    // would let the cell above pass while measuring one branch.
    expect(
      definesDisclose.length,
      'no registered spec defines disclose — the partition below is vacuous',
    ).toBeGreaterThan(0)
    expect(
      definesDisclose.length,
      'every registered spec defines disclose — the absent branch is unmeasured',
    ).toBeLessThan(declarations.length)

    expect(
      flagged,
      'the ops listing discloses: true are exactly the ops whose spec defines disclose',
    ).toEqual(definesDisclose)
  })

  it('omits the key entirely for an op with no disclose — absent, never false or undefined', () => {
    const registry = buildRegistry()
    const specs = specsOf(registry)
    const declarations = registry.list(FULLY_GRANTED)

    // `requiresHumanOrigin`'s rule, applied to the second presence field: `false` and an absent key
    // would be two spellings of the same fact, and a present `undefined` would make a golden column
    // that reads `null` for an op that simply discloses nothing.
    let present = 0
    let absent = 0
    for (const declaration of declarations) {
      const spec = specs.get(declaration.id)
      expect(spec, `${declaration.id} is listed by a registry that registered no such spec`)
        .toBeDefined()
      const label = `${declaration.id}: the discloses presence field`
      if (spec!.disclose === undefined) {
        expect(Object.hasOwn(declaration, 'discloses'), `${label} must be ABSENT`).toBe(false)
        absent += 1
      } else {
        expect(Object.hasOwn(declaration, 'discloses'), `${label} must be present`).toBe(true)
        expect(declaration.discloses, `${label} carries true and nothing else`).toBe(true)
        present += 1
      }
    }

    expect(present, 'the present branch went unexercised').toBeGreaterThan(0)
    expect(absent, 'the absent branch went unexercised').toBeGreaterThan(0)
    expect(present + absent).toBe(declarations.length)
  })
})

describe('declaration views are deeply frozen (CR-04)', () => {
  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'freezes every listed declaration, its
  // requiredScopes, and its risk descriptor'. Declarations carry no `requiredScopes`.
  it('freezes every listed declaration and its risk descriptor', () => {
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(Object.isFrozen(declaration), declaration.id).toBe(true)
      expect(Object.isFrozen(declaration.risk), `${declaration.id}.risk`).toBe(true)
    }
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'kills the CR-04 escalation: the repro write throws
  // and the caller is still refused'. There is no scope requirement on a listing to vacate and no
  // refusal to survive it: the write throws because the view is frozen, and config.get is served.
  it('kills the CR-04 escalation: the repro write throws and there is no requirement to vacate', async () => {
    const registry = buildRegistry()
    const declaration = configGet(registry.list(ZERO_SCOPE_CALLER))

    expect(Object.keys(declaration)).not.toContain('requiredScopes')
    expect(() => {
      ;(declaration as unknown as Record<string, unknown>)['requiredScopes'] = []
    }).toThrow(TypeError)

    await expect(
      invokeFunction(registry, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).resolves.toMatchObject({ configPath: 'agent-qa.config.yaml' })
  })

  it('refuses a forged risk name: the gate classification cannot be rewritten through a listing', () => {
    const declaration = configGet(buildRegistry().list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration.risk as RiskActionDescriptor).name = 'fn:totally.harmless'
    }).toThrow(TypeError)
    expect(declaration.risk.name).toBe('fn:config.get')
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12): the singleton's retired `requiredScopes` is no longer
  // frozen or read; the spec object and its risk descriptor still are.
  it('freezes the REGISTERED singleton spec, not only the copied view', () => {
    buildRegistry()

    expect(Object.isFrozen(configGetSpec)).toBe(true)
    expect(Object.isFrozen(configGetSpec.risk)).toBe(true)
    expect(() => {
      ;(configGetSpec as unknown as Record<string, unknown>)['risk'] = { name: 'fn:forged' }
    }).toThrow(TypeError)
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'contains the attempt to nothing: a second registry
  // still lists the real requirement'. A second registry lists the same permission-free view.
  it('contains the attempt to nothing: a second registry lists the same permission-free view', async () => {
    const attacked = buildRegistry()
    const declaration = configGet(attacked.list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration as unknown as Record<string, unknown>)['requiresHumanOrigin'] = true
    }).toThrow(TypeError)

    const fresh = buildRegistry()
    expect(configGet(fresh.list(ZERO_SCOPE_CALLER))).toEqual(declaration)
    await expect(
      invokeFunction(fresh, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).resolves.toMatchObject({ configPath: 'agent-qa.config.yaml' })
  })
})

// ---- C432-DECLARATION-KEYS (432-20, D-10/D-12) --------------------------------------------------

/** Compile-time half: the declaration TYPE cannot carry either retired key. Checked by typecheck. */
type DeclarationCarries<Key extends string> = Key extends keyof FunctionDeclaration ? true : false
const DECLARATION_TYPE_HAS_SCOPES: DeclarationCarries<'requiredScopes'> = false
const DECLARATION_TYPE_HAS_HUMAN_ORIGIN: DeclarationCarries<'requiresHumanOrigin'> = false

/** Every key a runtime declaration always carries, and the presence-only flags it may carry. */
const REQUIRED_DECLARATION_KEYS = [
  'bindingStatus',
  'id',
  'input',
  'output',
  'resultKind',
  'risk',
  'summary',
] as const
const OPTIONAL_DECLARATION_FLAGS = ['classifies', 'discloses', 'rendersResult'] as const

describe('C432-DECLARATION-KEYS: runtime declarations carry no permission metadata', () => {
  it('pins the exact key set of every real declaration, and no scope or origin key', () => {
    expect(DECLARATION_TYPE_HAS_SCOPES).toBe(false)
    expect(DECLARATION_TYPE_HAS_HUMAN_ORIGIN).toBe(false)

    const declarations = buildRegistry().list(ZERO_SCOPE_CALLER)
    expect(declarations.length).toBeGreaterThan(40)
    for (const declaration of declarations) {
      const keys = Object.keys(declaration).sort()
      const optional = keys.filter((key) => !(REQUIRED_DECLARATION_KEYS as readonly string[]).includes(key))
      expect(keys, declaration.id).toEqual(expect.arrayContaining([...REQUIRED_DECLARATION_KEYS]))
      expect(optional.every((key) => (OPTIONAL_DECLARATION_FLAGS as readonly string[]).includes(key)),
        `${declaration.id} carries ${optional.join(', ')}`).toBe(true)
      expect(keys, declaration.id).not.toContain('requiredScopes')
      expect(keys, declaration.id).not.toContain('requiresHumanOrigin')
    }
  })

  it('omits the retired keys even where the registered spec still spells them', () => {
    // Op specs still spell `requiredScopes` until their op-spec owners (432-21/23–38) remove it;
    // the registry does not pass it on, so the declaration shape never depends on spec migration.
    // The synthetic spec below keeps this cell meaningful after the last real spec has migrated.
    expect(Object.keys(configGet(buildRegistry().list(FULLY_GRANTED)))).not.toContain('requiredScopes')

    const legacy: FunctionSpec<Record<string, never>, { ok: true }> = {
      id: 'synthetic.legacy-permissions',
      summary: 'A spec that still spells both retired permission keys.',
      requiredScopes: ['config-write'],
      requiresHumanOrigin: true,
      resultKind: 'unary',
      input: z.object({}).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      risk: { name: 'fn:synthetic.legacy-permissions', recognized: true, readOnly: true },
      classify: () => ({ status: 'executed' as const, outcome: '' }),
      invoke: () => Promise.resolve({ ok: true as const }),
    }
    const registry = createRegistryFromSpecs([legacy as FunctionSpec], {
      deps: fakeDeps(),
      auditSink: noOpSink(),
    })
    const [declaration] = registry.list(ZERO_SCOPE_CALLER)
    expect(Object.keys(declaration!).sort())
      .toEqual([...REQUIRED_DECLARATION_KEYS, 'classifies'].sort())
  })

  it('freezes every risk descriptor as a copy, never the spec\'s own object', () => {
    for (const declaration of buildRegistry().list(ZERO_SCOPE_CALLER)) {
      expect(Object.isFrozen(declaration.risk), declaration.id).toBe(true)
    }
    expect(configGet(buildRegistry().list(ZERO_SCOPE_CALLER)).risk).not.toBe(configGetSpec.risk)
    expect(configGet(buildRegistry().list(ZERO_SCOPE_CALLER)).risk).toEqual(configGetSpec.risk)
  })
})
