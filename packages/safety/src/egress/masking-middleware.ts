import type { LanguageModelMiddleware } from 'ai'

import { mapPromptLeaves } from './map-prompt-leaves'

const TEMPLATE_SPLIT = /(\{\{secret:\w+\}\})/

export function createMaskingMiddleware(mask: (text: string) => string): LanguageModelMiddleware {
  const leaf = (text: string): string => maskKeepingTemplates(text, mask)
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => mapPromptLeaves(params, leaf),
  }
}

// A model types a declared secret as {{secret:NAME}}, so the template reaches it verbatim when the
// mask only names it; a template the mask turns into anything else is sent as the mask's output.
function maskKeepingTemplates(text: string, mask: (text: string) => string): string {
  return text
    .split(TEMPLATE_SPLIT)
    .map((part, index) => (index % 2 === 0 ? mask(part) : keepTemplate(part, mask)))
    .join('')
}

function keepTemplate(token: string, mask: (text: string) => string): string {
  const masked = mask(token)
  const name = token.slice('{{secret:'.length, -'}}'.length)
  return masked === token || masked === `[secret:${name}]` ? token : masked
}
