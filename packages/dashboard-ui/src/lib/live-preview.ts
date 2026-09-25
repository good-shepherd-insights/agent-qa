// THE LIVE PREVIEW (428 D-14/D-15/D-16).
//
// One pure module owns what the preview corner may say for both entry points, a run and an editor
// session. Health comes only from the frame facts the embed page reports; every clock is a
// parameter. The words are exported constants so conformance files can read them by path, which
// is why each is a single-quoted literal with no apostrophe.

import type { LiveStreamDeclaration, LiveStreamKind } from '@vostride/agent-qa-schema'

export type LivePreviewStateName =
  | 'loading'
  | 'waiting'
  | 'live'
  | 'delayed'
  | 'reconnecting'
  | 'disconnected'
  | 'expired'
  | 'session-ended'
  | 'run-ended'
  | 'member-ended'
  | 'no-stream'
  | 'unavailable'
// prettier-ignore
export const LIVE_PREVIEW_STATES = [
  'loading',
  'waiting',
  'live',
  'delayed',
  'reconnecting',
  'disconnected',
  'expired',
  'session-ended',
  'run-ended',
  'member-ended',
  'no-stream',
  'unavailable',
] as const satisfies readonly LivePreviewStateName[]

export type LiveDotState = 'green' | 'amber' | 'red'
// prettier-ignore
export const LIVE_DOT_STATES = [
  'green',
  'amber',
  'red',
] as const satisfies readonly LiveDotState[]

/** The facts the embed page posts to its host; spelled again here because dashboard-ui imports only ids and schema. */
export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost'
// prettier-ignore
export const LIVE_EMBED_REPORT_EVENTS = [
  'ready',
  'frame',
  'ended',
  'refused',
  'lost',
] as const satisfies readonly LiveEmbedReportEvent[]

export type LivePreviewAction = 'reconnect' | 'refresh' | 'start-fresh'
// prettier-ignore
export const LIVE_PREVIEW_ACTIONS = [
  'reconnect',
  'refresh',
  'start-fresh',
] as const satisfies readonly LivePreviewAction[]

// prettier-ignore
export const LIVE_EMBED_STREAM_KINDS = [
  'cdp-screencast',
  'snapshot',
  'mjpeg',
  'webrtc',
] as const satisfies readonly LiveStreamKind[]

export type LiveEmbedEndReason = 'runFinished' | 'handleFinished' | 'sessionEnded'
// prettier-ignore
export const LIVE_EMBED_END_REASONS = [
  'runFinished',
  'handleFinished',
  'sessionEnded',
] as const satisfies readonly LiveEmbedEndReason[]

export type LiveEmbedRefusalReason =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'scope_mismatch'
  | 'unknown_run'
  | 'unknown_handle'
  | 'unknown_session'
// prettier-ignore
export const LIVE_EMBED_REFUSAL_REASONS = [
  'malformed',
  'bad_signature',
  'expired',
  'scope_mismatch',
  'unknown_run',
  'unknown_handle',
  'unknown_session',
] as const satisfies readonly LiveEmbedRefusalReason[]

/** Green iff the newest frame is younger than this; one window for screencast and snapshot frames. */
export const LIVE_FRESHNESS_WINDOW_MS = 5_000

/** One quiet automatic reconnect per entry; the attempt after the last is disconnected. */
export const LIVE_RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000] as const

/** How long the preview waits before asking the mint door again while the browser is not up yet (403-07). */
export const NO_STREAM_RETRY_MS = 2_500

/** Backstop only: 24 waiting mints at 2.5 s is about a minute (G-403-2). */
export const WAITING_ATTEMPT_LIMIT = 24

/** The embed's host hint; the server spells the parameter LIVE_EMBED_HOST_PARAM. */
export const LIVE_PREVIEW_HOST_QUERY = '?host=dashboard'

/** The server's close code for an editor control socket whose session is gone. */
export const LIVE_EDITOR_SESSION_GONE_CLOSE_CODE = 4404

