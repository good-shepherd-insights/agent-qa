// THE CROSS-SITE MINT DOOR (403 gap round 1, plan 08 — ROADMAP SC-2 / LIVE-02).
//
// WHAT THIS FILE MEASURES, AND WHY IT IS THE CHOKE POINT. The `liveUrl` token is the frame
// socket's only credential: a page that cannot obtain a token cannot open the socket. Phase 403's
// verification found the token itself excellent and the DOOR THAT HANDS IT OUT wide open —
// `GET /api/runs/:runId/live-url` asked for nothing and answered `Access-Control-Allow-Origin: *`,
// so any page open in the developer's own browser could `fetch` a view token and stream the app
// under test. A loopback bind stops a remote HOST; it is not a defence against another ORIGIN in
// the developer's browser.
//
// EVERY REFUSAL CELL HERE CARRIES ITS ALLOWED TWIN, and that is the file's central discipline. A
// request that was REFUSED and a request that never REACHED the door are byte-identical from the
// outside: a 403 from a working guard, a 404 from a route that failed to register and a dead
// socket from a server that never came up all read as "not 200". So the cross-site cell issues the
// SAME request shape without the hostile origin in the same breath, and cells (3)/(4) pin the two
// legitimate callers standing alone. A refusal with no passing twin cannot tell a guard from a
// broken server.
//
// EVERY CELL DRIVES THE SPAWNED `agent-qa dashboard` BINARY, in the zero-token posture — the
// default a project gets.

import { connect } from 'node:net'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  buildFreshness,
  cleanupTempRoots,
  reserveEphemeralPort,
  runServiceFixtureProject,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

/** What `spawnDashboard` returns: the door plus its own readiness statement. */
type ReadySpawnedDashboard = SpawnedDashboard & { readonly ready: boolean }

const REBUILD_INSTRUCTION =
  'these cells drive the BUILT binary: run `pnpm -r build` from the agent-qa root first.'

/** The attacker's origin. A host this process could never resolve, so nothing can answer for it. */
const HOSTILE_ORIGIN = 'http://evil.test'

/** How long the run has to become attachable before this file gives up and says so. */
const ATTACH_BUDGET_MS = 60_000

interface Fixture {
  readonly dashboard: ReadySpawnedDashboard
  readonly runId: string
}

let fixture: Fixture | undefined

function held(): Fixture {
  if (fixture === undefined) throw new Error('the cross-site fixture never came up')
  return fixture
}

/** Quote the child's own streams in every failure — a spawned cell's message is its diagnosis. */
function childContext(dashboard: SpawnedDashboard): string {
  return `child stdout: ${JSON.stringify(dashboard.stdout().slice(-1200))}; `
    + `child stderr: ${JSON.stringify(dashboard.stderr().slice(-1200))}`
}

// ---- the raw HTTP client ---------------------------------------------------------------------
//
// THE IDIOM IS `dashboard-door-security.test.ts`'s, deliberately duplicated rather than imported:
// that file is a test module and exports nothing, and a shared helper extracted for a second
// caller would put the two doors' evidence behind one implementation. `Origin` is a FORBIDDEN
// FETCH HEADER — `fetch` silently drops it — so a header-exact cross-site cell has to be written
// onto a socket by hand. The path is not parsed and the headers are not filtered: that is the
// point, because both are what the attacker sends.

interface RawResponse {
  /** `0` means NO RESPONSE ARRIVED — the socket closed empty, or the budget expired. */
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly note?: string
}

function noResponse(note: string): RawResponse {
  return { status: 0, headers: {}, body: '', note }
}

/**
 * Undo `Transfer-Encoding: chunked` framing.
 *
 * NOT A FLOURISH — the defect it prevents was measured. The mint door writes its JSON with
 * `res.end(body)` and no `Content-Length`, so node frames it chunked, and a raw body read starts
 * `17c\r\n{"liveUrl":…`. `JSON.parse` on that throws, which made "is there a token in this answer?"
 * answer NO for an answer that plainly carried one — a false GREEN wearing the fix's clothes.
 */
function dechunk(body: string): string {
  let rest = body
  let out = ''
  for (;;) {
    const at = rest.indexOf('\r\n')
    if (at === -1) return out === '' ? body : out
    const size = Number.parseInt(rest.slice(0, at).split(';')[0] ?? '', 16)
    if (!Number.isInteger(size)) return out === '' ? body : out
    if (size === 0) return out
    out += rest.slice(at + 2, at + 2 + size)
    rest = rest.slice(at + 2 + size + 2)
  }
}

