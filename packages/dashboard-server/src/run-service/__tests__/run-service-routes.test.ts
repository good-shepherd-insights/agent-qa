// The run service router's FRAMING and REFUSAL mechanics (Phase 402 plan 01, D-06/D-13 · INVK-03).
//
// THE FRAME, STATED, AND ITS LIMIT. These cells mount `createRunServiceRoutes` on a bare
// `createServer` with FAKE ports. That is deliberately NOT the production composition — the
// process-level claims (the mount arm, the ordering against the host's wildcard `OPTIONS`
// preflight and its SPA fallback, a real run's envelopes on a real socket) belong to
// `packages/cli/src/__tests__/run-service-door.e2e.test.ts`, which drives `startServer` itself and
// would be the wrong place to make the claims below.
//
// WHY THESE CELLS EXIST AT ALL, GIVEN THAT E2E. Measured, not assumed: the e2e's "SSE `id` equals
// the envelope `seq`" assertion is VACUOUS on a real run, and a mutation proved it — a real run's
// seqs are 1, 2, 3 … from 1, so a router that framed a local counter instead of the seq produces
// byte-identical output and the e2e stays green. The claim only has teeth against a stream whose
// seqs are neither contiguous nor 1-based, and choosing the seqs requires a fake bus. That is the
// whole reason for the fake here: not to avoid the cost of a real run, but to reach a claim a real
// run cannot state.

import { createServer, type Server } from 'node:http'

import {
  RUN_SERVICE_CONTRACT_VERSION,
  RunServiceReadinessSchema,
  type RunEventEnvelope,
  type RunSession,
  type RunStartAcknowledgement,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RUN_SERVICE_ROUTE_TABLE,
  createRunServiceRoutes,
  type RunServicePorts,
} from '../run-service-routes.js'

const TOKEN = 'zz-402-01-unit-token-31c9de'

/**
 * A session whose seqs are CHOSEN — non-contiguous and not starting at 1.
 *
 * 7, 11, 12 rather than 1, 2, 3: a router framing `++counter` would emit 1, 2, 3 and a router
 * framing the envelope's own `seq` emits 7, 11, 12. Contiguous 1-based seqs make the two
 * indistinguishable, which is exactly the coincidence that made the end-to-end assertion vacuous.
 */
const PLANTED_ENVELOPES: readonly RunEventEnvelope[] = Object.freeze([
  { seq: 7, ts: 1, runId: 'r_planted', type: 'runStarted', payload: { a: 1 } },
  { seq: 11, ts: 2, runId: 'r_planted', type: 'verdict', payload: { verdict: 'failed' } },
  { seq: 12, ts: 3, runId: 'r_planted', type: 'runFinished', payload: { aggregateVerdict: 'failed' } },
] as unknown as readonly RunEventEnvelope[])

function plantedSession(options: { readonly throwOnSubscribe?: boolean } = {}): RunSession {
  return {
    id: 'r_planted' as RunSession['id'],
    status: 'running',
    executionContext: 'local-headless' as RunSession['executionContext'],
    subscribe(fromSeq, handler) {
      if (options.throwOnSubscribe === true) {
        throw new Error(`ReplayIncomplete: events before seq 1 are no longer available (${fromSeq})`)
      }
      for (const envelope of PLANTED_ENVELOPES) handler(envelope)
      return () => undefined
    },
    cancel() { /* nothing to cancel on a planted session */ },
    done: Promise.resolve({ verdict: 'failed' } as never),
  }
}

const ACK: RunStartAcknowledgement = {
  runId: 'r_planted' as RunStartAcknowledgement['runId'],
  scope: 'main' as unknown as RunStartAcknowledgement['scope'],
  executionContext: 'local-headless' as RunStartAcknowledgement['executionContext'],
  buildOrdinal: 0,
  startedAt: 0,
  testCount: 1,
}

function fakePorts(overrides: Partial<RunServicePorts> = {}): RunServicePorts {
  return {
    verifyBearer: (header) => header === `Bearer ${TOKEN}`
      ? { kind: 'token', clientId: 'ci', trustScope: { project: 'acme' } }
      : { kind: 'refused', reason: header === undefined ? 'missing_authorization' : 'invalid_token' },
    invokeRunStart: async () => ACK,
    attach: (runId) => runId === 'r_planted' ? plantedSession() : undefined,
    readiness: () => ({
      service: 'up',
      hostComposed: true,
      authConfigured: true,
      contractVersion: RUN_SERVICE_CONTRACT_VERSION,
    }),
    ...overrides,
  }
}

