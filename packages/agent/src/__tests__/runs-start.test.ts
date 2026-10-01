// `runs.start` in a composition that cannot run it (Phase 384, Plan 04 — D-09/D-10; repinned
// by 385 plan 10 — D-16).
//
// The point of this suite is unchanged and every case in it still holds: "declared but not
// bound in THIS composition" is a first-class, observable state. It must be distinguishable
// from a capability that does not exist (`UnknownFunctionError`) and from one that silently
// does nothing, and the attempt takes the same one dispatch path as every other invocation
// (D-11). 2026-10-01 (432-23): that path has no op gate (432-19) and no permission check (432
// D-12), so it writes no audit row and checks no caller.
//
// What changed in 385 is WHY the registry below reports `unbound`, and it is the reason this
// file needed almost no edit. `runs.start` now has an implementation; what it needs is a
// `runInvocation` port, and `fakeDeps()` supplies none. So the unbound state proven here is
// no longer a literal on a spec — it is a fact about a composition, which is what the
// vocabulary always claimed to describe. The capability is bound elsewhere in the same
// process (`composeLocalAgent()` with a run executor) and refused here, at the same time,
// from the same spec.

import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import type { AuditSink, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { FunctionNotBoundError, UnknownFunctionError, invokeFunction } from '../functions/invoke.js'
import { runsEventsSpec } from '../functions/ops/runs-events.js'
import { RUNS_START_FUNCTION_ID, runsStartSpec } from '../functions/ops/runs-start.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import { createRegistryFromSpecs } from '../functions/registry.js'
import type { FunctionDeps } from '../functions/spec.js'

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

// 2026-10-01 (432-19, D-17): the audit port has one append, for guardrail rows, so this sink
// records every row an invocation could write. The cells that asserted "no execution-audit row"
// since 432-13 now assert "no audit row of any kind".
interface CapturedSink {
  sink: AuditSink
  auditRows: () => readonly GuardrailAuditRow[]
}

function capturingSink(): CapturedSink {
  const guardrailRows: GuardrailAuditRow[] = []
  return {
    sink: {
      appendGuardrailAudit(row) {
        guardrailRows.push(row)
      },
    },
    auditRows: () => guardrailRows,
  }
}

// 2026-10-01 (432-23, D-12): attribution only — a surface and an origin, no grant.
const RUN_CALLER: FunctionCaller = {
  surface: 'test',
  origin: 'agent',
}

/** Discards every row — for the cases that do not assert on the audit trail. */
function noOpSink(): AuditSink {
  return {
    appendGuardrailAudit() {},
  }
}

function registryWithRunsStart(auditSink?: AuditSink) {
  return createRegistryFromSpecs([runsListSpec, runsEventsSpec, runsStartSpec], {
    deps: fakeDeps(),
    auditSink: auditSink ?? noOpSink(),
  })
}

describe('runs.start declaration', () => {
  it('declares its FULL contract and states what a composition must supply to run it', () => {
    expect(runsStartSpec.id).toBe(RUNS_START_FUNCTION_ID)
    expect(runsStartSpec.id).toBe('runs.start')
    // RE-SPELLED 2026-10-01 (432-23, D-12) from `requiredScopes` equal to ['run']: starting a run
    // costs no scope, so the spec declares none.
    expect(runsStartSpec).not.toHaveProperty('requiredScopes')
    expect(runsStartSpec.resultKind).toBe('unary')
    // The spec's entire say in whether it is bound. It names a NEED; the composition's
    // answer to that need is what a declaration reports (D-16).
    expect(runsStartSpec.boundThrough).toBe('runInvocation')
  })

  it('carries no static binding claim at all — a spec cannot answer for a composition', () => {
    // The lazy version of the 385 flip was to write `bindingStatus: 'bound'` here. Every
    // registry built without a run executor would then have listed a capability it cannot
    // run as runnable, and `FunctionNotBoundError` would have become unreachable by
    // declaration rather than unreachable by fact. There is no literal to flip.
    expect(Object.keys(runsStartSpec)).not.toContain('bindingStatus')
    expect((runsStartSpec as unknown as Record<string, unknown>)['bindingStatus'])
      .toBeUndefined()
  })

  it('carries the D-10 gateRun marker on its declared input', () => {
    expect(runsStartSpec.input.safeParse({ gateRun: true }).success).toBe(true)
    expect(runsStartSpec.input.safeParse({ gateRun: false }).success).toBe(false)
    expect(runsStartSpec.input.safeParse({}).success).toBe(true)
  })

  it('declares an acknowledgment output naming the run a caller can then address', () => {
    const acknowledgement = {
      runId: 'run-alpha',
      scope: { tier: 'product', key: 'shop' },
      executionContext: 'ci',
      buildOrdinal: 12,
      startedAt: 1_700_000_000_000,
      testCount: 3,
    }

    expect(runsStartSpec.output.safeParse(acknowledgement).success).toBe(true)
    expect(runsStartSpec.output.safeParse({ runId: 'run-alpha' }).success).toBe(false)
  })
})

describe('runs.start is visibly unbound, never silently missing', () => {
  it('lists with bindingStatus unbound alongside the bound capabilities', () => {
    const declarations = registryWithRunsStart().list(RUN_CALLER)

    expect(Object.fromEntries(declarations.map((declaration) => [
      declaration.id,
      declaration.bindingStatus,
    ]))).toEqual({
      'runs.events': 'bound',
      'runs.list': 'bound',
      'runs.start': 'unbound',
    })
  })

  it('refuses invocation with a named error that says it is not bound HERE', async () => {
    const thrown = await invokeFunction(registryWithRunsStart(), 'runs.start', {}, RUN_CALLER)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(FunctionNotBoundError)
    expect((thrown as FunctionNotBoundError).name).toBe('FunctionNotBoundError')
    expect((thrown as FunctionNotBoundError).functionId).toBe('runs.start')
    expect((thrown as Error).message).toContain('runs.start')
    expect((thrown as Error).message).toContain('not bound in this composition')
  })

  it('is a DIFFERENT refusal from an id the registry never heard of', async () => {
    const registry = registryWithRunsStart()

    const unbound = await invokeFunction(registry, 'runs.start', {}, RUN_CALLER)
      .catch((error: unknown) => error)
    const unknown = await invokeFunction(registry, 'runs.stop', {}, RUN_CALLER)
      .catch((error: unknown) => error)

    expect(unbound).toBeInstanceOf(FunctionNotBoundError)
    expect(unknown).toBeInstanceOf(UnknownFunctionError)
    expect(unbound).not.toBeInstanceOf(UnknownFunctionError)
  })

  // RE-SPELLED 2026-09-30 (432-13, D-15) from 'audits the attempt: the gate verdict precedes the
  // binding refusal (D-11)'. No gate decides the attempt; the binding refusal is the whole answer,
  // named, and no decision row is written.
  it('C432-INVOKE-DIRECT: an unbound attempt refuses by name and records no decision row', async () => {
    const audit = capturingSink()

    const thrown = await invokeFunction(registryWithRunsStart(audit.sink), 'runs.start', {}, RUN_CALLER)
      .catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(FunctionNotBoundError)
    expect(audit.auditRows()).toEqual([])
  })

  // RE-SPELLED 2026-10-01 (432-20, D-12) from 'refuses a caller lacking the run scope before it ever
  // reaches the binding check'. No scope is checked: the same caller reaches the binding check.
  // 2026-10-01 (432-23): no caller carries a scope at all, so the "lacking" caller is one that
  // differs from RUN_CALLER in every field a caller still has, and it meets the same answer.
  it('serves a caller lacking the run scope up to the same binding check', async () => {
    const audit = capturingSink()
    const readOnlyCaller: FunctionCaller = {
      surface: 'mcp',
      origin: 'human',
    }

    const thrown = await invokeFunction(
      registryWithRunsStart(audit.sink),
      'runs.start',
      {},
      readOnlyCaller,
    ).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(FunctionNotBoundError)
    expect((thrown as Error).name).not.toBe('FunctionScopeError')
    expect(audit.auditRows()).toHaveLength(0)
  })

  // 432-23 (D-12): the scope came off the spec, and the binding refusal must not have gone with it.
  // Retried, from callers that differ in every field a caller still carries, the unbound start
  // meets the same named refusal every time, writes no audit row, and never a permission error;
  // the bound stream beside it answers each caller alike.
  it('C432-ALL-OPS-AVAILABLE: a retried unbound start refuses by binding alone for every caller', async () => {
    const audit = capturingSink()
    const registry = registryWithRunsStart(audit.sink)
    const callers: readonly FunctionCaller[] = [
      RUN_CALLER,
      { surface: 'cli', origin: 'human' },
      { surface: 'mcp', origin: 'agent' },
    ]

    const names: string[] = []
    for (const caller of callers) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const thrown = await invokeFunction(registry, 'runs.start', {}, caller)
          .catch((error: unknown) => error)
        expect(thrown).toBeInstanceOf(FunctionNotBoundError)
        names.push((thrown as Error).name)
      }
    }
    expect(names).toEqual(Array.from({ length: 6 }, () => 'FunctionNotBoundError'))
    expect(audit.auditRows()).toEqual([])

    const declared = callers.map((caller) => registry.list(caller)
      .map((declaration) => [declaration.id, declaration.bindingStatus]))
    expect(declared[0]).toEqual([
      ['runs.events', 'bound'],
      ['runs.list', 'bound'],
      ['runs.start', 'unbound'],
    ])
    expect(declared[1]).toEqual(declared[0])
    expect(declared[2]).toEqual(declared[0])
  })

  it('refuses a DIRECT spec dispatch too, so no in-layer caller can slip past it', async () => {
    await expect(runsStartSpec.invoke({}, fakeDeps())).rejects.toBeInstanceOf(FunctionNotBoundError)
  })
})
