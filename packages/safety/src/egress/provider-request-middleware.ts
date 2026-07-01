import type { LanguageModelMiddleware } from 'ai'

import type { GuardrailStreamScanFactory } from '../guardrail/stream-scan'
import type { HookRegistry } from '../hooks/registry'

export function createProviderRequestMiddleware(
  registry: HookRegistry,
  streamScan?: GuardrailStreamScanFactory,
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => registry.runProviderRequest(params),
    wrapGenerate: async ({ doGenerate }) => doGenerate(),
    wrapStream: async ({ doStream }) => {
      if (!streamScan) return doStream()

      const { stream, ...rest } = await doStream()
      return { ...rest, stream: stream.pipeThrough(streamScan()) }
    },
  }
}
