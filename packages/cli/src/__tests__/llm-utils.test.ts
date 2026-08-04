import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vostride/agent-qa-core', () => ({
  getCredential: vi.fn(),
  resolveLLMAuth: vi.fn(),
  writeAuth: vi.fn(() => Promise.resolve()),
}))

vi.mock('../config.js', () => ({
  loadConfigFile: vi.fn(),
}))

import { readFileSync } from 'node:fs'

import { getCredential, resolveLLMAuth } from '@vostride/agent-qa-core'
import { createModel } from '@vostride/agent-qa-model'
import { loadConfigFile } from '../config.js'
import {
  applyResolvedAuthToModelConfig,
  buildAnalysisTokenBudget,
  buildJobModelCapability,
  resolveLLMModels,
  resolveCredentials,
  resolveModelAuth,
  resolveNamedConfig,
} from '../llm-utils.js'

import type { JobModelCapabilityDeps } from '../llm-utils.js'
import type { ModelCapabilities } from '@vostride/agent-qa-schema'
import type { ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'
import type { generateText } from 'ai'

const mockGetCredential = vi.mocked(getCredential)
const mockResolveLLMAuth = vi.mocked(resolveLLMAuth)
const mockLoadConfigFile = vi.mocked(loadConfigFile)

const PROVIDER_MODES = [
  'openai-compatible',
  'anthropic-compatible',
  'openai-subscription',
  'anthropic-subscription',
  'gemini',
] as const

const DECOY_FALLBACK_KEYS = [
  'anthropic-compatible',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_KEY',
  'remote.example',
] as const

describe('resolveCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads named configs from the provided config path', async () => {
    mockLoadConfigFile.mockResolvedValueOnce({
      registry: {
        llms: [{
          name: 'planner',
          provider: 'openai-compatible',
          model: 'deepseek-chat',
          baseURL: 'https://remote.example/api/v1',
        }],
      },
      use: { llm: 'planner' },
    })

    const resolved = await resolveNamedConfig(undefined, 'custom-agent-qa.yaml')

    expect(mockLoadConfigFile).toHaveBeenCalledWith('custom-agent-qa.yaml')
    expect(resolved.config).toMatchObject({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseURL: 'https://remote.example/api/v1',
    })
  })

  it('resolves model auth through the core resolver with the named config', async () => {
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'api-key',
      credentialKey: 'planner',
      provider: 'openai-compatible',
      apiKey: 'sk-planner',
    })

    const auth = await resolveModelAuth('planner', {
      provider: 'openai-compatible',
      model: 'gpt-4.1',
      baseURL: 'https://remote.example/api/v1',
    })

    expect(auth).toEqual(expect.objectContaining({
      kind: 'api-key',
      credentialKey: 'planner',
      apiKey: 'sk-planner',
    }))
    expect(mockResolveLLMAuth).toHaveBeenCalledWith('planner', {
      provider: 'openai-compatible',
      model: 'gpt-4.1',
      baseURL: 'https://remote.example/api/v1',
    })
  })

  it('applies bearer tokens and providerHeaders to runtime model config without apiKey', () => {
    const runtimeConfig = applyResolvedAuthToModelConfig(
      {
        provider: 'anthropic-compatible',
        model: 'claude-remote',
        baseURL: 'https://anthropic.example/messages',
        providerHeaders: { 'x-workspace': 'agent-qa' },
      },
      {
        kind: 'bearer-token',
        credentialKey: 'planner',
        provider: 'anthropic-compatible',
        token: 'bearer-planner',
      },
    )

    expect(runtimeConfig).toEqual({
      provider: 'anthropic-compatible',
      model: 'claude-remote',
      baseURL: 'https://anthropic.example/messages',
      providerHeaders: { 'x-workspace': 'agent-qa' },
      authToken: 'bearer-planner',
    })
    expect(runtimeConfig).not.toHaveProperty('apiKey')
  })

  it('throws resolver missing messages before model config creation', () => {
    expect(() => applyResolvedAuthToModelConfig(
      {
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
      },
      {
        kind: 'missing',
        credentialKey: 'gemini-fast',
        provider: 'gemini',
        required: true,
        message: 'Save a Gemini API key for this config before testing.',
      },
    )).toThrow('Save a Gemini API key for this config before testing.')
  })

  it.each(PROVIDER_MODES)('resolves %s credentials through core resolveLLMAuth by config name only', async (provider) => {
    const authFetch = vi.fn() as unknown as typeof globalThis.fetch
    mockResolveLLMAuth.mockResolvedValue(
      provider === 'anthropic-compatible'
        ? {
            kind: 'bearer-token',
            credentialKey: 'planner',
            provider: 'anthropic-compatible',
            token: 'bearer-planner',
          }
        : provider.endsWith('-subscription')
          ? {
              kind: 'auth-fetch',
              credentialKey: 'planner',
              provider: provider as 'openai-subscription' | 'anthropic-subscription',
              modelAdapter: provider === 'openai-subscription' ? 'openai-responses' : 'anthropic-messages',
              fetch: authFetch,
            }
          : provider === 'gemini'
            ? {
                kind: 'api-key',
                credentialKey: 'planner',
                provider,
                apiKey: 'gemini-planner',
              }
            : {
                kind: 'api-key',
                credentialKey: 'planner',
                provider,
                apiKey: 'sk-planner',
              },
    )

    await resolveCredentials('planner', {
      provider,
      baseURL: provider.includes('compatible') ? 'https://remote.example/api/v1' : undefined,
    } as any)

    expect(mockResolveLLMAuth).toHaveBeenCalledWith(
      'planner',
      expect.objectContaining({ provider }),
    )
    expect(mockGetCredential).not.toHaveBeenCalledWith(expect.not.stringMatching(/^planner$/))
  })

  it('does not query provider env or host fallback credential keys', async () => {
    mockGetCredential.mockImplementation(async (name: string) => {
      if ((DECOY_FALLBACK_KEYS as readonly string[]).includes(name)) {
        return { type: 'api' as const, provider: 'openai-compatible', key: 'sk-shared' }
      }
      return null
    })
    mockResolveLLMAuth.mockResolvedValue({
      kind: 'unauthenticated',
      credentialKey: 'planner',
      provider: 'anthropic-compatible',
      optional: true,
      message: 'Testing without a saved credential.',
    })

    const result = await resolveCredentials('planner', {
      provider: 'anthropic-compatible',
      baseURL: 'https://remote.example/api/v1',
    } as any)

    expect(result).toEqual({})
    for (const decoy of DECOY_FALLBACK_KEYS) {
      expect(mockGetCredential).not.toHaveBeenCalledWith(decoy)
    }
  })
})

