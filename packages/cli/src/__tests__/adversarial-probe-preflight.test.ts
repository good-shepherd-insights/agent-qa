/**
 * 422-05-T2 — every no-probe-model gap, reached for free and disclosed without a secret.
 *
 * THE GAPS ARE THE COMMON CASE, NOT THE ERROR CASE. Most hosts running an adversarial refresh
 * today have no second family with a credential, and the demo host as shipped is one of them.
 * So each gap has to cost nothing: `afterEach` asserts that no model was constructed, no
 * provider call was made and no authenticated fetch ran, on EVERY path below — a host that
 * cannot author probes must learn that from local configuration alone.
 *
 * PRECEDENCE IS ORDERED FROM THE MOST GENERAL CAUSE TO THE MOST SPECIFIC, so a host reads the
 * first thing it must fix rather than the last thing that failed. Nothing declared outranks
 * nothing credentialed, which outranks nothing family-disjoint. The cells pin each boundary with
 * a fixture that satisfies everything above it, so a reordering cannot pass.
 *
 * AND THE REASON IS NOT A FOURTH WORD. An entry whose family the resolver cannot place is
 * INELIGIBLE and says so in its own masked diagnostic — but the host's situation is still one of
 * the three, so the gap it lands under is one of the three. Every assertion below reads the
 * reason out of the neutral `NO_PROBE_MODEL_REASONS` vocabulary rather than a local literal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import * as model from '@vostride/agent-qa-model'
import * as ai from 'ai'
import { NO_PROBE_MODEL_REASONS, type NoProbeModelGap } from '@vostride/agent-qa-eval'
import * as composition from '../eval-session-composition.js'
import * as llm from '../llm-utils.js'
import { resolveAdversarialProbeCapability } from '../adversarial-probe-preflight.js'

vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(),
  generateText: vi.fn(() => {
    throw new Error('a capability gap reached a provider')
  }),
}))

const secret = 'fixture-preflight-credential-42205'
const authFetch = vi.fn<typeof fetch>()

/**
 * The demo host's registry, shape for shape: an openai-family planner, a same-family judge, and
 * a Claude entry with no credential. `gemini` and `unknown` are the extra fixtures the
 * precedence and unknown-family cells need.
 */
const configs: llm.NamedLLMConfigLike[] = [
  { name: 'codex', provider: 'openai-compatible', model: 'gpt-5.6-terra', vision: true },
  { name: 'judge', provider: 'openai-compatible', model: 'gpt-5.6-sol', vision: true },
  {
    name: 'claude', provider: 'anthropic-compatible', model: 'claude-sonnet-4-6',
    baseURL: 'https://api.anthropic.com', vision: true,
  },
  { name: 'gemini', provider: 'gemini', model: 'gemini-2.5' },
  { name: 'unknown', provider: 'openai-compatible', model: 'unclassified' },
]

function session(evalConfig: composition.EvalCliConfig = {}): composition.EvalSession {
  return {
    config: AgentQaConfigSchema.parse({
      workspace: {
        testMatch: ['tests/*.yaml'], suiteMatch: ['suites/*.yaml'],
        hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: 'fixture.secrets',
      },
      registry: {
        llms: configs.map(row => ({ ...row, baseURL: row.baseURL ?? 'http://127.0.0.1:1/v1' })),
      },
      use: { llm: 'codex', mobile: { appState: 'preserve' } },
    }),
    evalConfig,
    configPath: '/fixture/agent-qa.config.yaml',
    configDir: '/fixture',
    executionContext: {} as composition.EvalSession['executionContext'],
    maskingContextFactory: () => buildRunMaskingContext({ env: { FIXTURE_SECRET: secret } }),
  }
}

const named = vi.fn<typeof llm.resolveNamedConfig>()
const auth = vi.fn<typeof llm.resolveModelAuth>()
const deps = { resolveNamedConfig: named, resolveModelAuth: auth }

const withCredential = (name: string): llm.ResolvedLLMAuth =>
  ({ kind: 'api-key', credentialKey: name, provider: 'anthropic-compatible', apiKey: secret })
const withoutCredential = (name: string): llm.ResolvedLLMAuth =>
  ({ kind: 'missing', credentialKey: name, provider: 'anthropic-compatible', required: true, message: secret })

async function gapFor(evalConfig: composition.EvalCliConfig) {
  const capability = await resolveAdversarialProbeCapability(session(evalConfig), deps)
  if (capability.kind !== 'no-probe-model') {
    throw new Error(`expected a capability gap, got ${capability.kind}`)
  }
  // Read as the NEUTRAL DTO: what a report, a checkpoint and a chain line all receive.
  const gap: NoProbeModelGap = { kind: capability.kind, reason: capability.reason }
  expect(NO_PROBE_MODEL_REASONS).toContain(gap.reason)
  expect(JSON.stringify(capability)).not.toContain(secret)
  return capability
}

beforeEach(() => {
  named.mockReset().mockImplementation(async name => {
    const config = configs.find(row => row.name === name)
    if (!config) throw new Error(`sensitive provider detail ${secret}`)
    return { config, allConfigs: configs, defaultName: 'codex' }
  })
  auth.mockReset().mockImplementation(async name => withCredential(name))
  vi.spyOn(model, 'createModel').mockImplementation(() => {
    throw new Error('a capability gap constructed a model')
  })
  vi.mocked(ai.generateText).mockClear()
  authFetch.mockClear()
})

