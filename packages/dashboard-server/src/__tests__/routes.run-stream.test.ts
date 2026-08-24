// The LOCAL door onto the run event stream (Phase 402 plan 08, D-01/D-13/D-14 · INVK-03/INVK-04).
//
// WHAT "THIN CLIENT" HAS TO MEAN HERE, AND WHY A HAPPY-PATH CELL CANNOT SAY IT. D-01 keeps the
// dashboard on the IN-PROCESS door, so a cell that opens `/api/run-stream/:runId` and gets events
// back cannot tell "the local door consumes the contract" apart from "the local door grew its own
// stream". Both serve envelopes. The discriminating measurement is a DIFFERENTIAL: the same
// planted session, driven through the AUTHED door and the LOCAL door over a corpus of requests
// that includes every refusal class, with the two responses compared BYTE FOR BYTE. A second
// spelling in `routes.ts` would have to reproduce the framing, the filter, the repeated-parameter
// join, the two typed 400s, the pre-stream ordering and the heartbeat comment exactly — and the
// first one it got wrong reds a cell naming which.
//
// THE SOURCE CELL AT THE BOTTOM CARRIES ITS OWN KNOWN-POSITIVE CONTROL, deliberately (WINDOWS
// #253). "No SSE frame formatting appears in the handler body" is satisfied for free by an
// extractor that returns nothing, so the same extractor and the same predicate are run over the
// LEGACY `/api/execution/events` handler in the same file, where frame formatting demonstrably
// lives. A predicate that cannot see it there proves nothing about not seeing it here.
//
// THE PRODUCTION-FRAME CELLS DRIVE `startServer`, not the router alone. The router can only be
// reached with an attach port somebody threaded; the thing that threads it is `server.ts`. A suite
// that only mounted `createRouter` would prove the route works and leave the wiring unmeasured —
// the failure mode WINDOWS' "green that never ran" names.

import { readFile } from 'node:fs/promises'
import {
  createServer,
  get as httpGet,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  RUN_SERVICE_CONTRACT_VERSION,
  RunEventEnvelopeSchema,
  type RunEventEnvelope,
  type RunServiceReadiness,
  type RunSession,
  type RunStartAcknowledgement,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardDatabase } from '../db/database.js'
import {
  createRunServiceRoutes,
  serveRunEventStream,
  type RunServicePorts,
} from '../run-service/run-service-routes.js'
import { createRouter } from '../server/routes.js'
import { startServer } from '../server/server.js'

/**
 * THE CORE, WRAPPED IN A SPY THAT DELEGATES TO IT (not replaced by one).
 *
 * The differential below proves the two doors AGREE; it cannot prove there is ONE implementation,
 * because a private copy of the serving body produces byte-identical output — 402-05 measured
 * exactly that shape for the readiness predicate (its mutation M9), and only a reference-level pin
 * saw it. This is that pin for a function that is CALLED rather than published: `routes.ts` reads
 * `serveRunEventStream` off this module's namespace, so a handler that called a copy — in this
 * file, in a sibling module, anywhere — would leave the spy unfired.
 *
 * `createRunServiceRoutes` is unaffected: its own call binds lexically inside the real module, so
 * the authed side of every differential is the shipped path.
 */
vi.mock('../run-service/run-service-routes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../run-service/run-service-routes.js')>()
  return { ...actual, serveRunEventStream: vi.fn(actual.serveRunEventStream) }
})

const TOKEN = 'zz-402-08-local-door-token-1c9be4'

/**
 * The announced roster — non-contiguous and not 0-based, on 402-04's own reasoning.
 *
 * With members 0 and 1 a correct filter is indistinguishable from one that returns everything,
 * one that is off by one, and one keyed on array position rather than on the stamped `testIndex`.
 */
const ROSTER = [3, 7, 11] as const

