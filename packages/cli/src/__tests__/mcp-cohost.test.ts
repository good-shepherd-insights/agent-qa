// The CO-HOSTED MCP endpoint, measured on the wire (Phase 408 plan 03 Task 2 · MCPA-01 ·
// D-03 / D-08 / Open Question 4 · T-408-10 / T-408-11 / T-408-12 / T-408-13).
//
// THE ONE CLAIM THIS FILE EXISTS FOR. 403 D-01 gives each process its own live-view signing key, so
// a `liveUrl` minted in one process does not validate in another. D-03's invariant is therefore
// that the mint and the frame proxy share a composition — and RESEARCH measured that only the
// `agent-qa dashboard` composition binds `liveView` at all. Everything below composes the pieces
// `commands/dashboard.ts` composes, in the order it composes them, binds the SHIPPED
// `createMcpHttpRequestListener` over the resulting registry on a real ephemeral socket, and asks
// whether a token served inside the App document passes THAT composition's own `validate`. That is
// the invariant stated as a measurement rather than as an argument.
//
// WHAT IS PRODUCTION HERE AND WHAT IS SCRIPTED. Production: `createMcpHttpRequestListener` (the
// Host -> Origin -> bearer guard order, verbatim), `composeMcpMasking`, `resolveMcpTokens`,
// `composeLiveView` (the signer, the mint port and the validator, joined once),
// `createRunServiceSessionRegistry`, `createFunctionRegistry`, `invokeFunction`, `runs.liveurl`,
// `runs.events`, `runs.digest`, `buildAgentQaMcpServer` with its App registration and its carrier
// decoration, and a real `@modelcontextprotocol/client@2.0.0` over a real loopback socket.
// Scripted: the run itself — a `RunSession` announcing one streamable handle, a recorded run
// document and a `runStarted` envelope carrying the roster. `createDashboardRunDoor` is NOT used;
// it opens a database and a whole execution backend to answer a question about a signer.
//
// WHY THE APPS CLIENT MUST NEGOTIATE THE MODERN ERA (plan 02 decision D-G). The `ui://` read is
// gated on per-request client capabilities, and `@modelcontextprotocol/client@2.0.0` carries those
// ONLY on the 2026-07-28 wire era, which it reaches through `versionNegotiation: { mode: 'auto' }`
// and does NOT default to. A cell here that connected with the default would measure a refusal and
// read it as a defect in this endpoint.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR:
//   D1  the Host validator dropped from the mounted listener        -> the forbidden_host cell
//   D2  an unmatched bearer degraded to the default grant           -> the invalid_token cell
//   D3  the endpoint mounted over a registry with no live view      -> the in-composition mint cell
//   D4  a CORS header added to the refusal or the answer            -> the header-absence cell
//   D5  the carrier link composed from something other than the base -> the link-line cell

import { createServer } from 'node:http'
import type { Server as NodeHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect as netConnect } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import {
  createFunctionRegistry,
  type CreateFunctionRegistryOptions,
  type FunctionDeps,
  type FunctionRegistry,
} from '@vostride/agent-qa-agent'
import {
  LIVE_LINK_ABSENT_LINE,
  MCP_APPS_EXTENSION_ID,
  appResourceUriFor,
  liveLinkLine,
  liveRunLinkOf,
} from '@vostride/agent-qa-mcp'
import { asRunId } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  RunEventEnvelope,
  RunSession,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { composeLiveView } from '../composition/live-view-composition.js'
import type { ComposedLiveView } from '../composition/live-view-composition.js'
import { createRunServiceSessionRegistry } from '../composition/run-service-session-registry.js'
import { resolveMcpTokens } from '../composition/mcp-token-resolution.js'
import { composeMcpMasking, createMcpHttpRequestListener } from '../commands/mcp.js'

// ---- The fixture composition — the dashboard's own, minus the database ------------------------

const RUN_ID = 'run-408-03-cohost'
const APP_URI = `ui://agent-qa/live-run/${RUN_ID}`
const TOKEN_ENV_VAR = 'AGENT_QA_408_03_COHOST_TOKEN'
const TOKEN_VALUE = 'cohost-token-408-03-not-a-real-credential'

function handoff(): CompletedRunHandoff {
  return {
    schemaVersion: 5,
    runId: asRunId(RUN_ID),
    scope: { tier: 'product', key: 'cohost' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 't_cohost',
        testName: 'the member this fixture announces',
        filePath: 'tests/cohost.yaml',
        testIndex: 0,
        outcome: 'passed',
        steps: [],
      },
    ],
  }
}

