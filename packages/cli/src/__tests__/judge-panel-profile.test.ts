import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { generateRunId } from '@vostride/agent-qa-ids'
import { slugBranch } from '@vostride/agent-qa-schema'
import { buildEvalReport, composeBaselineProfileKey, computeCorpusDigest, createPanelIdentity,
  deriveLeafCassetteId, foldNoiseFloorArtefact, JUDGE_CONFIG, projectBaselinePointer,
  projectDecisionVectorsDocument } from '@vostride/agent-qa-eval'
import type { DecisionCorrectnessVector } from '@vostride/agent-qa-eval'
import * as local from '@vostride/agent-qa-eval-local'
import * as llm from '../llm-utils.js'
import * as plugins from '../provider-plugins.js'
import * as core from '@vostride/agent-qa-core'
import * as host from '../gates/replay-gate-host.js'
import { resolveEvalSession, resolveGateProfileIdentity, runFloorVerb, runGateVerb,
  runReplayGateVerb } from '../eval-session-composition.js'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-qa-panel-profile-'))
  vi.spyOn(llm, 'resolveModelAuth').mockImplementation(async name => ({ kind: 'unauthenticated',
    credentialKey: name, provider: 'openai-compatible', optional: true, message: 'fixture' }))
})
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })
async function session(judges: readonly string[] = ['a', 'b'], models = ['claude-judge', 'gemini-judge']) {
  const configPath = join(root, 'agent-qa.config.yaml')
  await writeFile(configPath, JSON.stringify({
    workspace: { testMatch: ['tests/*.yaml'], suiteMatch: ['suites/*.yaml'], hooksFile: 'hooks.yaml',
      envFile: '.env', secretsFile: 'secrets.fixture' },
    registry: { llms: [{ name: 'planner', provider: 'openai-compatible', model: 'gpt-planner' },
      ...models.map((model, i) => ({ name: i === 0 ? 'a' : 'b', provider: 'openai-compatible', model }))]
      .map(config => ({ ...config, baseURL: 'http://127.0.0.1:1/v1' })) },
    use: { llm: 'planner', mobile: { appState: 'preserve' } }, eval: { judges },
  }))
  await writeFile(join(root, 'secrets.fixture'), '')
  return resolveEvalSession({ configPath, keyOnly: true })
}

