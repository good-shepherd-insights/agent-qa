import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Accessibility, Check, Globe, RefreshCw, Terminal, X } from 'lucide-react'
import { STEP_SIGNALS, signalBadgeName, stepSignals, type StepSignal } from '@/lib/evidence-counts'
import { nearestMarker, snapToMarker, type Playhead, type PlayerSource, type TimelineMarker, type TimelineModel } from '@/lib/playhead'
import { runDetailStepKey } from '@/lib/selection'
import { markerDensity, SCROLL_SLOT_PX, TIMELINE_COPY, timelineReadout, timelineValueText } from '@/lib/timeline-view'
import { copyTextOf } from '@/lib/display-text'
import { cn } from '@/lib/utils'
import { MaskedText } from './masked-text'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TimelineMarkerPopover } from './timeline-marker-popover'

export interface TimelineProps {
  model: TimelineModel
  playhead: Playhead | null
  source: PlayerSource
  runId: string
  memberLabel?: string
  signals?: Readonly<Record<number, ReturnType<typeof stepSignals>>>
  seekFraction?: number
  onPlayheadChange: (playhead: Playhead) => void
  onSeekFraction: (fraction: number) => void
  onOpenSignal: (stepIndex: number, signal: StepSignal) => void
}

const SIGNAL_ICONS = { console: Terminal, network: Globe, a11y: Accessibility }
const RESULT_ICONS = { passed: Check, failed: X, healed: RefreshCw }
const RESULT_TONES = { passed: 'text-emerald-500', failed: 'text-red-500', healed: 'text-amber-500' }

