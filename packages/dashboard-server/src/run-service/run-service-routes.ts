// The authed run service's HTTP surface (Phase 402 plan 01, D-02 / D-06 / D-13 / D-15 · INVK-03).
//
// A MOUNTABLE MODULE, NOT A SERVER (D-02). Everything this door needs from the world arrives as
// {@link RunServicePorts}: how to verify a bearer header, how to start a run, how to reach a
// started run's session, and how to answer readiness. It imports the shared schema vocabulary and
// node built-ins and NOTHING from `@vostride/agent-qa-agent`, `-agent-local` or `-safety` — those
// are the packages `packages/dashboard-server` may not name, and `pnpm validate:arch` is the
// mechanical proof. 402 mounts this in the shipped dashboard process so there is no fourth process
// and no daemon TCP exposure; a future cloud host mounts the same unit with different ports.
//
// THE VERDICT IS FIRST ON EVERY ROUTE, AND ABOVE THE ROUTE TABLE (D-06, D-15). Not per handler —
// per REQUEST, before dispatch is even attempted. Two things follow that a per-handler check could
// not give: a route added tomorrow inherits the refusal by construction rather than by somebody
// remembering, and an unauthenticated caller cannot learn WHICH paths exist, because a valid path
// and a nonsense one are refused identically. `/ok` is inside this rule and not an exception to it
// (D-15): an `/ok` that answered before the verdict would be a fingerprinting surface.
//
// THERE IS NO PERMISSIVE ARM ANYWHERE IN THIS FILE. {@link ServiceBearerVerdict} has two arms, so
// a missing header and a wrong token both land in `refused`, and there is no value of that type
// meaning "nobody presented anything, serve them anyway". A wrong credential never degrades to a
// weaker success.
//
// EVERY REFUSAL WRITES THE SAME BODY SHAPE — one key, a closed code (see
// `RunServiceErrorBodySchema`). Nothing echoes the caller's input, names a run id, or hints at how
// many credentials are declared.
//
// WITH EXACTLY ONE EXCEPTION, AND IT IS ON THE OTHER SIDE OF THE VERDICT (402-06). A policy DENIAL
// is answered 403 with the gate's own neutral phrasing and its surface-projected remedies
// (`RunServiceDenialBodySchema`). The one-key law's whole argument is about what an
// UNAUTHENTICATED caller may learn; a 403 is reached only after a declared credential matched, so
// the reader is a party this process already decided to talk to, and a bare word would turn a
// decidable situation into a failure they will retry forever. What that body may NOT carry is the
// gate's CANONICAL reason: on the fail-closed arm it names `--trust-session`, a flag declared on
// one CLI command, and handing it to an HTTP client on another machine is Phase 399's defect —
// one surface's instructions shown to a reader on another.
//
// THE STREAM SERVES THE FROZEN BUS ENVELOPE VERBATIM (D-13). SSE `id` is the envelope's `seq`,
// `event` is its `type`, and `data` is the envelope's own JSON. There is no projection layer and
// no re-mint: the bus IS the wire contract, so there is no second event vocabulary to drift, and
// payloads were masked at emit. `Last-Event-ID` resume falls out of seq-as-id nearly free, but the
// full replay/attach acceptance is 403's (INVK-05); 402 claims delivery, not the attach contract.
//
// NO CROSS-ORIGIN GRANT, AT ALL. This file writes no `Access-Control-Allow-Origin`, following the
// chat door's adjudication rather than the legacy run stream's wildcard. That is also the whole of
// this door's CSRF story and it is structural: every route requires an `Authorization` header, and
// a header a page sets makes the request non-simple, so a browser must preflight — and this door
// grants no preflight. A cross-origin page therefore cannot drive it at all.
//
// THE `?handle=` FILTER IS SERVER-SIDE, AND ITS PREDICATE LIVES IN THE SCHEMA (402-04, D-14).
// A parallel run is ONE run id with N attachable per-member handles. The optional `handle` query
// parameter selects one member's slice; run-scoped envelopes (verdict, `runFinished`, `heartbeat`,
// the diagnostics, and `runStarted` carrying the roster) ALWAYS pass it, so a handle subscriber
// still learns that the run ended. This file re-derives none of that: `passesHandleFilter` is
// imported from `@vostride/agent-qa-schema`, which is the only place an event type's scope is
// declared. A second spelling here would be a classification that drifts silently (T-402-15),
// because the two would agree on the day it was written and disagree the first time an event type
// is appended.
//
// THE HANDLE IS VALIDATED BEFORE ANY STREAM HEADER, on the same rule as the run id and for the
// same reason: a `200 text/event-stream` cannot be told it failed. Validation is in two parts, and
// the two answers are kept apart — a malformed parameter is `invalid_handle`, a well-formed one
// naming no member of this run is `unknown_handle`. Neither echoes the value.
//
// THE ROSTER IS READ OFF THE SESSION'S OWN REPLAYED `runStarted`, deliberately, rather than from
// bookkeeping the attach port could keep. The run's own header IS the roster announcement, so
// reading it here means the door validates against exactly what the stream is about to serve
// rather than against a second copy that could disagree. `runStarted` is seq 1 and `subscribe`
// replays synchronously from `REPLAY_FROM_START`, so the roster is in hand before `writeHead`.
// A run whose `runStarted` announces no roster cannot answer a per-handle question at all, and the
// honest answer to one is a refusal — not an unfiltered stream (which would serve every member's
// data to a caller who asked for one) and not an empty one (which would look like a member that
// did nothing).
//
// BEARER CARRIAGE IS HEADER-ONLY, AND THERE MUST NEVER BE A QUERY-PARAMETER FALLBACK: a URL is
// written to access logs, proxy logs and browser history, so a token carried there is published.
// Browser `EventSource` cannot set an `Authorization` header (RESEARCH A1), which is why this
// door's clients are `curl`, `fetch` and CI rather than a bare `EventSource`. A future browser
// client uses `fetch` with a streaming body reader, not `EventSource`.
//
// BACKPRESSURE POSTURE, STATED RATHER THAN OVERLOOKED: writes are fire-and-forget with no `drain`
// handling, matching both shipped SSE streams in this package. A client that reads slower than a
// run emits grows this process's socket buffer. That is the shipped posture for run streaming and
// this door does not change it; a bounded-writer policy is one decision for all three streams, not
// a thing to invent here for one of them.
//
// REMOTE CANCEL IS DEFERRED (2026-08-24, Phase 402 · D-01 discretion note). Criterion 1 requires
// start + stream only. Cancel is a control affordance and belongs with 403's attach/detach world,
// where detach, reconnect and multi-surface addressing decide together what "stop it" means for a
// run several surfaces are watching. Nothing here forecloses it: it is a fourth row in the table
// below and a fifth port.

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  GATE_REMEDY_KINDS,
  RUN_SERVICE_REFUSED_REQUEST_FIELDS,
  RunServiceStartRequestSchema,
  handleRosterOf,
  parseHandleParam,
  passesHandleFilter,
  remediesRenderableBy,
  type GateRemedy,
  type RunEventEnvelope,
  type RunServiceDenialBody,
  type RunServiceErrorCode,
  type RunServiceReadiness,
  type RunSession,
  type RunStartAcknowledgement,
  type ServiceBearerVerdict,
  type TrustScope,
} from '@vostride/agent-qa-schema'

