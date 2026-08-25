import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { Radio, XCircle } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { LivenessPill, livenessForAttach } from '@/components/live-run/liveness-pill'
import { PreviewPane } from '@/components/live-run/preview-pane'
import { StepList } from '@/components/live-run/step-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { usePageTitle } from '@/hooks/use-page-title'
import { getRunFaviconState, type RunFaviconState, useRunStatusFavicon } from '@/hooks/use-run-status-favicon'
import { cancelRun, classifyRunStreamClose, fetchRun, openRunStream } from '@/lib/api'
import type { RunRow } from '@/lib/api'
import { routes } from '@/lib/routes'
import {
  createInitialRunStreamState,
  markGap,
  reduceRunStream,
  type LivenessSource,
  type RunStreamState,
} from '@/lib/run-stream-reducer'
import { getRunStatusDescriptor, getStatusBadgeClassName } from '@/lib/status'
import { cn } from '@/lib/utils'

import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

/**
 * THE HONEST RUN-TIME SURFACE (403 · HNST-01/HNST-02/HNST-03, LIVE-04, INVK-05, D-09..D-13).
 *
 * WHAT THIS PAGE STOPPED DOING. It used to render the whole run-detail apparatus live: a clickable
 * step tree, tab panels over reasoning and console and network, per-step screenshots — all of it
 * fed by the legacy execution-events feed and all of it PROVISIONAL, because a step that has not
 * finalized has no settled answer to give. A person watching it was reading a draft as though it
 * were a record. That apparatus still serves run detail, over durable state, where it is true; it
 * is gone from here.
 *
 * WHAT IT DOES INSTEAD. Two panes and nothing else: a status-only step list off the run event bus,
 * and one embedded live preview of the browser the run is actually driving. What is on screen is
 * either a fact the bus published or a picture of the real thing.
 *
 * THE THREE HONESTY CLAIMS ARE STRUCTURAL, NOT EDITORIAL.
 *  - HNST-01: nothing provisional is reachable because {@link StepList} accepts nothing that could
 *    carry it — the reducer dropped those fields at ingest and the props never name them.
 *  - HNST-02: motion and a count, never a phase word, because the page has no way to know what
 *    happens between two sub-actions and will not guess.
 *  - HNST-03: liveness is read off BUS ENVELOPES, so a socket to a dead run goes `lost` rather than
 *    reading "connected" forever.
 *
 * AND AT THE END IT STOPS (D-12). `runFinished` freezes the rows, closes the source, and offers run
 * detail as a link. It does not navigate: auto-advancing on the verdict is LIFE-01's clause and
 * belongs with the phase that owns verdict-exactly-once, against a run-detail page 405 has not yet
 * rebuilt. A page that redirected here would take the decision away from a person watching a
 * failure land.
 */

const SOURCE_OPEN = 1
const SOURCE_CLOSED = 2

/** The page's one clock cadence: the elapsed timer and the staleness window both re-read here. */
const CLOCK_TICK_MS = 1000

/**
 * D-13's visible gap, in words. The bus never silently truncates and neither does this page: a
 * step that flips `pending` → `failed` with no visible reason is the failure the marker exists to
 * refuse, and the range is inclusive on both ends because both ends are envelopes nobody will see.
 */
export function gapMarkerText(from: number, to: number): string {
  return `${String(to - from + 1)} events missed (seq ${String(from)}–${String(to)}) — see run detail`
}

/** What the terminal band says beside the verdict. */
export const RUN_ENDED_TEXT = 'run ended'

/** D-15's word for a run this process can no longer stream. */
export const RUN_OVER_TEXT = 'this run is over — view run detail'

/**
 * The not-yet probe for a run the door has never heard of, in attempts and in cadence.
 *
 * ~20 s of bounded probing: long enough for a run whose session has not reached the registry to
 * appear, short enough that a link to a long-gone run settles on `this run is over` while the
 * person is still looking at it.
 */
const NOT_YET_ATTACH_RETRY_MS = 2_500
const NOT_YET_ATTACH_LIMIT = 8

