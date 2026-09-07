import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeCorpusDigest, readCommittedCorpus } from '../../eval-session-composition.js'
import * as composition from '../../eval-session-composition.js'
import * as llm from '../../llm-utils.js'
import * as evalLocal from '@vostride/agent-qa-eval-local'
import { createCanaryAblationForHost } from '../canary-ablation-host.js'
import type { CanaryAblationInput } from '../../curation/canary-credit.js'
import { distilledScreenStateDigest, slugBranch, type CompletedRunHandoff } from '@vostride/agent-qa-schema'

vi.mock('../../llm-utils.js', async (original) => ({
  ...await original<typeof import('../../llm-utils.js')>(),
  resolveModelAuth: vi.fn(() => { throw new Error('credential resolution forbidden') }),
}))
const { writeGate1Fixture } = await import(new URL(
  '../../../../eval-local/src/__tests__/fixtures/gate1-fixtures.js', import.meta.url,
).href)
const roots: string[] = []
const workspace = 'workspace:\n  testMatch: [tests/**/*.yaml]\n  suiteMatch: [suites/**/*.suite.yaml]\n  hooksFile: hooks.yaml\n  envFile: .env\n  secretsFile: .env.secrets.local\nuse:\n  mobile:\n    appState: preserve\n'
function fixture(evalBlock = '') {
  const root = mkdtempSync(join(tmpdir(), '418-canary-host-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, workspace + evalBlock)
  return { root, configPath, agentQaRoot: join(root, '.agent-qa') }
}
// The bridge consumes only the address; handoff/runDir are deliberately not read by it.
const target = { candidateId: 'candidate', runId: 'run', testId: 'test', stepIndex: 0,
  attributedObservationId: 'observation' } as CanaryAblationInput
beforeEach(() => {
  vi.mocked(llm.resolveModelAuth).mockReset().mockImplementation(() => { throw new Error('credential resolution forbidden') })
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('418 lazy canary host bridge', () => {
  it('binds real zero-call staging and novelty through the session to the local feedback tree', async () => {
    const f = fixture()
    const corpus = writeGate1Fixture(f.root, { targetInCorpus: false, handoffForTarget: true, proofBrief: true })
    renameSync(corpus.committedRoot, join(f.root, 'agent-qa-eval'))
    const handoffPath = join(f.agentQaRoot, 'runs', slugBranch(corpus.injection.target.runId), 'handoff.json')
    const handoff = JSON.parse(readFileSync(handoffPath, 'utf8')) as CompletedRunHandoff
    const state = handoff.tests[0]!.steps[0]!.subActions[0]!.stateBefore
    state.url = 'https://feedback.example/host-new-state'
    state.timestamp = 1_725_000_000
    writeFileSync(handoffPath, JSON.stringify(handoff))
    const host = createCanaryAblationForHost(f)
    const address = { ...target, runId: String(handoff.runId), testId: handoff.tests[0]!.testId,
      product: 'alpha', stateDigest: distilledScreenStateDigest(state), benefit: 'exercised-harmed' as const }
    expect(await host.isNovel(address)).toBe(true)
    expect(await host.stage(address)).toMatchObject({ kind: 'staged' })
    expect(await host.isNovel(address)).toBe(false)
    expect(evalLocal.listStagedFeedback({ agentQaRoot: f.agentQaRoot })).toHaveLength(1)
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  })
  it('composes configured k and seed, with input overrides, without a provider call', async () => {
    const f = fixture('registry:\n  llms:\n    - name: planner\n      provider: openai-compatible\n      model: fixture\n      baseURL: http://127.0.0.1:1/v1\neval:\n  k: 5\n  seed: 29\n')
    writeFileSync(f.configPath, readFileSync(f.configPath, 'utf8').replace('use:\n', 'use:\n  llm: planner\n'))
    writeFileSync(join(f.root, '.env.secrets.local'), '')
    const corpus = writeGate1Fixture(f.root)
    renameSync(corpus.committedRoot, join(f.root, 'agent-qa-eval'))
    const session = await composition.resolveEvalSession({ configPath: f.configPath, keyOnly: true })
    vi.mocked(llm.resolveModelAuth).mockResolvedValue({ kind: 'unauthenticated', provider: 'openai-compatible', credentialKey: 'fixture', optional: true, message: 'fixture' })
    const ablate = vi.spyOn(evalLocal, 'ablateCanaryStep').mockResolvedValue({ kind: 'unavailable', reason: 'no-live-decision', detail: 'fixture' })
    const input = { agentQaRoot: f.agentQaRoot, recordId: 'fixture',
      target: { runId: 'run', testId: 'test', stepIndex: 0 }, attributedObservationId: 'observation' }
    await composition.runCanaryAblation(session, input)
    expect(ablate).toHaveBeenLastCalledWith(expect.objectContaining({ k: 5, baseSeed: 29,
      replay: expect.objectContaining({ maskingContextFactory: expect.any(Function) }) }))
    await composition.runCanaryAblation(session, { ...input, k: 3, seed: 7 })
    expect(ablate).toHaveBeenLastCalledWith(expect.objectContaining({ k: 3, baseSeed: 7 }))
    await composition.runCanaryAblation({ ...session, evalConfig: {} }, input)
    expect(ablate).toHaveBeenLastCalledWith(expect.objectContaining({ k: 3, baseSeed: 11 }))
    await expect(composition.runCanaryAblation(session, { ...input, k: 2 })).rejects.toThrow('odd integer')
  })
  it('answers no-eval-root on both members without credentials', async () => {
    const host = createCanaryAblationForHost(fixture())
    expect(await host.ablate(target)).toEqual({ kind: 'no-eval-root' })
    expect(await host.corpusDigest()).toEqual({ kind: 'no-eval-root' })
    expect(await host.isNovel({ product: 'alpha', stateDigest: 'a'.repeat(64) })).toBe(false)
    expect(await host.stage({ ...target, product: 'alpha', stateDigest: 'a'.repeat(64), benefit: 'rode-along' })).toEqual({ kind: 'no-eval-root' })
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  })
  it('reads the real committed digest without credentials', async () => {
    const f = fixture()
    const corpus = writeGate1Fixture(f.root)
    const committedRoot = join(f.root, 'agent-qa-eval')
    renameSync(corpus.committedRoot, committedRoot)
    const host = createCanaryAblationForHost(f)
    expect(await host.corpusDigest()).toEqual({ kind: 'digest',
      corpusDigest: computeCorpusDigest(readCommittedCorpus(committedRoot).snapshot.entries) })
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  })
  it('distinguishes a present broken root from a missing root before auth', async () => {
    const f = fixture()
    mkdirSync(join(f.root, 'agent-qa-eval'))
    const host = createCanaryAblationForHost(f)
    expect(await host.corpusDigest()).toMatchObject({ kind: 'unavailable' })
    expect(await host.ablate(target)).toMatchObject({ kind: 'unavailable' })
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  })
  it('treats a dangling root symlink as unavailable, never BYOM', async () => {
    const f = fixture()
    symlinkSync(join(f.root, 'missing'), join(f.root, 'agent-qa-eval'))
    const host = createCanaryAblationForHost(f)
    expect(await host.corpusDigest()).toMatchObject({ kind: 'unavailable' })
    expect(await host.ablate(target)).toMatchObject({ kind: 'unavailable' })
    expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  })
  it.each(['no-eval-root', 'unavailable', 'ablated'] as const)('maps %s arm and address', async (kind) => {
    const f = fixture()
    const result = kind === 'ablated' ? {
      kind, crossCheck: 'flipped' as const, corpusDigest: 'd'.repeat(64), k: 3, baseSeed: 11,
      seeds: [11, 12, 13], seedHonored: true, gate2Dir: '/fixture', notices: [],
      spend: { modelCalls: 5, screens: 5, promptTokens: 1, completionTokens: 1 },
    } : kind === 'unavailable' ? { kind, reason: 'target-unavailable' as const, detail: 'ambiguous' } : { kind }
    const run = vi.spyOn(composition, 'runCanaryAblation').mockResolvedValue(result)
    expect(await createCanaryAblationForHost(f).ablate(target)).toEqual(result)
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recordId: target.candidateId, target: { runId: target.runId, testId: target.testId, stepIndex: 0 },
    }))
  })
  it('converts thrown composition failures to data on both members', async () => {
    vi.spyOn(composition, 'resolveEvalSession').mockRejectedValue(new Error('broken config'))
    const host = createCanaryAblationForHost(fixture())
    expect(await host.ablate(target)).toEqual({ kind: 'error', message: 'broken config' })
    expect(await host.corpusDigest()).toEqual({ kind: 'unavailable', reason: 'broken config' })
  })
  it.each([
    ['', undefined, 4, 'default'],
    ['eval:\n  gate2:\n    maxAblations: 2\n', undefined, 2, 'config'],
    ['eval:\n  gate2:\n    maxAblations: 2\n', 1, 1, 'flag'],
  ] as const)('discloses cap source %s/%s', async (config, flag, cap, source) => {
    expect(await createCanaryAblationForHost({ ...fixture(config), maxAblations: flag }).resolveCaps())
      .toEqual({ maxAblations: cap, source })
  })
})
