// The fourth door's HTTP surface (Phase 400 plan 01, DASH-01 / D-02 / D-03).
//
// ONE ROUTE THAT DISPATCHES, ONE THAT LISTS. `POST /api/chat/turn` turns a browser-shaped request
// into exactly one `invokeFunction(agent.ask, …)` — the same single call `agent-qa chat` makes for
// every line a person types — and answers with the typed result the op returned. `GET
// /api/chat/capabilities` says what this door reaches. There is no third route and there must never
// be a per-capability one: `/api/chat/run-test` would be a bespoke handler with no roster row, no
// gate wall measured over it and no parity claim about it, which is 397 D-03 by name.
//
// STATUS COMES FROM THE CLASSIFIER, NEVER FROM THE TRANSPORT (DASH-01, 399.1 D-01..D-03). A turn
// that refused every clause is a 200 carrying receipts whose `status` the per-op classifier folds
// decided. Deriving a receipt status from an HTTP code or from throw-vs-return would put the
// door's own opinion where the classifier's answer belongs, and would make `refused` — a first-class
// outcome meaning the control worked — indistinguishable from `failed`. The only non-200s here are
// the ones that exist BEFORE a turn: a malformed body, an absent host, an unknown path.
//
// NO WILDCARD ORIGIN ON THE MUTATING ROUTE. `routes.ts`'s shared `json()` helper sets
// `Access-Control-Allow-Origin: *` on every response it writes, and the SSE stream sets it too.
// That is a read-idiom and it does not belong on a route that starts work: a wildcard here invites
// any page a person has open to drive their local agent. This file therefore writes its own JSON
// responder rather than importing that one, and the tracer cell asserts the header's ABSENCE — the
// real authz story is Phase 402's, and this is the part of it 400 must not make harder.
//
// THE MUTATING ROUTES ARE GUARDED AT ONE CHOKE POINT, NOT DOOR BY DOOR (400-14, gap 6). The
// paragraph above was the door's whole cross-origin story and it was not enough: withholding
// `Access-Control-Allow-Origin` stops an attacker READING the reply and does nothing about the
// side effect, and a `text/plain` JSON POST is a CORS SIMPLE request, so the 204-no-grant preflight
// arm never even runs. The router therefore refuses every MUTATING request that is cross-site or
// does not declare `application/json`, on the method and above the route table — so a route added
// tomorrow inherits both guards without anybody remembering to add them.
//
// THE TURN-EVENTS STREAM IS A PROJECTION OF THE LOG, NEVER A SECOND PRODUCER (D-03). Every frame
// `GET /api/chat/sessions/:id/events` emits was appended to that session's own JSONL file BEFORE
// this process was told about it, so the durable truth and the push can disagree only by the file
// being wrong. The buffer that makes reconnect replay possible is a bounded window over the same
// records — it answers "what did I miss", never "what happened", which is the log's question.

import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentAskResult, ChatSessionEvent } from '@vostride/agent-qa-schema'
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
import type { AgentHost, ChatTurnFold, ChatTurnResponse } from './host.js'

/** Every path this door owns, so the router can hand it a prefix and nothing else. */
export const CHAT_ROUTE_PREFIX = '/api/chat/'

export const CHAT_TURN_ROUTE = '/api/chat/turn'
export const CHAT_CAPABILITIES_ROUTE = '/api/chat/capabilities'

/**
 * The committed capability catalog, served (400-06).
 *
 * BESIDE `capabilities` AND NOT INSTEAD OF IT, because they answer different questions.
 * `/capabilities` is PRODUCED by driving this door's own registry listing — it is what the
 * conformance adapter enumerates and it says what THIS door reaches right now. `/catalog` serves
 * the committed artifact: aliases, descriptions, doc paths, the migration map — the human-facing
 * documentation the CLI's `/help` and completer read. Collapsing them would either put prose in
 * the enumeration the roster measures or make the roster's census depend on a checked-in file.
 */
export const CHAT_CATALOG_ROUTE = '/api/chat/catalog'

/**
 * Where a person's yes / always / no comes back (400-03, D-05 / D-06 / D-07).
 *
 * A SECOND ROUTE AND NOT A SECOND DOOR. It dispatches nothing and reaches no capability: all it can
 * do is spend one outstanding confirm id, and the decision that id was minted for is already inside
 * a turn that is waiting. `POST` because it changes something (a question stops being open), and
 * inside the `/api/chat/` prefix because that prefix is what withholds the cross-origin wildcard —
 * a confirm-answer route reachable from any open page would be a click-yes-on-somebody's-behalf
 * primitive, which is strictly worse than the turn route it sits beside.
 */
export const CHAT_CONFIRM_ROUTE = '/api/chat/confirm'