import { readJsonBody } from '../server/body-parser.js'

/**
 * The seq a subscriber attaches at to receive the whole run.
 *
 * NEVER 0. The bus numbers from 1 and REFUSES to serve a prefix it cannot produce, so 0 is not
 * "earlier", it is unserveable — `subscribe(0, …)` raises `ReplayIncompleteError` on every run,
 * empty window or not. Same constant and same value as `in-process-backend.ts`'s.
 */
const REPLAY_FROM_START = 1

/** The comment-frame keepalive interval, matching both shipped SSE streams in this package. */
const HEARTBEAT_MS = 15_000

/**
 * The largest request body this door reads.
 *
 * TIGHTER THAN THE SHARED 1 MB DEFAULT, deliberately: the only thing a caller may send is a list
 * of test patterns, and a door that accepts a megabyte of it is a door that will one day be asked
 * to buffer a megabyte of it.
 */
const MAX_REQUEST_BYTES = 64 * 1024

/** What starting a run needs from the composition, as data rather than as a live handle. */
export interface RunServiceStartInput {
  /** The pattern set the caller asked for; absent means the configured default set. */
  readonly patterns?: readonly string[]
  /** The matched entry's trust, on its way to `FunctionCaller.credential`. */
  readonly trustScope: TrustScope
  /** The matched entry's operator label — attribution only, never a permission input. */
  readonly clientId: string
}

