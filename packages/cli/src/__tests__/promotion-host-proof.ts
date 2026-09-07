// A real eval identity plus planted bundle DATA proves each caller activates the
// receipts law. The caller's replay capability is preserved and never invoked.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'
import { asEvidenceToken, evaluatePromotionGate, stampReceiptDigest } from '@vostride/agent-qa-schema'
import type { PromotionPostureCandidate, ResolvePromotionPosture } from '@vostride/agent-qa-schema'
import { buildPromotionPostureResolver } from '../curation/promotion-posture.js'
const realBuild = buildPromotionPostureResolver

export function promotionHostProof(configPath: string) {
  const demo = fileURLToPath(new URL('../../../../../demo/init/agent-qa-eval/', import.meta.url))
  const root = join(dirname(configPath), 'agent-qa-eval')
  mkdirSync(join(root, 'reports/noise-floor'), { recursive: true })
  cpSync(join(demo, 'corpus'), join(root, 'corpus'), { recursive: true })
  const floorName = readdirSync(join(demo, 'reports/noise-floor'))[0]!
  const floor = JSON.parse(readFileSync(join(demo, 'reports/noise-floor', floorName), 'utf8'))
  floor.minimumGateSet = floor.products['example-web'].minimumGateSet
  writeFileSync(join(root, 'reports/noise-floor', floorName), JSON.stringify(floor))
  writeFileSync(configPath, JSON.stringify({
    workspace: { testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local' },
    knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
    registry: { llms: [{ name: 'planner', provider: 'openai-subscription', model: 'gpt-5.6-terra' }] },
    use: { llm: 'planner', mobile: { appState: 'preserve' } },
  }))
  const candidate: PromotionPostureCandidate = { id: 'host-receipt-proof', product: 'example-web',
    scope: { tier: 'product', key: 'example-web' },
    provenance: { runIds: ['run-that-matches-no-entry'], receiptDigests: [], capturedAtOrdinals: [9999] } }
  let prepared: Awaited<ReturnType<typeof buildPromotionPostureResolver>> | undefined
  const replayCalls = vi.fn(() => { throw new Error('replay execution forbidden during preparation') })
  const prepare = async (input: Parameters<typeof buildPromotionPostureResolver>[0]) => {
    expect(input.replayGate).toBeDefined()
    vi.spyOn(input.replayGate!, 'runReplayGate').mockImplementation(replayCalls)
    prepared = await realBuild({ ...input,
      currentBuildOrdinal: 15,
      canaryFacts: () => ({ kind: 'found', gate1PassOrdinal: 10, activeInScope: 1, lowerTrustActiveInScope: 0 }),
      lowerTrustShares: () => [],
    })
    return prepared
  }
  const verify = (resolvePosture: ResolvePromotionPosture) => {
    if (prepared?.kind !== 'ready') throw new Error(`host identity refused: ${JSON.stringify(prepared)}`)
    const posture = resolvePosture(candidate)
    const score = { baseline: 0, candidate: 1, delta: 1, floor: 0.1, n: 3 }
    const receipt = stampReceiptDigest({ schemaVersion: 1, gate: 1, candidateId: candidate.id,
      verdict: 'pass', producedAtOrdinal: 10, producedBy: { opId: 'fixture' },
      perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score, sideEffect: score, loop: score },
      corpusVersion: { corpusDigest: prepared.host.corpusDigest, partitionVersion: 1, gateSetSize: 40, excludedCount: 0, minimumGateSet: 13 },
      samples: { k: 3, seeds: [1, 2, 3], seedHonored: true, modelCalls: 0 }, crossCheck: 'held' })
    const law = { kind: 'caution' as const, status: 'candidate' as const, validityOpen: true,
      anchors: [{ t: 'error' as const, message: 'timeout' }], originClass: 'agent-verified' as const,
      withheld: false, needsEnrichment: false, evidenceIncomplete: false,
      distilledObservations: [{ error: { naturalKey: 'timeout', rootCauseClass: 'timeout' as const } }],
      confirmedOutcomeEvidenceTokens: [asEvidenceToken('earlier-confirmation')],
      hasUserDeprecateInLineage: false, memoryOffForAnchorGroup: false, gatePosture: posture }
    expect(evaluatePromotionGate({ ...law, gateReceipts: [] })).toMatchObject({ verdict: 'hold', reason: 'gate1-receipt-required' })
    expect(evaluatePromotionGate({ ...law, gateReceipts: [receipt] })).toEqual({
      verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [receipt.receiptDigest] })
    expect(replayCalls).not.toHaveBeenCalled()
  }
  return { prepare, verify }
}
