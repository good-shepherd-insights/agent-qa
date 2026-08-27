import { Check, Circle, CircleDashed, Minus, ShieldCheck, X } from 'lucide-react'

import type { MemberRow, LiveStepRow, StepStatus } from '@/lib/run-stream-reducer'
import { cn } from '@/lib/utils'

/**
 * HNST-01/HNST-02's step list: what a person may be told about a step WHILE it is running.
 *
 * IT IS STATUS-ONLY AND IT IS INERT ON PURPOSE. There is no click handler, no link, no expandable
 * node and no image, because everything a click could open is provisional until the step finalizes
 * — the model's half-finished intent, a candidate target it may not use, a result it has not
 * verified. The durable record has all of it, complete, one click away at run detail. This surface
 * refuses to show a guess as a fact.
 *
 * THE PROPS ARE THE WHOLE STORY. {@link LiveStepRow} carries no field a half-finished thought could
 * occupy (403-04), and this component accepts nothing else — no envelope, no payload, no `unknown`
 * escape hatch. A future edit that wanted to render reasoning here would have to widen the props
 * first, which is a visible change to a published contract rather than one more line in the JSX.
 *
 * WHAT MOVES INSTEAD (D-10). A running row shows indeterminate motion, its elapsed time and a
 * plain count of the sub-actions it has recorded. The motion is indeterminate because any label
 * derived from tick timing would be a guess about what the agent is doing between two events, and
 * a guess rendered as fact is the provisional content this phase exists to stop showing.
 */

/** mm:ss, the live page's one elapsed spelling. */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** The honest word for a live steps pane that has no row yet. */
export const STEPS_EMPTY_TEXT = 'waiting for the first step'

const STATUS_GLYPH: Record<StepStatus, typeof Check> = {
  pending: CircleDashed,
  running: Circle,
  passed: Check,
  failed: X,
  healed: ShieldCheck,
  skipped: Minus,
  cancelled: Minus,
}

const STATUS_TONE: Record<StepStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-blue-500',
  passed: 'text-emerald-500',
  failed: 'text-red-400',
  healed: 'text-amber-500',
  skipped: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
}

export interface StepListProps {
  members: readonly MemberRow[]
  steps: readonly LiveStepRow[]
  terminal: boolean
  /** The page's clock reading, injected — never `Date.now()` inside a render. */
  now: number
}

function LiveStepRowView({ row, now }: { row: LiveStepRow; now: number }) {
  const Glyph = STATUS_GLYPH[row.status]
  const isRunning = row.status === 'running'
  const elapsedSeconds = row.startedAt === undefined ? undefined : (now - row.startedAt) / 1000

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
          {/*
            RE-KEYED ON EVERY TICK so the animation restarts from its first frame each time the run
            records a sub-action. That restart IS the hint — it says "something just happened" and
            nothing about what, which is the most this surface honestly knows between two events.
          */}
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
      {elapsedSeconds !== undefined && isRunning && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatElapsed(elapsedSeconds)}
        </span>
      )}
      {!isRunning && row.durationMs !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatElapsed(row.durationMs / 1000)}
        </span>
      )}
    </li>
  )
}

export function StepList({ members, steps, terminal, now }: StepListProps) {
  const memberIndices = [...new Set([...members.map((m) => m.testIndex), ...steps.map((s) => s.testIndex)])].sort(
    (a, b) => a - b,
  )
  const anyMemberSettled = members.some((member) => member.outcome !== undefined || member.note !== undefined)
  // The empty state is a claim about a LIVE stream that has produced no row. Once a member has
  // settled, `did not run` is the honest word and "waiting" would be a lie about a member that is
  // never going to start.
  const showEmpty = steps.length === 0 && !anyMemberSettled && !terminal

  if (showEmpty) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <p data-steps-empty className="p-6 text-sm text-muted-foreground">
          {STEPS_EMPTY_TEXT}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {memberIndices.map((testIndex) => {
        const member = members.find((item) => item.testIndex === testIndex)
        const rows = steps.filter((row) => row.testIndex === testIndex)
        return (
          <div key={testIndex} data-member={String(testIndex)}>
            <h3 className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-xs font-medium">
              <span className="min-w-0 truncate">{member?.name || `member ${String(testIndex)}`}</span>
              {member?.note !== undefined && (
                <span data-member-note className="shrink-0 text-muted-foreground">
                  {member.note}
                </span>
              )}
              {member?.outcome !== undefined && (
                <span data-member-outcome={member.outcome} className="shrink-0 text-muted-foreground">
                  {member.outcome}
                </span>
              )}
            </h3>
            {rows.length > 0 && (
              <ul className="flex flex-col">
                {rows.map((row) => (
                  <LiveStepRowView key={`${String(row.testIndex)}:${String(row.stepIndex)}`} row={row} now={now} />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
