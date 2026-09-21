import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import type { RecordingEntry, RunDetailArtifactRef } from '@vostride/agent-qa-schema'
import { ScreenshotViewer } from '@/components/screenshot-viewer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { copyTextOf } from '@/lib/display-text'
import { EVIDENCE_COPY, resolveEvidenceView } from '@/lib/evidence-state-view'
import { formatOffset, frameUsable, type PlayerSource, type Playhead, type TimelineModel, type UsableFrame } from '@/lib/playhead'
import { captionModel, mediaErrorView, PLAYER_COPY, PLAYBACK_SPEEDS, storePlayerSource, VIDEO_UNTIMED_NOTE } from '@/lib/player-view'
import { routes } from '@/lib/routes'
import { probeMediaError } from '@/lib/media-error-probe'
import { frameAnnotation } from '@/lib/frame-annotation'
import type { StepAnnotation } from '@/lib/api'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import type { MediaFacade } from '@/test/media-facade'
import { ActionSentence } from './action-sentence'
import { EvidenceState } from './evidence-state'

export function PlayerFrame({ runId, frame, annotation, wholeStep = false }: {
  runId: string
  frame?: RunDetailArtifactRef
  annotation?: StepAnnotation
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
      <ScreenshotViewer key={attempt} src={url!} annotation={annotation} onUnavailable={() => {
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
  seekFraction?: number
  media?: MediaFacade
  timeline?: ReactNode
  isTimelineKeyIgnored?: (event: KeyboardEvent) => boolean
}

function PlayerFooter({ timeline, caption, controls, note }: {
  timeline?: ReactNode
  caption: ReactNode
  controls: ReactNode
  note?: ReactNode
}) {
  return <div data-player-footer className='pb-2'>
    {timeline}
    <div data-player-actions className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3'>
      {caption}
      <div data-player-controls className='flex min-w-0 flex-wrap items-center gap-2'>{controls}</div>
    </div>
    {note && <p className='px-3 pt-1 text-xs text-muted-foreground'>{note}</p>}
  </div>
}

function addressKey(playhead: Playhead | null | undefined) {
  return playhead ? `${playhead.testIndex}:${playhead.stepIndex}:${playhead.subActionIndex}` : ''
}

function PlayerVideo({ model, playhead, recording, runId, media, seekFraction, onPlayheadChange, isTimelineKeyIgnored, timeline, caption, header }: PlayerProps & {
  recording: Extract<RecordingEntry, { state: 'present' }>
  caption: ReactNode
  header: ReactNode
}) {
  const element = useRef<HTMLVideoElement>(null)
  const active = useRef<MediaFacade | null>(null)
  const latest = useRef({ model, playhead, onPlayheadChange })
  latest.current = { model, playhead, onPlayheadChange }
  const followed = useRef('')
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState<ReturnType<typeof mediaErrorView>>()
  const [attempt, setAttempt] = useState(0)
  const url = routes.runArtifact(runId, recording.ref.sha)
  const marker = model.markers.find(candidate => addressKey(candidate) === addressKey(playhead))
  const offset = marker?.recordingOffsetMs
  const key = addressKey(playhead)

  useEffect(() => {
    const facade = media ?? element.current
    if (!facade) return
    active.current = facade
    const controller = new AbortController()
    const loaded = () => {
      setReady(true)
      setTime(facade.currentTime)
    }
    const update = () => {
      setTime(facade.currentTime)
      if (facade.paused || latest.current.model.axis !== 'time') return
      const current = latest.current.model.markers.filter(candidate => candidate.recordingOffsetMs! <= facade.currentTime * 1000)
        .reduce<typeof marker>((last, candidate) => !last || candidate.recordingOffsetMs! >= last.recordingOffsetMs! ? candidate : last, undefined)
      if (!current || addressKey(current) === addressKey(latest.current.playhead) || addressKey(current) === followed.current) return
      followed.current = addressKey(current)
      latest.current.onPlayheadChange({ testIndex: current.testIndex, stepIndex: current.stepIndex, subActionIndex: current.subActionIndex })
    }
    const ended = () => { facade.pause(); setPlaying(false); setTime(facade.currentTime) }
    const failed = () => {
      facade.pause()
      void probeMediaError(url, controller.signal).then(result => {
        if (!controller.signal.aborted) { setError(mediaErrorView('video', result)); setReady(false) }
      })
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const events: Record<string, EventListener> = { loadedmetadata: loaded, timeupdate: update, ended, error: failed, play: onPlay, pause: onPause }
    for (const [name, listener] of Object.entries(events)) facade.addEventListener(name, listener)
    if (!facade.paused) facade.pause()
    if (!media && element.current && element.current.readyState >= 1) loaded()
    return () => {
      controller.abort()
      for (const [name, listener] of Object.entries(events)) facade.removeEventListener(name, listener)
      if (!facade.paused) facade.pause()
      active.current = null
    }
  }, [media, url, attempt])

  useEffect(() => {
    if (!ready || model.axis !== 'time' || offset === undefined || !active.current) return
    if (followed.current === key) { followed.current = ''; return }
    active.current.currentTime = offset / 1000
    setTime(active.current.currentTime)
  }, [ready, model.axis, key, offset])

  useEffect(() => {
    if (!ready || model.axis !== 'time' || seekFraction === undefined || !Number.isFinite(seekFraction)
      || recording.durationMs === undefined || !active.current) return
    followed.current = ''
    active.current.currentTime = Math.max(0, Math.min(1, seekFraction)) * recording.durationMs / 1000
    setTime(active.current.currentTime)
  }, [ready, model.axis, seekFraction, recording.durationMs])

  useEffect(() => {
    if (active.current) active.current.playbackRate = speed
  }, [speed, attempt])

  function togglePlayback() {
    const facade = active.current
    if (!ready || !facade) return false
    if (facade.paused) void facade.play().catch(() => { setError(mediaErrorView('video', {})); setReady(false) })
    else facade.pause()
  }

  useKeyboardShortcuts({
    ' ': event => {
      if (!isTimelineKeyIgnored || isTimelineKeyIgnored(event)) return false
      return togglePlayback()
    },
  })

  return <>
    <div data-player-preview className='px-3 pt-3' data-artifact-state={error ? 'unavailable' : 'available'}>
      {error ? <EvidenceState {...error} kind='video' onAction={() => {
        setError(undefined); setReady(false); setPlaying(false); followed.current = ''; setAttempt(value => value + 1)
      }} /> : <video key={attempt} ref={element} src={url} preload='metadata' muted playsInline className='max-h-[50vh] w-full rounded-lg border' />}
    </div>
    <PlayerFooter timeline={timeline} caption={caption} note={model.axis === 'ordinal' ? VIDEO_UNTIMED_NOTE : undefined} controls={<>
      {header}
      <Button size='icon-sm' variant='ghost' aria-label={playing ? PLAYER_COPY.pause : PLAYER_COPY.play} disabled={!ready}
        onClick={togglePlayback}>
        {playing ? <Pause className='h-4 w-4' /> : <Play className='h-4 w-4' />}
      </Button>
      <Select value={String(speed)} onValueChange={value => {
        const next = Number(value)
        if (!PLAYBACK_SPEEDS.some(candidate => candidate === next)) return
        setSpeed(next)
        if (active.current) active.current.playbackRate = next
      }}>
        <SelectTrigger aria-label={PLAYER_COPY.speed} size='sm' className='w-20 shrink-0'><SelectValue /></SelectTrigger>
        <SelectContent>{PLAYBACK_SPEEDS.map(value => <SelectItem key={value} value={String(value)}>{value}×</SelectItem>)}</SelectContent>
      </Select>
      <span data-player-time className='whitespace-nowrap font-mono text-xs tabular-nums'>{formatOffset(time * 1000) ?? '0:00'}{recording.durationMs === undefined ? '' : ` / ${formatOffset(recording.durationMs)}`}</span>
    </>} />
  </>
}

export function Player(props: PlayerProps) {
  const { model, playhead, source, recording, frame, runId, onSourceChange } = props
  const marker = model.markers.find(candidate => candidate.testIndex === playhead?.testIndex
    && candidate.stepIndex === playhead.stepIndex && candidate.subActionIndex === playhead.subActionIndex)
  const selectedFrame = frame?.ref ?? marker?.ref
  // A parent-step fallback can show an earlier action. Its geometry must follow its bytes.
  const frameOwner = frame ? model.markers.find(candidate => candidate.testIndex === playhead?.testIndex
    && candidate.stepIndex === playhead.stepIndex && candidate.subActionIndex === frame.index
    && candidate.ref?.sha === frame.ref.sha) : marker
  const caption = marker ? captionModel(marker, frame) : undefined
  const videoView = resolveEvidenceView({ kind: 'video', selection: 'sub-action', entry: recording, read: 'idle' })
  const absent = videoView.kind === 'state'
  const videoName = absent ? copyTextOf(`${PLAYER_COPY.video} — ${videoView.title}`) : PLAYER_COPY.video
  const toggle = <ToggleGroup type='single' value={source} aria-label={PLAYER_COPY.source} onValueChange={value => {
          if (value === 'frames' || value === 'video') { storePlayerSource(value); onSourceChange(value) }
        }}>
          <ToggleGroupItem value='frames' title={PLAYER_COPY.framesTooltip} className='text-xs'>{PLAYER_COPY.frames}</ToggleGroupItem>
          <ToggleGroupItem value='video' aria-label={videoName} title={videoName} className={`text-xs${absent ? ' opacity-60' : ''}`}>{PLAYER_COPY.video}</ToggleGroupItem>
        </ToggleGroup>
  const title = marker && caption && <div data-player-caption data-frame-source-sub-action={caption.frameSourceSubAction}
        className='min-w-0 flex-1 basis-40 text-sm font-medium [overflow-wrap:anywhere] [&_[data-action-family]]:text-sm [&_[data-action-family]]:font-medium'>
        <ActionSentence sub={marker.subAction} wrap='free' />
        {caption.substitution && <p className='text-xs text-muted-foreground'>{caption.substitution}</p>}
      </div>
  return (
    <section data-player data-player-source={source}>
      {source === 'video' && recording?.state === 'present' && !absent
        ? <PlayerVideo key={`${runId}:${model.testIndex}:${recording.ref.sha}`} {...props} recording={recording} caption={title} header={toggle} />
        : <>
      <div data-player-preview className='[&>[data-artifact-state]]:pb-0'>
      {source === 'frames' && <PlayerFrame key={`${runId}:${selectedFrame?.sha ?? 'none'}:${playhead?.stepIndex}:${playhead?.subActionIndex}`}
        runId={runId} frame={selectedFrame} annotation={frameAnnotation(frameOwner?.subAction)} wholeStep={!marker} />}
      {source === 'video' && videoView.kind === 'state' && <div className='p-3' data-artifact-state='unavailable'>
        <EvidenceState {...videoView} kind='video' />
      </div>}
      </div>
      <PlayerFooter timeline={props.timeline} caption={title} controls={toggle} />
      </>}
    </section>
  )
}