const servers: Server[] = []

async function mount(ports: RunServicePorts = fakePorts()): Promise<string> {
  const server = createServer(createRunServiceRoutes(ports))
  servers.push(server)
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new TypeError('no port')
  return `http://127.0.0.1:${String(address.port)}`
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()
    await new Promise<void>((closed) => server?.close(() => closed()))
  }
})

/** Read the whole SSE body — the planted stream ends at `runFinished`, so this terminates. */
async function readStream(url: string, headers: Record<string, string>): Promise<{
  readonly status: number
  readonly contentType: string | null
  readonly body: string
}> {
  const response = await fetch(url, { headers })
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  }
}

describe('D-13 — the wire IS the bus envelope', () => {
  it('frames the envelope SEQ as the SSE id, not a stream-local counter', async () => {
    const origin = await mount()
    const stream = await readStream(
      `${origin}/run/r_planted/events`,
      { Authorization: `Bearer ${TOKEN}` },
    )
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')

    const ids = [...stream.body.matchAll(/^id: (\d+)$/gmu)].map((match) => Number(match[1]))
    // THE DISCRIMINATING ASSERTION. A counter emits 1, 2, 3; the envelope's own seq emits these.
    expect(ids).toEqual([7, 11, 12])
    expect(ids).not.toEqual([1, 2, 3])
  })

  it('frames the envelope TYPE as the SSE event name', async () => {
    const origin = await mount()
    const stream = await readStream(
      `${origin}/run/r_planted/events`,
      { Authorization: `Bearer ${TOKEN}` },
    )
    const events = [...stream.body.matchAll(/^event: (.+)$/gmu)].map((match) => match[1])
    expect(events).toEqual(['runStarted', 'verdict', 'runFinished'])
  })

  it('serves each envelope VERBATIM — no projection, no rename, no added field', async () => {
    const origin = await mount()
    const stream = await readStream(
      `${origin}/run/r_planted/events`,
      { Authorization: `Bearer ${TOKEN}` },
    )
    const datas = [...stream.body.matchAll(/^data: (.+)$/gmu)].map((match) => match[1]!)
    // Byte equality against the envelope's own serialisation. A second event vocabulary — a
    // renamed field, a dropped one, an added `handle` — reds here whatever it is called.
    expect(datas).toEqual(PLANTED_ENVELOPES.map((envelope) => JSON.stringify(envelope)))
  })

  it('opens with the `:ok` preamble and writes no cross-origin grant', async () => {
    const origin = await mount()
    const response = await fetch(`${origin}/run/r_planted/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(await response.text()).toMatch(/^:ok\n\n/u)
  })
})

describe('the stream head is never written before the answer is settled', () => {
  it('answers a typed JSON 404 for an unknown run', async () => {
    const origin = await mount()
    const response = await fetch(`${origin}/run/r_absent/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'unknown_run' })
  })

  it('answers a typed JSON 500 when the replay cannot be served', async () => {
    // `subscribe` THROWS (`ReplayIncompleteError` is the real one). A router that had already
    // written `200 text/event-stream` could only hang up; this one has not, so it can say so.
    const origin = await mount(fakePorts({
      attach: () => plantedSession({ throwOnSubscribe: true }),
    }))
    const response = await fetch(`${origin}/run/r_planted/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'replay_unavailable' })
  })
})

describe('the verdict stands above the route table', () => {
  it('refuses every declared route and an undeclared one identically', async () => {
    const origin = await mount()
    const probes = [
      { method: 'POST', path: '/run' },
      { method: 'GET', path: '/run/r_planted/events' },
      { method: 'GET', path: '/run/anything/else' },
      { method: 'DELETE', path: '/run' },
    ]
    for (const probe of probes) {
      const response = await fetch(`${origin}${probe.path}`, { method: probe.method })
      expect(response.status, `${probe.method} ${probe.path}`).toBe(401)
      expect(await response.json()).toEqual({ error: 'missing_authorization' })
    }
  })

  it('never consults the run starter for a refused request', async () => {
    let started = 0
    const origin = await mount(fakePorts({
      invokeRunStart: async () => { started += 1; return ACK },
    }))
    await fetch(`${origin}/run`, { method: 'POST', body: '{}' })
    await fetch(`${origin}/run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: '{}',
    })
    expect(started).toBe(0)
  })
})

