// Conformance-suite LEG 1 — coverage (Phase 384, SC4 / Pitfall 11 / D-09 / D-15).
//
// The full parity suite lands in 397. This is its coverage leg, shipped now as a stub in
// the only sense that matters: it enumerates the REGISTRY rather than a hand-written id
// list, so it grows with the layer instead of describing the layer as it was in 384.
//
// What Pitfall 11 asks of a coverage check: `unbound` is COVERED-BUT-UNBOUND, not missing.
// A declared-but-unbound capability has a contract, a listing row, a gate verdict and an
// audit trail — reading it as a hole in the API is the silent gap `bindingStatus` exists
// to prevent, and reading it as an ordinary bound op would make this suite fail on the
// phase's own `runs.start`. It is asserted as its own third state here.
//
// The leg is structurally incapable of passing vacuously. A nonzero declaration count is
// asserted; the six ids this phase registers are asserted present at their exact binding
// status; and every registered id must carry an invocation sample below, so a seventh
// capability added in 386 or 387 fails this file until someone states how to call it.

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { FunctionNotBoundError, invokeFunction } from '../functions/invoke.js'
import { createFunctionRegistry } from '../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../functions/spec.js'
import { CONTRACTS_BY_ID, expectProjectionDerivedFrom } from './projection-relation.js'

/**
 * The fixed id domain taxonomy (D-15), plus `knowledge`.
 *
 * PLANNER NOTE, 2026-07-28: D-15 fixes the domain list at L10's eight, but D-06's locked
 * seed ids include `knowledge.bundles.list`, whose domain is not on that list. The ids are
 * the shipped, locked contract, so the taxonomy is widened here rather than the ids being
 * renamed. 397 reconciles the naming when the full conformance suite lands; until then this
 * note is the reconciliation.
 */
const ALLOWED_ID_DOMAINS = new Set([
  'tests',
  'runs',
  'memory',
  'analysis',
  'eval',
  'gates',
  'config',
  'agent',
  'knowledge',
])

/** The capabilities Phase 384 registers, with the binding state each one ships in. */
const EXPECTED_384_BINDING_STATUS: Readonly<Record<string, 'bound' | 'unbound'>> = {
  'config.get': 'bound',
  'knowledge.bundles.list': 'bound',
  'runs.events': 'bound',
  'runs.get': 'bound',
  'runs.list': 'bound',
  // D-09: declared in full, bound by nothing in this composition. 386 flips one field.
  'runs.start': 'unbound',
}

const FIXTURE_RUN_ID = 'run-alpha'

/**
 * A valid input for every registered id.
 *
 * Keyed by id and compared for exact set equality against the registry, so this map is the
 * conformance suite's growth seam: a new capability cannot join the layer without someone
 * writing down how it is called.
 */
const INVOCATION_SAMPLES: Readonly<Record<string, unknown>> = {
  'config.get': {},
  'knowledge.bundles.list': {},
  'runs.events': { runId: FIXTURE_RUN_ID },
  'runs.get': { runId: FIXTURE_RUN_ID },
  'runs.list': {},
  'runs.start': {},
}

const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

function handoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_000,
    endedAt: 2_000,
    tests: [],
  }
}

/**
 * Fully-faked dependencies: every port resolves, nothing reaches a host API.
 *
 * The point of faking ALL of them is that a `bound` op which quietly needed something the
 * ports do not offer would fail here rather than in whichever composition root first tried
 * to run it.
 */
