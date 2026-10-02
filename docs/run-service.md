# The run service, and where the dashboard binds

`agent-qa dashboard` (and `agent-qa serve`) runs one HTTP process. Two surfaces live in it.

| | the dashboard API | the run service |
|---|---|---|
| **Paths** | `/api/*`, the UI, the artifact routes | `POST /run`, `GET /run/{runId}/events`, `GET /run/{runId}/live-url`, the run reads, `GET /ok` |
| **Credential** | none | none (since 2026-10-01) |
| **Mounted** | always | always (since 2026-10-01) |
| **Reachable from** | loopback only | loopback only |

**2026-10-01: the run-service tokens are gone.** `services.dashboard.runServiceTokens` is deleted: a
config that still declares it fails validation with the ordinary unrecognized-key error. No route
asks for an `Authorization` header, and an `Authorization` header you still send is ignored. Every caller can call every operation (432 D-12). What still stops other machines and
websites (432 D-13) is the loopback bind, the Host check and the same-site check described below.

## The dashboard binds `127.0.0.1`, and only loopback

The server binds `127.0.0.1` by default. A non-loopback `services.dashboard.host` **refuses startup**
before anything listens, and nothing exempts it — no credential ever did, and none exists now:

```yaml
services:
  dashboard:
    port: 3470
    # Optional. Defaults to 127.0.0.1. Anything other than localhost / 127.0.0.1 / ::1 REFUSES
    # startup.
    host: 127.0.0.1
```

```
DashboardRemoteBindRefusedError: The dashboard was asked to bind 0.0.0.0, which is not a loopback
interface. …
```

To reach a dashboard from another machine, put an authenticating proxy or a tunnel you control in
front of it.

## The same-site check

Every run-service route, and the dashboard's run trigger (`POST /api/runs/trigger`) and queue
enqueue (`POST /api/queue/enqueue`), refuse a request **before reading its body** when:

- its `Host` header does not name a loopback interface this server answers to (DNS rebinding);
- its `Origin` names another origin, including the literal `null`; or
- the browser's `Sec-Fetch-Site` says anything other than `same-origin` or `none`.

The refusal is `403 {"error":"cross_site_refused"}`. A caller that sends **no** `Origin` — `curl`, a
script, CI, the CLI — is admitted, and so is the dashboard's own page.

## Calling it

```bash
curl -sS -X POST http://127.0.0.1:3470/run \
  -H 'content-type: application/json' \
  -d '{"patterns":["tests/checkout.yaml"]}'
```

The ack carries the `runId` the core minted — the request cannot choose one. Stream the run with:

```bash
curl -sS -N http://127.0.0.1:3470/run/<runId>/events
```

### Resuming a stream

The stream door honours the SSE `Last-Event-ID` header, and the `?lastEventId=` query parameter for
clients that cannot set a header. Both name **the last envelope you already received**, so the
replay opens at the next one and no `id` you have already seen is re-sent:

```bash
curl -sS -N 'http://127.0.0.1:3470/run/<runId>/events?lastEventId=42'
```

When both are present the **header wins** — a browser's own `EventSource` reconnect carries the
freshest id it actually received, while a URL carries whatever the page was opened with.

A value that is not a canonical non-negative integer is refused with `400
{"error":"invalid_last_event_id"}` before any stream header. A repeated parameter (or a repeated
header) is refused too rather than resolved to one of its values: a request that says two different
things about where to resume is not a request that said the first one.

**Below the replay floor you get a typed refusal, never a silently truncated stream:**

```json
HTTP/1.1 410 Gone
{"error":"replay_floor","earliestAvailableSeq":128}
```

`earliestAvailableSeq` is the lowest seq the run's bus can still replay — spelled identically here,
in the durable reader `runs.events`, and in the bus itself. **Re-attach with `lastEventId =
earliestAvailableSeq - 1`**, because you name the last envelope you already have and the floor names
the first one still available:

```bash
curl -sS -N 'http://127.0.0.1:3470/run/<runId>/events?lastEventId=127'
```

Events between your resume point and the floor are gone from the live channel. The run record is
the durable truth — read it through `runs.events`, and show the gap rather than hiding it.

After the run ends its session stays attachable for five minutes: a reconnect inside that window
replays everything after your resume point up to `runFinished` and closes cleanly, and a resume
point at or past the final seq answers `200` with no events and closes. After the window, or for a
run this process never started, the door answers `404 {"error":"unknown_run"}`.

### Minting a liveUrl

```bash
curl -sS 'http://127.0.0.1:3470/run/<runId>/live-url?handle=0'
```

```json
{
  "liveUrl": "http://localhost:3470/live/<runId>#v1.<token>",
  "expiresAt": 1735689600000,
  "handle": 0,
  "stream": { "kind": "cdp-screencast" }
}
```

`handle` selects one member of a parallel suite and defaults to `0`; it is read with the same
canonical reader `?handle=` uses on the stream, so a malformed or repeated value is refused with
`400 {"error":"invalid_handle"}` rather than minted for a handle you did not name.

`stream.kind` is the handle's **declared** capability, so you can render the honest no-preview state
without opening a socket to find out. A browserless run answers `{"kind":"none"}`.

**The token lives in the URL fragment and must never be logged.** A fragment is never sent to a
server; open the `liveUrl` in a browser or an iframe and nothing else. It is a short-lived
(5-minute), view-scoped, single-run, single-handle capability signed by this process — it grants
viewing and nothing else, and it cannot cancel, restart or modify the run. This signed link is the
one credential the run service still mints, and it is checked independently of who asked for it: a
tampered, expired, foreign-run or foreign-handle token is refused by name.

Both doors mint through the same function-layer op, `runs.liveurl`, and answer identically. The
local dashboard door is `GET /api/runs/<runId>/live-url`; both apply the same same-site check above.

`404 {"error":"unknown_run"}` means this process has no live session for that run.
`503 {"error":"live_view_unavailable"}` is an honest host fact: this host has no live-view
composition, or is not serving on a known origin, so there is no link it could build that would
resolve to anything.

`GET /ok` reports only measured facts (the service answered, a host is composed, and the contract
version, which is `2` since the readiness answer lost its credential fact and the door lost its
bearer refusals). It never predicts that a run will succeed. The same facts are served at
`GET /api/run-readiness` on the local dashboard API — one readiness answer behind two doors.
