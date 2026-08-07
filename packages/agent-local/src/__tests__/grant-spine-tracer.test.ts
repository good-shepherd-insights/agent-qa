// The standing-grant spine, end to end through the real composition (Phase 391, PROP-01 / D-11).
//
// WHAT THIS FILE PROVES, and why it is one file rather than three. Before 391 no standing approval
// could be consumed through the function layer at all, for two independent reasons that would each
// have hidden the other:
//
//   1. `invokeFunction` called the gate with no reader and no action scope. The gate defaults an
//      absent scope to the empty object, and the scope comparison refuses an empty scope on EITHER
//      side, so every grant would have failed to match whatever a reader returned.
//   2. `knowledge.proposal.apply` classified to the recognized-mutating floor, whose base verdict
//      ALLOWS in every context. A standing approval can only ever satisfy an ASK, so there was no
//      ask for it to satisfy on the one verb in this layer that commits.
//
// Fixing either alone would have measured nothing. So the three legs below run against ONE live
// composition, in order, over ONE committed ledger:
//
//   leg 1  no grant recorded          -> the apply is REFUSED before dispatch
//   leg 2  a grant appended through the REAL append API -> the same apply COMMITS, and the audit
//                                        row names `standing-approval` as what satisfied the ask
//   leg 3  a revoke appended for the same grant id      -> the same apply is REFUSED again
//
// NOTHING IS HAND-WRITTEN INTO THE LEDGER. The grant and the revoke both go through
// `appendGrantLedgerEvents`, which is the function the mint verb will call in plan 04 — a JSONL line
// typed out by a test is a line no producer can necessarily emit, and a fixture like that pins a
// contract nothing actually has to satisfy. For the same reason the covered action class is READ OFF
// the registry's own declaration of the op rather than spelled here: the gate compares the grant's
// class against the op's action name with `===`, and a literal in this file would keep matching a
// name the op had stopped carrying.
//
// The execution context is pinned to `local-headless`, which is the module default anyway, so leg 1
// and leg 3 land on the fail-closed arm rather than on an interactive prompt. That is the honest
// posture to pin: the two hosts that run this composition in anger — CI and the daemon — are both
// fail-closed, and a test that pinned the prompt arm would be pinning the one context neither of
// them is ever in.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FunctionDeniedError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import {
  appendGrantLedgerEvents,
  createStandingApprovalReader,
  grantsLedgerPath,
  publishBundleForTest,
  type BundleStoreConfig,
} from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  FunctionCaller,
  GrantLedgerEvent,
  KnowledgeApplyOutcomeDto,
  KnowledgeProposeOutcomeDto,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../composition/compose-local-agent.js'

const APPLY_FUNCTION_ID = 'knowledge.proposal.apply'
const GRANT_ID = 'grant_tracer_proposal_apply'
const GRANTED_AT = '2026-08-07T12:00:00.000Z'
const REVOKED_AT = '2026-08-07T12:30:00.000Z'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** Granted EVERY scope, so a refusal below can only ever be the policy gate's. */
const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

/** Captures what the gate wrote, which is the only place `trustSource` is observable. */
function capturingSink(): AuditSink & { rows: ExecutionAuditRow[] } {
  const rows: ExecutionAuditRow[] = []
  return {
    rows,
    appendExecutionAudit(row: ExecutionAuditRow) {
      rows.push(row)
    },
    appendGuardrailAudit(_row: GuardrailAuditRow) {},
  }
}

