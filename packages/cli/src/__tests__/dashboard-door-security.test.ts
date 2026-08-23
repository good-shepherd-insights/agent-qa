// The fourth door's security posture, DRIVEN (Phase 400 plan 14, verification gaps 6 and 7).
//
// WHY EVERY CELL BELOW OPENS A SOCKET. The phase's shipped CORS corpus asserted that a response
// carried no `Access-Control-Allow-Origin`. That is an assertion about what an attacker gets to
// READ, and the threat is what an attacker gets to DO: a CORS simple request needs no preflight,
// so the door's 204-no-grant OPTIONS arm never runs, the browser sends the POST anyway, and the
// turn executes. Withholding the reply header hides the answer and not the side effect. So no cell
// here asserts a header: every REJECTS cell measures the SIDE-EFFECT SURFACE — the session-file
// census under `.agent-qa/sessions/`, the execution-audit rows, the receipts in the body — and it
// measures them around a request written byte-by-byte onto a real socket.
//
// RAW SOCKETS RATHER THAN `fetch`, for two reasons that are both load-bearing. `fetch` normalises
// a path, and gap 7's whole probe is a path (`/api/chat/sessions/%/events`) that no URL builder
// will hand to a server. And `Origin` is a forbidden header name in a browser, so a corpus that
// could only set the headers `fetch` permits could not state the attacker's request at all.
//
// ACCEPTS CONTROLS ARE NOT OPTIONAL HERE. A REJECTS-only corpus is green against a door that
// refuses everything, which is a door nobody can use. The two axes the policy allows — a
// same-origin browser drive and an Origin-less local drive — are pinned SEPARATELY, so a fix that
// closed either one reds a cell.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  CHAT_CAPABILITIES_ROUTE,
  CHAT_CATALOG_ROUTE,
  CHAT_CONFIRM_ROUTE,
  CHAT_ROUTE_TABLE,
  CHAT_SESSION_EVENTS_TEMPLATE,
  CHAT_TURN_ROUTE,
  createChatRouter,
  createConfirmRegistry,
  isMutatingChatRequest,
  type AgentHost,
  type ChatConfirmChannelFrame,
  type ChatTurnResponse,
  type ConfirmRegistry,
} from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

/** The tracer utterance every drive uses: bound in this composition, reads nothing staged. */
const TRACER = '/fn config.get {}'

/** The cross-origin an attacker's page is served from — the verifier's own probe value. */
const HOSTILE_ORIGIN = 'https://evil.example'

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
  readonly server: Server
  readonly confirms: ConfirmRegistry
}

const openDoors: DoorFixture[] = []

/**
 * The door as `agent-qa dashboard` composes it, with a confirm registry bound.
 *
 * `wrapHost` exists for gap 7's rejection-backstop cells and nothing else: it composes the SHIPPED
 * host and then replaces exactly one of its members with a throwing one, which is how a fault is
 * injected at a seam the product really has rather than by standing up a lookalike door.
 */
async function openDoor(options: {
  readonly wrapHost?: (host: AgentHost) => AgentHost
} = {}): Promise<DoorFixture> {
  const configPath = fixtureWorkspace()
  const configRoot = dirname(resolve(configPath))
  let boundOrigin: string | undefined
  const confirms = createConfirmRegistry({ timeoutMs: 60_000 })
  const { host, agentHost } = composeDashboardDoor({
    agentQaRoot: join(configRoot, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    confirms,
  })
  const router = createChatRouter(options.wrapHost === undefined ? agentHost : options.wrapHost(agentHost))
  const server = createServer(router)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the door bound no port')
  boundOrigin = `http://127.0.0.1:${String(address.port)}`
  const fixture: DoorFixture = {
    origin: boundOrigin,
    port: address.port,
    configRoot,
    host,
    server,
    confirms,
  }
  openDoors.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openDoors.length > 0) {
    const door = openDoors.pop()!
    await new Promise<void>((closed) => door.server.close(() => closed()))
    await door.host.close()
    rmSync(door.configRoot, { recursive: true, force: true })
  }
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
  return { status: Number.isInteger(status) ? status : 0, headers, body }
}

