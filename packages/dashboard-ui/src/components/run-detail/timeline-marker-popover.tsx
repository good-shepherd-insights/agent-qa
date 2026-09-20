import { useState, type ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { EVIDENCE_COPY } from '@/lib/evidence-state-view'
import { formatOffset, type TimelineMarker } from '@/lib/playhead'
import { routes } from '@/lib/routes'
import { TIMELINE_COPY, timelineValueText } from '@/lib/timeline-view'
import { ActionSentence } from './action-sentence'
import { EvidenceState } from './evidence-state'

interface TimelineMarkerPopoverProps {
  marker: TimelineMarker
  total: number
  runId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactElement
}

function Thumbnail({ marker, runId }: Pick<TimelineMarkerPopoverProps, 'marker' | 'runId'>) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  return <div className='relative flex h-[116px] w-[208px] items-center justify-center bg-muted'>
    {marker.frame === 'absent' || !marker.ref
      ? <EvidenceState kind='frame' variant='inline' state='unavailable'
          incomplete={marker.ref?.evidenceIncomplete === true || marker.ref?.present === false}
          {...EVIDENCE_COPY.frame.unavailable} />
      : failed
        ? <EvidenceState kind='frame' variant='inline' state='failed' failure='load' {...EVIDENCE_COPY.frame.failed.load} />
        : <>
            {!loaded && <Skeleton className='absolute inset-0 h-full w-full' />}
            <img src={routes.runArtifact(runId, marker.ref.sha)} alt='' className='h-full w-full object-contain'
              onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
          </>}
  </div>
}

export function TimelineMarkerPopover({ marker, total, runId, open, onOpenChange, children }: TimelineMarkerPopoverProps) {
  const time = formatOffset(marker.recordingOffsetMs, 'popover')
  return <Tooltip open={open} onOpenChange={onOpenChange} disableHoverableContent>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    {open && <TooltipContent data-timeline-popover={marker.ordinal} className='w-56 p-2'
      aria-label={timelineValueText(marker, total)}>
      <Thumbnail key={`${runId}:${marker.ordinal}:${marker.ref?.sha}:${marker.frame}`} marker={marker} runId={runId} />
      <div className='mt-2 text-[10px] font-medium tabular-nums'>#{marker.ordinal}</div>
      <ActionSentence sub={marker.subAction} wrap='line-clamp-2' />
      <div className='text-xs'>{TIMELINE_COPY.results[marker.result]}</div>
      {time !== undefined && <div className='font-mono text-xs tabular-nums'>{time}</div>}
    </TooltipContent>}
  </Tooltip>
}
