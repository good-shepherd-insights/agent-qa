// FUNC-03's one-shared-path claim, proven with data (Phase 384, Plan 05 — D-13 / SC3).
//
// The claim under test is that caller differences are DATA, never control flow: two callers
// hit ONE registry instance and ONE dispatch path, and every difference in what happens to
// them is fully explained by four fields on their records — `grantedScopes`, `safeMode`,
// `credential`, and (391 D-06) `origin`.
//
// `origin` joined as the FOURTH permission-shaped field rather than as a special case, and
// that is the whole point of it. The self-grant rule it enforces could have been written as
// `if (caller.surface === 'chat')`, which is the anti-pattern this file exists to refute; it
// is instead an op-declared requirement checked against a composition-minted field, so it
// reads exactly like the scope check one line above it and separates callers for a reason
// that is on the record rather than in the code.
//
// Two things make this a proof rather than an illustration:
//
//   1. The premise is machine-checked. The first case computes which keys actually differ
//      between the two records and asserts the set is exactly those four. If a later edit
//      makes the callers differ in a fifth way, every conclusion below stops following and
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
  FunctionOriginError,
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
  origin: 'human',
}

const CALLER_B: FunctionCaller = {
  surface: 'synthetic',
  grantedScopes: ['read'],
  safeMode: true,
  origin: 'agent',
}

/** A differs from this one ONLY in `safeMode` — the isolate for "listing is cosmetic". */
const CALLER_A_SAFE: FunctionCaller = { ...CALLER_A, safeMode: true }

/** A differs from this one ONLY in `origin` — the isolate for the 391 D-06 refusal. */
const CALLER_A_AGENT: FunctionCaller = { ...CALLER_A, origin: 'agent' }

