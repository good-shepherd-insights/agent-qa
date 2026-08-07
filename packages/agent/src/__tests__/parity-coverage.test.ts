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
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import type { AuditSink, StandingApprovalReader } from '@vostride/agent-qa-safety'
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
  // 2026-08-02 (387 D-09): `entities` is a taxonomy EXTENSION, declared as such rather than
  // squeezed under an existing domain. Two read verbs over one addressing surface do not
  // belong to runs, memory or analysis, and filing them there would have made the domain
  // list decorative. Same reconciliation the `knowledge` line above records; 397 folds both.
  'entities',
  // 2026-08-05 (390 D-13): `quarantine` is the third taxonomy EXTENSION, declared on exactly
  // the footing of the two above. Quarantine state is neither a run, a memory nor an analysis
  // — a lifecycle with its own enumeration, exit and entry verbs — and filing it under one of
  // those would have made this list decorative for a third time. 397 folds all three.
  'quarantine',
])

/**
 * The registered capability set, with the binding state each one ships in.
 *
 * Renamed off its phase number in 387: it was `EXPECTED_384_BINDING_STATUS`, and once a
 * second phase adds rows, a name that claims one phase’s set is a name that lies about what
 * the exact-equality assertion below is actually pinning.
 */
const EXPECTED_BINDING_STATUS: Readonly<Record<string, 'bound' | 'unbound'>> = {
  // 389 D-11: UNBOUND here because this fixture supplies no analysis-artifact reader — a
  // claim about the composition, not the op, exactly like `runs.postprocessing` below. The
  // optional `recurrence` dep never gates this binding; only `analysis` does.
  'analysis.get': 'unbound',
  'config.get': 'bound',
  // 387 D-09. Both BOUND everywhere: the entity directory is a required dep, so unlike
  // `runs.start` there is no composition that can list these and then refuse them.
  'entities.get': 'bound',
  'entities.resolve': 'bound',
  'knowledge.bundles.list': 'bound',
  // 387 KREV-01: the three new read verbs, all BOUND everywhere for the same reason the
  // entity pair is — they dispatch through the REQUIRED knowledge port.
  'knowledge.brief.why': 'bound',
  'knowledge.record.show': 'bound',
  'knowledge.records.diff': 'bound',
  'knowledge.records.inspect': 'bound',
  // 387-08 KREV-01 D-17: the MUTATING half, and the first rows here to read 'unbound' for a
  // reason other than run execution. This composition supplies a reader and no review port,
  // which is a TRUE statement about it — the four verbs are listed by name and refused by
  // name, which is exactly the state widening the reader port would have made unsayable.
  'knowledge.accept.propose': 'unbound',
  'knowledge.forget.propose': 'unbound',
  'knowledge.proposal.apply': 'unbound',
  'knowledge.reject.propose': 'unbound',
  // 390 D-12/D-13: the three quarantine verbs, UNBOUND here for the 387-08 reason — this
  // fixture supplies no quarantine port. That is now a statement about THIS FIXTURE and
  // nothing else: plan 06 implemented the port and bound it at `composeLocalAgent`, so both
  // production hosts list all three `bound` (the CLI catalog in `fn-command.test.ts` pins it).
  // A host with no port must still refuse by name rather than answer an empty list about a
  // ledger it cannot read — an empty answer would say "nothing is quarantined" about a file
  // it has never been able to open.
  'quarantine.add': 'unbound',
  'quarantine.list': 'unbound',
  'quarantine.release': 'unbound',
  'runs.events': 'bound',
  'runs.get': 'bound',
  'runs.list': 'bound',
  // 388 D-14: UNBOUND here, and for a third distinct reason — this fixture supplies no durable
  // queue storage at all. A host that cannot see the queue must say so by name rather than
  // answer all-pending about a chain it has never been able to observe, so this row is a claim
  // about the composition and not about the op.
  'runs.postprocessing': 'unbound',
  // D-09: declared in full, bound by nothing in this composition. 386 flips one field.
  'runs.start': 'unbound',
}

const FIXTURE_RUN_ID = 'run-alpha'

const FIXTURE_ENTITY_SHORT_ID = 'MEM-001'

/**
 * The one entity this fixture directory knows about.
 *
 * A REAL descriptor rather than a refusing stub, because the invocation leg below calls every
 * bound capability and parses the answer against its declared output contract — so a port that
 * refused would make `entities.get` uncallable here, in the file that exists to ensure no
 * capability arrives without someone stating how it is called.
 */
const FIXTURE_ENTITY_DESCRIPTOR = {
  kind: 'MEM' as const,
  shortId: FIXTURE_ENTITY_SHORT_ID,
  uri: 'agentqa://memory/MEM-001',
  machineId: 'bundle-fixture',
  title: 'a fixture memory record',
  statusSource: 'active',
}

/**
 * A valid input for every registered id.
 *
 * Keyed by id and compared for exact set equality against the registry, so this map is the
 * conformance suite's growth seam: a new capability cannot join the layer without someone
 * writing down how it is called.
 */
