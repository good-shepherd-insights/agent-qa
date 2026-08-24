// The authed run service, DRIVEN END TO END (Phase 402 plan 01, D-02/D-05/D-06/D-13 · INVK-03).
//
// THE FRAME, STATED: every cell below drives the PRODUCTION COMPOSITION over real TCP. The server
// is `startServer` — the same function `agent-qa dashboard` calls, not a router mounted on a bare
// `createServer` — with `runService` supplied by `composeRunServicePorts`, the same composer the
// command calls, over a host from `composeDashboardDoor` and a run door from
// `createDashboardRunDoor`. Nothing here is replaced and nothing is re-assembled: what a cell
// changes is the config file's contents and the port number, which is what a person changes.
//
// WHY THAT MATTERS ENOUGH TO SAY OUT LOUD. The conformance dashboard adapter one directory over
// mounts `createChatRouter(host)` on a bare `createServer` — correct for what it measures, and
// exactly the shape that lets a process-level truth be proven on a router. The run service's
// claims are process-level: the mount arm, the ordering against the host's wildcard `OPTIONS`
// preflight and its SPA fallback, and the verdict standing between a socket and a run. A cell that
// mounted `createRunServiceRoutes` directly would measure none of those.
//
// THE RUN FAILS, AND THAT IS FINE. The planted test names a target the registry does not declare,
// so no browser is launched and the run fails fast. The claim of this file is DELIVERY AND
// FRAMING — an ack off the durable record, envelopes on the wire in the frozen shape — not that a
// run passes. A cell that needed a passing run would need a browser, and would be measuring
// Playwright.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  RunEventEnvelopeSchema,
  RunServiceErrorBodySchema,
  RunStartAcknowledgementSchema,
} from '@vostride/agent-qa-schema'
import { generateTestId } from '@vostride/agent-qa-ids'
import { afterEach, describe, expect, it } from 'vitest'

import {
  composeDashboardDoor,
  composeRunServicePorts,
  createDashboardRunDoor,
} from '../commands/dashboard.js'

/**
 * The credential this suite declares and presents.
 *
 * NO SUFFIX A MASKER RECOGNISES, deliberately: `sensitiveEnvSlice` selects environment variables
 * by NAME SUFFIX, so a probe called `PROBE_API_TOKEN` would be masked by machinery that has
 * nothing to do with this door and a leak would pass for the wrong reason.
 */
const TOKEN = 'zz-402-01-e2e-run-credential-6d20af'
const TOKEN_VAR = 'AGENT_QA_402_E2E_RUN_CRED'

/** The `dashboard-door-security.ts` fixture project's shape, plus one planted test. */
function fixtureWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-402-01-'))
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
          // `environment: 'local'` is what makes this run DECIDABLE without a person: the run
          // gate folds the most restrictive declared target class, and only an invocation whose
          // every target is declared local is decided `mutating-local` — the tier ratified as
          // allowed in every execution context. An undeclared or shared target would classify the
          // run `mutating-shared`, which in the remote door's fail-closed `local-headless` context
          // is a DENIAL, and a denied run never starts, never acks and never streams. That is a
          // real and correct behavior of the product; it is 402-06's cell to measure, not this
          // file's, because a tracer that could only observe a denial would observe no delivery.
          conformance: {
            platform: 'web',
            url: 'https://conformance.invalid',
            environment: 'local',
          },
        },
      },
      services: {
        dashboard: {
          runServiceTokens: [
            { name: 'ci', tokenEnvVar: TOKEN_VAR, trustScope: { project: 'acme' } },
          ],
        },
      },
    })}\n`,
    'utf8',
  )
  // The workspace files the run path REQUIRES to exist, empty. `loadRuntimeSecrets` refuses a
  // missing secrets file by name rather than treating absence as "no secrets", so a fixture
  // without them measures that refusal instead of this door.
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(
    join(root, 'tests', 'probe.test.yaml'),
    'name: The run service tracer probe\n'
    // MINTED, never hand-written: canonical ids come from the ID helpers by house rule, and a
    // literal here would be an id this repository does not own.
    + `test-id: ${generateTestId()}\n`
    + 'target: conformance\n'
    + 'steps:\n'
    + '  - Do nothing this run will ever reach\n',
    'utf8',
  )
  return configPath
}

interface ServiceFixture {
  readonly origin: string
  readonly close: () => Promise<void>
}

const openFixtures: ServiceFixture[] = []

/** The composition `agent-qa dashboard` performs, with an ephemeral port and a temp project. */
async function openRunService(options: {
  readonly declareToken?: boolean
} = {}): Promise<ServiceFixture> {
  const configPath = fixtureWorkspace()
  const configDir = dirname(resolve(configPath))
  const { DashboardDatabase, startServer } = await import('@vostride/agent-qa-dashboard')
  const db = new DashboardDatabase({ dbPath: join(configDir, 'dashboard.db') })
  const runDoor = await createDashboardRunDoor({ db })
  let boundOrigin: string | undefined
  const { agentHost, host, enterRunTriggerScope } = composeDashboardDoor({
    agentQaRoot: join(configDir, '.agent-qa'),
    configPath,
    boundOrigin: () => boundOrigin,
    runBridge: runDoor.runBridge,
  })
  runDoor.bindHost(host)
  runDoor.bindTriggerScope(enterRunTriggerScope)

  const runService = composeRunServicePorts({
    entries: options.declareToken === false
      ? []
      : [{ name: 'ci', tokenEnvVar: TOKEN_VAR, trustScope: { project: 'acme' } }],
    env: { [TOKEN_VAR]: TOKEN },
    door: runDoor,
  })

  const started = await startServer({
    db,
    port: 0,
    configPath,
    agentHost,
    executionBackend: runDoor.backend,
    runService: runService.ports,
  })
  const server = started.server as Server
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new TypeError('the run service bound no port')
  }
  boundOrigin = `http://127.0.0.1:${String(address.port)}`

  const fixture: ServiceFixture = {
    origin: boundOrigin,
    close: async () => {
      started.close()
      runService.dispose()
      await host.close()
      rmSync(configDir, { recursive: true, force: true })
    },
  }
  openFixtures.push(fixture)
  return fixture
}