function fakeDeps(): FunctionDeps {
  const documents = [handoff(FIXTURE_RUN_ID)]
  return {
    runs: {
      list: () => Promise.resolve(documents),
      get: runId => Promise.resolve(documents.find(document => document.runId === runId)),
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

/** Every scope the layer knows, so a refusal here can never be a missing grant. */
const FULLY_GRANTED: FunctionCaller = {
  surface: 'conformance',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

/** Discards every row: this file asserts on coverage, never on the audit trail. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

function registry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
    resolveExecutionContext: FIXED_CONTEXT,
  })
}

function declarations(): readonly FunctionDeclaration[] {
  return registry().list(FULLY_GRANTED)
}

async function drain(result: unknown): Promise<unknown> {
  if (typeof result === 'object' && result !== null && Symbol.asyncIterator in result) {
    const collected: unknown[] = []
    for await (const element of result as AsyncIterable<unknown>) {
      collected.push(element)
    }
    return collected
  }
  return result
}

describe('parity leg 1 — registry coverage', () => {
  it('registers a nonzero, uniquely-identified capability set', () => {
    const ids = declarations().map(declaration => declaration.id)

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toEqual(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  it('names every capability dot-namespaced over the fixed domain taxonomy (D-15)', () => {
    for (const declaration of declarations()) {
      expect(declaration.id, declaration.id).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
      expect(ALLOWED_ID_DOMAINS, declaration.id).toContain(declaration.id.split('.')[0])
    }
  })

  it('carries a complete declaration for every capability', () => {
    for (const declaration of declarations()) {
      const label = declaration.id
      expect(declaration.summary.trim(), label).not.toEqual('')
      expect(declaration.requiredScopes.length, label).toBeGreaterThan(0)
      expect(['unary', 'stream'], label).toContain(declaration.resultKind)
      expect(['bound', 'unbound'], label).toContain(declaration.bindingStatus)
      expect(declaration.risk.name, label).toEqual(`fn:${declaration.id}`)
      expect(declaration.risk.recognized, label).toBe(true)
      // The declared contracts arrive as INERT projections, never as live validators
      // (BL-01 / D-14): a listing is a description of the contract, not a handle on it.
      for (const side of ['input', 'output'] as const) {
        const projection = declaration[side]
        expect(typeof projection, `${label}.${side}`).toEqual('object')
        expect(projection, `${label}.${side}`).not.toBeNull()
        expect((projection as Record<string, unknown>)['safeParse'], `${label}.${side}`)
          .toBeUndefined()
        expect((projection as Record<string, unknown>)['parse'], `${label}.${side}`)
          .toBeUndefined()
      }
      // A listing view never carries the implementation (T-384-20).
      expect(declaration, label).not.toHaveProperty('invoke')
    }
  })

  it('projects each contract FROM the schema it was declared with, naming no field', () => {
    // The projection is computed once at listing time by `toSchemaProjection`, so the
    // catalog surfaces 396 builds read a value rather than running a schema. Asserting its
    // SHAPE is not enough to know it is the RIGHT value — a frozen constant that discards
    // the schema passed the shape version of this case across the whole suite. What is
    // asserted instead is the relation between each projection and the live contract it
    // came from, with every expected key set read off that contract.
    const listed = declarations()

    expect(listed.length).toBeGreaterThan(0)
    // The same growth seam `INVOCATION_SAMPLES` applies to calling, applied to contracts.
    expect(Object.keys(CONTRACTS_BY_ID).sort())
      .toEqual(listed.map((declaration) => declaration.id).sort())

    for (const declaration of listed) {
      const contracts = CONTRACTS_BY_ID[declaration.id]!
      for (const side of ['input', 'output'] as const) {
        const label = `${declaration.id}.${side}`
        expect(Object.getPrototypeOf(declaration[side]), label).toBe(Object.prototype)
        expectProjectionDerivedFrom(contracts[side], declaration[side], label)
      }
    }
  })

  it('pins the phase-384 capability set and each id binding state', () => {
    const observed = Object.fromEntries(
      declarations().map(declaration => [declaration.id, declaration.bindingStatus]),
    )

    expect(observed).toEqual(EXPECTED_384_BINDING_STATUS)
  })

  it('holds an invocation sample for every registered id — no capability without one', () => {
    expect(declarations().map(declaration => declaration.id).sort())
      .toEqual(Object.keys(INVOCATION_SAMPLES).sort())
  })

  it('resolves every BOUND capability into a value its declared output contract accepts', async () => {
    // This gate used to assert mere defined-ness, which `null`, `[]`, `{}`, `0` and `''`
    // all satisfy — in the file that is explicitly this layer's growth seam for 386 and
    // 387. It is now a relation between the result and the contract the registry already
    // holds: the declared output schema must PARSE what came back. An id-keyed table of
    // expected values would be the enumeration move (a seventh capability re-opens the
    // hole), so nothing is written down per id here either.
    const built = registry()

    let checked = 0
    for (const declaration of built.list(FULLY_GRANTED)) {
      if (declaration.bindingStatus !== 'bound') continue

      const contract = CONTRACTS_BY_ID[declaration.id]!
      const drained = await drain(
        await invokeFunction(
          built,
          declaration.id,
          INVOCATION_SAMPLES[declaration.id],
          FULLY_GRANTED,
        ),
      )

      if (declaration.resultKind === 'stream') {
        // A stream spec's output contract describes the ELEMENT, so every drained element is
        // re-parsed. The array assertion makes an empty drain a visible, deliberate pass
        // rather than a silently skipped loop.
        expect(Array.isArray(drained), declaration.id).toBe(true)
        const elements = drained as readonly unknown[]
        for (let index = 0; index < elements.length; index++) {
          expect(contract.output.safeParse(elements[index]).success, `${declaration.id}[${index}]`)
            .toBe(true)
        }
      } else {
        expect(contract.output.safeParse(drained).success, declaration.id).toBe(true)
      }
      checked += 1
    }

    // …and the loop ran: a `bound` set that emptied would otherwise pass every line above.
    expect(checked).toBeGreaterThan(0)
  })

  it('refuses every UNBOUND capability by name — covered, not missing (Pitfall 11)', async () => {
    const built = registry()
    const unbound = built
      .list(FULLY_GRANTED)
      .filter(declaration => declaration.bindingStatus === 'unbound')

    // The phase ships exactly one; the assertion is that the state exists and is refused
    // distinctly, not that the count stays at one forever.
    expect(unbound.length).toBeGreaterThan(0)

    for (const declaration of unbound) {
      const refusal = invokeFunction(
        built,
        declaration.id,
        INVOCATION_SAMPLES[declaration.id],
        FULLY_GRANTED,
      )

      await expect(refusal, declaration.id).rejects.toBeInstanceOf(FunctionNotBoundError)
      await expect(refusal, declaration.id).rejects.toMatchObject({
        functionId: declaration.id,
      })
    }
  })
})
