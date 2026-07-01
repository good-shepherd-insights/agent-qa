import type { LanguageModelMiddleware } from 'ai'

import type { HookRegistry } from '../hooks/registry'

export function createProviderRequestMiddleware(registry: HookRegistry): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => registry.runProviderRequest(params),
    wrapGenerate: async ({ doGenerate }) => doGenerate(),
    wrapStream: async ({ doStream }) => doStream(),
  }
}
