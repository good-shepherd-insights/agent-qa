import { Ban, Check, Circle, CircleDashed, Minus, ShieldCheck, X, type LucideIcon } from 'lucide-react'

import { MaskedChip } from '@/components/run-detail/masked-chip'
import { LIVE_STEP_STATUS_NAMES, liveLabelText } from '@/lib/live-step-row'
import { splitMaskedText } from '@/lib/masked-text'
import type { LiveStepRow, StepStatus } from '@/lib/run-stream-reducer'
import { cn } from '@/lib/utils'

/**
 * THE LIVE STEP ROW (428 D-19/D-20/D-21/D-22).
 *
 * A row is one status glyph and the step label, nothing else. There is no clock, no bar and no
 * count on any row: durations live in run detail (D-19, the owner's choice). The row is inert and
 * accepts only {@link LiveStepRow}, which has no field a half-finished thought could occupy.
 *
 * THE RUNNING GLYPH BREATHES (D-20). Its wrapper is re-keyed on every tick, so the animation
 * restarts each time the run records a sub-action. That restart says "something just happened"
 * and nothing about what. It is blue, never green, and never a dot.
 *
 * SECRETS ARE CHIPS (D-22). A `<SECRET_n>` placeholder in the label is painted as run detail's
 * masked chip, with the live surface's own label. Text segments ellipsise and the chip never
 * shrinks, so a long label never clips it. Every segment is a React text node or an element.
 */

/** One shape per status, so colour is never the only signal (RESEARCH P13). */
export const LIVE_STEP_GLYPHS = {
  pending: CircleDashed,
  running: Circle,
  passed: Check,
  failed: X,
  healed: ShieldCheck,
  skipped: Minus,
  cancelled: Ban,
} satisfies Record<StepStatus, LucideIcon>

const STATUS_TONE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-500',
  passed: 'text-emerald-500',
  failed: 'text-red-400',
  healed: 'text-amber-500',
  skipped: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
}

export function LiveStepRowView({ row }: { row: LiveStepRow }) {
  const Glyph = LIVE_STEP_GLYPHS[row.status]
  const isRunning = row.status === 'running'

  return (
    <li
      data-step-status={row.status}
      data-step-ticks={String(row.ticks)}
      className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-sm last:border-b-0"
    >
      <span
        key={isRunning ? `motion-${String(row.ticks)}` : 'still'}
        data-step-motion={isRunning ? '' : undefined}
        data-motion-key={isRunning ? String(row.ticks) : undefined}
        role="img"
        aria-label={LIVE_STEP_STATUS_NAMES[row.status]}
        className="inline-flex shrink-0"
      >
        <Glyph
          className={cn('size-3.5', STATUS_TONE[row.status], isRunning && 'live-step-breathing')}
          aria-hidden="true"
        />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {splitMaskedText(liveLabelText(row.text || `step ${String(row.stepIndex + 1)}`)).map((segment, index) =>
          segment.kind === 'text' ? (
            <span key={index} className="min-w-0 truncate">
              {segment.text}
            </span>
          ) : (
            <span key={index} className="shrink-0">
              <MaskedChip category={segment.category} surface="live" />
            </span>
          ),
        )}
      </span>
    </li>
  )
}
