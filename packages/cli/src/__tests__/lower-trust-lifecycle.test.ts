import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import {
  acquireWriterLease, appendOutcomeEvent, createLocalKnowledgeStore, deriveBundleTrust,
  loadBundle, openKnowledgeReader, publishBundleForTest, readGateReceipts,
  buildGateInconsistencyProposal, fileGateInconsistencyProposal,
} from '@vostride/agent-qa-knowledge-local'
import { asEvidenceToken, stampReceiptDigest, survivingOutcomeEvents, type CanaryOutcome } from '@vostride/agent-qa-schema'
import { buildPromotionPostureResolver } from '../curation/promotion-posture.js'
import { promotionHostProof } from './promotion-host-proof.js'

const scope = { tier: 'product', key: 'example-web' } as const
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function setup() {
  const root = mkdtempSync(join(tmpdir(), '418-lower-trust-lifecycle-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  promotionHostProof(configPath)
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.eval = { gate2: { maxLowerTrustPerScope: 1 } }
  writeFileSync(configPath, JSON.stringify(config))
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const auditBaseDir = join(root, '.agent-qa')
  const appendConfig = { knowledgeRoot, auditBaseDir, productKey: scope.key,
    commitArtifacts: 'none' as const, writerLeaseId: 'fixture' }
  function seed(name: string) {
    const anchor = { t: 'el' as const, role: 'button', name, ordinal: 0 }
    const published = publishBundleForTest(appendConfig, {
      draft: { kind: 'fact', subtype: 'selector', scope, anchors: [anchor], summary: `${name} selector`,
        body: `Use the verified ${name} button.`, originStage: 'run-curation',
        distilledEvidenceRef: { id: `evidence-${name}`, sha: 'a'.repeat(64) } },
      discriminant: { kind: 'fact', subtype: 'selector', elementRef: { role: 'button', name } },
      originClass: 'agent-verified', createdAtOrdinal: 1, screenStates: [], relations: [], artifacts: [],
      initialEvents: [{ type: 'confirmed', evidenceToken: asEvidenceToken(`confirm-${name}`),
        curationJobId: `confirm-${name}`, buildOrdinal: 1 }],
      provenance: { mode: 'run-linked', runId: `seed-${name}`, testId: `seed-${name}`, stepIndex: 0,
        curationJobId: `seed-${name}`, sourceBuildOrdinal: 1 },
      evidenceMarkdown: 'Verified selector evidence.\n',
      distilledObservations: [{ schemaVersion: 1, step: { naturalKey: name, ordinal: 0 }, platform: 'web',
        element: { naturalKey: `button:${name}:0` }, observedAtOrdinal: 1 }],
    })
    if (published.kind !== 'published') throw new Error(published.kind)
    return { ...published, anchor }
  }
  const seeded = seed('checkout')
  const lease = acquireWriterLease(knowledgeRoot)
  if (lease.kind !== 'acquired') throw new Error(lease.kind)
  const replay = vi.fn(() => { throw new Error('automatic replay forbidden') })
  let ordinal = 15
  const posture = await buildPromotionPostureResolver({ configPath, knowledgeRoot, agentQaRoot: auditBaseDir,
    replayGate: { runReplayGate: replay }, currentBuildOrdinal: () => ordinal,
    canaryFacts: LOCAL_CURATION_CAPABILITIES.readCanaryPostureFacts,
    lowerTrustShares: LOCAL_CURATION_CAPABILITIES.readLowerTrustShares })
  if (posture.kind !== 'ready') throw new Error(JSON.stringify(posture))
  const corpusDigest = posture.host.corpusDigest
  const reports = vi.fn()
  const storeConfig = { knowledgeRoot, auditBaseDir, executionContext: 'local-interactive' as const,
    epoch: lease.epoch, writerLeaseId: lease.leaseId, sourceBuildOrdinal: ordinal,
    resolvePromotionPosture: posture.resolve, onPromotionOutcome: reports }
  const store = () => createLocalKnowledgeStore({ ...storeConfig, sourceBuildOrdinal: ordinal })
  function gate1(id = seeded.id, producedAtOrdinal = 10) {
    const score = { baseline: 0, candidate: 1, delta: 1, floor: 0.1, n: 3 }
    return stampReceiptDigest({ schemaVersion: 1, gate: 1, candidateId: id, verdict: 'pass',
      producedAtOrdinal, producedBy: { opId: 'fixture' },
      perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score, sideEffect: score, loop: score },
      corpusVersion: { corpusDigest, partitionVersion: 1, gateSetSize: 40, excludedCount: 0, minimumGateSet: 13 },
      samples: { k: 3, seeds: [1, 2, 3], seedHonored: true, modelCalls: 0 }, crossCheck: 'held' })
  }
  const read = () => {
    const loaded = loadBundle(seeded.dir)
    if (loaded.kind !== 'loaded') throw new Error(loaded.kind)
    return loaded.bundle
  }
  const outcome = (benefit: 'rode-along' | 'exercised-benefited'): CanaryOutcome => ({
    candidateId: seeded.id, runOutcome: 'positive', benefit, stateValidity: 'valid',
    runId: `canary-${ordinal}`, testId: 'checkout', testIndex: 0, stepIndex: 0, buildOrdinal: ordinal,
    exercisedAnchor: seeded.anchor, briefDigest: 'fixture-brief', attribution: 'Checkout was exercised.',
    corpusDigest,
  })
  const reader = () => openKnowledgeReader({ knowledgeRoot, product: scope.key, scopeDefaults: { asOfBuild: ordinal } })
  await store().promote(seeded.id, [gate1()])
  return { root, configPath, knowledgeRoot, appendConfig, seeded, seed, store, gate1, read, outcome,
    reader, replay, reports, posture, storeConfig, advance: () => { ordinal += 1 } }
}

describe('418 lower-trust active lifecycle through real store, resolver and serving', () => {
  it('keeps new candidates capped and requires a new quiet horizon after a changed Gate-1', async () => {
    const f = await setup()
    const next = f.seed('payment')
    await expect(f.store().promote(next.id, [f.gate1(next.id)]))
      .rejects.toMatchObject({ reason: 'gate2-receipt-required' })
    await expect(f.store().promote(f.seeded.id, [f.gate1(f.seeded.id, 15)]))
      .rejects.toMatchObject({ reason: 'gate2-receipt-required' })
    expect(deriveBundleTrust(f.read()).status).toBe('candidate')
    expect(LOCAL_CURATION_CAPABILITIES.readCanaryPostureFacts({ knowledgeRoot: f.knowledgeRoot,
      candidateId: f.seeded.id, scope })).not.toHaveProperty('lowerTrustActiveGate1Digest')
  })

  it.each(['rollback', 'stale receipt', 'negative', 'stale negative', 'pending inconsistency'] as const)
  ('revalidates lower-trust authority against %s', async defect => {
    const f = await setup()
    f.advance()
    let expected: string
    if (defect === 'rollback') {
      appendOutcomeEvent(f.appendConfig, f.seeded.id, { type: 'retracted',
        evidenceToken: asEvidenceToken('rollback-confirm'), curationJobId: 'rollback-confirm',
        buildOrdinal: 16, retractsEvidenceToken: asEvidenceToken('confirm-checkout'),
        retractsCurationJobId: 'confirm-checkout', rollbackReceiptId: 'rollback-confirm' })
      expected = 'no-confirmed-evidence'
    } else if (defect === 'stale receipt') {
      const current = f.posture.resolve
      f.posture.resolve = candidate => {
        const value = current(candidate)
        return value?.kind === 'resolved' ? { ...value, corpusDigest: 'f'.repeat(64) } : value
      }
      expected = 'receipt-stale'
    } else if (defect === 'pending inconsistency') {
      fileGateInconsistencyProposal(f.appendConfig.auditBaseDir,
        buildGateInconsistencyProposal({ candidateId: f.seeded.id, scope,
          shape: 'gate1-pass-gate2-fail', gate1Digest: f.gate1().receiptDigest,
          gate2Digest: 'd'.repeat(64), proposedAt: 10 }), { at: 10 })
      expected = 'gate-inconsistent'
    } else {
      await f.store().recordCanaryOutcome({ ...f.outcome('rode-along'), runOutcome: 'negative',
        benefit: 'exercised-harmed', stateValidity: defect === 'negative' ? 'valid' : 'stale' })
      expected = defect === 'negative' ? 'gate-inconsistent' : 'gate-abstained'
    }
    // Real revalidation path; the stale-corpus row alters external posture DATA.
    const store = createLocalKnowledgeStore({ ...f.storeConfig, sourceBuildOrdinal: 16,
      resolvePromotionPosture: f.posture.resolve })
    await expect(store.promote(f.seeded.id)).rejects.toMatchObject({ reason: expected })
    expect(survivingOutcomeEvents(f.read().events).filter(row => row.type === 'promoted')).toHaveLength(0)
    expect(f.replay).not.toHaveBeenCalled()
  })
  it.each(['repeat promote', 'rode-along'] as const)('retains at-cap authority after %s, then upgrades once on credit', async action => {
    const f = await setup()
    expect(deriveBundleTrust(f.read()).status).toBe('active')
    expect(LOCAL_CURATION_CAPABILITIES.readLowerTrustShares({ knowledgeRoot: f.knowledgeRoot }))
      .toEqual([{ product: scope.key, active: 1, lowerTrust: 1 }])
    f.advance()
    if (action === 'repeat promote') {
      await expect(f.store().promote(f.seeded.id)).resolves.toMatchObject({ kind: 'already-active' })
    } else await f.store().recordCanaryOutcome(f.outcome('rode-along'))
    expect(deriveBundleTrust(f.read()).status).toBe('active')
    expect(f.reader().search('checkout', { scope })[0]).toMatchObject({ lowerTrust: true, servedAsCanary: true })
    expect(f.reader().getRunBrief(scope, 10_000).brief.tiers.L2).toContain('[LEARNED, UNCONFIRMED] [CANARY]')
    expect(readGateReceipts(f.seeded.dir, f.seeded.id)!.filter(row => 'gate' in row && row.gate === 2)).toHaveLength(0)
    f.advance()
    await f.store().recordCanaryOutcome(f.outcome('exercised-benefited'))
    expect(deriveBundleTrust(f.read()).status).toBe('active')
    expect(f.reader().search('checkout', { scope })[0]).toMatchObject({ servedAsCanary: false })
    expect(f.reader().search('checkout', { scope })[0]).not.toHaveProperty('lowerTrust')
    expect(f.read().events.filter(row => row.type === 'promoted')).toHaveLength(1)
    expect(survivingOutcomeEvents(f.read().events).filter(row => row.type === 'promoted')).toHaveLength(1)
    expect(readGateReceipts(f.seeded.dir, f.seeded.id)!.at(-1)).toMatchObject({ promotionPath: 'gate1+gate2' })
    expect(f.replay).not.toHaveBeenCalled()
  })
})
