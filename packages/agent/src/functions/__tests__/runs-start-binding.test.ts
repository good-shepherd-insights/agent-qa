// The unbound→bound transition, proven where it is decided (Phase 385 plan 10 — D-16).
//
// Three claims, and they are not the same claim:
//
//   1. `bindingStatus` is COMPUTED per composition. The same spec object, registered in two
//      registries in this one process, lists `bound` in the one that supplied a run executor
//      and `unbound` in the one that did not — and `invokeFunction` refuses on exactly the
//      answer a listing renders. This is what makes D-09's visible-unbound state a fact about
//      a host rather than a literal somebody has to remember to flip.
//   2. `mutating-local` is load-bearing THROUGH A DISPATCH. `risk-classification.test.ts`
//      already proves the descriptor resolves to allow in every context, but until this phase
//      that allow led nowhere: the binding check refused immediately afterwards, so no test
//      could tell an allow that dispatches from an allow that does not. These cases run the
//      whole pipeline in all four contexts and assert the op RAN, with the counterfactual
//      showing dispatch is lost the moment the tier changes.
//   3. The acknowledgment describes the RUN, not the request and not the port's report. The
//      port says only which run it started; every field a caller reads comes off that run's
//      own record. A host that returns an id without running anything is refused by name.
//
// The gate is not stubbed anywhere here: `invokeFunction` calls the real `evaluate`.

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
  RunId,
  RunStartAcknowledgement,
  RunsStartInput,
} from '@vostride/agent-qa-schema'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type {
  AuditSink,
  ExecutionAuditRow,
  GuardrailAuditRow,
  StandingApprovalReader,
} from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { FunctionNotBoundError, invokeFunction } from '../invoke.js'
import { RUNS_START_FUNCTION_ID, RunNotRecordedError, runsStartSpec } from '../ops/runs-start.js'
import { createFunctionRegistry, createRegistryFromSpecs, resolveBindingStatus } from '../registry.js'
import type { FunctionDeps, FunctionSpec, RunInvocationPort } from '../spec.js'

/** Every context a capability call can be made in; `ci` and `cloud` are fail-closed. */
const EVERY_CONTEXT: readonly ExecutionContext[] = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
]

/**
 * Granted EVERY scope the union declares, derived rather than listed.
 *
 * The parity case below distinguishes "refused because unbound" from everything else, and
 * `invokeFunction` checks scopes before binding — so a caller missing one member of the union
 * turns a new capability's unbound refusal into a scope refusal, which this case would then
 * read as `dispatched`. Measured on 387-08's four knowledge-write verbs.
 */
const RUN_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  // 391 D-06: `human` for the reason the scope note directly above gives, on a second axis.
  // `invokeFunction` checks origin BEFORE binding, so an agent-origin caller turns a
  // human-only capability's unbound refusal into an origin refusal — which the parity case
  // below, distinguishing only `FunctionNotBoundError`, would read as `dispatched`. Measured on
  // 391-03's `proposals.reject`, which is the first shipped op to declare the requirement.
  origin: 'human',
}

/**
 * A PARSING input for every id this file invokes, because input validation also precedes the
 * binding check: `{}` fails the contract of every 387-08 verb, and a contract refusal is not a
 * binding refusal.
 */
