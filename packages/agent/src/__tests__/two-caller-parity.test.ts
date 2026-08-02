// FUNC-03's one-shared-path claim, proven with data (Phase 384, Plan 05 — D-13 / SC3).
//
// The claim under test is that caller differences are DATA, never control flow: two callers
// hit ONE registry instance and ONE dispatch path, and every difference in what happens to
// them is fully explained by three fields on their records — `grantedScopes`, `safeMode`,
// and `credential`.
//
// Two things make this a proof rather than an illustration:
//
//   1. The premise is machine-checked. The first case computes which keys actually differ
//      between the two records and asserts the set is exactly those three. If a later edit
//      makes the callers differ in a fourth way, every conclusion below stops following and
//      the suite says so instead of quietly proving something weaker.
//   2. The registry is a single module-scope instance, shared by every caller in the file.
//      "One shared path" is therefore structural here, not a claim in a comment.
//
// The gate is NOT stubbed: `invokeFunction` calls the real `evaluate`, so what a caller is
// refused for is decided by the shipped classifier and the shipped policy ladder.

import { evaluate } from '@vostride/agent-qa-safety'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  FunctionCaller,
  RunId,
  RunSummary,
  TrustCredential,
} from '@vostride/agent-qa-schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  FunctionDeniedError,
  FunctionInputError,
  FunctionNotBoundError,
  FunctionScopeError,
  invokeFunction,
} from '../functions/invoke.js'
import { createFunctionRegistry, createRegistryFromSpecs } from '../functions/registry.js'
import type { FunctionDeps, FunctionSpec } from '../functions/spec.js'

/**
 * `local-interactive` is the ONE context the shipped ladder does not treat as fail-closed,
 * so an ask-tier refusal below is the confirm path being declined rather than a context
 * short-circuit. Every read op allows in every context, so this choice cannot flatter them.
 */
const CONTEXT: () => ExecutionContext = () => 'local-interactive'

const CREDENTIAL: TrustCredential = { scope: { project: 'shop' } }

/**
 * The two synthetic callers. `surface` is deliberately IDENTICAL: attribution is not a
 * permission input, and holding it constant is what lets the difference set below come out
 * as exactly the three permission-shaped fields.
 */
const CALLER_A: FunctionCaller = {
  surface: 'synthetic',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
  credential: CREDENTIAL,
}

const CALLER_B: FunctionCaller = {
  surface: 'synthetic',
  grantedScopes: ['read'],
  safeMode: true,
}

/** A differs from this one ONLY in `safeMode` — the isolate for "listing is cosmetic". */
const CALLER_A_SAFE: FunctionCaller = { ...CALLER_A, safeMode: true }

/** The would-be scope claimant: no `run` grant, and the record is the only thing read. */
const CALLER_C: FunctionCaller = {
  surface: 'synthetic',
  grantedScopes: ['read'],
  safeMode: false,
}

/** C plus the one grant it lacked — the counterfactual for what the subset check reads. */
const CALLER_C_GRANTED: FunctionCaller = {
  ...CALLER_C,
  grantedScopes: ['read', 'run'],
}

function handoff(runId: string, buildOrdinal: number): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as RunId,
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

const DOCUMENTS: readonly CompletedRunHandoff[] = [
  handoff('run-beta', 12),
  handoff('run-alpha', 11),
]

const DEPS: FunctionDeps = {
  runs: {
    list: () => Promise.resolve(DOCUMENTS),
    get: (runId) => Promise.resolve(DOCUMENTS.find((document) => document.runId === runId)),
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
}

interface CapturedSink {
  sink: AuditSink
  /** Drain the rows written since the last drain, so each case reads its own trail. */
  take: () => readonly ExecutionAuditRow[]
}

function capturingSink(): CapturedSink {
  let executionRows: ExecutionAuditRow[] = []
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
    take() {
      const drained = executionRows
      executionRows = []
      return drained
    },
  }
}

const audit = capturingSink()