/**
 * The RUN TRIGGER's confirm surface (401-09, D-11) — a second prefix on the SAME router.
 *
 * NOT A SECOND ROUTER, AND THAT IS THE WHOLE POINT. The two guards below — the cross-site refusal
 * and the media-type refusal — are applied to the METHOD, above the route table, so every mutating
 * route this file serves inherits them by construction. A run-confirm answer route mounted anywhere
 * else in this server would sit behind `routes.ts`'s shared `cors()` arm, which grants
 * `Access-Control-Allow-Origin: *` to every preflight — handing any page a person has open the
 * permission it needs to approve an ask-tier run on their machine. That is strictly worse than the
 * hole 400-01 found on the turn route, so the run trigger's confirm rides this door's posture
 * instead, and `routes.ts` mounts this prefix ahead of `cors()` exactly as it mounts the chat one.
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
 * NO `:id` IN THE PATH, deliberately. The chat stream takes a conversation id because the
 * conversation already exists and the person is asking to watch a particular one; this route is the
 * act of BECOMING askable, so there is nothing to name yet. That also removes the guard the chat
 * stream needs: an unminted id cannot be opened here because no id is accepted at all.
 */
export const RUN_CONFIRM_CHANNEL_ROUTE = '/api/run-confirm/channel'

/** The first frame every trigger channel carries: the scope this connection was minted. */
export const RUN_CONFIRM_SCOPE_FRAME_KIND = 'confirm_scope'

/** `/api/chat/sessions/<id>/events` — the one streaming path, matched rather than parsed. */
const CHAT_SESSION_EVENTS_PATTERN = /^\/api\/chat\/sessions\/([^/]+)\/events$/

/** The one templated path, in the shape a person reads it — the table's row for the stream. */
export const CHAT_SESSION_EVENTS_TEMPLATE = '/api/chat/sessions/:id/events'

/** Which handler a table row reaches. A closed union, so a row with no arm is a type error. */
export type ChatRouteHandlerName =
  | 'turn'
  | 'confirm'
  | 'capabilities'
  | 'catalog'
  | 'sessionEvents'
  | 'runConfirm'
  | 'runConfirmChannel'

export interface ChatRouteRow {
  readonly method: 'GET' | 'POST'
  /** The literal path, or — for a templated route — its `:id` shape. */
  readonly path: string
  readonly handler: ChatRouteHandlerName
  /** Present only on a templated route; the matcher uses it instead of `path`. */
  readonly pattern?: RegExp
}

/**
 * EVERY PATH THIS DOOR ANSWERS, as data the dispatch reads — not as a chain of `if`s (400-14).
 *
 * WHY A TABLE AND NOT FIVE ARMS. The cross-site and media-type guards below are the whole of
 * gap 6's fix, and their claim is an ORDER claim: no mutating request reaches a body read without
 * passing them. A guard bolted onto each POST arm would make that claim a fact about the arms
 * somebody remembered — true today, silently false the morning a sixth route lands. The guards are
 * therefore applied to the METHOD, at the top, before this table is consulted at all, so a new
 * mutating route inherits them by construction rather than by review.
 *
 * The table is what makes that inheritance AUDITABLE from outside. Because dispatch reads it, a
 * route that is not in it is unreachable — so a cell can enumerate this array, drive every mutating
 * row cross-origin, and a newly added route cannot escape the corpus by nobody noticing it. That
 * cell is `dashboard-door-security.test.ts`'s completeness cell, and this export exists for it.
 */
export const CHAT_ROUTE_TABLE: readonly ChatRouteRow[] = Object.freeze([
  { method: 'POST', path: CHAT_TURN_ROUTE, handler: 'turn' },
  { method: 'POST', path: CHAT_CONFIRM_ROUTE, handler: 'confirm' },
  { method: 'GET', path: CHAT_CAPABILITIES_ROUTE, handler: 'capabilities' },
  { method: 'GET', path: CHAT_CATALOG_ROUTE, handler: 'catalog' },
  {
    method: 'GET',
    path: CHAT_SESSION_EVENTS_TEMPLATE,
    handler: 'sessionEvents',
    pattern: CHAT_SESSION_EVENTS_PATTERN,
  },
  // 401-09: the run trigger's two, in the same table for the same reason every other row is here —
  // dispatch reads it, so a route that is not in it is unreachable, and the completeness cell that
  // drives every mutating row cross-origin ranges these the day they land.
  { method: 'POST', path: RUN_CONFIRM_ANSWER_ROUTE, handler: 'runConfirm' },
  { method: 'GET', path: RUN_CONFIRM_CHANNEL_ROUTE, handler: 'runConfirmChannel' },
] as const)

/** What a matched row carries: the row itself and whatever its pattern captured. */
export interface ChatRouteMatch {
  readonly row: ChatRouteRow
  /** The raw, still-ENCODED capture groups. Decoding is the handler's business, and it can throw. */
  readonly params: readonly string[]
}

