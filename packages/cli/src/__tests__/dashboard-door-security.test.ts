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
// a path, and gap 7's probe is a request target (`//`) that no URL builder will hand to a server.
// And `Origin` is a forbidden header name in a browser, so a corpus that could only set the headers
// `fetch` permits could not state the attacker's request at all.
//
// ACCEPTS CONTROLS ARE NOT OPTIONAL HERE. A REJECTS-only corpus is green against a door that
// refuses everything, which is a door nobody can use. The two axes the policy allows — a
// same-origin browser drive and an Origin-less local drive — are pinned SEPARATELY, so a fix that
// closed either one reds a cell.
//
// 430 (2026-09-28): the cross-site corpus is driven on the run-confirm pair, the routes that
// survive until Phase 432. The guards sit on the method above the router's table, so the claims
// are unchanged; what moved is the route, and the side effect a refusal must leave untouched is now
// a parked run-trigger question that stays outstanding.
//
// 430 D-02 (2026-09-28): 7a (the session-id route) and 7b-i (the turn's fold guard) are deleted
// with the routes they drove. The generic 404 those paths now answer is carried by
// C430-DELETED-CHAT-ROUTES-SHARED-404 and process survival's s5.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  CHAT_ROUTE_TABLE,
  RUN_CONFIRM_ANSWER_ROUTE,
  RUN_CONFIRM_CHANNEL_ROUTE,
  createChatRouter,
  createConfirmRegistry,
  isMutatingChatRequest,
  mintRunTriggerConfirmScope,
  type AgentHost,
  type ChatConfirmAnswer,
  type ChatConfirmChannelFrame,
  type ConfirmRegistry,
} from '@vostride/agent-qa-dashboard'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it } from 'vitest'

