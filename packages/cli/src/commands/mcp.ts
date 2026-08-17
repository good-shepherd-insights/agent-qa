// `agent-qa mcp` — the THIRD host over the function registry (Phase 396 plans 01 + 05, D-09 / D-10).
//
// WHY THIS FILE EXISTS IN THIS SHAPE. There are two hosts already: the interactive chat host and
// the daemon. Each composes the SAME registry through the SAME composition root and differs only in
// what it binds around it — who can be asked, what can be executed, who the caller is. This is the
// third, and the whole architectural claim of the phase is that being an MCP server is not a
// different KIND of thing: it is one more host, so this file composes and binds, and holds no
// capability of its own. The v1 server it replaces held thirty-three, and reached its data through
// the dashboard's REST API — a private power channel with no gate on it, which is exactly the shape
// the milestone abolishes.
//
// THE SPAWN MODEL IS PRESERVED DELIBERATELY. The command is still `mcp`, still stdio by default,
// because editor and client configurations out in the world encode `agent-qa mcp` and D-09 rates
// moving the server into the daemon as a costly reversal for precisely that reason.
//
// STDOUT IS THE PROTOCOL CHANNEL. Every diagnostic goes to stderr. One stray byte on stdout ahead
// of a response breaks every client on the connection, which is why the confirm port is refused
// below rather than merely absent, and why there is no `console.log` in this file.
//
// TWO TRANSPORTS, ONE SERVER (D-10, plan 05). `--http` binds a stateless loopback endpoint beside
// the stdio default. They differ in EXACTLY ONE THING — how a caller's scope set is resolved — and
// the code says so: both reach `buildAgentQaMcpServer` through the same `mcpServerDeps` helper,
// which takes a scope set and composes the rest identically. Anything else the two transports
// disagreed about would be a policy living in a transport, which is the shape this whole phase is
// deleting.
//
// THE ORDER OF THE HTTP GUARDS IS THE SECURITY CLAIM, and it is written as straight-line code
// rather than as middleware for that reason: Host, then Origin, then bearer, then — and only then —
// the MCP handler. A request that fails any of the three never reaches a factory, so an unmatched
// credential cannot cost a server build, and a rebound DNS name cannot reach one at all.
//
// NO CORS HEADER IS EMITTED, ANYWHERE. The deleted v1 bridge answered every request and every
// preflight with `Access-Control-Allow-Origin: *`, which on a loopback JSON-RPC endpoint is an
// invitation to exactly the cross-origin reach the Origin guard above refuses. An acceptance grep
// counts occurrences of that header name in this file and requires zero, so the prohibition is
// pinned by something that fails rather than by this sentence.
//
// Protocol grounding: SEP-2575 (stateless — no `initialize` handshake, no session id; `serveStdio`
// owns era negotiation and serves 2025-era clients from the same factory, and the HTTP face builds
// one instance per REQUEST and holds nothing between them), SEP-2567 (list results no longer vary
// per connection; the variance here is per CALLER, keyed on the credential resolved in front),
// SEP-2243 (Host/Origin validation at the HTTP boundary for loopback endpoints).

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { buildAgentQaMcpServer, createAgentQaMcpNodeHandler } from '@vostride/agent-qa-mcp'
import { buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import type { FunctionCaller, FunctionScope } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import pc from 'picocolors'
import { dirname, resolve } from 'node:path'

import { analyticsEvent, composeAnalyticsHost } from '../composition/analytics-host.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import {
  DEFAULT_MCP_SCOPES,
  matchBearer,
  mcpTokenSecretStore,
  resolveMcpTokens,
  resolveStdioScopes,
} from '../composition/mcp-token-resolution.js'
import type { ResolvedMcpToken } from '../composition/mcp-token-resolution.js'
import { resolveConfig } from '../config.js'