afterEach(async () => {
  while (openFixtures.length > 0) {
    await openFixtures.pop()?.close().catch(() => undefined)
  }
})

/** Read an SSE stream until `runFinished` or the budget expires. Returns the raw frames. */
async function collectSse(url: string, headers: Record<string, string>, budgetMs = 60_000): Promise<{
  readonly status: number
  readonly frames: readonly string[]
  readonly contentType: string | null
  readonly corsHeader: string | null
}> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, budgetMs)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    const contentType = response.headers.get('content-type')
    const corsHeader = response.headers.get('access-control-allow-origin')
    if (response.body === null || !(contentType ?? '').includes('text/event-stream')) {
      return { status: response.status, frames: [], contentType, corsHeader }
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const frames: string[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        frames.push(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
      if (frames.some((frame) => frame.includes('event: runFinished'))) break
    }
    await reader.cancel().catch(() => undefined)
    return { status: response.status, frames, contentType, corsHeader }
  } finally {
    clearTimeout(timer)
  }
}

/** Parse one SSE frame's `id:`, `event:` and `data:` lines. Comment frames yield nothing. */
function parseFrame(frame: string): { id?: string; event?: string; data?: string } {
  const out: { id?: string; event?: string; data?: string } = {}
  for (const line of frame.split('\n')) {
    if (line.startsWith('id: ')) out.id = line.slice(4)
    else if (line.startsWith('event: ')) out.event = line.slice(7)
    else if (line.startsWith('data: ')) out.data = line.slice(6)
  }
  return out
}

const authed = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

describe('leg (a) — POST /run with no Authorization header', () => {
  it('is refused 401 with the typed body, and starts nothing', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(401)
    const body = RunServiceErrorBodySchema.parse(await response.json())
    expect(body).toEqual({ error: 'missing_authorization' })
    // The refusal carries NOTHING else: no run id, no hint that any credential is declared.
    expect(Object.keys(body)).toEqual(['error'])
    // No cross-origin grant on an authed surface — the chat door's adjudication, not the legacy
    // run stream's wildcard.
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses an OPTIONS preflight too, so the host wildcard arm never sees a service path', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run`, { method: 'OPTIONS' })
    expect(response.status).toBe(401)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('leg (b) — POST /run with a wrong token', () => {
  it('is refused 401, shape-identical to the missing-token refusal beyond the reason', async () => {
    const service = await openRunService()
    const wrong = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}-wrong`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(wrong.status).toBe(401)
    const wrongBody = RunServiceErrorBodySchema.parse(await wrong.json())
    expect(wrongBody).toEqual({ error: 'invalid_token' })

    const missing = await fetch(`${service.origin}/run`, { method: 'POST', body: '{}' })
    const missingBody = RunServiceErrorBodySchema.parse(await missing.json())
    // The KEY SETS are identical: an unauthenticated prober learns the reason word and no more.
    expect(Object.keys(wrongBody)).toEqual(Object.keys(missingBody))
  })

  it('refuses a malformed scheme distinctly from a wrong value', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: { Authorization: 'Basic abc' },
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'malformed_authorization' })
  })

  it('refuses an unknown path under the door identically, leaking no route map', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run/nope/nothing`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'missing_authorization' })
  })
})

