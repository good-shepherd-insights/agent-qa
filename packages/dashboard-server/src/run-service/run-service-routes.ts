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
  RUN_SERVICE_REFUSED_REQUEST_FIELDS,
  RunServiceStartRequestSchema,
  type RunEventEnvelope,
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
      } catch {
        // The failure's own words are deliberately NOT echoed: a denial message is composed from
        // this project's policy state and this caller is remote. The run's own diagnostics reach
        // whoever can read the run, which requires the same credential.
        refuse(res, 500, 'run_start_failed')
        return
      }
      // 202 rather than 200: an acknowledgment is a START, not an outcome. Every field of it came
      // off the durable record — the op raises `RunNotRecordedError` rather than fabricating one.
      respondJson(res, 202, ack)
    })()
  }

  function handleEvents(runIdParam: string, req: IncomingMessage, res: ServerResponse): void {
    let runId: string
    try {
      runId = decodeURIComponent(runIdParam)
    } catch {
      refuse(res, 404, 'unknown_run')
      return
    }
    const session = ports.attach(runId)
    if (session === undefined) {
      // BEFORE ANY STREAM HEADER, and that order is the whole point: a response that has already
      // written `200 text/event-stream` cannot be told it failed.
      refuse(res, 404, 'unknown_run')
      return
    }

    // The frame writer BUFFERS until the head is out, because `subscribe` delivers the replay
    // synchronously and can also THROW (`ReplayIncompleteError`). Subscribing first and writing the
    // head after is what keeps a failed attach answerable as a typed JSON error instead of a
    // half-open stream nobody can be told about.
    const pending: string[] = []
    let open = false
    const write = (frame: string): void => {
      if (open) res.write(frame)
      else pending.push(frame)
    }
    const frameOf = (event: RunEventEnvelope): string =>
      // D-13, all three parts: the id IS the seq, the event name IS the envelope type, and the
      // data IS the envelope's own JSON. No projection, no rename, no second vocabulary.
      `id: ${String(event.seq)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`

    let closed = false
    let unsubscribe: (() => void) | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const teardown = (): void => {
      if (closed) return
      closed = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      unsubscribe?.()
      openStreams.delete(teardown)
      if (!res.writableEnded) res.end()
    }

    try {
      unsubscribe = session.subscribe(REPLAY_FROM_START, (event) => {
        if (closed) return
        write(frameOf(event))
        // THE STREAM ENDS AT `runFinished`. The run's event log is complete at that point and the
        // bus closes behind it, so holding the socket open would deliver nothing but heartbeats.
        // What a reconnect after this means is 403's attach contract to decide.
        if (event.type === 'runFinished') teardown()
      })
    } catch {
      refuse(res, 500, 'replay_unavailable')
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
    openStreams.add(teardown)
    req.on('close', teardown)
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
          handleEvents(matched.params[0] ?? '', req, res)
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