export default function LiveRunPage() {
  usePageTitle('Live Run')
  const { id } = useParams<{ id: string }>()

  const [state, setState] = useState<RunStreamState>(createInitialRunStreamState)
  const [now, setNow] = useState(() => Date.now())
  const [attachedAt, setAttachedAt] = useState<number | undefined>(undefined)
  const [attachToken, setAttachToken] = useState(0)
  const [runOver, setRunOver] = useState(false)
  const [erroredWhileConnecting, setErroredWhileConnecting] = useState(false)
  const [sourceReadyState, setSourceReadyState] = useState(0)
  const [fallbackRun, setFallbackRun] = useState<RunRow | null>(null)
  const [runMetaFailed, setRunMetaFailed] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  // The resume point for the NEXT attach. Read from the reducer's `lastSeq` (the HIGHEST seq seen)
  // rather than tracked here off render order: a resume point that walked backward on an
  // out-of-order delivery would re-open a gap this viewer had already been served (403-04).
  const resumeRef = useRef<number | undefined>(undefined)
  const stateRef = useRef(state)
  stateRef.current = state
  // How many times this page has re-attached to a run the door does not know about YET. Bounded,
  // so D-15's refusal to hammer a settled door survives the not-yet probe below.
  const notYetAttemptsRef = useRef(0)

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, CLOCK_TICK_MS)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (id === undefined) return
    let cancelled = false
    setRunMetaFailed(false)
    fetchRun(id)
      .then((data) => { if (!cancelled) setFallbackRun(data.run) })
      .catch(() => {
        // The BUS is the truth on this page. The run row only feeds a title and a link, so a door
        // that cannot answer for it is a notice, never a blocker — the stream is already attached.
        if (!cancelled) setRunMetaFailed(true)
      })
    return () => { cancelled = true }
  }, [id])

  const onEvent = useCallback((envelope: RunEventEnvelope) => {
    setErroredWhileConnecting(false)
    setSourceReadyState(SOURCE_OPEN)
    const at = Date.now()
    setNow(at)
    setState((previous) => reduceRunStream(previous, envelope, at))
  }, [])

  useEffect(() => {
    if (id === undefined) return
    let disposed = false

    const attachAt = Date.now()
    setAttachedAt(attachAt)
    setSourceReadyState(0)
    // Every not-yet re-attach timer this attach armed, cleared with the attach that armed it — a
    // page unmounted mid-probe must not wake up and re-open a socket nobody is watching.
    const pendingTimers: ReturnType<typeof setTimeout>[] = []

    const source = openRunStream(id, {
      // `=== undefined`, never truthiness: seq 0 is a real resume point ("from the very
      // beginning"), and a falsy guard here would silently turn it into "from wherever you like".
      lastEventId: resumeRef.current,
      onEvent,
      onFinished: () => {
        // D-12. The door closed the stream on its own terms; there is nothing left to attach to
        // and nothing to classify. The page freezes and offers the durable record.
        setSourceReadyState(SOURCE_CLOSED)
      },
      onError: (_event, errored) => {
        if (disposed) return
        setSourceReadyState(errored.readyState)

        if (errored.readyState !== SOURCE_CLOSED) {
          // The browser is retrying this socket itself, with `Last-Event-ID` for free. Saying
          // `reconnecting` is the whole of what a person needs told.
          setErroredWhileConnecting(true)
          return
        }

        // A CLOSED source is one wordless event standing for three different situations, so the
        // page asks the door which one it was rather than guessing from `readyState` (403-04).
        if (stateRef.current.terminal) return

        const lastSeq = stateRef.current.lastSeq
        void classifyRunStreamClose(id, { lastEventId: lastSeq }).then((reason) => {
          if (disposed) return
          switch (reason.kind) {
            case 'replay_floor': {
              // The door's own arithmetic: a floor at `earliestAvailableSeq` means everything from
              // `lastSeq + 1` to `earliestAvailableSeq - 1` is gone for good, and the stream can be
              // picked back up by asking for exactly that floor.
              setState((previous) => markGap(previous, lastSeq, reason.earliestAvailableSeq))
              resumeRef.current = reason.earliestAvailableSeq - 1
              setAttachToken((token) => token + 1)
              return
            }
            case 'reattach': {
              resumeRef.current = lastSeq
              setAttachToken((token) => token + 1)
              return
            }
            case 'unknown_run': {
              // D-15, AND THE NOT-YET RUN IT USED TO SWALLOW (403-07, gap 1 arm 2).
              //
              // `unknown_run` is one word for two situations, and the discriminator is whether
              // this page has ever heard ANYTHING about the run. A page that has folded envelopes
              // and is now told the run is unknown has watched its retention elapse — retrying
              // would hammer a door that has already given its final answer, so D-15 stands and
              // the durable record is the honest destination. A page that has heard NOTHING yet
              // (`lastSeq === 0`) may simply have arrived before the session reached the registry,
              // which is the ordinary flow: every trigger surface navigates here the instant the
              // run id exists. Latching `this run is over` there is the same lie the preview pane
              // used to tell, one channel across — and it is worse, because it takes the whole
              // page down with it.
              //
              // THE PROBE IS BOUNDED, which is what keeps D-15's argument intact: a run that never
              // appears costs a fixed, short handful of attaches and then reads `over` for good.
              if (lastSeq > 0 || notYetAttemptsRef.current >= NOT_YET_ATTACH_LIMIT) {
                setRunOver(true)
                return
              }
              notYetAttemptsRef.current += 1
              const timer = setTimeout(() => {
                if (disposed) return
                setAttachToken((token) => token + 1)
              }, NOT_YET_ATTACH_RETRY_MS)
              pendingTimers.push(timer)
              return
            }
            case 'lost': {
              // The question could not be asked or could not be understood. The pill already says
              // `lost` for a closed source; the run may well still be alive, and run detail is the
              // durable place to find out.
              return
            }
          }
        })
      },
    })

    // AN OPEN SOCKET IS TRACKED PRECISELY SO IT CANNOT BE MISTAKEN FOR LIVENESS. Recording the
    // transport's own `open` is what makes "the socket is open and the run has said nothing for
    // twenty seconds" a state this page can be in, and therefore a lie it can refuse to tell. A
    // page that never learned the socket was open could not distinguish that from a socket still
    // dialling — and would have no way to be wrong about it, which is not the same as being right.
    source.addEventListener('open', () => {
      if (disposed) return
      setSourceReadyState(SOURCE_OPEN)
      setErroredWhileConnecting(false)
    })

    return () => {
      disposed = true
      for (const timer of pendingTimers) clearTimeout(timer)
      source.close()
    }
  }, [id, attachToken, onEvent])

  const livenessSource: LivenessSource = useMemo(
    () => ({ readyState: sourceReadyState, erroredWhileConnecting }),
    [sourceReadyState, erroredWhileConnecting],
  )
  const liveness = livenessForAttach(state, now, livenessSource, attachedAt)

  const members = useMemo(() => Object.values(state.members), [state.members])
  const verdictWord = state.verdict ?? fallbackRun?.status ?? 'unknown'
  const verdictDescriptor = getRunStatusDescriptor(verdictWord)

  const faviconState: RunFaviconState = state.verdict === undefined ? 'running' : getRunFaviconState(state.verdict)
  useRunStatusFavicon(id === undefined ? 'default' : faviconState)

  const handleCancel = useCallback(() => {
    if (id === undefined || isCancelling) return
    setIsCancelling(true)
    cancelRun(id)
      .then(() => { toast.success('Run cancelled') })
      .catch(() => { toast.error('Failed to cancel run') })
      .finally(() => { setIsCancelling(false) })
  }, [id, isCancelling])

  if (id === undefined) {
    return <EmptyState icon={Radio} title="No run selected" description="Select a test run to watch live execution" />
  }

  const title = fallbackRun?.name ?? 'Live Run'
  const isOver = state.terminal || runOver

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
        {/*
          The product tour's live-run anchor. It moved from the deleted progress band to the
          header status group — the tour step says "live mode shows the active execution", and the
          pill beside the title is now the thing that says so.
        */}
        <div data-tour-id="tour-live-run-status" className="flex min-w-0 items-center gap-2">
          <Radio className={cn('size-4 shrink-0', !isOver && 'animate-pulse text-blue-500')} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold leading-tight">{title}</h2>
              {/*
                THE PILL IS A CLAIM ABOUT A CHANNEL, so it goes away with the channel. A run that
                finished has no liveness to report — `lost` over a clean `runFinished` would read
                as a failure of the very delivery that just completed successfully, and `live` over
                a closed socket would be the open-socket lie wearing the other mask.
              */}
              {!isOver && (
                <LivenessPill
                  liveness={liveness.kind}
                  lastActivityAgeMs={liveness.lastActivityAgeMs}
                  attachedAgeMs={attachedAt === undefined ? undefined : now - attachedAt}
                />
              )}
            </div>
            {fallbackRun?.filePath !== undefined && fallbackRun.filePath !== null && (
              <div className="min-w-0 truncate text-xs text-muted-foreground">{fallbackRun.filePath}</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isOver && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="h-7 px-2 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
            >
              <XCircle className="size-3.5" />
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </Button>
          )}
          <Link data-run-detail-link to={routes.runDetail(id)} className="text-xs underline-offset-4 hover:underline">
            view run detail
          </Link>
        </div>
      </div>

      {(state.terminal || runMetaFailed || runOver || state.gap !== undefined || state.notices.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-xs">
          {state.terminal && (
            <div data-terminal-state={verdictDescriptor.normalized} className="flex items-center gap-2">
              <Badge className={getStatusBadgeClassName(verdictDescriptor.tone)}>{verdictDescriptor.label}</Badge>
              <span className="text-muted-foreground">{RUN_ENDED_TEXT}</span>
            </div>
          )}
          {runOver && (
            <p data-run-over className="text-muted-foreground">
              {RUN_OVER_TEXT}
            </p>
          )}
          {state.gap !== undefined && (
            // ONE TEMPLATE STRING, not a run of JSX children. A marker split across text nodes is
            // one reformat away from gaining or losing a space, and this sentence is a published
            // contract two suites read back verbatim.
            <p data-gap-marker className="text-amber-500">
              {gapMarkerText(state.gap.from, state.gap.to)}
            </p>
          )}
          {runMetaFailed && (
            <p data-run-meta-unavailable className="text-muted-foreground">
              run details unavailable — the live stream is unaffected
            </p>
          )}
          {state.notices.map((notice, index) => (
            <p key={`${notice.code}:${String(index)}`} data-run-notice={notice.code} className="text-amber-500">
              {notice.message}
            </p>
          ))}
        </div>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 overflow-hidden">
        <ResizablePanel defaultSize={40} minSize={20}>
          <section data-live-pane="steps" className="flex h-full min-h-0 min-w-[280px] flex-col overflow-y-auto">
            <StepList members={members} steps={state.steps} terminal={state.terminal} now={now} />
          </section>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={60} minSize={30}>
          <section data-live-pane="preview" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <PreviewPane
              runId={id}
              handles={state.handles}
              membersByHandle={state.members}
              terminal={state.terminal}
              runOver={runOver}
            />
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
