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

// 2026-10-15 (441-67, GAP2-D2): a model types a declared secret as {{secret:NAME}}, so a template
// in the input reaches it verbatim, but only where putting it back cannot re-send a declared
// value. Anything else is sent as the leaf masked whole.
function maskKeepingTemplates(text: string, mask: (text: string) => string): string {
  const whole = mask(text)
  const parts = text.split(TEMPLATE_SPLIT)
  if (parts.length === 1) return whole
  const masked = parts.map((part) => mask(part))
  // Equal only when no declared value straddles a token edge in the left-to-right whole pass.
  if (masked.join('') !== whole) return whole
  return parts
    .map((part, index) =>
      index % 2 === 1 && keepsTemplate(parts, index, mask) ? part : masked[index]!,
    )
    .join('')
}

function keepsTemplate(
  parts: readonly string[],
  index: number,
  mask: (text: string) => string,
): boolean {
  const token = parts[index]!
  const name = token.slice('{{secret:'.length, -'}}'.length)
  if (mask(name) !== name) return false
  const alone = mask(token)
  if (alone !== token && alone !== `[secret:${name}]`) return false
  // A token cut by one brace is neither a template nor a marker, so the mask can only find a
  // declared value in it: one that starts inside the token and ends after it, or the reverse.
  const before = parts.slice(0, index).join('')
  const after = parts.slice(index + 1).join('')
  const head = token.slice(0, -1)
  const tail = token.slice(1)
  return (
    mask(before + head) === mask(before) + mask(head)
    && mask(tail + after) === mask(tail) + mask(after)
  )
}