const RUN_STARTED: RunEventEnvelope = {
  seq: 1,
  ts: 1_800_000_000_000,
  runId: RUN_ID,
  type: 'runStarted',
  payload: {
    busSchemaVersion: 1,
    scope: { tier: 'product', key: 'cohost' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    memberTestCount: 1,
    handles: [0],
  },
} as unknown as RunEventEnvelope

/**
 * The one live session this fixture announces, published through the ONE bridge the registry
 * observes — the same route a real run reaches `createRunServiceSessionRegistry` by.
 */
const SESSION = {
  id: asRunId(RUN_ID),
  status: 'running',
  executionContext: 'local-headless',
  streamCapabilityOf: (handle: number) =>
    handle === 0 ? { kind: 'cdp-screencast' } : { kind: 'none' },
  // The registry arms its eviction window off this, so a session that never settles is a session
  // that stays attachable — which is what a RUNNING run is, and what this fixture announces.
  done: new Promise<never>(() => {}),
} as unknown as RunSession

interface Harness {
  readonly port: number
  readonly url: string
  readonly boundOrigin: string
  readonly liveView: ComposedLiveView
  close(): Promise<void>
}

let harness: Harness

beforeAll(async () => {
  process.env[TOKEN_ENV_VAR] = TOKEN_VALUE

  // The dashboard's composition order, verbatim: the session registry first (hoisted above both
  // arms), then the live view over it with the ORIGIN AS A BOX — the port does not exist yet.
  let boundOrigin: string | undefined
  const sessions = createRunServiceSessionRegistry({
    observeSessions: (observer) => {
      observer(SESSION)
      return () => {}
    },
  })
  const liveView = composeLiveView({
    sessions,
    origin: () => boundOrigin,
    // The one member `composeLiveView` narrows its door to. It binds its own minted-token masking
    // store through this, which is 402-06's law and is why the command never calls it.
    door: { bindMaskingSecrets: () => {} },
  })

  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']

  // THE LIVE-VIEW-BOUND REGISTRY. This is the whole difference between this endpoint and the
  // standalone one: `runs.liveurl` is BOUND here, so `registerAppResources`' third condition passes
  // and the App registers at all (plan 01 decision D-A).
  const registry: FunctionRegistry = createFunctionRegistry({
    deps: {
      runs: {
        list: () => Promise.resolve([handoff()]),
        get: (runId: string) => Promise.resolve(String(runId) === RUN_ID ? handoff() : undefined),
        readEvents: (runId: string, fromSeq: number) =>
          Promise.resolve(String(runId) === RUN_ID && fromSeq <= 1 ? [RUN_STARTED] : []),
        readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
      },
      proposalsInbox: { list: () => Promise.resolve([]) },
      liveView: liveView.liveView,
    } as unknown as FunctionDeps,
    auditSink,
  })

  const tokens = resolveMcpTokens(
    [{ name: 'cohost', tokenEnvVar: TOKEN_ENV_VAR, scopes: ['read'] }],
    process.env,
  )
  const masking = composeMcpMasking({ tokens, env: process.env })

  const server: NodeHttpServer = createServer(
    createMcpHttpRequestListener({
      registry,
      maskText: (text: string) => masking.mask(text),
      tokens,
      // The dashboard's own supplier: no configured base in this fixture, so the bound origin is
      // what fills the absence — read PER RESULT, because the box below is assigned after listen.
      liveLink: { dashboardBaseUrl: () => boundOrigin },
    }),
  )
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', () => listening()))
  const port = (server.address() as AddressInfo).port
  boundOrigin = `http://localhost:${String(port)}`

  harness = {
    port,
    url: `http://127.0.0.1:${String(port)}/mcp`,
    boundOrigin,
    liveView,
    close: async () => {
      await new Promise<void>((closed) => server.close(() => closed()))
      sessions.dispose()
      masking.dispose()
      delete process.env[TOKEN_ENV_VAR]
    },
  }
}, 60_000)

afterAll(async () => {
  await harness?.close()
})

/** One recorded HTTP exchange — the status line and every header, exactly as they crossed. */
interface Frame {
  readonly status: number
  readonly headerNames: readonly string[]
}

const frames: Frame[] = []

/**
 * Connect the SHIPPED client with a bearer, on the modern era, declaring the Apps extension.
 *
 * Every response's header NAMES are recorded on the way past, which is what makes the CORS cell a
 * statement about the wire rather than about a source grep.
 */
async function connectAs(
  token: string | undefined,
  options: { readonly apps?: boolean } = {},
): Promise<Client> {
  const recordingFetch = (async (input: URL | string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
    const res = await fetch(input as string, { ...init, headers })
    frames.push({ status: res.status, headerNames: [...res.headers.keys()] })
    return res
  }) as typeof fetch

  const client = new Client(
    { name: 'agent-qa-408-03-cohost', version: '0.0.0' },
    {
      // Plan 02 D-G: the per-request capabilities envelope exists only on the modern era.
      versionNegotiation: { mode: 'auto' as const },
      ...(options.apps === false
        ? {}
        : { capabilities: { extensions: { [MCP_APPS_EXTENSION_ID]: {} } } }),
    },
  )
  await client.connect(new StreamableHTTPClientTransport(new URL(harness.url), {
    fetch: recordingFetch,
  }))
  return client
}

/**
 * A raw request over a socket, because `fetch` refuses to let a caller set `Host`.
 *
 * The DNS-rebinding guard is a claim ABOUT the `Host` header and undici silently overwrites it, so
 * a cell built on `fetch` would assert the guard while never once presenting a bad host. Copied in
 * shape from `mcp-visibility-differential.test.ts`, which measured that the hard way.
 */
async function rawRequest(headers: Record<string, string>): Promise<{
  readonly status: number
  readonly text: string
}> {
  return await new Promise((done, failed) => {
    const socket = netConnect(harness.port, '127.0.0.1', () => {
      const body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
      socket.write(
        [
          'POST /mcp HTTP/1.1',
          ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          `Content-Length: ${Buffer.byteLength(body)}`,
          'Connection: close',
          '',
          body,
        ].join('\r\n'),
      )
    })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
    })
    socket.on('error', failed)
    socket.on('end', () => {
      done({ status: Number.parseInt(buffer.split(' ')[1] ?? '0', 10), text: buffer })
    })
  })
}

