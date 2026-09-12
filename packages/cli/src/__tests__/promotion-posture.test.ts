import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReplayGatePort } from '@vostride/agent-qa-agent'
import { createReplayGatePortForHost } from '../gates/replay-gate-host.js'
import type { PromotionPostureCandidate, ResolvePromotionPosture } from '@vostride/agent-qa-schema'
import { asEvidenceToken, evaluatePromotionGate, stampReceiptDigest } from '@vostride/agent-qa-schema'
import { latestBuildOrdinal, LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import { acquireWriterLease, appendGateReceipt, buildGateInconsistencyProposal,
  createLocalKnowledgeStore, deriveBundleTrust, fileGateInconsistencyProposal, loadBundle,
  proposalsDir, publishBundleForTest, rejectPendingProposal } from '@vostride/agent-qa-knowledge-local'
import { readCommittedCorpus, readGatePostureFor } from '@vostride/agent-qa-eval-local'
import { createPanelIdentity } from '@vostride/agent-qa-eval'
import { resolveEvalSession, resolveGateProfileIdentity } from '../eval-session-composition.js'

vi.mock('@vostride/agent-qa-eval-local', async importOriginal => {
  const actual = await importOriginal<typeof import('@vostride/agent-qa-eval-local')>()
  return { ...actual, readGatePostureFor: vi.fn(actual.readGatePostureFor) }
})

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir) }
})
vi.mock('../llm-utils.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../llm-utils.js')>()
  return { ...actual, resolveModelAuth: vi.fn(() => { throw new Error('credential resolution forbidden') }) }
})

// Keep discovery valid during RED: the missing builder must fail a behavior assertion,
// rather than aborting the suite with an unresolved-module error.
const subjectPath = fileURLToPath(new URL('../curation/promotion-posture.ts', import.meta.url))
const subject = existsSync(subjectPath) ? await import(subjectPath) : undefined
const demo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../demo/init')
const roots: string[] = []
const candidate: PromotionPostureCandidate = {
  id: 'candidate-posture', product: 'example-web', scope: { tier: 'product', key: 'example-web' },
  provenance: { runIds: ['run-that-matches-no-entry'], receiptDigests: [], capturedAtOrdinals: [9999] },
}
const floorName = readdirSync(join(demo, 'agent-qa-eval/reports/noise-floor'))[0]
const floor = JSON.parse(readFileSync(join(demo, 'agent-qa-eval/reports/noise-floor', floorName), 'utf8'))
const workspace = `workspace:
  testMatch: [tests/**/*.yaml]
  suiteMatch: [suites/**/*.suite.yaml]
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local
`
const config = `${workspace}
registry:
  llms:
    - name: planner
      provider: openai-subscription
      model: gpt-5.6-terra
use:
  llm: planner
  mobile:
    appState: preserve
`

