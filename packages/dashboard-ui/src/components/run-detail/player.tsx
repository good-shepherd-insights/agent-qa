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
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import type { MediaFacade } from '@/test/media-facade'
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
  seekFraction?: number
  media?: MediaFacade
  isTimelineKeyIgnored?: (event: KeyboardEvent) => boolean
}

function addressKey(playhead: Playhead | null | undefined) {
  return playhead ? `${playhead.testIndex}:${playhead.stepIndex}:${playhead.subActionIndex}` : ''
}

function PlayerVideo({ model, playhead, recording, runId, media, seekFraction, onPlayheadChange, isTimelineKeyIgnored, header }: PlayerProps & {
  recording: Extract<RecordingEntry, { state: 'present' }>
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
    <div className='flex items-center gap-2 px-3 py-2'>
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
        <SelectTrigger aria-label={PLAYER_COPY.speed} size='sm' className='w-20'><SelectValue /></SelectTrigger>
        <SelectContent>{PLAYBACK_SPEEDS.map(value => <SelectItem key={value} value={String(value)}>{value}×</SelectItem>)}</SelectContent>
      </Select>
      <span data-player-time className='font-mono text-xs tabular-nums'>{formatOffset(time * 1000) ?? '0:00'}{recording.durationMs === undefined ? '' : ` / ${formatOffset(recording.durationMs)}`}</span>
    </div>
    <div className='p-3' data-artifact-state={error ? 'unavailable' : 'available'}>
      {error ? <EvidenceState {...error} kind='video' onAction={() => {
        setError(undefined); setReady(false); setPlaying(false); followed.current = ''; setAttempt(value => value + 1)
      }} /> : <video key={attempt} ref={element} src={url} preload='metadata' muted playsInline className='max-h-[50vh] w-full rounded-lg border' />}
      {model.axis === 'ordinal' && <p className='pt-2 text-xs text-muted-foreground'>{VIDEO_UNTIMED_NOTE}</p>}
    </div>
  </>
}

export function Player(props: PlayerProps) {
  const { model, playhead, source, recording, frame, runId, onSourceChange } = props
  const marker = model.markers.find(candidate => candidate.testIndex === playhead?.testIndex
    && candidate.stepIndex === playhead.stepIndex && candidate.subActionIndex === playhead.subActionIndex)
  const selectedFrame = frame?.ref ?? marker?.ref
  const caption = marker ? captionModel(marker, frame) : undefined
  const videoView = resolveEvidenceView({ kind: 'video', selection: 'sub-action', entry: recording, read: 'idle' })
  const absent = videoView.kind === 'state'
  const videoName = absent ? copyTextOf(`${PLAYER_COPY.video} — ${videoView.title}`) : PLAYER_COPY.video
  const toggle = <ToggleGroup type='single' value={source} aria-label={PLAYER_COPY.source} onValueChange={value => {
          if (value === 'frames' || value === 'video') { storePlayerSource(value); onSourceChange(value) }
        }}>
          <ToggleGroupItem value='frames' title={PLAYER_COPY.framesTooltip}>{PLAYER_COPY.frames}</ToggleGroupItem>
          <ToggleGroupItem value='video' aria-label={videoName} title={videoName} className={absent ? 'opacity-60' : undefined}>{PLAYER_COPY.video}</ToggleGroupItem>
        </ToggleGroup>
  return (
    <section data-player data-player-source={source}>
      {source === 'video' && recording?.state === 'present' && !absent
        ? <PlayerVideo key={`${runId}:${model.testIndex}:${recording.ref.sha}`} {...props} recording={recording} header={toggle} />
        : <div className='flex items-center gap-2 px-3 py-2'>{toggle}</div>}
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