/**
 * ONE registry instance, built over the REAL built-in capability set and shared by every
 * caller in this file. Nothing here is per-caller: there is exactly one spec map, one deps
 * record, and one audit sink, so a per-surface branch would have nowhere to live.
 */
const REGISTRY = createFunctionRegistry({
  deps: DEPS,
  auditSink: audit.sink,
  resolveExecutionContext: CONTEXT,
})

/** The shipped capability set, as both callers' listings are measured against it. */
const ALL_FUNCTION_IDS = [
  'config.get',
  // 387 D-09: both read-tier, so both survive safe-mode filtering — which is what makes the
  // filter assertion below sharper rather than merely longer. `runs.start` is still the only
  // id that drops out, and it now drops out of a set two entries larger.
  'entities.get',
  'entities.resolve',
  'knowledge.bundles.list',
  'runs.events',
  'runs.get',
  'runs.list',
  'runs.start',
] as const

beforeEach(() => {
  audit.take()
})

/** Read one field of a caller record by name, so the premise can be computed generically. */
function field(caller: FunctionCaller, key: string): unknown {
  return (caller as unknown as Record<string, unknown>)[key]
}

describe('the premise: two records differing in exactly three fields', () => {
  it('differ in grantedScopes, safeMode and credential — and in nothing else', () => {
    const keys = [...new Set([...Object.keys(CALLER_A), ...Object.keys(CALLER_B)])]
    const differing = keys.filter((key) => (
      JSON.stringify(field(CALLER_A, key)) !== JSON.stringify(field(CALLER_B, key))
    ))

    // If this goes red, every conclusion in this file stops following from its premise.
    expect(differing.sort()).toEqual(['credential', 'grantedScopes', 'safeMode'])
    expect(CALLER_A.surface).toBe(CALLER_B.surface)
  })
})

describe('one shared path: the same op, the same dispatch, for both callers', () => {
  it('resolves runs.list identically for both callers, with identical audit trails', async () => {
    const resultA = (await invokeFunction(REGISTRY, 'runs.list', {}, CALLER_A)) as RunSummary[]
    const rowsA = audit.take()
    const resultB = (await invokeFunction(REGISTRY, 'runs.list', {}, CALLER_B)) as RunSummary[]
    const rowsB = audit.take()

    expect(resultA.map((summary) => summary.runId)).toEqual(['run-alpha', 'run-beta'])
    expect(resultB).toEqual(resultA)

    // Uniform gating (D-11): one row each, naming the same descriptor and the same tier.
    expect(rowsA).toHaveLength(1)
    expect(rowsB).toHaveLength(1)
    expect(rowsA[0]).toMatchObject({
      action: 'fn:runs.list',
      riskTier: 'read-only',
      verdict: 'allow',
    })
    // The shipped row shape carries NO caller field at all, so "the rows differ only in
    // attribution-shaped fields" is today, literally, "the rows are identical". Asserted as
    // an equality rather than a subset check on purpose: if attribution is ever added to
    // the row, this is the line that forces the addition to be justified rather than
    // absorbed silently.
    expect(rowsB).toEqual(rowsA)
  })

  it('ignores the originating surface entirely — attribution is never a permission input', async () => {
    const asCli = (await invokeFunction(
      REGISTRY,
      'runs.list',
      {},
      { ...CALLER_A, surface: 'cli' },
    )) as RunSummary[]
    const cliRows = audit.take()
    const asMcp = (await invokeFunction(
      REGISTRY,
      'runs.list',
      {},
      { ...CALLER_A, surface: 'mcp' },
    )) as RunSummary[]
    const mcpRows = audit.take()

    // `if (caller.surface === ...)` is the anti-pattern this layer exists to abolish. The
    // proof that no such branch exists is that renaming the surface changes nothing at all.
    expect(asMcp).toEqual(asCli)
    expect(mcpRows).toEqual(cliRows)
  })
})

