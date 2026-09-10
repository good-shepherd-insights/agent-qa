import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as model from '@vostride/agent-qa-model'
import * as local from '@vostride/agent-qa-eval-local'
import * as core from '@vostride/agent-qa-eval'
import * as llm from '../llm-utils.js'
import { resolveEvalSession, resolveGateProfileIdentity, resolveReplayProfileFingerprint } from '../eval-session-composition.js'
import { createKnowledgeChecks, type KnowledgeCheckProbes } from '../commands/doctor-knowledge-checks.js'

const roots: string[] = []
const secret = 'doctor-fixture-sensitive-42114'
const authFetch = vi.fn<typeof fetch>()
const probes: KnowledgeCheckProbes = {
  classifyIndexFace: () => ({ source: 'index' }),
  resolveEmbedderCapability: async () => ({ kind: 'lexical-only' }),
  readWriterLease: () => ({ kind: 'absent' }),
}
beforeEach(() => {
  vi.spyOn(llm, 'resolveModelAuth').mockImplementation(async name => ({ kind: 'api-key', credentialKey: name,
    provider: 'openai-compatible', apiKey: secret }))
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model forbidden') })
  vi.spyOn(local, 'bindJudgePanel').mockImplementation(() => { throw new Error('binding forbidden') })
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden') })
  authFetch.mockClear()
})
afterEach(() => {
  expect(model.createModel).not.toHaveBeenCalled()
  expect(local.bindJudgePanel).not.toHaveBeenCalled()
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(authFetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(judges: string[] | undefined = ['a', 'b'], knowledge = true) {
  const root = mkdtempSync(join(tmpdir(), 'judge-doctor-')); roots.push(root)
  if (knowledge) mkdirSync(join(root, 'knowledge'))
  const configPath = join(root, 'agent-qa.config.yaml')
  const config = { workspace: { testMatch: ['tests/*.yaml'], suiteMatch: ['suites/*.yaml'], hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: 'fixture.secrets' },
    registry: { llms: ['gpt-5', 'claude-sonnet-4', 'gemini-2.5', 'gpt-judge'].map((model, i) => ({ name: ['planner', 'a', 'b', 'same'][i], provider: 'openai-compatible', model, baseURL: 'http://127.0.0.1:1/v1' })) },
    use: { llm: 'planner', mobile: { appState: 'preserve' } }, knowledge: { dir: 'knowledge' }, eval: judges === undefined ? {} : { judges } }
  writeFileSync(configPath, JSON.stringify(config)); writeFileSync(join(root, 'fixture.secrets'), '')
  return { root, configPath, config, probes }
}
it.each(['absent-root', 'missing-floor', 'refused-posture', 'absent-knowledge'])('shows independent panel calibration with %s', async arm => {
  const f = fixture(['a', 'b'], arm !== 'absent-knowledge')
  if (arm === 'missing-floor') mkdirSync(join(f.root, 'agent-qa-eval'))
  if (arm === 'refused-posture') f.probes = { ...probes, buildPromotionPosture: async () => { throw new Error(secret) } }
  const row = await createKnowledgeChecks(f)[3].check()
  expect(row.message).toContain('judge panel: 2 members (claude, gemini) · calibration: uncalibrated n=0 (unavailable)')
  expect(row.message).toContain('label calibration: absent')
  expect(row.message).not.toContain(secret)
})
it.each([{ judges: undefined }, { judges: [] }])('does not auto-assemble declaration %j when credentials are available', async ({ judges }) => {
  const f = fixture(judges ?? [])
  if (judges === undefined) { f.config.eval = {}; writeFileSync(f.configPath, JSON.stringify(f.config)) }
  const row = await createKnowledgeChecks(f)[3].check()
  expect(row.message).toContain('capability gap: panel-not-configured')
  expect(row.message).not.toContain('members (')
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
it('retains single-judge wording without a panel calibration suffix', async () => {
  const f = fixture(['a'])
  expect((await createKnowledgeChecks(f)[3].check()).message).not.toContain('judge panel:')
  expect(llm.resolveModelAuth).not.toHaveBeenCalled()
})
it.each(['missing', 'unauthenticated'] as const)('discloses %s as no-credential without diagnostics', async kind => {
  const f = fixture()
  vi.mocked(llm.resolveModelAuth).mockImplementation(async name => name === 'a'
    ? { kind: 'auth-fetch', credentialKey: name, provider: 'fixture', modelAdapter: 'anthropic-messages', fetch: authFetch }
    : kind === 'missing' ? { kind, credentialKey: name, provider: 'gemini', required: true, message: secret }
      : { kind, credentialKey: name, provider: 'openai-compatible', optional: true, message: secret })
  const row = await createKnowledgeChecks(f)[3].check()
  expect(row.message).toContain('2 members (claude, gemini) · calibration: capability gap: no-credential')
  expect(row.message).not.toContain(secret)
})
it('discloses a complete colliding panel without pruning', async () => {
  const row = await createKnowledgeChecks(fixture(['same', 'a']))[3].check()
  expect(row.message).toContain('2 members (openai, claude) · calibration: capability gap: single-family-host')
})
it('copies an explicitly recorded minimum policy without a floor and never rewrites it', async () => {
  const f = fixture(), committedRoot = join(f.root, 'agent-qa-eval'); mkdirSync(committedRoot)
  const session = await resolveEvalSession({ configPath: f.configPath, keyOnly: true })
  const profile = await resolveGateProfileIdentity(session)
  profile.fingerprint = await resolveReplayProfileFingerprint(session, 'none')
  const input = { committedRoot, agentQaRoot: join(f.root, '.agent-qa'), profile,
    identity: core.createPanelIdentity(['claude-sonnet-4', 'gemini-2.5']), minN: core.resolveJudgeCalibrationMinimum(20) }
  const artifact = local.createJudgeCalibrationArtifact(input, { status: 'capability-gap', reason: 'single-family-host' })
  const path = join(committedRoot, local.judgeCalibrationPath(artifact.profileKey))
  mkdirSync(join(committedRoot, 'reports/judge-calibration'), { recursive: true }); writeFileSync(path, JSON.stringify(artifact))
  const before = readFileSync(path, 'utf8')
  expect((await createKnowledgeChecks(f)[3].check()).message).toContain('calibration: capability gap: single-family-host')
  expect(readFileSync(path, 'utf8')).toBe(before)
})