const INVOCATION_SAMPLES: Readonly<Record<string, unknown>> = {
  // 389 D-11: a PARSING input for a capability this composition cannot run — validation
  // precedes the binding check, so a sample that failed the contract would make the
  // unbound-refusal leg report an input error and certify nothing about binding.
  'analysis.get': { runId: FIXTURE_RUN_ID },
  'config.get': {},
  // 387: `resolve` takes any reference at all, so the sample is free text that matches
  // nothing — the fixture directory is empty and the honest answer is the none arm. `get`
  // takes an exact address, and the fixture port below is what stands behind it.
  'entities.get': { ref: FIXTURE_ENTITY_SHORT_ID },
  'entities.resolve': { ref: 'nothing in this fixture is called this' },
  'knowledge.bundles.list': {},
  // 387: the filter is closed and every member optional, so an empty filter is the honest
  // 'everything' query; the diff baseline is 0 (a first-ever diff); the record id names
  // nothing in this fixture and the typed miss is the correct answer.
  // 387 KREV-02: the fixture runs port records no run, so the honest answer is the typed
  // no-trace arm — which is the arm this verb exists to be able to give.
  'knowledge.brief.why': { runId: FIXTURE_RUN_ID, stepIndex: 0 },
  'knowledge.record.show': { recordId: 'rec-not-in-this-fixture' },
  'knowledge.records.diff': { sinceOrdinal: 0 },
  'knowledge.records.inspect': { filter: {} },
  // 387-08: valid INPUTS for capabilities this composition cannot run. They have to parse,
  // because `invokeFunction` validates before it consults the binding — so a sample that did
  // not parse would make the unbound-refusal leg below report an input error and certify
  // nothing about binding at all.
  'knowledge.accept.propose': { target: { grain: 'record', recordId: 'rec-not-in-this-fixture' } },
  'knowledge.reject.propose': {
    target: { grain: 'record', recordId: 'rec-not-in-this-fixture' },
    reason: 'not reproducible',
  },
  'knowledge.forget.propose': { target: { grain: 'bundle', shortId: FIXTURE_ENTITY_SHORT_ID } },
  'knowledge.proposal.apply': { proposalId: 'prop_0123456789ab' },
  // 390 D-13: PARSING inputs for three capabilities this composition cannot run, on the same
  // reasoning as the rows above. `list` genuinely takes the empty query — enumeration is the
  // verb — while the two write verbs take the three legs of stable test identity, and a
  // partial address would report an input error where the unbound-refusal leg needs a binding
  // refusal. The test named here exists in no fixture; nothing is dispatched either way.
  'quarantine.add': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  'quarantine.list': {},
  'quarantine.release': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  'runs.events': { runId: FIXTURE_RUN_ID },
  'runs.get': { runId: FIXTURE_RUN_ID },
  'runs.list': {},
  // 388 D-14: a PARSING input for a capability this composition cannot run, on the 387-08
  // reasoning above — validation precedes the binding check, so a sample that failed the
  // contract would make the unbound-refusal leg report an input error and certify nothing.
  'runs.postprocessing': { runId: FIXTURE_RUN_ID },
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
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) => Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      // Free text against an empty directory: the none arm, which is what the sample above
      // asks for and what the never-guess contract requires.
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: (ref: string) => Promise.resolve(
        ref === FIXTURE_ENTITY_SHORT_ID ? FIXTURE_ENTITY_DESCRIPTOR : undefined,
      ),
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

/**
 * Every scope the layer knows, so a refusal here can never be a missing grant.
 *
 * Derived from `FunctionScopeSchema` rather than listed, and that is load-bearing for the
 * unbound-refusal leg below: `invokeFunction` checks scopes BEFORE it checks binding, so a
 * hand-written list that fell one member behind the union would turn every new capability's
 * "refused because this host cannot run it" into "refused because this caller was not granted
 * it" — a green-looking assertion certifying the wrong refusal. 387-08 measured exactly that.
 */
const FULLY_GRANTED: FunctionCaller = {
  surface: 'conformance',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

/** Discards every row: this file asserts on coverage, never on the audit trail. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

/**
 * A composition where every ask is already standing-approved (391).
 *
 * The claims in this file are about the CATALOGUE — coverage, contracts, and the by-name refusal of
 * an unbound capability — and 391 raised `knowledge.proposal.apply` to the ask tier. Without this,
 * that capability would be refused by the GATE before the binding check ran, and the unbound-refusal
 * case would be asserting a policy verdict while claiming to assert a binding one. The grant is
 * built from the action's own name, so it covers whatever the registry lists rather than a class
 * spelled here, and the real gate still runs and still audits.
 */
const EVERY_ASK_STANDING_APPROVED: StandingApprovalReader = {
  grantsFor: (action) => [{ actionClass: action.name, scope: STANDING_APPROVAL_SCOPE }],
}

function registry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
    standingApprovalReader: () => EVERY_ASK_STANDING_APPROVED,
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

  it('pins the registered capability set and each id binding state', () => {
    const observed = Object.fromEntries(
      declarations().map(declaration => [declaration.id, declaration.bindingStatus]),
    )

    expect(observed).toEqual(EXPECTED_BINDING_STATUS)
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
