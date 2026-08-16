// THE ZERO-NETWORK WALL (Phase 398 plan 06 task 1, D-19 · ANLY-01).
//
// WHY THIS FILE IS A DIFFERENTIAL AND NOT AN ASSERTION. "Opted out sends nothing" is trivially
// satisfiable by an implementation that sends nothing ever, and it is trivially satisfiable by a
// test whose interception is not wired to the thing under test. Both failures LOOK like the proof.
// So every wall here is measured on BOTH arms with the SAME instrument: opted out must observe
// zero, opted in must observe more than zero, and the pair being equal is a FATAL that names the
// torn wire rather than a green run.
//
// WHERE THE ASSERTIONS SIT. Not on `NoopTransport.captureCount` — a broken port that never calls
// its transport satisfies that on both arms. Two network layers instead:
//
//   1. The undici global dispatcher. posthog-node 5.33.2 sends through global `fetch`
//      (`dist/client.js:185` — `this.options.fetch ? this.options.fetch(...) : fetch(...)`), and
//      Node's global fetch is undici-backed, so a `MockAgent` on the global dispatcher observes the
//      SHIPPED send path. RESEARCH A2 is why `vitest.config.ts` pins `environment: 'node'`: under
//      happy-dom that interception silently stops working, and a cell that observes zero because
//      nothing was ever intercepted is indistinguishable from the wall holding.
//   2. `net.Socket.prototype.connect`, against a REAL local HTTP server. The dispatcher cell only
//      covers transports that go through fetch. The socket cell covers every transport there is,
//      including one someone adds later, and it has no blind spot for a request aimed at a
//      different origin than the one configured.
//
// The socket arm deliberately talks to `127.0.0.1` and nothing else: a wall test that needs the
// internet to prove itself is a wall test that fails in CI for reasons unrelated to the wall.

import { createServer, type Server } from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeAnalytics } from '../compose.js'
import { AgentQaAnalyticsEventSchema, ANALYTICS_MCP_TOOL_NAMES } from '../events.js'
import { createPosthogTransport } from '../transports.js'
import type { ComposeAnalyticsOptions } from '../compose.js'
import type { AgentQaAnalyticsEvent } from '../events.js'

const PROJECT_KEY = 'phc_zero_network_differential'
const MOCK_ORIGIN = 'http://analytics.differential.test'

/**
 * The events the arms drive, PRODUCED through the shipped schema rather than written as literals.
 *
 * `.parse` is what makes them real members: a fixture that only type-checks can describe an event
 * the union would refuse, and a wall proven on an unsendable event is a wall proven on nothing.
 */
function realUnionEvents(): AgentQaAnalyticsEvent[] {
  return [
    AgentQaAnalyticsEventSchema.parse({
      name: 'agent-qa.test_run.completed',
      properties: {
        surface: 'cli',
        runtime_context: 'user',
        status: 'passed',
        run_id: generateRunId(),
        test_id: generateTestId(),
        duration_ms: 1234,
        step_count: 3,
        passed_step_count: 3,
      },
    }),
    AgentQaAnalyticsEventSchema.parse({
      name: 'agent-qa.mcp.tool.invoked',
      properties: {
        surface: 'mcp',
        tool_name: ANALYTICS_MCP_TOOL_NAMES[0],
        mcp_tool_status: 'success',
        mcp_transport: 'stdio',
        duration_ms: 12,
      },
    }),
    AgentQaAnalyticsEventSchema.parse({
      name: 'agent-qa.explain.abstained',
      properties: {
        surface: 'chat',
        suggested_row_count: 2,
        catalog_empty: false,
      },
    }),
  ]
}

/**
 * A FULL emit-and-flush cycle through the shipped port — every event, then `flush`, then
 * `shutdown`.
 *
 * `shutdown` is included because it is a second send opportunity: the PostHog client drains its
 * queue there too, so a wall that only holds until the process decides to exit is not a wall.
 */
async function driveEmitAndFlush(options: ComposeAnalyticsOptions): Promise<void> {
  const composed = composeAnalytics<AgentQaAnalyticsEvent>(options)
  for (const event of realUnionEvents()) composed.port.capture(event)
  await composed.port.flush()
  await composed.port.shutdown()
}

/**
 * The torn-wire check, and the reason both arms exist.
 *
 * A guard that answers identically on both sides proves nothing about the guard — it proves the
 * instrument is dead. Two zeroes is therefore louder than a failed expectation: it is an error
 * naming the interception, because the natural reading of "opted-out observed zero" is that the
 * wall held.
 */
