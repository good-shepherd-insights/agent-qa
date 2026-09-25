// THE LIVE PREVIEW (428 D-14/D-15/D-16). Skeleton: the types are declared, the values are not.

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
] as const satisfies readonly LivePreviewStateName[]

export type LiveDotState = 'green' | 'amber' | 'red'
// prettier-ignore
export const LIVE_DOT_STATES = [
] as const satisfies readonly LiveDotState[]

export type LiveEmbedReportEvent = 'ready' | 'frame' | 'ended' | 'refused' | 'lost'
// prettier-ignore
export const LIVE_EMBED_REPORT_EVENTS = [
] as const satisfies readonly LiveEmbedReportEvent[]

export type LivePreviewAction = 'reconnect' | 'refresh' | 'start-fresh'
// prettier-ignore
export const LIVE_PREVIEW_ACTIONS = [
] as const satisfies readonly LivePreviewAction[]

// prettier-ignore
export const LIVE_EMBED_STREAM_KINDS = [
] as const satisfies readonly LiveStreamKind[]

export type LiveEmbedEndReason = 'runFinished' | 'handleFinished' | 'sessionEnded'
// prettier-ignore
export const LIVE_EMBED_END_REASONS = [
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
] as const satisfies readonly LiveEmbedRefusalReason[]

export const LIVE_FRESHNESS_WINDOW_MS = 0
export const LIVE_RECONNECT_BACKOFF_MS = [] as const
export const NO_STREAM_RETRY_MS = 0
export const WAITING_ATTEMPT_LIMIT = 0
export const LIVE_PREVIEW_HOST_QUERY = ''
export const LIVE_EDITOR_SESSION_GONE_CLOSE_CODE = 0

export const SNAPSHOT_PREVIEW_LABEL = ''
export const PREVIEW_LOADING_TEXT = ''
export const PREVIEW_DELAYED_TEXT = ''
export const PREVIEW_RECONNECTING_TEXT = ''
export const PREVIEW_DISCONNECTED_TEXT = ''
export const PREVIEW_EXPIRED_TEXT = ''
export const PREVIEW_SESSION_ENDED_TEXT = ''
export const PREVIEW_RUN_ENDED_TEXT = ''
export const PREVIEW_MEMBER_ENDED_TEXT = ''
export const PREVIEW_UNAVAILABLE_TEXT = ''
export const NO_STREAM_TEXT = ''
export const WAITING_GAVE_UP_TEXT = ''
export const WAITING_GAVE_UP_LABEL = ''

export const LIVE_PREVIEW_ACTION_LABELS = {
  reconnect: '',
  refresh: '',
  'start-fresh': '',
} as const satisfies Record<LivePreviewAction, string>

export const LIVE_DOT_NAMES = { green: '', amber: '', red: '' } as const satisfies Record<LiveDotState, string>

export const LIVE_DOT_MEANINGS = { green: '', amber: '', red: '' } as const satisfies Record<LiveDotState, string>

export type EmbedReport =
  | { event: 'ready'; kind: LiveStreamKind | 'none' }
  | { event: 'frame'; ts?: number; kind?: LiveStreamKind; width: number; height: number }
  | { event: 'ended'; reason: LiveEmbedEndReason }
  | { event: 'refused'; reason: LiveEmbedRefusalReason }
  | { event: 'lost' }

export function parseEmbedReport(_data: unknown): EmbedReport | undefined {
  return undefined
}

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