/** The one line the stdio host prints, on stderr, once the server is listening. */
export const MCP_STDIO_STARTUP_MESSAGE =
  'agent-qa MCP server running over stdio. Waiting for MCP client messages on stdin. '
  + 'Stdout is reserved for MCP protocol traffic.'

/** The only interface the HTTP face is ever bound to (D-10). */
export const MCP_HTTP_BIND_HOST = '127.0.0.1'

/** The default port for `--http` with no argument. The v1 endpoint used the same one. */
export const MCP_HTTP_DEFAULT_PORT = 3471

/**
 * What travels in `AuthInfo.token` — never the credential the caller presented.
 *
 * `AuthInfo` is the SDK's pass-through envelope and its `token` field is typed `string`, so
 * something has to go there. Putting the real value there would place a live credential on an
 * object that reaches every handler on the instance and every serializer that ever inspects one,
 * which is T-396-17's channel exactly. The VERDICT is what this host resolved — a scope set and a
 * label — and the verdict is all that crosses. The sentinel is a fixed, meaningless string so that
 * a leak of this field is self-evidently harmless and self-evidently a bug.
 */
export const MCP_AUTH_TOKEN_SENTINEL = '[agent-qa: token withheld]'

/**
 * The caller this host mints, for a given resolved scope set.
 *
 * `origin: 'agent'` and not `'human'`, which is the load-bearing field on this whole surface. 391
 * D-06's rule is that a caller never asserts its own grants and the composition root decides who a
 * call is on behalf of; nobody typed an MCP request, so an agent is what it is. The consequence is
 * concrete rather than philosophical: `proposals.accept` and `proposals.reject` declare
 * `requiresHumanOrigin`, so an MCP caller structurally cannot accept or reject its own proposals
 * (which is why 396-04's catalogue projects neither), and the commit door for this surface is the
 * gated apply instead (D-11).
 *
 * `safeMode: false` because the visibility law is now the scope subset itself (D-05): safe mode is
 * the instance of that law where the only granted scope is `read`, so leaving the registry's
 * cosmetic flag off keeps ONE filter deciding what a caller sees.
 */
export function mcpFunctionCaller(grantedScopes: readonly FunctionScope[]): FunctionCaller {
  return { surface: 'mcp', grantedScopes, safeMode: false, origin: 'agent' }
}

/**
 * The default-grant caller (D-07), kept as a named export because two suites and the conformance
 * job compose against it.
 */
export const MCP_FUNCTION_CALLER: FunctionCaller = mcpFunctionCaller(DEFAULT_MCP_SCOPES)

/** Re-exported so the default grant has ONE definition in the process; see `mcp-token-resolution`. */
export { DEFAULT_MCP_SCOPES as MCP_DEFAULT_GRANTED_SCOPES }

/** How a request was refused before it reached any server instance. */
export type McpHttpRefusal = 'host' | 'origin' | 'auth'

/**
 * The masker this host composes (T-396-17).
 *
 * BUILT THROUGH THE RUN PATH'S OWN PRODUCER rather than assembled here — 395-04's sibling-input
 * law: the values this host hides and the values a run hides are then one set by construction
 * instead of two lists that agree today. The run's other two channels (a live secret store,
 * captured auth state) are run-scoped and do not exist in a server process.
 *
 * THE DECLARED CREDENTIALS ARE SEEDED EXPLICITLY, and that second argument is the whole reason
 * this is a named function rather than three lines inside the action. `sensitiveEnvSlice` selects
 * environment variables BY NAME SUFFIX; nothing obliges an operator to point `tokenEnvVar` at a
 * name ending in `_TOKEN`, so without this seeding the one credential this process definitionally
 * holds would be the one credential the masker did not know about. That is not a hypothetical
 * ordering of words: 396-03 measured that dropping the masker from a single refusal path left an
 * entire suite green. A differential cell drives this function and reds when the seeding goes.
 *
 * Exported so the MCPS-04 suite masks with the object the command masks with. A suite that built
 * its own masker would be asserting that ITS masker works.
 */