/** Resolve a request to a table row, or to nothing. The dispatch's only route lookup. */
export function matchChatRoute(
  method: string | undefined,
  path: string,
): ChatRouteMatch | undefined {
  for (const row of CHAT_ROUTE_TABLE) {
    if (row.method !== method) continue
    if (row.pattern === undefined) {
      if (path === row.path) return { row, params: [] }
      continue
    }
    const matched = row.pattern.exec(path)
    if (matched !== null) return { row, params: matched.slice(1).map((part) => part ?? '') }
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
 * with no preflight at all, so this door's 204-no-grant `OPTIONS` arm — the arm that is supposed to
 * stop a cross-origin caller — never runs. Requiring `application/json` makes every browser-borne
 * mutating request non-simple, which forces the preflight into the arm that already refuses it.
 *
 * A MISSING HEADER IS REFUSED TOO. There is no bodyless mutating request on this door, so an absent
 * media type is a caller that has not said what it is sending, and the refusal says what to send.
 */
function refuseUnsupportedMediaType(req: IncomingMessage): string | undefined {
  const header = req.headers['content-type']
  const mediaType = typeof header === 'string' ? header.split(';')[0]!.trim().toLowerCase() : ''
  if (mediaType === 'application/json') return undefined
  return 'Unsupported media type: this route reads application/json only '
    + '(send `content-type: application/json`)'
}

/**
 * How many events one session's replay window holds (T-400-04).
 *
 * BOUNDED, and the bound is the point rather than the number. A window that grew with the
 * conversation would let a long-lived server accumulate every event of every session it has ever
 * served, in memory, for the sake of a reconnect nobody may ever make. What a reconnect actually
 * needs is the gap since the client's last acknowledged id, and a turn's worth of events is two
 * orders of magnitude below this. A client that fell further behind than the window gets what the
 * window holds — and its remedy is the durable log, which is where the whole conversation lives.
 */
const CHAT_STREAM_REPLAY_LIMIT = 512

/**
 * How many sessions this server keeps a replay window for (T-400-04).
 *
 * The second bound, and it is a different hazard from the first: one session cannot grow without
 * limit, but a process serving a person all day accumulates SESSIONS. Least-recently-appended is
 * evicted, which is the right direction — the window exists for a browser that is watching, and a
 * session nobody has appended to in a while has no watcher to serve.
 */
const CHAT_STREAM_SESSION_LIMIT = 32

/** The heartbeat interval, in the shipped run-events stream's own spelling. */
const CHAT_STREAM_HEARTBEAT_MS = 15_000

/** One buffered event, with the id a client acknowledges it by. */
interface StreamedSessionEvent {
  readonly id: number
  readonly event: ChatSessionEvent
}

/**
 * The bounded replay window and the live subscriber set, for one server.
 *
 * IDS ARE PER SESSION AND ASSIGNED AT APPEND, so they are the append ORDER made addressable — the
 * only currency `Last-Event-ID` can be spent in. They are not the log's own line numbers and must
 * not be mistaken for them: a client acknowledges what it has seen on THIS stream.
 */
export interface SessionStreamWindow {
  readonly events: StreamedSessionEvent[]
  nextId: number
}

/**
 * Record one appended event into its session's window, enforcing BOTH bounds (T-400-04).
 *
 * EXTRACTED AND EXPORTED so the bounds can be DRIVEN rather than asserted about. A cap enforced
 * inside a closure is only reachable by a cell willing to post five hundred turns, which is a cell
 * nobody runs — and a source assertion that a constant exists says nothing about whether anything
 * applies it (measured: removing the enforcement left every behavioural cell green). This function
 * is pure over its map, total, and synchronous, so a control cell drives six hundred synthetic
 * events in a millisecond and the eviction is a fact rather than a comment.
 *
 * The map's ITERATION ORDER is the eviction order, and the delete-then-set is what maintains it:
 * `Map` preserves insertion order, so re-inserting a session on every append makes the first key
 * the least-recently-APPENDED one. A plain `set` on an existing key would not move it, and the
 * eviction would then throw away whichever session was created first — including the one somebody
 * is watching right now.
 */
export function recordStreamedEvent(
  windows: Map<string, SessionStreamWindow>,
  sessionId: string,
  event: ChatSessionEvent,
): StreamedSessionEvent {
  let window = windows.get(sessionId)
  if (window === undefined) {
    window = { events: [], nextId: 1 }
  } else {
    windows.delete(sessionId)
  }
  windows.set(sessionId, window)
  const entry: StreamedSessionEvent = { id: window.nextId, event }
  window.nextId += 1
  window.events.push(entry)
  // Both bounds are enforced on the WRITE rather than trusted to a reader: a reader that trimmed
  // would have held the memory already, which is the whole of what the bound is for.
  while (window.events.length > CHAT_STREAM_REPLAY_LIMIT) window.events.shift()
  while (windows.size > CHAT_STREAM_SESSION_LIMIT) {
    const oldest = windows.keys().next()
    if (oldest.done === true) break
    windows.delete(oldest.value)
  }
  return entry
}

/** The two bounds, published so a cell can state them without re-spelling a number. */
export const CHAT_STREAM_BOUNDS = Object.freeze({
  replayLimit: CHAT_STREAM_REPLAY_LIMIT,
  sessionLimit: CHAT_STREAM_SESSION_LIMIT,
})

/**
 * The turn request, validated before anything is minted (T-400-01).
 *
 * The SAME two fields `AgentAskInputSchema` declares, checked here as well as there. That is not a
 * duplicated contract: this one refuses a browser's bytes at the door with a 400 a person's client
 * can act on, before a turn id is minted or a session file is touched, and the op's own schema is
 * what governs the call. `.strict()` so an unknown field is a refusal rather than a silently
 * dropped one — a client sending `{message, scope}` should learn that this door has no `scope`.
 */
const ChatTurnRequestSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().min(1).optional(),
}).strict()