const BINDING_PARITY_INPUTS: Readonly<Record<string, unknown>> = {
  // 392 D-24: a PARSING input for the same reason every row here carries one — the contract
  // requires a non-empty message, so the `{}` default would fail validation and turn an unbound
  // refusal into an input error, which the parity case below reads as `dispatched`.
  'agent.ask': { message: 'proposals' },
  // 389 D-11: a PARSING input, because validation precedes the binding check — the empty
  // default fails the contract and reports an input error, certifying nothing about binding.
  'analysis.get': { runId: 'run-alpha' },
  // 393 D-01: a PARSING input, and its extension is load-bearing beyond the reason its neighbours
  // carry one. The contract requires a non-empty `draftPath`, so `{}` would report an input error;
  // but the op ALSO refuses a path with no test-file extension before it consults the binding, so a
  // path-shaped string with the wrong suffix would report `DraftNotAYamlFileError` and this case
  // would read that as `dispatched` too. A parsing input is not enough here — it has to be one the
  // op's own pure refusals let through.
  'authoring.draft.verify': { draftPath: 'tests/nothing-in-this-fixture.yaml' },
  // 394 D-01: a PARSING input, on its sibling's reasoning — `{}` fails the contract's non-empty
  // intent and its required scope, so the empty default would report an input error and this case
  // would read that as `dispatched`, certifying nothing about binding.
  'authoring.draft.write': {
    intent: 'nothing in this fixture can author this',
    scope: { tier: 'product', key: 'nothing-in-this-fixture' },
  },
  // 394-09 D-21: a PARSING input, on its sibling's reasoning — `{}` fails both non-empty fields,
  // so the empty default would report an input error and this case would read that as
  // `dispatched`. The exact-address ref keeps the leg aimed at the BINDING check: free text would
  // reach the entity resolver first and refuse there instead.
  'authoring.draft.edit': {
    testRef: 'tests/nothing-in-this-fixture.yaml::Nothing In This Fixture',
    intent: 'nothing in this fixture can edit this',
  },
  // 394-07 D-12: a PARSING input, on its siblings' reasoning. Unlike `quarantine.list`, whose
  // input is genuinely the empty query and which therefore needs no row here, this op REQUIRES a
  // window — the projection's denominator, which nothing can guess — so the `{}` default would
  // report an input error and this case would read that as `dispatched`.
  'authoring.funnel.get': { window: { scope: 'all-time' } },
  'runs.get': { runId: 'run-alpha' },
  'runs.events': { runId: 'run-alpha' },
  'runs.postprocessing': { runId: 'run-alpha' },
  // 391 D-16: a PARSING input for the same reason its `runs.` siblings carry one — the digest
  // names a run, so the `{}` default fails its contract and turns an unbound refusal into an
  // input error, which the parity case below would read as `dispatched`.
  'runs.digest': { runId: 'run-alpha' },
  'knowledge.accept.propose': { target: { grain: 'record', recordId: 'rec-x' } },
  'knowledge.reject.propose': { target: { grain: 'record', recordId: 'rec-x' }, reason: 'no' },
  'knowledge.forget.propose': { target: { grain: 'record', recordId: 'rec-x' } },
  'knowledge.proposal.apply': { proposalId: 'prop_0123456789ab' },
  // 390 D-13: the two quarantine WRITE verbs take the three legs of stable test identity, so
  // the `{}` default would fail their contract and turn an unbound refusal into an input
  // error — which the parity case below reads as `dispatched`. `quarantine.list` genuinely
  // takes the empty query and needs no row here.
  'quarantine.release': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  'quarantine.add': {
    product: 'shop',
    filePath: 'tests/checkout.test.yaml',
    testName: 'checkout completes',
  },
  // 391 PROP-03: `show` and `reject` take a refined proposal id, so the `{}` default fails their
  // contract and turns an unbound refusal into an input error. `proposals.list` genuinely takes
  // the empty query (both filters optional) and needs no row here.
  'proposals.show': { proposalId: 'prop_0123456789ab' },
  'proposals.reject': { proposalId: 'prop_0123456789ab' },
  'proposals.accept': { proposalId: 'prop_0123456789ab' },
  // 391 PROP-01 / D-03: `grants.revoke` takes the grant's durable id, so the `{}` default fails
  // its contract and turns an unbound refusal into an input error — which the parity case below
  // reads as `dispatched`. `grants.list` genuinely takes the empty query and needs no row here.
  'grants.revoke': { grantId: 'grant_0123456789abcdef' },
  // 395 D-03: a PARSING input on its siblings' reasoning — the contract requires a non-empty path
  // and a scalar value, so the `{}` default would fail validation and turn an unbound refusal into
  // an input error, which the parity case below reads as `dispatched`. The path names a real
  // config key so the row stays aimed at the BINDING check and nothing else.
  'config.auth.set': { target: 'shop', authStateName: 'shop-default' },
  'config.field.set': { path: 'use.timeout', value: '45s' },
  'config.hook.add': { name: 'seed', runtime: 'node', file: 'scripts/seed.mjs' },
  // 395-05 D-01: PARSING inputs for the rest of the closed action class, on the row above reasoning.
  'config.target.create': { name: 'shop', platform: 'web', url: 'https://shop.example.com' },
  'config.target.edit': { name: 'shop', changes: { url: 'https://shop.example.com/basket' } },
  'config.undo.propose': {},
  'config.project.scaffold': { domain: 'shop.example.com' },
  'config.proposal.apply': { proposalId: 'prop_0123456789ab' },
}

