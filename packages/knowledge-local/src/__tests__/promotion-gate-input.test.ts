import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asEvidenceToken, canonicalJson, type ResolvePromotionPosture, type ResolvedPromotionGatePosture } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendGateReceipt, appendOutcomeEvent, appendPromotionReceipt } from '../bundle-append.js'
import { loadBundle, readGateReceipts } from '../bundle-read.js'
import { publishBundle as publishBundleForTest } from '../bundle-publish.test-helper.js'
import { assemblePromotionGateInput } from '../promotion-gate-input.js'
import { gateReceiptsFor } from '../gates/gate-receipt-read.js'
import { completeGate1Receipt, createPromotionFloorFixture } from '../curator/__tests__/fixtures/promotion-floor-fixture.js'

const posture: ResolvedPromotionGatePosture = {
  kind: 'resolved', replayGateAvailable: true, gateSetNonEmpty: true, gateSetVerdict: 'ok',
  corpusDigest: 'c'.repeat(64), minimumGateSet: 1,
  counts: { natural: 1, heldOutShared: 1, heldOutPrivate: 0, adversarial: 0, excludedCount: 0 },
  scope: { partition: 'storefront', resolution: 'product-key' },
  judge: { capable: true, reason: 'eligible' },
  canary: { kind: 'not-provided', rarePathEligible: false },
}

describe('416 D-09 D-11 shared promotion input', () => {
  let root: string
  let fixture: ReturnType<typeof createPromotionFloorFixture>
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), '416-promotion-input-'))
    fixture = createPromotionFloorFixture({ knowledgeRoot: join(root, 'knowledge'), auditBaseDir: join(root, 'audit') })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  function assemble(bundleDir: string, resolvePromotionPosture?: ResolvePromotionPosture) {
    const loaded = loadBundle(bundleDir)
    if (loaded.kind !== 'loaded') throw new Error(`load failed: ${loaded.kind}`)
    return assemblePromotionGateInput({ knowledgeRoot: fixture.outcomeAppendConfig().knowledgeRoot,
      bundleDir, bundle: loaded.bundle, resolvePromotionPosture })
  }
  it('assembles an empty receipt list and omits an absent posture key', () => {
    const { published } = fixture.publishHeldCandidate('absent')
    const input = assemble(published.dir)
    expect(input.gateReceipts).toEqual([])
    expect(input).not.toHaveProperty('gatePosture')
    expect(canonicalJson(input)).not.toContain('gatePosture')
  })
  it('calls the resolver once with all receipt digests and sorted unique surviving provenance', () => {
    const { draft, published } = fixture.publishHeldCandidate('provenance')
    const config = fixture.outcomeAppendConfig()
    const g1 = completeGate1Receipt(published.id)
    expect(appendGateReceipt(config, published.id, g1)).toEqual({ kind: 'appended' })
    expect(appendPromotionReceipt(config, published.id, { schemaVersion: 1, kind: 'promotion',
      candidateId: published.id, promotionPath: 'deterministic-verdict-floor', citedReceiptDigests: [],
      producedAtOrdinal: 50, producedBy: { opId: 'test' } })).toEqual({ kind: 'appended' })
    for (const [token, ordinal] of [['later', 45], ['same', 42], ['earlier', 40], ['retracted', 99]] as const) {
      expect(appendOutcomeEvent(config, published.id, { type: 'confirmed', evidenceToken: asEvidenceToken(token),
        curationJobId: token, buildOrdinal: ordinal })).toEqual({ kind: 'appended' })
    }
    expect(appendOutcomeEvent(config, published.id, { type: 'retracted', evidenceToken: asEvidenceToken('rollback'),
      curationJobId: 'rollback', buildOrdinal: 100, retractsEvidenceToken: asEvidenceToken('retracted'),
      retractsCurationJobId: 'retracted', rollbackReceiptId: 'rollback' })).toEqual({ kind: 'appended' })
    const resolver = vi.fn<ResolvePromotionPosture>(() => posture)
    const input = assemble(published.dir, resolver)
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith({ id: published.id, product: 'storefront', scope: draft.scope,
      provenance: { runIds: ['held-checkout-provenance-run'],
        receiptDigests: readGateReceipts(published.dir, published.id)!.map(line => line.receiptDigest),
        capturedAtOrdinals: [40, 42, 45] } })
    expect(input.gateReceipts).toEqual([g1])
    expect(input.gatePosture).toEqual(posture)
  })
  it('calls a resolver for standalone provenance and omits its undefined answer', () => {
    const { draft } = fixture.publishHeldCandidate('template')
    const published = publishBundleForTest(fixture.outcomeAppendConfig(), {
      draft: { ...draft, summary: 'standalone', body: 'standalone evidence' },
      discriminant: { kind: 'fact', subtype: 'selector', elementRef: { role: 'button', name: 'Standalone' } },
      originClass: 'agent-verified', createdAtOrdinal: 9, screenStates: [], initialEvents: [],
      relations: [], provenance: { mode: 'standalone', sourceDescription: 'fixture' }, artifacts: [],
    })
    if (published.kind !== 'published') throw new Error(`publish failed: ${published.kind}`)
    const resolver = vi.fn<ResolvePromotionPosture>(() => undefined)
    expect(assemble(published.dir, resolver)).not.toHaveProperty('gatePosture')
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver.mock.calls[0]![0].provenance).toEqual({ runIds: [], receiptDigests: [], capturedAtOrdinals: [] })
  })
  it('reports the resolved, unavailable and absent posture used for the live verdict', async () => {
    const { draft, published } = fixture.publishHeldCandidate('reader')
    await fixture.promotionStore(43).commit([{ kind: 'Confirm', origin: 'agent', scope: draft.scope,
      citedIds: [published.id], targetId: published.id, evidenceToken: asEvidenceToken('reader-confirm'),
      authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' } }])
    const options = { knowledgeRoot: fixture.outcomeAppendConfig().knowledgeRoot, candidateId: published.id }
    const resolver = vi.fn<ResolvePromotionPosture>(() => posture)
    expect(gateReceiptsFor({ ...options, resolvePromotionPosture: resolver })).toMatchObject({
      posture: 'resolved', live: { verdict: 'hold', reason: 'gate1-receipt-required' },
    })
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(gateReceiptsFor({ ...options, resolvePromotionPosture: () => ({
      kind: 'unavailable', replayGateAvailable: true, refusals: ['no-floor'],
    }) })).toMatchObject({ posture: 'unavailable', live: { verdict: 'hold', reason: 'posture-unavailable' } })
    expect(gateReceiptsFor(options)).toMatchObject({ posture: 'absent', live: { verdict: 'promote' } })
  })
  it('propagates a resolver error instead of silently selecting the floor', () => {
    const { published } = fixture.publishHeldCandidate('throws')
    expect(() => assemble(published.dir, () => { throw new Error('posture read failed') })).toThrow('posture read failed')
  })
})