export function composeMcpMasking(input: {
  tokens: readonly ResolvedMcpToken[]
  env: NodeJS.ProcessEnv
}): ReturnType<typeof buildRunMaskingContext> {
  return buildRunMaskingContext({
    env: input.env,
    secretStore: mcpTokenSecretStore(input.tokens),
  })
}

/**
 * Bind a resolved scope set to a registry and a masker.
 *
 * THE ONE PLACE deps are composed, so stdio and HTTP cannot drift into two different servers. What
 * a transport supplies is a scope set; everything else is the same object.
 */
function mcpServerDeps(input: {
  registry: Parameters<typeof buildAgentQaMcpServer>[0]['registry']
  maskText: (text: string) => string
  grantedScopes: readonly FunctionScope[]
}) {
  return {
    registry: input.registry,
    caller: mcpFunctionCaller(input.grantedScopes),
    maskText: input.maskText,
  }
}

/**
 * The loopback request listener: Host, Origin, bearer, handler — in that order (D-10).
 *
 * EXPORTED because a differential that drives anything other than this function is measuring a
 * second implementation of the guard order. MCPS-04's cells bind a real socket to this listener and
 * speak real `Authorization` headers over it, which is the only way to assert on the surface a
 * caller actually reads.
 *
 * `onRefusal` exists so a test can tell WHICH wall answered without this function writing a
 * diagnostic that would then be a channel for the header it just refused. Nothing in production
 * passes it.
 */
export function createMcpHttpRequestListener(input: {
  registry: Parameters<typeof buildAgentQaMcpServer>[0]['registry']
  maskText: (text: string) => string
  tokens: readonly ResolvedMcpToken[]
  onRefusal?: (refusal: McpHttpRefusal) => void
}): (req: IncomingMessage, res: ServerResponse) => void {
  // Resolved ONCE per request and read by the factory the SDK runs for that request. The scope set
  // is carried on `req.auth`, which `toNodeHandler` forwards as `authInfo` — the official route.
  const nodeHandler = createAgentQaMcpNodeHandler((ctx) =>
    mcpServerDeps({
      registry: input.registry,
      maskText: input.maskText,
      // A request that reached the handler HAS a verdict; the fallback is the D-07 default grant,
      // which is what a request with no `Authorization` header resolved to on the line below.
      grantedScopes: (ctx.authInfo?.scopes as FunctionScope[] | undefined) ?? DEFAULT_MCP_SCOPES,
    }),
  )

  return (req, res) => {
    // (1) DNS-rebinding guard. A browser page on any origin can resolve a name it controls to
    // 127.0.0.1; what it cannot do is change the `Host` header it sends. The SDK's own validator is
    // used rather than a regexp here, so the parsing of ports and IPv6 brackets is the protocol
    // library's problem and not a second reading of the same grammar.
    const host = validateHostHeader(req.headers.host, localhostAllowedHostnames())
    if (!host.ok) {
      input.onRefusal?.('host')
      // The refusal names the CLASS and echoes nothing the caller sent: a 403 body that quoted the
      // rejected header back would make this endpoint a reflector.
      return refuse(res, 403, 'forbidden_host')
    }

    // (2) Origin guard. Absent is allowed — non-browser MCP clients do not send one — and a present
    // value that is not a localhost form is refused, which is the case that matters: a page.
    const origin = validateOriginHeader(req.headers.origin, localhostAllowedOrigins())
    if (!origin.ok) {
      input.onRefusal?.('origin')
      return refuse(res, 403, 'forbidden_origin')
    }

    // (3) The bearer, IN FRONT of the handler and before any server is built. An unmatched
    // credential is a 401 here; it is never degraded to the anonymous default grant, and it never
    // costs a factory call.
    const verdict = matchBearer(req.headers.authorization, input.tokens)
    if (verdict.kind === 'refused') {
      input.onRefusal?.('auth')
      // `WWW-Authenticate` carries the scheme and nothing else — no realm derived from a header, no
      // echo of what was presented. The body is the same shape for a malformed header and a wrong
      // credential, so the 401 tells a prober nothing about which of the two it produced.
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer',
      })
      res.end(JSON.stringify({ error: 'invalid_token' }))
      return
    }

    const authInfo: AuthInfo = {
      token: MCP_AUTH_TOKEN_SENTINEL,
      clientId: verdict.kind === 'token' ? verdict.clientId : 'anonymous',
      scopes: [...verdict.scopes],
      // The SDK's bearer MIDDLEWARE rejects an `AuthInfo` with no expiry; this host does not use
      // that middleware (its verifier interface is an OAuth resource-server shape, and D-06 is a
      // local static credential), and a fabricated expiry on a credential that does not expire
      // would be a fact this host invented. The field is therefore absent, deliberately.
    }
    // `req.auth` is the adapter's documented pass-through slot. Assigned rather than passed because
    // that is the seam `toNodeHandler` reads (measured on 2.0.0 — RESEARCH A3).
    ;(req as IncomingMessage & { auth?: AuthInfo }).auth = authInfo

    void nodeHandler(req, res)
  }
}

