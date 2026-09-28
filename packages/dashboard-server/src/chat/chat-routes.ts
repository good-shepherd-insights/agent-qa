// The run-confirm router (401-09, D-11; narrowed by 430 D-02).
//
// TWO ROUTES, AND PHASE 432 DELETES THEM. The run trigger's confirm channel and its answer route
// are all this router serves. The conversation routes it was first built for were removed in 430
// (D-02) and answer the dashboard's generic 404. The router, its table and this file keep their
// names until Phase 432 removes the run-confirm pair with them.
//
// NO WILDCARD ORIGIN ON THE MUTATING ROUTE. `routes.ts`'s shared `json()` helper sets
// `Access-Control-Allow-Origin: *` on every response it writes. That is a read idiom and it does not
// belong on a route that approves an ask-tier action on this machine: a wildcard here would let any
// page a person has open answer a question meant for them. This file therefore writes its own JSON
// responder rather than importing that one.
//
// THE MUTATING ROUTES ARE GUARDED AT ONE CHOKE POINT, NOT ROUTE BY ROUTE (400-14, gap 6).
// Withholding `Access-Control-Allow-Origin` stops an attacker READING the reply and does nothing
// about the side effect, and a `text/plain` JSON POST is a CORS SIMPLE request, so the 204-no-grant
// preflight arm never even runs. The router therefore refuses every MUTATING request that is
// cross-site or does not declare `application/json`, on the method and above the route table — so a
// route added tomorrow inherits both guards without anybody remembering to add them.

import type { IncomingMessage, ServerResponse } from 'node:http'

import { z } from 'zod'

import { readJsonBody } from '../server/body-parser.js'
import { refuseCrossSiteRequest } from '../server/cross-site.js'
import {
  CHAT_CONFIRM_ANSWERS,
  isRunTriggerConfirmScope,
  mintRunTriggerConfirmScope,
  type ChatConfirmChannelFrame,
  type ConfirmScopeId,
} from './confirm-registry.js'
import type { AgentHost } from './host.js'

/**
 * The run trigger's confirm surface (401-09, D-11).
 *
 * MOUNTED AHEAD OF `cors()`, AND THAT IS THE WHOLE POINT. The two guards below — the cross-site
 * refusal and the media-type refusal — are applied to the METHOD, above the route table, so every
 * mutating route this file serves inherits them by construction. A run-confirm answer route mounted
 * anywhere else in this server would sit behind `routes.ts`'s shared `cors()` arm, which grants
 * `Access-Control-Allow-Origin: *` to every preflight — handing any page a person has open the
 * permission it needs to approve an ask-tier run on their machine.
 *
 * THE CHANNEL IS OPENED BEFORE THE RUN EXISTS, and that order is the whole design. The dashboard's
 * queue dispatches on its own `enqueued` event, in the same tick the trigger route enqueues, so a
 * browser that learned the scope from the trigger's response would be racing the run's own gate. So
 * the channel route MINTS the scope and hands it back on the stream as its first frame; the trigger
 * then names the scope it wants asked. A scope with nobody holding its stream does not exist, which
 * is what makes "no live channel" and "no such scope" the same fail-closed answer.
 */
export const RUN_CONFIRM_ROUTE_PREFIX = '/api/run-confirm/'

/** Where a person's yes / always / no comes back for a RUN trigger. */
export const RUN_CONFIRM_ANSWER_ROUTE = '/api/run-confirm/answer'

/**
 * The trigger's confirm channel — one connection, one freshly minted scope.
 *
 * NO `:id` IN THE PATH, deliberately: this route is the act of BECOMING askable, so there is
 * nothing to name yet, and an unminted id cannot be opened here because no id is accepted at all.
 */
export const RUN_CONFIRM_CHANNEL_ROUTE = '/api/run-confirm/channel'

/** The first frame every trigger channel carries: the scope this connection was minted. */
export const RUN_CONFIRM_SCOPE_FRAME_KIND = 'confirm_scope'

/** Which handler a table row reaches. A closed union, so a row with no arm is a type error. */
export type ChatRouteHandlerName = 'runConfirm' | 'runConfirmChannel'

export interface ChatRouteRow {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly handler: ChatRouteHandlerName
}

