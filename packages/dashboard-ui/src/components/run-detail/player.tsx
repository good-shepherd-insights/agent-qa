import { useEffect, useRef, useState } from 'react'
import type { RecordingEntry, RunDetailArtifactRef } from '@vostride/agent-qa-schema'
import { ScreenshotViewer } from '@/components/screenshot-viewer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { copyTextOf } from '@/lib/display-text'
import { EVIDENCE_COPY, resolveEvidenceView } from '@/lib/evidence-state-view'
import { frameUsable, type PlayerSource, type Playhead, type TimelineModel, type UsableFrame } from '@/lib/playhead'
import { captionModel, mediaErrorView, PLAYER_COPY } from '@/lib/player-view'
import { routes } from '@/lib/routes'
import { ActionSentence } from './action-sentence'
import { EvidenceState } from './evidence-state'

export async function probeMediaError(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal })
    return { status: response.status }
  } catch {
    return {}
  }
}

export function PlayerFrame({ runId, frame, wholeStep = false }: {
  runId: string
  frame?: RunDetailArtifactRef
  wholeStep?: boolean
}) {
  const [error, setError] = useState<ReturnType<typeof mediaErrorView>>()
  const [attempt, setAttempt] = useState(0)
  const request = useRef<AbortController | null>(null)
  const url = frame ? routes.runArtifact(runId, frame.sha) : undefined
  useEffect(() => () => request.current?.abort(), [url])
  if (error || (frame && !frameUsable(frame))) return (
    <div data-artifact-state='unavailable' className='p-3'>
      <EvidenceState kind='frame' {...(error ?? mediaErrorView('frame', { blobAbsent: true }))}
        onAction={() => { setError(undefined); setAttempt(value => value + 1) }} />
    </div>
  )
  if (!frameUsable(frame)) return (
    <div data-artifact-state='unavailable' className='p-3'>
      <EvidenceState kind='frame' state='not-captured' {...EVIDENCE_COPY.frame['not-captured'][wholeStep ? 'step' : 'sub-action']} />
    </div>
  )
  return (
    <div data-artifact-state='available' className='p-3'>
      <ScreenshotViewer key={attempt} src={url!} onUnavailable={() => {
        request.current?.abort()
        const controller = new AbortController()
        request.current = controller
        void probeMediaError(url!, controller.signal).then(result => {
          if (!controller.signal.aborted) setError(mediaErrorView('frame', result))
        })
      }} />
    </div>
  )
}

export interface PlayerProps {
  model: TimelineModel
  playhead: Playhead | null
  source: PlayerSource
  recording?: RecordingEntry
  frame?: UsableFrame
  runId: string
  onSourceChange: (source: PlayerSource) => void
  onPlayheadChange: (playhead: Playhead) => void
}

export function Player({ model, playhead, source, recording, frame, runId, onSourceChange }: PlayerProps) {
  const marker = model.markers.find(candidate => candidate.testIndex === playhead?.testIndex
    && candidate.stepIndex === playhead.stepIndex && candidate.subActionIndex === playhead.subActionIndex)
  const selectedFrame = frame?.ref ?? marker?.ref
  const caption = marker ? captionModel(marker, frame) : undefined
  const videoView = resolveEvidenceView({ kind: 'video', selection: 'sub-action', entry: recording, read: 'idle' })
  const absent = videoView.kind === 'state'
  const videoName = absent ? copyTextOf(`${PLAYER_COPY.video} — ${videoView.title}`) : PLAYER_COPY.video
  return (
    <section data-player data-player-source={source}>
      <div className='flex items-center gap-2 px-3 py-2'>
        <ToggleGroup type='single' value={source} aria-label={PLAYER_COPY.source} onValueChange={value => {
          if (value === 'frames' || value === 'video') onSourceChange(value)
        }}>
          <ToggleGroupItem value='frames' title={PLAYER_COPY.framesTooltip}>{PLAYER_COPY.frames}</ToggleGroupItem>
          <ToggleGroupItem value='video' aria-label={videoName} title={videoName} className={absent ? 'opacity-60' : undefined}>{PLAYER_COPY.video}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {source === 'frames' && <PlayerFrame key={`${runId}:${selectedFrame?.sha ?? 'none'}:${playhead?.stepIndex}:${playhead?.subActionIndex}`}
        runId={runId} frame={selectedFrame} wholeStep={!marker} />}
      {source === 'video' && videoView.kind === 'state' && <div className='p-3' data-artifact-state='unavailable'>
        <EvidenceState {...videoView} kind='video' />
      </div>}
      {marker && caption && <div data-player-caption data-frame-source-sub-action={caption.frameSourceSubAction}
        className='space-y-1 px-3 pb-3 text-sm font-medium [overflow-wrap:anywhere] [&_[data-action-family]]:text-sm [&_[data-action-family]]:font-medium'>
        <ActionSentence sub={marker.subAction} ordinal={caption.ordinal} wrap='free' />
        <span className='text-xs text-muted-foreground'>{caption.result}{caption.offset === undefined ? '' : ` · ${caption.offset}`}</span>
        {caption.substitution && <p className='text-xs text-muted-foreground'>{caption.substitution}</p>}
      </div>}
    </section>
  )
}
