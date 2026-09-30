// The fourth door's security posture, DRIVEN (Phase 400 plan 14, verification gaps 6 and 7).
//
// WHY EVERY CELL BELOW OPENS A SOCKET. The phase's shipped CORS corpus asserted that a response
// carried no `Access-Control-Allow-Origin`. That is an assertion about what an attacker gets to
// READ, and the threat is what an attacker gets to DO: a CORS simple request needs no preflight,
// so a 204-no-grant OPTIONS arm never runs, the browser sends the POST anyway, and the action
// executes. Withholding the reply header hides the answer and not the side effect. So no cell here
// asserts a header alone: every REJECTS cell measures the SIDE-EFFECT SURFACE — whether the request
// reached the composed host at all — around a request written byte-by-byte onto a real socket.
//
// RAW SOCKETS RATHER THAN `fetch`, for two reasons that are both load-bearing. `fetch` normalises
// a path, and gap 7's probe is a request target (`//`) that no URL builder will hand to a server.
// And `Origin` is a forbidden header name in a browser, so a corpus that could only set the headers
// `fetch` permits could not state the attacker's request at all.
//
// ACCEPTS CONTROLS ARE NOT OPTIONAL HERE. A REJECTS-only corpus is green against a door that
// refuses everything, which is a door nobody can use. The two axes the policy allows — a
// same-origin browser drive and an Origin-less local drive — are pinned SEPARATELY, so a fix that
// closed either one reds a cell.
//
// 430 (2026-09-28): the cross-site corpus was driven on the run-confirm pair.
//
// 432-14 (2026-10-01, D-13/D-14): the run-confirm pair is deleted, and with it the router whose
// method-level guards this corpus measured. The same-site refusal survives on every mutating route
// that had one, so the corpus moves to them and is driven through the SHIPPED server
// (`startServer` over the composed host): the mark door, which is the dashboard's own mark
// control, and the credential and editor doors, which refuse before they touch anything. Each
// cell below says which of its claims moved and which retired with the router.
//
// 430 D-02 (2026-09-28): 7a (the session-id route) and 7b-i (the turn's fold guard) are deleted
// with the routes they drove. The generic 404 those paths now answer is carried by
// C430-DELETED-CHAT-ROUTES-SHARED-404 and process survival's s5.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { RUNS_MARK_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { DashboardDatabase, startServer, type AgentHost } from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

/** The cross-origin an attacker's page is served from — the verifier's own probe value. */
const HOSTILE_ORIGIN = 'https://evil.example'

/** The run the mark door is driven against. Not recorded, so the op answers `run-not-found`. */
const MARKED_RUN = 'run-432-14-door-security'
const MARK_PATH = `/api/runs/${MARKED_RUN}/mark`
const MARK_BODY = JSON.stringify({ kind: 'false-fail', note: 'door security' })

/** A run row the dashboard's own run read serves, so gap 7's synchronous read arm has a subject. */
const READ_RUN = 'run-432-14-read'

// ---- the fixture project -------------------------------------------------------------------

