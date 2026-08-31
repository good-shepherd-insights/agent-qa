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
// THE MUTATION LEGS THIS FILE IS THE BAR FOR. Four of the five were APPLIED to their subject and
// their red observed on 2026-08-31, then the subject was restored:
//   D1  the Host validator dropped from the mounted listener        -> MEASURED: forcing
//       `host.ok` reds `refuses a non-localhost Host with 403 forbidden_host` (1 of 13)
//   D2  an unmatched bearer degraded to the default grant           -> MEASURED: skipping the
//       `verdict.kind === 'refused'` arm reds BOTH the invalid_token cell and the refusal-side
//       CORS cell (2 of 13) — the second is the honest cost of a shared refusal path
//   D3  a token minted here validated by ANOTHER composition        -> MEASURED, and it is the
//       file's whole subject: validating the served token against a second `composeLiveView`'s
//       validator answers `refused` rather than `ok`. That is 403 D-01's per-process key stated
//       as an observation, and it is exactly what D-03 exists to prevent happening in production
//   D4  a CORS header added to the refusal or the answer            -> not separately applied;
//       the counted-zero law is asserted over the header names of every response this file really
//       received, and D2's red on the refusal-side cell shows that assertion is reachable
//   D5  the carrier link composed from something other than the base -> covered by the mcp
//       package's own `live-link.test.ts` C4 leg (measured there); here the base under test is
//       the BOUND ORIGIN, which no other value in this fixture is equal to
//   D6  the App wrapper's permanent-link slot left as plan 01 shipped it -> MEASURED: restoring
//       `permanentLink: undefined` reds `renders D-08's permanent-link slot` (1 of 15) — AFTER a
//       rebuild. The first attempt passed against a stale `dist`, which is why cell 0 exists.
//
// 408-09's LEGS, all six APPLIED to their subject and their red observed on 2026-09-01, then the
// subject restored. They exist because the four cells this file used to close with could not fail
// (WR-09) — see the block comment above section 5:
//   D7  `mcpMountPlanFor` made to ignore `services.mcp.enabled`  -> MEASURED: reds the row `does
//       NOT mount when services.mcp.enabled is the literal false` with `expected true to be false`
//       (1 of 26). This is WR-01 / T-408-18 turned into a standing gate.
//   D8  `mcpMountPlanFor` made to read `services.dashboard.mcp`  -> MEASURED: reds 6 of 26,
//       including the load-bearing row `does NOT mount for a token declared under
//       services.dashboard.mcp` with `expected true to be false`. That is the 408-03 defect's
//       EXACT shape, and the source cells this block replaced passed over it in both directions.
//   D9  the scoped `try`/`catch` removed from `mountCoHostedMcp` -> MEASURED: the bind-collision
//       cell reds with the raw `Error: listen EADDRINUSE: address already in use 127.0.0.1:<port>`
//       escaping — which in production is the rejection that reached `process.exit(2)` and took a
//       fully started dashboard down over an OPTIONAL listener (WR-02 / T-408-17).
//   D10 the `registry:` property assignment removed from the co-host mount -> MEASURED: reds the
//       registry SOURCE ASSERTION cell (1 of 26). The surviving source assertions can fail.
//   D11 `mcpServer?.close()` removed from the shutdown closure   -> MEASURED: reds the shutdown
//       SOURCE ASSERTION cell (1 of 26).
//   D12 a byte appended to `packages/dashboard-server/package.json` -> MEASURED: reds the SC3
//       frozen-path cell naming the file. The cell it replaced asserted a module specifier that
//       could not appear in this workspace under any implementation, so it could not fail at all.

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server as NodeHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { connect as netConnect } from 'node:net'
import { readFileSync, statSync } from 'node:fs'
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
import { mcpMountPlanFor, mountCoHostedMcp } from '../commands/dashboard.js'
import {
  composeMcpMasking,
  createMcpHttpRequestListener,
  MCP_HTTP_BIND_HOST,
  MCP_HTTP_DEFAULT_PORT,
} from '../commands/mcp.js'

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

// ---- 0. Artifact freshness, FIRST (408-05 D-O's reasoning, applied here) -----------------------
//
// THIS FILE READS THE BUILT `@vostride/agent-qa-mcp`, not its source — a cross-package import in
// this workspace resolves to `dist`. So a stale artifact makes every App cell below assert the
// PREVIOUS build, and it does so silently and greenly. That is not hypothetical here: the
// permanent-link cell's own mutation leg passed against a stale `dist` on the first attempt and
// only red after a rebuild, which is the same failure 408-01 lost an afternoon to and 408-05 built
// its scoped freshness gate for. Scoped to the THREE source files that compose what this file
// measures, deliberately: an unrelated edit elsewhere in the package must not red a claim about the
// App and the carrier decoration.