function parseRaw(raw: string): RawResponse {
  if (raw === '') return noResponse('the socket closed without a single byte')
  const split = raw.indexOf('\r\n\r\n')
  const head = split === -1 ? raw : raw.slice(0, split)
  const framed = split === -1 ? '' : raw.slice(split + 4)
  const lines = head.split('\r\n')
  const status = Number.parseInt(lines[0]?.split(' ')[1] ?? '', 10)
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':')
    if (at === -1) continue
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  const body = (headers['transfer-encoding'] ?? '').includes('chunked') ? dechunk(framed) : framed
  return { status: Number.isInteger(status) ? status : 0, headers, body }
}

function rawRequest(
  port: number,
  init: {
    readonly method: string
    readonly path: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: string
    readonly budgetMs?: number
  },
): Promise<RawResponse> {
  return new Promise<RawResponse>((settle) => {
    const socket = connect(port, '127.0.0.1')
    let raw = ''
    let settled = false
    const finish = (value: RawResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      settle(value)
    }
    const timer = setTimeout(
      () => finish(noResponse('no response within the cell budget')),
      init.budgetMs ?? 8_000,
    )
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { raw += chunk })
    socket.on('end', () => finish(parseRaw(raw)))
    socket.on('close', () => finish(parseRaw(raw)))
    socket.on('error', (error: Error) => finish(parseRaw(raw).status === 0 ? noResponse(error.message) : parseRaw(raw)))
    socket.on('connect', () => {
      const headers: Record<string, string> = {
        host: `127.0.0.1:${String(port)}`,
        connection: 'close',
      }
      for (const [key, value] of Object.entries(init.headers ?? {})) {
        headers[key.toLowerCase()] = value
      }
      if (init.body !== undefined) {
        headers['content-length'] = String(Buffer.byteLength(init.body))
      }
      socket.write(
        `${init.method} ${init.path} HTTP/1.1\r\n`
        + Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')
        + '\r\n'
        + (init.body ?? ''),
      )
    })
  })
}

/** One mint request, with whatever headers the cell wants to state. */
function mintRaw(
  port: number,
  runId: string,
  headers: Readonly<Record<string, string>>,
): Promise<RawResponse> {
  return rawRequest(port, {
    method: 'GET',
    path: `/api/runs/${encodeURIComponent(runId)}/live-url`,
    headers,
  })
}

/** The one fact every cell here turns on: did this answer hand out a token? */
function liveUrlIn(response: RawResponse): string | undefined {
  try {
    const parsed = JSON.parse(response.body) as { liveUrl?: unknown }
    return typeof parsed.liveUrl === 'string' ? parsed.liveUrl : undefined
  } catch {
    return undefined
  }
}

