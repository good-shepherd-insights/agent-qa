// The mutating review verbs, end to end through the function layer (387-08, KREV-01 / D-17).
//
// Two registries over ONE knowledge root, differing in exactly one field of the deps record: one
// supplies `knowledgeReview`, the other does not. That is the whole experiment, and it is what
// makes "a read-only host reports the mutating verbs as unbound BY NAME" a measured fact about a
// composition rather than a sentence in a doc comment — the same four ids, the same caller, the
// same store, two different honest answers.
//
// Nothing is stubbed on the write path: the proposal is really minted to disk, the apply really
// takes the writer lease and really reaches the Curator's `commit()`, and the store is really
// re-read afterwards.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  FunctionNotBoundError,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { EntityDirectoryPort, FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  appendGrantLedgerEvents,
  createStandingApprovalReader,
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
  EntityCard,
  EntityCardResolution,
  FunctionCaller,
  ForgetReceiptV1,
  KnowledgeApplyOutcomeDto,
  KnowledgeProposeOutcomeDto,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createEntityDirectory,
  createKnowledgeReader,
  createKnowledgeReview,
  createRunsReader,
} from '../compose-local-agent.js'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

/** The four ids the write half owns. Written out so an id that stopped registering is visible. */
const MUTATING_FUNCTION_IDS = [
  'knowledge.accept.propose',
  'knowledge.forget.propose',
  'knowledge.proposal.apply',
  'knowledge.reject.propose',
] as const

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

/** Granted EVERY scope, so a refusal below can only ever be about BINDING. */
const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'agent',
}