function fixture(options: { root?: boolean; floor?: boolean; config?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-qa-posture-'))
  roots.push(dir)
  const configPath = join(dir, 'agent-qa.config.yaml')
  writeFileSync(configPath, options.config ?? config)
  const committedRoot = join(dir, 'agent-qa-eval')
  if (options.root !== false) mkdirSync(committedRoot)
  if (options.floor) {
    mkdirSync(join(committedRoot, 'reports/noise-floor'), { recursive: true })
    writeFileSync(join(committedRoot, 'reports/noise-floor', floorName), JSON.stringify(floor))
  }
  return { dir, configPath, committedRoot }
}

async function build(configPath: string, replayGate?: ReplayGatePort) {
  return subject?.buildPromotionPostureResolver({ configPath, ...(replayGate ? { replayGate } : {}) })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('buildPromotionPostureResolver', () => {
  it.each([false, true])('421 preserves panel facts with a missing floor or ready posture (floor: %s)', async hasFloor => {
    const panelConfig = config.replace('use:\n', `    - name: judge-a\n      provider: openai-compatible\n      baseURL: http://127.0.0.1:1/v1\n      model: claude-fixture\n    - name: judge-b\n      provider: openai-compatible\n      baseURL: http://127.0.0.1:1/v1\n      model: gpt-judge\nuse:\n`)
      + '\neval:\n  judges: [judge-b, judge-a]\n  judgeAllowSameFamily: true\n'
    const f = fixture({ config: panelConfig })
    const identity = await resolveGateProfileIdentity(await resolveEvalSession({ configPath: f.configPath, keyOnly: true }))
    if (hasFloor) {
      mkdirSync(join(f.committedRoot, 'reports/noise-floor'), { recursive: true })
      writeFileSync(join(f.committedRoot, 'reports/noise-floor', floorName), JSON.stringify({ ...floor, profileKey: identity.profileKey }))
    }
    const result = await build(f.configPath)
    expect(result?.kind).toBe(hasFloor ? 'ready' : 'unavailable')
    const panel = createPanelIdentity(['claude-fixture', 'gpt-judge'])
    const expected = { capable: false, reason: 'no-eligible-judge', judgeModelId: panel.judgeModelId,
      panelSize: 2, members: panel.members,
      families: { members: panel.members, replayed: 'openai', offendingPair: ['gpt-judge', 'gpt-5.6-terra'] } }
    expect(result.kind === 'ready' ? result.host.judge : result.judge).toMatchObject(expected)
    expect(result.resolve(candidate)).toMatchObject({ kind: hasFloor ? 'resolved' : 'unavailable', judge: expected })
    if (hasFloor) {
      rmSync(join(f.committedRoot, 'reports/noise-floor', floorName))
      expect(result.resolve(candidate)).toMatchObject({ kind: 'unavailable', judge: expected })
    }
  })

  async function rarePath(options: {
    now?: number | ((product: string) => number | undefined)
    facts?: Record<string, number>
    gate2Config?: string
  } = {}) {
    const f = fixture({ floor: true, config: config + (options.gate2Config ?? '') })
    cpSync(join(demo, 'agent-qa-eval/corpus'), join(f.committedRoot, 'corpus'), { recursive: true })
    const value = structuredClone(floor)
    value.minimumGateSet = value.products['example-web'].minimumGateSet
    writeFileSync(join(f.committedRoot, 'reports/noise-floor', floorName), JSON.stringify(value))
    const facts = { kind: 'found' as const, gate1PassOrdinal: 10, activeInScope: 3,
      lowerTrustActiveInScope: 1, ...options.facts }
    const canaryFacts = vi.fn(() => facts)
    const lowerTrustShares = vi.fn(() => [{ product: 'example-web', active: 3, lowerTrust: 1 }])
    const result = await subject!.buildPromotionPostureResolver({ configPath: f.configPath,
      replayGate: { runReplayGate: vi.fn() }, knowledgeRoot: join(f.dir, 'knowledge'),
      currentBuildOrdinal: options.now, canaryFacts, lowerTrustShares,
    })
    if (result.kind !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`)
    const gate = (posture = result.resolve(candidate)) => {
      const score = { baseline: 0, candidate: 1, delta: 1, floor: 0.1, n: 3 }
      const receipt = stampReceiptDigest({ schemaVersion: 1, gate: 1, candidateId: candidate.id,
        verdict: 'pass', producedAtOrdinal: facts.gate1PassOrdinal, producedBy: { opId: 'fixture' },
        perAxisScore: { headline: score, elementIdentity: score, value: score, opClass: score, sideEffect: score, loop: score },
        corpusVersion: { corpusDigest: result.host.corpusDigest, partitionVersion: 1, gateSetSize: 40, excludedCount: 0, minimumGateSet: 13 },
        samples: { k: 3, seeds: [1, 2, 3], seedHonored: true, modelCalls: 0 }, crossCheck: 'held',
      })
      return { receipt, verdict: evaluatePromotionGate({ kind: 'caution', status: 'candidate',
        validityOpen: true, anchors: [{ t: 'error', message: 'timeout' }], originClass: 'agent-verified',
        withheld: false, needsEnrichment: false, evidenceIncomplete: false,
        distilledObservations: [{ error: { naturalKey: 'timeout', rootCauseClass: 'timeout' } }],
        confirmedOutcomeEvidenceTokens: [asEvidenceToken('earlier-confirmation')],
        hasUserDeprecateInLineage: false, memoryOffForAnchorGroup: false,
        gatePosture: posture, gateReceipts: [receipt],
      }) }
    }
    return { ...f, result, gate, facts, canaryFacts }
  }

  it('418 quiet horizon and cap room promote gate1-lower-trust citing the Gate-1 digest', async () => {
    const f = await rarePath({ now: 15 })
    expect(f.result.resolve(candidate)).toMatchObject({ canary: { kind: 'provided', rarePathEligible: true } })
    const { verdict, receipt } = f.gate()
    expect(verdict).toEqual({ verdict: 'promote', promotionPath: 'gate1-lower-trust', citedReceiptDigests: [receipt.receiptDigest] })
    expect(f.canaryFacts).toHaveBeenCalledWith({ knowledgeRoot: join(f.dir, 'knowledge'), candidateId: candidate.id, scope: candidate.scope })
    expect(f.result.host).toMatchObject({ lowerTrustShares: [{ product: 'example-web', active: 3, lowerTrust: 1 }],
      canaryHorizonBuilds: 5, canaryHorizonBuildsSource: 'default',
      maxLowerTrustPerScope: 2, maxLowerTrustPerScopeSource: 'default', notices: [] })
    // Live cap reads: a previous promotion in this same drain consumes the final slot.
    f.facts.lowerTrustActiveInScope = 2
    expect(f.gate().verdict).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
  })

  it('418 real pending and claimed review holds clean newer receipts until rejected, then promotes', async () => {
    const f = await rarePath({ now: 15 })
    const knowledgeRoot = join(f.dir, 'knowledge')
    const agentQaRoot = join(f.dir, '.agent-qa')
    const appendConfig = { knowledgeRoot, auditBaseDir: agentQaRoot, productKey: candidate.product,
      commitArtifacts: 'none' as const, writerLeaseId: 'fixture' }
    const anchor = { t: 'el' as const, role: 'button', name: 'Checkout', ordinal: 0 }
    const seeded = publishBundleForTest(appendConfig, {
      draft: { kind: 'fact', subtype: 'selector', scope: candidate.scope, anchors: [anchor],
        summary: 'Checkout selector', body: 'The checkout button is verified.', originStage: 'run-curation',
        distilledEvidenceRef: { id: 'checkout', sha: 'a'.repeat(64) } },
      discriminant: { kind: 'fact', subtype: 'selector', elementRef: { role: 'button', name: 'Checkout' } },
      originClass: 'agent-verified', createdAtOrdinal: 1, screenStates: [], relations: [], artifacts: [],
      initialEvents: [{ type: 'confirmed', evidenceToken: asEvidenceToken('confirm-checkout'),
        curationJobId: 'confirm-checkout', buildOrdinal: 1 }],
      provenance: { mode: 'run-linked', runId: 'seed-checkout', testId: 'seed-checkout', stepIndex: 0,
        curationJobId: 'seed-checkout', sourceBuildOrdinal: 1 }, evidenceMarkdown: 'Verified selector.\n',
      distilledObservations: [{ schemaVersion: 1, step: { naturalKey: 'checkout', ordinal: 0 }, platform: 'web',
        element: { naturalKey: 'button:checkout:0' }, observedAtOrdinal: 1 }],
    })
    if (seeded.kind !== 'published') throw new Error(seeded.kind)
    const { receiptDigest: _digest, ...body } = f.gate().receipt
    const g1 = stampReceiptDigest({ ...body, candidateId: seeded.id })
    const g2 = stampReceiptDigest({ schemaVersion: 1, gate: 2, candidateId: seeded.id,
      verdict: 'fail', producedAtOrdinal: 11, producedBy: { opId: 'fixture' },
      corpusVersion: { corpusDigest: f.result.host.corpusDigest }, attributedObservationId: 'first-harm',
      benefit: 'exercised-harmed', stateValidity: 'valid' })
    appendGateReceipt(appendConfig, seeded.id, g1)
    appendGateReceipt(appendConfig, seeded.id, g2)
    const proposal = buildGateInconsistencyProposal({ candidateId: seeded.id, scope: candidate.scope,
      shape: 'gate1-pass-gate2-fail', gate1Digest: g1.receiptDigest, gate2Digest: g2.receiptDigest, proposedAt: 10 })
    fileGateInconsistencyProposal(agentQaRoot, proposal, { at: 10 })
    const replay = vi.fn(() => { throw new Error('automatic replay forbidden') })
    const resolved = await subject!.buildPromotionPostureResolver({ configPath: f.configPath,
      knowledgeRoot, agentQaRoot, currentBuildOrdinal: 15, replayGate: { runReplayGate: replay },
      canaryFacts: LOCAL_CURATION_CAPABILITIES.readCanaryPostureFacts,
      lowerTrustShares: LOCAL_CURATION_CAPABILITIES.readLowerTrustShares })
    if (resolved.kind !== 'ready') throw new Error(resolved.kind)
    const currentCandidate = { ...candidate, id: seeded.id }
    const lease = acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') throw new Error(lease.kind)
    const store = createLocalKnowledgeStore({ knowledgeRoot, auditBaseDir: agentQaRoot,
      writerLeaseId: lease.leaseId, epoch: lease.epoch, executionContext: 'local-interactive',
      sourceBuildOrdinal: 15, resolvePromotionPosture: resolved.resolve })
    const { receiptDigest: _old, ...g2body } = g2
    await store.recordGateReceipt(stampReceiptDigest({ ...body, candidateId: seeded.id, producedAtOrdinal: 12 }))
    await store.recordGateReceipt(stampReceiptDigest({ ...g2body, producedAtOrdinal: 13,
      verdict: 'pass', benefit: 'exercised-benefited', attributedObservationId: 'new-clean-benefit' }))
    const holds = async () => {
      expect(resolved.resolve(currentCandidate)).toMatchObject({ canary: { rarePathEligible: false,
        inconsistency: { pending: true, proposalId: proposal.proposalId } } })
      await expect(store.promote(seeded.id)).rejects.toMatchObject({ reason: 'gate-inconsistent' })
    }
    await holds()
    // The storage suite drives claimPendingProposal itself and its read interleaves;
    // this package exercises the same durable names without importing writer internals.
    const pendingPath = join(proposalsDir(agentQaRoot), `${proposal.proposalId}.json`)
    const claimedPath = `${pendingPath}.claimed.${process.pid}`
    renameSync(pendingPath, claimedPath)
    await holds()
    renameSync(claimedPath, pendingPath)
    await holds()
    rejectPendingProposal(agentQaRoot, proposal.proposalId, { at: 20 })
    expect(resolved.resolve(currentCandidate)).not.toHaveProperty('canary.inconsistency')
    await expect(store.promote(seeded.id)).resolves.toMatchObject({ promotionPath: 'gate1+gate2' })
    const loaded = loadBundle(seeded.dir)
    if (loaded.kind !== 'loaded') throw new Error(loaded.kind)
    expect(deriveBundleTrust(loaded.bundle).status).toBe('active')
    expect(replay).not.toHaveBeenCalled()
    // A corrupt pending record must become unavailable, never a cleared flag.
    writeFileSync(join(proposalsDir(agentQaRoot), 'prop_corrupt.json'), '{bad')
    expect(resolved.resolve(currentCandidate)).toMatchObject({ kind: 'unavailable' })
  })

  it.each([
    ['short horizon', 14, {}], ['attribution', 15, { latestAttributionOrdinal: 12 }],
    ['Gate-2 abstain', 15, { latestGate2Ordinal: 11 }], ['cap full', 15, { lowerTrustActiveInScope: 2 }],
    ['old candidate with fresh Gate-1', 15, { gate1PassOrdinal: 14 }],
  ] as const)('418 holds %s', async (_name, now, facts) => {
    const f = await rarePath({ now, facts })
    expect(f.result.resolve(candidate)).toMatchObject({ canary: { rarePathEligible: false } })
    expect(f.gate().verdict).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
  })

  it.each([undefined, 0, -1, NaN, Infinity, 1.5])('418 discloses absent or invalid now %s', async now => {
    const f = await rarePath({ now })
    expect(f.result.resolve(candidate)).toMatchObject({ canary: { rarePathEligible: false } })
    expect(f.result.host.notices).toContain('no-current-build-ordinal')
    const warn = vi.fn()
    subject!.promotionPostureResolverForHost(f.result, warn)?.(candidate)
    expect(warn).toHaveBeenCalledWith('curation: no-current-build-ordinal')
  })

  it('418 resolves config source words and refuses fact-read errors', async () => {
    const f = await rarePath({ now: 15, gate2Config: '\neval:\n  gate2:\n    canaryHorizonBuilds: 6\n    maxLowerTrustPerScope: 3\n' })
    expect(f.result.host).toMatchObject({ canaryHorizonBuilds: 6, canaryHorizonBuildsSource: 'config',
      maxLowerTrustPerScope: 3, maxLowerTrustPerScopeSource: 'config' })
    expect(f.gate().verdict).toEqual({ verdict: 'hold', reason: 'gate2-receipt-required' })
    f.canaryFacts.mockImplementationOnce(() => { throw new Error('corrupt bundle') })
    expect(f.result.resolve(candidate)).toMatchObject({ kind: 'unavailable', refusals: ['corrupt bundle'] })
  })

  it('418 binds each run ordinal and reads latest recorded now per candidate product', async () => {
    const f = await rarePath({ now: product => latestBuildOrdinal({ root: runtime, product }) })
    const runtime = join(f.dir, '.agent-qa')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'build-ordinals.json'), JSON.stringify({ 'example-web': 15, second: 14 }))
    expect(f.result.resolve(candidate)).toMatchObject({ canary: { rarePathEligible: true } })
    expect(f.result.resolve({ ...candidate, product: 'second' })).toMatchObject({ canary: { rarePathEligible: false } })
    expect(f.result.resolve({ ...candidate, product: 'absent' })).toMatchObject({ canary: { rarePathEligible: false } })
    expect(f.result.host.notices).toContain('no-current-build-ordinal')
    const run14 = subject!.promotionPostureResolverForHost(f.result, undefined, 14, 'example-web')!
    const run15 = subject!.promotionPostureResolverForHost(f.result, undefined, 15, 'example-web')!
    expect(run14(candidate)).toMatchObject({ canary: { rarePathEligible: false } })
    expect(run15(candidate)).toMatchObject({ canary: { rarePathEligible: true } })
    expect(run14(candidate)).toMatchObject({ canary: { rarePathEligible: false } })
    // One drain can claim both products. The same-product handoff wins over latest,
    // while a foreign candidate uses its own latest recorded ordinal (14), not 15.
    expect(run15({ ...candidate, product: 'second' })).toMatchObject({ canary: { rarePathEligible: false } })
    expect(run15({ ...candidate, product: 'absent' })).toMatchObject({ canary: { rarePathEligible: false } })
    expect(f.result.host.notices).toContain('no-current-build-ordinal')
  })

  it('417 binds the production port with a floor and still holds a present broken root', async () => {
    for (const hasFloor of [true, false]) {
      const f = fixture({ floor: hasFloor })
      const result = await build(f.configPath, createReplayGatePortForHost({ configPath: f.configPath, agentQaRoot: join(f.dir, '.agent-qa') }))
      expect(result?.kind).toBe(hasFloor ? 'ready' : 'unavailable')
      if (hasFloor) expect(result.host.replayGateAvailable).toBe(true)
      expect(result.resolve(candidate)).toMatchObject({ kind: hasFloor ? 'resolved' : 'unavailable', replayGateAvailable: true })
    }
  })

  it('417 leaves the absent-root BYOM floor identical and never invokes the bound port', async () => {
    const f = fixture({ root: false, config: 'broken: [yaml' })
    const runReplayGate = vi.fn()
    expect(await build(f.configPath, { runReplayGate })).toEqual(await build(f.configPath))
    expect(runReplayGate).not.toHaveBeenCalled()
  })

  it('D-12 absent eval root returns no-eval-root without reading invalid config', async () => {
    const f = fixture({ root: false, config: 'broken: [yaml' })
    expect(await build(f.configPath)).toEqual({ kind: 'no-eval-root', committedRoot: f.committedRoot })
  })

  it('D-12 present root without a measured floor is unavailable with the exact profile refusal', async () => {
    const f = fixture()
    const result = await build(f.configPath)
    expect(result?.kind).toBe('unavailable')
    expect(result.refusals).toEqual([`noise-floor: no artefact for profile ${floor.profileKey}`])
    expect(result.resolve(candidate)).toEqual({ kind: 'unavailable', replayGateAvailable: false, refusals: result.refusals })
  })

  it('D-12 present root with a valueless floor names the refused path', async () => {
    const f = fixture({ floor: true })
    const path = join(f.committedRoot, 'reports/noise-floor', floorName)
    const value = structuredClone(floor)
    delete value.minimumGateSet.value
    writeFileSync(path, JSON.stringify(value))
    const result = await build(f.configPath)
    expect(result?.kind).toBe('unavailable')
    expect(result.refusals.join('\n')).toContain(path)
  })

  it('D-12 refuses invalid committed manifests at build and candidate resolution', async () => {
    const f = fixture({ floor: true })
    cpSync(join(demo, 'agent-qa-eval/contracts'), join(f.committedRoot, 'contracts'), { recursive: true })
    const manifest = readdirSync(join(f.committedRoot, 'contracts')).find(name => name.startsWith('partition-'))!
    const path = join(f.committedRoot, 'contracts', manifest)
    writeFileSync(path, '{ invalid')
    const result = await build(f.configPath)
    expect(result?.kind).toBe('unavailable')
    expect(result.refusals.join('\n')).toContain(path)
    expect(result.resolve(candidate).refusals).toEqual(result.refusals)
  })

  it('D-12 unresolvable identity is unavailable rather than the floor', async () => {
    const f = fixture({ config: `${workspace}\nuse:\n  mobile:\n    appState: preserve\neval: {}\n` })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('unavailable')
    expect(result.refusals.join('\n')).toContain('use.llm is not set')
  })

  it('D-10 demo/init exposes measured host facts and synchronous per-candidate selection', async () => {
    const result = await build(join(demo, 'agent-qa.config.yaml'))
    expect(result?.kind).toBe('ready')
    expect(result.host.minimumGateSet).toBe(63)
    expect(result.host.profileKey).toBe(floor.profileKey)
    expect(result.host.replayGateAvailable).toBe(false)
    expect(result.host.judge.reason).toBe('no-judge-configured')
    expect(result.host.canary).toEqual({ kind: 'not-provided', rarePathEligible: false })
    expect(result.host.corpusDigest).toMatch(/^[a-f0-9]{64}$/)
    const entries = readCommittedCorpus(join(demo, 'agent-qa-eval')).snapshot.entries
    const product = 'example-web'
    const resolvePosture: ResolvePromotionPosture = result.resolve
    const posture = resolvePosture({ ...candidate, product, scope: { tier: 'product', key: product } })
    expect(typeof posture).toBe('object')
    expect(posture).not.toBeInstanceOf(Promise)
    // The committed aggregate floor is 79; example-web has only 56 entries (422-25 admitted 16).
    expect(posture).toMatchObject({ kind: 'resolved', gateSetVerdict: 'empty-gate-set', gateSetNonEmpty: false, scope: { resolution: 'product-key' }, counts: { excludedCount: 0, natural: 34, heldOutShared: 2, heldOutPrivate: 4, adversarial: 16, remaining: { before: { natural: 34 } } } })
    expect(resolvePosture({ ...candidate, provenance: { runIds: [], receiptDigests: [], capturedAtOrdinals: [] } })).toMatchObject({ gateSetVerdict: 'unprovenanced-candidate', gateSetNonEmpty: false })
    expect(resolvePosture({ ...candidate, scope: { tier: 'test', key: 'test-scope' } })).toMatchObject({ scope: { resolution: 'default-fallback' } })
    expect(resolvePosture({ ...candidate, product, provenance: { ...candidate.provenance, runIds: entries.map(entry => entry.run_links.runId) } })).toMatchObject({ gateSetVerdict: 'empty-gate-set', gateSetNonEmpty: false, counts: { remaining: { after: { natural: 0, heldOutPrivate: 0, heldOutShared: 0, adversarial: 0 } } } })
  })

  it('D-10 a binding flips availability without invoking the replay gate', async () => {
    const runReplayGate = vi.fn(async () => { throw new Error('planted model call') })
    const result = await build(join(demo, 'agent-qa.config.yaml'), { runReplayGate })
    expect(result?.kind).toBe('ready')
    expect(result.host.replayGateAvailable).toBe(true)
    expect(result.resolve(candidate).replayGateAvailable).toBe(true)
    expect(runReplayGate).not.toHaveBeenCalled()
  })

  it('selects an ok gate set from an independent corpus with a measured product floor', async () => {
    const f = fixture({ floor: true })
    cpSync(join(demo, 'agent-qa-eval/corpus'), join(f.committedRoot, 'corpus'), { recursive: true })
    const value = structuredClone(floor)
    value.minimumGateSet = value.products['example-web'].minimumGateSet
    writeFileSync(join(f.committedRoot, 'reports/noise-floor', floorName), JSON.stringify(value))
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    const before = result.resolve(candidate)
    expect(before).toMatchObject({ kind: 'resolved', gateSetVerdict: 'ok', gateSetNonEmpty: true })
    const excluding = { ...candidate, provenance: { ...candidate.provenance,
      runIds: readCommittedCorpus(f.committedRoot).snapshot.entries.map(entry => entry.run_links.runId) } }
    const excludedBefore = result.resolve(excluding)
    expect(excludedBefore).toMatchObject({ gateSetVerdict: 'empty-gate-set', counts: { excludedCount: 56 } })
    rmSync(join(f.committedRoot, 'corpus'), { recursive: true })
    const after = result.resolve(candidate)
    expect(after).toMatchObject({ kind: 'resolved', gateSetVerdict: 'empty-gate-set', gateSetNonEmpty: false, counts: { natural: 0, excludedCount: 0, remaining: { after: { natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 } } } })
    expect(after.corpusDigest).not.toBe(before.corpusDigest)
    expect(result.resolve(excluding)).toMatchObject({ corpusDigest: after.corpusDigest,
      counts: { excludedCount: 0, natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 } })
  })

  it.each(['deleted', 'malformed', 'valueless'] as const)('rechecks a %s floor and recovers when it is repaired', async defect => {
    const f = fixture({ floor: true })
    const path = join(f.committedRoot, 'reports/noise-floor', floorName)
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    if (defect === 'deleted') rmSync(path)
    else if (defect === 'malformed') writeFileSync(path, '{ invalid')
    else {
      const value = structuredClone(floor)
      delete value.minimumGateSet.value
      writeFileSync(path, JSON.stringify(value))
    }
    expect(result.resolve(candidate)).toEqual({
      kind: 'unavailable', replayGateAvailable: false,
      refusals: [defect === 'valueless'
        ? `noise-floor: no minimumGateSet value at ${path}`
        : `noise-floor: no artefact for profile ${floor.profileKey}`],
    })
    writeFileSync(path, JSON.stringify(floor))
    expect(result.resolve(candidate)).toMatchObject({ kind: 'resolved', minimumGateSet: 63 })
  })

  it('uses the current measured floor for both selection and disclosure', async () => {
    const f = fixture({ floor: true })
    cpSync(join(demo, 'agent-qa-eval/corpus'), join(f.committedRoot, 'corpus'), { recursive: true })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    expect(result.resolve(candidate)).toMatchObject({ minimumGateSet: 63, gateSetVerdict: 'empty-gate-set' })
    const value = structuredClone(floor)
    value.minimumGateSet = value.products['example-web'].minimumGateSet
    writeFileSync(join(f.committedRoot, 'reports/noise-floor', floorName), JSON.stringify(value))
    expect(result.resolve(candidate)).toMatchObject({
      kind: 'resolved', minimumGateSet: 13, gateSetVerdict: 'ok', gateSetNonEmpty: true,
    })
  })

  it('tracks root removal and refuses an empty replacement through a retained ready resolver', async () => {
    const f = fixture({ floor: true })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    rmSync(f.committedRoot, { recursive: true })
    expect(result.resolve(candidate)).toBeUndefined()
    mkdirSync(f.committedRoot)
    expect(result.resolve(candidate)).toMatchObject({ kind: 'unavailable' })
  })

  it('refuses a newly present root until an absent-root host prepares fresh posture', async () => {
    const f = fixture({ root: false })
    const result = await build(f.configPath)
    const warn = vi.fn()
    const resolvePosture = subject!.promotionPostureResolverForHost(result, warn)
    expect(resolvePosture?.(candidate)).toBeUndefined()
    mkdirSync(f.committedRoot)
    const posture = resolvePosture?.(candidate)
    expect(posture).toMatchObject({ kind: 'unavailable', replayGateAvailable: false })
    expect(warn).toHaveBeenCalledWith(`curation: ${candidate.id} posture unavailable: ${posture.refusals.join('; ')}`)
    rmSync(f.committedRoot, { recursive: true })
    expect(resolvePosture?.(candidate)).toBeUndefined()
  })

  it('fails closed when the measured floor changes during candidate resolution', async () => {
    const f = fixture({ floor: true })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    const read = vi.mocked(readGatePostureFor).getMockImplementation()!
    vi.mocked(readGatePostureFor).mockImplementationOnce(input => {
      const posture = read(input)
      const value = structuredClone(floor)
      value.minimumGateSet = value.products['example-web'].minimumGateSet
      writeFileSync(join(f.committedRoot, 'reports/noise-floor', floorName), JSON.stringify(value))
      return posture
    })
    expect(result.resolve(candidate)).toEqual({ kind: 'unavailable', replayGateAvailable: false,
      refusals: [`${f.committedRoot}: noise floor changed during posture resolution`] })
  })

  it('T-416-15 reads identity without secrets, auth state, provider credentials or model resolution', async () => {
    const f = fixture({ floor: true })
    const fs = await import('node:fs/promises')
    const reads = vi.mocked(fs.readFile)
    reads.mockClear()
    vi.mocked(fs.readdir).mockClear()
    const llm = await import('../llm-utils.js')
    const auth = vi.mocked(llm.resolveModelAuth)
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    expect(auth).not.toHaveBeenCalled()
    expect(reads.mock.calls.map(call => String(call[0])).filter(path => path.includes('.env') || path.includes('auth-states'))).toEqual([])
    expect(vi.mocked(fs.readdir).mock.calls.map(call => String(call[0])).filter(path => path.includes('auth-states'))).toEqual([])
  })

  it('discloses a candidate-time refusal after a ready host without losing its rows', async () => {
    const f = fixture({ floor: true })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    const warn = vi.fn()
    const resolvePosture = subject!.promotionPostureResolverForHost(result, warn)
    mkdirSync(join(f.committedRoot, 'contracts'))
    const path = join(f.committedRoot, 'contracts/partition-example-web.json')
    writeFileSync(path, '{ invalid')
    const posture = resolvePosture(candidate)
    expect(posture.kind).toBe('unavailable')
    expect(posture.refusals.join('; ')).toContain(path)
    expect(warn).toHaveBeenCalledWith(`curation: ${candidate.id} posture unavailable: ${posture.refusals.join('; ')}`)
  })

  it('fails closed if posture and selection observe different corpus snapshots', async () => {
    const f = fixture({ floor: true })
    const result = await build(f.configPath)
    expect(result?.kind).toBe('ready')
    const read = readGatePostureFor({ committedRoot: f.committedRoot, scope: candidate.scope,
      minimumGateSet: floor.minimumGateSet.value, judge: { plannerModelId: floor.plannerModelId },
      canary: { kind: 'not-provided' } })
    vi.mocked(readGatePostureFor).mockReturnValueOnce({ ...read, posture: { ...read.posture, corpusDigest: 'f'.repeat(64) } })
    expect(result.resolve(candidate)).toEqual({ kind: 'unavailable', replayGateAvailable: false,
      refusals: [`${f.committedRoot}: corpus changed during posture resolution`] })
  })
})