beforeAll(async () => {
  // FIRST, AND BEFORE ANYTHING IS SPAWNED: a stale build measures the previous commit.
  expect(buildFreshness(DASHBOARD_ANCHORED_BUILDS), REBUILD_INSTRUCTION)
    .toEqual({ missing: [], stale: [] })

  const project = runServiceFixtureProject('live-view-cross-site', false)
  const port = await reserveEphemeralPort()
  const dashboard = await spawnDashboard(project.root, project.configPath, port)
  expect(
    dashboard.ready,
    `the built \`agent-qa dashboard\` never reported that it was listening. ${childContext(dashboard)}`,
  ).toBe(true)

  const trigger = await fetch(`${dashboard.origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'tests/probe.test.yaml' }),
  })
  const triggerBody = await trigger.text()
  expect(trigger.status, `the trigger route refused: ${triggerBody}. ${childContext(dashboard)}`)
    .toBe(202)
  const runId = (JSON.parse(triggerBody) as { runId?: string }).runId
  expect(typeof runId, `the trigger ack named no run: ${triggerBody}`).toBe('string')

  // The queue starts the run asynchronously. Poll the mint — bounded — rather than sleeping a
  // number somebody guessed. This poll is a plain node `fetch`: no `Origin`, which is the
  // non-browser caller the guard must keep admitting, so a fixture that comes up at all is
  // already the first reading of cell (4)'s contract.
  const deadline = Date.now() + ATTACH_BUDGET_MS
  let attachable = false
  while (Date.now() < deadline) {
    const probe = await fetch(`${dashboard.origin}/api/runs/${encodeURIComponent(runId as string)}/live-url`)
    if (probe.status === 200) { attachable = true; await probe.text(); break }
    await probe.text().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  expect(
    attachable,
    `the spawned dashboard never made run ${String(runId)} attachable. ${childContext(dashboard)}`,
  ).toBe(true)

  fixture = { dashboard, runId: runId as string }
}, 180_000)

afterAll(async () => {
  const open = fixture
  fixture = undefined
  if (open !== undefined) await open.dashboard.stop()
  cleanupTempRoots()
})

describe('the live-url mint door refuses a cross-site browser request (SC-2, LIVE-02)', () => {
  it('(1) THE CHOKE POINT: a cross-site GET is refused by name and carries no wildcard CORS', async () => {
    const f = held()

    // THE ATTACKER'S REQUEST, byte for byte as a page on another origin would drive it.
    const hostile = await mintRaw(f.dashboard.port, f.runId, {
      origin: HOSTILE_ORIGIN,
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    })

    // THE ALLOWED TWIN, IN THE SAME BREATH. Identical shape, no hostile origin. If this does not
    // answer 200 with a token then the door is unreachable at this instant and the refusal above
    // proves nothing at all — a broken server and a working guard are the same reading otherwise.
    const twin = await mintRaw(f.dashboard.port, f.runId, {
      origin: f.dashboard.origin,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    })

    const reading = {
      hostileStatus: hostile.status,
      hostileAcao: hostile.headers['access-control-allow-origin'] ?? null,
      hostileLiveUrl: liveUrlIn(hostile) === undefined ? null : 'PRESENT',
      hostileBody: hostile.body.slice(0, 200),
      hostileNote: hostile.note ?? null,
      twinStatus: twin.status,
      twinLiveUrl: liveUrlIn(twin) === undefined ? null : 'PRESENT',
      twinNote: twin.note ?? null,
    }
    const context = `${JSON.stringify(reading)}. ${childContext(f.dashboard)}`

    expect(
      reading.twinStatus,
      `${context} — THE ALLOWED TWIN. The same request without the hostile Origin must still be `
      + 'answered; without this reading the refusal below cannot be told from an unreachable route.',
    ).toBe(200)
    expect(reading.twinLiveUrl, `${context} — the twin must actually receive a token`).toBe('PRESENT')

    expect(
      reading.hostileStatus,
      `${context} — SC-2: a page on another origin must be refused BY NAME. At HEAD this read 200.`,
    ).toBe(403)
    expect(
      hostile.body,
      `${context} — the refusal is a typed word, not a bare status`,
    ).toContain('cross_site_refused')
    expect(
      reading.hostileAcao,
      `${context} — the answer must carry NO Access-Control-Allow-Origin at all, so that even a `
      + 'refusal body is unreadable cross-origin. At HEAD this read `*` on a 200 carrying the token.',
    ).toBeNull()
    expect(
      reading.hostileLiveUrl,
      `${context} — no token may leave through this door for a cross-site caller`,
    ).toBeNull()
  }, 60_000)

  it('(3) REGRESSION PIN: the dashboard\'s own same-origin page still mints', async () => {
    const f = held()
    const answer = await mintRaw(f.dashboard.port, f.runId, {
      origin: f.dashboard.origin,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
    })
    const context = `status=${String(answer.status)} body=${answer.body.slice(0, 200)} `
      + `note=${answer.note ?? 'none'}. ${childContext(f.dashboard)}`
    expect(answer.status, `${context} — the dashboard's own UI is the caller this door exists for`).toBe(200)
    expect(liveUrlIn(answer), `${context} — and it receives a real token`).toMatch(/^http.*#v1\./u)
  }, 60_000)

  it('(4) REGRESSION PIN: the non-browser client, which sends NO Origin at all, still mints', async () => {
    const f = held()

    // A PLAIN NODE `fetch`: no `Origin`, no `Sec-Fetch-Site`. This is the CLI, `curl`, and the
    // conformance harness itself — including `live-view-dom.test.ts`'s `mintStreamKind`, whose
    // non-vacuity control for cells (8)/(8b) queries this exact route from Node. An absent Origin
    // is EVIDENCE OF A NON-BROWSER CALLER, and refusing it would brick every local drive to defend
    // against nothing.
    const response = await fetch(
      `${f.dashboard.origin}/api/runs/${encodeURIComponent(f.runId)}/live-url`,
    )
    const raw = await response.text()
    const context = `status=${String(response.status)} body=${raw.slice(0, 200)}. ${childContext(f.dashboard)}`
    expect(response.status, `${context} — the Origin-absent caller is ALLOWED, by policy`).toBe(200)
    expect(
      (JSON.parse(raw) as { liveUrl?: string }).liveUrl,
      `${context} — and it receives a real token`,
    ).toMatch(/^http.*#v1\./u)

    // The SECOND spelling of the same fact, because a header a client library did not send and a
    // header the server did not write fail differently: the answer carries no wildcard CORS grant
    // even on the allowed path, so the token body is unreadable from a foreign document.
    expect(
      response.headers.get('access-control-allow-origin'),
      `${context} — a capability answer stamps no cross-origin read grant, allowed or not`,
    ).toBeNull()
  }, 60_000)
})
