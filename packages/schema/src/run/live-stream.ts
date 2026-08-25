import { z } from 'zod'

/**
 * The live-view transport families a run handle can declare (403 D-05/D-08). `cdp-screencast` is
 * the only kind with a producer today; `mjpeg` (mobile, M6) and `webrtc` (headful phase 2) are
 * named here so a consumer switches on a DECLARED kind rather than on a browser name or an
 * adapter class (LIVE-04's prohibition).
 */
export type LiveStreamKind = 'cdp-screencast' | 'mjpeg' | 'webrtc'

/**
 * What a handle declares about its live stream. `{ kind: 'none' }` is the HONEST absent state —
 * a non-Chromium target, a finished member, or an adapter with no capability. It is never an
 * error and never a blank frame: the surface renders the no-stream state by name.
 */
export type LiveStreamDeclaration = { kind: LiveStreamKind } | { kind: 'none' }

/** The zod mirror of {@link LiveStreamDeclaration} — a discriminated union on `kind`. */
export const LiveStreamDeclarationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cdp-screencast') }).strict(),
  z.object({ kind: z.literal('mjpeg') }).strict(),
  z.object({ kind: z.literal('webrtc') }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
])

/** Per-frame geometry as the producer reported it (CDP `screencastFrame.metadata`). */
export interface LiveFrameMetadata {
  width: number
  height: number
  timestamp?: number
  scrollOffsetX?: number
  scrollOffsetY?: number
}

/**
 * ONE live frame as DATA (403 D-05): an id to ack with, the encoded bytes, and geometry. No
 * `Page`, no `CDPSession`, no handle of any kind crosses this type — which is what lets frames
 * travel a side channel while the run event bus stays silent about them (LIVE-03).
 */
export interface LiveFrame {
  id: number
  bytes: Uint8Array
  metadata: LiveFrameMetadata
}

/**
 * A subscriber's hold on a handle's frame stream. `ack` reports that this subscriber consumed the
 * frame (the producer only asks for the next one once every subscriber has, or the ack bound
 * elapses); `unsubscribe` drops the hold and counts as acked for every outstanding frame.
 */
export interface LiveFrameSubscription {
  ack(frameId: number): void
  unsubscribe(): void
}