/** The `surface-dispatch.ts` fixture project, verbatim in shape (see the door cell's own note). */
function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-400-14-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'reset' } },
      registry: {
        targets: {
          conformance: { platform: 'web', url: 'https://conformance.invalid' },
        },
      },
    })}\n`,
    'utf8',
  )
  return configPath
}

interface DoorFixture {
  readonly origin: string
  readonly port: number
  readonly configRoot: string
  readonly host: LocalAgentHost
  /** Every op id the composed host was asked to dispatch, in order — the side-effect surface. */
  readonly invocations: string[]
  close(): Promise<void>
}

const openDoors: DoorFixture[] = []

/**
 * The door as `agent-qa dashboard` composes it, served by the shipped `startServer`.
 *
 * `wrapHost` exists for gap 7's backstop cells and nothing else: it composes the SHIPPED host and
 * then replaces exactly one of its members with a throwing one, which is how a fault is injected
 * at a seam the product really has rather than by standing up a lookalike door.
 */
async function openDoor(options: {
  readonly wrapHost?: (host: AgentHost) => AgentHost
} = {}): Promise<DoorFixture> {
  const configPath = fixtureWorkspace()
  const configRoot = dirname(resolve(configPath))
  let boundOrigin: string | undefined
  const { host, agentHost } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
  })
  const invocations: string[] = []
  const counted: AgentHost = {
    ...agentHost,
    invokeFunction: (registry, functionId, input, caller) => {
      invocations.push(functionId)
      return agentHost.invokeFunction(registry, functionId, input, caller)
    },
  }
  const db = new DashboardDatabase({ dbPath: ':memory:' })
  db.insertRun({
    id: READ_RUN, name: 'read', filePath: 'tests/read.test.yaml', status: 'failed', duration: 1,
    startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-01T00:00:01.000Z',
  })
  const signals = ['SIGINT', 'SIGTERM'] as const
  const before = signals.map((signal) => new Set(process.listeners(signal)))
  const started = await startServer({
    db,
    port: 0,
    agentHost: options.wrapHost === undefined ? counted : options.wrapHost(counted),
  })
  const owned = signals.map((signal, index) =>
    process.listeners(signal).filter((listener) => !before[index]!.has(listener)))
  const address = started.server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the door bound no port')
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  const fixture: DoorFixture = {
    origin: boundOrigin,
    port: address.port,
    configRoot,
    host,
    invocations,
    close: async () => {
      started.close()
      signals.forEach((signal, index) => {
        for (const listener of owned[index]!) process.removeListener(signal, listener)
      })
      await host.close()
      rmSync(configRoot, { recursive: true, force: true })
    },
  }
  openDoors.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openDoors.length > 0) await openDoors.pop()!.close()
})

// ---- the raw HTTP client -------------------------------------------------------------------

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

function parseRaw(raw: string): RawResponse {
  if (raw === '') return noResponse('the socket closed without a single byte')
  const split = raw.indexOf('\r\n\r\n')
  const head = split === -1 ? raw : raw.slice(0, split)
  const body = split === -1 ? '' : raw.slice(split + 4)
  const lines = head.split('\r\n')
  const status = Number.parseInt(lines[0]?.split(' ')[1] ?? '', 10)
  const headers: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':')
    if (at === -1) continue
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return {
    status: Number.isInteger(status) ? status : 0,
    headers,
    body: headers['transfer-encoding'] === 'chunked' ? dechunk(body) : body,
  }
}

/** A writer that sets no Content-Length answers chunked; the chunk framing is not the body. */
function dechunk(framed: string): string {
  let out = ''
  let rest = framed
  for (;;) {
    const lineEnd = rest.indexOf('\r\n')
    if (lineEnd === -1) return out
    const size = Number.parseInt(rest.slice(0, lineEnd), 16)
    if (!Number.isFinite(size) || size === 0) return out
    out += rest.slice(lineEnd + 2, lineEnd + 2 + size)
    rest = rest.slice(lineEnd + 2 + size + 2)
  }
}

/**
 * One request, written onto a socket exactly as given.
 *
 * The PATH IS NOT PARSED and the HEADERS ARE NOT FILTERED. That is the whole point: `//` and
 * `Origin: https://evil.example` are both things a URL builder or a browser-shaped client would
 * refuse to produce, and both are what the attacker sends.
 */
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

/** A mark, driven with whatever headers the cell wants to state. */
function driveMark(
  port: number,
  headers: Readonly<Record<string, string>>,
  body: string = MARK_BODY,
): Promise<RawResponse> {
  return rawRequest(port, { method: 'POST', path: MARK_PATH, headers, body })
}

const sameOrigin = (door: DoorFixture): string => `http://127.0.0.1:${String(door.port)}`

// ---- the side-effect surface ---------------------------------------------------------------

/**
 * The whole REJECTS assertion, in one place so no cell can quietly assert less than its siblings.
 *
 * STATUS IS THE WEAKEST OF THESE and it is deliberately not alone: a door that answered 403 and
 * acted anyway would pass a status-only cell. The side effect a mark has is its dispatch, so the
 * surface measured is whether the composed host was asked to do anything at all.
 */
function expectNoSideEffect(
  label: string,
  door: DoorFixture,
  response: RawResponse,
  expectedStatus: number,
): void {
  expect(response.status, `${label}: the door answered ${String(response.status)} ${response.note ?? ''}`)
    .toBe(expectedStatus)
  expect(response.body, `${label}: a refusal carries no receipt`).not.toContain('receipt')
  expect(response.body, `${label}: a refusal carries the op's answer`).not.toContain('run-not-found')
  expect(door.invocations, `${label}: the refused drive reached the composed host`).toEqual([])
}

