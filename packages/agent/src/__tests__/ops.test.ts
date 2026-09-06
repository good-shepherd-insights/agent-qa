// Op-level behaviour for the three expansion capabilities (Phase 384, Plan 03).
//
// Ops are pure functions of (validated input, injected deps). These cases call `invoke`
// directly against fake ports so the projection logic is pinned independently of the gate,
// the registry, and any host access — `invoke-function.test.ts` owns the pipeline itself.

import type {
  CompletedRunHandoff,
  KnowledgeBundleSummary,
  KnowledgeGatesListResult,
  MaskedResolvedConfig,
  RunId,
} from '@vostride/agent-qa-schema'
import {
  CONFIG_MASK_PLACEHOLDER,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  stampReceiptDigest,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { configGetSpec } from '../functions/ops/config-get.js'
import { knowledgeBundlesListSpec } from '../functions/ops/knowledge-bundles-list.js'
import { knowledgeGatesListSpec, KnowledgeGatesUnboundError } from '../functions/ops/knowledge-gates-list.js'
import { RunNotFoundError, runsGetSpec } from '../functions/ops/runs-get.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import type { FunctionDeps } from '../functions/spec.js'

function bundle(overrides: Partial<KnowledgeBundleSummary> = {}): KnowledgeBundleSummary {
  return {
    bundleId: 'rec-1',
    product: 'shop',
    dir: 'memory/shop/bundles/rec-1',
    kind: 'fact',
    subtype: 'selector',
    scope: { tier: 'product', key: 'checkout' },
    status: 'active',
    trust: 0.75,
    counters: { confirmed: 2, contradicted: 0, helpful: 0, harmful: 0 },
    openedAtOrdinal: 4,
    lastConfirmedOrdinal: 7,
    summary: 'Checkout button on the cart page',
    evidenceIncomplete: false,
    ...overrides,
  }
}

function handoff(overrides: Partial<CompletedRunHandoff> = {}): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: 'run-alpha' as RunId,
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 11,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_000,
    endedAt: 2_000,
    tests: [],
    ...overrides,
  }
}

const maskedConfig: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/workspace/agent-qa.config.yaml',
  entries: [
    { key: 'workspace.testMatch', value: '["tests/**/*.yaml"]', source: 'config-file', masked: false },
    { key: 'registry.providers.acme.apiKey', value: CONFIG_MASK_PLACEHOLDER, source: 'config-file', masked: true },
  ],
}

/**
 * The read-side knowledge stub, in one place so a port widening is one edit rather than one
 * per case. `showRecord` reports the honest absence: nothing in this file commits a record.
 */
function fakeKnowledge(
  overrides: Partial<FunctionDeps['knowledge']> = {},
): FunctionDeps['knowledge'] {
  return {
    listBundles: () => Promise.resolve([]),
    inspectRecords: () => Promise.resolve([]),
    diffSince: () => Promise.resolve([]),
    showRecord: ({ recordId }) => Promise.resolve({
      kind: 'not-found',
      schemaVersion: 1,
      recordId,
    } as const),
    ...overrides,
  }
}

function fakeDeps(overrides: Partial<FunctionDeps> = {}): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      // The stream port is exercised in runs-events.test.ts; here it exists only because
      // FunctionDeps is a required, non-partial record.
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: fakeKnowledge(),
    // 387: `entities` is a REQUIRED read port on FunctionDeps. Stated here so the record
    // typechecks, and stated as an ANSWERING stub rather than a refusing one: these cases
    // exercise other ops, and nothing in this file mints an address, so an honest miss and a
    // reported absence are the truthful answers.
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: { getMasked: () => Promise.resolve(maskedConfig) },
    ...overrides,
  }
}