function refuse(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error }))
}

export function createMcpCommand(): Command {
  const cmd = new Command('mcp')
    .description('Start MCP (Model Context Protocol) server over stdio, or over loopback HTTP')
    .option(
      '--http [port]',
      `serve over stateless HTTP bound to ${MCP_HTTP_BIND_HOST} instead of stdio`,
    )
    .action(async (options: { http?: string | boolean }, command: Command) => {
      try {
        const program = command.parent
        const globalOpts = program?.opts<{ config?: string }>() ?? {}
        // Tolerant exactly as the v1 command was: a project whose configuration will not resolve
        // still gets a server, because analytics configuration is the only thing this read fed in
        // plan 01 and refusing to start over it would be refusing the capability over the telemetry.
        //
        // THE TOKEN BLOCK IS THE ONE EXCEPTION, and it is a deliberate one: `services.mcp.tokens`
        // is a security declaration, so a config that will not parse means this host does not know
        // what its own credentials are. It then serves the D-07 default grant to everybody, which
        // is the correct answer for a host with no declarations — and never a wider one.
        let config: Awaited<ReturnType<typeof resolveConfig>> | undefined
        try {
          config = await resolveConfig({ configPath: globalOpts.config })
        } catch {
          config = undefined
        }

        const configPath = resolve(globalOpts.config ?? 'agent-qa.config.yaml')
        const agentQaRoot = resolve(dirname(configPath), '.agent-qa')

        // D-06: every declared credential is dereferenced ONCE, here, at start. A declared variable
        // that is unset throws out of this call and the process refuses to start naming the
        // VARIABLE — which is the whole point, because a server that started while silently
        // dropping a token would present an operator with a working endpoint that rejects the
        // credential they just configured.
        const tokens = resolveMcpTokens(config?.services?.mcp?.tokens ?? [], process.env)

        // See `composeMcpMasking` — the seeding of the declared credentials is the load-bearing
        // half, and it is documented there because that is the function a differential drives.
        const masking = composeMcpMasking({ tokens, env: process.env })
        const maskText = (text: string) => masking.mask(text)

        // 398-10 (D-17/D-19/D-20): THIS COMMAND'S ANALYTICS COMPOSITION ROOT. Composed after the
        // masking context above and pointed at it immediately, because this process's declared
        // credentials are exactly the values that must never ride an event off the machine.
        //
        // `config` may be `undefined` here — the read above is tolerant on purpose — and that is a
        // real posture rather than a gap: with no config there is no `analytics.privacy` to honour,
        // and the ecosystem opt-out variable is read inside `composeAnalytics` either way. (That
        // variable is deliberately not SPELLED anywhere in this file: a census over this package's
        // shipped source refuses any mention of it outside the one binding that explains the rule,
        // and a census that had to tell prose from code would be a weaker census.)
        const analytics = await composeAnalyticsHost({
          surface: 'mcp',
          ...(config === undefined ? {} : { config }),
          maskingContext: { mask: maskText },
        })

        const host = composeCliLocalAgent({
          // 398-10 (D-11/D-18): the explain counter hooks bind against this port inside the
          // composition root, so `agent.explain` is countable over MCP exactly as it is in chat.
          analytics,
          agentQaRoot,
          configPath,
          // 396-01 D-09: the confirm port is REFUSED, not merely unsupplied. The field is present
          // and `undefined`, which this composition root reads as "this host must never ask" —
          // absent would default to a tty prompt, and on the one process whose stdout IS the
          // JSON-RPC channel a prompt written there does not go unanswered, it breaks the
          // connection. An ask-tier capability therefore fails closed here, which is the correct
          // answer for a caller with nobody behind it.
          confirm: undefined,
          // `applyDelegate` is deliberately NOT passed. The composition root's own default is
          // already a closure over `invokeViaDaemon` — the same socket every other capability
          // crosses — so an apply that needs a lease a running daemon holds is handed to that
          // daemon. Supplying one here would be a second transport for one job (D-09).
        })

        // 2026-08-17 (Phase 398 plan 10, D-18): `agent-qa.mcp.tool.invoked` HAS NO EMITTER YET, and
        // saying so here is more honest than a half-wired one.
        //
        // There is no seam this host can reach. A tool call is dispatched inside
        // `buildAgentQaMcpServer`, and the two things a host holds — the registry and the caller —
        // cannot observe it: the registry's internals are keyed by object identity in a `WeakMap`,
        // so a decorating wrapper is simply an object `invokeFunction` finds no specs on, and the
        // caller is a credential rather than an invoke. Wrapping the SDK's `tools/call` dispatch is
        // possible and is exactly what `installV1NameRedirect` does — inside `packages/mcp`, which
        // is where a hook belongs.
        //
        // WHAT IT NEEDS: an optional `onToolInvoked` observation on `AgentQaMcpServerDeps`, called
        // at the two `registerTool` sites with the tool name, a duration and a success/error verdict
        // — counts and closed vocabularies, nothing a caller supplied. This host then maps it onto
        // the union member and captures it through the port already composed above. That is a
        // change to `packages/mcp`, which this plan does not own; it is filed in
        // `.planning/.../deferred-items.md`.
        const overHttp = options.http !== undefined && options.http !== false
        const mcpTransport = overHttp ? 'http' as const : 'stdio' as const
        // The lifecycle pair is emitted from ONE place for each half, and `onServing` is what makes
        // the `started` half a fact rather than an intention: it fires where each serving entry
        // writes its own startup line — after the socket is bound / the stdio entry is live — so an
        // `agent-qa mcp` that failed to bind reports nothing rather than a server that never was.
        const emitLifecycle = (state: 'started' | 'stopped'): void => {
          analytics.port.capture(analyticsEvent(analytics, 'agent-qa.mcp.server.lifecycle', {
            mcp_server_state: state,
            mcp_transport: mcpTransport,
            // `mcp_tool_count` is DELIBERATELY ABSENT and the field stays optional for this reason.
            // How many tools exist is `visibleToCaller`'s verdict, computed inside
            // `buildAgentQaMcpServer` per caller — and under HTTP there is one instance per REQUEST,
            // so there is no single number for the process. Counting here would mean re-running the
            // visibility law outside the file that owns it: a second census of a security rule, to
            // put a number on a chart. Retune: when the builder reports its own registered count,
            // that number can ride here.
          }))
        }

        try {
          if (overHttp) {
            await serveOverHttp({
              port: httpPort(options.http as string | boolean),
              registry: host.registry,
              maskText,
              tokens,
              onServing: () => emitLifecycle('started'),
            })
          } else {
            await serveOverStdio({
              registry: host.registry,
              maskText,
              grantConfigWrite: config?.services?.mcp?.stdio?.grantConfigWrite === true,
              onServing: () => emitLifecycle('started'),
            })
          }
        } finally {
          emitLifecycle('stopped')
          await host.close().catch(() => {})
          masking.dispose()
          // The PORT's shutdown, not an ambient `flushAnalytics({ config })`. The v1 call drained a
          // process-global service this command never captured through; this one drains the object
          // this command composed, and releases the transport's timers so the process can exit.
          await analytics.shutdown()
        }
      } catch (err) {
        console.error(
          pc.red('Failed to start MCP server:'),
          err instanceof Error ? err.message : String(err),
        )
        process.exitCode = 1
      }
    })

  return cmd
}

