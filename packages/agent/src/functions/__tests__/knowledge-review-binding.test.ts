// The `knowledgeReview` optional dep reports as `unbound` BY NAME (Phase 387 plan 06, Pitfall 2).
//
// 387 ships the read half of the review-verb family; 387-08 ships the mutating half. The claim
// this file pins belongs to the read half all the same, because it is a claim about the
// CONTRACT: a composition that supplies no write capability must list the mutating verbs as a
// visible `unbound` rather than as a hole in the catalog, and a caller must be refused by name
// rather than by a failure somewhere far from the composition that forgot.
//
// WHY A LOCALLY-CONSTRUCTED REGISTRY. The obvious way to prove this is to register a
// placeholder spec in the built-in set and assert its status. That would have been wrong twice
// over: a stub in the default catalog joins all five exact-equality growth seams this workspace
// maintains (`EXPECTED_BINDING_STATUS`, `INVOCATION_SAMPLES`, `CONTRACTS_BY_ID`,
// `ALL_FUNCTION_IDS`, and the CLI's `fn --list` map), and then has to be removed from all five
// again when the real verbs land — so the seams would have recorded a capability that never
// shipped. `createRegistryFromSpecs` builds a registry over an explicit spec set, so the
// MECHANISM is exercised end to end with the catalog untouched. When 387-08 registers the real
// specs, they inherit exactly this behaviour and the growth seams grow once, for real ops.
//
// The spec below is deliberately a fixture and not a draft of a real verb: it is named in a
// domain nothing ships under, so nobody can mistake it for a capability under construction.

import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { ExecutionContext, FunctionCaller } from '@vostride/agent-qa-schema'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FunctionNotBoundError, invokeFunction } from '../invoke.js'
import { createRegistryFromSpecs, resolveBindingStatus } from '../registry.js'
import type { FunctionDeps, FunctionSpec, KnowledgeReviewPort } from '../spec.js'
import { knowledgeProposalApplySpec } from '../ops/knowledge-proposal-apply.js'

it('419 policy materialization refusal is classified as refused rather than executed', () => {
  const verdict = knowledgeProposalApplySpec.classify({ outcome: 'policy-materialize-refused',
    proposal: { schemaVersion: 1, proposalId: 'proposal-fixture', verb: 'accept',
      targetRef: { grain: 'record', recordId: 'policy-fixture' }, deltas: [], status: 'pending', proposedAt: 1 } })
  expect(verdict.status).toBe('refused')
  expect(verdict.outcome).toContain('proposal remains pending')
})

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read', 'config-write'],
  safeMode: false,
  origin: 'agent',
}

const CONTEXT: () => ExecutionContext = () => 'local-interactive'

const FIXTURE_ID = 'fixture.knowledge.review-binding'

/**
 * A spec that dispatches through the write port and nothing else.
 *
 * `boundThrough` is the whole subject: a spec states what its implementation NEEDS, and the
 * composition's answer to that need is what the declaration reports. The body reads the dep it
 * declared so an implementation that forgot to name `boundThrough` would crash rather than
 * silently list as bound — the failure mode a static `'bound'` literal on a spec produces.
 */
const reviewBoundSpec: FunctionSpec<Record<string, never>, string> = {
  id: FIXTURE_ID,
  summary: 'Fixture: a capability that can only run where knowledge review is bound.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  boundThrough: 'knowledgeReview',
  input: z.object({}).strict(),
  output: z.string(),
  risk: { name: `fn:${FIXTURE_ID}`, recognized: true, readOnly: false },
  // 399.1-04: `classify` is a REQUIRED member now. A synthetic op's fold is the smallest honest
  // one — the shape has a single arm, so there is nothing to discriminate.
  classify: () => ({ status: 'executed' as const, outcome: '' }),
  invoke(_input, deps) {
    const proposalId = deps.knowledgeReview === undefined ? 'no-port' : 'reached-the-port'
    return Promise.resolve(proposalId)
  },
}

/** A review port that answers, so a bound composition is distinguishable from an absent one. */
const reviewPort = {
  propose: () => Promise.reject(new Error('the fixture never proposes')),
  apply: () => Promise.reject(new Error('the fixture never applies')),
} as unknown as KnowledgeReviewPort

function deps(overrides: Partial<FunctionDeps> = {}): FunctionDeps {
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
      showRecord: ({ recordId }) => Promise.resolve({
        kind: 'not-found',
        schemaVersion: 1,
        recordId,
      } as const),
    },
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

function capturingSink(): AuditSink {
  const executionRows: ExecutionAuditRow[] = []
  const guardrailRows: GuardrailAuditRow[] = []
  return {
    appendExecutionAudit(row: ExecutionAuditRow) {
      executionRows.push(row)
    },
    appendGuardrailAudit(row: GuardrailAuditRow) {
      guardrailRows.push(row)
    },
  } as unknown as AuditSink
}

function registryOver(functionDeps: FunctionDeps) {
  // A FRESH spec object per registry: registration freezes what it is handed (WR-03), and two
  // registries sharing one frozen singleton would still be the same object — which is fine, and
  // is exactly why the copy is worth stating. The point of this file is that ONE spec reports
  // two different statuses in two compositions, so the spec must genuinely be the same contract.
  return createRegistryFromSpecs([reviewBoundSpec as FunctionSpec], {
    deps: functionDeps,
    auditSink: capturingSink(),
    resolveExecutionContext: CONTEXT,
  })
}

describe('the knowledgeReview optional dep', () => {
  it('lists the capability as unbound in a composition that supplies no write port', () => {
    const declarations = registryOver(deps()).list(CALLER)

    expect(declarations.map((declaration) => declaration.id)).toEqual([FIXTURE_ID])
    expect(declarations[0]!.bindingStatus).toBe('unbound')
  })

  it('lists the SAME spec as bound in a composition that supplies one', () => {
    const declarations = registryOver(deps({ knowledgeReview: reviewPort })).list(CALLER)

    expect(declarations[0]!.bindingStatus).toBe('bound')
  })

  it('refuses an unbound invocation BY NAME rather than failing inside the op', async () => {
    const registry = registryOver(deps())

    const error = await invokeFunction(registry, FIXTURE_ID, {}, CALLER).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(FunctionNotBoundError)
    expect((error as FunctionNotBoundError).functionId).toBe(FIXTURE_ID)
    // The distinction that matters: this is NOT `UnknownFunctionError`. The contract exists,
    // is listed, and projects into a catalog — what is absent is the binding.
    expect((error as Error).message).toContain(FIXTURE_ID)
  })

  it('dispatches to the op once the port is supplied, reaching the dep it declared', async () => {
    const registry = registryOver(deps({ knowledgeReview: reviewPort }))

    // `reached-the-port` is only producible by an invoke that was handed the port. An op that
    // listed bound and then found `undefined` would answer `no-port` here, which is the exact
    // disagreement between a listing and a dispatch that one shared `resolveBindingStatus`
    // exists to make impossible.
    expect(await invokeFunction(registry, FIXTURE_ID, {}, CALLER)).toBe('reached-the-port')
  })

  it('answers the binding question the same way for a listing and for a dispatch', () => {
    expect(resolveBindingStatus(reviewBoundSpec as FunctionSpec, deps())).toBe('unbound')
    expect(
      resolveBindingStatus(reviewBoundSpec as FunctionSpec, deps({ knowledgeReview: reviewPort })),
    ).toBe('bound')
  })
})
