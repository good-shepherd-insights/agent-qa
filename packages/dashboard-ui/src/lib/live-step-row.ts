import { PLACEHOLDER_PATTERN, maskedMarker, type MaskedCategory } from '@vostride/agent-qa-schema'

import type { LiveStepRow, StepStatus } from '@/lib/run-stream-reducer'

/**
 * THE LIVE STEP ROW'S WORDS (428 D-19/D-20/D-22).
 *
 * Each status has its own accessible name, so a glyph's colour is never the only thing that says
 * what state a step is in. The row reads these; it spells none of its own.
 */
export const LIVE_STEP_STATUS_NAMES = {
  pending: 'pending',
  running: 'running',
  passed: 'passed',
  failed: 'failed',
  healed: 'healed',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const satisfies Record<StepStatus, string>

/**
 * A live step label with every masking placeholder turned into the typed marker (D-22, WINDOWS #289).
 *
 * The live wire stays masked (405 D-09), so a label carries `<SECRET_n>` placeholders rather than
 * the markers run detail's display seam emits. This turns each one into the same marker, so the row
 * paints the same chip. No value is restored. The pattern and the marker are the schema's; there is
 * no second spelling of either here.
 */
export function liveLabelText(raw: string): string {
  return raw.replaceAll(PLACEHOLDER_PATTERN, (_match, category: string) =>
    maskedMarker(category.toLowerCase() as MaskedCategory),
  )
}

/**
 * Whether a live row is drawn at all (owner decision 2026-09-26 (2), G-428-2): "either show the
 * entire step text or don't show it at all". A row whose text is empty or only whitespace is not
 * drawn, so no surface ever paints a `step N` placeholder in its place.
 */
export function liveRowShown(row: Pick<LiveStepRow, 'text'>): boolean {
  // The text arrived as JSON from another process, so a producer that sent none is not drawn
  // rather than throwing here.
  return typeof row.text === 'string' && row.text.trim() !== ''
}
