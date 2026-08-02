// The invoke pipeline's load-bearing order, typed refusals, and uniform gating
// (Phase 384, Plan 01 — FUNC-01 / FUNC-03 / D-11).
//
// The gate is NOT stubbed: `invokeFunction` calls the real `evaluate` from
// @vostride/agent-qa-safety, so "read ops classify read-only → allow, and are audited
// anyway" is proven against the shipped classifier rather than against a fake.

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
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FunctionInputError,
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
      },
      knowledge: { listBundles: () => Promise.resolve([]) },
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

interface CapturedSink {
  sink: AuditSink
  executionRows: () => readonly ExecutionAuditRow[]
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
    executionRows: () => executionRows,
  }
}

function caller(grantedScopes: readonly FunctionScope[], safeMode = false): FunctionCaller {
  return { surface: 'test', grantedScopes, safeMode }
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
  invoke: () => Promise.resolve({ ok: true as const }),
}

/** Discards every row. Cases that ASSERT on rows pass an explicit `capturingSink` instead. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
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
    // The scope check precedes the gate, so nothing dispatched and nothing was audited.
    expect(deps.listCalls()).toBe(0)
    expect(audit.executionRows()).toHaveLength(0)
  })

  it('audits every successful read invocation exactly once (D-11 uniform gating)', async () => {
    const deps = spyDeps([handoff('run-beta', 12), handoff('run-alpha', 11)])
    const audit = capturingSink()
    const registry = createRegistryFromSpecs(
      [runsListSpec],
      registryOptions({ deps: deps.deps, auditSink: audit.sink }),
    )

    const result = (await invokeFunction(registry, 'runs.list', {}, caller(['read']))) as RunSummary[]

    expect(result.map((summary) => summary.runId)).toEqual(['run-alpha', 'run-beta'])
    expect(deps.listCalls()).toBe(1)
    const rows = audit.executionRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      action: 'fn:runs.list',
      riskTier: 'read-only',
      verdict: 'allow',
    })
  })

  it('yields an empty list when the injected reader has no runs', async () => {
    const deps = spyDeps([])
    const registry = createRegistryFromSpecs([runsListSpec], registryOptions({ deps: deps.deps }))

    await expect(invokeFunction(registry, 'runs.list', {}, caller(['read']))).resolves.toEqual([])
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
        appendExecutionAudit: 'not a function',
        appendGuardrailAudit: 'not a function',
      } as unknown as AuditSink,
    })).toThrow(MissingAuditSinkError)
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
