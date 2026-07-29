import { dirname, resolve as resolvePath } from 'node:path'
import { createModel, createTokenAccounting, getProviderOptions, resolveCapabilities } from '@vostride/agent-qa-model'
import { generateText } from 'ai'
import { DEFAULT_ANTHROPIC_MODEL } from './model-defaults.js'
import { loadProviderPluginsForRawConfig } from './provider-plugins.js'

import type { JobModelCapability } from '@vostride/agent-qa-agent'
import type { ModelAuthDeclaration, ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'

export { loadProviderPluginsForRawConfig }

export type BuiltInLLMProviderMode =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'openai-subscription'
  | 'anthropic-subscription'
  | 'gemini'

export type LLMProviderMode = BuiltInLLMProviderMode | (string & {})

export type LLMModelAdapter = 'openai-responses' | 'anthropic-messages'

export type ResolvedLLMAuth =
  | { kind: 'api-key'; credentialKey: string; provider: BuiltInLLMProviderMode; apiKey: string }
  | { kind: 'bearer-token'; credentialKey: string; provider: 'anthropic-compatible'; token: string }
  | {
    kind: 'auth-fetch'
    credentialKey: string
    provider: string
    modelAdapter: LLMModelAdapter
    fetch: typeof globalThis.fetch
    expires?: number
  }
  | {
    kind: 'unauthenticated'
    credentialKey: string
    provider: 'openai-compatible' | 'anthropic-compatible'
    optional: true
    message: string
  }
  | {
    kind: 'missing'
    credentialKey: string
    provider: string
    required: true
    message: string
  }

export type LLMConfigLike = {
  provider: LLMProviderMode
  model: string
  baseURL?: string
  providerHeaders?: Record<string, string>
  vision?: boolean
  contextWindow?: number
}

export type NamedLLMConfigLike = LLMConfigLike & {
  name: string
}

export type RuntimeModelConfigLike = LLMConfigLike & {
  apiKey?: string
  authToken?: string
  fetch?: typeof globalThis.fetch
  modelAdapter?: LLMModelAdapter
  contextWindow?: number
}

function normalizeLLMConfig(raw: NamedLLMConfigLike & Record<string, unknown>): NamedLLMConfigLike {
  return {
    name: raw.name,
    provider: raw.provider,
    model: raw.model,
    ...(raw.baseURL !== undefined ? { baseURL: raw.baseURL } : {}),
    ...(raw.providerHeaders !== undefined ? { providerHeaders: raw.providerHeaders } : {}),
    ...(raw.vision !== undefined ? { vision: raw.vision } : {}),
    ...(raw.contextWindow !== undefined ? { contextWindow: raw.contextWindow } : {}),
  }
}

export async function loadAuthPluginsForRawConfig(raw: unknown, configPath = 'agent-qa.config.yaml'): Promise<void> {
  const declarations = (raw as { plugins?: { auth?: unknown } } | null)?.plugins?.auth
  if (!Array.isArray(declarations) || declarations.length === 0) return

  const { loadLLMAuthPlugins } = await import('@vostride/agent-qa-core')
  await loadLLMAuthPlugins(declarations as Parameters<typeof loadLLMAuthPlugins>[0], {
    baseDir: dirname(resolvePath(configPath)),
  })
}

export async function resolveNamedConfig(
  configName?: string,
  configPath = 'agent-qa.config.yaml',
): Promise<{
  config: NamedLLMConfigLike
  allConfigs: NamedLLMConfigLike[]
  defaultName: string
}> {
  const { loadConfigFile } = await import('./config.js')
  const raw = (await loadConfigFile(configPath)) as Record<string, unknown> | null
  await loadAuthPluginsForRawConfig(raw, configPath)
  await loadProviderPluginsForRawConfig(raw, configPath)
  const llms = ((raw as any)?.registry?.llms as Array<NamedLLMConfigLike & Record<string, unknown>> | undefined)
    ?.map(normalizeLLMConfig)
  const defaultLLM = (raw as any)?.use?.llm as string | undefined

  if (!llms?.length) {
    throw new Error('No LLM configs found. Run `agent-qa init` to set up your config.')
  }

  const targetName = configName ?? defaultLLM
  if (!targetName) {
    throw new Error('No config name specified and no use.llm set in config.')
  }

  const found = llms.find(c => c.name === targetName)
  if (!found) {
    throw new Error(`Config "${targetName}" not found. Available: ${llms.map(c => c.name).join(', ')}`)
  }

  return { config: found, allConfigs: llms, defaultName: defaultLLM ?? '' }
}

export function resolveLLMModels(config: {
  registry?: { llms?: NamedLLMConfigLike[] }
  use?: { llm?: string }
}): {
  planner: LLMConfigLike
  verifier: LLMConfigLike
  configName: string
} {
  const defaults: LLMConfigLike = { provider: 'anthropic-subscription', model: DEFAULT_ANTHROPIC_MODEL }
  if (!config.registry?.llms || !config.use?.llm) {
    return { planner: defaults, verifier: defaults, configName: '' }
  }
  const found = config.registry.llms.find(c => c.name === config.use!.llm)
  if (!found) {
    return { planner: defaults, verifier: defaults, configName: '' }
  }
  const { name, ...modelFields } = normalizeLLMConfig(found as NamedLLMConfigLike & Record<string, unknown>)
  return { planner: modelFields, verifier: modelFields, configName: name }
}

export async function resolveModelAuth(
  configName: string,
  llmConfig: LLMConfigLike,
): Promise<ResolvedLLMAuth> {
  const { resolveLLMAuth } = await import('@vostride/agent-qa-core') as unknown as {
    resolveLLMAuth: (configName: string, llmConfig: LLMConfigLike) => Promise<ResolvedLLMAuth>
  }
  return resolveLLMAuth(configName, llmConfig)
}

export function applyResolvedAuthToModelConfig(
  llmConfig: LLMConfigLike,
  auth: ResolvedLLMAuth,
): RuntimeModelConfigLike {
  switch (auth.kind) {
    case 'api-key':
      return { ...llmConfig, apiKey: auth.apiKey }
    case 'bearer-token':
      return { ...llmConfig, authToken: auth.token }
    case 'auth-fetch':
      return { ...llmConfig, fetch: auth.fetch, modelAdapter: auth.modelAdapter }
    case 'unauthenticated':
      return { ...llmConfig }
    case 'missing':
      throw new Error(auth.message)
  }
}

export function toModelProfileAndAuth(
  llmConfig: LLMConfigLike,
  resolved: ResolvedLLMAuth,
): { profile: ModelProfile; auth: ResolvedModelAuth } {
  const providerOptions = getProviderOptions({
    provider: llmConfig.provider,
    modelAdapter: resolved.kind === 'auth-fetch' ? resolved.modelAdapter : undefined,
    fetch: resolved.kind === 'auth-fetch' ? resolved.fetch : undefined,
  })

  const profile: ModelProfile = {
    provider: llmConfig.provider,
    model: llmConfig.model,
    ...(llmConfig.baseURL !== undefined ? { baseURL: llmConfig.baseURL } : {}),
    ...(llmConfig.providerHeaders !== undefined ? { headers: llmConfig.providerHeaders } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    auth: toAuthDeclaration(resolved),
  }

  switch (resolved.kind) {
    case 'api-key':
      return { profile, auth: { kind: 'api-key', apiKey: resolved.apiKey } }
    case 'bearer-token':
      return { profile, auth: { kind: 'bearer-token', token: resolved.token } }
    case 'auth-fetch':
      return { profile, auth: { kind: 'auth-fetch', modelAdapter: resolved.modelAdapter, fetch: resolved.fetch } }
    case 'unauthenticated':
      return { profile, auth: { kind: 'none' } }
    case 'missing':
      throw new Error(resolved.message)
  }
}

function toAuthDeclaration(resolved: ResolvedLLMAuth): ModelAuthDeclaration {
  switch (resolved.kind) {
    case 'api-key':
      return { mode: 'api-key' }
    case 'bearer-token':
      return { mode: 'bearer-token' }
    case 'auth-fetch':
      return { mode: 'subscription', plugin: resolved.provider }
    case 'unauthenticated':
    case 'missing':
      return { mode: 'none' }
  }
}

/** Focused test seam for `buildJobModelCapability`. Production callers omit it. */
export interface JobModelCapabilityDeps {
  createModelImpl?: typeof createModel
  createTokenAccountingImpl?: typeof createTokenAccounting
  resolveCapabilitiesImpl?: typeof resolveCapabilities
  generateTextImpl?: typeof generateText
}

/**
 * Bind an already-resolved model profile as the job queue's authorship capability (385 plan 05,
 * D-10/D-11).
 *
 * `JobModelCapability` is three structural fields, so no provider name crosses into
 * `@vostride/agent-qa-agent` and the queue stays provider-neutral. What crosses instead is this
 * closure, and the provider call inside it is the SAME `createModel` → `generateText` chain a run
 * and the curation author use — the accountant's own ceiling for the output cap, zero temperature,
 * no retries, so an authored checkpoint records a deterministic answer rather than one that
 * depended on which attempt produced it.
 */
export function buildJobModelCapability(
  profile: ModelProfile,
  auth: ResolvedModelAuth,
  deps: JobModelCapabilityDeps = {},
): JobModelCapability {
  const model = (deps.createModelImpl ?? createModel)(profile, auth)
  const accounting = (deps.createTokenAccountingImpl ?? createTokenAccounting)({
    getCapabilities: () => (deps.resolveCapabilitiesImpl ?? resolveCapabilities)(profile),
  })
  const generate = deps.generateTextImpl ?? generateText

  return {
    modelId: `${profile.provider}:${profile.model}`,
    async generate(request) {
      const result = await generate({
        model,
        maxRetries: 0,
        temperature: 0,
        maxOutputTokens: accounting.getCeilings().maxOutput,
        ...(request.system === undefined ? {} : { system: request.system }),
        prompt: request.prompt,
      })
      return { text: result.text }
    },
  }
}

/**
 * The CLI's job-authorship capability, resolved from the project's configured default LLM.
 *
 * Called at most once per process, and only when a host actually opens the job queue — the
 * composition root takes it as a factory precisely so `agent-qa fn --list` never pays for an auth
 * resolution or brings a provider handle into existence.
 */
export async function resolveCliJobModel(
  configPath: string,
  deps: JobModelCapabilityDeps = {},
): Promise<JobModelCapability> {
  const { config } = await resolveNamedConfig(undefined, configPath)
  const resolved = await resolveModelAuth(config.name, config)
  const { profile, auth } = toModelProfileAndAuth(config, resolved)
  return buildJobModelCapability(profile, auth, deps)
}

export async function resolveCredentials(
  configName: string,
  llmConfig: LLMConfigLike,
): Promise<{ apiKey?: string; authToken?: string; authFetch?: typeof globalThis.fetch }> {
  try {
    const auth = await resolveModelAuth(configName, llmConfig)
    if (auth.kind === 'api-key') return { apiKey: auth.apiKey }
    if (auth.kind === 'bearer-token') return { authToken: auth.token }
    if (auth.kind === 'auth-fetch') return { authFetch: auth.fetch }
    return {}
  } catch {
    return {}
  }
}