/**
 * EVERY PATH THIS ROUTER ANSWERS, as data the dispatch reads — not as a chain of `if`s (400-14).
 *
 * WHY A TABLE AND NOT TWO ARMS. The cross-site and media-type guards below are the whole of gap 6's
 * fix, and their claim is an ORDER claim: no mutating request reaches a body read without passing
 * them. A guard bolted onto each POST arm would make that claim a fact about the arms somebody
 * remembered — true today, silently false the morning a third route lands. The guards are therefore
 * applied to the METHOD, at the top, before this table is consulted at all, so a new mutating route
 * inherits them by construction rather than by review.
 *
 * The table is what makes that inheritance AUDITABLE from outside. Because dispatch reads it, a
 * route that is not in it is unreachable — so a cell can enumerate this array, drive every mutating
 * row cross-origin, and a newly added route cannot escape the corpus by nobody noticing it. That
 * cell is `dashboard-door-security.test.ts`'s completeness cell, and this export exists for it.
 */
export const CHAT_ROUTE_TABLE: readonly ChatRouteRow[] = Object.freeze([
  { method: 'POST', path: RUN_CONFIRM_ANSWER_ROUTE, handler: 'runConfirm' },
  { method: 'GET', path: RUN_CONFIRM_CHANNEL_ROUTE, handler: 'runConfirmChannel' },
] as const)

/** What a matched row carries. */
export interface ChatRouteMatch {
  readonly row: ChatRouteRow
}

/** Resolve a request to a table row, or to nothing. The dispatch's only route lookup. */
export function matchChatRoute(
  method: string | undefined,
  path: string,
): ChatRouteMatch | undefined {
  for (const row of CHAT_ROUTE_TABLE) {
    if (row.method === method && row.path === path) return { row }
  }
  return undefined
}

/**
 * The methods that change nothing — and therefore the complement, which is what the guards range.
 *
 * STATED AS THE SAFE SET RATHER THAN THE MUTATING ONE, deliberately. A list of mutating methods is
 * a list somebody has to extend, and forgetting to extend it is a hole that opens silently; a list
 * of SAFE methods fails the other way, so an unfamiliar verb is guarded rather than waved through.
 */
export const CHAT_SAFE_METHODS: readonly string[] = Object.freeze(['GET', 'HEAD', 'OPTIONS'])

/** Whether this request can change something — the guards' whole domain. */
export function isMutatingChatRequest(method: string | undefined): boolean {
  return !CHAT_SAFE_METHODS.includes((method ?? 'GET').toUpperCase())
}

// `refuseCrossSiteRequest` USED TO BE DEFINED HERE. It moved to `../server/cross-site.js`
// unchanged when 403's gap round found the live-url mint door needing the identical guard: two
// spellings of "is this cross-site" would be two policies. The recorded rung-by-rung policy
// travelled with it and is the doc comment on the exported function.

/**
 * Refuse a mutating request that does not declare JSON (400-14, gap 6 — the preflight leg).
 *
 * THIS IS THE LEG THAT CLOSES THE ACTUAL HOLE, and it is worth naming why the Origin check above is
 * not enough on its own. A `text/plain` JSON POST is a CORS SIMPLE request: the browser sends it
 * with no preflight at all, so this router's 204-no-grant `OPTIONS` arm — the arm that is supposed
 * to stop a cross-origin caller — never runs. Requiring `application/json` makes every browser-borne
 * mutating request non-simple, which forces the preflight into the arm that already refuses it.
 *
 * A MISSING HEADER IS REFUSED TOO. There is no bodyless mutating request on this router, so an
 * absent media type is a caller that has not said what it is sending, and the refusal says what to
 * send.
 */
function refuseUnsupportedMediaType(req: IncomingMessage): string | undefined {
  const header = req.headers['content-type']
  const mediaType = typeof header === 'string' ? header.split(';')[0]!.trim().toLowerCase() : ''
  if (mediaType === 'application/json') return undefined
  return 'Unsupported media type: this route reads application/json only '
    + '(send `content-type: application/json`)'
}

/** The heartbeat interval, in the shipped run-events stream's own spelling. */
const CHAT_STREAM_HEARTBEAT_MS = 15_000