describe('resolveLLMModels', () => {
  it('uses the current Claude fallback when config has no selected LLM', () => {
    const resolved = resolveLLMModels({})

    expect(resolved.configName).toBe('')
    expect(resolved.planner).toEqual({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-6',
    })
    expect(resolved.verifier).toEqual({
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4-6',
    })
  })

  it('uses the current Claude fallback when the selected LLM is missing', () => {
    const resolved = resolveLLMModels({
      registry: {
        llms: [{
          name: 'configured',
          provider: 'openai-compatible',
          model: 'deepseek-chat',
          baseURL: 'https://remote.example/api/v1',
        }],
      },
      use: { llm: 'missing' },
    })

    expect(resolved.configName).toBe('')
    expect(resolved.planner.model).toBe('claude-sonnet-4-6')
    expect(resolved.verifier.model).toBe('claude-sonnet-4-6')
  })

  it('preserves explicit named model configs', () => {
    const resolved = resolveLLMModels({
      registry: {
        llms: [{
          name: 'configured',
          provider: 'openai-compatible',
          model: 'deepseek-chat',
          baseURL: 'https://remote.example/api/v1',
        }],
      },
      use: { llm: 'configured' },
    })

    expect(resolved.configName).toBe('configured')
    expect(resolved.planner).toEqual({
      provider: 'openai-compatible',
      model: 'deepseek-chat',
      baseURL: 'https://remote.example/api/v1',
    })
    expect(resolved.verifier).toEqual(resolved.planner)
  })
})

