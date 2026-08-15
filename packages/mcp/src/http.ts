// The loopback HTTP face of the same catalog (Phase 396 plan 01, D-10 / MCPS-05).
//
// WHY THIS FILE EXISTS, AND WHY IT EXISTS NOW rather than with the plan that first mounts it. Two
// consumers need an HTTP face of this server and neither is a product feature: the conformance
// suite's `server` mode takes a URL and cannot spawn a stdio command (measured in this phase's
// research — D-17's stated shape is unrunnable as written), and any driver that wants to exercise
// the wire without a child process reaches for the same handler. Shipping the FACTORY here, with no
// socket and no lifecycle, is what lets plan 07 point `conformance server --url` at the shipped
// artifact instead of at something a CI script assembled.
//
// IT BINDS NOTHING. `createAgentQaMcpNodeHandler` returns a request FUNCTION. Creating a server,
// choosing a port, deciding which interface to listen on and validating Host/Origin are all the
// host's, which is what keeps this package free of every host API — it names no `node:` module, and
// neither does the adapter it calls, because the SDK's own adapter is duck-typed for exactly this.
//
// THE V1 WILDCARD CORS HEADER IS NOT CARRIED FORWARD, and this comment is where a future reader who
// goes looking for it finds out why. The deleted `local-http.ts` answered every request and every
// preflight with `Access-Control-Allow-Origin: *`, which on a loopback JSON-RPC endpoint invites the
// DNS-rebinding reach the v2 docs put host and origin guards in front of the handler to refuse.
// Nothing here emits a CORS header; a host that decides it needs one is deciding that on purpose.
//
// Protocol grounding: SEP-2575 (stateless — the factory below runs once per REQUEST, holds nothing
// between them, and there is no session id anywhere), SEP-2567 (list results no longer vary per
// connection; the variance is per caller, resolved from `authInfo` in front of the handler).

import { createMcpHandler } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'

import { buildAgentQaMcpServer } from './catalog.js'
import type { AgentQaMcpServerDeps } from './catalog.js'

/**
 * How a host answers "who is this request, and what may they see?" — once per request.
 *
 * It takes the SDK's own construction context, so the two facts a per-caller server can vary on —
 * `authInfo` and `era` — arrive here rather than being read back out of a header inside a tool
 * handler. What it returns is the same `deps` a stdio host composes, which is what keeps ONE
 * `buildAgentQaMcpServer` shape across both transports: they differ in how scopes are resolved and
 * in nothing else.
 */
export type AgentQaMcpDepsResolver = (ctx: McpRequestContext) => AgentQaMcpServerDeps

/**
 * A Node request handler serving this catalog over stateless streamable HTTP.
 *
 * The factory is re-run per request, which is the SDK's own model and not an inefficiency to route
 * around: a per-request instance is what makes a caller's tool set a property of that caller rather
 * than of whoever connected first, and it is why absence stays structural on this transport too.
 *
 * IT TAKES A RESOLVER AND NOT A FIXED `deps`, and the difference is the whole of plan 05. Bearer
 * verification happens in FRONT of this handler: the host reads the `Authorization` header, decides
 * a scope set, and attaches the verdict as `req.auth`, which `toNodeHandler` forwards as the
 * handler's pass-through `authInfo` (measured on `@modelcontextprotocol/node@2.0.0`, whose own doc
 * comment states it — no fetch-wrapper is needed on the Node path, resolving RESEARCH assumption
 * A3). This function then hands that context to the resolver and the resolver decides what the
 * instance is built with. Reading an `Authorization` header inside a tool handler would be a second
 * vocabulary for one question, and verifying a token twice in two places is how the two answers
 * start to differ.
 *
 * A host with one fixed caller passes `() => deps` — the static case is the degenerate resolver,
 * not a second signature to keep in step.
 */
export function createAgentQaMcpNodeHandler(resolveDeps: AgentQaMcpDepsResolver) {
  return toNodeHandler(createMcpHandler((ctx) => buildAgentQaMcpServer(resolveDeps(ctx))))
}