export const SNAPSHOT_PREVIEW_LABEL = 'Snapshot preview · updates every 1s'
export const PREVIEW_LOADING_TEXT = 'Connecting to the preview…'
export const PREVIEW_DELAYED_TEXT = 'Preview delayed'
export const PREVIEW_RECONNECTING_TEXT = 'Reconnecting…'
export const PREVIEW_DISCONNECTED_TEXT = 'Disconnected'
export const PREVIEW_EXPIRED_TEXT = 'Link expired'
export const PREVIEW_SESSION_ENDED_TEXT = 'Session ended'
export const PREVIEW_RUN_ENDED_TEXT = 'Run ended'
export const PREVIEW_MEMBER_ENDED_TEXT = 'This test finished while the run goes on'
export const PREVIEW_UNAVAILABLE_TEXT = 'Live preview is not available here'

/** What a target that declared no live stream renders; the step list is named by role, never by position. */
export const NO_STREAM_TEXT = 'no live preview for this target — the step list keeps advancing'

/** What the preview observed when its bounded wait expired, claiming nothing about whether the target has a preview. */
export const WAITING_GAVE_UP_TEXT = 'waited for the live view, but nothing arrived — the step list keeps advancing'

/** The badge beside the gave-up sentence, never part of it. */
export const WAITING_GAVE_UP_LABEL = 'gave up'

export const LIVE_PREVIEW_ACTION_LABELS = {
  reconnect: 'Reconnect',
  refresh: 'Refresh',
  'start-fresh': 'Start fresh',
} as const satisfies Record<LivePreviewAction, string>

export const LIVE_DOT_NAMES = {
  green: 'Live preview healthy',
  amber: 'Live preview delayed',
  red: 'Live preview stopped',
} as const satisfies Record<LiveDotState, string>

export const LIVE_DOT_MEANINGS = {
  green: 'Frames are arriving from the browser.',
  amber: 'The newest frame is late, or the preview is reconnecting.',
  red: 'The preview stopped receiving frames.',
} as const satisfies Record<LiveDotState, string>

export type EmbedReport =
  | { event: 'ready'; kind: LiveStreamKind | 'none' }
  | { event: 'frame'; ts?: number; kind?: LiveStreamKind; width: number; height: number }
  | { event: 'ended'; reason: LiveEmbedEndReason }
  | { event: 'refused'; reason: LiveEmbedRefusalReason }
  | { event: 'lost' }

function oneOf<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (set as readonly string[]).includes(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Any window can post to the dashboard, so a report is rebuilt field by field from the closed sets
 * and anything else is dropped. An unknown word never becomes a new member.
 */
export function parseEmbedReport(data: unknown): EmbedReport | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const fields = data as Record<string, unknown>
  switch (fields.event) {
    case 'ready': {
      const kind = fields.kind
      if (kind === 'none') return { event: 'ready', kind }
      return oneOf(LIVE_EMBED_STREAM_KINDS, kind) ? { event: 'ready', kind } : undefined
    }
    case 'frame': {
      const { ts, kind, width, height } = fields
      if (!finite(width) || !finite(height)) return undefined
      return {
        event: 'frame',
        ...(finite(ts) ? { ts } : {}),
        ...(oneOf(LIVE_EMBED_STREAM_KINDS, kind) ? { kind } : {}),
        width,
        height,
      }
    }
    case 'ended':
      return oneOf(LIVE_EMBED_END_REASONS, fields.reason) ? { event: 'ended', reason: fields.reason } : undefined
    case 'refused':
      return oneOf(LIVE_EMBED_REFUSAL_REASONS, fields.reason) ? { event: 'refused', reason: fields.reason } : undefined
    case 'lost':
      return { event: 'lost' }
    default:
      return undefined
  }
}

/** The machine's only input. Nothing here can carry a bus envelope or a transport's state (D-15). */
export type LivePreviewEvent =
  | { type: 'mint-started' }
  | { type: 'minted'; stream: LiveStreamDeclaration; memberAnswered: boolean }
  | { type: 'mint-refused'; word: string }
  | { type: 'renew-failed' }
  | { type: 'embed'; report: EmbedReport }
  | { type: 'lost-scheduled' }
  | { type: 'retry' }
  | { type: 'subject-over'; reason: 'run-ended' | 'session-ended' }
  | { type: 'reset' }