/**
 * One request, written onto a socket exactly as given.
 *
 * The PATH IS NOT PARSED and the HEADERS ARE NOT FILTERED. That is the whole point: `/…/%/events`
 * and `Origin: https://evil.example` are both things a URL builder or a browser-shaped client would
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

/** A turn, driven with whatever headers the cell wants to state. */
function driveTurn(
  port: number,
  headers: Readonly<Record<string, string>>,
  message = TRACER,
): Promise<RawResponse> {
  return rawRequest(port, {
    method: 'POST',
    path: '/api/chat/turn',
    headers,
    body: JSON.stringify({ message }),
  })
}

// ---- the side-effect surface ---------------------------------------------------------------

/** Every session file this door has written — the census a refusal must leave unchanged. */
function sessionFiles(configRoot: string): readonly string[] {
  const dir = join(configRoot, '.agent-qa', 'sessions')
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort()
}

/** Every execution-audit row this door has written — the second side-effect surface. */
function auditRows(configRoot: string): readonly Record<string, unknown>[] {
  const path = join(configRoot, '.agent-qa', 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

interface SideEffects {
  readonly sessions: readonly string[]
  readonly auditRows: number
}

function sideEffects(configRoot: string): SideEffects {
  return { sessions: sessionFiles(configRoot), auditRows: auditRows(configRoot).length }
}

/**
 * The whole REJECTS assertion, in one place so no cell can quietly assert less than its siblings.
 *
 * STATUS IS THE WEAKEST OF THE FOUR and it is deliberately not alone: a door that answered 403 and
 * executed the turn anyway would pass a status-only cell, and that door is precisely what the
 * shipped one was (200, with the reply hidden by a missing header).
 */
function expectNoSideEffect(
  label: string,
  response: RawResponse,
  expectedStatus: number,
  before: SideEffects,
  after: SideEffects,
): void {
  expect(response.status, `${label}: the door answered ${String(response.status)} ${response.note ?? ''}`)
    .toBe(expectedStatus)
  expect(response.body, `${label}: a refusal carries no receipts`).not.toContain('receipts')
  expect(after.sessions, `${label}: the refused drive wrote a session file`).toEqual(before.sessions)
  expect(after.auditRows, `${label}: the refused drive wrote an execution-audit row`)
    .toBe(before.auditRows)
}

// ---- gap 6: the cross-origin drive ---------------------------------------------------------

describe('the fourth door refuses a cross-origin drive before anything happens (gap 6)', () => {
  it('6a — refuses the CORS simple request that used to execute a turn', async () => {
    const door = await openDoor()
    const before = sideEffects(door.configRoot)

    // THE VERIFIER'S EXACT PROBE. `text/plain;charset=UTF-8` with a JSON body is a CORS SIMPLE
    // request: no preflight is sent, so the door's 204-no-grant OPTIONS arm never runs.
    const answered = await driveTurn(door.port, {
      'content-type': 'text/plain;charset=UTF-8',
      origin: HOSTILE_ORIGIN,
    })

    expectNoSideEffect('6a', answered, 403, before, sideEffects(door.configRoot))
  })

  it('6b — refuses a cross-origin drive that declares application/json (the Origin leg alone)', async () => {
    const door = await openDoor()
    const before = sideEffects(door.configRoot)

    // A Content-Type-only fix passes 6a and fails HERE: this request's media type is exactly the
    // one the door wants, and its Origin is still somebody else's page.
    const answered = await driveTurn(door.port, {
      'content-type': 'application/json',
      origin: HOSTILE_ORIGIN,
    })

    expectNoSideEffect('6b', answered, 403, before, sideEffects(door.configRoot))
  })

  it('6c — refuses a text/plain drive bearing no Origin at all (the Content-Type leg alone)', async () => {
    const door = await openDoor()
    const before = sideEffects(door.configRoot)

    // An Origin-only fix passes 6a and 6b and fails HERE. The 415 matters beyond the refusal: a
    // browser that must send `application/json` must first send a preflight, and the preflight is
    // the arm this door already answers with no grant.
    const answered = await driveTurn(door.port, { 'content-type': 'text/plain;charset=UTF-8' })

    expectNoSideEffect('6c', answered, 415, before, sideEffects(door.configRoot))
  })

  it('6d — ACCEPTS the same-origin browser drive, which still executes a real turn', async () => {
    const door = await openDoor()

    // The dashboard's own page, driving its own door: `Origin` equals the request's `Host` origin,
    // which is what a browser sends on a same-origin POST.
    const answered = await driveTurn(door.port, {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${String(door.port)}`,
    })

    expect(answered.status, `the same-origin drive was refused ${answered.note ?? ''}`).toBe(200)
    const turn = JSON.parse(answered.body) as ChatTurnResponse
    expect(turn.result.receipts.map((receipt) => `${receipt.functionId}:${receipt.status}`))
      .toEqual(['config.get:executed'])
    // The side effect this cell WANTS: the conversation is on disk.
    expect(sessionFiles(door.configRoot)).toEqual([`${turn.result.sessionId}.jsonl`])
  })

  it('6e — ACCEPTS the Origin-less local drive (curl and local tooling, the recorded policy)', async () => {
    const door = await openDoor()

    // A SEPARATE AXIS from 6d and not a repetition of it: 6d varies the Origin's VALUE, this one
    // varies its PRESENCE. A guard that required an Origin would pass 6d and fail here, and it
    // would have bricked every scripted drive against a localhost door.
    const answered = await driveTurn(door.port, { 'content-type': 'application/json' })

    expect(answered.status, `the Origin-less drive was refused ${answered.note ?? ''}`).toBe(200)
    const turn = JSON.parse(answered.body) as ChatTurnResponse
    expect(turn.result.receipts.map((receipt) => receipt.status)).toEqual(['executed'])
    expect(sessionFiles(door.configRoot)).toEqual([`${turn.result.sessionId}.jsonl`])
  })

  it('6f — refuses a cross-origin answer to somebody else\'s outstanding confirm', async () => {
    const door = await openDoor()

    // The registry is driven DIRECTLY here rather than through an ask-tier turn, because what this
    // cell is about is the ROUTE: a question is genuinely parked and genuinely answerable, and the
    // only variable is where the answer came from.
    const frames: ChatConfirmChannelFrame[] = []
    door.confirms.subscribe((_scopeId, frame) => { frames.push(frame) })
    const closeChannel = door.confirms.openChannel('chat-400-14-confirm')
    const parked = door.confirms.request({
      // 401-09: the registry's axis is a confirm SCOPE now — a conversation id is one kind of scope
      // and the chat route's wire word is unchanged, which is why the body below still says
      // `sessionId`.
      scopeId: 'chat-400-14-confirm',
      actionClass: 'fn:control.400.14.confirm-arm',
    })
    const request = frames.find((frame) => frame.kind === 'confirm_request')
    expect(request?.kind, 'no confirm was parked, so this cell would assert about nothing').toBe('confirm_request')
    const confirmId = request?.kind === 'confirm_request' ? request.request.confirmId : ''
    expect(door.confirms.pendingCount()).toBe(1)

    const body = JSON.stringify({ sessionId: 'chat-400-14-confirm', confirmId, answer: 'accept' })
    const refused = await rawRequest(door.port, {
      method: 'POST',
      path: '/api/chat/confirm',
      headers: { 'content-type': 'application/json', origin: HOSTILE_ORIGIN },
      body,
    })

    expect(refused.status, `the cross-origin confirm was answered ${refused.note ?? ''}`).toBe(403)
    // THE SIDE EFFECT, which on this route is the registry rather than the disk: the id was never
    // spent, so the question is still outstanding and the turn behind it is still waiting.
    expect(door.confirms.pendingCount(), 'the cross-origin answer spent the confirm id').toBe(1)
    expect(
      frames.filter((frame) => frame.kind === 'confirm_resolved'),
      'the cross-origin answer resolved somebody else\'s question',
    ).toEqual([])

    // The ACCEPTS control on the same id: the person whose question it is can still answer it.
    const accepted = await rawRequest(door.port, {
      method: 'POST',
      path: '/api/chat/confirm',
      headers: { 'content-type': 'application/json' },
      body,
    })
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ resolved: true, answer: 'accept' })
    expect(await parked).toBe('accept')
    expect(door.confirms.pendingCount()).toBe(0)
    closeChannel()
  })

  it('6g — refuses EVERY mutating route the router\'s own table declares, and reaches all of them same-origin', async () => {
    const door = await openDoor()

    // THE ENUMERATION IS THE ROUTER'S, NOT THIS FILE'S. `CHAT_ROUTE_TABLE` is what dispatch reads,
    // so a route missing from it is unreachable and a route added to it is driven HERE without
    // anybody remembering to add a row to this corpus. That is the whole answer to the order
    // claim: the guards range the complete set of mutating routes because they are applied to the
    // method above this table, and this cell is what makes "complete" a measurement.
    const mutating = CHAT_ROUTE_TABLE.filter((row) => isMutatingChatRequest(row.method))
    expect(mutating.length, 'the table declares no mutating route, so this cell would range nothing')
      .toBeGreaterThanOrEqual(2)
    expect(
      mutating.map((row) => `${row.method} ${row.path}`).sort(),
      'a mutating route left this table would leave this corpus with it',
    ).toEqual(expect.arrayContaining([`POST ${CHAT_CONFIRM_ROUTE}`, `POST ${CHAT_TURN_ROUTE}`]))
    // And every path this door owns is IN the table, so dispatch cannot be reading one list while
    // this cell ranges another.
    const declared = CHAT_ROUTE_TABLE.map((row) => row.path)
    for (const route of [
      CHAT_TURN_ROUTE,
      CHAT_CONFIRM_ROUTE,
      CHAT_CAPABILITIES_ROUTE,
      CHAT_CATALOG_ROUTE,
      CHAT_SESSION_EVENTS_TEMPLATE,
    ]) {
      expect(declared, `\`${route}\` is dispatched but absent from the table`).toContain(route)
    }

    const body = JSON.stringify({ message: TRACER })
    for (const row of mutating) {
      // A templated mutating route cannot be driven by a literal path, so it reds HERE rather than
      // being skipped in silence — the corpus must be extended before such a route can ship.
      expect(
        row.path,
        `the mutating row \`${row.path}\` is templated; extend this cell rather than skipping it`,
      ).not.toContain(':')

      const beforeOrigin = sideEffects(door.configRoot)
      const crossOrigin = await rawRequest(door.port, {
        method: row.method,
        path: row.path,
        headers: { 'content-type': 'application/json', origin: HOSTILE_ORIGIN },
        body,
      })
      expectNoSideEffect(`6g cross-origin ${row.method} ${row.path}`, crossOrigin, 403, beforeOrigin, sideEffects(door.configRoot))

      const beforeType = sideEffects(door.configRoot)
      const wrongType = await rawRequest(door.port, {
        method: row.method,
        path: row.path,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
      })
      expectNoSideEffect(`6g text/plain ${row.method} ${row.path}`, wrongType, 415, beforeType, sideEffects(door.configRoot))
    }

    // THE ACCEPTS CONTROL OVER THE SAME COMPLETE SET, which is what stops this cell passing on a
    // door that refuses everything: driven from its own origin, no mutating route answers with
    // either refusal. (`/confirm` answers 400 for this body, which is the route working.)
    for (const row of mutating) {
      const answered = await rawRequest(door.port, {
        method: row.method,
        path: row.path,
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${String(door.port)}`,
        },
        body,
      })
      expect(
        [403, 415],
        `the same-origin drive of ${row.method} ${row.path} was refused as cross-site or wrong-typed`,
      ).not.toContain(answered.status)
    }
  })

  it('6i — refuses the literal `null` Origin, which is not the same fact as no Origin at all', async () => {
    const door = await openDoor()
    const before = sideEffects(door.configRoot)

    // A SEPARATE RUNG FROM 6e AND THE ONE MOST EASILY LOST. `Origin: null` is what a sandboxed
    // iframe, a `data:` document and a cross-origin redirect send — an origin that declined to
    // name itself, which is the opposite of a local client that has no origin to name. A guard
    // written as "no usable origin means allow" would pass 6a, 6b, 6c, 6e and fail here.
    const answered = await driveTurn(door.port, {
      'content-type': 'application/json',
      origin: 'null',
    })

    expectNoSideEffect('6i', answered, 403, before, sideEffects(door.configRoot))
  })

  it('6h — refuses a same-origin-looking drive whose Sec-Fetch-Site says cross-site', async () => {
    const door = await openDoor()
    const before = sideEffects(door.configRoot)

    // The third axis, varied alone: the Origin here is exactly the one 6d ACCEPTS, so nothing but
    // the fetch-metadata header can decide this request. A guard that read only `Origin` passes
    // 6a, 6b, 6c and fails here.
    const answered = await driveTurn(door.port, {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${String(door.port)}`,
      'sec-fetch-site': 'cross-site',
    })

    expectNoSideEffect('6h', answered, 403, before, sideEffects(door.configRoot))
  })
})

// ---- gap 7: the malformed request path -----------------------------------------------------

/** Everything that escaped the router while a cell ran — the second half of every survival claim. */
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

/** Let a rejection reach the process before a cell claims none did. */
async function settleEscapes(): Promise<void> {
  await new Promise<void>((done) => setTimeout(done, 100))
}

describe('the fourth door outlives every malformed request a socket can carry (gap 7)', () => {
  it('7a — answers an unparseable session id and serves the next request', async () => {
    const door = await openDoor()
    const watch = watchForEscapes()
    try {
      // A lone `%` is not a percent-escape, so `decodeURIComponent` throws `URIError`. On the
      // shipped door that throw left a SYNCHRONOUS router as an uncaught exception: the request
      // never answered and the `agent-qa dashboard` process died. One request, remotely, unauthed.
      for (const malformed of ['%', '%E0']) {
        const answered = await rawRequest(door.port, {
          method: 'GET',
          path: `/api/chat/sessions/${malformed}/events`,
        })
        expect(
          answered.status,
          `the malformed id \`${malformed}\` was never answered ${answered.note ?? ''}`,
        ).toBe(404)

        // AND THE PROCESS IS STILL SERVING. A cell that stopped at the first response would be
        // green against a door that answered and then fell over.
        const healthy = await rawRequest(door.port, {
          method: 'GET',
          path: '/api/chat/capabilities',
        })
        expect(healthy.status, 'the door stopped serving after the malformed request').toBe(200)
        expect(JSON.parse(healthy.body)).toHaveProperty('ops')
      }

      // NO ORACLE. An id this process never minted and an id no parser can read must be the same
      // bytes from outside, or the route tells a prober which session ids exist.
      const unparseable = await rawRequest(door.port, {
        method: 'GET',
        path: '/api/chat/sessions/%/events',
      })
      const unminted = await rawRequest(door.port, {
        method: 'GET',
        path: '/api/chat/sessions/chat-400-14-never-minted/events',
      })
      expect(unparseable.status).toBe(unminted.status)
      expect(unparseable.body).toBe(unminted.body)

      await settleEscapes()
      expect(watch.escaped, 'an exception escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('7c — answers an unparseable request line and serves the next request', async () => {
    const door = await openDoor()
    const watch = watchForEscapes()
    try {
      // `//` is a request target `node:http` hands straight to the handler and the WHATWG URL
      // parser refuses (a protocol-relative reference with an empty host). Unguarded, that
      // `TypeError` leaves the synchronous router exactly as the decode's `URIError` did.
      const answered = await rawRequest(door.port, { method: 'GET', path: '//' })
      expect(answered.status, `the unparseable request line was never answered ${answered.note ?? ''}`)
        .toBe(400)
      expect(JSON.parse(answered.body)).toEqual({ error: 'Invalid request URL' })

      const healthy = await rawRequest(door.port, { method: 'GET', path: '/api/chat/capabilities' })
      expect(healthy.status, 'the door stopped serving after the unparseable request line').toBe(200)

      await settleEscapes()
      expect(watch.escaped, 'an exception escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('7d — a throwing SYNCHRONOUS arm is caught by the dispatch boundary', async () => {
    const door = await openDoor({
      wrapHost: (host) => ({
        ...host,
        listDeclarations: (): never => {
          throw new Error('400-14 listing fault')
        },
      }),
    })
    const watch = watchForEscapes()
    try {
      // `handleCapabilities` is SYNCHRONOUS, so there is no promise to `.catch` here: a throw goes
      // straight out of the `request` listener and into `uncaughtException`. Only the `try` around
      // the whole dispatch can answer this one, which is what makes this cell that guard's own.
      const answered = await rawRequest(door.port, { method: 'GET', path: '/api/chat/capabilities' })
      expect(answered.status, `the throwing listing never answered ${answered.note ?? ''}`).toBe(500)
      expect(JSON.parse(answered.body)).toEqual({
        error: 'The request could not be completed [Error]',
      })

      // And the door is still a door: a real turn still executes after it.
      const healthy = await driveTurn(door.port, { 'content-type': 'application/json' })
      expect(healthy.status, 'the door stopped serving after the throwing listing').toBe(200)

      await settleEscapes()
      expect(watch.escaped, 'the exception escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('7b-i — a throwing fold answers 500 through the turn\'s own guard, not through the backstop', async () => {
    const door = await openDoor({
      wrapHost: (host) => ({
        ...host,
        foldFunctionResult: (): never => {
          throw new Error('400-14 fold fault')
        },
      }),
    })
    const watch = watchForEscapes()
    try {
      // The fold map runs AFTER the op returned, so this is a rejection from the part of the turn
      // that used to sit outside `handleTurn`'s own try — the measured sibling of the decode.
      const answered = await driveTurn(door.port, { 'content-type': 'application/json' })
      expect(answered.status, `the throwing fold never answered ${answered.note ?? ''}`).toBe(500)
      // THE BODY, NOT JUST THE STATUS: this is the turn's own refusal wording. If the fold map
      // drifts back outside the try, the router's boundary backstop answers instead — also a 500,
      // with different bytes — and this assertion is what tells the two apart.
      expect(JSON.parse(answered.body)).toEqual({
        error: 'The turn could not be carried out [Error]',
      })

      const healthy = await rawRequest(door.port, { method: 'GET', path: '/api/chat/capabilities' })
      expect(healthy.status, 'the door stopped serving after the throwing fold').toBe(200)

      await settleEscapes()
      expect(watch.escaped, 'the rejection escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('7b-ii — a throwing responder is caught by the router\'s boundary backstop', async () => {
    let calls = 0
    const door = await openDoor({
      wrapHost: (host) => ({
        ...host,
        unmaskForDisplay: (text: string): string => {
          calls += 1
          if (calls === 1) throw new Error('400-14 unmask fault')
          return host.unmaskForDisplay(text)
        },
      }),
    })
    const watch = watchForEscapes()
    try {
      // The responder runs OUTSIDE every handler's own try — it is the last thing a turn does. So
      // nothing but the router boundary can answer this, which is what makes this cell the
      // backstop's own: delete the `.catch` and no response arrives at all.
      const answered = await driveTurn(door.port, { 'content-type': 'application/json' })
      expect(answered.status, `the throwing responder never answered ${answered.note ?? ''}`).toBe(500)
      expect(JSON.parse(answered.body)).toEqual({
        error: 'The request could not be completed [Error]',
      })

      const healthy = await rawRequest(door.port, { method: 'GET', path: '/api/chat/capabilities' })
      expect(healthy.status, 'the door stopped serving after the throwing responder').toBe(200)

      await settleEscapes()
      expect(watch.escaped, 'the rejection escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })
})