// ————— 389-06: the analysis token budget + the D-02 vision leg + the CR-02 mechanism pin —————

const BUDGET_CAPABILITIES: ModelCapabilities = {
  text: true,
  vision: false,
  visionToolMessages: false,
  toolCalling: false,
  structuredOutput: false,
  streaming: false,
  contextWindow: 1_000,
  maxOutput: 200,
}

const JOB_PROFILE: ModelProfile = {
  provider: 'openai-compatible',
  model: 'job-model',
  auth: { mode: 'none' },
}

const NONE_AUTH: ResolvedModelAuth = { kind: 'none' }

function visionDeps(vision: boolean): {
  calls: Record<string, unknown>[]
  resolveCalls: ModelProfile[]
  deps: JobModelCapabilityDeps
} {
  const calls: Record<string, unknown>[] = []
  const resolveCalls: ModelProfile[] = []
  return {
    calls,
    resolveCalls,
    deps: {
      createModelImpl: (() => ({})) as unknown as typeof createModel,
      resolveCapabilitiesImpl: (profile: ModelProfile) => {
        resolveCalls.push(profile)
        return { ...BUDGET_CAPABILITIES, vision }
      },
      generateTextImpl: (async (args: Record<string, unknown>) => {
        calls.push(args)
        return { text: 'answered' }
      }) as unknown as typeof generateText,
    },
  }
}

describe('buildAnalysisTokenBudget (389-06, D-01/386 D-15)', () => {
  it('derives estimate and inputBudget from the SAME profile resolution as the model capability', () => {
    const { resolveCalls, deps } = visionDeps(false)

    const budget = buildAnalysisTokenBudget(JOB_PROFILE, deps)
    buildJobModelCapability(JOB_PROFILE, NONE_AUTH, deps)

    // One source of truth: both builders consulted the capability resolver with the
    // IDENTICAL profile object — no second config, no re-spelled ceiling.
    expect(resolveCalls.length).toBeGreaterThanOrEqual(2)
    for (const seen of resolveCalls) expect(seen).toBe(JOB_PROFILE)

    // The input budget is the context window minus the output reservation the SAME
    // accounting charges the model call with.
    expect(budget.inputBudget).toBe(1_000 - 200)
    // The estimator is the accounting's own (chars/4 over one text part).
    expect(budget.estimate('a'.repeat(400))).toBe(100)
  })
})

