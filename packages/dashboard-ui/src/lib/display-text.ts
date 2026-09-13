import { PLACEHOLDER_PATTERN, maskedMarker } from '@vostride/agent-qa-schema'

import { maskedLabel } from '@/components/run-detail/masked-chip'
import { splitMaskedText } from '@/lib/masked-text'

/** Text for clipboard, title and accessible attributes: the same labels as visible chips. */
export function copyTextOf(rendered: string): string {
  // Object keys do not cross the server's value-only restoration walk. They cannot be
  // restored here, so give their placeholders the same fail-closed display labels.
  const marked = rendered.replaceAll(PLACEHOLDER_PATTERN, (_match, category: string) =>
    maskedMarker(category === 'EMAIL' ? 'email' : 'secret'),
  )
  return splitMaskedText(marked)
    .map((segment) => (
      segment.kind === 'text' ? segment.text : `[${maskedLabel(segment.category)}]`
    ))
    .join('')
}