describe('the mutating review verbs bind, refuse and commit by name', () => {
  let root: string
  let knowledgeRoot: string
  let agentQaRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'review-verbs-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    agentQaRoot = join(root, '.agent-qa')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function storeConfig(): BundleStoreConfig {
    return {
      knowledgeRoot,
      productKey: 'Review Verbs Product',
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
  }

  function publish(): string {
    const outcome = publishBundleForTest(storeConfig(), {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [ANCHOR],
        scope: { tier: 'product', key: 'review-verbs' },
        summary: 'checkout button',
        body: 'Selecting Checkout advances to the payment page.',
        distilledEvidenceRef: { id: 'review-verbs-evidence', sha: 'a'.repeat(64) },
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
      provenance: { mode: 'run-linked', runId: 'review-verbs', testId: 't', stepIndex: 0 },
      artifacts: [],
    })
    if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
    return outcome.id
  }

  /**
   * Store state read through the layer's OWN read verb rather than through a direct store call.
   *
   * Deliberate: the claim under test is what a SURFACE observes after a review verb runs, and a
   * direct import would be a second way of looking at the store that could agree with the verbs
   * while the catalogue disagreed.
   */
  async function statuses(host: FunctionRegistry): Promise<string[]> {
    const rows = await invokeFunction(host, 'knowledge.bundles.list', {}, CALLER) as {
      status: string
    }[]
    return rows.map((row) => row.status)
  }

  /**
   * The stub directory the binding experiment uses: it answers `none` for everything, so a
   * refusal below can never be an entity lookup succeeding by accident.
   */
  const STUB_ENTITIES: EntityDirectoryPort = {
    resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
    get: () => Promise.resolve(undefined),
  }

  function registry(withReview: boolean, entities: EntityDirectoryPort = STUB_ENTITIES): FunctionRegistry {
    return createFunctionRegistry({
      deps: {
        runs: createRunsReader(agentQaRoot),
        knowledge: createKnowledgeReader(() => knowledgeRoot),
        config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
        entities,
        // THE one field that differs between the two registries.
        ...(withReview
          ? {
              knowledgeReview: createKnowledgeReview({
                agentQaRoot,
                resolveKnowledgeRoot: () => knowledgeRoot,
              }),
            }
          : {}),
      },
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} } as never,
      // 391: the apply is ask-tier now, so this composition binds the REAL reader over the same
      // knowledge root the verbs serve from, and each case records the approval it needs through
      // `approveApply` below. The alternative — a stub that says yes — would have made three cases
      // about binding quietly depend on a policy fixture nothing else in the repo uses.
      standingApprovalReader: () => createStandingApprovalReader({ knowledgeRoot }),
      resolveExecutionContext: () => 'local-interactive',
    })
  }

  /**
   * Record the standing approval the ask-tier apply requires (391, D-02/D-04).
   *
   * The covered class is read off the op's OWN declaration rather than spelled here, because that
   * is the exact string the gate compares — a literal would keep covering a name the op had stopped
   * carrying. The event goes through the real append API for the same reason: a hand-written JSONL
   * line pins a contract no producer necessarily emits.
   *
   * This restores what these three cases were always about. Before the tier raise the apply was
   * allowed unconditionally, so the only thing that could refuse it was the binding — which is the
   * claim under test. The approval puts that back, without stubbing the gate out.
   */
  function approveApply(host: FunctionRegistry): void {
    const declaration = host
      .list(CALLER)
      .find((entry) => entry.id === 'knowledge.proposal.apply')
    if (declaration === undefined) throw new Error('the apply op is not registered')
    const outcome = appendGrantLedgerEvents(
      knowledgeRoot,
      [{
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: '2026-08-07T12:00:00.000Z',
        grantId: 'grant_review_verbs_apply',
        actionClass: declaration.risk.name,
        scope: STANDING_APPROVAL_SCOPE,
      }],
      { auditBaseDir: agentQaRoot },
    )
    if (outcome.kind !== 'appended') throw new Error(`grant append refused: ${outcome.kind}`)
  }

  it('lists all four as UNBOUND by name and refuses each by name without a review port', async () => {
    const recordId = publish()
    const readOnly = registry(false)
    approveApply(readOnly)

    const listed = readOnly.list(CALLER)
    const byId = new Map(listed.map((declaration) => [declaration.id, declaration]))
    for (const id of MUTATING_FUNCTION_IDS) {
      // LISTED, not omitted: a capability absent from a catalogue is indistinguishable from one
      // that never existed, and the two are different facts about a host (D-09).
      expect(byId.get(id)?.bindingStatus, `${id} must be listed unbound`).toBe('unbound')
      expect(byId.get(id)?.requiredScopes).toEqual(['knowledge-write'])
      expect(byId.get(id)?.risk.readOnly).toBe(false)
    }

    for (const [id, input] of [
      ['knowledge.accept.propose', { target: { grain: 'record', recordId } }],
      ['knowledge.reject.propose', { target: { grain: 'record', recordId }, reason: 'no' }],
      ['knowledge.forget.propose', { target: { grain: 'record', recordId } }],
      ['knowledge.proposal.apply', { proposalId: 'prop_0123456789ab' }],
    ] as const) {
      // The inputs PARSE, so this refusal cannot be a contract refusal wearing a binding
      // refusal's clothes — `invokeFunction` validates before it consults the binding.
      await expect(invokeFunction(readOnly, id, input, CALLER), id)
        .rejects.toBeInstanceOf(FunctionNotBoundError)
    }

    // …and nothing was written by any of the four refusals.
    expect(await statuses(readOnly)).toEqual(['candidate'])
  })

  it('the SAME four ids are bound and reach the store when a review port is supplied', async () => {
    const recordId = publish()
    const host = registry(true)
    approveApply(host)

    for (const id of MUTATING_FUNCTION_IDS) {
      expect(
        host.list(CALLER).find((declaration) => declaration.id === id)?.bindingStatus,
        `${id} must be bound where a review port exists`,
      ).toBe('bound')
    }

    const proposed = await invokeFunction(
      host,
      'knowledge.forget.propose',
      { target: { grain: 'record', recordId } },
      CALLER,
    ) as KnowledgeProposeOutcomeDto
    if (proposed.kind !== 'proposed') throw new Error('expected a proposal')
    // Propose changed nothing: the record is still the candidate it was.
    expect(await statuses(host)).toEqual(['candidate'])

    const applied = await invokeFunction(
      host,
      'knowledge.proposal.apply',
      { proposalId: proposed.proposal.proposalId },
      CALLER,
    ) as KnowledgeApplyOutcomeDto

    expect(applied.outcome).toBe('applied')
    const receipt = applied.forgetReceipt as ForgetReceiptV1
    expect(receipt.tombstonedRecords.map((row) => row.recordId)).toEqual([recordId])
    // Tombstoned, never destroyed — the record is still enumerable, saying what happened to it.
    expect(await statuses(host)).toEqual(['deprecated'])

    // And the second apply is the typed already-applied answer carrying the FIRST receipt.
    const again = await invokeFunction(
      host,
      'knowledge.proposal.apply',
      { proposalId: proposed.proposal.proposalId },
      CALLER,
    ) as KnowledgeApplyOutcomeDto
    expect(again.outcome).toBe('already-applied')
    expect(again.forgetReceipt).toEqual(applied.forgetReceipt)
  })

  /**
   * CR-04's reproduction, run forwards as a regression case (387-11, ENTY-02 / D-04).
   *
   * The whole point is the RESOLVER path: the second render passes NO forget receipt anywhere,
   * so `produceEntityCard`'s receipt override never fires and the card status IS whatever the
   * sighting source derived from the store. Before plan 387-11 that derivation was a private
   * three-member table which omitted `deprecated`, so this sequence handed one caller a receipt
   * saying `tombstoned` and, moments later, a card at the same permanent address saying
   * `active`. Both halves are asserted in one test because the defect IS the disagreement — an
   * assertion on the card alone could be satisfied by a receipt that had also gone wrong.
   */
  it('renders an HONEST card on the resolver path after a forget — receipt and card agree', async () => {
    const recordId = publish()
    const host = registry(
      true,
      createEntityDirectory({ agentQaRoot, resolveKnowledgeRoot: () => knowledgeRoot }),
    )
    approveApply(host)

    // BEFORE. This is also the mint: resolving the bundle id is what gives the entity its
    // permanent MEM address (D-01), and every later render below goes through that address.
    const before = await invokeFunction(
      host,
      'entities.resolve',
      { ref: recordId },
      CALLER,
    ) as EntityCardResolution
    if (before.kind !== 'resolved') throw new Error(`expected a resolved card, got ${before.kind}`)
    expect(before.card.kind).toBe('MEM')
    expect(before.card.status).toBe('active')
    const address = before.card.id

    const proposed = await invokeFunction(
      host,
      'knowledge.forget.propose',
      { target: { grain: 'record', recordId } },
      CALLER,
    ) as KnowledgeProposeOutcomeDto
    if (proposed.kind !== 'proposed') throw new Error('expected a proposal')

    const applied = await invokeFunction(
      host,
      'knowledge.proposal.apply',
      { proposalId: proposed.proposal.proposalId },
      CALLER,
    ) as KnowledgeApplyOutcomeDto
    expect(applied.outcome).toBe('applied')
    const receipt = applied.forgetReceipt as ForgetReceiptV1

    // Half one: what the operation TOLD this caller.
    expect(receipt.resultingBundleStatus).toBe('tombstoned')

    // Half two: what the same caller sees at the permanent address afterwards, with no receipt
    // in hand. OBSERVED RED (2026-08-02) against the pre-387-11 `knowledge-local` build — the
    // real prior production code, reached because agent-local consumes that package through its
    // dist and the dist had not yet been rebuilt:
    //   AssertionError: expected 'active' to be 'tombstoned' // Object.is equality
    //   - Expected: "tombstoned"   + Received: "active"
    // raised on the FIRST assertion below and aborting the test there. The receipt assertion one
    // line above had already passed, so what the run showed is precisely the disagreement: the
    // same caller, the same operation, `tombstoned` on the receipt and `active` on the card.
    const got = await invokeFunction(host, 'entities.get', { ref: address }, CALLER) as EntityCard
    expect(got.status).toBe('tombstoned')
    expect(got.status).not.toBe('active')
    expect(got.status).toBe(receipt.resultingBundleStatus)

    // …and the resolve path agrees with the get path. Two entries, one honest answer.
    const after = await invokeFunction(
      host,
      'entities.resolve',
      { ref: recordId },
      CALLER,
    ) as EntityCardResolution
    if (after.kind !== 'resolved') throw new Error(`expected a resolved card, got ${after.kind}`)
    expect(after.card.id).toBe(address)
    expect(after.card.status).toBe('tombstoned')
    expect(after.card.status).not.toBe('active')
  })

  it('answers a typed not-found through the function layer, never a throw', async () => {
    publish()
    const host = registry(true)

    const outcome = await invokeFunction(
      host,
      'knowledge.accept.propose',
      { target: { grain: 'record', recordId: 'rec-not-in-this-store' } },
      CALLER,
    ) as KnowledgeProposeOutcomeDto

    // A result, not a rejection — and it survives the op's declared OUTPUT contract, which is
    // what makes "typed" mean something rather than "shaped like this today".
    expect(outcome).toEqual({
      kind: 'target-not-found',
      target: { grain: 'record', recordId: 'rec-not-in-this-store' },
    })
  })
})
