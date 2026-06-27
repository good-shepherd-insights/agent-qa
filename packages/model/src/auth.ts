import type { ModelProfile } from '@vostride/agent-qa-schema'

export type ResolvedModelAuth =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'bearer-token'; token: string }
  | {
      kind: 'auth-fetch'
      modelAdapter: 'openai-responses' | 'anthropic-messages'
      fetch: typeof globalThis.fetch
    }
  | { kind: 'none' }

export interface Transport {
  baseURL?: string
  headers?: Record<string, string>
  apiKey?: string
  authToken?: string
  fetch?: typeof globalThis.fetch
}

export function deriveTransport(profile: ModelProfile, auth: ResolvedModelAuth): Transport {
  const transport: Transport = {
    ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    ...(profile.headers ? { headers: profile.headers } : {}),
  }

  switch (auth.kind) {
    case 'api-key':
      return { ...transport, apiKey: auth.apiKey }
    case 'bearer-token':
      return { ...transport, authToken: auth.token }
    case 'auth-fetch':
      return { ...transport, apiKey: placeholderApiKey(profile.provider), fetch: auth.fetch }
    case 'none':
      return { ...transport, apiKey: placeholderApiKey(profile.provider) }
  }
}

function placeholderApiKey(provider: string): string {
  switch (provider) {
    case 'openai-compatible':
      return 'openai-compatible'
    case 'anthropic-compatible':
      return 'anthropic-compatible'
    default:
      return 'placeholder'
  }
}
