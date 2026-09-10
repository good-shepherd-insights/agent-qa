import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import * as model from '@vostride/agent-qa-model'
import * as local from '@vostride/agent-qa-eval-local'
import * as ai from 'ai'
import * as composition from '../eval-session-composition.js'
import * as llm from '../llm-utils.js'

vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(),
  generateText: vi.fn(() => { throw new Error('generate called') }),
}))

const secret = 'fixture-sensitive-value-42110'
const authFetch = vi.fn<typeof fetch>()
const configs: llm.NamedLLMConfigLike[] = [
  { name: 'planner', provider: 'openai-compatible', model: 'gpt-5' },
  { name: 'a', provider: 'anthropic-compatible', model: 'claude-sonnet-4' },
  { name: 'b', provider: 'gemini', model: 'gemini-2.5' },
  { name: 'same', provider: 'openai-compatible', model: 'gpt-judge' },
  { name: 'alias', provider: 'anthropic-compatible', model: 'claude-sonnet-4' },
  { name: 'unknown', provider: 'openai-compatible', model: 'unclassified' },
  { name: 'lineage', provider: 'openai-compatible', model: 'deepseek-r1-distill-llama' },
  { name: 'llama', provider: 'openai-compatible', model: 'llama-3' },
]
function session(evalConfig: composition.EvalCliConfig = {}): composition.EvalSession {
  return {
    config: AgentQaConfigSchema.parse({ workspace: { testMatch: ['tests/*.yaml'],
      suiteMatch: ['suites/*.yaml'], hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: 'fixture.secrets' },
      registry: { llms: configs.map(row => ({ ...row, baseURL: 'http://127.0.0.1:1/v1' })) },
      use: { llm: 'planner', mobile: { appState: 'preserve' } } }),
    evalConfig, configPath: '/fixture/agent-qa.config.yaml', configDir: '/fixture',
    executionContext: {} as composition.EvalSession['executionContext'],
    maskingContextFactory: () => buildRunMaskingContext({ env: { FIXTURE_SECRET: secret } }),
  }
}
const named = vi.fn<typeof llm.resolveNamedConfig>()
const auth = vi.fn<typeof llm.resolveModelAuth>()
const deps = { resolveNamedConfig: named, resolveModelAuth: auth }
beforeEach(() => {
  named.mockReset().mockImplementation(async name => {
    const config = configs.find(row => row.name === name)
    if (!config) throw new Error(`sensitive provider detail ${secret}`)
    return { config, allConfigs: configs, defaultName: 'planner' }
  })
  auth.mockReset().mockImplementation(async name => ({ kind: 'api-key', credentialKey: name,
    provider: 'openai-compatible', apiKey: secret }))
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model called') })
  vi.spyOn(local, 'bindJudgePanel').mockImplementation(() => { throw new Error('bind called') })
  vi.mocked(ai.generateText).mockClear()
  authFetch.mockClear()
})
afterEach(() => {
  expect(model.createModel).not.toHaveBeenCalled()
  expect(local.bindJudgePanel).not.toHaveBeenCalled()
  expect(ai.generateText).not.toHaveBeenCalled()
  expect(authFetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('judge panel preflight', () => {
  it('returns an explicit no-panel gap without resolving registry or credentials', async () => {
    const result = await composition.preflightJudgePanel(session(), {}, deps)
    expect(result).toEqual({ kind: 'capability-gap', status: 'capability-gap', reason: 'panel-not-configured',
      minN: { value: 20, source: 'default' }, entries: [] })
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
  it.each([{ judges: [] }, { judge: 'a' }, { judges: ['a'] }])('has no composite identity for insufficient %j', async config => {
    const result = await composition.preflightJudgePanel(session(config), {}, deps)
    expect(result).toMatchObject({ reason: 'panel-not-configured' })
    expect(result).not.toHaveProperty('identity')
    expect(result).not.toHaveProperty('members')
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
  it('available Claude credential alone cannot assemble the demo eval empty declaration', async () => {
    const s = session()
    s.config.registry!.llms = [
      { name: 'codex', provider: 'openai-compatible', model: 'gpt-5.6-terra', vision: true },
      { name: 'judge', provider: 'openai-compatible', model: 'gpt-5.6-sol', vision: true },
      { name: 'claude', provider: 'anthropic-compatible', model: 'claude-sonnet-4-6', vision: true },
    ]
    s.config.use!.llm = 'codex'
    expect(await composition.preflightJudgePanel(s, {}, deps)).toMatchObject({ reason: 'panel-not-configured' })
    expect(auth).not.toHaveBeenCalled()
    expect(named).not.toHaveBeenCalled()
  })
  it.each(['missing', 'unauthenticated'] as const)('retains all entry failures when %s takes precedence', async kind => {
    auth.mockImplementation(async name => name === 'same' ? kind === 'missing'
      ? { kind, credentialKey: name, provider: 'gemini', required: true, message: secret }
      : { kind, credentialKey: name, provider: 'openai-compatible', optional: true, message: secret }
      : { kind: 'api-key', credentialKey: name, provider: 'openai-compatible', apiKey: secret })
    const result = await composition.preflightJudgePanel(session({ judges: ['same', 'unknown', 'a'] }), {}, deps)
    expect(result).toMatchObject({ kind: 'capability-gap', reason: 'no-credential', entries: [
      { name: 'same', credential: kind, failures: ['no-credential', 'replay-family-collision'] },
      { name: 'unknown', credential: 'present', failures: ['unknown-family'] },
      { name: 'a', credential: 'present', failures: [] },
    ] })
    expect(auth.mock.calls.map(call => call[0])).toEqual(['same', 'unknown', 'a'])
    expect(result).not.toHaveProperty('members')
    expect(result.identity).toMatchObject({ panelSize: 3,
      judgeModelId: 'panel:claude-sonnet-4+gpt-judge+unclassified' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it.each([['a', 'alias'], ['lineage', 'llama'], ['same', 'b'], ['unknown', 'b']])('refuses the complete family declaration %j / %j', async (a, b) => {
    const result = await composition.preflightJudgePanel(session({ judges: [a, b], judgeAllowSameFamily: true }), {}, deps)
    expect(result).toMatchObject({ reason: 'single-family-host' })
    expect(result).not.toHaveProperty('members')
    expect(result.entries.every(entry => entry.credential === 'present')).toBe(true)
    expect(result.entries.some(entry => entry.failures.length > 0)).toBe(true)
    if (a === 'a' || a === 'lineage') expect(result.entries.every(entry => entry.failures.includes('member-family-collision'))).toBe(true)
  })
  it('collects config and auth exceptions without leaking messages or stopping later entries', async () => {
    auth.mockImplementation(async () => { throw new Error(secret) })
    const result = await composition.preflightJudgePanel(session({ judges: [secret, 'a', 'b'] }), {}, deps)
    expect(result).toMatchObject({ reason: 'no-credential', entries: [
      { index: 0, credential: 'resolution-failed', failures: ['config-unresolved', 'no-credential'] },
      { index: 1, credential: 'resolution-failed', failures: ['no-credential'] },
      { index: 2, credential: 'resolution-failed', failures: ['no-credential'] },
    ] })
    expect(result.entries[0]?.name).not.toBe(secret)
    expect(result).not.toHaveProperty('identity')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(auth.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
  })
  it.each(['api-key', 'bearer-token', 'auth-fetch'] as const)('returns only eligible binding data with local %s presence', async kind => {
    auth.mockImplementation(async name => kind === 'api-key'
      ? { kind, credentialKey: name, provider: 'openai-compatible', apiKey: secret }
      : kind === 'bearer-token' ? { kind, credentialKey: name, provider: 'anthropic-compatible', token: secret }
      : { kind, credentialKey: name, provider: 'fixture', modelAdapter: 'anthropic-messages', fetch: authFetch })
    const result = await composition.preflightJudgePanel(session({ judges: ['b', 'a'] }), { minN: 2 }, deps)
    expect(result).toMatchObject({ kind: 'eligible', status: 'uncalibrated', n: 0,
      minN: { value: 2, source: 'flag' }, replayProfile: { model: 'gpt-5' },
      identity: { panelSize: 2, judgeModelId: 'panel:claude-sonnet-4+gemini-2.5' } })
    if (result.kind !== 'eligible') throw new Error('expected eligible')
    expect(result.members.map(row => row.profile.model)).toEqual(['gemini-2.5', 'claude-sonnet-4'])
    expect(result.members.map(row => row.auth.kind)).toEqual([kind, kind])
    expect(auth.mock.calls.map(call => call[0])).toEqual(['b', 'a'])
    expect(named.mock.calls.map(call => call[0])).toEqual(['b', 'a', 'planner'])
    expect(named.mock.calls.at(-1)?.[2]).toEqual({ keyOnly: true })
    expect(named.mock.calls.every(call => call[2]?.keyOnly === true)).toBe(true)
    expect(JSON.stringify(result.entries)).not.toContain(secret)
  })
  it('keeps auth-fetch local when a missing sibling takes gap precedence', async () => {
    auth.mockImplementation(async name => name === 'a'
      ? { kind: 'auth-fetch', credentialKey: name, provider: 'fixture',
        modelAdapter: 'anthropic-messages', fetch: authFetch }
      : { kind: 'missing', credentialKey: name, provider: 'gemini', required: true, message: secret })
    const result = await composition.preflightJudgePanel(session({ judges: ['a', 'b'] }), {}, deps)
    expect(result).toMatchObject({ reason: 'no-credential', entries: [
      { name: 'a', credential: 'present', failures: [] },
      { name: 'b', credential: 'missing', failures: ['no-credential'] },
    ], identity: { panelSize: 2, judgeModelId: 'panel:claude-sonnet-4+gemini-2.5' } })
    expect(result).not.toHaveProperty('members')
    expect(auth.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    expect(JSON.stringify(result)).not.toContain(secret)
  })
  it('masks an earlier unresolved name with a credential learned from a later member', async () => {
    const lateSecret = 'late-credential-sentinel-42110'
    auth.mockResolvedValue({ kind: 'bearer-token', credentialKey: 'a',
      provider: 'anthropic-compatible', token: lateSecret })
    const result = await composition.preflightJudgePanel(session({ judges: [lateSecret, 'a'] }), {}, deps)
    expect(result).toMatchObject({ reason: 'no-credential', entries: [
      { credential: 'resolution-failed', failures: ['config-unresolved', 'no-credential'] },
      { credential: 'present', failures: [] },
    ] })
    expect(JSON.stringify(result)).not.toContain(lateSecret)
    expect(result).not.toHaveProperty('identity')
  })
  it('suppresses a gap identity containing a credential instead of synthesizing a masked identity', async () => {
    const lateSecret = 'late-model-sentinel-42110'
    named.mockImplementation(async name => {
      const config = configs.find(row => row.name === name)!
      return { config: name === 'a' ? { ...config, model: `claude-${lateSecret}` } : config,
        allConfigs: configs, defaultName: 'planner' }
    })
    auth.mockImplementation(async name => name === 'b'
      ? { kind: 'api-key', credentialKey: name, provider: 'gemini', apiKey: lateSecret }
      : { kind: 'unauthenticated', credentialKey: name, provider: 'anthropic-compatible',
        optional: true, message: secret })
    const result = await composition.preflightJudgePanel(session({ judges: ['a', 'b'] }), {}, deps)
    expect(result).toMatchObject({ reason: 'no-credential', entries: [
      { families: ['claude'], credential: 'unauthenticated' },
      { families: ['gemini'], credential: 'present' },
    ] })
    expect(result).not.toHaveProperty('identity')
    expect(JSON.stringify(result)).not.toContain(lateSecret)
  })
  it('refuses unresolved replay profiles with safe actionable text and no planner auth', async () => {
    named.mockImplementation(async name => {
      if (name === 'planner') throw new Error(`provider details ${secret}`)
      return { config: configs.find(row => row.name === name)!, allConfigs: configs, defaultName: 'planner' }
    })
    await expect(composition.preflightJudgePanel(session({ judges: ['a', 'b'] }), {}, deps))
      .rejects.toThrow('Cannot resolve the replay profile for judge panel preflight. Check use.llm and its registry.llms entry.')
    expect(auth.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
  })
  it('suppresses a gap identity when the replay model contains a resolved member credential', async () => {
    const lateSecret = 'late-planner-sentinel-42112'
    named.mockImplementation(async name => ({ config: { ...configs.find(row => row.name === name)!,
      ...(name === 'planner' ? { model: `gpt-5/${lateSecret}` } : {}) }, allConfigs: configs, defaultName: 'planner' }))
    auth.mockImplementation(async name => name === 'b'
      ? { kind: 'api-key', credentialKey: name, provider: 'gemini', apiKey: lateSecret }
      : { kind: 'unauthenticated', credentialKey: name, provider: 'anthropic-compatible', optional: true, message: secret })
    const result = await composition.preflightJudgePanel(session({ judges: ['a', 'b'] }), {}, deps)
    expect(result).toMatchObject({ reason: 'no-credential' })
    expect(result).not.toHaveProperty('identity')
    expect(JSON.stringify(result)).not.toContain(lateSecret)
    expect(auth.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
  })
  it('rejects invalid minimum before any resolution', async () => {
    await expect(composition.preflightJudgePanel(session({ judges: ['a', 'b'] }), { minN: 1 }, deps)).rejects.toThrow('min-n')
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
  it.each([{ judge: 'a', judges: ['b'] }, { judges: ['a', 'b', 'same', 'alias'] }])('preserves the typed config refusal %j', async config => {
    await expect(composition.preflightJudgePanel(session(config), {}, deps)).rejects.toBeInstanceOf(composition.EvalJudgeDeclarationError)
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
})