// ---- 1. The guard order, reused verbatim (Pitfall 7 · T-408-10, T-408-11) ----------------------

describe('the mounted endpoint keeps the standalone face\'s guard order (Pitfall 7)', () => {
  it('refuses a non-localhost Host with 403 forbidden_host, before anything else', async () => {
    const answer = await rawRequest({
      Host: 'attacker.example.com',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      // A VALID credential, deliberately: the Host wall answers first, so the right bearer must
      // not rescue a rebound name. That ordering IS the DNS-rebinding claim.
      Authorization: `Bearer ${TOKEN_VALUE}`,
    })
    expect(answer.status).toBe(403)
    expect(answer.text).toContain('forbidden_host')
  })

  it('refuses a non-localhost Origin with 403 forbidden_origin', async () => {
    const answer = await rawRequest({
      Host: `127.0.0.1:${String(harness.port)}`,
      Origin: 'https://evil.example.com',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN_VALUE}`,
    })
    expect(answer.status).toBe(403)
    expect(answer.text).toContain('forbidden_origin')
  })

  it('refuses an unmatched bearer with 401 invalid_token, never degraded to the default grant', async () => {
    const answer = await rawRequest({
      Host: `127.0.0.1:${String(harness.port)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer not-the-declared-credential',
    })
    expect(answer.status).toBe(401)
    expect(answer.text).toContain('invalid_token')
    // The 401 tells a prober nothing about which of the two shapes it produced, and echoes
    // nothing it was sent.
    expect(answer.text).not.toContain('not-the-declared-credential')
  })
})

// ---- 2. D-03 on the wire: the served token validates IN THIS COMPOSITION -----------------------