describe('buildJobModelCapability vision (389-06, D-02/L9/v46)', () => {
  const IMAGE_A = new Uint8Array([1, 2, 3])
  const IMAGE_B = new Uint8Array([4, 5, 6])

  it('surfaces vision from the same resolveCapabilities the accounting consults', () => {
    expect(buildJobModelCapability(JOB_PROFILE, NONE_AUTH, visionDeps(true).deps).vision).toBe(true)
    expect(buildJobModelCapability(JOB_PROFILE, NONE_AUTH, visionDeps(false).deps).vision).toBe(false)
  })

  it('attaches image parts through the messages form when the gate allows (D-02)', async () => {
    const { calls, deps } = visionDeps(true)
    const capability = buildJobModelCapability(JOB_PROFILE, NONE_AUTH, deps)

    await capability.generate({ system: 'sys', prompt: 'explain', images: [IMAGE_A, IMAGE_B] })

    expect(calls).toHaveLength(1)
    const args = calls[0]!
    // The verifier turn-message precedent: ONE user message, one text part (the prompt)
    // plus one image part per entry; system unchanged; the prompt form absent.
    expect(args.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'explain' },
          { type: 'image', image: IMAGE_A },
          { type: 'image', image: IMAGE_B },
        ],
      },
    ])
    expect(args).not.toHaveProperty('prompt')
    expect(args.system).toBe('sys')
    expect(args).toMatchObject({ maxRetries: 0, temperature: 0, maxOutputTokens: 200 })
  })

  it('strips images to the byte-identical text call against a text-only model (L9)', async () => {
    const { calls, deps } = visionDeps(false)
    const capability = buildJobModelCapability(JOB_PROFILE, NONE_AUTH, deps)

    await capability.generate({ prompt: 'explain', images: [IMAGE_A] })
    await capability.generate({ prompt: 'explain' })

    // The gate is enforced at the host boundary (L9): a mis-gated caller's images strip
    // to EXACTLY the call a plain text request produces — not a variant of it.
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
    expect(calls[0]).not.toHaveProperty('messages')
    expect(calls[0]).toHaveProperty('prompt', 'explain')
  })

  it('keeps text-only requests byte-identical to the pre-vision call shape', async () => {
    const { calls, deps } = visionDeps(true)
    const capability = buildJobModelCapability(JOB_PROFILE, NONE_AUTH, deps)

    await capability.generate({ system: 'sys', prompt: 'explain' })

    expect(calls[0]).toEqual({
      model: {},
      maxRetries: 0,
      temperature: 0,
      maxOutputTokens: 200,
      system: 'sys',
      prompt: 'explain',
    })
  })
})

describe('the daemon egress mechanism (388 CR-02, verified parity)', () => {
  it("passes createModel's pinned-last masking seam with NO active scope — the daemon posture", async () => {
    // The daemon pumps outside any runSafetyScope. What protects its author egress is that
    // the masking seam lives INSIDE createModel's middleware chain (pinned last), which
    // both hosts reach through this same builder — with no active masking context the
    // residual guardrail redaction still fires at the provider boundary.
    const secret = 'sk-live-abcdef0123456789'
    let captured: { prompt?: { role: string; content: { type: string; text?: string }[] }[] } | undefined

    const capturingCreateModel: typeof createModel = (profile, auth) =>
      createModel(profile, auth, {
        languageModels: {
          'job-model': {
            specificationVersion: 'v3',
            provider: 'stub',
            modelId: 'stub',
            supportedUrls: {},
            async doGenerate(params: unknown) {
              captured = params as typeof captured
              return {
                content: [],
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: {
                  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 0, text: 0, reasoning: 0 },
                },
                warnings: [],
              }
            },
            async doStream() {
              return { stream: new ReadableStream() }
            },
          } as never,
        },
      })

    const capability = buildJobModelCapability(
      { ...JOB_PROFILE, baseURL: 'http://localhost:11434/v1' },
      NONE_AUTH,
      { createModelImpl: capturingCreateModel },
    )

    await capability.generate({ prompt: `use ${secret}` })

    const text = captured?.prompt
      ?.find((message) => message.role === 'user')
      ?.content.find((part) => part.type === 'text')?.text
    expect(text).toContain('<REDACTED:apiKey>')
    expect(text).not.toContain(secret)
  })

  it('the daemon binding names 388 CR-02 and rides the same scoped builder (source pin)', () => {
    const source = readFileSync(new URL('../commands/daemon.ts', import.meta.url), 'utf8')
    expect(source.split('388 CR-02').length - 1).toBeGreaterThanOrEqual(1)
    expect(source).toContain('resolveCliJobModel(configPath)')
    expect(source).toContain('resolveCliAnalysisTokenBudget')
  })

  it('the CLI host supplies the budget beside the model binding (source pin)', () => {
    const source = readFileSync(
      new URL('../composition/local-agent-host.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('resolveCliAnalysisTokenBudget')
  })
})