/**
 * The answer, validated at the door (T-400-01 / T-400-09).
 *
 * `sessionId` is REQUIRED and it is not redundant with the confirm id. The registry compares it
 * against the session the question was parked for, so a request that holds an id it should not have
 * cannot spend it on somebody else's conversation. `.strict()` and a closed `answer` enum, so a
 * fourth answer is a 400 here rather than an `undefined` somewhere downstream.
 */
const ChatConfirmRequestSchema = z.object({
  sessionId: z.string().min(1),
  confirmId: z.string().min(1),
  answer: z.enum(CHAT_CONFIRM_ANSWERS),
}).strict()

/**
 * The RUN trigger's answer, validated at the door (401-09 — T-401-25).
 *
 * `scopeId` RATHER THAN `sessionId`, and it is not a cosmetic difference: a run trigger has no
 * conversation, and calling its scope a session would be the fabricated-chat-session design this
 * plan's own decision refuses. It plays exactly the role `sessionId` plays on the chat route — the
 * registry compares it against the scope the question was parked for, so an id that leaked
 * somewhere it should not have cannot be spent on another browser's confirm. It is REFUSED unless
 * it is a trigger scope, so this route can never spend a conversation's outstanding question.
 *
 * `.strict()` and the SAME closed answer enum: three answers, no fourth, and no new approval
 * semantics anywhere on this surface.
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
 * function makes the wildcard something a chat route would have to import to acquire.
 */
type Respond = (res: ServerResponse, data: unknown, status?: number) => void

/**
 * Build the door's ONE responder: same-origin JSON, unmasked exactly once (400-06).
 *
 * A CLOSURE RATHER THAN A DEFAULTED PARAMETER, for the reason the paragraph above gives about the
 * wildcard: an optional `unmask` argument makes the display boundary something each handler has to
 * remember to pass, and the failure mode of forgetting is silent — a placeholder rendered where a
 * value belongs, which reads as a product bug rather than as a missing call. Built once, here, and
 * every arm of this file writes through it.
 *
 * THE UNMASK RUNS ON THE SERIALISED BYTES, which is where the CLI runs it too (`emitHuman` unmasks
 * the rendered string, not the value). A masked placeholder is a token inside a string, so a
 * structural walk would have to know every field of every one of forty-three op payloads; the text
 * pass knows none of them and is total over all of them.
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

/** Everything the door answers when it cannot answer. */
function refuseWith(respond: Respond, res: ServerResponse, error: string, status: number): void {
  respond(res, { error }, status)
}