/** An interleaved feed over three concurrent members, with chosen (gappy) seqs. */
const FEED: readonly RunEventEnvelope[] = Object.freeze([
  { seq: 1, ts: 1, runId: 'r_local', type: 'runStarted', payload: { busSchemaVersion: 1, memberTestCount: 3, handles: [...ROSTER] } },
  { seq: 3, ts: 3, runId: 'r_local', type: 'testStarted', payload: { testId: 'a', testIndex: 3, name: 'a' } },
  { seq: 5, ts: 5, runId: 'r_local', type: 'testStarted', payload: { testId: 'b', testIndex: 7, name: 'b' } },
  { seq: 8, ts: 8, runId: 'r_local', type: 'stepStarted', payload: { testIndex: 3, stepIndex: 0, stepText: 'a0' } },
  { seq: 13, ts: 13, runId: 'r_local', type: 'testStarted', payload: { testId: 'c', testIndex: 11, name: 'c' } },
  { seq: 14, ts: 14, runId: 'r_local', type: 'stepStarted', payload: { testIndex: 7, stepIndex: 0, stepText: 'b0' } },
  { seq: 17, ts: 17, runId: 'r_local', type: 'runWarning', payload: { code: 'w', message: 'w' } },
  { seq: 21, ts: 21, runId: 'r_local', type: 'stepStarted', payload: { testIndex: 11, stepIndex: 0, stepText: 'c0' } },
  { seq: 22, ts: 22, runId: 'r_local', type: 'testFinished', payload: { testId: 'a', testIndex: 3, outcome: 'passed' } },
  { seq: 25, ts: 25, runId: 'r_local', type: 'testFinished', payload: { testId: 'b', testIndex: 7, outcome: 'passed' } },
  { seq: 26, ts: 26, runId: 'r_local', type: 'testFinished', payload: { testId: 'c', testIndex: 11, outcome: 'failed' } },
  { seq: 30, ts: 30, runId: 'r_local', type: 'verdict', payload: { verdict: 'failed' } },
  { seq: 31, ts: 31, runId: 'r_local', type: 'runFinished', payload: { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: 31 } },
] as unknown as readonly RunEventEnvelope[])

/** The run-scoped seqs of the feed above, and the per-handle member-scoped ones. */
const RUN_SCOPED_SEQS = [1, 17, 30, 31]
const MEMBER_SEQS: Readonly<Record<number, readonly number[]>> = {
  3: [3, 8, 22],
  7: [5, 14, 25],
  11: [13, 21, 26],
}

function sessionOverFeed(id: string): RunSession {
  return {
    id: id as RunSession['id'],
    status: 'running',
    executionContext: 'local-headless' as RunSession['executionContext'],
    subscribe(_fromSeq, handler) {
      for (const envelope of FEED) handler(envelope)
      return () => undefined
    },
    cancel() { /* nothing to cancel on a planted session */ },
    done: Promise.resolve({ verdict: 'failed' } as never),
  }
}

/** THE ONE ATTACH PORT both doors are given — the same function object, by construction. */
function attachPort(runId: string): RunSession | undefined {
  return runId === 'r_local' ? sessionOverFeed('r_local') : undefined
}

const READINESS: RunServiceReadiness = {
  service: 'up',
  hostComposed: true,
  authConfigured: true,
  contractVersion: RUN_SERVICE_CONTRACT_VERSION,
}

const ACK: RunStartAcknowledgement = {
  runId: 'r_local' as RunStartAcknowledgement['runId'],
  scope: 'main' as unknown as RunStartAcknowledgement['scope'],
  executionContext: 'local-headless' as RunStartAcknowledgement['executionContext'],
  buildOrdinal: 0,
  startedAt: 0,
  testCount: 3,
}

function servicePorts(): RunServicePorts {
  return {
    verifyBearer: (header) => header === `Bearer ${TOKEN}`
      ? { kind: 'token', clientId: 'ci', trustScope: { project: 'acme' } }
      : { kind: 'refused', reason: header === undefined ? 'missing_authorization' : 'invalid_token' },
    invokeRunStart: async () => ACK,
    attach: attachPort,
    readiness: () => READINESS,
  }
}

function mockDb(): DashboardDatabase {
  return { getRuns: () => [] } as unknown as DashboardDatabase
}

const servers: Server[] = []
const closers: Array<() => void> = []

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

