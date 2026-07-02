import { mapPromptLeaves } from '../egress/map-prompt-leaves'
import type { ProviderRequestHook } from '../hooks/interfaces'
import type { MaskingContextResolver } from './resolver'

export function createMaskingProviderRequestHook(
  resolve: MaskingContextResolver,
): ProviderRequestHook {
  return (params) => {
    const ctx = resolve()
    if (!ctx) return params

    return mapPromptLeaves(params, ctx.mask)
  }
}