/**
 * The RUN trigger's answer, validated at the door (401-09 — T-401-25).
 *
 * `scopeId` names the scope the question was parked for, and the registry compares it, so an id
 * that leaked somewhere it should not have cannot be spent on another browser's confirm. It is
 * REFUSED unless it is a trigger scope.
 *
 * `.strict()` and the closed answer enum: three answers, no fourth, and no new approval semantics
 * anywhere on this surface.
 */
const RunConfirmAnswerSchema = z.object({
  scopeId: z.string().min(1),
  confirmId: z.string().min(1),
  answer: z.enum(CHAT_CONFIRM_ANSWERS),
}).strict()

/**
 * JSON, WITHOUT the cross-origin wildcard `routes.ts`'s helper writes.
 *
 * Deliberately a second responder rather than a parameter on the shared one. A flag would make the
 * safe posture opt-in at a seam where every future route author has to remember it; a separate
 * function makes the wildcard something a route here would have to import to acquire.
 */
type Respond = (res: ServerResponse, data: unknown, status?: number) => void

/**
 * Build the router's ONE responder: same-origin JSON, unmasked exactly once (400-06).
 *
 * A CLOSURE RATHER THAN A DEFAULTED PARAMETER: an optional `unmask` argument makes the display
 * boundary something each handler has to remember to pass, and the failure mode of forgetting is
 * silent — a placeholder rendered where a value belongs. Built once, here, and every arm of this
 * file writes through it.
 *
 * THE UNMASK RUNS ON THE SERIALISED BYTES, which is where the CLI runs it too (`emitHuman` unmasks
 * the rendered string, not the value). A masked placeholder is a token inside a string, so the text
 * pass is total over every payload without knowing any of their fields.
 */
function createResponder(unmask: (text: string) => string): Respond {
  return (res, data, status = 200) => {
    const body = unmask(JSON.stringify(data))
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  }
}

/** Everything the router answers when it cannot answer. */
function refuseWith(respond: Respond, res: ServerResponse, error: string, status: number): void {
  respond(res, { error }, status)
}

/**
 * The router's LAST answer — what a request gets when something threw past every guard (400-14).
 *
 * DELIBERATELY NOT THROUGH THIS ROUTER'S RESPONDER. The responder runs the host's unmasker over the
 * serialised bytes, and one of the faults this backstop exists to catch is the unmasker itself: a
 * backstop that re-entered it would throw inside its own catch and answer nothing at all. These
 * bytes are a fixed literal carrying no host value, so there is nothing here for a masker to
 * reduce — the one place in this file where writing the response directly is the safe choice
 * rather than the lazy one.
 *
 * ONCE THE HEAD IS OUT, THE ONLY HONEST ANSWER IS TO HANG UP. A stream that has already written
 * `200 text/event-stream` cannot be told it failed, and appending a JSON body to it would hand the
 * client a frame it will try to parse. Destroying the socket is what a reader can actually act on.
 */
function backstopRefusal(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy()
    return
  }
  const body = JSON.stringify({
    error: `The request could not be completed [${error instanceof Error ? error.name : 'Error'}]`,
  })
  try {
    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  } catch {
    res.destroy()
  }
}

/**
 * Spend a RUN trigger's confirm id (401-09, D-11).
 *
 * A single-use id, compared against the scope it was parked for, with ONE 404 for "no such id" /
 * "already spent" / "belongs to another scope". A distinguishable answer on any of those three
 * would be an oracle for probing which runs have questions outstanding.
 */
async function handleRunConfirm(
  host: AgentHost,
  respond: Respond,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const confirms = host.confirms
  if (confirms === undefined) {
    refuseWith(respond, res, 'Run confirms are not available: this server was started without a confirm channel', 501)
    return
  }

  let body: unknown
  try {
    body = await readJsonBody<unknown>(req)
  } catch {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }
  const parsed = RunConfirmAnswerSchema.safeParse(body)
  if (!parsed.success) {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }

  // ONLY A TRIGGER SCOPE IS ANSWERABLE HERE. Reported as the same 404 every other refusal on this
  // route uses, so "that is not a trigger scope" and "no such confirm" are one answer from outside.
  if (!isRunTriggerConfirmScope(parsed.data.scopeId)) {
    refuseWith(respond, res, 'Unknown or already-answered confirm', 404)
    return
  }

  const outcome = confirms.answer({
    scopeId: parsed.data.scopeId,
    confirmId: parsed.data.confirmId,
    answer: parsed.data.answer,
  })
  if (outcome.kind === 'unknown-confirm') {
    refuseWith(respond, res, 'Unknown or already-answered confirm', 404)
    return
  }
  respond(res, { resolved: true, answer: outcome.answer })
}