/** The ACCEPTS half: the mark was dispatched exactly once and the op's own answer came back. */
function expectDispatchedOnce(label: string, door: DoorFixture, response: RawResponse): void {
  expect(response.status, `${label}: the admitted mark was refused ${response.note ?? ''}`).toBe(200)
  expect(JSON.parse(response.body)).toEqual({ kind: 'run-not-found', runId: MARKED_RUN })
  expect(door.invocations).toEqual([RUNS_MARK_FUNCTION_ID])
}

// The retained same-site mutating arms of the shipped router. Each refuses a page on another
// origin before it reads a body, so the credential and editor doors are safe to drive here.
const RETAINED_SAME_SITE_MUTATIONS: ReadonlyArray<readonly [string, string]> = [
  ['POST', MARK_PATH],
  ['POST', '/api/config/undo'],
  ['POST', '/api/live-editor/sessions'],
  ['POST', '/api/auth/credential'],
  ['POST', '/api/auth/credential/move'],
  ['POST', '/api/llm/test'],
  ['DELETE', '/api/auth/cross-site-probe-432-14'],
]

// ---- gap 6: the cross-origin drive ---------------------------------------------------------

describe('the fourth door refuses a cross-origin drive before anything happens (gap 6)', () => {
  it('6a — refuses the CORS simple request, before the mark reaches the host', async () => {
    const door = await openDoor()
    // THE VERIFIER'S EXACT PROBE, on the mark door. `text/plain;charset=UTF-8` with a JSON body
    // is a CORS SIMPLE request: no preflight is sent, and an unguarded route would record a mark
    // on the person's machine.
    const answered = await driveMark(door.port, {
      'content-type': 'text/plain;charset=UTF-8',
      origin: HOSTILE_ORIGIN,
    })
    expectNoSideEffect('6a', door, answered, 403)
  })

  it('6b — refuses a cross-origin drive that declares application/json (the Origin leg alone)', async () => {
    const door = await openDoor()
    const answered = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: HOSTILE_ORIGIN,
    })
    expectNoSideEffect('6b', door, answered, 403)
  })

  // RE-SPELLED 2026-10-01 (432-14): was 'refuses a text/plain drive bearing no Origin at all (the
  // Content-Type leg alone)'. The media-type leg belonged to the run-confirm router and was deleted
  // with it; no surviving door has one. A browser always sends `Origin` on a cross-origin POST, so
  // a request with none is a local client, and the mark door admits it exactly once.
  it('6c — admits a text/plain drive bearing no Origin at all as a local client, exactly once', async () => {
    const door = await openDoor()
    const answered = await driveMark(door.port, { 'content-type': 'text/plain;charset=UTF-8' })
    expectDispatchedOnce('6c', door, answered)
  })

  it('6d — ACCEPTS the same-origin browser drive, which dispatches the mark once', async () => {
    const door = await openDoor()
    // The dashboard's own page, marking on its own door: `Origin` equals the request's `Host`
    // origin, which is what a browser sends on a same-origin POST.
    const answered = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: sameOrigin(door),
    })
    expectDispatchedOnce('6d', door, answered)
  })

  it('6e — ACCEPTS the Origin-less local drive (curl and local tooling, the recorded policy)', async () => {
    const door = await openDoor()
    // A SEPARATE AXIS from 6d and not a repetition of it: 6d varies the Origin's VALUE, this one
    // varies its PRESENCE. A guard that required an Origin would pass 6d and fail here, and it
    // would have bricked every scripted drive against a localhost door.
    const answered = await driveMark(door.port, { 'content-type': 'application/json' })
    expectDispatchedOnce('6e', door, answered)
  })

  // RE-SPELLED 2026-10-01 (432-14): was 'refuses a cross-origin answer to somebody else's
  // outstanding run confirm'. There is no outstanding question to spend. The claim that survives is
  // that the refusal is about the ORIGIN and never about the body: the byte-identical request is
  // refused from another origin and accepted from the door's own.
  it('6f — refuses a cross-origin mark, and the identical request from the page itself dispatches', async () => {
    const door = await openDoor()
    const refused = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: HOSTILE_ORIGIN,
    })
    expectNoSideEffect('6f', door, refused, 403)

    const accepted = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: sameOrigin(door),
    })
    expectDispatchedOnce('6f', door, accepted)
  })

  // RE-SPELLED 2026-10-01 (432-14): was 'refuses EVERY mutating route the router's own table
  // declares'. The table was the run-confirm router's and is deleted. The shipped router has no
  // table of its mutating arms, so the retained same-site arms are listed here by path; a new
  // same-site arm must be added to this list to be ranged.
  it('6g — refuses EVERY retained same-site mutating arm, and reaches the mark arm same-origin', async () => {
    const door = await openDoor()
    for (const [method, path] of RETAINED_SAME_SITE_MUTATIONS) {
      for (const contentType of ['application/json', 'text/plain;charset=UTF-8']) {
        const crossOrigin = await rawRequest(door.port, {
          method,
          path,
          headers: { 'content-type': contentType, origin: HOSTILE_ORIGIN },
          ...(method === 'DELETE' ? {} : { body: MARK_BODY }),
        })
        expectNoSideEffect(`6g ${contentType} ${method} ${path}`, door, crossOrigin, 403)
        expect(JSON.parse(crossOrigin.body)).toEqual({ error: 'cross_site_refused' })
      }
    }

    // THE ACCEPTS CONTROL, which is what stops this cell passing on a door that refuses everything.
    const answered = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: sameOrigin(door),
    })
    expectDispatchedOnce('6g', door, answered)
  })

  it('6i — refuses the literal `null` Origin, which is not the same fact as no Origin at all', async () => {
    const door = await openDoor()
    // A SEPARATE RUNG FROM 6e AND THE ONE MOST EASILY LOST. `Origin: null` is what a sandboxed
    // iframe, a `data:` document and a cross-origin redirect send — an origin that declined to
    // name itself, which is the opposite of a local client that has no origin to name.
    const answered = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: 'null',
    })
    expectNoSideEffect('6i', door, answered, 403)
  })

  it('6h — refuses a same-origin-looking drive whose Sec-Fetch-Site says cross-site', async () => {
    const door = await openDoor()
    // The third axis, varied alone: the Origin here is exactly the one 6d ACCEPTS, so nothing but
    // the fetch-metadata header can decide this request.
    const answered = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: sameOrigin(door),
      'sec-fetch-site': 'cross-site',
    })
    expectNoSideEffect('6h', door, answered, 403)
  })
})