/**
 * The router's LAST answer — what a request gets when something threw past every guard (400-14).
 *
 * DELIBERATELY NOT THROUGH THIS DOOR'S RESPONDER. The responder runs the host's unmasker over the
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

async function handleTurn(
  host: AgentHost,
  respond: Respond,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: unknown
  try {
    body = await readJsonBody<unknown>(req)
  } catch {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }

  const parsed = ChatTurnRequestSchema.safeParse(body)
  if (!parsed.success) {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }

  // The op id is SUPPLIED by the composition, never spelled here: a literal `'agent.ask'` in this
  // file would be a second spelling of an id that already has exactly one.
  const AGENT_ASK_FUNCTION_ID = host.agentAskFunctionId

  let response: ChatTurnResponse
  try {
    const result = await host.invokeFunction(
      host.registry,
      AGENT_ASK_FUNCTION_ID,
      parsed.data.sessionId === undefined
        ? { message: parsed.data.message }
        : { message: parsed.data.message, sessionId: parsed.data.sessionId },
      host.caller,
    ) as AgentAskResult
    // Folded server-side and shipped BESIDE the payloads, one entry per executed clause in the
    // order the clauses ran. The fold needs the registry, which lives in this process and not in
    // the browser; re-deriving it client-side would be a second classifier.
    //
    // INSIDE THIS TRY (400-14, gap 7). The fold map used to sit below it, so a throwing
    // `foldFunctionResult` rejected `handleTurn`'s promise at a `void` call site — an unhandled
    // rejection, which is the process-kill class the unguarded decode belongs to, one layer up.
    // The router's boundary backstop would now catch that too; this is the precise guard beneath
    // it, and the two answer with different words so a cell can tell which one fired.
    const folds: ChatTurnFold[] = result.results.map((clause) => ({
      functionId: clause.functionId,
      ...host.foldFunctionResult(host.registry, clause.functionId, clause.payload),
    }))
    response = { result, folds }
  } catch (error) {
    // A THROW HERE IS NOT A REFUSAL AND IS NOT REPORTED AS ONE. Every refusal this product can
    // express — a scope short, a gate denial, a pin, an unknown op — comes BACK as a turn whose
    // receipts carry a classifier-derived status, on a 200. So anything that arrives here is the
    // turn machinery itself failing, which is a 500 by name and carries no receipt at all: a
    // fabricated `refused` receipt would be this file inventing a verdict nobody reached.
    refuseWith(
      respond,
      res,
      `The turn could not be carried out [${error instanceof Error ? error.name : 'Error'}]`,
      500,
    )
    return
  }

  respond(res, response)
}

async function handleConfirm(
  host: AgentHost,
  respond: Respond,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const confirms = host.confirms
  if (confirms === undefined) {
    // The 501 idiom, for the same reason the absent-host arm uses it: this server was composed
    // without a confirm channel, and that is a different fact than an unrecognised path.
    //
    // (The wording is deliberate: `validate:arch` extracts import specifiers textually, so a
    // comment shaped like an import clause is read as a dependency this package never declared.)
    refuseWith(respond, res, 'Chat confirms are not available: this server was started without a confirm channel', 501)
    return
  }

  let body: unknown
  try {
    body = await readJsonBody<unknown>(req)
  } catch {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }
  const parsed = ChatConfirmRequestSchema.safeParse(body)
  if (!parsed.success) {
    refuseWith(respond, res, 'Invalid request body', 400)
    return
  }

  // The wire says `sessionId` and the registry's axis is a SCOPE (401-09). The chat door's wire
  // contract is unchanged deliberately — a conversation id IS a valid scope id, and renaming a
  // shipped request field to say so would break every browser for a word.
  const outcome = confirms.answer({
    scopeId: parsed.data.sessionId,
    confirmId: parsed.data.confirmId,
    answer: parsed.data.answer,
  })
  if (outcome.kind === 'unknown-confirm') {
    // ONE ANSWER FOR THREE STATES — no such id, an id already spent, an id belonging to another
    // session. Distinguishing them here would tell a caller which confirms are outstanding and
    // whose they are, which is the probe the single-use id exists to close.
    refuseWith(respond, res, 'Unknown or already-answered confirm', 404)
    return
  }
  respond(res, { resolved: true, answer: outcome.answer })
}

/**
 * Spend a RUN trigger's confirm id (401-09, D-11).
 *
 * THE CHAT ANSWER ROUTE'S MECHANICS, VERBATIM, and deliberately not a variant of them: the same
 * single-use id, the same scope comparison, the same ONE 404 for "no such id" / "already spent" /
 * "belongs to another scope". A distinguishable answer on any of those three would be an oracle for
 * probing which runs have questions outstanding, which is exactly what the shared idiom exists to
 * refuse. What differs is the wire's word for the scope, and nothing else.
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

  // A CONVERSATION IS NOT ANSWERABLE HERE. Reported as the same 404 every other refusal on this
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

function handleCatalog(host: AgentHost, respond: Respond, res: ServerResponse): void {
  const read = host.readCapabilityCatalog
  if (read === undefined) {
    refuseWith(respond, res, 'The capability catalog is not available on this server', 501)
    return
  }
  try {
    // THE ARTIFACT'S OWN BYTES, whole. Projecting a subset here would make the browser's `/help` a
    // different document from the terminal's, which is the one thing "one artifact, four
    // projections" is for.
    respond(res, read())
  } catch (error) {
    // The loader refuses a missing or unparseable file BY NAME and its message says what to run to
    // repair it. That sentence is more use to a person than a bare 500, and it names no path this
    // package chose.
    refuseWith(
      respond,
      res,
      error instanceof Error ? error.message : 'The capability catalog could not be read',
      500,
    )
  }
}

function handleCapabilities(host: AgentHost, respond: Respond, res: ServerResponse): void {
  // Read off the door's OWN registry under the door's OWN caller, which is what makes a listing
  // taken through this route a fact about the door rather than about whoever asked.
  const ops = host.listDeclarations(host.registry, host.caller).map((row) => ({ id: row.id }))
  respond(res, { ops })
}

/**
 * The door's request handler, plus one read about itself.
 *
 * `openStreamCount` is a DIAGNOSTIC and not a capability: it answers how many SSE connections this
 * router is holding open right now and nothing else — no identity, no content, no control. It is on
 * the returned handler because an abandoned stream's listener and heartbeat are invisible from
 * outside the process (T-400-04), so without it the teardown below would be an untested claim, and
 * an untested teardown is the leak.
 */
