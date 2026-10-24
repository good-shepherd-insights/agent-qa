import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'

// RUNX-01 (real, live-captured 400). The codex/ChatGPT-subscription Responses backend
// rejects certain SDK-level call params: it returns HTTP 400
// `{"detail":"Unsupported parameter: max_output_tokens"}` when the openai-responses
// adapter serializes `maxOutputTokens` to the wire `max_output_tokens`. This provider-
// scoped, data-driven egress transform deletes exactly the params a provider declares as
// unsupported (via `ProviderDescriptor.unsupportedParams`) just before the wire, so
// Anthropic / standard OpenAI-compatible endpoints — which support the output cap — keep
// it. A future surfaced-unsupported param is a one-line descriptor change.

export function stripUnsupportedParamsMiddleware(params: readonly string[]): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params: callOptions }) => {
      const present = params.filter((name) => name in (callOptions as Record<string, unknown>))
      if (present.length === 0) return callOptions
      const next = { ...(callOptions as Record<string, unknown>) }
      for (const name of present) {
        delete next[name]
      }
      return next as LanguageModelV3CallOptions
    },
  }
}
