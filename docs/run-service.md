# The authed run service, and where the dashboard binds

`agent-qa dashboard` (and `agent-qa serve`) runs one HTTP process. Two different surfaces live in
it, and they have different rules.

| | the dashboard API | the run service |
|---|---|---|
| **Paths** | `/api/*`, the UI, the artifact routes | `POST /run`, `GET /run/{runId}/events`, `GET /ok` |
| **Auth** | none | a bearer token, on every route, with no anonymous arm |
| **Mounted** | always | only when a credential is declared |
| **Reachable from** | loopback only, unless a credential is declared | wherever the process binds |

## BREAKING: the dashboard binds `127.0.0.1` by default

Before v2 the server called `listen(port)` with no host, which binds **every interface** — so an
unauthenticated run trigger was reachable from any machine that could route to yours.

It now binds `127.0.0.1`. If you relied on LAN access to the dashboard, the migration is to declare
a run-service credential (below). There is no flag that restores the old behaviour and no
deprecation window: the previous default published an anonymous run trigger, and a shim that let
you keep it would be a shim for a hole.

```yaml
services:
  dashboard:
    port: 3470
    # Optional. Defaults to 127.0.0.1. Anything other than localhost / 127.0.0.1 / ::1 REFUSES
    # startup unless at least one runServiceTokens entry is declared.
    host: 0.0.0.0
```

Start it with a non-loopback `host` and no credential and the process refuses before it listens:

```
DashboardRemoteBindRefusedError: The dashboard was asked to bind 0.0.0.0, which is not a loopback
interface, with no run-service credential declared. …
```

## Declaring a run-service credential

Config declares credentials **by reference**. The value itself lives only in the environment — no
secret is ever written to a file this tool manages, and every channel that prints config prints the
resolved value masked.

```yaml
services:
  dashboard:
    host: 0.0.0.0
    runServiceTokens:
      - name: ci
        tokenEnvVar: AGENT_QA_RUN_TOKEN_CI
        trustScope:
          project: acme-web
      - name: alice
        tokenEnvVar: AGENT_QA_RUN_TOKEN_ALICE
        trustScope:
          project: acme-web
```

Mint the values yourself — this tool never generates one for you:

```bash
openssl rand -base64 32
```

Then export it where the dashboard process can read it:

```bash
export AGENT_QA_RUN_TOKEN_CI="$(openssl rand -base64 32)"
agent-qa dashboard
```

A declared `tokenEnvVar` that is unset — or set to whitespace — **refuses startup**, naming the
variable and never a value. A server that started with a credential nobody can present reads to an
operator exactly like a server rejecting their token, which is the confusion that refusal avoids.

- **Rotation** is swapping the environment value and restarting.
- **Revocation** is deleting the entry.
- There is no expiry metadata. Credential lifetime mechanics belong with the OAuth form of the same
  family, which this milestone does not ship.

## Calling it

```bash
curl -sS -X POST http://your-host:3470/run \
  -H "Authorization: Bearer $AGENT_QA_RUN_TOKEN_CI" \
  -H 'content-type: application/json' \
  -d '{"patterns":["tests/checkout.yaml"]}'
```

The ack carries the `runId` the core minted — the request cannot choose one. Stream the run with:

```bash
curl -sS -N http://your-host:3470/run/<runId>/events \
  -H "Authorization: Bearer $AGENT_QA_RUN_TOKEN_CI"
```

### Resuming a stream

The stream door honours the SSE `Last-Event-ID` header, and the `?lastEventId=` query parameter for
clients that cannot set a header. Both name **the last envelope you already received**, so the
replay opens at the next one and no `id` you have already seen is re-sent:

```bash
curl -sS -N 'http://your-host:3470/run/<runId>/events?lastEventId=42' \
  -H "Authorization: Bearer $AGENT_QA_RUN_TOKEN_CI"
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
curl -sS -N 'http://your-host:3470/run/<runId>/events?lastEventId=127' \
  -H "Authorization: Bearer $AGENT_QA_RUN_TOKEN_CI"
```

Events between your resume point and the floor are gone from the live channel. The run record is
the durable truth — read it through `runs.events`, and show the gap rather than hiding it.

After the run ends its session stays attachable for five minutes: a reconnect inside that window
replays everything after your resume point up to `runFinished` and closes cleanly, and a resume
point at or past the final seq answers `200` with no events and closes. After the window, or for a
run this process never started, the door answers `404 {"error":"unknown_run"}`.

### Minting a liveUrl

```bash
curl -sS 'http://your-host:3470/run/<runId>/live-url?handle=0' \
  -H "Authorization: Bearer $AGENT_QA_RUN_TOKEN_CI"
```

```json
{
  "liveUrl": "http://your-host:3470/live/<runId>#v1.<token>",
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
(5-minute), view-scoped, single-run capability of the same credential family as your run-service
token — it grants viewing and nothing else, and it cannot cancel, restart or modify the run.

Both doors mint through the same function-layer op, `runs.liveurl`, and answer identically. The
difference is only the credential: the **local dashboard door** at
`GET /api/runs/<runId>/live-url` needs **no** credential, because asking for a *remote* credential
to use a *local* surface would be the wrong trade. What keeps it local is two things and not one:
the loopback bind above keeps a remote *host* out, and a same-site check on the route keeps a page
served from another *origin* in your own browser from minting. The `liveUrl` token is what gates
viewing; the same-site check is what keeps a cross-origin page from obtaining that token. This
route, on the remote door, mints under the trust scope of the bearer you presented.

`404 {"error":"unknown_run"}` means this process has no live session for that run.
`503 {"error":"live_view_unavailable"}` is an honest host fact: this host has no live-view
composition, or is not serving on a known origin, so there is no link it could build that would
resolve to anything.

`GET /ok` reports only measured facts (the service answered, a host is composed, a credential
resolved, the contract version). It never predicts that a run will succeed. The same facts are
served without a token at `GET /api/run-readiness` on the local dashboard API — one readiness
answer behind two doors, and the loopback bind above is what keeps a remote host off the
unauthenticated one.