// ---- Task 2: `/ok` — authed, shallow-but-honest readiness (D-15) -----------------------------

describe('GET /ok is a service route like every other one', () => {
  it('refuses a request with no token', async () => {
    const origin = await mount()
    const response = await fetch(`${origin}/ok`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'missing_authorization' })
  })

  it('refuses a wrong token with a body shape-identical to the missing-token refusal', async () => {
    const origin = await mount()
    const wrong = await fetch(`${origin}/ok`, { headers: { Authorization: 'Bearer nope' } })
    expect(wrong.status).toBe(401)
    const wrongBody = await wrong.json() as Record<string, unknown>
    const missingBody = await (await fetch(`${origin}/ok`)).json() as Record<string, unknown>
    // Beyond the reason word, nothing differs — no entry count, no hint of how auth is configured.
    expect(Object.keys(wrongBody)).toEqual(Object.keys(missingBody))
    expect(wrongBody).toEqual({ error: 'invalid_token' })
  })

  it('reports MEASURED facts and the contract version to a valid token', async () => {
    const origin = await mount()
    const response = await fetch(`${origin}/ok`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = RunServiceReadinessSchema.parse(await response.json())
    expect(body).toEqual({
      service: 'up',
      hostComposed: true,
      authConfigured: true,
      contractVersion: RUN_SERVICE_CONTRACT_VERSION,
    })
    // It never claims a run will succeed: there is no `ready`, no verdict prediction, and no
    // knowledge/embedder rung — those are 407's `doctor`.
    expect(Object.keys(body).sort()).toEqual(
      ['authConfigured', 'contractVersion', 'hostComposed', 'service'],
    )
  })

  it('reports an UNCOMPOSED host honestly rather than refusing', async () => {
    const origin = await mount(fakePorts({
      readiness: () => ({
        service: 'up',
        hostComposed: false,
        authConfigured: true,
        contractVersion: RUN_SERVICE_CONTRACT_VERSION,
      }),
    }))
    const response = await fetch(`${origin}/ok`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(200)
    expect((await response.json() as { hostComposed: boolean }).hostComposed).toBe(false)
  })
})

describe('the refusal-shape census walks the module\'s OWN route table', () => {
  /**
   * Every row, driven — and the ENUMERATION is the point.
   *
   * The corpus is read off `RUN_SERVICE_ROUTE_TABLE` rather than written out here, so a route
   * added tomorrow is covered the day it lands and cannot escape this cell by nobody noticing it.
   * A hardcoded list of three paths would be a claim about three paths.
   */
  const probePathFor = (row: { readonly path: string }): string =>
    row.path.replace(':runId', 'r_planted')

  it('covers every declared route, and the table is not empty', async () => {
    // Non-vacuity first: a census over an empty table passes by finding nothing to drive.
    expect(RUN_SERVICE_ROUTE_TABLE.length).toBeGreaterThanOrEqual(3)
    const handlers = RUN_SERVICE_ROUTE_TABLE.map((row) => row.handler).sort()
    expect(handlers).toEqual(['events', 'ok', 'start'])
  })

  it('refuses a MISSING token on every row with one body shape', async () => {
    const origin = await mount()
    const bodies: Record<string, unknown>[] = []
    for (const row of RUN_SERVICE_ROUTE_TABLE) {
      const response = await fetch(`${origin}${probePathFor(row)}`, { method: row.method })
      expect(response.status, `${row.method} ${row.path}`).toBe(401)
      bodies.push(await response.json() as Record<string, unknown>)
    }
    for (const body of bodies) {
      expect(body).toEqual({ error: 'missing_authorization' })
    }
  })

  it('refuses an INVALID token on every row with the same body shape', async () => {
    const origin = await mount()
    for (const row of RUN_SERVICE_ROUTE_TABLE) {
      const response = await fetch(`${origin}${probePathFor(row)}`, {
        method: row.method,
        headers: { Authorization: 'Bearer definitely-not-the-token' },
      })
      expect(response.status, `${row.method} ${row.path}`).toBe(401)
      const body = await response.json() as Record<string, unknown>
      expect(Object.keys(body), `${row.method} ${row.path}`).toEqual(['error'])
      expect(body).toEqual({ error: 'invalid_token' })
    }
  })
})