describe('safe mode filters the listing and enforces nothing (FUNC-03)', () => {
  it('lists every capability for A and omits the non-read one for B', () => {
    expect(REGISTRY.list(CALLER_A).map((declaration) => declaration.id))
      .toEqual([...ALL_FUNCTION_IDS])
    // Exactly one id drops out, and it is the one whose required scopes exceed `read`.
    expect(REGISTRY.list(CALLER_B).map((declaration) => declaration.id))
      .toEqual(ALL_FUNCTION_IDS.filter((id) => id !== 'runs.start'))

    // A's listing carries runs.start as covered-but-UNBOUND, never as absent (D-09).
    const runsStart = REGISTRY.list(CALLER_A).find((declaration) => declaration.id === 'runs.start')
    expect(runsStart).toMatchObject({ requiredScopes: ['run'], bindingStatus: 'unbound' })
  })

  it('is decided by the op required scopes, not by what the caller was granted', () => {
    // B was granted `read` only; A_SAFE holds every grant. Both listings hide the same id,
    // so the filter is reading the DECLARATION, not the caller's grants.
    expect(REGISTRY.list(CALLER_A_SAFE).map((declaration) => declaration.id))
      .toEqual(REGISTRY.list(CALLER_B).map((declaration) => declaration.id))
  })

  it('changes nothing about enforcement: safe mode alone alters no invocation outcome', async () => {
    // A_SAFE differs from A ONLY in safeMode, and runs.start is hidden from its listing.
    // It nonetheless reaches exactly A's refusal — the binding check, after the gate.
    await expect(invokeFunction(REGISTRY, 'runs.start', {}, CALLER_A))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
    const rowsA = audit.take()

    await expect(invokeFunction(REGISTRY, 'runs.start', {}, CALLER_A_SAFE))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
    const rowsSafe = audit.take()

    expect(rowsA).toHaveLength(1)
    expect(rowsSafe).toEqual(rowsA)
  })

  it('refuses B server-side for the scope it lacks — the hidden op is still enforced', async () => {
    const refusal = invokeFunction(REGISTRY, 'runs.start', {}, CALLER_B)

    // Not "unknown", not "hidden": the scope subset check, computed server-side.
    await expect(refusal).rejects.toBeInstanceOf(FunctionScopeError)
    await expect(refusal).rejects.toMatchObject({ missingScopes: ['run'] })
    // The scope check precedes the gate, so a refused caller leaves no audit row — the
    // same ordering the pipeline suite pins, observed here from the caller's side.
    expect(audit.take()).toEqual([])
  })

  it('gives A and B DIFFERENT refusals for the same id, explained by grants alone', async () => {
    // Same registry, same id, same input. A gets as far as the binding check; B never
    // clears the subset check. Nothing but `grantedScopes` differs on that path.
    await expect(invokeFunction(REGISTRY, 'runs.start', {}, CALLER_A))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
    audit.take()
    await expect(invokeFunction(REGISTRY, 'runs.start', {}, CALLER_B))
      .rejects.toBeInstanceOf(FunctionScopeError)
  })
})

describe('a claimed scope is not a held scope (SC3 / T-384-13)', () => {
  it('refuses a caller whose record lacks the scope, whatever the payload says', async () => {
    const refusal = invokeFunction(REGISTRY, 'runs.start', {}, CALLER_C)

    await expect(refusal).rejects.toBeInstanceOf(FunctionScopeError)
    await expect(refusal).rejects.toMatchObject({ missingScopes: ['run'] })
  })

  it('rejects every attempt to smuggle a grant through the input payload', async () => {
    // The strict input contract is the reason no "I have scope X" assertion can even be
    // expressed on the wire: an unrecognized key is a typed refusal, not a silent drop.
    const smuggled = [
      { grantedScopes: ['run'] },
      { scopes: ['run'] },
      { requiredScopes: [] },
      { safeMode: false },
      { credential: { scope: { project: 'shop' } } },
      { caller: { grantedScopes: ['run'] } },
    ]

    for (const payload of smuggled) {
      await expect(invokeFunction(REGISTRY, 'runs.start', payload, CALLER_C))
        .rejects.toBeInstanceOf(FunctionInputError)
    }
    // Input validation precedes both the subset check and the gate, so none of these
    // attempts is auditable as an execution at all.
    expect(audit.take()).toEqual([])
  })

  it('reads the composition-minted grants and nothing else', async () => {
    // The counterfactual that makes the refusals above non-vacuous: the ONLY edit that
    // gets a caller past the subset check is an edit to the record's own grantedScopes,
    // which a caller cannot perform — the composition root mints it.
    await expect(invokeFunction(REGISTRY, 'runs.start', {}, CALLER_C_GRANTED))
      .rejects.toBeInstanceOf(FunctionNotBoundError)
  })
})