/** `--http` with no value is the default port; `--http 4000` is that port. */
function httpPort(value: string | boolean): number {
  if (value === true) return MCP_HTTP_DEFAULT_PORT
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`--http expects a port between 1 and 65535, received ${String(value)}`)
  }
  return parsed
}

async function serveOverStdio(input: {
  registry: Parameters<typeof buildAgentQaMcpServer>[0]['registry']
  maskText: (text: string) => string
  grantConfigWrite: boolean
  /** Fired once the entry is live — see the lifecycle note at the call site. */
  onServing?: () => void
}): Promise<void> {
  // D-07's second half: stdio has no header to carry an exception, so `config-write` arrives only
  // through the config opt-in, which defaults to false.
  const grantedScopes = resolveStdioScopes(input.grantConfigWrite)
  const handle = serveStdio(() =>
    buildAgentQaMcpServer(
      mcpServerDeps({ registry: input.registry, maskText: input.maskText, grantedScopes }),
    ),
  )
  // stderr, never stdout — see the file header. Written after the serving entry is live so the line
  // is a fact about a running server rather than an intention.
  process.stderr.write(`${MCP_STDIO_STARTUP_MESSAGE}\n`)
  input.onServing?.()
  // The process serves until its stdin closes, which is how a spawning client stops it.
  await new Promise<void>((settle) => {
    process.stdin.once('end', () => settle())
    process.stdin.once('close', () => settle())
  })
  await handle.close()
}

