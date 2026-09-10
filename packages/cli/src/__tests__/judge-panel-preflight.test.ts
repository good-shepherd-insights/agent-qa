import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import * as model from '@vostride/agent-qa-model'
import * as local from '@vostride/agent-qa-eval-local'
import * as ai from 'ai'
import * as composition from '../eval-session-composition.js'
import * as llm from '../llm-utils.js'

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
    config: AgentQaConfigSchema.parse({ registry: { llms: configs }, use: { llm: 'planner' } }),
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
  vi.spyOn(ai, 'generateText').mockImplementation(() => { throw new Error('generate called') })
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
    const result = await composition.preflightJudgePanel?.(session(), {}, deps)
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
    s.config.registry.llms = [
      { name: 'codex', provider: 'openai-compatible', model: 'gpt-5.6-terra' },
      { name: 'judge', provider: 'openai-compatible', model: 'gpt-5.6-sol' },
      { name: 'claude', provider: 'anthropic-compatible', model: 'claude-sonnet-4-6' },
    ]
    s.config.use.llm = 'codex'
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
    expect(JSON.stringify(result.entries)).not.toContain(secret)
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
