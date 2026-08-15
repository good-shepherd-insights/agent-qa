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
import { toNodeHandler } from '@modelcontextprotocol/node'

import { buildAgentQaMcpServer } from './catalog.js'
import type { AgentQaMcpServerDeps } from './catalog.js'

/**
 * A Node request handler serving this catalog over stateless streamable HTTP.
 *
 * The factory is re-run per request, which is the SDK's own model and not an inefficiency to route
 * around: a per-request instance is what makes a caller's tool set a property of that caller rather
 * than of whoever connected first, and it is why absence stays structural on this transport too.
 *
 * `deps` is resolved by the HOST, not from the request. Bearer verification happens in FRONT of
 * this handler and its verdict arrives as `req.auth`, which the adapter forwards as the handler's
 * pass-through `authInfo`; reading an `Authorization` header inside a tool handler would be a second
 * vocabulary for one question. Plan 05 wires that resolution — until then every caller of this face
 * is the one the host composed.
 */
export function createAgentQaMcpNodeHandler(deps: AgentQaMcpServerDeps) {
  return toNodeHandler(createMcpHandler(() => buildAgentQaMcpServer(deps)))
}