async function listen(handler: RequestHandler): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${String(address.port)}`
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    await new Promise<void>((closed) => server?.close(() => closed()))
  }
  while (closers.length > 0) closers.pop()?.()
})

interface Capture {
  readonly status: number
  readonly contentType: string | null
  readonly body: string
}

/** Read a whole response body. The planted feed ends at `runFinished`, so a stream terminates. */
async function read(url: string, headers: Record<string, string> = {}): Promise<Capture> {
  const response = await fetch(url, { headers })
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  }
}

const idsOf = (body: string): number[] =>
  [...body.matchAll(/^id: (\d+)$/gmu)].map((match) => Number(match[1]))
const datasOf = (body: string): string[] =>
  [...body.matchAll(/^data: (.+)$/gmu)].map((match) => match[1] ?? '')
const eventsOf = (body: string): string[] =>
  [...body.matchAll(/^event: (.+)$/gmu)].map((match) => match[1] ?? '')

/** Mount the LOCAL door on the exported router, with the attach port threaded in. */
async function localDoor(): Promise<string> {
  return listen(createRouter({ db: mockDb(), runServiceAttach: attachPort }))
}

/** Mount the AUTHED door on the same planted attach port. */
async function authedDoor(): Promise<string> {
  return listen(createRunServiceRoutes(servicePorts()))
}

/**
 * THE DIFFERENTIAL CORPUS — every request class the stream core decides, including the refusals.
 *
 * `[label, query]`, applied to run `r_local` unless the label says otherwise. A second spelling of
 * the stream in `routes.ts` would have to reproduce every one of these byte for byte.
 */
const CORPUS: readonly (readonly [string, string, string])[] = Object.freeze([
  ['the firehose', 'r_local', ''],
  ['handle 3', 'r_local', '?handle=3'],
  ['handle 7', 'r_local', '?handle=7'],
  ['handle 11', 'r_local', '?handle=11'],
  ['an unrelated parameter does not filter', 'r_local', '?since=7&format=json'],
  ['a malformed handle', 'r_local', '?handle=notanumber'],
  ['a zero-padded handle', 'r_local', '?handle=07'],
  ['a negative handle', 'r_local', '?handle=-1'],
  ['an empty handle', 'r_local', '?handle='],
  ['a REPEATED handle parameter', 'r_local', '?handle=1&handle=2'],
  ['a well-formed handle no member answers to', 'r_local', '?handle=4'],
  ['an unknown run', 'r_nope', ''],
  ['an unknown run WITH a handle', 'r_nope', '?handle=3'],
] as const)

describe('the local run-stream door serves the SAME stream core the authed door serves', () => {
  it.each(CORPUS)('%s answers byte-identically on both doors', async (_label, runId, query) => {
    const local = await localDoor()
    const authed = await authedDoor()

    const fromLocal = await read(`${local}/api/run-stream/${runId}${query}`)
    const fromAuthed = await read(`${authed}/run/${runId}/events${query}`, {
      Authorization: `Bearer ${TOKEN}`,
    })

    expect(fromLocal.status).toBe(fromAuthed.status)
    expect(fromLocal.contentType).toBe(fromAuthed.contentType)
    expect(fromLocal.body).toBe(fromAuthed.body)
  })

  it('the corpus is NOT vacuous — it spans streams and refusals, and the bodies are non-empty', async () => {
    // A differential over a corpus that produced one status, or empty bodies on both sides, would
    // be satisfied by two doors that both answered nothing. This cell is what stops that reading.
    const local = await localDoor()
    const captures = await Promise.all(
      CORPUS.map(async ([, runId, query]) => read(`${local}/api/run-stream/${runId}${query}`)),
    )
    expect(new Set(captures.map((capture) => capture.status))).toEqual(new Set([200, 400, 404]))
    expect(captures.every((capture) => capture.body.length > 0)).toBe(true)
    expect(captures.filter((capture) => capture.status === 200).length).toBeGreaterThanOrEqual(5)
  })
})

describe('the local door CALLS the exported core — one implementation, not two that agree', () => {
  it('reaches serveRunEventStream itself, with the raw handle and the injected attach port', async () => {
    const core = vi.mocked(serveRunEventStream)
    core.mockClear()

    const origin = await localDoor()
    const stream = await read(`${origin}/api/run-stream/r_local?handle=7`)
    expect(stream.status).toBe(200)

    expect(core).toHaveBeenCalledTimes(1)
    const deps = core.mock.calls[0]![2]
    expect(deps.runId).toBe('r_local')
    // The RAW parameter, unparsed — the core owns the parse, and a handler that pre-parsed it
    // would be the second spelling this cell exists to refuse.
    expect(deps.handleParam).toBe('7')
    // ONE SESSION REGISTRY, TWO DOORS — by reference, not by equality.
    expect(deps.attach).toBe(attachPort)
  })

  it('hands the PRODUCTION frame\'s local door the very port `runService.attach` carries', async () => {
    const core = vi.mocked(serveRunEventStream)
    core.mockClear()

    const db = new DashboardDatabase({ dbPath: ':memory:' })
    const ports = servicePorts()
    const started = await startServer({ db, port: 0, runService: ports })
    closers.push(started.close)
    const port = (started.server.address() as AddressInfo).port

    await getThroughServer(port, '/api/run-stream/r_local')

    expect(core).toHaveBeenCalledTimes(1)
    expect(core.mock.calls[0]![2].attach).toBe(ports.attach)
  })
})

describe('the local door serves the frozen envelope vocabulary (D-13)', () => {
  it('serves id=seq, event=type and data=the envelope, parseable under the schema', async () => {
    const origin = await localDoor()
    const stream = await read(`${origin}/api/run-stream/r_local`)

    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')
    expect(stream.body).toMatch(/^:ok\n\n/u)
    expect(idsOf(stream.body)).toEqual(FEED.map((envelope) => envelope.seq))
    expect(eventsOf(stream.body)).toEqual(FEED.map((envelope) => envelope.type))
    expect(datasOf(stream.body)).toEqual(FEED.map((envelope) => JSON.stringify(envelope)))
    // The framing claim is sharp only against gappy seqs: a stream-local counter emits 1..13 here.
    expect(idsOf(stream.body)).not.toEqual(FEED.map((_envelope, index) => index + 1))
    for (const data of datasOf(stream.body)) {
      expect(RunEventEnvelopeSchema.safeParse(JSON.parse(data)).success).toBe(true)
    }
  })

  it('requires no token on the local surface — it is the loopback API behind the bind guard', async () => {
    const origin = await localDoor()
    const stream = await read(`${origin}/api/run-stream/r_local`)
    expect(stream.status).toBe(200)
  })
})

describe('the local door applies the same handle filter (D-14)', () => {
  it.each([3, 7, 11] as const)('handle %i carries its OWN member events and every run-scoped one', async (handle) => {
    const origin = await localDoor()
    const stream = await read(`${origin}/api/run-stream/r_local?handle=${String(handle)}`)

    expect(idsOf(stream.body))
      .toEqual([...RUN_SCOPED_SEQS, ...MEMBER_SEQS[handle]!].sort((a, b) => a - b))
  })

  it('EXCLUDES every other member — the half an inclusion-only cell cannot see', async () => {
    const origin = await localDoor()
    const stream = await read(`${origin}/api/run-stream/r_local?handle=7`)
    const seqs = new Set(idsOf(stream.body))

    for (const foreign of [...MEMBER_SEQS[3]!, ...MEMBER_SEQS[11]!]) {
      expect(seqs.has(foreign), `seq ${String(foreign)} must not reach handle 7`).toBe(false)
    }
  })

  it('gives the three handles pairwise-disjoint, non-empty member sets', async () => {
    const origin = await localDoor()
    const captures = await Promise.all(
      ROSTER.map(async (handle) => idsOf((await read(`${origin}/api/run-stream/r_local?handle=${String(handle)}`)).body)),
    )
    const runScoped = new Set(RUN_SCOPED_SEQS)
    const memberSets = captures.map((seqs) => new Set(seqs.filter((seq) => !runScoped.has(seq))))
    for (let i = 0; i < memberSets.length; i += 1) {
      for (let j = i + 1; j < memberSets.length; j += 1) {
        expect([...memberSets[i]!].filter((seq) => memberSets[j]!.has(seq))).toEqual([])
      }
    }
    expect(memberSets.map((set) => set.size)).toEqual([3, 3, 3])
  })

  it.each([
    ['notanumber', 'invalid_handle'],
    ['07', 'invalid_handle'],
    ['-1', 'invalid_handle'],
    ['1.5', 'invalid_handle'],
    ['', 'invalid_handle'],
    ['4', 'unknown_handle'],
    ['0', 'unknown_handle'],
  ] as const)('refuses ?handle=%s with a typed 400 %s BEFORE any stream header', async (raw, code) => {
    const origin = await localDoor()
    const response = await fetch(`${origin}/api/run-stream/r_local?handle=${encodeURIComponent(raw)}`)

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-type')).not.toContain('text/event-stream')
    expect(await response.json()).toEqual({ error: code })
  })

  it('refuses a REPEATED handle parameter rather than silently answering the first', async () => {
    // `url.searchParams.get('handle')` would return "1" here. The authed door joins the values so
    // a request that says two different things is not a request that said the first one — and the
    // local door must not be the place that spelling drifts.
    const origin = await localDoor()
    const response = await fetch(`${origin}/api/run-stream/r_local?handle=1&handle=2`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_handle' })
  })

  it('refuses an unknown run with a typed 404 pre-stream', async () => {
    const origin = await localDoor()
    const response = await fetch(`${origin}/api/run-stream/r_nope`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'unknown_run' })
  })
})

/** GET through `node:http` so the whole shipped `startServer` frame is in the path. */
function getThroughServer(port: number, path: string): Promise<Capture> {
  return new Promise((resolve, reject) => {
    const request = httpGet({ host: '127.0.0.1', port, path }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => { body += chunk })
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        contentType: response.headers['content-type'] ?? null,
        body,
      }))
    })
    request.on('error', reject)
  })
}

describe('the PRODUCTION frame threads the attach port (server.ts, not the router alone)', () => {
  it('serves the local run-stream through the shipped startServer when the service is mounted', async () => {
    // A REAL database rather than the router cells' stub: this frame is the shipped one, and the
    // claim is about what `startServer` wires, so nothing in it should be a lookalike.
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    const started = await startServer({ db, port: 0, runService: servicePorts() })
    closers.push(started.close)
    const port = (started.server.address() as AddressInfo).port

    const stream = await getThroughServer(port, '/api/run-stream/r_local?handle=7')
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')
    expect(idsOf(stream.body))
      .toEqual([...RUN_SCOPED_SEQS, ...MEMBER_SEQS[7]!].sort((a, b) => a - b))
  })

  it('answers 503 BY NAME with no run service mounted — never a fabricated stream or a 404', async () => {
    const db = new DashboardDatabase({ dbPath: ':memory:' })
    const started = await startServer({ db, port: 0 })
    closers.push(started.close)
    const port = (started.server.address() as AddressInfo).port

    const answer = await getThroughServer(port, '/api/run-stream/r_local')
    expect(answer.status).toBe(503)
    expect(answer.contentType).toContain('application/json')
    expect(answer.body).not.toContain('text/event-stream')
    expect(JSON.parse(answer.body)).toMatchObject({ error: expect.stringContaining('run service') })
  })
})

/**
 * ---- THE SOURCE CELL, WITH ITS KNOWN-POSITIVE CONTROL ----------------------------------------
 *
 * The extractor brace-matches the handler block containing a given needle out of `routes.ts`. The
 * predicate then asks whether SSE frame formatting appears inside that block. Run over the local
 * run-stream handler the answer must be NO — and the SAME extractor and SAME predicate are run
 * over the legacy `/api/execution/events` handler, where the answer must be YES, because an
 * extractor that returned nothing (or a predicate that could not see frame formatting) would
 * satisfy the first assertion for free (WINDOWS #253).
 */
const FRAME_FORMATTING: readonly (readonly [string, RegExp])[] = Object.freeze([
  ['the event-stream content type', /text\/event-stream/u],
  ['an id frame', /id: \$\{/u],
  ['an event frame', /event: \$\{/u],
  ['the stream preamble', /:ok\\n\\n/u],
  ['a heartbeat timer', /setInterval/u],
] as const)

function handlerBlockAt(source: string, needle: string): string {
  const at = source.indexOf(needle)
  if (at < 0) throw new Error(`routes.ts has no handler mentioning ${needle}`)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  throw new Error(`unbalanced handler block for ${needle}`)
}

describe('routes.ts delegates the stream rather than re-spelling it', () => {
  it('has NO frame formatting in the run-stream handler, and the control proves the predicate sees it elsewhere', async () => {
    const source = await readFile(new URL('../server/routes.ts', import.meta.url), 'utf8')

    const control = handlerBlockAt(source, "path === '/api/execution/events'")
    const matchedInControl = FRAME_FORMATTING.filter(([, pattern]) => pattern.test(control))
    // THE CONTROL FIRST. If this fails the cell below means nothing at all.
    expect(control.length).toBeGreaterThan(200)
    expect(matchedInControl.map(([name]) => name)).toEqual(FRAME_FORMATTING.map(([name]) => name))

    const local = handlerBlockAt(source, "'/api/run-stream/'")
    expect(local.length).toBeGreaterThan(50)
    for (const [name, pattern] of FRAME_FORMATTING) {
      expect(pattern.test(local), `the run-stream handler must not carry ${name}`).toBe(false)
    }
    // …and what it does instead: it calls the one exported core.
    expect(local).toContain('serveRunEventStream(')
  })

  it('imports the stream core and the handle-parameter reader from the run-service module', async () => {
    const source = await readFile(new URL('../server/routes.ts', import.meta.url), 'utf8')
    const body = source.split('\n').filter((line) => !line.trimStart().startsWith('//')).join('\n')

    expect(body).toMatch(/import\s*\{[^}]*serveRunEventStream[^}]*\}\s*from\s*'\.\.\/run-service\/run-service-routes\.js'/su)
    // The repeated-parameter join is the core's, not a second reading of the query here.
    expect(body).not.toMatch(/searchParams\.get\('handle'\)/u)
  })
})
