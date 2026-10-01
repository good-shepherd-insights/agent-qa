// The invoke pipeline's load-bearing order and typed refusals (Phase 384, Plan 01 — FUNC-01 /
// FUNC-03 / D-11).
//
// 2026-09-30 (432-13, D-14/D-15): THERE IS NO OP GATE. `invokeFunction` no longer calls
// `evaluate`, so nothing is classified, asked or audited at dispatch. The cells that measured the
// gate's uniform audit are re-spelled as its absence (C432-INVOKE-DIRECT); the refusals that are
// not approvals — unknown id, invalid input, scope, origin, binding — stay measured unchanged.

import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
  FunctionScope,
  RunSummary,
} from '@vostride/agent-qa-schema'
import type { AuditSink, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FunctionInputError,
  FunctionNotBoundError,
  FunctionScopeError,
  UnknownFunctionError,
  invokeFunction,
} from '../functions/invoke.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import {
  DuplicateFunctionIdError,
  MissingAuditSinkError,
  createRegistryFromSpecs,
} from '../functions/registry.js'
import type { CreateFunctionRegistryOptions } from '../functions/registry.js'
import type { FunctionDeps, FunctionSpec } from '../functions/spec.js'

const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

describe('read invocation scope', () => {
  // RE-SPELLED 2026-09-30 (432-13): 'READ-SCOPE surrounds awaited read dispatch after the gate and
  // preserves output validation'. The scope still surrounds the dispatch; no gate row precedes it.
  it('READ-SCOPE surrounds awaited read dispatch and preserves output validation', async () => {
    const events: string[] = []
    const sink = capturingSink()
    const spec: FunctionSpec = {
      ...runsListSpec,
      invoke: async () => {
        events.push('invoke')
        await Promise.resolve()
        events.push('settled')
        return []
      },
    }
    const registry = createRegistryFromSpecs([spec], {
      ...registryOptions({ auditSink: sink.sink }),
      withReadScope: async (functionId: string, invoke: () => Promise<unknown>) => {
        expect(functionId).toBe('runs.list')
        expect(sink.auditRows()).toHaveLength(0)
        events.push('enter')
        try { return await invoke() } finally { events.push('dispose') }
      },
    })
    expect(await invokeFunction(registry, 'runs.list', {}, caller(['read']))).toEqual([])
    expect(events).toEqual(['enter', 'invoke', 'settled', 'dispose'])
  })

  it('READ-SCOPE never runs for denied calls or write dispatch', async () => {
    let scopes = 0
    const registry = createRegistryFromSpecs([runsListSpec, configSetSpec], {
      ...registryOptions(),
      withReadScope: async (_functionId: string, invoke: () => Promise<unknown>) => {
        scopes++
        return invoke()
      },
    })
    await expect(invokeFunction(registry, 'runs.list', {}, caller([]))).rejects.toBeInstanceOf(FunctionScopeError)
    await invokeFunction(registry, 'config.set', {}, caller(['config-write']))
    expect(scopes).toBe(0)
  })
})

function handoff(runId: string, buildOrdinal: number): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_000,
    endedAt: 2_000,
    tests: [],
  }
}

interface SpyDeps {
  deps: FunctionDeps
  listCalls: () => number
}

