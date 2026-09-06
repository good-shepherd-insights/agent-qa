import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReplayGatePort } from '@vostride/agent-qa-agent'
import type { PromotionPostureCandidate, ResolvePromotionPosture } from '@vostride/agent-qa-schema'
import { readCommittedCorpus, readGatePostureFor } from '@vostride/agent-qa-eval-local'

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
    // The committed aggregate floor is 63; example-web has only 40 entries.
    expect(posture).toMatchObject({ kind: 'resolved', gateSetVerdict: 'empty-gate-set', gateSetNonEmpty: false, scope: { resolution: 'product-key' }, counts: { excludedCount: 0, natural: 34, heldOutShared: 2, heldOutPrivate: 4, adversarial: 0, remaining: { before: { natural: 34 } } } })
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
    expect(excludedBefore).toMatchObject({ gateSetVerdict: 'empty-gate-set', counts: { excludedCount: 40 } })
    rmSync(join(f.committedRoot, 'corpus'), { recursive: true })
    const after = result.resolve(candidate)
    expect(after).toMatchObject({ kind: 'resolved', gateSetVerdict: 'empty-gate-set', gateSetNonEmpty: false, counts: { natural: 0, excludedCount: 0, remaining: { after: { natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 } } } })
    expect(after.corpusDigest).not.toBe(before.corpusDigest)
    expect(result.resolve(excluding)).toMatchObject({ corpusDigest: after.corpusDigest,
      counts: { excludedCount: 0, natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 } })
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
