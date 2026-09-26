import { Ban, Check, Circle, CircleDashed, Minus, ShieldCheck, X, type LucideIcon } from 'lucide-react'

import { MaskedChip } from '@/components/run-detail/masked-chip'
import { LIVE_STEP_STATUS_NAMES, liveLabelText, liveRowShown } from '@/lib/live-step-row'
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
 * THE RUNNING GLYPH IS STILL (owner review 2026-09-26, G-428-5; supersedes D-20's breathing glyph
 * and its per-tick re-key). It is a still blue shape, never green and never a dot. Nothing on the row
 * moves: a status is told apart by its shape, its tone and its accessible name. A sub-action reaches
 * the row only as `data-step-ticks`.
 *
 * SECRETS ARE CHIPS (D-22). A `<SECRET_n>` placeholder in the label is painted as run detail's
 * masked chip, with the live surface's own label. Every segment is a React text node or an element.
 *
 * THE WHOLE LABEL, WRAPPED (owner decision 2026-09-26 (1), G-428-1; supersedes 428-17's one-line
 * row). A long label wraps onto more lines and long words break, so every step's full text is
 * readable while it runs; nothing clips it and nothing ends it in an ellipsis. The glyph sits in a
 * box one label line tall, so it stays on the first line. A chip is an unbreakable inline box that
 * the text flows around: it is never split across lines, never shrunk and never clipped.
 *
 * NO TEXT, NO ROW (owner decision 2026-09-26 (2), G-428-2; supersedes 428-17's step-N fallback).
 * A row with no text draws nothing, so a pending step the runner sent no text for is simply absent
 * rather than labelled with a placeholder. {@link liveRowShown} is the one predicate.
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
  if (!liveRowShown(row)) return null
  const Glyph = LIVE_STEP_GLYPHS[row.status]

  return (
    <li
      data-step-status={row.status}
      data-step-ticks={String(row.ticks)}
      className="flex items-start gap-2 border-b border-border/40 px-3 py-1.5 text-sm last:border-b-0"
    >
      <span
        role="img"
        aria-label={LIVE_STEP_STATUS_NAMES[row.status]}
        className="inline-flex h-5 shrink-0 items-center"
      >
        <Glyph className={cn('size-3.5', STATUS_TONE[row.status])} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-5 [overflow-wrap:anywhere]">
        {splitMaskedText(liveLabelText(row.text)).map((segment, index) =>
          segment.kind === 'text' ? (
            <span key={index}>{segment.text}</span>
          ) : (
            <span key={index} className="inline-flex shrink-0 whitespace-nowrap align-middle">
              <MaskedChip category={segment.category} surface="live" />
            </span>
          ),
        )}
      </span>
    </li>
  )
}
