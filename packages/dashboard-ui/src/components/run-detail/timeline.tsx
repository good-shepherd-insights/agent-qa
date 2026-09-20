import { useEffect, useRef, useState } from 'react'
import { Accessibility, Check, Globe, RefreshCw, Terminal, X } from 'lucide-react'
import { STEP_SIGNALS, signalBadgeName, stepSignals, type StepSignal } from '@/lib/evidence-counts'
import type { Playhead, PlayerSource, TimelineModel } from '@/lib/playhead'
import { runDetailStepKey } from '@/lib/selection'
import { markerDensity, SCROLL_SLOT_PX, TIMELINE_COPY, timelineReadout, timelineValueText } from '@/lib/timeline-view'
import { copyTextOf } from '@/lib/display-text'
import { cn } from '@/lib/utils'
import { MaskedText } from './masked-text'

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

export function Timeline({ model, playhead, source, memberLabel, signals, seekFraction, onOpenSignal }: TimelineProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  useEffect(() => {
    const element = viewport.current!
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    setWidth(element.clientWidth)
    observer.observe(element)
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [])
  const current = model.markers.find(marker => marker.testIndex === playhead?.testIndex
    && marker.stepIndex === playhead.stepIndex && marker.subActionIndex === playhead.subActionIndex)
  const trackWidth = Math.max(width, model.markers.length * SCROLL_SLOT_PX)
  const position = source === 'video' && seekFraction !== undefined ? Math.max(0, Math.min(1, seekFraction)) : current?.position
  const density = markerDensity(width / Math.max(1, model.markers.length))
  useEffect(() => {
    const element = viewport.current
    if (!element || position === undefined) return
    const x = position * trackWidth
    if (x < element.scrollLeft + 12) element.scrollLeft = Math.max(0, x - 12)
    else if (x > element.scrollLeft + width - 12) element.scrollLeft = x - width + 12
  }, [position, trackWidth, width])
  return (
    <div data-timeline data-timeline-axis={model.axis} data-timeline-member={model.testIndex}
      className='flex h-[60px] min-w-0 items-center gap-2 border-b px-3 py-2'>
      {memberLabel && <span className='max-w-40 truncate text-xs text-muted-foreground'><MaskedText text={memberLabel} /></span>}
      <div ref={viewport} className='min-w-0 flex-1 overflow-x-auto'>
        <div style={{ minWidth: model.markers.length * SCROLL_SLOT_PX }}>
          <div data-timeline-signals role='group' aria-label={TIMELINE_COPY.signals} className='relative mb-1 flex h-4'>
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
                    aria-label={copyTextOf(signalBadgeName(kind, count, stepIndex + 1))}
                    className='flex items-center gap-1 rounded-sm text-[10px] font-medium tabular-nums focus-visible:ring-2 focus-visible:ring-ring/50'
                    onClick={() => onOpenSignal(stepIndex, kind)}>
                    <Icon aria-hidden='true' className='h-3 w-3' />{count}
                  </button>
                })}
              </div>
            })}
          </div>
          <div data-timeline-track className='relative h-6 touch-none'>
            {model.segments.map(segment => <div key={segment.step.stepIndex}
              data-timeline-segment={runDetailStepKey(model.testIndex, segment.step.stepIndex)}
              data-selected={playhead?.testIndex === model.testIndex && playhead.stepIndex === segment.step.stepIndex}
              className={cn('absolute top-2 h-2 rounded-sm bg-muted', playhead?.testIndex === model.testIndex && playhead.stepIndex === segment.step.stepIndex && 'bg-primary/25')}
              style={{ left: `${segment.start * 100}%`, width: `max(0px, calc(${(segment.end - segment.start) * 100}% - 4px))` }} />)}
            {model.markers.map(marker => {
              const Icon = RESULT_ICONS[marker.result]
              const tick = density !== 'glyph' && marker.result !== 'failed'
              return <span key={marker.ordinal} data-timeline-marker data-marker-index={marker.ordinal}
                data-marker-result={marker.result} data-marker-frame={marker.frame} data-marker-current={marker === current}
                tabIndex={-1} aria-hidden='true' className='absolute top-0 flex h-6 -translate-x-1/2 items-center justify-center'
                style={{ left: `${marker.position * 100}%`, width: density === 'glyph' ? 24 : Math.max(8, trackWidth / model.markers.length) }}>
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-full bg-background',
                  marker.frame === 'absent' && 'border border-dashed border-muted-foreground',
                  marker === current && 'ring-2 ring-primary', RESULT_TONES[marker.result])}>
                  {tick ? <span className='h-3 w-1 bg-current' /> : <Icon className='h-3 w-3' strokeWidth={3} />}
                  <span className='sr-only'>#{marker.ordinal}</span>
                </span>
              </span>
            })}
            {current && <div data-timeline-playhead className='pointer-events-none absolute left-0 top-0 h-6 w-0 transition-transform duration-(--transition-fast) ease-(--ease-snappy)'
              style={{ transform: `translateX(${(position ?? current.position) * trackWidth}px)` }}>
              <span className='absolute h-6 w-0.5 -translate-x-1/2 bg-primary' />
              <span role='slider' tabIndex={0} aria-label={TIMELINE_COPY.slider} aria-orientation='horizontal'
                aria-valuemin={1} aria-valuemax={model.markers.length} aria-valuenow={current.ordinal}
                aria-valuetext={timelineValueText(current, model.markers.length)}
                className='pointer-events-auto absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-primary focus-visible:ring-2 focus-visible:ring-ring/50' />
            </div>}
          </div>
        </div>
      </div>
      <span data-timeline-readout className='shrink-0 font-mono text-xs tabular-nums'>{timelineReadout(model, current, narrow, position)}</span>
    </div>
  )
}