export interface ChatRouter {
  (req: IncomingMessage, res: ServerResponse): void
  openStreamCount(): number
}

/**
 * The chat door's router: total over its own prefix, and never anything else.
 *
 * TOTAL BY DESIGN. It answers 404 for an unrecognised `/api/chat/*` path rather than falling
 * through, because the fall-through it would land in is `routes.ts`'s shared `notFound`, which
 * writes the wildcard origin header this door's whole first paragraph is about.
 *
 * The absent-host arm is a 501 rather than a 404, on the idiom every optional dependency in
 * `routes.ts` already uses: the route EXISTS, this server was simply started without an agent host
 * (a bare `createRouter(db)`, or a dashboard embedded somewhere that composes none). "Not
 * implemented here" and "no such path" are different facts and a client can act on the difference.
 *
 * IT SUBSCRIBES ONCE, AT CONSTRUCTION, and every stream it serves reads the window that
 * subscription fills. One subscription per server rather than one per connection: a window filled
 * per connection would start empty, so a browser reconnecting after a dropped socket would be told
 * the turn it missed never happened.
 */
export function createChatRouter(host: AgentHost | undefined): ChatRouter {
  // The bounded replay windows, keyed by session, filled by the door's ONE subscription to the
  // append path. Insertion order is least-recently-created first, which is what makes the eviction
  // below a plain `keys().next()`; re-inserting on append keeps it least-recently-APPENDED.
  const windows = new Map<string, SessionStreamWindow>()
  /** Every live stream, so a frame reaches whoever is watching and a close removes exactly one. */
  const streams = new Set<(entry: StreamedSessionEvent, sessionId: string) => void>()
  /**
   * The confirm channel's writers, kept SEPARATE from the log projection's above (400-03).
   *
   * Two sets rather than one, because the two kinds of frame have different truth conditions. A
   * session-log frame is a projection of a durable record and carries the `id:` a reconnect spends;
   * a confirm frame is a transient fact about a question in flight, and giving it an id would put a
   * number in that sequence which no replay could ever produce. Keeping the writers apart is what
   * makes that separation structural rather than remembered.
   */
  const confirmStreams = new Set<(sessionId: string, frame: ChatConfirmChannelFrame) => void>()
  /**
   * Every session THIS PROCESS minted — the `:id` guard's whole input (400-13, gap 3).
   *
   * A SESSION IS MINTED BY THIS PROCESS EXACTLY WHEN THIS PROCESS APPENDED AN EVENT FOR IT, which
   * is why the set is filled from the subscription below rather than from a second source: the
   * append path is the one place a conversation this door actually served becomes a fact, and a
   * register kept anywhere else would be free to disagree with the windows it sits beside.
   *
   * WHY IT IS NOT LRU-BOUNDED LIKE THE WINDOWS. The windows hold events and are capped because an
   * unbounded one is a memory leak an ordinary conversation produces. This holds session ids —
   * a few dozen bytes each — and only ids of turns this door EXECUTED: an unauthenticated caller
   * cannot grow it, because an unminted id is refused below and minting requires driving a turn.
   * A bound here could only evict a live conversation's id, which would refuse that person's
   * reconnect to protect nothing.
   */
  const mintedSessions = new Set<string>()

  host?.onSessionEvent((sessionId, event) => {
    mintedSessions.add(sessionId)
    const entry = recordStreamedEvent(windows, sessionId, event)
    for (const write of [...streams]) write(entry, sessionId)
  })

  // ONE SUBSCRIPTION AT CONSTRUCTION, on the session-event fan-out's own precedent: a subscription
  // taken per connection would make the registry's listener set grow with reconnects.
  host?.confirms?.subscribe((sessionId, frame) => {
    for (const write of [...confirmStreams]) write(sessionId, frame)
  })

  const confirms = host?.confirms

  /**
   * The display boundary of this door (400-06). Identity when no host is bound: there is then no
   * masking context to consult and nothing this router can emit that ever passed a masker.
   */
  const unmask = (text: string): string =>
    host === undefined ? text : host.unmaskForDisplay(text)
  const respond = createResponder(unmask)

  function handleSessionEvents(sessionId: string, req: IncomingMessage, res: ServerResponse): void {
    // The shipped SSE idiom (`routes.ts`'s run-events stream), with ONE deliberate omission: no
    // `Access-Control-Allow-Origin`. That header is on the run stream because it predates this
    // door's posture; a chat transcript is a person's conversation with their own agent, and a
    // wildcard here would let any page they have open read it.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.write(':ok\n\n')

    const frame = (entry: StreamedSessionEvent): void => {
      // The event is HELD as persisted — masked — and unmasked HERE, on the way to a person
      // (400-06). The replay window and the session JSONL both keep the masked form; this is the
      // door's emit, which is where the standing law puts the one `unmaskForHumanOutput` call. See
      // `AgentHost.unmaskForDisplay` for why the browser cannot be the boundary on this surface.
      //
      // ONLY THE `data:` LINE. The id and the kind are this transport's own words — they never
      // passed a masker, and running one over the whole frame would put the boundary somewhere a
      // reader of this file could not see it.
      res.write(
        `id: ${String(entry.id)}\n`
        + `event: ${entry.event.kind}\n`
        + `data: ${unmask(JSON.stringify(entry.event))}\n\n`,
      )
    }

    // REPLAY FIRST, then subscribe, and in that order for a reason: a subscription taken before
    // the replay would deliver a concurrently appended event twice, and one taken after a slow
    // replay would miss it. Both halves read the same window under one synchronous turn of the
    // loop, so no append can land between them.
    const lastEventId = req.headers['last-event-id']
    const since = typeof lastEventId === 'string' ? Number.parseInt(lastEventId, 10) : Number.NaN
    const window = windows.get(sessionId)
    for (const entry of window?.events ?? []) {
      if (Number.isInteger(since) && entry.id <= since) continue
      frame(entry)
    }

    const write = (entry: StreamedSessionEvent, eventSessionId: string): void => {
      if (eventSessionId !== sessionId) return
      frame(entry)
    }
    streams.add(write)

    // ---- The confirm channel (400-03, D-05/D-06) ---------------------------------------------
    //
    // THIS CONNECTION IS WHAT MAKES THE DOOR INTERACTIVE. An open stream is a browser that can be
    // asked a question and can answer it; registering it here — and releasing it in the same
    // teardown as everything else — is what keeps "a human is reachable" a fact about a socket
    // rather than a claim in a comment. The registry denies this session's outstanding confirms
    // when the last of these goes away.
    const writeConfirm = (frameScopeId: ConfirmScopeId, channelFrame: ChatConfirmChannelFrame): void => {
      if (frameScopeId !== sessionId) return
      res.write(confirmFrameBytes(channelFrame))
    }
    confirmStreams.add(writeConfirm)
    const closeChannel = confirms?.openChannel(sessionId)

    const heartbeat = setInterval(() => {
      res.write(':\n\n')
    }, CHAT_STREAM_HEARTBEAT_MS)
    // `unref` so an open stream cannot hold a process alive past its work — the interval exists to
    // keep a proxy from reaping an idle socket, which is not a reason to keep node running.
    heartbeat.unref?.()

    // TEARDOWN IS THE WHOLE OF T-400-04's OTHER HALF. A browser tab closes, a laptop sleeps, a
    // reverse proxy drops the socket — and every one of those leaves a listener and a 15s timer
    // behind unless this fires. Both are released together because they were taken together.
    req.on('close', () => {
      clearInterval(heartbeat)
      streams.delete(write)
      confirmStreams.delete(writeConfirm)
      // LAST, and never before the writer is removed: releasing the channel can resolve pending
      // confirms, which emits `confirm_resolved` frames — and writing one into a socket this
      // handler has just been told is closed is a write nobody reads.
      closeChannel?.()
    })
  }

  /**
   * One confirm frame, on the wire — the ONE serialisation, read by both channels (401-09).
   *
   * NO `id:` LINE. See `confirmStreams` above: these frames are not in the replay numbering, and
   * giving them a number would put a value in that sequence no replay could ever produce.
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
   * CONFIRM FRAMES AND NOTHING ELSE. The chat stream carries two kinds on one connection — a
   * projection of a durable session log, and transient confirm frames — because a person watching a
   * conversation wants both. A run trigger has no transcript to project: its durable record is the
   * run's own event log, which the execution SSE route already serves. Putting a second projection
   * of that here would be a second answer to what a run's history is, which is the whole class this
   * phase exists to remove.
   *
   * THE SCOPE IS MINTED HERE AND ANNOUNCED AS THE FIRST FRAME. Opening this stream is the act of
   * becoming askable: the scope exists because this connection does, and it stops existing when the
   * connection does — at which point the registry denies every question outstanding on it, which is
   * the tab-closed reaper. Handing the scope back on the stream rather than in a JSON response is
   * what keeps it known ONLY to whoever is holding the stream, and this door writes no
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
   * `agent-qa dashboard` process dies — measured: one unauthenticated
   * `GET /api/chat/sessions/%/events` was a remote kill.
   *
   * 1. `new URL(req.url …)` at the head — an unparseable request line. Guarded: 400.
   * 2. `decodeURIComponent` on the `:id` capture — `%`, `%E0`, any half-escape. Guarded: 404, the
   *    SAME bytes as the unminted-id refusal, so unparseable and unknown are one answer.
   * 3. `handleTurn` / `handleConfirm` — fire-and-forget promises whose rejection would be an
   *    unhandled rejection. Guarded: `.catch` into the boundary backstop.
   * 4. Any synchronous throw anywhere in the dispatch, including `handleSessionEvents`'s body and
   *    the responder's own unmask pass. Guarded: the `try` around `dispatch` below — ONE boundary
   *    rather than a nested one per arm, because a second `try` inside the streaming arm would be
   *    a second spelling of the same rule with nothing extra to say.
   *
   * The precise guards and the backstop are BOTH present on purpose: the precise ones give a
   * caller an answer they can act on (404, 400), and the backstop makes "the process survives"
   * true for the faults nobody has thought of yet.
   */
  const dispatch = (req: IncomingMessage, res: ServerResponse): void => {
    // The door answers its OWN preflight, and the answer carries no `Access-Control-Allow-Origin`
    // at all. The shared `cors()` helper grants `*`, which would hand any page a person has open
    // the permission it needs to POST a turn at their local agent — the precise thing the turn
    // route's own missing header is there to withhold. 204 with no grant is a preflight a
    // cross-origin caller cannot use and a same-origin one never needs.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': 0 })
      res.end()
      return
    }

    // ---- THE MUTATING-REQUEST CHOKE POINT (400-14, gap 6) ------------------------------------
    //
    // ON THE METHOD, ABOVE THE ROUTE TABLE, AND BEFORE ANY BODY IS READ. Both refusals below
    // return from THIS function, so `handleTurn` and `handleConfirm` are never invoked: no turn id
    // is minted, no session file is opened, the confirm registry is never consulted. That is a
    // structural fact about where these five lines sit, not a claim about what the handlers do.
    //
    // The gap this closes was measured on the shipped door: a `text/plain` JSON POST carrying
    // `Origin: https://evil.example` EXECUTED a turn and wrote a session file. The door's only
    // defense was a withheld response header, which hides the reply from the attacker and leaves
    // the side effect exactly where they wanted it.
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
      refuseWith(respond, res, 'Chat is not available: this server was started without an agent host', 501)
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
      case 'turn':
        handleTurn(host, respond, req, res).catch((error: unknown) => {
          backstopRefusal(res, error)
        })
        return
      case 'confirm':
        handleConfirm(host, respond, req, res).catch((error: unknown) => {
          backstopRefusal(res, error)
        })
        return
      case 'capabilities':
        handleCapabilities(host, respond, res)
        return
      case 'catalog':
        handleCatalog(host, respond, res)
        return
      case 'runConfirm':
        handleRunConfirm(host, respond, req, res).catch((error: unknown) => {
          backstopRefusal(res, error)
        })
        return
      case 'runConfirmChannel':
        handleRunConfirmChannel(req, res)
        return
      case 'sessionEvents': {
        // AN UNPARSEABLE ID IS A REFUSAL, NOT AN EXCEPTION (400-14, gap 7). `decodeURIComponent`
        // throws `URIError` on a lone `%` or a truncated escape, and this router is synchronous:
        // that throw used to leave the request handler and kill the process.
        //
        // THE SAME 404 BYTES AS THE UNMINTED-ID ARM BELOW, deliberately. "I cannot read that id"
        // and "no session here has that id" must be indistinguishable from outside, or the route
        // tells a prober which of their guesses were at least well-formed.
        let sessionId: string
        try {
          sessionId = decodeURIComponent(matched.params[0] ?? '')
        } catch {
          refuseWith(respond, res, 'Not found', 404)
          return
        }
        // THE `:id` IS VALIDATED BEFORE A CHANNEL CAN EXIST (400-13, gap 3). This route used to open
        // a confirm channel for ANY string typed at the URL, and a channel is a POSTURE INPUT: a
        // stream held on an id no session ever minted made this door claim a human was watching, and
        // an unwatched conversation's ask-tier denial was recorded as `prompted-denied`. Refusing
        // here — ahead of `handleSessionEvents` — makes `writeHead(200)`, the replay, the stream
        // registration and `confirms.openChannel` all structurally unreachable for an unowned id.
        //
        // 404 AND NOT A DISTINCT STATUS, deliberately: "no such session" must be indistinguishable
        // from outside from every other reason this route declines, or the route is an oracle for
        // probing which ids exist. The confirm route's one-404 idiom, applied here.
        //
        // THE BEHAVIOURAL CONSEQUENCE, NAMED: after a server restart a browser reconnecting to an
        // old conversation gets 404 until a turn re-mints it in this process. The durable log
        // remains that conversation's home — the same remedy the replay-window bound already states
        // — and the shipped UI only opens a stream after a turn has answered (WINDOWS #192's turn-1
        // handshake), so the id is already in the set on the happy path.
        if (!mintedSessions.has(sessionId)) {
          refuseWith(respond, res, 'Not found', 404)
          return
        }
        handleSessionEvents(sessionId, req, res)
        return
      }
    }
  }

  const router = (req: IncomingMessage, res: ServerResponse): void => {
    try {
      dispatch(req, res)
    } catch (error) {
      backstopRefusal(res, error)
    }
  }

  router.openStreamCount = (): number => streams.size
  return router as ChatRouter
}
