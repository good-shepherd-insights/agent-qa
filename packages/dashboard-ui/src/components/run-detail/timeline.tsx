import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { nearestMarker, snapToMarker, type Playhead, type PlayerSource, type TimelineMarker, type TimelineModel } from '@/lib/playhead'
import { TIMELINE_COPY, timelineValueText } from '@/lib/timeline-view'
import { copyTextOf } from '@/lib/display-text'

export interface TimelineProps {
  model: TimelineModel
  playhead: Playhead | null
  source: PlayerSource
  memberLabel?: string
  seekFraction?: number
  onPlayheadChange: (playhead: Playhead) => void
  onSeekFraction: (fraction: number) => void
}

/** One compact scrubber; action details and evidence counts live in their respective panes. */
export function Timeline({ model, playhead, source, memberLabel, seekFraction, onPlayheadChange, onSeekFraction }: TimelineProps) {
  const track = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLSpanElement>(null)
  const dragging = useRef<number | null>(null)
  const current = model.markers.find(marker => marker.testIndex === playhead?.testIndex
    && marker.stepIndex === playhead.stepIndex && marker.subActionIndex === playhead.subActionIndex)
  const position = source === 'video' && seekFraction !== undefined ? Math.max(0, Math.min(1, seekFraction)) : current?.position
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
  if (model.markers.length === 0) return null
  return (
    <div data-timeline data-timeline-axis={model.axis} data-timeline-member={model.testIndex}
      className='min-w-0 px-5 py-1'>
      <div ref={track} data-timeline-track className='relative h-7 touch-none cursor-pointer'
        onPointerDown={event => {
          if (event.button !== 0) return
          event.preventDefault()
          slider.current?.focus({ preventScroll: true })
          dragging.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub(event.clientX)
        }}
        onPointerMove={event => { if (dragging.current === event.pointerId) scrub(event.clientX) }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag}
        onLostPointerCapture={() => { dragging.current = null }}>
        <div aria-hidden='true' className='absolute inset-x-0 top-3 h-1 rounded-full bg-muted' />
        {current && <>
          <div aria-hidden='true' className='absolute left-0 top-3 h-1 rounded-full bg-primary/50'
            style={{ width: `${(position ?? current.position) * 100}%` }} />
          <span ref={slider} data-timeline-playhead role='slider' tabIndex={0}
            aria-label={memberLabel ? `${TIMELINE_COPY.slider}: ${copyTextOf(memberLabel)}` : TIMELINE_COPY.slider}
            aria-orientation='horizontal' onKeyDown={navigate}
            aria-valuemin={1} aria-valuemax={model.markers.length} aria-valuenow={current.ordinal}
            aria-valuetext={timelineValueText(current, model.markers.length)}
            style={{ left: `${(position ?? current.position) * 100}%` }}
            className='absolute top-2 h-3 w-3 -translate-x-1/2 rounded-full bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' />
        </>}
      </div>
    </div>
  )
}