function spyDeps(documents: readonly CompletedRunHandoff[] = []): SpyDeps {
  let listCalls = 0
  return {
    deps: {
      runs: {
        list: () => {
          listCalls += 1
          return Promise.resolve(documents)
        },
        get: (runId) => Promise.resolve(
          documents.find((document) => document.runId === runId),
        ),
        // The stream port belongs to runs-events.test.ts; it exists here because
        // FunctionDeps is a required, non-partial record — which is exactly how an
        // unbound port becomes a compile error rather than a silent gap (D-09).
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
    },
    listCalls: () => listCalls,
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

function caller(grantedScopes: readonly FunctionScope[], safeMode = false): FunctionCaller {
  return { surface: 'test', grantedScopes, safeMode, origin: 'agent' }
}

/**
 * A second synthetic capability so ordering and safe-mode filtering are observable.
 *
 * Deliberately a NON-REGISTERED id: `config.get` is a real read-only capability now, so
 * reusing that id here would have this file assert a false thing about a shipped op.
 */
const configSetSpec: FunctionSpec<Record<string, never>, { ok: true }> = {
  id: 'config.set',
  summary: 'Synthetic non-read capability used to exercise the listing filter.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: { name: 'fn:config.set', recognized: true },
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  invoke: () => Promise.resolve({ ok: true as const }),
}

/**
 * A synthetic capability declaring 394's `test-write` beside the two scopes an authoring loop
 * also needs.
 *
 * The point of the multi-scope declaration is that the refusal must be SPECIFIC: a caller holding
 * `run` and `read` is missing exactly one thing, and being told which one is the difference
 * between an actionable refusal and a generic denial. Deliberately a non-registered id — the real
 * `authoring.draft.write` lands later in this phase, and pinning it here would assert a false
 * thing about a shipped op.
 */
const authoringDraftWriteSpec: FunctionSpec<Record<string, never>, { ok: true }> = {
  id: 'authoring.draft.write.synthetic',
  summary: 'Synthetic test-write capability used to exercise the scope refusal by name.',
  requiredScopes: ['test-write', 'run', 'read'],
  resultKind: 'unary',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: { name: 'fn:authoring.draft.write.synthetic', recognized: true },
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  invoke: () => Promise.resolve({ ok: true as const }),
}

/** Discards every row. Cases that ASSERT on rows pass an explicit `capturingSink` instead. */
function noOpSink(): AuditSink {
  return {
    appendGuardrailAudit() {},
  }
}

function registryOptions(
  overrides: Partial<CreateFunctionRegistryOptions> = {},
): CreateFunctionRegistryOptions {
  return {
    deps: spyDeps().deps,
    auditSink: noOpSink(),
    resolveExecutionContext: FIXED_CONTEXT,
    ...overrides,
  }
}

/**
 * The D-11 compile pin: a composition without an audit sink must not typecheck.
 *
 * Never called — its whole job is to be compiled. The `@ts-expect-error` fails if the
 * omission ever stops being an error, so making `auditSink` optional again breaks this
 * typecheck rather than silently restoring the unaudited fast path.
 */
function _sinklessCompositionIsATypeError(): void {
  createRegistryFromSpecs(
    [runsListSpec],
    // @ts-expect-error auditSink is REQUIRED (D-11) — a sinkless composition cannot exist.
    { deps: spyDeps().deps, resolveExecutionContext: FIXED_CONTEXT },
  )
}

describe('invokeFunction pipeline', () => {
  it('rejects an unknown id before any dependency is touched', async () => {
    const deps = spyDeps()
    const registry = createRegistryFromSpecs([runsListSpec], registryOptions({ deps: deps.deps }))

    await expect(
      invokeFunction(registry, 'runs.nope', {}, caller(['read'])),
    ).rejects.toBeInstanceOf(UnknownFunctionError)
    expect(deps.listCalls()).toBe(0)
  })

  it('rejects input that violates the declared contract before dispatch', async () => {
    const deps = spyDeps()
    const registry = createRegistryFromSpecs([runsListSpec], registryOptions({ deps: deps.deps }))

    await expect(
      invokeFunction(registry, 'runs.list', { unexpected: true }, caller(['read'])),
    ).rejects.toBeInstanceOf(FunctionInputError)
    expect(deps.listCalls()).toBe(0)
  })

  it('refuses a caller whose grants do not cover the required scopes', async () => {
    const deps = spyDeps()
    const audit = capturingSink()
    const registry = createRegistryFromSpecs(
      [runsListSpec],
      registryOptions({ deps: deps.deps, auditSink: audit.sink }),
    )

    const refusal = invokeFunction(registry, 'runs.list', {}, caller([]))

    await expect(refusal).rejects.toBeInstanceOf(FunctionScopeError)
    await expect(refusal).rejects.toMatchObject({ missingScopes: ['read'] })
    // The scope check precedes dispatch, so nothing dispatched and nothing was audited.
    expect(deps.listCalls()).toBe(0)
    expect(audit.auditRows()).toHaveLength(0)
  })

  it('refuses a run+read caller at a test-write op, naming the missing scope (394 T-394-01)', async () => {
    const deps = spyDeps()
    const audit = capturingSink()
    const registry = createRegistryFromSpecs(
      [authoringDraftWriteSpec as FunctionSpec],
      registryOptions({ deps: deps.deps, auditSink: audit.sink }),
    )

    const refusal = invokeFunction(
      registry,
      'authoring.draft.write.synthetic',
      {},
      caller(['run', 'read']),
    )

    await expect(refusal).rejects.toBeInstanceOf(FunctionScopeError)
    // BY NAME, and by exactly one name: the caller holds two of the three declared scopes, so a
    // refusal listing anything else would mean the gate is not reading the declaration.
    await expect(refusal).rejects.toMatchObject({ missingScopes: ['test-write'] })
    await expect(refusal).rejects.toThrow(/test-write/)
    expect(audit.auditRows()).toHaveLength(0)
  })

  it('lets a caller holding test-write through the same op', async () => {
    // The other half of the differential. Without it the case above would also pass for a gate
    // that refused every caller, which measures nothing about `test-write` in particular.
    const registry = createRegistryFromSpecs(
      [authoringDraftWriteSpec as FunctionSpec],
      registryOptions(),
    )

    await expect(
      invokeFunction(
        registry,
        'authoring.draft.write.synthetic',
        {},
        caller(['test-write', 'run', 'read']),
      ),
    ).resolves.toEqual({ ok: true })
  })

  // RE-SPELLED 2026-09-30 (432-13) from 'audits every successful read invocation exactly once (D-11
  // uniform gating)'. The read still dispatches exactly once; no gate decides it, so no row records
  // a decision.
  it('C432-INVOKE-DIRECT: a read dispatches exactly once and writes no execution-audit row', async () => {
    const deps = spyDeps([handoff('run-beta', 12), handoff('run-alpha', 11)])
    const audit = capturingSink()
    const registry = createRegistryFromSpecs(
      [runsListSpec],
      registryOptions({ deps: deps.deps, auditSink: audit.sink }),
    )

    const result = (await invokeFunction(registry, 'runs.list', {}, caller(['read']))) as RunSummary[]

    expect(result.map((summary) => summary.runId)).toEqual(['run-beta', 'run-alpha'])
    expect(deps.listCalls()).toBe(1)
    expect(audit.auditRows()).toEqual([])
  })

  it('yields an empty list when the injected reader has no runs', async () => {
    const deps = spyDeps([])
    const registry = createRegistryFromSpecs([runsListSpec], registryOptions({ deps: deps.deps }))

    await expect(invokeFunction(registry, 'runs.list', {}, caller(['read']))).resolves.toEqual([])
  })
})

/**
 * A synthetic op at the tier the retired gate asked about (432-13). `mutating-shared` used to reach
 * the ask ladder: fail-closed in `ci` and `local-headless`, a confirm prompt in `local-interactive`.
 */
function markLikeSpec(invocations: { count: number }): FunctionSpec<{ runId: string }, { ok: true }> {
  return {
    id: 'runs.mark.synthetic',
    summary: 'Synthetic mutating-shared capability used to prove the op gate is gone.',
    requiredScopes: ['run'],
    resultKind: 'unary',
    input: z.object({ runId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    risk: { name: 'fn:runs.mark.synthetic', recognized: true, declaredTier: 'mutating-shared' },
    classify: () => ({ status: 'executed' as const, outcome: '' }),
    invoke: () => {
      invocations.count += 1
      return Promise.resolve({ ok: true as const })
    },
  }
}

describe('C432-INVOKE-DIRECT — invokeFunction dispatches with no gate (432-13)', () => {
  it.each(['ci', 'local-headless', 'local-interactive'] as const)(
    'C432-INVOKE-DIRECT: a mutating-shared op in %s returns once with no confirm port and no audit row',
    async (context) => {
      const invocations = { count: 0 }
      const audit = capturingSink()
      const registry = createRegistryFromSpecs([markLikeSpec(invocations) as FunctionSpec], {
        ...registryOptions({ auditSink: audit.sink }),
        resolveExecutionContext: () => context,
      })

      await expect(
        invokeFunction(registry, 'runs.mark.synthetic', { runId: 'run-1' }, caller(['run'])),
      ).resolves.toEqual({ ok: true })

      expect(invocations.count).toBe(1)
      // No decision was taken, so none was recorded.
      expect(audit.auditRows()).toEqual([])
    },
  )

  it('C432-INVOKE-DIRECT: invalid input and a missing binding still refuse by name, dispatching nothing', async () => {
    const invocations = { count: 0 }
    const registry = createRegistryFromSpecs(
      [
        markLikeSpec(invocations) as FunctionSpec,
        { ...markLikeSpec(invocations), id: 'runs.mark.unbound', boundThrough: 'liveView' } as FunctionSpec,
      ],
      { ...registryOptions(), resolveExecutionContext: () => 'ci' },
    )

    await expect(
      invokeFunction(registry, 'runs.mark.synthetic', { runId: '' }, caller(['run'])),
    ).rejects.toBeInstanceOf(FunctionInputError)
    await expect(
      invokeFunction(registry, 'runs.mark.unbound', { runId: 'run-1' }, caller(['run'])),
    ).rejects.toBeInstanceOf(FunctionNotBoundError)
    await expect(
      invokeFunction(registry, 'runs.mark.unbound', { runId: 'run-1' }, caller(['run'])),
    ).rejects.toThrow(/runs\.mark\.unbound/)
    expect(invocations.count).toBe(0)
  })
})

describe('createRegistryFromSpecs', () => {
  it('rejects two declarations sharing an id', () => {
    expect(() => createRegistryFromSpecs([runsListSpec, runsListSpec], registryOptions()))
      .toThrow(DuplicateFunctionIdError)
  })

  it('lists declarations sorted by id and never exposes an implementation', () => {
    const registry = createRegistryFromSpecs([runsListSpec, configSetSpec], registryOptions())

    const declarations = registry.list(caller(['read', 'config-write']))

    expect(declarations.map((declaration) => declaration.id)).toEqual(['config.set', 'runs.list'])
    for (const declaration of declarations) {
      expect(declaration).not.toHaveProperty('invoke')
    }
  })

  /**
   * The D-11 audit guarantee as a RUNTIME property, beside the compile pin above (BL-03).
   *
   * The pin only binds callers `tsc` gets to see. Round 2 executed both routes it does not
   * cover — an in-workspace cast, and any plain-JS consumer of the published package — and
   * found that a sinkless registry CONSTRUCTED, dispatched, and wrote zero rows with no
   * diagnostic. `packages/safety`'s gate optional-chains the sink for its other callers, so
   * the refusal belongs at the one seam that populates the internals record instead.
   */
  it('refuses a sinkless construction at runtime, not only at the type level', () => {
    expect(() => createRegistryFromSpecs([runsListSpec], {
      deps: spyDeps().deps,
      resolveExecutionContext: FIXED_CONTEXT,
      auditSink: undefined as unknown as AuditSink,
    })).toThrow(MissingAuditSinkError)
  })

  it('refuses a hollow sink: a typed, attributable error rather than an opaque TypeError', () => {
    expect(() => createRegistryFromSpecs([runsListSpec], {
      deps: spyDeps().deps,
      resolveExecutionContext: FIXED_CONTEXT,
      auditSink: {} as unknown as AuditSink,
    })).toThrow(MissingAuditSinkError)
  })

  it('refuses a sink whose append methods are present but not callable', () => {
    expect(() => createRegistryFromSpecs([runsListSpec], {
      deps: spyDeps().deps,
      resolveExecutionContext: FIXED_CONTEXT,
      auditSink: {
        appendGuardrailAudit: 'not a function',
      } as unknown as AuditSink,
    })).toThrow(MissingAuditSinkError)
  })

  // 2026-10-01 (432-19, D-17): the construction contract is the guardrail append. A sink that
  // offers only the deleted execution-audit append is hollow, and one with only the guardrail
  // append is complete.
  it('C432-AUDIT-UNREAD: requires the guardrail append and nothing else', () => {
    expect(() => createRegistryFromSpecs([runsListSpec], {
      deps: spyDeps().deps,
      resolveExecutionContext: FIXED_CONTEXT,
      auditSink: { appendExecutionAudit() {} } as unknown as AuditSink,
    })).toThrow(MissingAuditSinkError)
    expect(() => createRegistryFromSpecs([runsListSpec], {
      deps: spyDeps().deps,
      resolveExecutionContext: FIXED_CONTEXT,
      auditSink: { appendGuardrailAudit() {} },
    })).not.toThrow()
  })

  it('constructs normally for every compliant composition', () => {
    expect(() => createRegistryFromSpecs([runsListSpec], registryOptions())).not.toThrow()
    expect(() => createRegistryFromSpecs(
      [runsListSpec],
      registryOptions({ auditSink: capturingSink().sink }),
    )).not.toThrow()
  })

  it('hides non-read capabilities from a safe-mode listing without enforcing anything', async () => {
    const deps = spyDeps()
    const registry = createRegistryFromSpecs(
      [runsListSpec, configSetSpec],
      registryOptions({ deps: deps.deps }),
    )

    const safeModeCaller = caller(['read', 'config-write'], true)
    expect(registry.list(safeModeCaller).map((declaration) => declaration.id))
      .toEqual(['runs.list'])

    // Safe mode is cosmetic: the hidden op still resolves when invoked with the grants
    // for it, because enforcement lives server-side in invokeFunction, not in the listing.
    await expect(invokeFunction(registry, 'config.set', {}, safeModeCaller))
      .resolves.toEqual({ ok: true })
  })
})
