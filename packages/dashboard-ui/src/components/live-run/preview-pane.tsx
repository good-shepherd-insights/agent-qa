import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchLiveUrl } from '@/lib/api'

import type { RunsLiveUrlResult } from '@vostride/agent-qa-schema'

/**
 * THE MODE B PREVIEW (403 · LIVE-04, D-02/D-08). One iframe over one minted `liveUrl`, and an
 * honest sentence when there is nothing to show.
 *
 * IT NEVER FALLS BACK TO STILLS. The retired approach polled the run for per-step images and
 * painted them as though they were the browser; what a person saw was up to a step behind, and
 * there was no way to tell from the picture. This pane either embeds the real thing or says it
 * cannot. `stream.kind === 'none'` is a DECLARED capability — the op answers it without opening a
 * socket — so a target with no live stream renders a sentence rather than a broken frame that
 * spins forever.
 *
 * IT IS TRANSPORT-NEUTRAL BY CONSTRUCTION. The pane keys off `kind === 'none'` and embeds every
 * other kind identically. It never names a transport, a browser engine or a codec, because the
 * embed page owns all of that behind the URL; a pane that special-cased one of them would have to
 * be edited every time the platform layer grew another.
 *
 * THE TOKEN IS THE REASON FOR THE SANDBOX. `liveUrl` carries a short-lived capability in its
 * FRAGMENT, and it lives in this component's state and the iframe's `src` — nowhere else. It is
 * never logged, never written to the page URL and never put in history. The frame is sandboxed to
 * scripts alone, with the same-origin escape withheld, which keeps the embedded document in an
 * opaque origin: it can run its own script and paint its own frames, and it cannot read this
 * document, this origin's storage, or reach back through the parent to anything the dashboard can
 * see.
 *
 * THE PANE HAS ITS OWN STATE, DELIBERATELY SEPARATE FROM THE LIVENESS PILL (D-11). Frames can
 * stall while the bus is perfectly live, and the reverse. One indicator for two channels would be
 * wrong about one of them exactly when it mattered.
 */

/** What a target that declared no live stream renders. The steps pane keeps working regardless. */
export const NO_STREAM_TEXT = 'no live preview for this target — steps still advance below'

export type PreviewState = 'minting' | 'embedded' | 'no-stream' | 'ended' | 'unavailable'

export interface PreviewPaneProps {
  runId: string
  /** The run's attachable handle roster, as `runStarted` announced it. Undefined = it announced none. */
  handles: readonly number[] | undefined
  terminal: boolean
  runOver: boolean
}

export function PreviewPane({ runId, handles, terminal, runOver }: PreviewPaneProps) {
  const [handle, setHandle] = useState(0)
  const [mint, setMint] = useState<RunsLiveUrlResult | undefined>(undefined)
  const [previewState, setPreviewState] = useState<PreviewState>('minting')
  const [errorWord, setErrorWord] = useState<string | undefined>(undefined)

  const ended = terminal || runOver

  // The TTL this mint was issued with, so "less than half of it remains" is answerable. The result
  // carries only the deadline; the half-life is a fact about the interval, which needs both ends.
  const mintedAtRef = useRef<number | undefined>(undefined)
  const ttlRef = useRef<number | undefined>(undefined)
  // Every mint carries the token of the request that asked for it. A handle switch mid-flight would
  // otherwise let a stale answer paint over the newer one.
  const requestRef = useRef(0)

  const mintFor = useCallback(
    (nextHandle: number) => {
      const token = requestRef.current + 1
      requestRef.current = token
      fetchLiveUrl(runId, nextHandle)
        .then((result) => {
          if (requestRef.current !== token) return
          mintedAtRef.current = Date.now()
          ttlRef.current = Math.max(0, result.expiresAt - Date.now())
          setErrorWord(undefined)
          if (result.stream.kind === 'none') {
            setMint(undefined)
            setPreviewState('no-stream')
            return
          }
          setMint(result)
          setPreviewState('embedded')
        })
        .catch((error: unknown) => {
          if (requestRef.current !== token) return
          mintedAtRef.current = undefined
          ttlRef.current = undefined
          setMint(undefined)
          // The door's own word (`live_view_unavailable`, `unknown_run`, `invalid_handle`,
          // `live_url_mint_failed`), never prose this pane invented for it.
          setErrorWord(error instanceof Error ? error.message : 'live_url_mint_failed')
          setPreviewState('unavailable')
        })
    },
    [runId],
  )

  useEffect(() => {
    if (ended) {
      // Nothing to mint for a run that is over, and a token minted now would outlive the thing it
      // addresses. The frame comes down with it.
      requestRef.current += 1
      mintedAtRef.current = undefined
      ttlRef.current = undefined
      setMint(undefined)
      setPreviewState('ended')
      return
    }
    setPreviewState('minting')
    mintFor(handle)
  }, [ended, handle, mintFor])

  // THE RE-MINT IS SILENT AND IT HAPPENS AT HALF-LIFE, not at expiry. A capability that expires
  // while a person is watching would black the frame out mid-step and read as a crashed run; half
  // the TTL leaves the same margin again for a slow door to answer in.
  useEffect(() => {
    if (ended || mint === undefined) return
    const delay = Math.max(0, (mint.expiresAt - Date.now()) / 2)
    const timer = setTimeout(() => { mintFor(handle) }, delay)
    return () => { clearTimeout(timer) }
  }, [ended, handle, mint, mintFor])

  // A backgrounded tab's timers are throttled to the point of not firing, so a page left open in a
  // background tab can come back to a token that expired while nobody was looking. Coming back
  // into view is therefore its own re-mint trigger, on the same half-life test.
  useEffect(() => {
    if (ended) return
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const mintedAt = mintedAtRef.current
      const ttl = ttlRef.current
      if (mintedAt === undefined || ttl === undefined) return
      if (Date.now() - mintedAt < ttl / 2) return
      mintFor(handle)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [ended, handle, mintFor])

  const showPicker = handles !== undefined && handles.length > 1

  return (
    <div data-preview-state={previewState} className="flex h-full min-h-0 min-w-0 flex-col">
      {showPicker && (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <label htmlFor="live-preview-handle" className="text-muted-foreground">
            watching
          </label>
          {/*
            ONE PANE AND A PICKER, never a grid (D-08). A grid of every member would spend a
            screencast on each of them and show idle frames for the ones between steps; a person
            watching a parallel run is watching ONE member at a time whatever the layout says.
          */}
          <select
            id="live-preview-handle"
            data-handle-picker
            value={handle}
            onChange={(event) => { setHandle(Number(event.target.value)) }}
            className="rounded-sm border bg-background px-1.5 py-0.5"
          >
            {handles.map((value) => (
              <option key={value} value={value}>
                handle {value}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {previewState === 'embedded' && mint !== undefined && (
          <iframe
            data-live-embed
            sandbox="allow-scripts"
            src={mint.liveUrl}
            title="live preview"
            className="size-full border-0"
          />
        )}
        {previewState === 'no-stream' && <p className="p-6 text-sm text-muted-foreground">{NO_STREAM_TEXT}</p>}
        {previewState === 'minting' && <p className="p-6 text-sm text-muted-foreground">attaching to the live view...</p>}
        {previewState === 'ended' && <p className="p-6 text-sm text-muted-foreground">run ended</p>}
        {previewState === 'unavailable' && (
          <p data-preview-error={errorWord} className="p-6 text-sm text-muted-foreground">
            live preview unavailable — {errorWord}
          </p>
        )}
      </div>
    </div>
  )
}