/**
 * Everything this door reaches the world through (D-02).
 *
 * ALL FOUR ARE INJECTED, and the injection is what makes the module mountable: the implementations
 * name `invokeFunction`, `runs.start` and a composed local host, all of it vocabulary this package
 * may not import. `InProcessRunStarter` is the shape precedent one directory over.
 */
export interface RunServicePorts {
  /** Resolve one request's `Authorization` header to the two-arm verdict. */
  verifyBearer(header: string | null | undefined): ServiceBearerVerdict
  /**
   * Start a run and return the acknowledgment.
   *
   * REJECTION IS NOT "the run failed" — a failing run still acknowledges. A rejection is a denial,
   * a refused request field, an input error or a crash.
   */
  invokeRunStart(input: RunServiceStartInput): Promise<RunStartAcknowledgement>
  /** The started run's session, or nothing if this process never started that run. */
  attach(runId: string): RunSession | undefined
  /** The measured readiness facts `/ok` reports (D-15). */
  readiness(): RunServiceReadiness
}

/** Which handler a table row reaches. A closed union, so a row with no arm is a type error. */
export type RunServiceRouteHandlerName = 'start' | 'events' | 'ok'

export interface RunServiceRouteRow {
  readonly method: 'GET' | 'POST'
  /** The literal path, or — for a templated route — its `:param` shape. */
  readonly path: string
  readonly handler: RunServiceRouteHandlerName
  /** Present only on a templated route; the matcher uses it instead of `path`. */
  readonly pattern?: RegExp
}

export const RUN_SERVICE_START_ROUTE = '/run'
export const RUN_SERVICE_EVENTS_TEMPLATE = '/run/:runId/events'
const RUN_SERVICE_EVENTS_PATTERN = /^\/run\/([^/]+)\/events$/
/**
 * Readiness (D-15) — AUTHED, like every other route on this door.
 *
 * There is no unauthenticated liveness probe here and there must not be one. An `/ok` that
 * answered before the verdict would tell an unauthenticated caller that this process is an
 * agent-qa run service, that it is up, and — by the shape of what it refused elsewhere — which
 * other routes it serves. The dashboard's preflight is liveness AND early token validation in one
 * round-trip precisely because they are the same question at this door.
 */
export const RUN_SERVICE_OK_ROUTE = '/ok'

/**
 * EVERY PATH THIS DOOR ANSWERS, as data the dispatch reads (the chat door's own idiom).
 *
 * WHY A TABLE AND NOT THREE ARMS. The verdict guard below is applied to the REQUEST, above this
 * table, so a route added tomorrow inherits it by construction. The table is what makes that
 * inheritance AUDITABLE from outside: because dispatch reads it, a route not in it is unreachable,
 * so a census cell can enumerate this array and drive every row unauthenticated — and a newly
 * added route cannot escape that corpus by nobody noticing it.
 */
export const RUN_SERVICE_ROUTE_TABLE: readonly RunServiceRouteRow[] = Object.freeze([
  { method: 'POST', path: RUN_SERVICE_START_ROUTE, handler: 'start' },
  {
    method: 'GET',
    path: RUN_SERVICE_EVENTS_TEMPLATE,
    handler: 'events',
    pattern: RUN_SERVICE_EVENTS_PATTERN,
  },
  { method: 'GET', path: RUN_SERVICE_OK_ROUTE, handler: 'ok' },
] as const)