export function Timeline({ model, playhead, source, runId, memberLabel, signals, seekFraction, onPlayheadChange, onSeekFraction, onOpenSignal }: TimelineProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const signalRow = useRef<HTMLDivElement>(null)
  const [signalTrackWidth, setSignalTrackWidth] = useState(0)
  const dragging = useRef<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [thumbFocused, setThumbFocused] = useState(false)
  const [signalFocus, setSignalFocus] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [width, setWidth] = useState(0)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const element = viewport.current!
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    setWidth(element.clientWidth)
    observer.observe(element)
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(media.matches)
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(motion.matches)
    media.addEventListener('change', update)
    motion.addEventListener('change', updateMotion)
    return () => { observer.disconnect(); media.removeEventListener('change', update); motion.removeEventListener('change', updateMotion) }
  }, [])
  const current = model.markers.find(marker => marker.testIndex === playhead?.testIndex
    && marker.stepIndex === playhead.stepIndex && marker.subActionIndex === playhead.subActionIndex)
  // Both rows share one scale. Reserve each signal group's measured width within its
  // segment, extending the scrollable track instead of painting across the next group.
  useLayoutEffect(() => {
    const groups = signalRow.current?.children
    if (!groups) return
    let minimum = 0
    for (const [index, segment] of model.segments.entries()) {
      const group = groups[index]
      const fraction = segment.end - segment.start
      if (!group || fraction <= 0) continue
      const widths = [...group.children].map(child => child.getBoundingClientRect().width).filter(value => value > 0)
      const required = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * 4 + 8
      minimum = Math.max(minimum, required / fraction)
    }
    setSignalTrackWidth(Math.ceil(minimum))
  }, [model, signals, narrow, width])
  const minimumTrackWidth = Math.max(model.markers.length * SCROLL_SLOT_PX, signalTrackWidth)
  const trackWidth = Math.max(width, minimumTrackWidth)
  const position = source === 'video' && seekFraction !== undefined ? Math.max(0, Math.min(1, seekFraction)) : current?.position
  const density = markerDensity(width / Math.max(1, model.markers.length))
  const badges = model.segments.flatMap(segment => {
    const counts = signals?.[segment.step.stepIndex] ?? stepSignals(segment.step.evidence)
    return STEP_SIGNALS.filter(kind => (counts[kind] ?? 0) > 0).map(kind => `${segment.step.stepIndex}:${kind}`)
  })
  const activeBadge = signalFocus !== null && badges.includes(signalFocus) ? signalFocus : badges[0]
  function select(marker: TimelineMarker) {
    onPlayheadChange({ testIndex: marker.testIndex, stepIndex: marker.stepIndex, subActionIndex: marker.subActionIndex })
  }
  function scrub(clientX: number) {
    const rect = track.current!.getBoundingClientRect()
    if (rect.width <= 0) return
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const centres = model.markers.map(marker => ({ marker, centrePx: marker.position * rect.width }))
    const snapped = source === 'frames' ? nearestMarker(x, centres) : snapToMarker(x, centres)
    if (snapped) {
      select(snapped)
      if (source === 'video') onSeekFraction(snapped.position)
    } else if (source === 'video') {
      const fraction = x / rect.width
      const previous = model.markers.filter(marker => marker.position <= fraction).at(-1) ?? model.markers[0]
      if (previous) select(previous)
      onSeekFraction(fraction)
    }
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function navigate(event: KeyboardEvent<HTMLSpanElement>) {
    if (!current) return
    const index = model.markers.indexOf(current)
    let target: TimelineMarker | undefined
    switch (event.key) {
      case 'ArrowLeft': target = model.markers[Math.max(0, index - 1)]; break
      case 'ArrowRight': target = model.markers[Math.min(model.markers.length - 1, index + 1)]; break
      case 'Home': target = model.markers[0]; break
      case 'End': target = model.markers.at(-1); break
      case 'PageUp': target = model.segments.filter(segment => segment.step.stepIndex < current.stepIndex && segment.markers.length > 0).at(-1)?.markers[0]; break
      case 'PageDown': target = model.segments.find(segment => segment.step.stepIndex > current.stepIndex && segment.markers.length > 0)?.markers[0]; break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
    if (target) {
      select(target)
      if (source === 'video') onSeekFraction(target.position)
    }
  }
  function moveSignal(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    event.stopPropagation()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  useEffect(() => {
    const element = viewport.current
    if (!element || position === undefined) return
    const x = position * trackWidth
    if (x < element.scrollLeft + 12) element.scrollLeft = Math.max(0, x - 12)
    else if (x > element.scrollLeft + width - 12) element.scrollLeft = x - width + 12
  }, [position, trackWidth, width])
  return (
    <TooltipProvider><div data-timeline data-timeline-axis={model.axis} data-timeline-member={model.testIndex}
      className='flex h-[60px] min-w-0 items-center gap-2 border-b px-3 py-2'>
      {memberLabel && <span className='max-w-[25%] shrink-0 truncate text-xs text-muted-foreground sm:max-w-40'><MaskedText text={memberLabel} /></span>}
      <div ref={viewport} className='min-w-0 flex-1 overflow-x-auto'>
        <div style={{ minWidth: minimumTrackWidth }}>
          <div ref={signalRow} data-timeline-signals role='group' aria-label={TIMELINE_COPY.signals} onKeyDown={moveSignal} className='relative mb-1 flex h-4'>
            {model.segments.map(segment => {
              const stepIndex = segment.step.stepIndex
              const counts = signals?.[stepIndex] ?? stepSignals(segment.step.evidence)
              return <div key={stepIndex} className='absolute flex h-4 items-center gap-1'
                style={{ left: `${segment.start * 100}%`, width: `${(segment.end - segment.start) * 100}%` }}>
                <span className='hidden text-[10px] font-medium sm:inline'>{stepIndex + 1}</span>
                {segment.step.selfHealOccurred && <RefreshCw aria-hidden='true' className='h-3 w-3 shrink-0 text-amber-500' />}
                {STEP_SIGNALS.map(kind => {
                  const count = counts[kind]
                  if (count === undefined || count <= 0) return null
                  const Icon = SIGNAL_ICONS[kind]
                  return <button key={kind} type='button' data-step-signal={kind} data-count={count}
                    tabIndex={activeBadge === `${stepIndex}:${kind}` ? 0 : -1}
                    onFocus={() => setSignalFocus(`${stepIndex}:${kind}`)}
                    aria-label={copyTextOf(signalBadgeName(kind, count, stepIndex + 1))}
                    className='flex shrink-0 items-center gap-1 rounded-sm text-[10px] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-ring/50'
                    onClick={() => onOpenSignal(stepIndex, kind)}>
                    <Icon aria-hidden='true' className='h-3 w-3' />{count}
                  </button>
                })}
              </div>
            })}
          </div>
          <div ref={track} data-timeline-track className='relative h-6 touch-none'
            onPointerDown={event => {
              if (event.button !== 0) return
              event.preventDefault()
              dragging.current = event.pointerId
              event.currentTarget.setPointerCapture(event.pointerId)
              scrub(event.clientX)
            }}
            onPointerMove={event => { if (dragging.current === event.pointerId) scrub(event.clientX) }}
            onPointerUp={finishDrag} onPointerCancel={finishDrag}
            onLostPointerCapture={() => { dragging.current = null }}>
            {model.segments.map(segment => <div key={segment.step.stepIndex}
              data-timeline-segment={runDetailStepKey(model.testIndex, segment.step.stepIndex)}
              data-selected={playhead?.testIndex === model.testIndex && playhead.stepIndex === segment.step.stepIndex}
              className={cn('absolute top-2 h-2 rounded-sm bg-muted', playhead?.testIndex === model.testIndex && playhead.stepIndex === segment.step.stepIndex && 'bg-primary/25')}
              style={{ left: `${segment.start * 100}%`, width: `max(0px, calc(${(segment.end - segment.start) * 100}% - 4px))` }} />)}
            {model.markers.map(marker => {
              const Icon = RESULT_ICONS[marker.result]
              const tick = density !== 'glyph' && marker.result !== 'failed'
              return <TimelineMarkerPopover key={marker.ordinal} marker={marker} total={model.markers.length} runId={runId}
                open={hovered === marker.ordinal && !thumbFocused}
                onOpenChange={open => setHovered(open ? marker.ordinal : null)}>
                <span data-timeline-marker data-marker-index={marker.ordinal}
                onPointerEnter={() => setHovered(marker.ordinal)} onPointerLeave={() => setHovered(null)}
                data-marker-result={marker.result} data-marker-frame={marker.frame} data-marker-current={marker === current}
                tabIndex={-1} aria-hidden='true' className='absolute top-0 flex h-6 -translate-x-1/2 items-center justify-center'
                style={{ left: `${marker.position * 100}%`, width: density === 'glyph' ? 24 : Math.max(8, trackWidth / model.markers.length) }}>
                <span className={cn('flex items-center justify-center bg-background',
                  tick ? 'h-3 w-1 rounded-sm' : 'h-4 w-4 rounded-full',
                  marker.frame === 'absent' && 'border border-dashed border-muted-foreground',
                  marker === current && 'ring-2 ring-primary', RESULT_TONES[marker.result])}>
                  {tick ? <span className='h-3 w-1 bg-current' /> : <Icon className='h-3 w-3' strokeWidth={3} />}
                  <span className='sr-only'>#{marker.ordinal}</span>
                </span>
              </span></TimelineMarkerPopover>
            })}
            {current && <div data-timeline-playhead className={cn('pointer-events-none absolute left-0 top-0 h-6 w-0', !reducedMotion && 'transition-transform duration-(--transition-fast) ease-(--ease-snappy)')}
              style={{ transform: `translateX(${(position ?? current.position) * trackWidth}px)` }}>
              <span className='absolute h-6 w-0.5 -translate-x-1/2 bg-primary' />
              <TimelineMarkerPopover marker={current} total={model.markers.length} runId={runId} open={thumbFocused}
                onOpenChange={open => { if (!open) setThumbFocused(false) }}>
              <span role='slider' tabIndex={0} aria-label={TIMELINE_COPY.slider} aria-orientation='horizontal'
                onKeyDown={navigate} onFocus={event => setThumbFocused(event.currentTarget.matches(':focus-visible'))}
                onBlur={() => setThumbFocused(false)}
                aria-valuemin={1} aria-valuemax={model.markers.length} aria-valuenow={current.ordinal}
                aria-valuetext={timelineValueText(current, model.markers.length)}
                className='pointer-events-auto absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-primary focus-visible:ring-2 focus-visible:ring-ring/50' />
              </TimelineMarkerPopover>
            </div>}
          </div>
        </div>
      </div>
      <span data-timeline-readout className='shrink-0 font-mono text-xs tabular-nums'>{timelineReadout(model, current, narrow, position)}</span>
    </div></TooltipProvider>
  )
}