import { composeDashboardDoor } from '../commands/dashboard.js'

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
  /** Channels a cell opened on the registry; closing them denies whatever is still parked. */
  readonly cleanups: (() => void)[]
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
    cleanups: [],
  }
  openDoors.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openDoors.length > 0) {
    const door = openDoors.pop()!
    for (const cleanup of door.cleanups.splice(0)) cleanup()
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

/** A run-confirm answer, driven with whatever headers the cell wants to state. */
function driveAnswer(
  port: number,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<RawResponse> {
  return rawRequest(port, { method: 'POST', path: RUN_CONFIRM_ANSWER_ROUTE, headers, body })
}

// ---- the parked run-trigger question -------------------------------------------------------

interface ParkedRunConfirm {
  readonly scopeId: string
  readonly confirmId: string
  /** What the ask resolves to — the waiting run's decision. */
  readonly outcome: Promise<ChatConfirmAnswer>
  /** The well-formed answer to this question, as a browser holding its channel would send it. */
  body(answer?: ChatConfirmAnswer): string
  /** The answer it resolved to, or `undefined` while it is still outstanding. */
  settled(): ChatConfirmAnswer | undefined
  /** How many `confirm_resolved` frames this scope's channel has carried. */
  resolvedFrames(): number
}

/**
 * One outstanding run-trigger question, parked on the door's own registry.
 *
 * The registry is driven DIRECTLY rather than through a queued run, because what these cells are
 * about is the ROUTE: a question is genuinely parked on a minted trigger scope with a live channel,
 * so it is genuinely answerable, and the only variable is how the answer arrives. A real run
 * raising the same question is `run-trigger-confirm.test.ts`'s subject.
 */
function parkRunConfirm(door: DoorFixture): ParkedRunConfirm {
  const scopeId = mintRunTriggerConfirmScope()
  const frames: ChatConfirmChannelFrame[] = []
  const unsubscribe = door.confirms.subscribe((frameScope, frame) => {
    if (frameScope === scopeId) frames.push(frame)
  })
  const closeChannel = door.confirms.openChannel(scopeId)
  door.cleanups.push(closeChannel, unsubscribe)

  let settled: ChatConfirmAnswer | undefined
  const outcome = door.confirms.request({ scopeId, actionClass: 'run:start' })
  void outcome.then((answer) => { settled = answer })

  const request = frames.find((frame) => frame.kind === 'confirm_request')
  if (request?.kind !== 'confirm_request') {
    throw new Error('no run confirm was parked, so this cell would assert about nothing')
  }
  const confirmId = request.request.confirmId
  return {
    scopeId,
    confirmId,
    outcome,
    body: (answer = 'accept') => JSON.stringify({ scopeId, confirmId, answer }),
    settled: () => settled,
    resolvedFrames: () => frames.filter((frame) => frame.kind === 'confirm_resolved').length,
  }
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
  /** Outstanding questions on the registry — the surface an answer route writes to. */
  readonly pendingConfirms: number
}

function sideEffects(door: DoorFixture): SideEffects {
  return {
    sessions: sessionFiles(door.configRoot),
    auditRows: auditRows(door.configRoot).length,
    pendingConfirms: door.confirms.pendingCount(),
  }
}

/**
 * The whole REJECTS assertion, in one place so no cell can quietly assert less than its siblings.
 *
 * STATUS IS THE WEAKEST OF THESE and it is deliberately not alone: a door that answered 403 and
 * acted anyway would pass a status-only cell, and that door is precisely what the shipped one was
 * (200, with the reply hidden by a missing header).
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
  expect(response.body, `${label}: a refusal resolved something`).not.toContain('resolved')
  expect(after.sessions, `${label}: the refused drive wrote a session file`).toEqual(before.sessions)
  expect(after.auditRows, `${label}: the refused drive wrote an execution-audit row`)
    .toBe(before.auditRows)
  expect(after.pendingConfirms, `${label}: the refused drive spent a confirm id`)
    .toBe(before.pendingConfirms)
}

/** The parked question is exactly as it was: nobody's answer reached it. */
function expectStillOutstanding(label: string, parked: ParkedRunConfirm): void {
  expect(parked.settled(), `${label}: the refused answer resolved the parked run confirm`)
    .toBeUndefined()
  expect(parked.resolvedFrames(), `${label}: the refused answer emitted a resolution`).toBe(0)
}

// ---- gap 6: the cross-origin drive ---------------------------------------------------------

describe('the fourth door refuses a cross-origin drive before anything happens (gap 6)', () => {
  it('6a — refuses the CORS simple request, before the parked run confirm resolves', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)
    const before = sideEffects(door)

    // THE VERIFIER'S EXACT PROBE, on the answer route. `text/plain;charset=UTF-8` with a JSON body
    // is a CORS SIMPLE request: no preflight is sent, so the door's 204-no-grant OPTIONS arm never
    // runs, and an unguarded route would approve an ask-tier run on the person's machine.
    const answered = await driveAnswer(door.port, {
      'content-type': 'text/plain;charset=UTF-8',
      origin: HOSTILE_ORIGIN,
    }, parked.body())

    expectNoSideEffect('6a', answered, 403, before, sideEffects(door))
    expectStillOutstanding('6a', parked)
  })

  it('6b — refuses a cross-origin drive that declares application/json (the Origin leg alone)', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)
    const before = sideEffects(door)

    // A Content-Type-only fix passes 6a and fails HERE: this request's media type is exactly the
    // one the door wants, and its Origin is still somebody else's page.
    const answered = await driveAnswer(door.port, {
      'content-type': 'application/json',
      origin: HOSTILE_ORIGIN,
    }, parked.body())

    expectNoSideEffect('6b', answered, 403, before, sideEffects(door))
    expectStillOutstanding('6b', parked)
  })

  it('6c — refuses a text/plain drive bearing no Origin at all (the Content-Type leg alone)', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)
    const before = sideEffects(door)

    // An Origin-only fix passes 6a and 6b and fails HERE. The 415 matters beyond the refusal: a
    // browser that must send `application/json` must first send a preflight, and the preflight is
    // the arm this door already answers with no grant.
    const answered = await driveAnswer(
      door.port,
      { 'content-type': 'text/plain;charset=UTF-8' },
      parked.body(),
    )

    expectNoSideEffect('6c', answered, 415, before, sideEffects(door))
    expectStillOutstanding('6c', parked)
  })

  it('6d — ACCEPTS the same-origin browser drive, which still resolves the parked run confirm', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)

    // The dashboard's own page, answering on its own door: `Origin` equals the request's `Host`
    // origin, which is what a browser sends on a same-origin POST.
    const answered = await driveAnswer(door.port, {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${String(door.port)}`,
    }, parked.body())

    expect(answered.status, `the same-origin answer was refused ${answered.note ?? ''}`).toBe(200)
    expect(JSON.parse(answered.body)).toEqual({ resolved: true, answer: 'accept' })
    // The side effect this cell WANTS: the waiting run has its decision.
    expect(await parked.outcome).toBe('accept')
    expect(parked.resolvedFrames()).toBe(1)
    expect(door.confirms.pendingCount()).toBe(0)
  })

  it('6e — ACCEPTS the Origin-less local drive (curl and local tooling, the recorded policy)', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)

    // A SEPARATE AXIS from 6d and not a repetition of it: 6d varies the Origin's VALUE, this one
    // varies its PRESENCE. A guard that required an Origin would pass 6d and fail here, and it
    // would have bricked every scripted drive against a localhost door.
    const answered = await driveAnswer(
      door.port,
      { 'content-type': 'application/json' },
      parked.body('deny'),
    )

    expect(answered.status, `the Origin-less answer was refused ${answered.note ?? ''}`).toBe(200)
    expect(JSON.parse(answered.body)).toEqual({ resolved: true, answer: 'deny' })
    expect(await parked.outcome).toBe('deny')
    expect(door.confirms.pendingCount()).toBe(0)
  })

  it('6f — refuses a cross-origin answer to somebody else\'s outstanding run confirm', async () => {
    const door = await openDoor()

    // The question belongs to the browser holding this scope's channel. A page on another origin
    // that has learned the scope and the confirm id — the strongest attacker this route faces —
    // still cannot spend them.
    const parked = parkRunConfirm(door)
    expect(door.confirms.pendingCount()).toBe(1)

    const refused = await driveAnswer(door.port, {
      'content-type': 'application/json',
      origin: HOSTILE_ORIGIN,
    }, parked.body())

    expect(refused.status, `the cross-origin answer was accepted ${refused.note ?? ''}`).toBe(403)
    // THE SIDE EFFECT, which on this route is the registry rather than the disk: the id was never
    // spent, so the question is still outstanding and the run behind it is still waiting.
    expect(door.confirms.pendingCount(), 'the cross-origin answer spent the confirm id').toBe(1)
    expectStillOutstanding('6f', parked)

    // The ACCEPTS control on the same id: the person whose question it is can still answer it.
    const accepted = await driveAnswer(
      door.port,
      { 'content-type': 'application/json' },
      parked.body(),
    )
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ resolved: true, answer: 'accept' })
    expect(await parked.outcome).toBe('accept')
    expect(door.confirms.pendingCount()).toBe(0)
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
      .toBeGreaterThanOrEqual(1)
    expect(
      mutating.map((row) => `${row.method} ${row.path}`).sort(),
      'a mutating route left this table would leave this corpus with it',
    ).toEqual(expect.arrayContaining([`POST ${RUN_CONFIRM_ANSWER_ROUTE}`]))
    // And every path this door owns is IN the table, so dispatch cannot be reading one list while
    // this cell ranges another.
    const declared = CHAT_ROUTE_TABLE.map((row) => row.path)
    for (const route of [RUN_CONFIRM_ANSWER_ROUTE, RUN_CONFIRM_CHANNEL_ROUTE]) {
      expect(declared, `\`${route}\` is dispatched but absent from the table`).toContain(route)
    }

    // EVERY ROW IS SENT THE SAME WELL-FORMED ANSWER, so the answer route's refusals are measured
    // against a question that really is answerable. Any other mutating row reads it as a malformed
    // body, which is that route working.
    const parked = parkRunConfirm(door)
    const body = parked.body()
    for (const row of mutating) {
      // A templated mutating route cannot be driven by a literal path, so it reds HERE rather than
      // being skipped in silence — the corpus must be extended before such a route can ship.
      expect(
        row.path,
        `the mutating row \`${row.path}\` is templated; extend this cell rather than skipping it`,
      ).not.toContain(':')

      const beforeOrigin = sideEffects(door)
      const crossOrigin = await rawRequest(door.port, {
        method: row.method,
        path: row.path,
        headers: { 'content-type': 'application/json', origin: HOSTILE_ORIGIN },
        body,
      })
      expectNoSideEffect(`6g cross-origin ${row.method} ${row.path}`, crossOrigin, 403, beforeOrigin, sideEffects(door))

      const beforeType = sideEffects(door)
      const wrongType = await rawRequest(door.port, {
        method: row.method,
        path: row.path,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body,
      })
      expectNoSideEffect(`6g text/plain ${row.method} ${row.path}`, wrongType, 415, beforeType, sideEffects(door))
    }
    expectStillOutstanding('6g', parked)

    // THE ACCEPTS CONTROL OVER THE SAME COMPLETE SET, which is what stops this cell passing on a
    // door that refuses everything: driven from its own origin, no mutating route answers with
    // either refusal, and the answer route spends the question.
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
    expect(await parked.outcome).toBe('accept')
  })

  it('6i — refuses the literal `null` Origin, which is not the same fact as no Origin at all', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)
    const before = sideEffects(door)

    // A SEPARATE RUNG FROM 6e AND THE ONE MOST EASILY LOST. `Origin: null` is what a sandboxed
    // iframe, a `data:` document and a cross-origin redirect send — an origin that declined to
    // name itself, which is the opposite of a local client that has no origin to name. A guard
    // written as "no usable origin means allow" would pass 6a, 6b, 6c, 6e and fail here.
    const answered = await driveAnswer(door.port, {
      'content-type': 'application/json',
      origin: 'null',
    }, parked.body())

    expectNoSideEffect('6i', answered, 403, before, sideEffects(door))
    expectStillOutstanding('6i', parked)
  })

  it('6h — refuses a same-origin-looking drive whose Sec-Fetch-Site says cross-site', async () => {
    const door = await openDoor()
    const parked = parkRunConfirm(door)
    const before = sideEffects(door)

    // The third axis, varied alone: the Origin here is exactly the one 6d ACCEPTS, so nothing but
    // the fetch-metadata header can decide this request. A guard that read only `Origin` passes
    // 6a, 6b, 6c and fails here.
    const answered = await driveAnswer(door.port, {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${String(door.port)}`,
      'sec-fetch-site': 'cross-site',
    }, parked.body())

    expectNoSideEffect('6h', answered, 403, before, sideEffects(door))
    expectStillOutstanding('6h', parked)
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

/** A well-formed run-confirm answer for a question nobody parked. */
function unparkedAnswer(): string {
  return JSON.stringify({
    scopeId: mintRunTriggerConfirmScope(),
    confirmId: 'confirm-430-16-never-parked',
    answer: 'accept',
  })
}

/**
 * The router is still answering: a same-origin answer for a confirm nobody parked gets the router's
 * own JSON refusal, which is only written by a door that is still dispatching.
 */
async function expectRouterAnswers(door: DoorFixture, message: string): Promise<void> {
  const healthy = await driveAnswer(door.port, {
    'content-type': 'application/json',
    origin: `http://127.0.0.1:${String(door.port)}`,
  }, unparkedAnswer())
  expect(healthy.status, `${message} ${healthy.note ?? ''}`).toBe(404)
  expect(JSON.parse(healthy.body)).toEqual({ error: 'Unknown or already-answered confirm' })
}

/** Let a rejection reach the process before a cell claims none did. */
async function settleEscapes(): Promise<void> {
  await new Promise<void>((done) => setTimeout(done, 100))
}

describe('the fourth door outlives every malformed request a socket can carry (gap 7)', () => {
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

      await expectRouterAnswers(door, 'the door stopped serving after the unparseable request line')

      await settleEscapes()
      expect(watch.escaped, 'an exception escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })

  it('7d — a throwing SYNCHRONOUS arm is caught by the dispatch boundary', async () => {
    let calls = 0
    const door = await openDoor({
      wrapHost: (host) => ({
        ...host,
        unmaskForDisplay: (text: string): string => {
          calls += 1
          if (calls === 1) throw new Error('430-16 unmask fault')
          return host.unmaskForDisplay(text)
        },
      }),
    })
    const watch = watchForEscapes()
    try {
      // THE MEDIA-TYPE REFUSAL IS WRITTEN BY `dispatch` ITSELF, synchronously and before any
      // handler runs, so the responder's unmask pass throws inside `dispatch` with no promise to
      // `.catch`. Only the `try` around the whole dispatch can answer this one, which is what makes
      // this cell that guard's own: without it the throw leaves the `request` listener as an
      // `uncaughtException`.
      const answered = await driveAnswer(door.port, {
        'content-type': 'text/plain;charset=UTF-8',
        origin: `http://127.0.0.1:${String(door.port)}`,
      }, unparkedAnswer())
      expect(answered.status, `the throwing refusal never answered ${answered.note ?? ''}`).toBe(500)
      expect(JSON.parse(answered.body)).toEqual({
        error: 'The request could not be completed [Error]',
      })

      await expectRouterAnswers(door, 'the door stopped serving after the throwing refusal')

      await settleEscapes()
      expect(watch.escaped, 'the exception escaped the chat router').toEqual([])
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
      // The answer handler writes its refusal through the responder AFTER its body read, outside
      // its only `try`, so the throw is a REJECTION of the handler's promise. Nothing but the
      // router's `.catch` on that promise can answer it, which is what makes this cell the
      // backstop's own: delete the `.catch` and no response arrives at all.
      const answered = await driveAnswer(
        door.port,
        { 'content-type': 'application/json' },
        unparkedAnswer(),
      )
      expect(answered.status, `the throwing responder never answered ${answered.note ?? ''}`).toBe(500)
      expect(JSON.parse(answered.body)).toEqual({
        error: 'The request could not be completed [Error]',
      })

      // And the door is still a door: an outstanding run confirm is still answerable after it.
      const parked = parkRunConfirm(door)
      const healthy = await driveAnswer(
        door.port,
        { 'content-type': 'application/json' },
        parked.body(),
      )
      expect(healthy.status, 'the door stopped serving after the throwing responder').toBe(200)
      expect(await parked.outcome).toBe('accept')

      await settleEscapes()
      expect(watch.escaped, 'the rejection escaped the chat router').toEqual([])
    } finally {
      watch.stop()
    }
  })
})