/**
 * The recorded run, with values that appear NOWHERE in any request below.
 *
 * Deliberate: an acknowledgment assembled from the request, or from a plausible default,
 * cannot produce `product/checkout`, ordinal 41, or two member tests. Only reading the run's
 * own record can.
 */
function recordedRun(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as RunId,
    scope: { tier: 'product', key: 'checkout' },
    buildOrdinal: 41,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_700_000_000_123,
    endedAt: 1_700_000_009_876,
    gateRun: true,
    tests: [
      {
        testId: 'test-1',
        testName: 'checks out',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        steps: [],
      },
      {
        testId: 'test-2',
        testName: 'reorders',
        filePath: 'tests/reorder.yaml',
        testIndex: 1,
        outcome: 'passed',
        steps: [],
      },
    ] as CompletedRunHandoff['tests'],
  }
}

/** A well-formed acknowledgment, for the spec whose body must never be reached. */
function toRunStartAcknowledgement(): RunStartAcknowledgement {
  const document = recordedRun('run-alpha')
  return {
    runId: document.runId,
    scope: document.scope,
    executionContext: document.executionContext,
    buildOrdinal: document.buildOrdinal,
    startedAt: document.startedAt,
    testCount: document.tests.length,
  }
}

interface Recorder {
  port: RunInvocationPort
  requests: () => readonly RunsStartInput[]
}

/** A run executor that records what it was asked for and reports the run it "started". */
function recordingInvocation(runIds: readonly string[] = ['run-alpha']): Recorder {
  const requests: RunsStartInput[] = []
  let index = 0
  return {
    port: {
      start(request) {
        requests.push(request)
        const runId = runIds[Math.min(index, runIds.length - 1)]!
        index += 1
        return Promise.resolve({ runId: runId as RunId })
      },
    },
    requests: () => requests,
  }
}

