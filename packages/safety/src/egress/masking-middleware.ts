import type { LanguageModelMiddleware } from 'ai'

import { mapPromptLeaves } from './map-prompt-leaves'

export function createMaskingMiddleware(mask: (text: string) => string): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => mapPromptLeaves(params, mask),
  }
}
