import { Check, Circle, CircleDashed, Minus, ShieldCheck, X, type LucideIcon } from 'lucide-react'

import type { LiveStepRow, StepStatus } from '@/lib/run-stream-reducer'
import { cn } from '@/lib/utils'

export const LIVE_STEP_GLYPHS = {
  pending: CircleDashed,
  running: Circle,
  passed: Check,
  failed: X,
  healed: ShieldCheck,
  skipped: Minus,
  cancelled: Minus,
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
      <Glyph className={cn('size-3.5 shrink-0', STATUS_TONE[row.status])} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{row.text || `step ${String(row.stepIndex + 1)}`}</span>
      {isRunning && (
        <>
          <span
            key={`motion-${String(row.ticks)}`}
            data-step-motion=""
            data-motion-key={String(row.ticks)}
            aria-label="working"
            role="progressbar"
            className="h-1 w-10 shrink-0 animate-pulse rounded-full bg-blue-500/60"
          />
          <span data-step-ticks-label className="shrink-0 font-mono text-xs text-muted-foreground">
            {String(row.ticks)} actions
          </span>
        </>
      )}
    </li>
  )
}
