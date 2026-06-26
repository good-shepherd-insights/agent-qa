import { createGoogleGenerativeAI } from '@ai-sdk/google'

import type { LanguageModelV3 } from '@ai-sdk/provider'

import type { Transport } from '../auth.js'

export function gemini(transport: Transport, modelId: string): LanguageModelV3 {
  return createGoogleGenerativeAI({
    apiKey: transport.apiKey,
    fetch: transport.fetch,
  })(modelId)
}