describe('a committed standing grant is consumed by the shipped gate, and a revoke takes it back', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string
  let sink: ReturnType<typeof capturingSink>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grant-spine-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
    sink = capturingSink()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Grant Spine Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  /** A real published record, so the proposal below has something real to be about. */
  function publish(): string {
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'grant-spine' },
        summary: 'checkout button',
        body: 'Selecting Checkout advances to the payment page.',
        distilledEvidenceRef: { id: 'grant-spine-evidence', sha: 'a'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Checkout' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 9,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'grant-spine', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /**
   * The composition under test. The reader is the REAL one over the REAL committed ledger, so every
   * leg below changes the gate's answer by changing a file rather than by changing a stub.
   */
  function host(): FunctionRegistry {
    return createFunctionRegistry({
      deps: {
        runs: createRunsReader(agentQaRoot),
        knowledge: createKnowledgeReader(() => knowledgeRoot),
        config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
        entities: {
          resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
          get: () => Promise.resolve(undefined),
        },
        knowledgeReview: createKnowledgeReview({
          agentQaRoot,
          resolveKnowledgeRoot: () => knowledgeRoot,
        }),
      },
      auditSink: sink,
      standingApprovalReader: () => createStandingApprovalReader({ knowledgeRoot }),
      resolveExecutionContext: () => 'local-headless',
    })
  }

  /**
   * The class the gate will compare against, taken from the op's OWN declaration.
   *
   * This is the produced-not-literal rule applied to the one field the whole loop turns on. The
   * declaration view carries `risk.name`, which is exactly the string `grantCovers` compares, so a
   * grant minted from it is a grant that can match by construction — and if the op ever renames
   * itself, this fixture follows it instead of quietly ceasing to cover anything.
   */
  function coveredActionClass(registry: FunctionRegistry): string {
    const declaration = registry.list(CALLER).find((entry) => entry.id === APPLY_FUNCTION_ID)
    if (declaration === undefined) throw new Error(`${APPLY_FUNCTION_ID} is not registered`)
    return declaration.risk.name
  }

  function append(events: readonly GrantLedgerEvent[]): void {
    const outcome = appendGrantLedgerEvents(knowledgeRoot, events, { auditBaseDir: agentQaRoot })
    if (outcome.kind !== 'appended') {
      throw new Error(`grant append refused: ${outcome.kind}`)
    }
  }

  async function propose(registry: FunctionRegistry, recordId: string): Promise<string> {
    const proposed = (await invokeFunction(
      registry,
      'knowledge.forget.propose',
      { target: { grain: 'record', recordId } },
      CALLER,
    )) as KnowledgeProposeOutcomeDto
    if (proposed.kind !== 'proposed') throw new Error(`expected a proposal, got ${proposed.kind}`)
    return proposed.proposal.proposalId
  }

  it('refuses the apply with no grant, commits it with one, and refuses it again after the revoke', async () => {
    const recordId = publish()
    const registry = host()
    const actionClass = coveredActionClass(registry)

    // The tier raise is what makes the ask reachable at all. Asserted from the declaration rather
    // than assumed, because every leg below is meaningless at the mutating-local floor: that tier
    // ALLOWS in every context, so all three legs would pass identically and prove nothing.
    expect(actionClass).toBe(`fn:${APPLY_FUNCTION_ID}`)
    expect(
      registry.list(CALLER).find((entry) => entry.id === APPLY_FUNCTION_ID)?.risk.declaredTier,
    ).toBe('mutating-shared')

    // A REAL proposal, minted through the propose verb, which stays at the local floor and is
    // therefore unaffected by any of this — a proposal commits nothing.
    const proposalId = await propose(registry, recordId)

    // ── LEG 1: no grant recorded. The ledger file does not even exist yet.
    await expect(
      invokeFunction(registry, APPLY_FUNCTION_ID, { proposalId }, CALLER),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    const denied = sink.rows.at(-1)
    expect(denied?.action).toBe(actionClass)
    expect(denied?.riskTier).toBe('mutating-shared')
    expect(denied?.verdict).toBe('deny')
    expect(denied?.outcome).toBe('fail-closed-denied')
    expect(denied?.trustSource).toBeUndefined()

    // Nothing dispatched, so the proposal is still there to be applied by leg 2. A refusal that had
    // consumed the proposal would make leg 2 unable to tell an allow from an already-applied.
    await expect(
      invokeFunction(registry, APPLY_FUNCTION_ID, { proposalId }, CALLER),
    ).rejects.toBeInstanceOf(FunctionDeniedError)

    // ── LEG 2: the grant, through the real append API, addressed by id.
    append([
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: GRANTED_AT,
        grantId: GRANT_ID,
        actionClass,
        scope: STANDING_APPROVAL_SCOPE,
        proposalId,
      },
    ])

    const applied = (await invokeFunction(
      registry,
      APPLY_FUNCTION_ID,
      { proposalId },
      CALLER,
    )) as KnowledgeApplyOutcomeDto
    // Dispatch was reached and the Curator's one commit path really ran.
    expect(applied.outcome).toBe('applied')

    const allowed = sink.rows.at(-1)
    expect(allowed?.action).toBe(actionClass)
    expect(allowed?.verdict).toBe('allow')
    expect(allowed?.outcome).toBe('proceeded')
    // The whole point: the ask was satisfied by the ledger, not by trust mode, not by a credential,
    // and not by a prompt.
    expect(allowed?.trustSource).toBe('standing-approval')

    // ── LEG 3: the revoke, addressed by the SAME grant id and nothing else.
    append([
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'revoke',
        at: REVOKED_AT,
        grantId: GRANT_ID,
      },
    ])

    // The proposal is applied now, so this call has a perfectly good already-applied answer waiting
    // for it — and never reaches it, because the gate runs before dispatch. That is the assertion:
    // the refusal below can only be the gate's.
    await expect(
      invokeFunction(registry, APPLY_FUNCTION_ID, { proposalId }, CALLER),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    const refusedAgain = sink.rows.at(-1)
    expect(refusedAgain?.verdict).toBe('deny')
    expect(refusedAgain?.outcome).toBe('fail-closed-denied')
    expect(refusedAgain?.trustSource).toBeUndefined()

    // The committed artifact holds BOTH events, in the order they happened. A revoke that had
    // rewritten or removed the grant line would leave a reviewer unable to see that an approval was
    // ever given.
    const committed = readFileSync(grantsLedgerPath(knowledgeRoot), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GrantLedgerEvent)
    expect(committed.map((event) => event.kind)).toEqual(['grant', 'revoke'])
    expect(committed.map((event) => event.grantId)).toEqual([GRANT_ID, GRANT_ID])
  }, 60_000)

  it('leaves the apply refused when a grant covers a DIFFERENT action class', async () => {
    // The negative that makes leg 2 above mean something. If any widening — a prefix, a family, a
    // substring — had crept into either the reader's filter or the gate's match, this grant would
    // satisfy the apply and the exact-match rule (D-04) would be a comment rather than a behaviour.
    const recordId = publish()
    const registry = host()
    const proposalId = await propose(registry, recordId)

    append([
      {
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: GRANTED_AT,
        grantId: 'grant_tracer_neighbouring_class',
        // A real sibling op's class, and a strict prefix of nothing: the point is that it is not
        // the apply's class, and that near-miss is the only thing separating it from leg 2's grant.
        actionClass: 'fn:knowledge.forget.propose',
        scope: STANDING_APPROVAL_SCOPE,
      },
    ])

    await expect(
      invokeFunction(registry, APPLY_FUNCTION_ID, { proposalId }, CALLER),
    ).rejects.toBeInstanceOf(FunctionDeniedError)
    expect(sink.rows.at(-1)?.outcome).toBe('fail-closed-denied')
  }, 60_000)
})
