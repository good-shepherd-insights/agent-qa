import { createAnthropic } from '@ai-sdk/anthropic'

import type { LanguageModelV3 } from '@ai-sdk/provider'

import type { Transport } from '../auth.js'

export function anthropicCompatible(transport: Transport, modelId: string): LanguageModelV3 {
  return createAnthropic({
    baseURL: transport.baseURL,
    headers: transport.headers,
    fetch: transport.fetch,
    ...(transport.authToken
      ? { authToken: transport.authToken }
      : { apiKey: transport.apiKey ?? 'anthropic-compatible' }),
  })(modelId)
}

export function anthropicSubscription(transport: Transport, modelId: string): LanguageModelV3 {
  return createAnthropic({
    apiKey: transport.apiKey ?? 'placeholder',
    fetch: transport.fetch,
  })(modelId)
}
