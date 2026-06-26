import type { ModelCapabilities } from '../capability/index'

export type ModelProviderId =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'openai-subscription'
  | 'anthropic-subscription'
  | 'gemini'

export type ModelAuthDeclaration =
  | { mode: 'api-key' }
  | { mode: 'bearer-token' }
  | { mode: 'subscription'; plugin: string }
  | { mode: 'none' }

export interface ModelProfile {
  provider: ModelProviderId
  model: string
  baseURL?: string
  headers?: Record<string, string>
  providerOptions?: Record<string, Record<string, unknown>>
  capabilities?: ModelCapabilities
  auth: ModelAuthDeclaration
}
