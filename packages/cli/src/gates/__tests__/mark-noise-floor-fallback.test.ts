import { existsSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireWriterLease, createLocalKnowledgeStore } from '@vostride/agent-qa-knowledge-local'
import type { PromotionPostureCandidate } from '@vostride/agent-qa-schema'
import { createKnowledgeChecks } from '../../commands/doctor-knowledge-checks.js'
import { buildPromotionPostureResolver, promotionPostureResolverForHost } from '../../curation/promotion-posture.js'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { markFixture } from './feedback-fixture.js'

describe('a first gold-freezing mark', () => {
  let root: string | undefined
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

  it('seeds an eval root with no noise floor that keeps the floor posture through the gate and doctor', async () => {
    const f = markFixture(); root = f.root
    const committedRoot = join(f.root, 'agent-qa-eval')
    const runReplayGate = vi.fn()
    const prepare = () => buildPromotionPostureResolver({ configPath: f.configPath, replayGate: { runReplayGate },
      knowledgeRoot: f.knowledgeRoot, agentQaRoot: f.agentQaRoot })
    const warn = vi.fn()
    const draining = promotionPostureResolverForHost(await prepare(), warn)!
    const candidate: PromotionPostureCandidate = { id: f.published.id, product: 'storefront',
      scope: { tier: 'product', key: 'storefront' },
      provenance: { runIds: [], receiptDigests: [], capturedAtOrdinals: [] } }
    expect(draining(candidate)).toBeUndefined()

    const marked = await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'confirmed-bug' })
    expect(marked).toMatchObject({ kind: 'marked', receipt: { disposition: { kind: 'confirmed-bug', confirmedRecords: 1 } } })
    expect(existsSync(committedRoot)).toBe(true)
    expect(existsSync(join(committedRoot, 'reports/noise-floor'))).toBe(false)
    expect(draining(candidate)).toBeUndefined()

    const resolution = await prepare()
    expect(resolution).toEqual({ kind: 'no-noise-floor', committedRoot })
    const lease = acquireWriterLease(f.knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error(lease.kind)
    const store = createLocalKnowledgeStore({ knowledgeRoot: f.knowledgeRoot, auditBaseDir: f.agentQaRoot,
      writerLeaseId: lease.leaseId, epoch: lease.epoch, executionContext: 'local-interactive', sourceBuildOrdinal: 43,
      resolvePromotionPosture: promotionPostureResolverForHost(resolution, warn) })
    await expect(store.promote(f.published.id)).resolves.toMatchObject({ kind: 'promoted', promotionPath: 'deterministic-verdict-floor' })
    expect(warn).not.toHaveBeenCalled()
    expect(runReplayGate).not.toHaveBeenCalled()

    const learning = createKnowledgeChecks({ config: { knowledge: { dir: 'agent-qa-knowledge' } }, configPath: f.configPath,
      probes: { classifyIndexFace: () => ({ source: 'index' }), readWriterLease: () => ({ kind: 'absent' }),
        resolveEmbedderCapability: async () => ({ kind: 'lexical-only' }) as never } })[3]
    const row = await learning.check()
    expect(row.status).toBe('warn')
    expect(row.message.split(';')[0]).toBe(`deterministic-verdict-floor — eval root at ${relative(process.cwd(), committedRoot)} has no noise floor yet`)
  })
})