describe('runs.get', () => {
  it('declares a read-only unary contract bound in this composition', () => {
    expect(runsGetSpec.id).toBe('runs.get')
    expect(runsGetSpec.requiredScopes).toEqual(['read'])
    expect(runsGetSpec.resultKind).toBe('unary')
    // Bound in EVERY composition: the implementation names no optional dep, so there is
    // nothing a host could withhold that would leave it unbound (D-16).
    expect(runsGetSpec.boundThrough).toBeUndefined()
    expect(runsGetSpec.risk).toEqual({ name: 'fn:runs.get', recognized: true, readOnly: true })
  })

  it('projects a completed handoff into a RunDetail, markers included', async () => {
    const deps = fakeDeps({
      runs: {
        list: () => Promise.resolve([]),
        readEvents: () => Promise.resolve([]),
        readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
        get: () => Promise.resolve(handoff({
          gateRun: true,
          tests: [{
            testId: 'test-1',
            testName: 'checks out',
            filePath: 'tests/checkout.yaml',
            testIndex: 0,
            outcome: 'failed',
            steps: [
              { } as never,
              { } as never,
              { } as never,
            ],
            rootCause: {
              class: 'app_bug',
              producer: 'deterministic-classifier',
              confidence: 0.8,
              evidence: {
                citedSteps: [2],
                citedAnchors: [],
                citedArtifacts: [],
                rationale: 'the checkout button never enabled',
              },
              memoryMisdirectionRuledOut: true,
              perTest: 0,
            },
          }],
        })),
      },
    })

    const detail = await runsGetSpec.invoke({ runId: 'run-alpha' as RunId }, deps)

    expect(detail).toMatchObject({
      runId: 'run-alpha',
      buildOrdinal: 11,
      aggregateVerdict: 'failed',
      configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
      gateRun: true,
    })
    expect(detail.excludedFromOutcomes).toBeUndefined()
    expect(detail.tests).toEqual([{
      testId: 'test-1',
      testName: 'checks out',
      filePath: 'tests/checkout.yaml',
      testIndex: 0,
      outcome: 'failed',
      stepCount: 3,
      rootCause: {
        class: 'app_bug',
        producer: 'deterministic-classifier',
        confidence: 0.8,
        rationale: 'the checkout button never enabled',
      },
    }])
  })

  it('omits both durable markers and the rootCause when the handoff omits them', async () => {
    const deps = fakeDeps({
      runs: {
        list: () => Promise.resolve([]),
        readEvents: () => Promise.resolve([]),
        readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
        get: () => Promise.resolve(handoff({
          tests: [{
            testId: 'test-1',
            testName: 'passes',
            filePath: 'tests/ok.yaml',
            testIndex: 0,
            outcome: 'passed',
            steps: [],
          }],
        })),
      },
    })

    const detail = await runsGetSpec.invoke({ runId: 'run-alpha' as RunId }, deps)

    expect('gateRun' in detail).toBe(false)
    expect('excludedFromOutcomes' in detail).toBe(false)
    expect('rootCause' in detail.tests[0]!).toBe(false)
    expect(detail.tests[0]!.stepCount).toBe(0)
  })

  it('throws the typed not-found error for a runId the reader cannot resolve', async () => {
    await expect(
      runsGetSpec.invoke({ runId: 'run-missing' as RunId }, fakeDeps()),
    ).rejects.toThrow(RunNotFoundError)

    const error = await runsGetSpec
      .invoke({ runId: 'run-missing' as RunId }, fakeDeps())
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(RunNotFoundError)
    expect((error as RunNotFoundError).name).toBe('RunNotFoundError')
    expect((error as RunNotFoundError).runId).toBe('run-missing')
    expect((error as Error).message).toContain('run-missing')
  })
})

describe('knowledge.bundles.list', () => {
  it('declares a read-only unary contract bound in this composition', () => {
    expect(knowledgeBundlesListSpec.id).toBe('knowledge.bundles.list')
    expect(knowledgeBundlesListSpec.requiredScopes).toEqual(['read'])
    expect(knowledgeBundlesListSpec.resultKind).toBe('unary')
    expect(knowledgeBundlesListSpec.boundThrough).toBeUndefined()
    expect(knowledgeBundlesListSpec.risk).toEqual({
      name: 'fn:knowledge.bundles.list',
      recognized: true,
      readOnly: true,
    })
  })

  it('returns the reader rows in a total product-then-id order', async () => {
    const deps = fakeDeps({
      knowledge: fakeKnowledge({
        listBundles: () => Promise.resolve([
          bundle({ bundleId: 'rec-9', product: 'shop' }),
          bundle({ bundleId: 'rec-2', product: 'atlas' }),
          bundle({ bundleId: 'rec-1', product: 'shop' }),
        ]),
      }),
    })

    const rows = await knowledgeBundlesListSpec.invoke({}, deps)

    expect(rows.map((row) => `${row.product}/${row.bundleId}`)).toEqual([
      'atlas/rec-2',
      'shop/rec-1',
      'shop/rec-9',
    ])
  })

  it('returns an empty list when the knowledge root holds no bundles', async () => {
    expect(await knowledgeBundlesListSpec.invoke({}, fakeDeps())).toEqual([])
  })
})

