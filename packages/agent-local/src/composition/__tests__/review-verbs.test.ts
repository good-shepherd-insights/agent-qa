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
import type { FunctionRegistry } from '@vostride/agent-qa-agent'
import {
  publishBundleForTest,
  type BundleStoreConfig,
} from '@vostride/agent-qa-knowledge-local'
import { FunctionScopeSchema, MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  Anchor,
  FunctionCaller,
  ForgetReceiptV1,
  KnowledgeApplyOutcomeDto,
  KnowledgeProposeOutcomeDto,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createKnowledgeReader, createKnowledgeReview, createRunsReader } from '../compose-local-agent.js'

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
  entries: [],
}

/** Granted EVERY scope, so a refusal below can only ever be about BINDING. */
const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
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
        distilledEvidenceRef: {
          sha256: 'a'.repeat(64),
          bytes: 2,
          mediaType: 'application/json',
        },
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

  function registry(withReview: boolean): FunctionRegistry {
    return createFunctionRegistry({
      deps: {
        runs: createRunsReader(agentQaRoot),
        knowledge: createKnowledgeReader(() => knowledgeRoot),
        config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
        entities: {
          resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
          get: () => Promise.resolve(undefined),
        },
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
      resolveExecutionContext: () => 'local-interactive',
    })
  }

  it('lists all four as UNBOUND by name and refuses each by name without a review port', async () => {
    const recordId = publish()
    const readOnly = registry(false)

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