describe('a served App token validates against THIS composition\'s validator (D-03)', () => {
  it('serves wrapper HTML whose liveUrl passes the composition\'s own validate', async () => {
    const client = await connectAs(TOKEN_VALUE)
    try {
      const result = await client.readResource({ uri: APP_URI })
      const contents = result.contents as readonly { uri: string; text?: string }[]
      expect(contents).toHaveLength(1)
      const html = contents[0]?.text ?? ''

      // Read the token back OUT OF THE BYTES the host would render, never out of the input the
      // renderer was handed — the claim is about what crossed the wire.
      const matches = [
        ...html.matchAll(new RegExp(`/live/${RUN_ID}#([\\w.-]+)`, 'gu')),
      ].map((match) => match[1] as string)
      expect(matches.length, 'one pane per announced handle').toBe(1)

      // THE MEASUREMENT. `harness.liveView.validate` is the validator `composeLiveView` joined to
      // the signer this endpoint minted through — which in the dashboard composition is by
      // reference the same function `startServer` binds as the frame proxy's `validate`. A token
      // minted in a DIFFERENT process would fail here, which is exactly D-03's hazard.
      const verdict = harness.liveView.validate(matches[0] as string, {
        runId: RUN_ID,
        now: Date.now(),
      })
      expect(verdict.kind).toBe('ok')
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('names the minted origin in the App\'s frameDomains, and nothing wider', async () => {
    const client = await connectAs(TOKEN_VALUE)
    try {
      const result = await client.readResource({ uri: APP_URI })
      const contents = result.contents as readonly {
        _meta?: { ui?: { csp?: { frameDomains?: readonly string[] } } }
      }[]
      expect(contents[0]?._meta?.ui?.csp?.frameDomains).toEqual([harness.boundOrigin])
    } finally {
      await client.close().catch(() => {})
    }
  })
})

// ---- 3. The carrier link, composed from the bound origin (D-08) --------------------------------

describe('a carrier result on this endpoint carries the link composed from the bound origin', () => {
  it('carries the link line and the concrete App address', async () => {
    const client = await connectAs(TOKEN_VALUE)
    try {
      const result = (await client.callTool({
        name: 'agent_qa_get_run_digest',
        arguments: { runId: RUN_ID },
      })) as unknown as {
        content?: readonly { type: string; text?: string }[]
        isError?: boolean
        _meta?: { ui?: { resourceUri?: unknown } }
      }

      const texts = (result.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')

      expect(result.isError ?? false, JSON.stringify(texts)).toBe(false)
      expect(texts).toContain(liveLinkLine(liveRunLinkOf(harness.boundOrigin, RUN_ID)))
      expect(texts).not.toContain(LIVE_LINK_ABSENT_LINE)
      expect(result._meta?.ui?.resourceUri).toBe(appResourceUriFor(RUN_ID))
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('carries a TOKENLESS link — the permanent page, never a minted credential (D-08, T-408-12)', async () => {
    const client = await connectAs(TOKEN_VALUE)
    try {
      const result = (await client.callTool({
        name: 'agent_qa_get_run_digest',
        arguments: { runId: RUN_ID },
      })) as unknown as { content?: readonly { type: string; text?: string }[] }
      const line = (result.content ?? [])
        .map((part) => part.text ?? '')
        .find((text) => text.startsWith('watch live'))
      expect(line).toBeDefined()
      const url = new URL((line as string).slice((line as string).indexOf('http')))
      expect(url.pathname).toBe(`/runs/${RUN_ID}/live`)
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    } finally {
      await client.close().catch(() => {})
    }
  })
})

// ---- 4. Zero CORS headers, on every answered request (T-408-13) --------------------------------

describe('the co-hosted endpoint emits no CORS header, ever (the counted-zero law)', () => {
  it('answered no request with an access-control-* header', () => {
    expect(frames.length, 'the cells above really crossed this socket').toBeGreaterThan(0)
    const offending = frames.flatMap((frame) =>
      frame.headerNames.filter((name) => name.toLowerCase().startsWith('access-control')),
    )
    expect(offending).toEqual([])
  })

  it('answered no REFUSAL with one either', async () => {
    const answer = await rawRequest({
      Host: `127.0.0.1:${String(harness.port)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer still-not-the-declared-credential',
    })
    expect(answer.status).toBe(401)
    expect(answer.text.toLowerCase()).not.toContain('access-control')
  })
})

// ---- 5. The mount and its shutdown, in the composition that ships ------------------------------
//
// A SOURCE ASSERTION, and it is the honest shape for this one: driving `startDashboardBackedServices`
// would open a database, a browser-capable execution backend and the whole dashboard-server, to
// observe two lines. What matters about those two lines is that they EXIST in the shipped
// composition — the conditional mount and the close in the shutdown path — and that is a fact about
// the file. The BEHAVIOUR of what they mount is what every cell above measures, over the same
// exported listener the command binds.

const DASHBOARD_SOURCE = readFileSync(
  resolvePath(dirname(fileURLToPath(import.meta.url)), '../commands/dashboard.ts'),
  'utf8',
)

describe('the shipped dashboard composition mounts and closes the endpoint', () => {
  it('mounts it ONLY when services.mcp.tokens is declared', () => {
    expect(DASHBOARD_SOURCE).toContain('resolveMcpTokens(')
    expect(DASHBOARD_SOURCE).toContain('createMcpHttpRequestListener({')
    expect(DASHBOARD_SOURCE).toContain('if (mcpTokens.length > 0)')
    expect(DASHBOARD_SOURCE).toContain('NOT MOUNTED WHEN NOTHING IS DECLARED')
  })

  it('mounts it over the LIVE-VIEW-BOUND registry — D-03 by composition', () => {
    expect(DASHBOARD_SOURCE).toContain('registry: runHost.registry as FunctionRegistry')
  })

  it('closes the second server in the shutdown path', () => {
    const shutdown = DASHBOARD_SOURCE.slice(DASHBOARD_SOURCE.indexOf('const shutdown = async ()'))
    expect(shutdown).toContain('mcpServer?.close()')
    expect(shutdown).toContain('mcpMasking?.dispose()')
  })

  it('touches no file under packages/dashboard-server (criterion 3, Pitfall 8)', () => {
    // The co-host is a second loopback listener in THIS command, so the route-order hazard cannot
    // be reached from here at all. Stated as a cell because the structural avoidance is the whole
    // reason the mount was written this way.
    expect(DASHBOARD_SOURCE).not.toContain('dashboard-server/src/server')
  })
})