describe('config.get', () => {
  it('declares a read-only unary contract bound in this composition', () => {
    expect(configGetSpec.id).toBe('config.get')
    expect(configGetSpec.requiredScopes).toEqual(['read'])
    expect(configGetSpec.resultKind).toBe('unary')
    expect(configGetSpec.boundThrough).toBeUndefined()
    expect(configGetSpec.risk).toEqual({
      name: 'fn:config.get',
      recognized: true,
      readOnly: true,
    })
  })

  it('returns the injected masked config unchanged — masking is upstream of the op', async () => {
    expect(await configGetSpec.invoke({}, fakeDeps())).toEqual(maskedConfig)
  })
})

describe('the seed capability set', () => {
  it('registers exactly the four D-06 read ids', () => {
    expect([
      runsListSpec.id,
      runsGetSpec.id,
      knowledgeBundlesListSpec.id,
      configGetSpec.id,
    ].sort()).toEqual(['config.get', 'knowledge.bundles.list', 'runs.get', 'runs.list'])
  })
})
describe('knowledge.gates.list', () => {
  it('declares a read-only unary contract through the required knowledge port', () => {
    expect(knowledgeGatesListSpec.id).toBe('knowledge.gates.list')
    expect(knowledgeGatesListSpec.requiredScopes).toEqual(['read'])
    expect(knowledgeGatesListSpec.resultKind).toBe('unary')
    expect(knowledgeGatesListSpec.boundThrough).toBeUndefined()
    expect(knowledgeGatesListSpec.risk).toEqual({
      name: 'fn:knowledge.gates.list', recognized: true, readOnly: true,
    })
  })
  it('forwards the found DTO unchanged and classifies its live verdict', async () => {
    const result: KnowledgeGatesListResult = {
      kind: 'found', recordId: 'rec-1', product: 'shop', recordKind: 'fact', status: 'candidate',
      strongestPromotionPath: 'deterministic-verdict-floor',
      lines: [stampReceiptDigest({ schemaVersion: 1, kind: 'promotion',
        candidateId: 'rec-1', promotionPath: 'deterministic-verdict-floor',
        citedReceiptDigests: [], producedAtOrdinal: 43, producedBy: { opId: 'promote' } })],
      standing: [], live: { verdict: 'promote', promotionPath: 'deterministic-verdict-floor',
        citedReceiptDigests: [] }, posture: 'absent',
    }
    const deps = fakeDeps({ knowledge: fakeKnowledge({
      gateReceipts: ({ candidateId }) => {
        expect(candidateId).toBe('rec-1')
        return Promise.resolve(result)
      },
    }) })
    expect(await knowledgeGatesListSpec.invoke({ recordId: 'rec-1' }, deps)).toBe(result)
    expect(knowledgeGatesListSpec.classify!(result)).toEqual({
      status: 'executed', outcome: '1 gate line(s); promote via deterministic-verdict-floor',
    })
    expect(knowledgeGatesListSpec.classify!({ kind: 'not-found', recordId: 'missing' })).toEqual({
      status: 'executed', outcome: 'record not found',
    })
    expect(knowledgeGatesListSpec.classify!({
      ...result, live: { verdict: 'hold', reason: 'not-candidate' },
    })).toEqual({ status: 'executed', outcome: '1 gate line(s); held: not-candidate' })
  })
  it('refuses an unbound gateReceipts capability by name', async () => {
    await expect(knowledgeGatesListSpec.invoke({ recordId: 'rec-1' }, fakeDeps()))
      .rejects.toBeInstanceOf(KnowledgeGatesUnboundError)
  })
})