describe('the request may not name the terms of its own authorization', () => {
  it('refuses a body carrying executionContext with a typed 400', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ executionContext: 'local-interactive' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'refused_request_field' })
  })

  it('refuses runId and scope the same way', async () => {
    const service = await openRunService()
    for (const body of [{ runId: 'r_whatever' }, { scope: 'main' }]) {
      const response = await fetch(`${service.origin}/run`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'refused_request_field' })
    }
  })

  it('refuses an unrecognised key, because the request shape is strict', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ workers: 8 }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request_body' })
  })
})

describe('legs (c) and (d) — the authed path, end to end', () => {
  it('acks a run and streams its bus envelopes verbatim', async () => {
    const service = await openRunService()

    // (c) THE ACK. Every field off the durable record — parsed here rather than cast, so a
    // fabricated ack reds this cell rather than passing through it.
    const started = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ patterns: ['tests/probe.test.yaml'] }),
    })
    expect(started.status).toBe(202)
    const ack = RunStartAcknowledgementSchema.parse(await started.json())
    expect(ack.runId).toBeTruthy()
    expect(ack.testCount).toBeGreaterThan(0)

    // (d) THE STREAM. The run may already be over; `subscribe(1, …)` replays from the first seq,
    // so the frames are the whole log either way.
    const stream = await collectSse(
      `${service.origin}/run/${encodeURIComponent(ack.runId)}/events`,
      { Authorization: `Bearer ${TOKEN}` },
    )
    expect(stream.status).toBe(200)
    expect(stream.contentType).toContain('text/event-stream')
    expect(stream.corsHeader).toBeNull()

    const events = stream.frames.map(parseFrame).filter((frame) => frame.data !== undefined)
    expect(events.length).toBeGreaterThan(0)

    for (const frame of events) {
      const envelope = RunEventEnvelopeSchema.parse(JSON.parse(frame.data!))
      // D-13's three halves, per frame. WHAT THIS LEG ACTUALLY DECIDES, stated honestly: that
      // envelopes were delivered, that each `data` line parses under the frozen envelope schema,
      // and that every frame belongs to the run that was acked. The `id === seq` equality is NOT
      // discriminating here and a mutation measured it: a real run's seqs are 1, 2, 3 … from 1, so
      // a router framing a stream-local counter emits byte-identical output and this stays green.
      // The claim with teeth needs a stream whose seqs are neither contiguous nor 1-based, which
      // needs a chosen bus — it lives in
      // `packages/dashboard-server/src/run-service/__tests__/run-service-routes.test.ts`.
      expect(frame.id).toBe(String(envelope.seq))
      expect(frame.event).toBe(envelope.type)
      expect(envelope.runId).toBe(ack.runId)
    }

    // The seqs are the bus's own gap-free order, in order.
    const seqs = events.map((frame) =>
      (JSON.parse(frame.data!) as { seq: number }).seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)

    // The run reached its terminal event, which is what makes the framing claim about a whole run
    // rather than about a prefix somebody happened to catch.
    expect(events.some((frame) => frame.event === 'runFinished')).toBe(true)
  }, 90_000)

  it('refuses a stream for a run this process never started, BEFORE any stream header', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run/r_never-started/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ error: 'unknown_run' })
  })

  it('refuses the stream without a token, before it can learn whether the run exists', async () => {
    const service = await openRunService()
    const response = await fetch(`${service.origin}/run/r_never-started/events`)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'missing_authorization' })
  })
})

describe('a door with no declared credential is a door nobody can open', () => {
  it('refuses even the declared value when the entry list is empty', async () => {
    const service = await openRunService({ declareToken: false })
    const response = await fetch(`${service.origin}/run`, {
      method: 'POST',
      headers: authed,
      body: '{}',
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_token' })
  })
})
