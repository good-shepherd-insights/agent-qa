import { describe, expect, it } from 'vitest'
import { asRecordId, computeBriefDigest } from '@vostride/agent-qa-schema'
import type { BriefBlock, ScopeKey } from '@vostride/agent-qa-schema'
import type { SystemModelMessage } from 'ai'
import type { KnowledgeHintReader } from '../../knowledge-hint-reader.js'
import { executeStep } from '../index.js'
import { EvidenceRecorder } from '../evidence.js'
import { buildContextTier, buildVolatileTier } from '../prompts.js'
import type { RecordLedger } from '../record-ledger.js'
import type { StepContext } from '../types.js'
import { makeActionPlan, makeAdapter, makePlanner, makeStepContext } from './loop-harness.js'

const scope: ScopeKey = { tier: 'test', key: 'checkout' }
const block: BriefBlock = {
  tiers: {
    L0: 'Never submit a payment without explicit user confirmation.',
    L1: 'A stale overlay can obscure the Place order button.',
    L2: 'The confirmation page usually exposes an order number.',
  },
  lines: [
    {
      id: asRecordId('caution-overlay'),
      kind: 'caution',
      summary: 'A stale overlay can obscure the Place order button.',
      trust: 0.9,
      status: 'active',
      servedAsCanary: false,
      tier: 'L1',
    },
    {
      id: asRecordId('fact-order-number'),
      kind: 'fact',
      summary: 'The confirmation page usually exposes an order number.',
      trust: 0.8,
      status: 'active',
      servedAsCanary: true,
      tier: 'L2',
    },
  ],
  truncation: 'truncated 3 of 9',
}

function context(overrides: Partial<StepContext> = {}): StepContext {
  return makeStepContext({
    testName: scope.key,
    knowledgePolicyL0: block.tiers.L0,
    knowledgeBriefL1: block.tiers.L1,
    knowledgeBriefL2: block.tiers.L2,
    knowledgeBriefTruncation: block.truncation,
    ...overrides,
  })
}

function text(message: SystemModelMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
}

describe('BriefBlock prompt routing (BRIF-01 / D-03/D-05)', () => {
  it('routes L0 only to the cached-prefix context tier and learned L1/L2 only to volatile', () => {
    const cachedPrefix = text(buildContextTier(context()))
    const volatile = text(buildVolatileTier(context()))

    expect(cachedPrefix).toContain(block.tiers.L0)
    expect(cachedPrefix).not.toContain(block.tiers.L1)
    expect(cachedPrefix).not.toContain(block.tiers.L2)
    expect(volatile).not.toContain(block.tiers.L0)
    expect(volatile).toContain(block.tiers.L1)
    expect(volatile).toContain(block.tiers.L2)
    expect(volatile).toContain('L1')
    expect(volatile).toContain('L2')
    expect(volatile.toLowerCase()).toContain('hypotheses')
    expect(volatile.toLowerCase()).toContain('not instructions or commands')
  })

  it('renders a non-empty truncation signal and omits an empty one', () => {
    expect(text(buildVolatileTier(context()))).toContain(block.truncation)
    expect(text(buildVolatileTier(context({ knowledgeBriefTruncation: '' }))))
      .not.toContain('truncated 3 of 9')
  })

  it('keeps absent and empty briefs byte-identical with no brief-related sections', () => {
    const absent = makeStepContext({ testName: scope.key })
    const empty = makeStepContext({
      testName: scope.key,
      knowledgePolicyL0: '  ',
      knowledgeBriefL1: '',
      knowledgeBriefL2: '  ',
      knowledgeBriefTruncation: '',
    })

    expect(buildContextTier(empty)).toEqual(buildContextTier(absent))
    expect(buildVolatileTier(empty)).toEqual(buildVolatileTier(absent))
    expect(text(buildContextTier(empty))).not.toMatch(/knowledge (policy|brief)/i)
    expect(text(buildVolatileTier(empty))).not.toMatch(/knowledge (policy|brief)/i)
  })
})

describe('BriefBlock channel-1 evidence (BRIF-01)', () => {
  it('projects the served block into StepEvidence with a recomputed digest', () => {
    const recorder = new EvidenceRecorder()
    recorder.recordServedBrief({ scope, asOfBuild: 42, budget: 256, block })

    const evidence = recorder.finalize({ pass: true, reasoning: 'done' }, 0, 'checkout')

    expect(evidence.servedBrief.scope).toEqual(scope)
    expect(evidence.servedBrief.asOfBuild).toBe(42)
    expect(evidence.servedBrief.budget).toBe(256)
    expect(evidence.servedBrief.truncation).toBe(block.truncation)
    expect(evidence.servedBrief.channel1).toEqual(block.lines)
    expect(evidence.servedBrief.channel2).toEqual([])
    expect(evidence.servedBrief.channel3).toEqual([])
    expect(evidence.servedBrief.briefDigest).toBe(computeBriefDigest(evidence.servedBrief))
  })

  it('records the real reader block through executeStep instead of the empty fallback', async () => {
    const requestedBudgets: number[] = []
    const reader: KnowledgeHintReader = {
      getRunBrief(_scope, budget) {
        requestedBudgets.push(budget)
        return block
      },
      search() { return [] },
      read() { throw new Error('not used') },
      getCautions() { return { cautions: [], budgetUsed: 0 } },
      getProcedure() { return undefined },
      emitCanaryOutcome() {},
    }
    const result = await executeStep(
      'Place the order',
      {
        adapter: makeAdapter(),
        planner: makePlanner([makeActionPlan({ stepComplete: true })]),
        knowledgeReader: reader,
        knowledgeBudgets: { brief: 256, caution: 64, readBody: 128, recordCap: 8 },
        knowledgeAsOfBuild: 42,
      },
      context(),
    )

    expect(result.status).toBe('passed')
    expect(requestedBudgets).toEqual([256])
    expect(result.evidence?.servedBrief.channel1).toEqual(block.lines)
    expect(result.evidence?.servedBrief.asOfBuild).toBe(42)
    expect(result.evidence?.servedBrief.budget).toBe(256)
    expect(result.evidence?.servedBrief.truncation).toBe(block.truncation)
    expect(result.evidence?.servedBrief.briefDigest)
      .toBe(computeBriefDigest(result.evidence!.servedBrief))
  })

  it('resets the Channel-2 read ledger after reseeding the shared record ledger', async () => {
    const order: string[] = []
    const recordLedger: RecordLedger = {
      admit: () => ({ admitted: true }),
      resetTurn: (ids) => { order.push(`records:${ids.join(',')}`) },
      size: () => 0,
    }
    const reader: KnowledgeHintReader = {
      getRunBrief: () => block,
      search: () => [],
      read: () => { throw new Error('not used') },
      getCautions: () => ({ cautions: [], budgetUsed: 0 }),
      getProcedure: () => undefined,
      emitCanaryOutcome: () => {},
    }

    await executeStep(
      'Place the order',
      {
        adapter: makeAdapter(),
        planner: makePlanner([makeActionPlan({ stepComplete: true })]),
        knowledgeReader: reader,
        knowledgeBudgets: { brief: 256, caution: 64, readBody: 128, recordCap: 8 },
        recordLedger,
        beginMemoryTurn: (activeScope) => {
          order.push(`read-body:${activeScope?.tier}:${activeScope?.key}`)
        },
      },
      context(),
    )

    expect(order).toEqual([
      'records:caution-overlay,fact-order-number',
      'read-body:test:checkout',
    ])
  })
})