afterEach(() => {
  expect(model.createModel).not.toHaveBeenCalled()
  expect(ai.generateText).not.toHaveBeenCalled()
  expect(authFetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('422-05 deterministic zero-call capability gaps', () => {
  it('names each unavailable pool from the pinned vocabulary and spends nothing', async () => {
    // 1. Nothing declared. The registry is never read and no credential store is opened.
    const undeclared = await gapFor({})
    expect(undeclared.reason).toBe('panel-not-configured')
    expect(undeclared.entries).toEqual([])
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()

    // 2. Declared, and NOT ONE entry has a credential. Two declarations that would be eligible
    //    on family alone, so only the credential arm can be what refuses them.
    auth.mockImplementation(async name => withoutCredential(name))
    const uncredentialed = await gapFor({ judges: ['claude', 'gemini'] })
    expect(uncredentialed.reason).toBe('no-credential')
    expect(uncredentialed.entries).toMatchObject([
      { index: 0, name: 'claude', credential: 'missing', failures: ['no-credential'] },
      { index: 1, name: 'gemini', credential: 'missing', failures: ['no-credential'] },
    ])

    // 3. Credentialed, and every entry is the planner's own family.
    auth.mockImplementation(async name => withCredential(name))
    const sameFamily = await gapFor({ judges: ['judge', 'codex'] })
    expect(sameFamily.reason).toBe('single-family-host')
    expect(sameFamily.entries.every(entry => entry.credential === 'present')).toBe(true)
    expect(sameFamily.entries.every(entry =>
      entry.failures.includes('replay-family-collision'))).toBe(true)
  })

  it('returns single-family-host for the demo configuration shape', async () => {
    // The demo host exactly as shipped: `codex` plans, `judge` is credentialed but shares the
    // planner family, and `claude` — the entry that WOULD be eligible — has no credential.
    // One credentialed member exists, so this is not a no-credential host; none is
    // family-disjoint, so no probe may be authored. The moment a Claude credential appears the
    // same declaration flips to a real author, and nothing else has to change.
    auth.mockImplementation(async name =>
      name === 'claude' ? withoutCredential(name) : withCredential(name))
    const capability = await gapFor({ judges: ['judge', 'claude'] })
    expect(capability.reason).toBe('single-family-host')
    expect(capability.entries).toMatchObject([
      { index: 0, name: 'judge', credential: 'present', failures: ['replay-family-collision'] },
      { index: 1, name: 'claude', credential: 'missing', failures: ['no-credential'] },
    ])
    expect(auth.mock.calls.map(call => call[0])).toEqual(['judge', 'claude'])
    expect(named.mock.calls.every(call => call[2]?.keyOnly === true)).toBe(true)
  })

  it('treats an unplaceable family as ineligible under an existing reason, never a new one', async () => {
    const capability = await gapFor({ judges: ['unknown'] })
    expect(capability.reason).toBe('single-family-host')
    expect(capability.entries).toMatchObject([
      { index: 0, name: 'unknown', credential: 'present', failures: ['unknown-family'] },
    ])
    // The diagnostic says WHICH way it was ineligible; the gap still says what the host must do.
    expect(capability.entries[0]!.failures).not.toContain('replay-family-collision')
  })

  it('keeps precedence ordered when the causes overlap', async () => {
    // A same-family entry AND an uncredentialed entry at once. Every entry lacking a credential
    // is what `no-credential` means here, and this host has one — so the more specific reason
    // is the true one, which is the opposite of the whole-panel preflight's answer.
    auth.mockImplementation(async name =>
      name === 'judge' ? withCredential(name) : withoutCredential(name))
    expect((await gapFor({ judges: ['judge', 'gemini'] })).reason).toBe('single-family-host')

    // Remove the last credential and the general cause takes over again.
    auth.mockImplementation(async name => withoutCredential(name))
    expect((await gapFor({ judges: ['judge', 'gemini'] })).reason).toBe('no-credential')
  })

  it('masks every disclosure, including a name a later entry teaches it to mask', async () => {
    auth.mockImplementation(async () => ({
      kind: 'bearer-token', credentialKey: 'claude', provider: 'anthropic-compatible',
      token: secret,
    }))
    const capability = await gapFor({ judges: [secret, 'judge'] })
    expect(capability.reason).toBe('single-family-host')
    expect(capability.entries[0]).toMatchObject({
      index: 0, credential: 'resolution-failed', failures: ['config-unresolved', 'no-credential'],
    })
    // The unresolvable entry was NAMED with the credential a later entry then registered; the
    // masker runs after every registration for exactly this case.
    expect(capability.entries[0]!.name).not.toBe(secret)
    expect(JSON.stringify(capability)).not.toContain(secret)
  })

  it('refuses an unresolvable replay planner with safe text and no planner credential', async () => {
    named.mockImplementation(async name => {
      if (name === 'codex') throw new Error(`provider details ${secret}`)
      return { config: configs.find(row => row.name === name)!, allConfigs: configs, defaultName: 'codex' }
    })
    // Without the planner id there is no family to be disjoint FROM, so there is no honest gap
    // to report — the refusal is the answer, and it forwards none of the resolver's text.
    const refusal = await resolveAdversarialProbeCapability(session({ judges: ['claude'] }), deps)
      .then(() => undefined, (error: unknown) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).toBe(
      'Cannot resolve the replay profile for adversarial probe preflight. Check use.llm and its registry.llms entry.',
    )
    expect((refusal as Error).message).not.toContain(secret)
    expect(auth.mock.calls.map(call => call[0])).toEqual(['claude'])
  })

  it('preserves the typed declaration refusal before any resolution', async () => {
    await expect(resolveAdversarialProbeCapability(session({ judge: 'claude', judges: ['judge'] }), deps))
      .rejects.toBeInstanceOf(composition.EvalJudgeDeclarationError)
    expect(named).not.toHaveBeenCalled()
    expect(auth).not.toHaveBeenCalled()
  })
})