it('carries the canonical composite and raw member IDs through declaration-only identity', async () => {
  const s = await session()
  const identity = await resolveGateProfileIdentity(s)
  expect(identity.judgeModelId).toBe(createPanelIdentity(['claude-judge', 'gemini-judge']).judgeModelId)
  expect(identity.judgeMemberModelIds).toEqual(['claude-judge', 'gemini-judge'])
  expect(await resolveGateProfileIdentity({ ...s, evalConfig: { judges: ['b', 'a'] } }))
    .toEqual({ ...identity, judgeMemberModelIds: ['gemini-judge', 'claude-judge'] })
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

it('identity-only reads never load auth or provider plugins', async () => {
  const s = await session()
  const file = JSON.parse(await readFile(s.configPath, 'utf8'))
  file.plugins = { auth: [{ path: './unloadable-auth.fixture.js' }], providers: [{ path: './unloadable-provider.fixture.js' }] }
  await writeFile(s.configPath, JSON.stringify(file))
  const authPlugins = vi.spyOn(core, 'loadLLMAuthPlugins').mockResolvedValue([])
  const providerPlugins = vi.spyOn(plugins, 'loadProviderPluginsForRawConfig').mockResolvedValue(undefined)
  const keyOnly = await resolveEvalSession({ configPath: s.configPath, keyOnly: true })
  await resolveGateProfileIdentity(keyOnly)
  expect(authPlugins).not.toHaveBeenCalled()
  expect(providerPlugins).not.toHaveBeenCalled()
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

it('composes member declarations collision-safely while retaining direct-single bytes', async () => {
  const base = { plannerModelId: 'gpt-planner', fingerprint: 'f'.repeat(64), matcherVersion: 1 }
  const key = (ids: string[]) => composeBaselineProfileKey({ ...base, judgeMemberModelIds: ids })
  expect(key(['claude+a', 'gemini'])).toBe(key(['gemini', 'claude+a']))
  expect(key(['claude+a', 'gemini'])).not.toBe(key(['claude', 'a+gemini']))
  expect(key(['claude-judge'])).toBe(composeBaselineProfileKey({ ...base,
    judgeModelId: 'claude-judge', judgeVersion: JUDGE_CONFIG.judgeVersion }))
  expect(key([])).toBe(composeBaselineProfileKey(base))
  expect(() => composeBaselineProfileKey({ ...base, judgeMemberModelIds: ['claude', 'gemini'],
    judgeModelId: 'foreign' })).toThrow(/identity/)
})

it('forwards the same full declaration through measured-floor recovery without auth', async () => {
  const s = await session()
  const capture = vi.spyOn(local, 'runNoiseFloorMeasurement').mockResolvedValue({
    artefact: { corpusDigest: 'fixture' }, notices: [],
  } as unknown as Awaited<ReturnType<typeof local.runNoiseFloorMeasurement>>)
  await runFloorVerb(s, { fromMeasured: 'measured.fixture.json' })
  const identity = await resolveGateProfileIdentity(s)
  expect(capture.mock.calls[0][0].profileKeyInputs).toMatchObject({
    judgeModelId: createPanelIdentity(['claude-judge', 'gemini-judge']).judgeModelId,
    judgeVersion: JUDGE_CONFIG.judgeVersion,
  })
  expect(capture.mock.calls[0][0].reportOutputBaseDir).toContain(slugBranch(identity.profileKey))
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

it('preserves flag replacement through lazy member auth and warm-up hints', async () => {
  const configured = await session(['a'])
  const s = await resolveEvalSession({ configPath: configured.configPath, keyOnly: true, flags: { judge: ['b', 'a'] } })
  const capture = vi.spyOn(host, 'createReplayGateHost').mockImplementation(() => ({
    run: async () => ({ kind: 'refused', refusal: { path: root, reason: 'fixture' }, notices: [], exit: 2 }),
    port: { runReplayGate: async () => { throw new Error('fixture uses run') } },
  }))
  await runReplayGateVerb(s, 'candidate-fixture', { dryRun: true })
  const input = capture.mock.calls[0][0].composition
  expect(input.judgeMembers?.map(member => member.profile.model)).toEqual(['gemini-judge', 'claude-judge'])
  expect(input.baselineWarmup).toEqual({ configPath: s.configPath, judges: ['b', 'a'] })
  expect(input.identity.judgeModelId).toBe(createPanelIdentity(['gemini-judge', 'claude-judge']).judgeModelId)
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
  for (const member of input.judgeMembers ?? []) expect(await member.resolveAuth()).toEqual({ kind: 'none' })
  expect(vi.mocked(llm.resolveModelAuth).mock.calls.map(call => call[0])).toEqual(['b', 'a'])
})

it('refuses registry identity drift before lazy credentials', async () => {
  const s = await session()
  const capture = vi.spyOn(host, 'createReplayGateHost').mockImplementation(() => ({
    run: async () => ({ kind: 'refused', refusal: { path: root, reason: 'fixture' }, notices: [], exit: 2 }),
    port: { runReplayGate: async () => { throw new Error('fixture uses run') } },
  }))
  await runReplayGateVerb(s, 'candidate-fixture')
  await session(['a', 'b'], ['claude-changed', 'gemini-judge'])
  await expect(capture.mock.calls[0][0].composition.planner.resolveAuth()).rejects.toThrow(/identity.*changed/)
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

async function comparisonFixture() {
  const s = await session()
  const identity = await resolveGateProfileIdentity(s)
  const stamp = createPanelIdentity(['claude-judge', 'gemini-judge'])
  const report = buildEvalReport([], stamp, undefined, { declaredSeed: 11 })
  const vectors: DecisionCorrectnessVector[] = Array.from({ length: 24 }, (_, i) => {
    const cassetteId = deriveLeafCassetteId({ runSlug: generateRunId(), testIndex: i, stepIndex: 0, decisionOrdinal: 0 })
    return { key: `${cassetteId}#-#0`, cassetteId, decisionOrdinal: 0, product: 'fixture', briefSource: 'proof',
      axes: { headline: 'correct', elementIdentity: 'correct', value: 'correct', opClass: 'correct',
        sideEffect: 'correct', loop: 'not-applicable' } }
  })
  report.briefSourceCounts = { proof: 24, empty: 0, rendered: 0 }
  const corpusDigest = computeCorpusDigest([])
  report.runIdentity = { fingerprint: identity.fingerprint, corpusDigest }
  const decisions = projectDecisionVectorsDocument({ batchKey: report.batchKey, matcherVersion: report.matcherVersion, vectors })
  new local.FsReportStore({ root: join(root, '.agent-qa') }).save(report, decisions)
  const pointer = projectBaselinePointer({ ...identity, corpusDigest, batchKey: report.batchKey })
  const { judgeMemberModelIds: _members, ...floorProfile } = identity
  const floor = foldNoiseFloorArtefact({ profile: floorProfile,
    corpusDigest, partitionVersion: 1, seeds: [11, 29], repeats: 3, bootstrapSeed: 17,
    runs: [11, 11, 11, 29].map((seed, index) => ({ index, seed, report, vectors, wallClockMs: 0 })),
    splitByCassetteId: new Map(), censusByProduct: { fixture: { natural: 24, heldOutShared: 0, heldOutPrivate: 0 } } })
  return { s, identity, report, decisions, pointer, floor, committedRoot: join(root, 'agent-qa-eval'), reportOutputBaseDir: join(root, 'audit') }
}

it('keeps a panel incomparable until its own floor and baseline are committed, then compares offline', async () => {
  const f = await comparisonFixture()
  const run = () => runGateVerb(f.s, { report: f.report.batchKey })
  const cold = await run()
  expect(cold).toMatchObject({ kind: 'verdict', verdict: { exit: 2 } })
  expect(local.writeNoiseFloorArtefact({ ...f, artefact: f.floor }).kind).toBe('written')
  expect(await run()).toMatchObject({ kind: 'verdict', verdict: { exit: 2 } })
  expect(local.commitEvalReport({ ...f, markdown: '# Fixture\n' }).kind).toBe('committed')
  expect(local.writeBaselinePointer(f).kind).toBe('written')
  expect(await run()).toMatchObject({ kind: 'verdict', verdict: { exit: 0, pairing: { n: 24 } } })
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})

it('refuses a foreign full key at a colliding baseline slug', async () => {
  const f = await comparisonFixture()
  const foreign = { ...f.pointer, plannerModelId: 'gpt/planner' }
  foreign.profileKey = composeBaselineProfileKey(foreign)
  expect(slugBranch(foreign.profileKey)).toBe(slugBranch(f.pointer.profileKey))
  expect(foreign.profileKey).not.toBe(f.pointer.profileKey)
  const file = join(f.committedRoot, local.committedBaselinePointerPath(f.pointer.profileKey))
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(foreign))
  expect(await runGateVerb(f.s, { report: f.report.batchKey })).toMatchObject({ kind: 'refused',
    refusal: { reason: expect.stringContaining('profileKey mismatch') } })
})

it('cannot reuse a single-judge baseline or cache for a composite profile', async () => {
  const f = await comparisonFixture()
  const singleSession = { ...f.s, evalConfig: { judge: 'a' } }
  const single = await resolveGateProfileIdentity(singleSession)
  expect(single.profileKey).not.toBe(f.identity.profileKey)
  const singleReport = { ...f.report, judge: createPanelIdentity(['claude-judge']) }
  const pointer = projectBaselinePointer({ ...single, corpusDigest: f.pointer.corpusDigest, batchKey: f.report.batchKey })
  expect(local.commitEvalReport({ ...f, report: singleReport, markdown: '# Single fixture\n' }).kind).toBe('committed')
  expect(local.writeBaselinePointer({ ...f, report: singleReport, pointer }).kind).toBe('written')
  const gate = await runGateVerb(f.s, { report: f.report.batchKey })
  expect(gate).toMatchObject({ kind: 'verdict', verdict: { exit: 2,
    inconclusive: expect.arrayContaining([expect.objectContaining({ reason: 'missing-baseline' })]) } })
  const singleCache = join(root, '.agent-qa', 'eval', 'gate', slugBranch(single.profileKey))
  new local.FsReportStore({ root, outputDir: join(singleCache, 'reports') }).save(singleReport, f.decisions)
  expect(local.listBaselineRunRoots(join(root, '.agent-qa'), single.profileKey)).toHaveLength(1)
  const cache = local.resolveBaselineCache({ ...f.identity, agentQaRoot: join(root, '.agent-qa'),
    gateRootSeed: 11, gateRootSeedSource: 'fixture', cassettes: [{ id: f.decisions.vectors[0].cassetteId, promptInputHash: 'fixture' }],
    judgeIdentity: { judgeModelId: f.identity.judgeModelId!, judgeVersion: JUDGE_CONFIG.judgeVersion } })
  expect(cache.roots).toEqual([])
  expect(cache.rows).toMatchObject([{ kind: 'uncached' }])
})

it('never designates a report mixing single and composite identities', async () => {
  const f = await comparisonFixture()
  const mixed = buildEvalReport([], undefined, { judgeIdentity: 'mixed',
    judgeModelIds: ['claude-judge', createPanelIdentity(['claude-judge', 'gemini-judge']).judgeModelId] })
  expect(local.writeBaselinePointer({ ...f, report: mixed, pointer: { ...f.pointer, batchKey: mixed.batchKey } }))
    .toMatchObject({ kind: 'refused', refusal: { kind: 'mixed-judge-identity' } })
})
