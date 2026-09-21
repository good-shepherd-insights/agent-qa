import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CircleSlash, Layers } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ACTION_FAMILY_ICONS, UNKNOWN_ACTION_ICON, buildActionSentence } from '@/lib/action-vocabulary'
import type { SuiteTimelineModel } from '@/lib/suite-timeline'
import { ActionSentence } from './action-sentence'
import { MaskedText } from './masked-text'
import { nearestMarker, snapToMarker, type Playhead, type PlayerSource, type TimelineMarker, type TimelineModel } from '@/lib/playhead'
import { TIMELINE_COPY, timelineValueText } from '@/lib/timeline-view'
import { copyTextOf } from '@/lib/display-text'

export interface TimelineProps {
  model: TimelineModel
  playhead: Playhead | null
  source: PlayerSource
  memberLabel?: string
  seekFraction?: number
  observedPosition?: number
  mediaDurationsReady?: boolean
  onPlayheadChange: (playhead: Playhead) => void
  onSeekFraction: (fraction: number, address?: Playhead) => void
}

/** One compact scrubber; action details and evidence counts live in their respective panes. */
export function Timeline({ model, playhead, source, memberLabel, seekFraction, observedPosition, mediaDurationsReady, onPlayheadChange, onSeekFraction }: TimelineProps) {
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [openGroup, setOpenGroup] = useState<number | null>(null)
  const members = (model as Partial<SuiteTimelineModel>).members
  useEffect(() => {
    const element = track.current
    if (!element) return
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const slider = useRef<HTMLSpanElement>(null)
  const dragging = useRef<number | null>(null)
  const current = model.markers.find(marker => marker.testIndex === playhead?.testIndex
    && marker.stepIndex === playhead.stepIndex && marker.subActionIndex === playhead.subActionIndex)
  const videoPosition = observedPosition ?? seekFraction
  const position = source === 'video' && videoPosition !== undefined ? Math.max(0, Math.min(1, videoPosition)) : current?.position
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
      if (source === 'video') onSeekFraction(snapped.position, snapped)
    } else if (source === 'video') {
      const fraction = x / rect.width
      const previous = model.markers.filter(marker => marker.position <= fraction).at(-1) ?? model.markers[0]
      if (previous && !members) select(previous)
      onSeekFraction(fraction)
    }
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current !== event.pointerId) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function navigate(event: KeyboardEvent<HTMLSpanElement>) {
    const index = current ? model.markers.indexOf(current) : -1
    let target: TimelineMarker | undefined
    switch (event.key) {
      case 'ArrowLeft': target = model.markers[Math.max(0, index - 1)]; break
      case 'ArrowRight': target = model.markers[Math.min(model.markers.length - 1, index + 1)]; break
      case 'Home': target = model.markers[0]; break
      case 'End': target = model.markers.at(-1); break
      case 'PageUp': target = model.segments.slice(0, model.segments.findIndex(segment => current && segment.markers.includes(current))).filter(segment => segment.markers.length > 0).at(-1)?.markers[0]; break
      case 'PageDown': target = model.segments.slice(model.segments.findIndex(segment => current && segment.markers.includes(current)) + 1).find(segment => segment.markers.length > 0)?.markers[0]; break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
    if (target) {
      select(target)
      if (source === 'video') onSeekFraction(target.position, target)
    }
  }
  const clusters: TimelineMarker[][] = []
  const markerX = (marker: TimelineMarker) => Math.max(14, Math.min(width - 14, marker.position * width))
  for (const marker of model.markers) {
    const previous = clusters.at(-1)
    if (previous && markerX(marker) - markerX(previous[0]!) < 28) previous.push(marker)
    else clusters.push([marker])
  }
  const context = (marker: TimelineMarker) => {
    const member = members?.find(entry => entry.model.testIndex === marker.testIndex)
    return `${member ? `${member.label}, ` : ''}Step ${marker.stepIndex + 1}`
  }
  const activate = (marker: TimelineMarker) => {
    select(marker)
    if (source === 'video') onSeekFraction(marker.position, marker)
    setOpenGroup(null)
  }
  if (model.markers.length === 0 && !members?.length) return null
  return (
    <TooltipProvider><div data-timeline data-timeline-axis={model.axis} data-timeline-member={members ? 'suite' : model.testIndex} data-media-durations-ready={mediaDurationsReady}
      className='min-w-0 px-5 py-1'>
      <div ref={track} data-timeline-track className='relative h-14 touch-none cursor-pointer'
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
        {members?.map(member => <span key={member.model.testIndex} data-timeline-member-span={member.model.testIndex}
          title={copyTextOf(`${member.label}${member.model.axis === 'ordinal' ? ' — Action timing unavailable' : ''}${member.group.member.recording?.state !== 'present' ? ' — Recording unavailable' : ''}`)}
          className={`absolute top-3 h-1 border-l border-background ${member.group.member.recording?.state !== 'present' ? 'bg-muted-foreground/30' : ''}`}
          style={{ left: `${member.start * 100}%`, width: `${(member.end - member.start) * 100}%` }} />)}
        {(current || position !== undefined) && <>
          <div aria-hidden='true' className='absolute left-0 top-3 h-1 rounded-full bg-primary/50'
            style={{ width: `${(position ?? current?.position ?? 0) * 100}%` }} />
          <span ref={slider} data-timeline-playhead role='slider' tabIndex={0}
            aria-label={memberLabel ? `${TIMELINE_COPY.slider}: ${copyTextOf(memberLabel)}` : TIMELINE_COPY.slider}
            aria-orientation='horizontal' onKeyDown={navigate}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((position ?? 0) * 100)}
            aria-valuetext={current ? timelineValueText(current, model.markers.length) : 'No actions recorded for this test'}
            style={{ left: `${(position ?? current?.position ?? 0) * 100}%` }}
            className='absolute top-0.5 h-6 w-2.5 -translate-x-1/2 rounded-full bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring' />
        </>}
        {clusters.map(cluster => {
          const marker = cluster[0]!
          const family = buildActionSentence(marker.subAction).family
          const Icon = family ? ACTION_FAMILY_ICONS[family] : UNKNOWN_ACTION_ICON
          const style = { left: `clamp(14px, ${marker.position * 100}%, calc(100% - 14px))` }
          const classes = 'absolute top-7 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'
          return cluster.length === 1 ? <Tooltip key={marker.ordinal}>
            <TooltipTrigger asChild><button type='button' data-timeline-marker={marker.ordinal} style={style} className={classes}
              aria-label={copyTextOf(`${context(marker)}: ${timelineValueText(marker, model.markers.length)}`)}
              onPointerDown={event => event.stopPropagation()} onClick={() => activate(marker)}><Icon aria-hidden='true' className='h-4 w-4' /></button></TooltipTrigger>
            <TooltipContent data-timeline-marker-details><MaskedText text={context(marker)} /><ActionSentence sub={marker.subAction} /></TooltipContent>
          </Tooltip> : <Popover key={marker.ordinal} open={openGroup === marker.ordinal} onOpenChange={open => setOpenGroup(open ? marker.ordinal : null)}>
            <PopoverTrigger asChild><button type='button' data-timeline-marker-group style={style} className={classes}
              aria-label={`Choose from ${cluster.length} nearby actions`} onPointerDown={event => event.stopPropagation()}><Layers aria-hidden='true' className='h-4 w-4' /></button></PopoverTrigger>
            <PopoverContent className='max-h-64 w-80 overflow-y-auto p-1' aria-label='Nearby actions'
              onPointerDown={event => event.stopPropagation()}>
              {cluster.map(entry => <button key={entry.ordinal} type='button' data-timeline-marker={entry.ordinal} className='block w-full rounded p-2 text-left hover:bg-muted'
                onClick={() => activate(entry)}><span className='text-xs'><MaskedText text={context(entry)} /></span><ActionSentence sub={entry.subAction} /></button>)}
            </PopoverContent>
          </Popover>
        })}
        {members?.filter(member => member.model.markers.length === 0).map(member => <Tooltip key={`empty-${member.model.testIndex}`}>
          <TooltipTrigger asChild><button type='button' data-timeline-empty-member={member.model.testIndex}
            aria-label={copyTextOf(`${member.label}: No actions recorded`)}
            className='absolute top-7 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-md hover:bg-muted'
            style={{ left: `${(member.start + member.end) * 50}%` }}
            onPointerDown={event => event.stopPropagation()} onClick={() => onSeekFraction((member.start + member.end) / 2)}>
            <CircleSlash aria-hidden='true' className='h-4 w-4 text-muted-foreground' />
          </button></TooltipTrigger>
          <TooltipContent><MaskedText text={member.label} /> · No actions recorded</TooltipContent>
        </Tooltip>)}
      </div>
    </div></TooltipProvider>
  )
}
