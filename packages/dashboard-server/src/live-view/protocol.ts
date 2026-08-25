// The LIVE-VIEW WIRE PROTOCOL (403 D-06, ratified 2026-08-25).
//
// THIS IS A PUBLISHED CONTRACT, not an internal shape. Phase 408's MCP App embed and M6's mobile
// transport consume the served page and this socket UNCHANGED, so what a `liveUrl` resolves to is
// one-way after they ship. The vocabulary is therefore written down once, here, and both ends of
// the socket are typed against it.
//
// THE PATH CONSTANTS ARE SPELLED AGAIN IN THIS PACKAGE, deliberately: `dashboard-server` does not
// import `agent` (the run-service routes' no-agent-import rule), so the embed prefix cannot be
// imported from the function layer. `live-view-tracer.test.ts` pins the two spellings EQUAL from
// the CLI, which may import both — the drift is measured rather than assumed away.

import { LIVE_URL_REFUSAL_REASONS } from '@vostride/agent-qa-schema'
import type { LiveStreamDeclaration, LiveUrlRefusalReason } from '@vostride/agent-qa-schema'

/** The frame socket. A query carries the run id ONLY — never the token (D-04). */
export const LIVE_VIEW_WS_PATH = '/api/live-view/ws'

/** The served embed page's prefix. Bare, so a host's `/api/` allowlist is not involved. */
export const LIVE_EMBED_PATH_PREFIX = '/live/'

/** The largest first message this socket will read. A hello is a few hundred bytes. */
export const LIVE_VIEW_HELLO_MAX_BYTES = 4096

/** Above this much buffered, a frame is DROPPED and acked — a slow viewer must not stall CDP. */
export const LIVE_VIEW_SLOW_VIEWER_BYTES = 2 * 1024 * 1024

/** Keepalive cadence. */
export const LIVE_VIEW_PING_MS = 15_000

/** The close code every refusal uses. In the 4000-4999 application range. */
export const LIVE_VIEW_REFUSAL_CLOSE_CODE = 4400

/**
 * Every reason this socket can refuse a viewer, BY NAME.
 *
 * The four token verdicts plus the two this layer alone can answer: a run this process never
 * started, and a handle that run does not have. Extending the token's list rather than restating
 * it is what stops the two vocabularies from drifting.
 */
export const LIVE_VIEW_REFUSAL_REASONS = [
  ...LIVE_URL_REFUSAL_REASONS,
  'unknown_run',
  'unknown_handle',
] as const

export type LiveViewRefusalReason = LiveUrlRefusalReason | 'unknown_run' | 'unknown_handle'

/** What the PAGE sends. `hello` must be first; `ack` and `renew` are valid only after `ready`. */
export type LiveViewClientMessage =
  | { type: 'hello'; token: string }
  | { type: 'ack'; id: number }
  | { type: 'renew'; token: string }

/**
 * What the SERVER sends.
 *
 * A `frame` is a TEXT header immediately followed by ONE BINARY message carrying the JPEG bytes.
 * Two messages rather than a length-prefixed binary frame so a consumer needs no custom header
 * parser — `JSON.parse` and a `Blob` are all an embed page has to know.
 */
export type LiveViewServerMessage =
  | { type: 'ready'; runId: string; handle: number; stream: LiveStreamDeclaration; expiresAt: number }
  | { type: 'refused'; reason: LiveViewRefusalReason }
  | { type: 'frame'; id: number; width: number; height: number }
  | { type: 'renewed'; expiresAt: number }
  // TWO ENDS, EACH BY ITS OWN NAME (403 CR-03). `handleFinished` says THIS member's stream is over
  // while the run continues; `runFinished` says the run is over. Additive to the published
  // contract: a consumer that only knows `runFinished` still reads every message it used to.
  | { type: 'ended'; reason: 'runFinished' | 'handleFinished' }
