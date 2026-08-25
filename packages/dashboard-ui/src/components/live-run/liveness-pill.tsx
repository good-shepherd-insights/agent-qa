import {
  LIVENESS_STALE_MS,
  livenessOf,
  type Liveness,
  type LivenessKind,
  type LivenessSource,
  type RunStreamState,
} from '@/lib/run-stream-reducer'
import { cn } from '@/lib/utils'

/**
 * HNST-03's pill: the one place the live page says how much of what it shows is still true.
 *
 * THE LIE THIS REFUSES. An open socket to a dead run reads "connected" forever — the transport's
 * own comment heartbeat keeps it that way, and every SSE page that branches on `readyState` shows
 * a green dot over a run that stopped speaking ten minutes ago. Liveness here is read off BUS
 * ENVELOPES (the run's own 10 s `heartbeat` included), and the transport only ever makes it worse,
 * never better.
 */

/**
 * The attach-aware liveness the PAGE needs, over the pure one the reducer publishes.
 *
 * WHY THIS WRAPPER EXISTS (403-04 handoff item 1). `livenessOf` answers `connecting` for an open
 * socket that has heard no envelope, and it is right to: with no `lastEnvelopeAt` there is no
 * origin to measure a staleness window from, and calling a two-second-old attach `lost` would
 * slander a run that has not spoken yet. But an open socket that has heard NOTHING for twenty
 * seconds is exactly the HNST-03 lie in its purest form — there is no run behind it, or none that
 * can still reach this viewer. The missing origin is the attach itself, which only the component
 * that opened the socket knows. So the page supplies it, and the window is the same one:
 * {@link LIVENESS_STALE_MS}, twice the bus's heartbeat cadence.
 *
 * It never UPGRADES a verdict — `lost`, `reconnecting` and `live` pass through untouched. The only
 * transition it can make is `connecting` → `lost`, which is the transition the reducer cannot see.
 */
export function livenessForAttach(
  state: RunStreamState,
  now: number,
  source: LivenessSource,
  attachedAt: number | undefined,
  staleMs: number = LIVENESS_STALE_MS,
): Liveness {
  const base = livenessOf(state, now, source, staleMs)
  if (base.kind !== 'connecting') return base
  if (attachedAt === undefined) return base
  return now - attachedAt < staleMs ? base : { kind: 'lost', lastActivityAgeMs: undefined }
}

const PILL_TONE: Record<LivenessKind, string> = {
  connecting: 'border-amber-500/20 bg-amber-500/15 text-amber-500',
  live: 'border-emerald-500/20 bg-emerald-500/15 text-emerald-500',
  reconnecting: 'border-amber-500/20 bg-amber-500/15 text-amber-500',
  lost: 'border-red-500/20 bg-red-500/15 text-red-400',
}

export interface LivenessPillProps {
  liveness: LivenessKind
  /** Milliseconds since the last BUS envelope. Undefined when none has ever arrived. */
  lastActivityAgeMs?: number
  /** Milliseconds since this page attached — the age shown when no envelope has arrived yet. */
  attachedAgeMs?: number
}

/**
 * `data-last-activity` is the age IN SECONDS the staleness window is measured against: since the
 * last envelope when there has been one, since the attach when there has not. The distinction is
 * in the words, never hidden — a pill that spelled "no activity yet" and "last activity Ns ago"
 * the same way would be inventing an envelope that never arrived.
 *
 * (The wording above is deliberate: the arch dependency scanner is a line regex over raw source
 * with no comment stripping, so any prose that puts a quoted phrase immediately after the word
 * `from` becomes a phantom external dependency and reds `validate:arch`.)
 */
export function LivenessPill({ liveness, lastActivityAgeMs, attachedAgeMs }: LivenessPillProps) {
  const ageMs = lastActivityAgeMs ?? attachedAgeMs
  const ageSeconds = ageMs === undefined ? undefined : Math.max(0, Math.floor(ageMs / 1000))

  return (
    <span
      data-liveness={liveness}
      data-last-activity={ageSeconds === undefined ? '' : String(ageSeconds)}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium',
        PILL_TONE[liveness],
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 rounded-full bg-current', liveness === 'live' && 'animate-pulse')}
      />
      <span>{liveness}</span>
      <span className="text-muted-foreground">
        {ageSeconds === undefined
          ? 'no activity yet'
          : lastActivityAgeMs === undefined
            ? `no activity yet (${String(ageSeconds)}s)`
            : `last activity ${String(ageSeconds)}s ago`}
      </span>
    </span>
  )
}
