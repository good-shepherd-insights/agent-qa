import type { StepStatus } from '@/lib/run-stream-reducer'

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

export function liveLabelText(raw: string): string {
  return raw
}