function assertTwoSidedOrFatal(label: string, optedOut: number, optedIn: number): void {
  if (optedOut === 0 && optedIn === 0) {
    throw new Error(
      `TORN WIRE (${label}): BOTH arms observed zero attempts. The opted-in arm is supposed to `
      + `send — a zero there means the interception is not attached to the shipped send path, so `
      + `the opted-out arm's zero measures the instrument rather than the wall. Fix the `
      + `interception before reading anything into the opt-out result.`,
    )
  }
  expect(optedOut, `${label}: DO_NOT_TRACK=1 must produce ZERO attempts`).toBe(0)
  expect(optedIn, `${label}: DNT unset must produce attempts (else the wire is torn)`)
    .toBeGreaterThan(0)
}

describe('zero-network under DO_NOT_TRACK (D-19)', () => {
  let originalDispatcher: Dispatcher

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher()
  })

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher)
    vi.restoreAllMocks()
  })

  // RESEARCH A2 pinned as a cell rather than as a comment on `vitest.config.ts`. If someone
  // switches this package to a DOM-ish environment, the dispatcher cells below would start passing
  // for the wrong reason; this fails first and says why.
  it('runs in the plain node environment — MockAgent interception depends on it (RESEARCH A2)', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined')
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined')
    expect(typeof process.versions.node).toBe('string')
  })

  // -------------------------------------------------------------------------------------------
  // Wall 1: the undici global dispatcher — the layer the shipped PostHog client actually sends on
  // -------------------------------------------------------------------------------------------

  describe('fetch layer (undici global dispatcher)', () => {
    interface DispatcherArm {
      dispatcherHits: number
      socketConnects: number
    }

    async function runArm(env: Record<string, string | undefined>): Promise<DispatcherArm> {
      const agent = new MockAgent()
      agent.disableNetConnect()

      let dispatcherHits = 0
      // A catch-all path on the configured origin, not `/batch/`: pinning the path would make a
      // request to any OTHER path invisible (it would be refused by `disableNetConnect` and
      // silently swallowed), and "invisible" reads as zero.
      agent
        .get(MOCK_ORIGIN)
        .intercept({ path: /.*/u, method: 'POST' })
        .reply(200, () => {
          dispatcherHits += 1
          return { status: 1 }
        })
        .persist()
      setGlobalDispatcher(agent)

      const socketSpy = vi.spyOn(net.Socket.prototype, 'connect')
      try {
        await driveEmitAndFlush({
          env,
          projectKey: PROJECT_KEY,
          projectHost: MOCK_ORIGIN,
        })
        return { dispatcherHits, socketConnects: socketSpy.mock.calls.length }
      } finally {
        socketSpy.mockRestore()
        await agent.close()
      }
    }

    it('DO_NOT_TRACK=1 produces zero dispatches and zero sockets; DNT unset produces dispatches', async () => {
      const optedOut = await runArm({ DO_NOT_TRACK: '1' })
      const optedIn = await runArm({})

      assertTwoSidedOrFatal('fetch layer', optedOut.dispatcherHits, optedIn.dispatcherHits)
      // The opted-out arm also touched no socket, so the zero above is not "it went somewhere the
      // interceptor could not see".
      expect(optedOut.socketConnects).toBe(0)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Wall 2: the socket — transport-agnostic, against a real listening server
  // -------------------------------------------------------------------------------------------

  describe('socket layer (net.Socket.prototype.connect, real local server)', () => {
    let server: Server
    let origin: string
    let requestCount: number

    beforeEach(async () => {
      requestCount = 0
      server = createServer((req, res) => {
        requestCount += 1
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ status: 1 }))
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    interface SocketArm {
      socketConnects: number
      serverRequests: number
    }

    async function runArm(env: Record<string, string | undefined>): Promise<SocketArm> {
      // NO MockAgent here on purpose. This arm runs on the real global dispatcher so a real socket
      // is opened to a real listener — which is what makes the spy's zero on the other arm mean
      // "nothing was dialled" rather than "something intercepted it first".
      const before = requestCount
      const socketSpy = vi.spyOn(net.Socket.prototype, 'connect')
      try {
        await driveEmitAndFlush({ env, projectKey: PROJECT_KEY, projectHost: origin })
        return {
          socketConnects: socketSpy.mock.calls.length,
          serverRequests: requestCount - before,
        }
      } finally {
        socketSpy.mockRestore()
      }
    }

    it('DO_NOT_TRACK=1 dials no socket; DNT unset dials one and the server sees the request', async () => {
      const optedOut = await runArm({ DO_NOT_TRACK: '1' })
      const optedIn = await runArm({})

      assertTwoSidedOrFatal('socket layer', optedOut.socketConnects, optedIn.socketConnects)
      assertTwoSidedOrFatal('server receipt', optedOut.serverRequests, optedIn.serverRequests)
    })

    it('the config privacy flag walls the socket exactly as DO_NOT_TRACK does', async () => {
      const socketSpy = vi.spyOn(net.Socket.prototype, 'connect')
      const before = requestCount
      await driveEmitAndFlush({
        env: {},
        config: { analytics: { privacy: true } },
        projectKey: PROJECT_KEY,
        projectHost: origin,
      })
      const optedOutConnects = socketSpy.mock.calls.length
      const optedOutRequests = requestCount - before
      socketSpy.mockRestore()

      const optedIn = await runArm({})
      assertTwoSidedOrFatal('socket layer (config privacy)', optedOutConnects, optedIn.socketConnects)
      assertTwoSidedOrFatal('server receipt (config privacy)', optedOutRequests, optedIn.serverRequests)
    })

    // D-19's deny-wins clause, measured at the wire rather than at the reason list: a user who set
    // the variable to `0` beside a config opt-out is still opted out, and the socket is where that
    // has to be true.
    it('DO_NOT_TRACK=0 beside config privacy still dials nothing (deny wins)', async () => {
      const socketSpy = vi.spyOn(net.Socket.prototype, 'connect')
      const before = requestCount
      await driveEmitAndFlush({
        env: { DO_NOT_TRACK: '0' },
        config: { analytics: { privacy: true } },
        projectKey: PROJECT_KEY,
        projectHost: origin,
      })
      const connects = socketSpy.mock.calls.length
      socketSpy.mockRestore()

      expect(connects).toBe(0)
      expect(requestCount - before).toBe(0)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Wall 3: the sandboxed sink — posthog-node's own `fetch` option, the last in-process seam
  // -------------------------------------------------------------------------------------------

  describe('sandboxed sink (posthog-node fetch option)', () => {
    interface SinkCall {
      url: string
      body: string
    }

    async function runArm(
      options: ComposeAnalyticsOptions,
    ): Promise<{ calls: SinkCall[]; socketConnects: number }> {
      const calls: SinkCall[] = []
      const socketSpy = vi.spyOn(net.Socket.prototype, 'connect')
      try {
        await driveEmitAndFlush({
          ...options,
          projectKey: PROJECT_KEY,
          projectHost: MOCK_ORIGIN,
          // The SHIPPED transport constructor, handed the SHIPPED options plus posthog-node's own
          // `fetch` hook. Nothing parallel is built for the test: this is the same object
          // production constructs, with its last hop pointed at a counter instead of a socket.
          posthogTransportFactory: (transportOptions) =>
            createPosthogTransport({
              ...transportOptions,
              fetch: async (url: string, init: { body?: unknown }) => {
                calls.push({ url, body: await readSinkBody(init.body) })
                return new Response(JSON.stringify({ status: 1 }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                }) as never
              },
            }),
        })
        return { calls, socketConnects: socketSpy.mock.calls.length }
      } finally {
        socketSpy.mockRestore()
      }
    }

    it('DO_NOT_TRACK=1 never reaches the sink; DNT unset reaches it with the real batch', async () => {
      const optedOut = await runArm({ env: { DO_NOT_TRACK: '1' } })
      const optedIn = await runArm({ env: {} })

      assertTwoSidedOrFatal('sandboxed sink', optedOut.calls.length, optedIn.calls.length)
      // No socket on either arm — the sink replaced the wire, so an observed connect would mean a
      // SECOND send path exists beside the one the sink is standing in for.
      expect(optedOut.socketConnects).toBe(0)
      expect(optedIn.socketConnects).toBe(0)

      const body = optedIn.calls[0]?.body ?? ''
      expect(optedIn.calls[0]?.url).toContain('/batch/')
      expect(body).toContain('agent-qa.test_run.completed')
    })
  })
})

/**
 * The bytes as posthog-node hands them to `fetch`: a gzip `Blob` by default, a JSON string when
 * compression is unavailable. Read as bytes and decompressed, never read off the event object —
 * the point of a wire assertion is that it is made on what leaves.
 */
export async function readSinkBody(body: unknown): Promise<string> {
  if (typeof body === 'string') return body
  if (body instanceof Blob) {
    const bytes = Buffer.from(await body.arrayBuffer())
    return isGzip(bytes) ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
  }
  if (body instanceof Uint8Array) {
    const bytes = Buffer.from(body)
    return isGzip(bytes) ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
  }
  return String(body ?? '')
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}