async function serveOverHttp(input: {
  port: number
  registry: Parameters<typeof buildAgentQaMcpServer>[0]['registry']
  maskText: (text: string) => string
  tokens: readonly ResolvedMcpToken[]
  /** Fired once the socket is bound — see the lifecycle note at the call site. */
  onServing?: () => void
}): Promise<void> {
  const server = createServer(
    createMcpHttpRequestListener({
      registry: input.registry,
      maskText: input.maskText,
      tokens: input.tokens,
    }),
  )
  await new Promise<void>((listening, failed) => {
    server.once('error', failed)
    // The bind address is a CONSTANT and never a config value. `services.mcp.host` accepts
    // `localhost`, which on a dual-stack machine can resolve to `::1` and back — and an operator
    // who could widen this to `0.0.0.0` through configuration would be one typo from exposing an
    // ungated function registry to their network.
    server.listen(input.port, MCP_HTTP_BIND_HOST, () => listening())
  })
  // stderr, and the bound address as the OS reports it rather than as it was requested — a message
  // naming a port the server did not get is worse than no message.
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : input.port
  process.stderr.write(
    `agent-qa MCP server listening on http://${MCP_HTTP_BIND_HOST}:${bound}/. `
    + `Stateless: one server instance per request, no session id.\n`,
  )
  input.onServing?.()
  await new Promise<void>((settle) => {
    process.once('SIGINT', () => settle())
    process.once('SIGTERM', () => settle())
    server.once('close', () => settle())
  })
  await new Promise<void>((closed) => server.close(() => closed()))
}