/** The would-be scope claimant: no `run` grant, and the record is the only thing read. */
const CALLER_C: FunctionCaller = {
  surface: 'synthetic',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'human',
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
  // 392 D-24: the chat turn entry, first in SORT position (`agent.` precedes `analysis.`). It is
  // READ-tier and therefore survives safe-mode filtering, and that is a deliberate reading of what
  // safe mode is: the listing filter is cosmetic, so hiding the turn entry would hide the door
  // without closing it while every clause a turn runs stays gated server-side on its own scopes.
  'agent.ask',
  // 398 D-09: the `agent.` domain's second member, in SORT position (`agent.explain` follows
  // `agent.ask`). READ-tier, so it survives safe-mode filtering — deliberately, because a person
  // who has locked the agent down to reads is exactly the person most likely to ask what is left.
  'agent.explain',
  // 389 D-11: read-tier, so it survives safe-mode filtering like its analysis-domain-first
  // siblings never had to — the non-read drop-out set stays exactly `runs.start` plus the
  // four knowledge-write verbs.
  'analysis.get',
  // 393 D-01: one more id in SORT position (`authoring.` falls between `analysis.` and `config.`).
  // It declares `run` AND `read`, so it is NON-read and drops out of safe-mode filtering with
  // `runs.start` and the write verbs — the derived drop-out set below grows by one and the filter
  // assertion keeps testing the RULE rather than a frozen list.
  // 394-09 D-21: in SORT position BEFORE both its siblings (`edit` precedes `verify` precedes
  // `write`), not appended — this list is compared against the registry's lexicographic listing, so
  // an appended id would fail on ORDER while every member was present. It declares `test-write`
  // AND `read`, so it is non-read and joins the derived drop-out set; nothing below is edited,
  // which is what keeps the filter assertion a claim about the RULE rather than a frozen list.
  'authoring.draft.edit',
  'authoring.draft.verify',
  // 394 D-01: in SORT position beside its sibling (`verify` precedes `write`), not appended —
  // this list is compared against the registry's lexicographic listing, so an appended id would
  // fail on ORDER while every member was present. It declares `test-write`, `run` AND `read`, so
  // it is non-read and joins the derived drop-out set; nothing below is edited, which is what
  // keeps the filter assertion a claim about the RULE rather than about a frozen list.
  'authoring.draft.write',
  // 394-07 D-12: in SORT position after both `authoring.draft.*` ids (`draft` precedes `funnel`)
  // and before `config.` — this list is compared against the registry's lexicographic listing, so
  // an appended id would fail on ORDER while every member was present. It declares `read` ALONE,
  // so unlike its two authoring siblings it SURVIVES safe-mode filtering and the derived
  // drop-out set below is unchanged — which is what keeps the filter assertion a claim about the
  // RULE rather than about a frozen list.
  'authoring.funnel.get',
  // 395 D-01/D-03: in SORT position — `config.field.set` and `config.proposal.apply` fall on
  // either side of `config.get` lexicographically (`field` < `get` < `proposal`), and this list is
  // compared against the registry's lexicographic listing, so an appended pair would fail on ORDER
  // while every member was present. Both declare `config-write` and NOT `read`, so both DROP OUT
  // of the safe-mode listing with the other non-read verbs — which is what keeps the filter
  // assertion below a claim about the RULE rather than about a frozen list.
  'config.auth.set',
  'config.field.set',
  'config.get',
  'config.hook.add',
  // 395-08 D-13: one more id in SORT position. It declares `config-write` and NOT `read`, so it
  // joins the derived drop-out set with its siblings and the filter assertion stays a claim
  // about the RULE rather than about a list.
  'config.project.scaffold',
  'config.proposal.apply',
  // 395-05 D-01: two more ids in SORT position — `target` follows `proposal` lexicographically, and
  // this list is compared against the registry's lexicographic listing, so a misplaced pair would
  // fail on ORDER while every member was present. Both declare `config-write` and NOT `read`, so
  // both join the derived drop-out set and the filter assertion stays a claim about the RULE.
  'config.target.create',
  'config.target.edit',
  // 395-06 D-07: one more id in SORT position — `undo` follows `target` lexicographically. It
  // declares `config-write` and NOT `read`, so it joins the derived drop-out set with its six
  // siblings and the filter assertion stays a claim about the RULE.
  'config.undo.propose',
  // 387 D-09: both read-tier, so both survive safe-mode filtering — which is what makes the
  // filter assertion below sharper rather than merely longer. `runs.start` is still the only
  // id that drops out, and it now drops out of a set two entries larger.
  'entities.get',
  'entities.resolve',
  // 391 PROP-01 / D-03: two more ids in SORT position (`grants.` falls between `entities.` and
  // `knowledge.`). `list` is read-tier and survives safe-mode filtering; `revoke` is
  // approval-write-tier and drops out with the other non-read verbs, so the derived non-read set
  // grows again and the filter assertion keeps testing the RULE rather than a frozen list.
  'grants.list',
  'grants.revoke',
  // 387 KREV-01/KREV-02: four more read-tier ids, so they too survive safe-mode filtering and
  // the filter assertion below sharpens rather than merely lengthens — 'runs.start' is still
  // the one id that drops out, now out of a set six entries larger than 384 shipped.
  // 387-08 KREV-01: the mutating half is knowledge-write-tier, so unlike its read siblings it
  // does NOT survive safe-mode filtering — which is what turns the assertion below from "one id
  // drops out" into "exactly the non-read ids drop out", a claim about the RULE rather than
  // about `runs.start`.
  'knowledge.accept.propose',
  'knowledge.brief.why',
  'knowledge.bundles.list',
  'knowledge.forget.propose',
  // 416 D-17: gate history is read-tier and remains visible in both caller listings.
  'knowledge.gates.list',
  'knowledge.proposal.apply',
  'knowledge.record.show',
  'knowledge.records.diff',
  'knowledge.records.inspect',
  'knowledge.reject.propose',
  // 391 PROP-03: three more ids in SORT position (`proposals.` falls between `knowledge.` and
  // `quarantine.`). `list` and `show` are read-tier and survive safe-mode filtering; `reject` is
  // approval-write-tier and drops out with the other non-read verbs, so the derived non-read set
  // grows from seven to eight and the filter assertion keeps testing the RULE.
  'proposals.accept',
  'proposals.list',
  'proposals.reject',
  'proposals.show',
  // 390 D-12/D-13: three more ids, and they land in SORT position rather than appended —
  // this list is compared against the registry's lexicographic listing, so an appended id
  // would fail on order while every member was present. `quarantine.list` is read-tier and
  // survives safe-mode filtering; `release` and `add` are knowledge-write-tier and drop out
  // with the 387-08 verbs, so the derived non-read set below grows from five to seven and the
  // filter assertion keeps testing the RULE rather than a frozen list.
  'quarantine.add',
  'quarantine.list',
  'quarantine.release',
  // 391 D-16: the per-run digest, in SORT position ahead of its `runs.` siblings. Read-tier, so
  // it survives safe-mode filtering and the derived non-read set below is unchanged — which is
  // what keeps the filter assertion a test of the RULE rather than of a frozen list.
  // 405-01 D-03: in SORT position BEFORE `runs.digest` (`detail` precedes `digest`), not
  // appended — this list is compared against the registry's lexicographic listing, so an appended
  // id would fail on ORDER while every member was present. It declares `read` ALONE, so it
  // survives safe-mode filtering and the derived drop-out set below is unchanged, which is what
  // keeps the filter assertion a claim about the RULE rather than about a frozen list.
  // 405-05 D-12/D-13: in SORT position BEFORE `runs.detail` (`artifact` precedes `detail`), not
  // appended — this list is compared against the registry's lexicographic listing, so an appended
  // id would fail on ORDER while every member was present. Read-tier like its `runs.` siblings, so
  // the derived non-read drop-out set below is unchanged.
  'runs.artifact',
  'runs.detail',
  'runs.digest',
  'runs.events',
  'runs.evidence',
  'runs.get',
  // 407-01 D-05: in SORT position between `runs.get` and `runs.list`, not appended — this list is
  // compared against the registry's lexicographic listing, so an appended id would fail on ORDER
  // while every member was present. Read-tier like its `runs.` siblings, so the derived non-read
  // drop-out set below is unchanged, which keeps the filter assertion a claim about the RULE.
  'runs.knowledge',
  'runs.list',
  // 403-01 D-03: read-tier like its `runs.` siblings — minting a VIEW-scoped, short-lived link is
  // a read of a run's live state, not a mutation of it — so it survives safe-mode filtering and
  // the derived non-read set below is unchanged, which is what keeps the filter assertion a test
  // of the RULE rather than of a frozen list.
  'runs.liveurl',
  // 419 GATE3-01: shared mutation; safe-mode listing excludes it by declared scope.
  'runs.mark',
  // 423 D-16: read-tier preview of the mark above, so safe-mode listing keeps it.
  'runs.mark.preview',
  // 423 D-19: read-tier, so it survives safe-mode filtering beside its runs. siblings.
  'runs.marks.history',
  // 388 D-14: read-tier like its `runs.` siblings, so it too survives safe-mode filtering and
  // the filter assertion below sharpens rather than merely lengthens — `runs.start` plus the
  // four knowledge-write verbs are still exactly the ids that drop out.
  'runs.postprocessing',
  'runs.start',
] as const

