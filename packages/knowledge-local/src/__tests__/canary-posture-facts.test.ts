import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asEvidenceToken, stampReceiptDigest } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendGateReceipt, appendOutcomeEvent, appendPromotionReceipt } from '../bundle-append.js'
import { canaryPostureFactsFor, lowerTrustSharesFor, standingReceiptDigestsFor } from '../gates/canary-posture-facts.js'
import { completeGate1Receipt, createPromotionFloorFixture } from '../curator/__tests__/fixtures/promotion-floor-fixture.js'

describe('418 bundle-local canary posture facts', () => {
  let root: string
  let knowledgeRoot: string
  let fixture: ReturnType<typeof createPromotionFloorFixture>
  const scope = { tier: 'product', key: 'storefront' } as const
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), '418-canary-facts-'))
    knowledgeRoot = join(root, 'knowledge')
    fixture = createPromotionFloorFixture({ knowledgeRoot, auditBaseDir: join(root, '.agent-qa') })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  function seed(name = 'quiet') {
    const { published } = fixture.publishHeldCandidate(name)
    const pass = completeGate1Receipt(published.id, { producedAtOrdinal: 10 })
    expect(appendGateReceipt(fixture.outcomeAppendConfig(), published.id, pass)).toEqual({ kind: 'appended' })
    return { ...published, pass }
  }
  const read = (candidateId: string) => canaryPostureFactsFor({ knowledgeRoot, candidateId, scope })
  it('reads the standing pass and corpus digest without inventing attribution', () => {
    const planted = seed()
    expect(read(planted.id)).toEqual({ kind: 'found', gate1PassOrdinal: 10,
      gate1PassDigest: planted.pass.receiptDigest, activeInScope: 0, lowerTrustActiveInScope: 0 })
    expect(standingReceiptDigestsFor({ knowledgeRoot })).toEqual([{ candidateId: planted.id,
      gate: 1, verdict: 'pass', corpusDigest: 'c'.repeat(64), producedAtOrdinal: 10 }])
    expect(read('missing')).toEqual({ kind: 'not-found' })
  })
  it.each(['confirmed', 'contradicted', 'helpful', 'harmful'] as const)('counts surviving %s attribution', type => {
    const planted = seed()
    expect(appendOutcomeEvent(fixture.outcomeAppendConfig(), planted.id, {
      type, evidenceToken: asEvidenceToken('attribution'), curationJobId: 'attribution', buildOrdinal: 12,
    })).toEqual({ kind: 'appended' })
    expect(read(planted.id)).toMatchObject({ latestAttributionOrdinal: 12 })
    appendOutcomeEvent(fixture.outcomeAppendConfig(), planted.id, {
      type: 'retracted', evidenceToken: asEvidenceToken('retraction'), curationJobId: 'retraction',
      buildOrdinal: 13, retractsEvidenceToken: asEvidenceToken('attribution'),
      retractsCurationJobId: 'attribution', rollbackReceiptId: 'rollback',
    })
    expect(read(planted.id)).not.toHaveProperty('latestAttributionOrdinal')
  })
  it('reads all Gate-2 ordinals, including abstains, and never revives a superseded pass', () => {
    const planted = seed()
    appendGateReceipt(fixture.outcomeAppendConfig(), planted.id, stampReceiptDigest({
      schemaVersion: 1, gate: 2, candidateId: planted.id, verdict: 'abstain', producedAtOrdinal: 11,
      producedBy: { opId: 'fixture' }, attributedObservationId: 'observation',
      corpusVersion: { corpusDigest: 'c'.repeat(64) }, benefit: 'rode-along', stateValidity: 'unknown',
    }))
    expect(read(planted.id)).toMatchObject({ latestGate2Ordinal: 11 })
    appendGateReceipt(fixture.outcomeAppendConfig(), planted.id,
      completeGate1Receipt(planted.id, { producedAtOrdinal: 14, verdict: 'fail' }))
    expect(read(planted.id)).not.toHaveProperty('gate1PassOrdinal')
    expect(standingReceiptDigestsFor({ knowledgeRoot }).find(row => row.gate === 1)?.verdict).toBe('fail')
  })
  it('counts active lower-trust records by strongest path and updates after upgrades', () => {
    const first = seed('lower')
    const second = seed('ordinary')
    for (const planted of [first, second]) {
      appendOutcomeEvent(fixture.outcomeAppendConfig(), planted.id, { type: 'promoted',
        evidenceToken: asEvidenceToken(`promoted-${planted.id}`), curationJobId: 'promote', buildOrdinal: 45 })
    }
    appendPromotionReceipt(fixture.outcomeAppendConfig(), first.id, { schemaVersion: 1,
      kind: 'promotion', candidateId: first.id, promotionPath: 'gate1-lower-trust',
      citedReceiptDigests: [first.pass.receiptDigest], producedAtOrdinal: 15, producedBy: { opId: 'fixture' } })
    expect(read(second.id)).toMatchObject({ activeInScope: 2, lowerTrustActiveInScope: 1 })
    expect(read(first.id)).toMatchObject({ lowerTrustActiveGate1Digest: first.pass.receiptDigest })
    expect(read(second.id)).not.toHaveProperty('lowerTrustActiveGate1Digest')
    expect(lowerTrustSharesFor({ knowledgeRoot })).toEqual([{ product: 'storefront', active: 2, lowerTrust: 1 }])
    appendPromotionReceipt(fixture.outcomeAppendConfig(), first.id, { schemaVersion: 1,
      kind: 'promotion', candidateId: first.id, promotionPath: 'gate1+gate2',
      citedReceiptDigests: [first.pass.receiptDigest], producedAtOrdinal: 16, producedBy: { opId: 'fixture' } })
    expect(read(second.id)).toMatchObject({ activeInScope: 2, lowerTrustActiveInScope: 0 })
    expect(read(first.id)).not.toHaveProperty('lowerTrustActiveGate1Digest')
  })
  it('never derives continued authority from a historical promotion after retraction or a changed Gate-1', () => {
    const planted = seed()
    const config = fixture.outcomeAppendConfig()
    appendPromotionReceipt(config, planted.id, { schemaVersion: 1, kind: 'promotion',
      candidateId: planted.id, promotionPath: 'gate1-lower-trust',
      citedReceiptDigests: [planted.pass.receiptDigest], producedAtOrdinal: 45, producedBy: { opId: 'fixture' } })
    expect(read(planted.id)).not.toHaveProperty('lowerTrustActiveGate1Digest')
    appendOutcomeEvent(config, planted.id, { type: 'promoted', evidenceToken: asEvidenceToken('authority'),
      curationJobId: 'authority', buildOrdinal: 45 })
    expect(read(planted.id)).toMatchObject({ lowerTrustActiveGate1Digest: planted.pass.receiptDigest })
    appendOutcomeEvent(config, planted.id, { type: 'retracted', evidenceToken: asEvidenceToken('retract-authority'),
      curationJobId: 'retract-authority', buildOrdinal: 46, retractsEvidenceToken: asEvidenceToken('authority'),
      retractsCurationJobId: 'authority', rollbackReceiptId: 'rollback-authority' })
    expect(read(planted.id)).not.toHaveProperty('lowerTrustActiveGate1Digest')
    appendOutcomeEvent(config, planted.id, { type: 'promoted', evidenceToken: asEvidenceToken('authority-two'),
      curationJobId: 'authority-two', buildOrdinal: 47 })
    appendGateReceipt(config, planted.id, completeGate1Receipt(planted.id, { producedAtOrdinal: 48 }))
    expect(read(planted.id)).not.toHaveProperty('lowerTrustActiveGate1Digest')
  })
  it('refuses mismatched scopes and corrupt evidence instead of undercounting the cap', () => {
    const planted = seed()
    expect(canaryPostureFactsFor({ knowledgeRoot, candidateId: planted.id,
      scope: { tier: 'product', key: 'foreign' } })).toEqual({ kind: 'not-found' })
    writeFileSync(join(planted.dir, 'evidence/outcomes.jsonl'), '{bad}\n')
    expect(() => read(planted.id)).toThrow()
    expect(() => lowerTrustSharesFor({ knowledgeRoot })).toThrow()
    expect(() => standingReceiptDigestsFor({ knowledgeRoot })).toThrow()
  })
})
