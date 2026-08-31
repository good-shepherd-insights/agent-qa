// The Apps-extension negotiation gate on the `ui://` read, MEASURED over the wire
// (Phase 408 plan 02 · MCPA-01 · RESEARCH Open Question 1 & 2 · D-01/D-09/D-14 · T-408-01/T-408-06).
//
// WHAT IS PRODUCTION HERE AND WHAT IS SCRIPTED. Production: `createAgentQaMcpNodeHandler`,
// `buildAgentQaMcpServer`, `registerAppResources`, the read handler and its negotiation gate,
// `negotiatedAppsExtension`, `renderAppWrapperPage`, `createFunctionRegistry`, `invokeFunction`,
// the `runs.liveurl` op, `mintLiveUrlToken`/`validateLiveUrlToken`, and — on the other side of a
// real loopback socket — `@modelcontextprotocol/client@2.0.0`. Scripted: the run event log this
// fixture serves, the `LiveViewPort` a composition would otherwise build (its signer is a real
// HMAC over a key this file owns), and the `node:http` server, which exists only because the
// shipped package deliberately binds no socket of its own.
//
// WHY A REAL SOCKET AND A REAL CLIENT. This file's subject is a fact about somebody else's code:
// WHERE the SDK puts a client's declared capabilities by the time a resource read reaches our
// handler. RESEARCH assumption A3 flagged that the published `RequestMetaEnvelope` is an empty
// augmentable type, so the member spelling could only be READ OFF THE TYPES as a guess. A cell
// that hand-built the context it wanted would have measured this file's opinion of the protocol.
// So the measurement cell drives the real client through the real handler and reads the context
// back out of a registrar that wraps — never replaces — the production read.
//
// WHAT THE MEASUREMENT FOUND (2026-08-31, `@modelcontextprotocol/server@2.0.0`):
//
//   ctx.mcpReq.envelope['io.modelcontextprotocol/clientCapabilities'].extensions
//
//   ...but ONLY on the modern (2026-07-28) wire era. The shipped client defaults to
//   `versionNegotiation: 'legacy'`, and a legacy `initialize` connection carries no per-request
//   capabilities at all; a stateless per-request server instance never saw that handshake either,
//   so the deprecated `getClientCapabilities()` accessor holds nothing there. The SDK states the
//   consequence itself — "per-request instances that never saw an initialize (stateless legacy)
//   hold nothing, so gates refuse there" — and this gate is written to refuse exactly there, which
//   is D-09's own posture: no evidence of negotiation, no App, and the link-out is that host's
//   whole answer. Both eras are cells below, so the day the SDK changes either, one reds.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR:
//   B1  the gate reads a different envelope member          -> the measurement cell
//   B2  the gate answers `true` when evidence is ABSENT     -> the legacy-era and no-context cells
//   B3  the refusal moved to AFTER the mint loop            -> the zero-mint cell
//   B4  the refusal echoes the document it declined to make -> the no-token-bytes cell

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server as NodeHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { ResourceMetadata, ResourceTemplate } from '@modelcontextprotocol/server'
import {
  RUNS_LIVE_URL_FUNCTION_ID,
  createFunctionRegistry,
  validateLiveUrlToken,
  type CreateFunctionRegistryOptions,
  type FunctionDeps,
  type FunctionRegistry,
  type LiveViewPort,
} from '@vostride/agent-qa-agent'
import type {
  FunctionCaller,
  FunctionScope,
  LiveUrlSigner,
  RunEventEnvelope,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import {
  APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY,
  APP_RESOURCE_MIME_TYPE,
  AppResourceNegotiationError,
  MCP_APPS_EXTENSION_ID,
  createAppResourceReadHandler,
  negotiatedAppsExtension,
  registerAppResources,
  type AppReadContext,
  type AppResourceRegistrar,
} from '../app-resource.js'
import { createAgentQaMcpNodeHandler } from '../http.js'

// ---- The fixture composition -------------------------------------------------------------------

const FIXTURE_RUN_ID = 'run-408-02-negotiation'
const FIXTURE_ORIGIN = 'http://127.0.0.1:7788'
const SIGNING_KEY = 'zz-408-02-app-negotiation-signing-key'
const APP_URI = `ui://agent-qa/live-run/${FIXTURE_RUN_ID}`

/**
 * Every token this signer has ever produced, in order.
 *
 * The mint counter AND the leak corpus in one object, which is the honest shape: the two questions
 * the refusal arm has to answer are "did anything get minted?" and "did any minted byte reach the
 * caller?", and both are questions about what the SIGNER did rather than about what the handler
 * says it did.
 */
function recordingSigner(): { readonly signer: LiveUrlSigner; readonly minted: string[] } {
  const minted: string[] = []
  const signer: LiveUrlSigner = {
    sign: (data) => {
      const signature = createHmac('sha256', SIGNING_KEY).update(data).digest('base64url')
      minted.push(signature)
      return signature
    },
    equals: (a, b) => {
      const left = Buffer.from(a)
      const right = Buffer.from(b)
      return left.length === right.length && timingSafeEqual(left, right)
    },
  }
  return { signer, minted }
}

const runStartedEnvelope = (handles: readonly number[]): RunEventEnvelope => ({
  seq: 1,
  ts: 1_800_000_000_000,
  runId: FIXTURE_RUN_ID,
  type: 'runStarted',
  payload: {
    busSchemaVersion: 1,
    scope: { tier: 'test', key: 'TST-408-02' },
    executionContext: 'local-headless',
    buildOrdinal: 1,
    configDigests: { suiteConfigDigest: 'suite-d', testConfigDigest: 'test-d' },
    memberTestCount: handles.length,
    handles: [...handles],
  },
})

function fixtureRegistry(handles: readonly number[] = [0, 1]): {
  readonly registry: FunctionRegistry
  readonly minted: string[]
} {
  const { signer, minted } = recordingSigner()
  let clock = 1_800_000_000_000

  const liveView: LiveViewPort = {
    signer,
    origin: () => FIXTURE_ORIGIN,
    now: () => (clock += 1),
    capabilityOf: (runId, handle) =>
      runId === FIXTURE_RUN_ID && handles.includes(handle) ? { kind: 'cdp-screencast' } : undefined,
  }

  const runs = {
    readEvents: async (runId: string, fromSeq: number) =>
      runId === FIXTURE_RUN_ID && fromSeq <= 1 ? [runStartedEnvelope(handles)] : [],
  }

  const auditSink = {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  } as unknown as CreateFunctionRegistryOptions['auditSink']

  return {
    registry: createFunctionRegistry({
      deps: { runs, liveView } as unknown as FunctionDeps,
      auditSink,
    }),
    minted,
  }
}

const caller = (grantedScopes: readonly FunctionScope[] = ['read']): FunctionCaller => ({
  surface: 'mcp',
  origin: 'agent',
  grantedScopes,
  safeMode: false,
})

const identity = (text: string): string => text

// ---- The socket, and the two ways a client can arrive at it ------------------------------------

const openServers: NodeHttpServer[] = []
const openClients: Client[] = []

afterEach(async () => {
  for (const client of openClients.splice(0)) await client.close().catch(() => {})
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

/**
 * Serve a request listener on loopback and answer its URL.
 *
 * A REAL socket rather than the SDK's in-process `handler.fetch` driver, and the difference is the
 * measurement itself: the envelope this file is here to read is lifted by the transport, so a cell
 * that skipped the wire would be reading a shape nothing on the wire produced.
 */
async function serve(listener: (req: never, res: never) => void): Promise<string> {
  const server = createServer(listener as never)
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
}

/**
 * Connect the SHIPPED client, either declaring the Apps extension or not.
 *
 * `versionNegotiation: { mode: 'auto' }` is what an Apps host must do and is not a test flourish:
 * the per-request capabilities envelope exists only on the 2026-07-28 era, which this client
 * reaches through the `server/discover` probe. The `apps: false` leg keeps the same era and drops
 * only the extension declaration, so the two legs differ in ONE fact — which is what makes the
 * refusal cell a statement about negotiation rather than about protocol versions.
 */
async function connect(
  url: string,
  options: { readonly apps: boolean; readonly era?: 'modern' | 'legacy' } = { apps: true },
): Promise<Client> {
  const client = new Client(
    { name: 'agent-qa-408-02-negotiation', version: '0.0.0' },
    {
      capabilities: options.apps ? { extensions: { [MCP_APPS_EXTENSION_ID]: {} } } : {},
      ...(options.era === 'legacy' ? {} : { versionNegotiation: { mode: 'auto' as const } }),
    },
  )
  openClients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

// ---- 1. The measurement (RESEARCH Open Question 1 / assumption A3) ------------------------------

/**
 * A registrar that WRAPS the production read to capture the context the SDK hands it.
 *
 * Deliberately a wrapper and not a replacement: the read that runs is the one
 * `registerAppResources` built, so the capture cannot drift from what the server actually serves.
 * This is also why the measurement needs no test-only hook inside `app-resource.ts` — the
 * registrar slice that module already takes IS the seam.
 */
function capturingRegistrar(
  server: McpServer,
  sink: (ctx: AppReadContext) => void,
): AppResourceRegistrar {
  return {
    registerResource(
      name: string,
      template: ResourceTemplate,
      config: ResourceMetadata,
      read: (uri: URL, variables: never, ctx: never) => unknown,
    ) {
      return server.registerResource(name, template, config, ((
        uri: URL,
        variables: never,
        ctx: AppReadContext,
      ) => {
        sink(ctx)
        return read(uri, variables, ctx as never)
      }) as never)
    },
  }
}

async function measureReadContext(options: {
  readonly apps: boolean
  readonly era?: 'modern' | 'legacy'
}): Promise<AppReadContext | undefined> {
  const { registry } = fixtureRegistry()
  let captured: AppReadContext | undefined

  const handler = toNodeHandler(
    createMcpHandler(() => {
      const server = new McpServer(
        { name: 'agent-qa', version: '2.0.0' },
        {
          capabilities: {
            resources: {},
            extensions: { [MCP_APPS_EXTENSION_ID]: {} },
          },
        },
      )
      registerAppResources(
        capturingRegistrar(server, (ctx) => {
          captured = ctx
        }),
        { registry, caller: caller(), maskText: identity },
      )
      return server
    }),
  )

  const url = await serve((req, res) => void handler(req as never, res as never))
  const client = await connect(url, options)
  await client.readResource({ uri: APP_URI }).catch(() => undefined)
  return captured
}

describe('the negotiation envelope, measured against the shipped SDK (Open Question 1 / A3)', () => {
  it('carries the client capabilities at the pinned envelope member on the modern era', async () => {
    const ctx = await measureReadContext({ apps: true })

    // The whole point of the cell: the PATH, spelled out, asserted against the wire. If the SDK
    // moves this member, `negotiatedAppsExtension` starts refusing everybody and this line is the
    // one that says why.
    const envelope = ctx?.mcpReq?.envelope as Record<string, unknown> | undefined
    expect(envelope, 'the modern era lifts a per-request _meta envelope').toBeDefined()
    expect(
      Object.keys(envelope ?? {}),
      'the envelope names the client-capabilities member the gate reads',
    ).toContain(APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY)

    const capabilities = envelope?.[APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY] as
      | { extensions?: Record<string, unknown> }
      | undefined
    expect(capabilities?.extensions).toHaveProperty(MCP_APPS_EXTENSION_ID)

    // And the predicate agrees with the bytes — the gate reads the member this cell just measured
    // rather than a second, parallel reading of the same request.
    expect(negotiatedAppsExtension(ctx)).toBe(true)
  })

  it('carries NO capabilities for a client that declared no extension, and none at all on the legacy era', async () => {
    const declaredNothing = await measureReadContext({ apps: false })
    expect(negotiatedAppsExtension(declaredNothing)).toBe(false)

    // The measured era caveat, kept as a cell rather than as a paragraph: the SDK's DEFAULT
    // negotiation mode is the 2025 `initialize` handshake, which carries no per-request
    // capabilities — so this gate refuses a legacy caller even when that caller declared the
    // extension at `initialize`. That is D-09's posture (no evidence, no App), and the day the
    // SDK backfills the envelope on the legacy era, this expectation is where we find out.
    const legacy = await measureReadContext({ apps: true, era: 'legacy' })
    expect(legacy?.mcpReq?.envelope).toBeUndefined()
    expect(negotiatedAppsExtension(legacy)).toBe(false)
  })

  it('answers false for absent evidence of every shape', () => {
    expect(negotiatedAppsExtension(undefined)).toBe(false)
    expect(negotiatedAppsExtension({})).toBe(false)
    expect(negotiatedAppsExtension({ mcpReq: {} })).toBe(false)
    expect(negotiatedAppsExtension({ mcpReq: { envelope: {} } })).toBe(false)
    expect(
      negotiatedAppsExtension({
        mcpReq: { envelope: { [APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY]: {} } as never },
      }),
    ).toBe(false)
    expect(
      negotiatedAppsExtension({
        mcpReq: {
          envelope: {
            [APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY]: { extensions: { 'other/ext': {} } },
          } as never,
        },
      }),
    ).toBe(false)
  })
})

// ---- 2 & 3. The gate, over the wire, on the shipped node handler --------------------------------

async function serveAgentQa(handles?: readonly number[]): Promise<{
  readonly url: string
  readonly minted: string[]
}> {
  const { registry, minted } = fixtureRegistry(handles)
  const handler = createAgentQaMcpNodeHandler(() => ({
    registry,
    caller: caller(),
    maskText: identity,
  }))
  const url = await serve((req, res) => void handler(req as never, res as never))
  return { url, minted }
}

describe('the ui:// read over the shipped node handler (D-09, T-408-01/T-408-06)', () => {
  it('serves the App to a NEGOTIATING client, with tokens the shipped validator accepts', async () => {
    const { url, minted } = await serveAgentQa([0, 1])
    const client = await connect(url, { apps: true })

    const result = await client.readResource({ uri: APP_URI })
    const contents = result.contents as readonly {
      uri: string
      mimeType?: string
      text?: string
    }[]

    expect(contents).toHaveLength(1)
    expect(contents[0]?.mimeType).toBe(APP_RESOURCE_MIME_TYPE)
    const html = contents[0]?.text ?? ''

    // Two handles announced, so two panes were minted for THIS read.
    expect(minted).toHaveLength(2)

    // The tokens are IN the bytes the host renders — read back out of the document rather than out
    // of the input the renderer was handed — and each one goes past the SHIPPED validator.
    const liveUrls = [
      ...html.matchAll(
        new RegExp(`${FIXTURE_ORIGIN.replace(/\./g, '\\.')}/live/${FIXTURE_RUN_ID}#([\\w.-]+)`, 'g'),
      ),
    ].map((match) => match[1] as string)
    expect(liveUrls).toHaveLength(2)

    const { signer } = recordingSigner()
    for (const [index, token] of liveUrls.entries()) {
      const verdict = validateLiveUrlToken(signer, token, {
        runId: FIXTURE_RUN_ID,
        now: 1_800_000_000_500,
      })
      expect(
        verdict.kind,
        `pane ${index} validates against the composition's own signer`,
      ).toBe('ok')
    }
  })

  it('REFUSES a non-negotiating client by name, and mints nothing on that path', async () => {
    const { url, minted } = await serveAgentQa([0, 1])
    const client = await connect(url, { apps: false })

    await expect(client.readResource({ uri: APP_URI })).rejects.toThrow(MCP_APPS_EXTENSION_ID)

    // T-408-06's mitigation as a MEASUREMENT rather than a promise: refuse-before-mint means the
    // signer was never asked, so there is no token in existence to have leaked.
    expect(minted, 'a refused read mints nothing at all').toHaveLength(0)
  })

  it('leaks no minted byte on the refusal path, proven against a live mint of the same run', async () => {
    const { url, minted } = await serveAgentQa([0, 1])

    // First a NEGOTIATED read, so real tokens for this exact run exist in this process. Without it
    // the next assertion would be vacuous — you cannot fail to find bytes that were never minted.
    const negotiated = await connect(url, { apps: true })
    await negotiated.readResource({ uri: APP_URI })
    expect(minted.length).toBeGreaterThan(0)

    const refused = await connect(url, { apps: false })
    const error = await refused.readResource({ uri: APP_URI }).then(
      () => undefined,
      (err: unknown) => err,
    )
    expect(error, 'the non-negotiated read refuses').toBeDefined()

    const refusal = JSON.stringify(error, Object.getOwnPropertyNames(error))
    for (const token of minted) {
      expect(refusal.includes(token), 'no minted byte appears on the refusal channel').toBe(false)
    }
  })
})

// ---- 3b. The refusal happens BEFORE the mint, counted at the invocation wall --------------------

describe('the refusal arm runs before anything is invoked (acceptance: zero mint invocations)', () => {
  it('invokes NO op at all — not the roster read, and not the mint', async () => {
    const invoked: string[] = []
    const read = createAppResourceReadHandler({
      invoke: async (opId) => {
        invoked.push(opId)
        return undefined
      },
      maskText: identity,
    })

    // A context carrying no negotiation evidence: the shape a model-driven read produces.
    await expect(read(new URL(APP_URI), {}, { mcpReq: { envelope: {} } })).rejects.toBeInstanceOf(
      AppResourceNegotiationError,
    )

    expect(invoked, 'the wall is never crossed on a refused read').toEqual([])
    expect(invoked.includes(RUNS_LIVE_URL_FUNCTION_ID)).toBe(false)
  })

  it('DOES cross the wall once negotiation is evident — the counter is load-bearing', async () => {
    const invoked: string[] = []
    const read = createAppResourceReadHandler({
      invoke: async (opId) => {
        invoked.push(opId)
        // An unannounced roster (`undefined`) is the single-handle default every non-suite run is,
        // so one mint is reached — the smallest composition that proves the counter can move.
        return opId === RUNS_LIVE_URL_FUNCTION_ID
          ? {
              handle: 0,
              liveUrl: `${FIXTURE_ORIGIN}/live/${FIXTURE_RUN_ID}#v1.body.sig`,
              expiresAt: 1_800_000_300_000,
              stream: { kind: 'cdp-screencast' },
            }
          : undefined
      },
      maskText: identity,
    })

    await read(new URL(APP_URI), {}, {
      mcpReq: {
        envelope: {
          [APP_NEGOTIATION_CLIENT_CAPABILITIES_KEY]: {
            extensions: { [MCP_APPS_EXTENSION_ID]: {} },
          },
        } as never,
      },
    })

    expect(invoked).toContain(RUNS_LIVE_URL_FUNCTION_ID)
  })
})