const MCP_PACKAGE_DIR = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../../mcp')
const MCP_ARTIFACT = resolvePath(MCP_PACKAGE_DIR, 'dist/index.js')
const MCP_REBUILD_INSTRUCTION = 'run `pnpm --filter @vostride/agent-qa-mcp run build`'

describe('this file measures a FRESH artifact (408-05 D-O)', () => {
  it('reads a build no older than the sources it measures', () => {
    const artifact = statSync(MCP_ARTIFACT).mtimeMs
    for (const source of ['src/app-resource.ts', 'src/catalog.ts', 'src/live-link.ts']) {
      const path = resolvePath(MCP_PACKAGE_DIR, source)
      expect(
        statSync(path).mtimeMs <= artifact,
        `${source} is newer than the built mcp package — ${MCP_REBUILD_INSTRUCTION}`,
      ).toBe(true)
    }
  })
})

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

  it('renders D-08\'s permanent-link slot, pointing at the tokenless page (closes 408-01\'s stub)', async () => {
    const client = await connectAs(TOKEN_VALUE)
    try {
      const result = await client.readResource({ uri: APP_URI })
      const html = (result.contents as readonly { text?: string }[])[0]?.text ?? ''

      // Plan 01 shipped this slot ABSENT, because composing the link needs a base and a base is
      // composition territory that plan did not touch. It is composed here, so the anchor exists
      // and carries the address IN THE SERVED MARKUP (amended 2026-09-01, 408-11: the href used to
      // be assigned by the wrapper's script, which left it empty on a host that runs no script) —
      // which is what D-11's `expired` and `unreachable-origin` states hand a person instead of a
      // dead frame.
      expect(html).toContain('data-app-permanent-link')
      expect(html).toContain(liveRunLinkOf(harness.boundOrigin, RUN_ID))
      // The SAME page the carrier line names — one address for one run, never two.
      expect(html).toContain(`/runs/${RUN_ID}/live`)
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

// ---- 5. The mount DECISION, driven — and the two wiring facts that stay source assertions -------
//
// WHAT THIS BLOCK USED TO BE, AND WHY IT WAS REPLACED (408-09, WR-09). Until 408-09 the four cells
// here were `toContain` over `dashboard.ts` read as text, and the verifier's charge was exact: the
// cell named "mounts it ONLY when services.mcp.tokens is declared" was satisfied by the PREVIOUS,
// DEFECTIVE version of the mount — `resolveMcpTokens(servicesConfig.mcp?.tokens ?? [], ...)`, where
// `servicesConfig` was `services.dashboard`, so the mount never fired at all. A cell that passes
// both before and after the defect it names is not a gate.
//
// Worse, one of those four assertions read a COMMENT: `toContain('NOT MOUNTED WHEN NOTHING IS
// DECLARED')` at the old :544. That banner sentence is not code in any version of `dashboard.ts` —
// and it is not even unique to the MCP arm, since the RUN-SERVICE door's comment (dashboard.ts
// :1977) has carried the identical sentence since 402-01. The assertion was therefore true of a
// file in which the MCP mount had been deleted outright. It was CONVERTED here, never retained: the
// mount claim is now the `mcpMountPlanFor` table below.
//
// The "touches no file under packages/dashboard-server" cell asserted
// `not.toContain('dashboard-server/src/server')` — a specifier that could never appear in this
// workspace under any implementation, since imports go through `@vostride/agent-qa-dashboard`. It
// is replaced by a claim over the working tree's own diff, which CAN fail.
//
// TWO SOURCE ASSERTIONS SURVIVE, and each says so in its own comment, names the code CONSTRUCT it
// reads, and points at the behavioural cell carrying the other half of its claim. Driving them
// behaviourally would open a database, a browser-capable execution backend and the whole
// dashboard-server to observe a property assignment and two method calls.

const DASHBOARD_SOURCE = readFileSync(
  resolvePath(dirname(fileURLToPath(import.meta.url)), '../commands/dashboard.ts'),
  'utf8',
)

/** The inner `agent-qa` repository root — `packages/cli/src/__tests__` is four levels down. */
const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** One declared caller credential, in the refs-only shape `McpTokenEntrySchema` accepts. */
const DECLARED_TOKEN = { name: 'cohost', tokenEnvVar: TOKEN_ENV_VAR, scopes: ['read'] } as const

interface MountRow {
  readonly claim: string
  readonly config: unknown
  readonly mount: boolean
  readonly port?: number
}

// Every row is a CONFIG RECORD in, a decision out. This is what makes the block able to detect the
// two defects the old cells could not: `enabled: false` ignored (WR-01), and the mount keyed off
// `services.dashboard.mcp` rather than `services.mcp` (the 408-03 defect's exact shape).
const MOUNT_ROWS: readonly MountRow[] = [
  {
    claim: 'mounts when services.mcp declares a token and says nothing about enabled — an ABSENT'
      + ' enabled means ENABLED',
    config: { services: { mcp: { tokens: [DECLARED_TOKEN] } } },
    mount: true,
    port: MCP_HTTP_DEFAULT_PORT,
  },
  {
    claim: 'does NOT mount when services.mcp.enabled is the literal false, even with a token'
      + ' declared (WR-01 / T-408-18)',
    config: { services: { mcp: { enabled: false, tokens: [DECLARED_TOKEN] } } },
    mount: false,
  },
  {
    claim: 'does NOT mount when enabled is true but no token is declared — an endpoint with nothing'
      + ' to match a bearer against is the D-07 default grant on loopback',
    config: { services: { mcp: { enabled: true, tokens: [] } } },
    mount: false,
  },
  {
    claim: 'does NOT mount for a token declared under services.dashboard.mcp — the shape of the'
      + ' always-undefined read 408-03 fixed, which the old source cells passed over',
    config: { services: { dashboard: { mcp: { tokens: [DECLARED_TOKEN] } } } },
    mount: false,
  },
  {
    claim: 'does NOT mount for a config with no services block, and does not throw',
    config: {},
    mount: false,
  },
  {
    claim: 'does NOT mount for an absent config, and does not throw',
    config: undefined,
    mount: false,
  },
  {
    claim: 'binds the standalone face\'s default port when no port is declared',
    config: { services: { mcp: { tokens: [DECLARED_TOKEN] } } },
    mount: true,
    port: MCP_HTTP_DEFAULT_PORT,
  },
  {
    claim: 'falls back to the default port when the declared port is outside the schema\'s range',
    config: { services: { mcp: { tokens: [DECLARED_TOKEN], port: 70_000 } } },
    mount: true,
    port: MCP_HTTP_DEFAULT_PORT,
  },
  {
    claim: 'binds the declared port when it is an integer inside the schema\'s range',
    config: { services: { mcp: { tokens: [DECLARED_TOKEN], port: 9123 } } },
    mount: true,
    port: 9123,
  },
]

describe('the co-host mount decision is a FUNCTION of the parsed config (WR-01, WR-09)', () => {
  for (const row of MOUNT_ROWS) {
    it(row.claim, () => {
      const plan = mcpMountPlanFor(row.config)
      expect(plan.mount).toBe(row.mount)
      if (row.port !== undefined) expect(plan.port).toBe(row.port)
    })
  }

  it('counts the DECLARED token entries, never the resolved ones — resolution reads process.env and'
    + ' is a different fact that stays at the mount site', () => {
    expect(mcpMountPlanFor({
      services: { mcp: { tokens: [DECLARED_TOKEN, { ...DECLARED_TOKEN, name: 'second' }] } },
    }).tokenCount).toBe(2)
    // A declared entry whose environment variable is UNSET still counts here: the plan is about
    // what the operator wrote, and `resolveMcpTokens` is about what the process can honour.
    expect(mcpMountPlanFor({
      services: { mcp: { tokens: [{ name: 'ghost', tokenEnvVar: 'AGENT_QA_408_09_UNSET', scopes: ['read'] }] } },
    })).toEqual({ mount: true, port: MCP_HTTP_DEFAULT_PORT, tokenCount: 1 })
  })
})

// ---- 6. An occupied MCP port costs a warning, not the dashboard (WR-02 · T-408-17) --------------
//
// DRIVEN OVER `mountCoHostedMcp`, THE EXTRACTED PIECE THE MOUNT SITE ITSELF CALLS — not a second
// spelling of it, and not a mocked rejection. The full dashboard composition needs a database and a
// browser-capable execution backend to reach this line, so the bind was extracted precisely so a
// cell could hand it a REAL occupied socket. The port these cells occupy is ephemeral rather than
// the shipped default, so the suite never fights a developer's own running `agent-qa mcp --http`.

describe('a failed bind on the optional MCP endpoint leaves the primary surface serving (WR-02)', () => {
  it('answers no server handle and a warning naming the MCP endpoint and the occupied port', async () => {
    const squatter = createServer(() => {})
    await new Promise<void>((bound) => squatter.listen(0, MCP_HTTP_BIND_HOST, () => bound()))
    const occupied = (squatter.address() as AddressInfo).port
    const warnings: string[] = []
    try {
      const outcome = await mountCoHostedMcp({
        server: createServer(() => {}),
        port: occupied,
        warn: (line) => warnings.push(line),
      })
      // The handle the command KEEPS. Before 408-09 this path did not exist: the rejection reached
      // the command's outer catch and `process.exit(2)` took a fully started dashboard with it.
      expect(outcome.server).toBeUndefined()
      expect(outcome.boundPort).toBeUndefined()
      expect(outcome.warning ?? '', 'the warning names the endpoint').toContain('MCP endpoint')
      expect(outcome.warning ?? '', 'the warning names the port').toContain(String(occupied))
      expect(warnings.join('\n'), 'and it really reached the operator').toContain('EADDRINUSE')
    } finally {
      await new Promise<void>((closed) => squatter.close(() => closed()))
    }
  })

  it('logs a socket error raised AFTER a successful listen, with exactly one handler left attached', async () => {
    const warnings: string[] = []
    const server = createServer(() => {})
    try {
      const outcome = await mountCoHostedMcp({ server, port: 0, warn: (line) => warnings.push(line) })
      expect(outcome.server).toBe(server)
      expect(outcome.boundPort ?? 0).toBeGreaterThan(0)
      // EXACTLY ONE. The listen-time handler is removed inside the `listen` callback before the
      // promise settles, and the durable one is attached in its place — so this count is the
      // behavioural form of "the rejection handler was detached on success". Two would mean the
      // old `once('error')` is still armed over a settled promise; zero would mean the emit below
      // throws, because a Node EventEmitter with no 'error' listener rethrows.
      expect(server.listenerCount('error')).toBe(1)
      server.emit('error', new Error('after-listen-boom'))
      expect(warnings.join('\n')).toContain('after-listen-boom')
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()))
    }
  })
})

// ---- 7. The two wiring facts, stated as source assertions and labelled as such -------------------

describe('the shipped dashboard composition wires and closes the endpoint', () => {
  it('SOURCE ASSERTION: the mount passes the LIVE-VIEW-BOUND registry — the wiring half of D-03,'
    + ' whose behavioural half is the served-token cell above', () => {
    // The construct read is a PROPERTY ASSIGNMENT in the `createMcpHttpRequestListener({ … })`
    // argument: `registry: runHost.registry as FunctionRegistry`. It is code, not prose.
    //
    // THE OTHER HALF IS BEHAVIOURAL AND IT IS IN THIS FILE: the cell "serves wrapper HTML whose
    // liveUrl passes the composition's own validate" reads a token back out of the bytes the host
    // would render and validates it against the composition's own validator. That cell proves the
    // CONSEQUENCE of this wiring over an equivalent composition; this line proves the SHIPPED
    // command really composes it that way. Neither alone is the whole claim.
    expect(DASHBOARD_SOURCE).toContain('registry: runHost.registry as FunctionRegistry')
  })

  it('SOURCE ASSERTION: the shutdown path closes the second server and disposes its masking —'
    + ' two method calls, in the shutdown closure and nowhere else', () => {
    // The constructs read are two METHOD CALLS inside `const shutdown = async () => { … }`.
    // Driving a real shutdown would open a database, a browser-capable execution backend and the
    // whole dashboard-server to observe them, which is why this stays a wiring assertion — said
    // out loud rather than implied. Its behavioural sibling is the bind-collision cell above,
    // which proves the same two handles are safe to leave unset.
    const shutdown = DASHBOARD_SOURCE.slice(DASHBOARD_SOURCE.indexOf('const shutdown = async ()'))
    expect(shutdown).toContain('mcpServer?.close()')
    expect(shutdown).toContain('mcpMasking?.dispose()')
  })

  it('leaves every file under packages/dashboard-server untouched in the working tree'
    + ' (ROADMAP SC3, criterion 3 / Pitfall 8)', () => {
    // ASSERTED OVER THE DIFF, NOT OVER A SOURCE SUBSTRING. The cell this replaces asserted
    // `not.toContain('dashboard-server/src/server')` — a specifier that could never appear in this
    // workspace under any implementation, so it could not fail. This one can: touch any file under
    // that package and it reds. Tracked AND untracked, because a new file is a change too.
    const tracked = execFileSync(
      'git',
      ['diff', '--name-only', 'HEAD', '--', 'packages/dashboard-server'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    const untracked = execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '--', 'packages/dashboard-server'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    ).trim()
    expect(tracked, 'a tracked dashboard-server file is modified').toBe('')
    expect(untracked, 'an untracked dashboard-server file was added').toBe('')
  })
})