/**
 * The ids whose required scopes exceed `read`, derived from the REGISTRY rather than restated.
 *
 * Deriving it is the point: a hand-written list would be a second declaration of which
 * capabilities are non-read, free to agree with the specs today and drift tomorrow — and the
 * assertion it feeds is precisely the one that would then stop noticing.
 */
const NON_READ_FUNCTION_IDS = REGISTRY.list(CALLER_A)
  .filter((declaration) => declaration.requiredScopes.some((scope) => scope !== 'read'))
  .map((declaration) => declaration.id)

beforeEach(() => {
  audit.take()
})

/** Read one field of a caller record by name, so the premise can be computed generically. */
function field(caller: FunctionCaller, key: string): unknown {
  return (caller as unknown as Record<string, unknown>)[key]
}

describe('the premise: two records differing in exactly four fields', () => {
  it('differ in grantedScopes, safeMode, credential and origin — and in nothing else', () => {
    const keys = [...new Set([...Object.keys(CALLER_A), ...Object.keys(CALLER_B)])]
    const differing = keys.filter((key) => (
      JSON.stringify(field(CALLER_A, key)) !== JSON.stringify(field(CALLER_B, key))
    ))

    // If this goes red, every conclusion in this file stops following from its premise.
    expect(differing.sort()).toEqual(['credential', 'grantedScopes', 'origin', 'safeMode'])
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
    // Exactly the ids whose required scopes exceed `read` drop out — no more, no fewer. The
    // set is five now (`runs.start` plus 387-08's four knowledge-write verbs) and the assertion
    // is about the rule, so a sixth arrives already covered.
    expect(NON_READ_FUNCTION_IDS.length).toBeGreaterThan(1)
    expect(REGISTRY.list(CALLER_B).map((declaration) => declaration.id))
      .toEqual(ALL_FUNCTION_IDS.filter((id) => !NON_READ_FUNCTION_IDS.includes(id)))

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
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
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

/**
 * The origin axis (391 D-06).
 *
 * Two fixtures that are IDENTICAL but for the declaration, because that is the only way the
 * "unaffected" leg means anything: an op with no declaration invoked by an agent-origin caller
 * proves nothing unless the very same invocation would have been refused had the op declared.
 * Both are read-tier and inside the `read` scope every caller here holds, so neither the gate
 * nor the scope check can be what separates them.
 */
const humanOnlySpec: FunctionSpec<Record<string, never>, { ok: true }> = {
  id: 'synthetic.human-only',
  summary: 'Synthetic capability that declares a human-origin requirement.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  requiresHumanOrigin: true,
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: { name: 'fn:synthetic.human-only', recognized: true, readOnly: true },
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  invoke: () => Promise.resolve({ ok: true as const }),
}

/** The control: the same op minus the one field. */
const anyOriginSpec: FunctionSpec<Record<string, never>, { ok: true }> = {
  id: 'synthetic.any-origin',
  summary: 'Synthetic capability that declares nothing about origin.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: z.object({}).strict(),
  output: z.object({ ok: z.literal(true) }).strict(),
  risk: { name: 'fn:synthetic.any-origin', recognized: true, readOnly: true },
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  invoke: () => Promise.resolve({ ok: true as const }),
}

describe('a declared human-origin requirement is enforced uniformly (391 D-06)', () => {
  const originAudit = capturingSink()
  const originRegistry = createRegistryFromSpecs(
    [humanOnlySpec as FunctionSpec, anyOriginSpec as FunctionSpec],
    { deps: DEPS, auditSink: originAudit.sink, resolveExecutionContext: CONTEXT },
  )

  beforeEach(() => {
    originAudit.take()
  })

  it('refuses an agent-origin caller at a declaring op, with a typed error', async () => {
    await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, CALLER_A_AGENT))
      .rejects.toBeInstanceOf(FunctionOriginError)
  })

  it('names the op and the required origin, the way the scope refusal names its scopes', async () => {
    let thrown: unknown
    try {
      await invokeFunction(originRegistry, 'synthetic.human-only', {}, CALLER_A_AGENT)
    } catch (caught: unknown) {
      thrown = caught
    }

    expect(thrown).toBeInstanceOf(FunctionOriginError)
    const error = thrown as FunctionOriginError
    expect(error.functionId).toBe('synthetic.human-only')
    expect(error.requiredOrigin).toBe('human')
    expect(error.message).toContain('synthetic.human-only')
    expect(error.message).toContain('human')
  })

  it('admits the SAME op for a human-origin caller — the other corpus side', async () => {
    // Without this the refusal above is consistent with the op being broken for everyone.
    // A_AGENT differs from A in `origin` and in nothing else, so this pair isolates the field.
    await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, CALLER_A))
      .resolves.toEqual({ ok: true })
  })

  it('leaves an op WITHOUT the declaration unaffected by origin', async () => {
    // Load-bearing that the driver is agent-origin: an assertion that nothing happened is
    // only worth having when the input could have made it happen.
    await expect(invokeFunction(originRegistry, 'synthetic.any-origin', {}, CALLER_A_AGENT))
      .resolves.toEqual({ ok: true })
    await expect(invokeFunction(originRegistry, 'synthetic.any-origin', {}, CALLER_A))
      .resolves.toEqual({ ok: true })
  })

  it('refuses BEFORE the gate: an origin-refused caller leaves no audit row', async () => {
    // The placement claim, measured rather than stated. The origin check sits beside the scope
    // check in the pre-gate band, so it inherits that band's audit posture exactly — the same
    // gap 384 named for the other three pre-gate refusals, and the same phases own closing it.
    await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, CALLER_A_AGENT))
      .rejects.toBeInstanceOf(FunctionOriginError)
    expect(originAudit.take()).toEqual([])

    // And the admitted side DOES audit, so the emptiness above is about the refusal rather
    // than about this registry never auditing anything.
    await invokeFunction(originRegistry, 'synthetic.human-only', {}, CALLER_A)
    expect(originAudit.take()).toHaveLength(1)
  })

  it('refuses AFTER the scope check: a caller missing both is told about scopes first', async () => {
    // Order is the contract, and the order is the one the file's other refusals follow: the
    // cheaper, more specific refusal wins. A caller told "you lack read" and a caller told
    // "this needs a human" have different things to do next.
    const scopeless: FunctionCaller = { ...CALLER_A_AGENT, grantedScopes: [] }
    await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, scopeless))
      .rejects.toBeInstanceOf(FunctionScopeError)
  })

  it('never branches on surface: the refusal follows origin across every surface name', async () => {
    // The anti-pattern check, driven rather than reviewed. If the rule were a surface branch,
    // renaming the surface would move the outcome; it does not.
    for (const surface of ['cli', 'daemon', 'mcp', 'chat', 'synthetic']) {
      await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, {
        ...CALLER_A_AGENT,
        surface,
      })).rejects.toBeInstanceOf(FunctionOriginError)
      await expect(invokeFunction(originRegistry, 'synthetic.human-only', {}, {
        ...CALLER_A,
        surface,
      })).resolves.toEqual({ ok: true })
    }
  })
})