function deps(overrides: Partial<FunctionDeps> = {}): FunctionDeps {
  const documents = [recordedRun('run-alpha')]
  return {
    runs: {
      list: () => Promise.resolve(documents),
      get: (runId) => Promise.resolve(documents.find((document) => document.runId === runId)),
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
    ...overrides,
  }
}

interface CapturedSink {
  sink: AuditSink
  rows: () => readonly ExecutionAuditRow[]
}

function capturingSink(): CapturedSink {
  const executionRows: ExecutionAuditRow[] = []
  const guardrailRows: GuardrailAuditRow[] = []
  return {
    sink: {
      appendExecutionAudit(row) {
        executionRows.push(row)
      },
      appendGuardrailAudit(row) {
        guardrailRows.push(row)
      },
    },
    rows: () => executionRows,
  }
}

/**
 * A composition where every ask is already standing-approved (391).
 *
 * The claims in this file are about BINDING, and 391 raised `knowledge.proposal.apply` to the ask
 * tier — so without this, an ask-tier capability would be refused by the GATE before the binding
 * check ever ran, and the loop below would be measuring policy while reporting on bindings. The
 * grant is built from the action's own name, which is the string `grantCovers` compares, so it
 * covers whatever the registry happens to list rather than a class spelled here.
 *
 * It is a control, not a bypass: the real gate still runs and still writes its audit row; what
 * changes is which arm of the ask ladder answers.
 */
const EVERY_ASK_STANDING_APPROVED: StandingApprovalReader = {
  grantsFor: (action) => [{ actionClass: action.name, scope: STANDING_APPROVAL_SCOPE }],
}

function registryWith(
  runInvocation: RunInvocationPort | undefined,
  options: { context?: ExecutionContext; auditSink?: AuditSink } = {},
) {
  return createFunctionRegistry({
    deps: deps(runInvocation === undefined ? {} : { runInvocation }),
    resolveExecutionContext: () => options.context ?? 'local-interactive',
    standingApprovalReader: () => EVERY_ASK_STANDING_APPROVED,
    auditSink: options.auditSink ?? {
      appendExecutionAudit() {},
      appendGuardrailAudit() {},
    },
  })
}

function statusOf(registry: ReturnType<typeof registryWith>, id: string): string | undefined {
  return registry.list(RUN_CALLER).find((declaration) => declaration.id === id)?.bindingStatus
}

describe('bindingStatus is a fact about a COMPOSITION, computed (D-16)', () => {
  it('reads bound and unbound off ONE spec, from two registries in one process', () => {
    const bound = registryWith(recordingInvocation().port)
    const unbound = registryWith(undefined)

    expect(statusOf(bound, RUNS_START_FUNCTION_ID)).toBe('bound')
    expect(statusOf(unbound, RUNS_START_FUNCTION_ID)).toBe('unbound')
    // Same module-level singleton behind both listings: there is nothing per-registry on the
    // spec that could have been mutated to produce the difference.
    expect(runsStartSpec.boundThrough).toBe('runInvocation')
  })

  it('refuses in the composition that reports unbound and dispatches in the one that does not', async () => {
    await expect(invokeFunction(registryWith(undefined), RUNS_START_FUNCTION_ID, {}, RUN_CALLER))
      .rejects.toBeInstanceOf(FunctionNotBoundError)

    const acknowledgement = await invokeFunction(
      registryWith(recordingInvocation().port),
      RUNS_START_FUNCTION_ID,
      {},
      RUN_CALLER,
    ) as RunStartAcknowledgement
    expect(acknowledgement.runId).toBe('run-alpha')
  })

  it('never lets a listing and the gate disagree, for EVERY registered capability', async () => {
    // Registry-driven rather than id-keyed: a capability added later is covered by this case
    // on the day it is registered. The property is the one a caller depends on — what the
    // catalog says about a host is what the host does.
    for (const runInvocation of [recordingInvocation().port, undefined]) {
      const registry = registryWith(runInvocation)
      for (const declaration of registry.list(RUN_CALLER)) {
        const outcome = await invokeFunction(
          registry,
          declaration.id,
          BINDING_PARITY_INPUTS[declaration.id] ?? {},
          RUN_CALLER,
        ).then(() => 'dispatched', (error: unknown) => (
          error instanceof FunctionNotBoundError ? 'refused-unbound' : 'dispatched'
        ))

        expect(outcome, `${declaration.id} @ ${declaration.bindingStatus}`)
          .toBe(declaration.bindingStatus === 'bound' ? 'dispatched' : 'refused-unbound')
      }
    }
  })

  it('refuses on the DECLARATION, whatever the implementation would have done', async () => {
    // Found by probing this file's own controls: deleting the binding check from
    // `invokeFunction` left all 205 agent tests green, because `runsStartSpec.invoke` guards
    // itself as well and the refusal simply moved one layer down. Nothing was asserting
    // 384's actual law — that the DECLARATION is authoritative and a spec this composition
    // reports as unbound never dispatches at all, whatever its own body happens to do.
    //
    // This spec's implementation ignores its deps and succeeds. If the pipeline's check were
    // gone it would run, in a composition that says it cannot.
    let ran = 0
    const eagerlyBound: FunctionSpec = {
      ...(runsStartSpec as FunctionSpec),
      id: 'runs.start',
      invoke: () => {
        ran += 1
        return Promise.resolve(toRunStartAcknowledgement())
      },
    }
    const registry = createRegistryFromSpecs([eagerlyBound], {
      deps: deps(),
      resolveExecutionContext: () => 'local-interactive',
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    })

    await expect(invokeFunction(registry, RUNS_START_FUNCTION_ID, {}, RUN_CALLER))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
    expect(ran).toBe(0)
  })

  it('resolves every OTHER op bound in both compositions — the difference is one capability', () => {
    const bound = registryWith(recordingInvocation().port)
    const unbound = registryWith(undefined)
    const differing = bound.list(RUN_CALLER).filter((declaration) => (
      declaration.bindingStatus !== statusOf(unbound, declaration.id)
    ))

    expect(differing.map((declaration) => declaration.id)).toEqual([RUNS_START_FUNCTION_ID])
  })
})

describe('mutating-local, proven through a DISPATCH (Pitfall 10 / D-16)', () => {
  it('allows AND runs in every execution context, fail-closed ones included', async () => {
    for (const context of EVERY_CONTEXT) {
      const audit = capturingSink()
      const recorder = recordingInvocation()

      const acknowledgement = await invokeFunction(
        registryWith(recorder.port, { context, auditSink: audit.sink }),
        RUNS_START_FUNCTION_ID,
        {},
        RUN_CALLER,
      ) as RunStartAcknowledgement

      // The op RAN — this is the half the pre-385 suite could not assert, because the
      // binding check refused right after the allow and nothing downstream could tell an
      // allow that dispatches from one that does not.
      expect(recorder.requests(), context).toHaveLength(1)
      expect(acknowledgement.runId, context).toBe('run-alpha')
      expect(audit.rows(), context).toHaveLength(1)
      expect(audit.rows()[0], context).toMatchObject({
        action: 'fn:runs.start',
        riskTier: 'mutating-local',
        verdict: 'allow',
      })
    }
  })

  it('would lose the DISPATCH on a mutating-shared descriptor — the counterfactual', async () => {
    // risk-classification.test.ts proves the descriptor alone denies in ci. What this adds is
    // the consequence: the run never starts. The executor is asked for nothing, so the CI
    // authoring loop the tier exists to protect would have no run at all.
    const recorder = recordingInvocation()
    const shared: FunctionSpec = {
      ...(runsStartSpec as FunctionSpec),
      risk: { ...runsStartSpec.risk, declaredTier: 'mutating-shared' },
    }
    const registry = createRegistryFromSpecs([shared], {
      deps: deps({ runInvocation: recorder.port }),
      resolveExecutionContext: () => 'ci',
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    })

    await expect(invokeFunction(registry, RUNS_START_FUNCTION_ID, {}, RUN_CALLER))
      .rejects.toMatchObject({ name: 'FunctionDeniedError' })
    expect(recorder.requests()).toEqual([])
  })
})

describe('the acknowledgment describes the RUN, not the request', () => {
  it('reads every field off the run own record, through the same reader runs.get answers from', async () => {
    const acknowledgement = await invokeFunction(
      registryWith(recordingInvocation().port),
      RUNS_START_FUNCTION_ID,
      // A request that agrees with the recorded run about nothing at all.
      { patterns: ['tests/unrelated.yaml'] },
      RUN_CALLER,
    ) as RunStartAcknowledgement

    expect(acknowledgement).toEqual({
      runId: 'run-alpha',
      scope: { tier: 'product', key: 'checkout' },
      executionContext: 'local-headless',
      buildOrdinal: 41,
      startedAt: 1_700_000_000_123,
      testCount: 2,
      // Copied from the RECORD. The request set no marker, so an echo of the request would
      // have produced no marker at all — which is precisely the "assume the request survived
      // resolution" failure the contract warns about.
      gateRun: true,
    })
  })

  it('refuses a host that reports a run it did not record — the anti-fabrication control', async () => {
    const invented = recordingInvocation(['run-that-never-ran'])

    const thrown = await invokeFunction(
      registryWith(invented.port),
      RUNS_START_FUNCTION_ID,
      {},
      RUN_CALLER,
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(RunNotRecordedError)
    expect((thrown as RunNotRecordedError).runId).toBe('run-that-never-ran')
    // Named distinctly from the unbound refusal: the capability IS bound here, and what
    // failed is the host's claim that a run happened.
    expect(thrown).not.toBeInstanceOf(FunctionNotBoundError)
  })

  it('hands the executor the VALIDATED request, not the raw input', async () => {
    const recorder = recordingInvocation()

    await invokeFunction(
      registryWith(recorder.port),
      RUNS_START_FUNCTION_ID,
      { patterns: ['tests/checkout.yaml'] },
      RUN_CALLER,
    )

    expect(recorder.requests()).toEqual([{ patterns: ['tests/checkout.yaml'] }])
  })
})

describe('resolveBindingStatus is the one decision, and it is total', () => {
  it('answers bound for a spec that needs nothing optional, whatever the deps carry', () => {
    const alwaysBound = { ...(runsStartSpec as FunctionSpec), boundThrough: undefined }

    expect(resolveBindingStatus(alwaysBound, deps())).toBe('bound')
    expect(resolveBindingStatus(runsStartSpec as FunctionSpec, deps())).toBe('unbound')
    expect(resolveBindingStatus(
      runsStartSpec as FunctionSpec,
      deps({ runInvocation: recordingInvocation().port }),
    )).toBe('bound')
  })
})