/**
 * The router's request handler. Its name and callable shape stay until Phase 432 removes it.
 */
export interface ChatRouter {
  (req: IncomingMessage, res: ServerResponse): void
}

/**
 * The run-confirm router: total over its own prefix, and never anything else.
 *
 * TOTAL BY DESIGN. It answers 404 for an unrecognised path under its prefix rather than falling
 * through, because the fall-through it would land in is `routes.ts`'s shared `notFound`, which
 * writes the wildcard origin header this file's first paragraph is about.
 *
 * The absent-host arm is a 501 rather than a 404, on the idiom every optional dependency in
 * `routes.ts` already uses: the route EXISTS, this server was simply started without an agent host
 * (a bare `createRouter(db)`, or a dashboard embedded somewhere that composes none). "Not
 * implemented here" and "no such path" are different facts and a client can act on the difference.
 */
export function createChatRouter(host: AgentHost | undefined): ChatRouter {
  /** Every open channel's writer, so a frame reaches whoever holds its scope and a close removes one. */
  const confirmStreams = new Set<(scopeId: ConfirmScopeId, frame: ChatConfirmChannelFrame) => void>()

  // ONE SUBSCRIPTION AT CONSTRUCTION: a subscription taken per connection would make the registry's
  // listener set grow with reconnects.
  host?.confirms?.subscribe((scopeId, frame) => {
    for (const write of [...confirmStreams]) write(scopeId, frame)
  })

  const confirms = host?.confirms

  /**
   * The display boundary of this router (400-06). Identity when no host is bound: there is then no
   * masking context to consult and nothing this router can emit that ever passed a masker.
   */
  const unmask = (text: string): string =>
    host === undefined ? text : host.unmaskForDisplay(text)
  const respond = createResponder(unmask)

  /**
   * One confirm frame, on the wire.
   *
   * NO `id:` LINE. These frames are transient facts about a question in flight, not a replayable
   * sequence, so they carry no number a reconnect could spend.
   *
   * ONLY THE `data:` LINE IS UNMASKED. The kind is this transport's own word and never passed a
   * masker; running one over the whole frame would put the display boundary somewhere a reader of
   * this file could not see it.
   */
  function confirmFrameBytes(frame: ChatConfirmChannelFrame): string {
    return `event: ${frame.kind}\n`
      + `data: ${unmask(JSON.stringify(frame.kind === 'confirm_request' ? frame.request : frame))}\n\n`
  }

  /**
   * The RUN trigger's confirm channel (401-09, D-11).
   *
   * CONFIRM FRAMES AND NOTHING ELSE. A run's durable record is its own event log, which the
   * execution SSE route already serves; a second projection of it here would be a second answer to
   * what a run's history is.
   *
   * THE SCOPE IS MINTED HERE AND ANNOUNCED AS THE FIRST FRAME. Opening this stream is the act of
   * becoming askable: the scope exists because this connection does, and it stops existing when the
   * connection does — at which point the registry denies every question outstanding on it, which is
   * the tab-closed reaper. Handing the scope back on the stream rather than in a JSON response is
   * what keeps it known ONLY to whoever is holding the stream, and this router writes no
   * cross-origin grant, so a page on another origin can hold the socket open and never read a byte
   * of it.
   */
  function handleRunConfirmChannel(req: IncomingMessage, res: ServerResponse): void {
    const scopeId: ConfirmScopeId = mintRunTriggerConfirmScope()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write(':ok\n\n')
    // FIRST, AND BEFORE THE CHANNEL IS REGISTERED, so a caller reading frames in order always has
    // the scope before any question could arrive on it.
    res.write(
      `event: ${RUN_CONFIRM_SCOPE_FRAME_KIND}\n`
      + `data: ${JSON.stringify({ scopeId })}\n\n`,
    )

    const writeConfirm = (frameScopeId: ConfirmScopeId, frame: ChatConfirmChannelFrame): void => {
      if (frameScopeId !== scopeId) return
      res.write(confirmFrameBytes(frame))
    }
    confirmStreams.add(writeConfirm)
    const closeChannel = confirms?.openChannel(scopeId)

    const heartbeat = setInterval(() => {
      res.write(':\n\n')
    }, CHAT_STREAM_HEARTBEAT_MS)
    // `unref` so an open stream cannot hold a process alive past its work — the interval exists to
    // keep a proxy from reaping an idle socket, which is not a reason to keep node running.
    heartbeat.unref?.()

    req.on('close', () => {
      clearInterval(heartbeat)
      confirmStreams.delete(writeConfirm)
      // LAST, and never before the writer is removed: releasing the channel resolves this scope's
      // pending confirms, which emits `confirm_resolved` frames — and writing one into a socket
      // this handler has just been told is closed is a write nobody reads.
      closeChannel?.()
    })
  }

  /**
   * EVERY WAY A REQUEST CAN THROW PAST THIS ROUTER, ENUMERATED (400-14, gap 7).
   *
   * Extend this list rather than re-deriving it. The router runs INSIDE a `node:http` request
   * handler, so an exception that leaves it is an `uncaughtException` and the shipped
   * `agent-qa dashboard` process dies.
   *
   * 1. `new URL(req.url …)` at the head — an unparseable request line. Guarded: 400.
   * 2. `handleRunConfirm` — a fire-and-forget promise whose rejection would be an unhandled
   *    rejection. Guarded: `.catch` into the boundary backstop.
   * 3. Any synchronous throw anywhere in the dispatch, including the channel handler's body and
   *    the responder's own unmask pass. Guarded: the `try` around `dispatch` below — ONE boundary
   *    rather than a nested one per arm.
   *
   * The precise guards and the backstop are BOTH present on purpose: the precise ones give a
   * caller an answer they can act on (404, 400), and the backstop makes "the process survives"
   * true for the faults nobody has thought of yet.
   */
  const dispatch = (req: IncomingMessage, res: ServerResponse): void => {
    // The router answers its OWN preflight, and the answer carries no `Access-Control-Allow-Origin`
    // at all. The shared `cors()` helper grants `*`, which would hand any page a person has open
    // the permission it needs to POST an answer at their local agent. 204 with no grant is a
    // preflight a cross-origin caller cannot use and a same-origin one never needs.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': 0 })
      res.end()
      return
    }

    // ---- THE MUTATING-REQUEST CHOKE POINT (400-14, gap 6) ------------------------------------
    //
    // ON THE METHOD, ABOVE THE ROUTE TABLE, AND BEFORE ANY BODY IS READ. Both refusals below
    // return from THIS function, so no handler is invoked and the confirm registry is never
    // consulted. That is a structural fact about where these lines sit, not a claim about what the
    // handlers do.
    if (isMutatingChatRequest(req.method)) {
      const crossSite = refuseCrossSiteRequest(req)
      if (crossSite !== undefined) {
        refuseWith(respond, res, crossSite, 403)
        return
      }
      const mediaType = refuseUnsupportedMediaType(req)
      if (mediaType !== undefined) {
        refuseWith(respond, res, mediaType, 415)
        return
      }
    }

    if (host === undefined) {
      refuseWith(respond, res, 'Run confirmation is not available: this server was started without an agent host', 501)
      return
    }

    let path: string
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      refuseWith(respond, res, 'Invalid request URL', 400)
      return
    }

    const matched = matchChatRoute(req.method, path)
    if (matched === undefined) {
      refuseWith(respond, res, 'Not found', 404)
      return
    }

    switch (matched.row.handler) {
      case 'runConfirm':
        handleRunConfirm(host, respond, req, res).catch((error: unknown) => {
          backstopRefusal(res, error)
        })
        return
      case 'runConfirmChannel':
        handleRunConfirmChannel(req, res)
        return
    }
  }

  const router = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      dispatch(req, res)
    } catch (error) {
      backstopRefusal(res, error)
    }
  }

  return router
}