/**
 * The credential axis.
 *
 * Read ops allow in every context, so the credential can only become observable at an
 * ask-tier action. This synthetic op is the smallest thing that classifies to `ask` while
 * staying inside the `read` scope both callers hold — so the scope check cannot be what
 * separates them, and whatever separates them has to be the credential or nothing.
 */
const askTierSpec: FunctionSpec<Record<string, never>, { ok: true }> = {
  id: 'synthetic.ask',
  summary: 'Synthetic ask-tier capability that makes the credential axis observable.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: {
    name: 'fn:synthetic.ask',
    recognized: true,
    declaredTier: 'mutating-shared',
  },
  invoke: () => Promise.resolve({ ok: true as const }),
}

describe('the credential flows to the gate untouched (D-13)', () => {
  const askAudit = capturingSink()
  const askRegistry = createRegistryFromSpecs([askTierSpec as FunctionSpec], {
    deps: DEPS,
    auditSink: askAudit.sink,
    resolveExecutionContext: CONTEXT,
  })

  beforeEach(() => {
    askAudit.take()
  })

  it('never reads or rewrites it: A and B are refused identically at an ask-tier action', async () => {
    await expect(invokeFunction(askRegistry, 'synthetic.ask', {}, CALLER_A))
      .rejects.toBeInstanceOf(FunctionDeniedError)
    const rowsA = askAudit.take()
    await expect(invokeFunction(askRegistry, 'synthetic.ask', {}, CALLER_B))
      .rejects.toBeInstanceOf(FunctionDeniedError)
    const rowsB = askAudit.take()

    expect(rowsA).toHaveLength(1)
    expect(rowsA[0]).toMatchObject({
      action: 'fn:synthetic.ask',
      riskTier: 'mutating-shared',
      verdict: 'deny',
      outcome: 'prompted-denied',
    })
    // The layer contributes nothing of its own to the credential's fate: holding one and
    // holding none reach the identical gate outcome, because the layer passes the field
    // through and the GATE decides what it is worth.
    expect(rowsB).toEqual(rowsA)
    // And the object itself comes back out the way it went in — same reference, same value.
    expect(CALLER_A.credential).toBe(CREDENTIAL)
    expect(CALLER_A.credential).toEqual({ scope: { project: 'shop' } })
  })

  it('is decisive at the gate once an action scope exists — the 384 boundary, stated', async () => {
    // The counterfactual that keeps the case above from being vacuous. The shipped
    // `scopeMatches` requires BOTH a populated credential scope and a populated ACTION
    // scope; `invokeFunction` supplies no action scope in 384, which is precisely why the
    // credential is inert above rather than ignored. Given the action scope a later phase
    // will supply, the very same credential flips the verdict.
    const withCredential = await evaluate(
      askTierSpec.risk,
      'local-interactive',
      { credential: CREDENTIAL, actionScope: CREDENTIAL.scope },
      {},
    )
    const withoutCredential = await evaluate(
      askTierSpec.risk,
      'local-interactive',
      { actionScope: CREDENTIAL.scope },
      {},
    )

    expect(withCredential.verdict).toBe('allow')
    expect(withoutCredential.verdict).toBe('deny')
  })
})