/** What a matched row carries: the row itself and whatever its pattern captured. */
export interface RunServiceRouteMatch {
  readonly row: RunServiceRouteRow
  /** The raw, still-ENCODED capture groups. Decoding is the handler's business, and it can throw. */
  readonly params: readonly string[]
}

/** Resolve a request to a table row, or to nothing. The dispatch's only route lookup. */
export function matchRunServiceRoute(
  method: string | undefined,
  path: string,
): RunServiceRouteMatch | undefined {
  for (const row of RUN_SERVICE_ROUTE_TABLE) {
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
 * Whether a path belongs to this door — the MOUNT's whole question, and method-blind on purpose.
 *
 * A host consults this before its own routing so that every request to a service path, including
 * an `OPTIONS` preflight and a method this table has no row for, is answered by this door rather
 * than by the host's generic handling. That is what keeps the host's wildcard CORS preflight and
 * its SPA fallback away from an authed surface.
 *
 * DERIVED FROM THE TABLE, never a second list: the prefixes are read off the rows, so a route
 * added above is mounted the same commit.
 */
export function ownsRunServicePath(path: string): boolean {
  for (const row of RUN_SERVICE_ROUTE_TABLE) {
    if (row.pattern === undefined) {
      if (path === row.path) return true
      continue
    }
    if (row.pattern.test(path)) return true
  }
  // A path UNDER a declared literal route is this door's too, so `/run/anything` is refused here
  // rather than falling into the host's SPA fallback and answering 200 with an HTML page.
  return RUN_SERVICE_ROUTE_TABLE.some((row) => row.pattern === undefined
    && path.startsWith(`${row.path}/`))
}

export interface RunServiceRouter {
  (req: IncomingMessage, res: ServerResponse): void
  /** Live SSE connections — so a host can assert this door leaks none on teardown. */
  openStreamCount(): number
}

/** The one non-2xx body this door writes: a single key carrying a closed code. */
function refuse(res: ServerResponse, status: number, error: RunServiceErrorCode): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy()
    return
  }
  const body = JSON.stringify({ error })
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function respondJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** The header, normalised. Node folds a repeated `Authorization` into an array; both refuse. */
function authorizationHeaderOf(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization
  if (raw === undefined) return undefined
  return Array.isArray(raw) ? raw.join(', ') : raw
}

/**
 * The `handle` query parameter, exactly as it arrived, or `null` when absent.
 *
 * Read off the query substring with `URLSearchParams` rather than `new URL(...)`: this is
 * untrusted input on a path that has already matched, and a constructor that can throw does not
 * belong between a matched route and its handler.
 *
 * A REPEATED parameter is not resolved to one of its values — the values are joined, which cannot
 * parse, so `?handle=1&handle=2` is refused rather than silently answered as handle 1. Same
 * posture as the repeated `Authorization` header above, and for the same reason: a request that
 * says two different things is not a request that said the first one.
 */
function handleParamOf(req: IncomingMessage): string | null {
  const query = (req.url ?? '').split('?').slice(1).join('?')
  if (query === '') return null
  const values = new URLSearchParams(query).getAll('handle')
  if (values.length === 0) return null
  if (values.length === 1) return values[0] ?? null
  return values.join(',')
}

/**
 * Which REFUSED request fields a body carries (D-07 / D-12).
 *
 * Checked as a KEY test rather than by parsing, so `{"runId": null}` is refused too: the offense is
 * naming the field at all, not the value put in it. `RunServiceStartRequestSchema` is `.strict()`
 * and would refuse these keys as unrecognised a line later — this check exists so the answer says
 * WHICH kind of refusal it was, and so the door's own law is legible where the door enforces it.
 */
function refusedFieldsIn(body: Record<string, unknown>): readonly string[] {
  return RUN_SERVICE_REFUSED_REQUEST_FIELDS.filter((field) => Object.hasOwn(body, field))
}

/**
 * The run service's router: total over its own paths, and never anything else.
 *
 * TOTAL BY DESIGN. It answers every path {@link ownsRunServicePath} claims, including ones no row
 * matches, because the fall-through it would otherwise land in is the host's SPA fallback — which
 * answers 200 with an HTML page, on an authed surface, to a caller with no credential.
 */
/** What the exported stream core reaches the world through. */
export interface RunEventStreamDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's 404 to answer. */
  readonly runId: string
  /** The raw `handle` query parameter, exactly as it arrived; `null` means the firehose. */
  readonly handleParam: string | null
  /** The started run's session, or nothing if this process never started that run. */
  attach(runId: string): RunSession | undefined
  /** Live teardowns, so a host can count open streams and a close removes exactly one. */
  readonly openStreams?: {
    add(teardown: () => void): void
    delete(teardown: () => void): void
  }
}

