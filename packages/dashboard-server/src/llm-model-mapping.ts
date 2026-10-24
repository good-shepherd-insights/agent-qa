import { getProviderOptions } from '@vostride/agent-qa-model'

import type { ModelAuthDeclaration, ModelProfile, ResolvedModelAuth } from '@vostride/agent-qa-model'

type ModelAdapter = 'openai-responses' | 'anthropic-messages'

export interface DashboardLLMConfig {
  provider: string
  model: string
  baseURL?: string
  providerHeaders?: Record<string, string>
  apiKey?: string
  authToken?: string
  modelAdapter?: ModelAdapter
}

export type DashboardResolvedAuth =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'bearer-token'; token: string }
  | { kind: 'auth-fetch'; fetch: typeof globalThis.fetch; modelAdapter: ModelAdapter }
  | { kind: 'unauthenticated'; message?: string }
  | { kind: 'missing'; message: string }
  | ResolvedModelAuth

export function toModelProfileAndAuth(
  llmConfig: DashboardLLMConfig,
  resolvedAuth: DashboardResolvedAuth,
): { profile: ModelProfile; auth: ResolvedModelAuth } {
  if (resolvedAuth.kind === 'missing') {
    throw new Error(resolvedAuth.message)
  }

  const auth = toResolvedModelAuth(resolvedAuth)
  const providerOptions = getProviderOptions({
    provider: llmConfig.provider,
    modelAdapter: auth.kind === 'auth-fetch' ? auth.modelAdapter : llmConfig.modelAdapter,
    fetch: auth.kind === 'auth-fetch' ? auth.fetch : undefined,
  })

  const profile: ModelProfile = {
    provider: llmConfig.provider,
    model: llmConfig.model,
    ...(llmConfig.baseURL !== undefined ? { baseURL: llmConfig.baseURL } : {}),
    ...(llmConfig.providerHeaders !== undefined ? { headers: llmConfig.providerHeaders } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    auth: toAuthDeclaration(auth),
  }

  return { profile, auth }
}

export function authFromFetch(
  provider: string,
  authFetch?: typeof globalThis.fetch,
): ResolvedModelAuth {
  if (authFetch) {
    return {
      kind: 'auth-fetch',
      modelAdapter: adapterForProvider(provider),
      fetch: authFetch,
    }
  }
  return { kind: 'none' }
}

export function authFromRuntimeConfig(
  llmConfig: Pick<DashboardLLMConfig, 'apiKey' | 'authToken'>,
  fallback: ResolvedModelAuth = { kind: 'none' },
): ResolvedModelAuth {
  if (fallback.kind !== 'none') return fallback
  if (llmConfig.apiKey) return { kind: 'api-key', apiKey: llmConfig.apiKey }
  if (llmConfig.authToken) return { kind: 'bearer-token', token: llmConfig.authToken }
  return fallback
}

function toResolvedModelAuth(auth: DashboardResolvedAuth): ResolvedModelAuth {
  switch (auth.kind) {
    case 'api-key':
      return { kind: 'api-key', apiKey: auth.apiKey }
    case 'bearer-token':
      return { kind: 'bearer-token', token: auth.token }
    case 'auth-fetch':
      return { kind: 'auth-fetch', modelAdapter: auth.modelAdapter, fetch: auth.fetch }
    case 'unauthenticated':
    case 'none':
      return { kind: 'none' }
    case 'missing':
      throw new Error(auth.message)
  }
}

function toAuthDeclaration(auth: ResolvedModelAuth): ModelAuthDeclaration {
  switch (auth.kind) {
    case 'api-key':
      return { mode: 'api-key' }
    case 'bearer-token':
      return { mode: 'bearer-token' }
    case 'auth-fetch':
      return { mode: 'subscription', plugin: auth.modelAdapter }
    case 'none':
      return { mode: 'none' }
  }
}

function adapterForProvider(provider: string): ModelAdapter {
  if (provider === 'anthropic-subscription') return 'anthropic-messages'
  return 'openai-responses'
}
