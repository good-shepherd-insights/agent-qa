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

`GET /ok` reports only measured facts (the service answered, a host is composed, a credential
resolved, the contract version). It never predicts that a run will succeed. The same facts are
served without a token at `GET /api/run-readiness` on the local dashboard API — one readiness
answer behind two doors, and the loopback bind above is what keeps the unauthenticated one local.