describe('C432-RETAINED-CROSS-SITE', () => {
  it('C432-RETAINED-CROSS-SITE: the dashboard mark control refuses another origin before dispatch and dispatches for its own page', async () => {
    const door = await openDoor()
    for (const headers of [
      { 'content-type': 'text/plain;charset=UTF-8', origin: HOSTILE_ORIGIN },
      { 'content-type': 'application/json', origin: HOSTILE_ORIGIN },
    ]) {
      const refused = await driveMark(door.port, headers)
      expectNoSideEffect(`C432-RETAINED-CROSS-SITE ${headers['content-type']}`, door, refused, 403)
      expect(JSON.parse(refused.body)).toEqual({ error: 'cross_site_refused' })
      expect(refused.headers['access-control-allow-origin']).toBeUndefined()
    }
    const accepted = await driveMark(door.port, {
      'content-type': 'application/json',
      origin: sameOrigin(door),
    })
    expectDispatchedOnce('C432-RETAINED-CROSS-SITE', door, accepted)
  })
})

// ---- gap 7: the malformed request path -----------------------------------------------------

/** Everything that escaped the server while a cell ran — the second half of every survival claim. */
function watchForEscapes(): { readonly escaped: unknown[]; readonly stop: () => void } {
  const escaped: unknown[] = []
  const onRejection = (reason: unknown): void => { escaped.push(reason) }
  const onUncaught = (error: unknown): void => { escaped.push(error) }
  process.on('unhandledRejection', onRejection)
  process.on('uncaughtException', onUncaught)
  return {
    escaped,
    stop: () => {
      process.off('unhandledRejection', onRejection)
      process.off('uncaughtException', onUncaught)
    },
  }
}

