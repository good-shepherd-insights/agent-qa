import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrustPriorTable } from '@vostride/agent-qa-schema'

vi.mock('@vostride/agent-qa-knowledge-local/reader', async importOriginal => ({
  ...await importOriginal<object>(),
  inspectRecords: vi.fn(() => []), listBundles: vi.fn(() => []),
  showRecord: vi.fn(() => ({ kind: 'not-found' })),
  candidateInjectionFor: vi.fn(() => ({ kind: 'not-found' })),
  openKnowledgeReader: vi.fn(() => ({ getRunBrief: vi.fn() })),
}))
vi.mock('@vostride/agent-qa-knowledge-local', async importOriginal => ({
  ...await importOriginal<object>(),
  applyReview: vi.fn(async () => ({ outcome: 'already-applied' })),
  createLocalKnowledgeStore: vi.fn(() => ({ recordGateReceipt: vi.fn(), promote: vi.fn() })),
}))
vi.mock('@vostride/agent-qa-agent', async importOriginal => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-agent')>()
  return { ...actual, createFunctionRegistry: vi.fn(actual.createFunctionRegistry) }
})
import * as reader from '@vostride/agent-qa-knowledge-local/reader'
import * as writer from '@vostride/agent-qa-knowledge-local'
import { createFunctionRegistry } from '@vostride/agent-qa-agent'
import { composeLocalAgent, createKnowledgeReader, createKnowledgeReview, LOCAL_CURATION_CAPABILITIES } from '../compose-local-agent.js'
import { openRunKnowledgeComposition } from '../run-composition.js'

const priors: TrustPriorTable = Object.freeze({
  'agent-verified': Object.freeze({ alpha: 3, beta: 1 }),
  'agent-observed': Object.freeze({ alpha: 1, beta: 3 }),
})
const resolveTrustPriors = () => priors
let root: string
beforeEach(() => { vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), 'agent-qa-prior-host-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('neutral host prior passthrough', () => {
  it('composed host passes the snapshot to inspect, list, show, candidate and review', async () => {
    const host = composeLocalAgent({ agentQaRoot: root, knowledgeRoot: () => root,
      mintQuarantineIdentityPath: path => path, config: { getMasked: vi.fn() }, model: vi.fn(),
      resolveTrustPriors,
    })
    try {
      const deps = vi.mocked(createFunctionRegistry).mock.calls.at(-1)![0].deps
      await deps.knowledge!.inspectRecords({ filter: {} })
      await deps.knowledge!.listBundles()
      await deps.knowledge!.showRecord({ recordId: 'missing' })
      await deps.knowledge!.candidateInjection!({ candidateId: 'missing' })
      for (const method of [reader.inspectRecords, reader.showRecord, reader.candidateInjectionFor]) {
        expect(vi.mocked(method).mock.calls.at(-1)![0]).toMatchObject({ priors })
      }
      expect(vi.mocked(reader.listBundles).mock.calls.at(-1)![1]).toBe(priors)
      await deps.knowledgeReview!.apply('missing')
      expect(vi.mocked(writer.applyReview).mock.calls.at(-1)![0].resolveTrustPriors?.()).toBe(priors)
    } finally { await host.close() }
  })

  it('receipt and promotion writers receive the same resolver', async () => {
    const input = { knowledgeRoot: root, auditBaseDir: root, executionContext: 'local-interactive' as const,
      lease: { leaseId: 'fixture', epoch: 1 }, resolveTrustPriors }
    await LOCAL_CURATION_CAPABILITIES.recordGateReceipt({ ...input, receipt: {} as never })
    await LOCAL_CURATION_CAPABILITIES.promoteWithReceipts({ ...input, candidateId: 'missing' as never })
    expect(vi.mocked(writer.createLocalKnowledgeStore).mock.calls).toHaveLength(2)
    for (const [config] of vi.mocked(writer.createLocalKnowledgeStore).mock.calls) {
      expect(config.resolveTrustPriors?.()).toBe(priors)
    }
  })

  it('actual run composition gives the read-only serving factory the snapshot', () => {
    openRunKnowledgeComposition({ knowledgeRoot: root, scope: { tier: 'global', key: 'global' },
      asOfBuild: 1, capabilities: { text: true, vision: false, toolCalling: false, contextWindow: 8192, maxOutput: 1024 } as never,
      accounting: { estimate: () => 1, getCeilings: () => ({ contextWindow: 8192, maxOutput: 1024 }) },
      qaRulesText: '', workingContextText: '', resolveTrustPriors,
      resolveRetrievalRung: async () => ({ schemaVersion: 1, rung: 'bundle-scan', reason: 'index-unavailable' }),
    })
    expect(vi.mocked(reader.openKnowledgeReader).mock.calls.at(-1)![0]).toMatchObject({ priors })
  })

  it('absence remains optional at reader, review and writer boundaries', async () => {
    await createKnowledgeReader(() => root).inspectRecords({ filter: {} })
    await createKnowledgeReview({ agentQaRoot: root, resolveKnowledgeRoot: () => root }).apply('missing')
    await LOCAL_CURATION_CAPABILITIES.recordGateReceipt({ knowledgeRoot: root, auditBaseDir: root,
      executionContext: 'local-interactive', lease: { leaseId: 'fixture', epoch: 1 }, receipt: {} as never })
    expect(vi.mocked(reader.inspectRecords).mock.calls[0]![0]).not.toHaveProperty('priors')
    expect(vi.mocked(writer.applyReview).mock.calls[0]![0]).not.toHaveProperty('resolveTrustPriors')
    expect(vi.mocked(writer.createLocalKnowledgeStore).mock.calls[0]![0]).not.toHaveProperty('resolveTrustPriors')
  })
})