/**
 * THE RUN STREAM, AS ONE UNIT: attach, validate the handle, filter, frame, heartbeat, close.
 *
 * Exported because there is going to be a SECOND door onto the same stream — 402-08 mounts the
 * local door, which differs from this one only in what it does about credentials. Two doors
 * calling one function is the only shape in which the filter has exactly one implementation; two
 * copies of the serving body would be two places `?handle=` could drift, and the drift would be
 * invisible until somebody diffed them.
 *
 * The ORDER below is the contract, not an implementation detail. Every refusal — unknown run,
 * malformed handle, unknown handle, unavailable replay — happens before `writeHead`, because a
 * response that has already written `200 text/event-stream` cannot be told it failed.
 */
export function serveRunEventStream(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RunEventStreamDeps,
): void {
  const parsedHandle = parseHandleParam(deps.handleParam)
  if (parsedHandle.kind === 'invalid') {
    // Refused before the run is even looked up: a malformed parameter is a fact about the
    // caller's own input, so answering it early leaks nothing about which runs exist.
    refuse(res, 400, 'invalid_handle')
    return
  }

  const session = deps.attach(deps.runId)
  if (session === undefined) {
    refuse(res, 404, 'unknown_run')
    return
  }

  // The frame writer BUFFERS until the head is out, because `subscribe` delivers the replay
  // synchronously and can also THROW (`ReplayIncompleteError`). Subscribing first and writing the
  // head after is what keeps a failed attach answerable as a typed JSON error instead of a
  // half-open stream nobody can be told about. It is ALSO what puts the roster in hand before the
  // head: `runStarted` is seq 1, so the replay has already delivered it by the time the handle is
  // checked against the roster below.
  const pending: string[] = []
  let open = false
  const write = (frame: string): void => {
    if (open) res.write(frame)
    else pending.push(frame)
  }
  const frameOf = (event: RunEventEnvelope): string =>
    // D-13, all three parts: the id IS the seq, the event name IS the envelope type, and the
    // data IS the envelope's own JSON. No projection, no rename, no second vocabulary. The filter
    // DROPS envelopes; it never edits one, so a filtered stream's frames are byte-identical to the
    // firehose's — with gaps in the ids, which is what seq-as-id means once a filter exists.
    `id: ${String(event.seq)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

  let roster: readonly number[] | undefined

  let closed = false
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const teardown = (): void => {
    if (closed) return
    closed = true
    if (heartbeat !== undefined) clearInterval(heartbeat)
    unsubscribe?.()
    deps.openStreams?.delete(teardown)
    // ONLY ONCE THE HEAD IS OUT. `subscribe` delivers the replay SYNCHRONOUSLY, so a run that
    // was already over reaches `runFinished` — and therefore this teardown — before `writeHead`
    // has run. Ending here would let Node send its own default 200 with no `Content-Type` and no
    // body, so a client asking for a finished run's whole log would get an empty, untyped 200.
    // The flush below the head handles that case, and this guard is what leaves it to it.
    if (open && !res.writableEnded) res.end()
  }

  try {
    unsubscribe = session.subscribe(REPLAY_FROM_START, (event) => {
      if (closed) return
      roster = roster ?? handleRosterOf(event)
      // THE FILTER, and the ONE call to it. `passesHandleFilter` is the schema's predicate over
      // the schema's total scope classification — this module states no opinion about which event
      // types belong to a member.
      if (parsedHandle.kind === 'handle' && !passesHandleFilter(event, parsedHandle.index)) return
      write(frameOf(event))
      // THE STREAM ENDS AT `runFinished`. The run's event log is complete at that point and the
      // bus closes behind it, so holding the socket open would deliver nothing but heartbeats.
      // What a reconnect after this means is 403's attach contract to decide. `runFinished` is
      // run-scoped, so it reaches every handle and this arm is filter-independent.
      if (event.type === 'runFinished') teardown()
    })
  } catch {
    refuse(res, 500, 'replay_unavailable')
    return
  }

  if (parsedHandle.kind === 'handle' && !(roster ?? []).includes(parsedHandle.index)) {
    // A well-formed handle no member of this run answers to — including every handle on a run
    // whose `runStarted` announced no roster at all. Nothing has been written yet, so this is
    // still a typed JSON refusal rather than a stream that quietly carries only run-scoped events
    // and looks like a member that did nothing.
    closed = true
    unsubscribe?.()
    refuse(res, 400, 'unknown_handle')
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  res.write(':ok\n\n')
  open = true
  for (const frame of pending) res.write(frame)
  pending.length = 0
  if (closed) {
    // The whole run was already in the replay: the head and every frame are out, so all that is
    // left is to close the socket the teardown above could not reach.
    if (!res.writableEnded) res.end()
    return
  }

  heartbeat = setInterval(() => { res.write(':\n\n') }, HEARTBEAT_MS)
  deps.openStreams?.add(teardown)
  req.on('close', teardown)
}

/**
 * The DENIAL this rejection is, if it is one — read structurally, never by class (402-06, T-402-22).
 *
 * ON `dashboardRemediesOf`S EXACT PRECEDENT (`execution/in-process-backend.ts`), and for the same
 * architectural reason: the rejection is a `RunDeniedError` minted in `agent-local`, and this
 * package may not import `agent`, `agent-local` or `safety` — `pnpm validate:arch` is the
 * mechanical proof. What it MAY name is the remedy vocabulary itself, which lives in `schema`
 * precisely because several packages render it.
 *
 * THE DISCRIMINATOR IS `neutralReason`, DELIBERATELY. Only a GATE decision carries a second
 * phrasing (400 D-15): an unrecognised request field, an input error and "the host was asked to
 * start a run before it was composed" carry none, and those are exactly the rejections that must
 * stay a 500 with no words on them. Keying on `remedies` instead would misclassify a denial that
 * offered none; keying on the class NAME would be a string compare against another package private
 * vocabulary.
 *
 * THE REMEDIES ARE VALIDATED AGAINST THE CLOSED VOCABULARY before they are projected, so an
 * arbitrary object that happened to carry a `remedies` array cannot put an unknown kind on the
 * wire. A kind this build does not know is dropped rather than passed through.
 *
 * THE PROJECTION IS THIS DOOR OWN SURFACE. `remediesRenderableBy('run-service', …)` answers the
 * empty list today — see `GATE_REMEDY_SURFACES` for why that emptiness is a declaration, not an
 * oversight — and this module does not second-guess it: filtering again here would be a second
 * opinion about what a remote caller can do, and not filtering at all would serve `--trust-session`
 * to an HTTP client.
 */
export function runDenialOf(error: unknown): RunServiceDenialBody | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const neutralReason = (error as { neutralReason?: unknown }).neutralReason
  if (typeof neutralReason !== 'string' || neutralReason.trim().length === 0) return undefined

  const carried = (error as { remedies?: unknown }).remedies
  const known = new Set<string>(GATE_REMEDY_KINDS)
  const remedies: GateRemedy[] = []
  for (const entry of Array.isArray(carried) ? (carried as unknown[]) : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const kind = (entry as { kind?: unknown }).kind
    if (typeof kind !== 'string' || !known.has(kind)) continue
    const params = (entry as { params?: unknown }).params
    remedies.push({
      kind: kind as GateRemedy['kind'],
      ...(typeof params === 'object' && params !== null
        ? { params: params as Readonly<Record<string, string>> }
        : {}),
    })
  }

  return {
    error: 'run_denied',
    neutralReason,
    remedies: [...remediesRenderableBy('run-service', remedies)],
  }
}

export function createRunServiceRoutes(ports: RunServicePorts): RunServiceRouter {
  /** Every live stream's teardown, so a host can count them and a close removes exactly one. */
  const openStreams = new Set<() => void>()

  function handleStart(req: IncomingMessage, res: ServerResponse, input: {
    readonly trustScope: TrustScope
    readonly clientId: string
  }): void {
    void (async () => {
      let raw: unknown
      try {
        raw = await readJsonBody<unknown>(req, MAX_REQUEST_BYTES)
      } catch {
        refuse(res, 400, 'invalid_request_body')
        return
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        refuse(res, 400, 'invalid_request_body')
        return
      }
      const refused = refusedFieldsIn(raw as Record<string, unknown>)
      if (refused.length > 0) {
        // A token-holder may not name the terms of its own authorization, may not choose the
        // identity its run is addressed by, and may not tune a target's concurrency. The door
        // composes context and the core mints the id.
        refuse(res, 400, 'refused_request_field')
        return
      }
      const parsed = RunServiceStartRequestSchema.safeParse(raw)
      if (!parsed.success) {
        refuse(res, 400, 'invalid_request_body')
        return
      }

      let ack: RunStartAcknowledgement
      try {
        ack = await ports.invokeRunStart({
          ...(parsed.data.patterns === undefined ? {} : { patterns: parsed.data.patterns }),
          trustScope: input.trustScope,
          clientId: input.clientId,
        })
      } catch (error) {
        // A POLICY DENIAL IS A DECISION, NOT A CRASH, and it is the one rejection this door
        // RENDERS rather than flattens. Read structurally — see `runDenialOf`.
        const denial = runDenialOf(error)
        if (denial !== undefined) {
          respondJson(res, 403, denial)
          return
        }
        // Everything else keeps its words to itself: a crash message is composed from this
        // process's own state and this caller is remote. The run's own diagnostics reach whoever
        // can read the run, which requires the same credential.
        refuse(res, 500, 'run_start_failed')
        return
      }
      // 202 rather than 200: an acknowledgment is a START, not an outcome. Every field of it came
      // off the durable record — the op raises `RunNotRecordedError` rather than fabricating one.
      respondJson(res, 202, ack)
    })()
  }

  function handleEvents(
    runIdParam: string,
    handleParam: string | null,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    let runId: string
    try {
      runId = decodeURIComponent(runIdParam)
    } catch {
      refuse(res, 404, 'unknown_run')
      return
    }
    serveRunEventStream(req, res, {
      runId,
      handleParam,
      attach: ports.attach,
      openStreams,
    })
  }

  const router = ((req: IncomingMessage, res: ServerResponse): void => {
    try {
      const path = (req.url ?? '/').split('?')[0] ?? '/'

      // THE VERDICT, FIRST, ABOVE THE ROUTE TABLE (D-06 / D-15). Every route, every method, every
      // path this door owns — including a path no row matches. Nothing below this line runs for a
      // caller who has not presented a declared credential, which is what makes "no permissive arm
      // on ANY service route" a property of the dispatch rather than of three handlers.
      const verdict = ports.verifyBearer(authorizationHeaderOf(req))
      if (verdict.kind === 'refused') {
        refuse(res, 401, verdict.reason)
        return
      }

      const matched = matchRunServiceRoute(req.method, path)
      if (matched === undefined) {
        refuse(res, 404, 'unknown_route')
        return
      }

      switch (matched.row.handler) {
        case 'start':
          handleStart(req, res, { trustScope: verdict.trustScope, clientId: verdict.clientId })
          return
        case 'events':
          handleEvents(matched.params[0] ?? '', handleParamOf(req), req, res)
          return
        case 'ok':
          respondJson(res, 200, ports.readiness())
          return
      }
    } catch {
      // The door's LAST answer. Fixed bytes carrying no host value; once a stream's head is out the
      // only honest answer is to hang up, which `refuse` does.
      refuse(res, 500, 'run_start_failed')
    }
  }) as RunServiceRouter

  router.openStreamCount = () => openStreams.size
  return router
}