/** The door is still answering: a same-origin mark reaches the op and gets its own answer. */
async function expectDoorAnswers(door: DoorFixture, message: string): Promise<void> {
  const before = door.invocations.length
  const healthy = await driveMark(door.port, {
    'content-type': 'application/json',
    origin: sameOrigin(door),
  })
  expect(healthy.status, `${message} ${healthy.note ?? ''}`).toBe(200)
  expect(JSON.parse(healthy.body)).toEqual({ kind: 'run-not-found', runId: MARKED_RUN })
  expect(door.invocations.length).toBe(before + 1)
}

/** Let a rejection reach the process before a cell claims none did. */
async function settleEscapes(): Promise<void> {
  await new Promise<void>((done) => setTimeout(done, 100))
}

/** Replace the host's display unmask with one that throws on its first call and only then. */
function throwingUnmaskOnce(message: string): (host: AgentHost) => AgentHost {
  return (host) => {
    let calls = 0
    return {
      ...host,
      unmaskForDisplay: (text: string, scope?: { runId: string }): string => {
        calls += 1
        if (calls === 1) throw new Error(message)
        return host.unmaskForDisplay(text, scope)
      },
    }
  }
}

describe('the fourth door outlives every malformed request a socket can carry (gap 7)', () => {
  it('7c — answers an unparseable request line and serves the next request', async () => {
    const door = await openDoor()
    const watch = watchForEscapes()
    try {
      // `//` is a request target `node:http` hands straight to the handler and the WHATWG URL
      // parser refuses (a protocol-relative reference with an empty host). Unguarded, that
      // `TypeError` would leave the listener as an uncaught exception.
      const answered = await rawRequest(door.port, { method: 'GET', path: '//' })
      expect(answered.status, `the unparseable request line was never answered ${answered.note ?? ''}`)
        .toBe(400)
      expect(answered.body).toBe('Bad Request')

      await expectDoorAnswers(door, 'the door stopped serving after the unparseable request line')

      await settleEscapes()
      expect(watch.escaped, 'an exception escaped the dashboard server').toEqual([])
    } finally {
      watch.stop()
    }
  })

  // RE-SPELLED 2026-10-01 (432-14): the synchronous arm was the run-confirm router's media-type
  // refusal, deleted with it. The shipped server's synchronous run read now carries the claim: its
  // display unmask runs inside the router's own call stack, so only the server's one `try` can
  // answer a throw there.
  it('7d — a throwing SYNCHRONOUS arm is caught by the dispatch boundary', async () => {
    const door = await openDoor({ wrapHost: throwingUnmaskOnce('432-14 unmask fault') })
    const watch = watchForEscapes()
    try {
      const answered = await rawRequest(door.port, {
        method: 'GET',
        path: `/api/runs/${READ_RUN}`,
        headers: { origin: sameOrigin(door) },
      })
      expect(answered.status, `the throwing read never answered ${answered.note ?? ''}`).toBe(500)
      expect(answered.body).toBe('Internal Server Error')

      await expectDoorAnswers(door, 'the door stopped serving after the throwing read')

      await settleEscapes()
      expect(watch.escaped, 'the exception escaped the dashboard server').toEqual([])
    } finally {
      watch.stop()
    }
  })

  // RE-SPELLED 2026-10-01 (432-14): was the run-confirm answer handler's rejection. The mark door's
  // handler writes its success through the display unmask AFTER its body read, so the throw is a
  // rejection of that handler's promise, and only the arm's own `.catch` can answer it.
  it('7b-ii — a throwing responder is caught by the handler\'s own backstop', async () => {
    const door = await openDoor({ wrapHost: throwingUnmaskOnce('400-14 unmask fault') })
    const watch = watchForEscapes()
    try {
      const answered = await driveMark(door.port, { 'content-type': 'application/json' })
      expect(answered.status, `the throwing responder never answered ${answered.note ?? ''}`).toBe(500)
      expect(JSON.parse(answered.body)).toEqual({ error: 'read_failed' })

      await expectDoorAnswers(door, 'the door stopped serving after the throwing responder')

      await settleEscapes()
      expect(watch.escaped, 'the rejection escaped the dashboard server').toEqual([])
    } finally {
      watch.stop()
    }
  })
})
