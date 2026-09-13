// The run-detail READ route (Phase 405 plan 01, D-03).
//
// `GET /api/runs/:id/detail` is what the rebuilt run-detail page reads, and this module is the
// whole of the HTTP half: validate the id with the OP'S OWN input schema, dispatch through the
// injected host, map the op's named refusals onto status codes. It formats nothing. It opens no
// database. There is no SQLite read in `routes.ts` for this arm and there must never be one —
// that was the shipped v1 arrangement, and a private store read is a capability the function
// layer cannot see, cannot audit and cannot offer to the CLI, MCP or chat (D-03, the fourth-door
// law of 404 D-16).
//
// EVERY REFUSAL IS NAMED, on `post-processing-routes.ts`'s measured precedent. A page unable to
// distinguish an unrecorded run and a composition that binds no run-detail port renders one grey
// error for two completely different operator actions. Names are read STRUCTURALLY off
// `error.name` because this package may not import the packages that mint those classes
// (validate:arch), and comparing messages would be comparing against prose somebody will rewrite.

import type { IncomingMessage, ServerResponse } from 'node:http'

import { redactAuthStateValue as sanitizeAuthStateForResponse } from '@vostride/agent-qa-core'
import {
  RunsArtifactInputSchema,
  RunsDetailInputSchema,
  type RunDetailProjection,
  type RunsArtifactResult,
} from '@vostride/agent-qa-schema'

import type { AgentHost } from '../chat/host.js'
import { unmaskTreeForDisplay } from '../masking/display-tree.js'
import { refuseCrossSiteRequest } from '../server/cross-site.js'

/** A refusal, already carrying its status and its single-key body. */
export interface RunDetailRefusal {
  readonly kind: 'refused'
  readonly status: number
  readonly body: Record<string, string>
}

export type RunDetailReadOutcome =
  | { readonly kind: 'ok'; readonly body: RunDetailProjection }
  | RunDetailRefusal

/** The name a rejection carries, read structurally — never by class, never by message. */
function errorNameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UnknownError'
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : 'UnknownError'
}

function errorMessageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

/**
 * The op's refusals, classified into this door's vocabulary.
 *
 * `FunctionNotBoundError` CARRIES ITS MESSAGE because that text tells an operator what to do —
 * which op this host does not bind. `RunNotFoundError` does NOT: it would echo the requested id
 * back into a response body, and a refusal that quotes untrusted input is a reflection this door
 * has no reason to offer. Anything else is an unclassified throw from inside the store, whose
 * message may name a path or quote a row; that one travels as a NAME, which is a classification
 * rather than a disclosure.
 *
 * EXPORTED SINCE 406-01 (D-04). `run-analysis-routes.ts` dispatches `analysisGetFunctionId` through
 * the same host and meets the same three refusals; a second spelling of `unknown_run` /
 * `agent_host_unavailable` / `read_failed` there would be a second vocabulary for one door, free to
 * drift the first time either side gains a class.
 */
export function refusalFor(error: unknown): RunDetailRefusal {
  const name = errorNameOf(error)
  if (name === 'RunNotFoundError') {
    return { kind: 'refused', status: 404, body: { error: 'unknown_run' } }
  }
  if (name === 'FunctionNotBoundError') {
    return {
      kind: 'refused',
      status: 503,
      body: { error: 'agent_host_unavailable', reason: errorMessageOf(error) },
    }
  }
  return { kind: 'refused', status: 500, body: { error: 'read_failed', reason: name } }
}

/**
 * THE READ. Exported so a cell can measure the outcome without a socket, and so any second door
 * (405-05's authed remote row) answers with byte-identical bytes by CALLING this rather than by a
 * second spelling that agrees today.
 */
export async function readRunDetail(
  host: AgentHost,
  runId: string,
): Promise<RunDetailReadOutcome> {
  // THE ID IS VALIDATED BY THE OP'S OWN INPUT SCHEMA, HERE, BEFORE THE DOOR IS TOUCHED
  // (T-405-01). Not a second regex: `runIdSchema` refuses exactly the ids the path layer would
  // have to REWRITE before using them, and the whole point of that codec is that there is one of
  // it. Refusing early also means an untrusted path segment never reaches a dispatch at all.
  const parsed = RunsDetailInputSchema.safeParse({ runId })
  if (!parsed.success) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_run_id' } }
  }

  try {
    const projection = await host.invokeFunction(
      host.registry,
      host.runsDetailFunctionId,
      parsed.data,
      host.caller,
    ) as RunDetailProjection
    return { kind: 'ok', body: projection }
  } catch (error) {
    return refusalFor(error)
  }
}

/**
 * This door's JSON writer — and the ABSENCE of a cross-origin grant on it is load-bearing (405 CR-01).
 *
 * `serveRunDetailRead` crosses the display seam, so this body carries the RESTORED CLEARTEXT of a
 * declared secret. `Content-Type` and `Content-Length` are the whole header set on purpose: no
 * `Access-Control-Allow-Origin`, because a page on another origin that the operator happens to have
 * open must not be able to read a run's secrets out of this response. Until CR-01 that posture was
 * an accident of which writer this file inherited rather than a decision, and the sibling arms in
 * `server/routes.ts` — which answered through the wildcard-writing `json()` — proved how easily the
 * accident goes the other way. If a later refactor wants one JSON writer across both files, the one
 * it converges on must be the no-grant one.
 *
 * EXPORTED SINCE 406-01: `run-analysis-routes.ts` is that later refactor's first caller, and it
 * converged on this writer rather than minting a second one.
 */
export function respondJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent || res.writableEnded) {
    res.destroy()
    return
  }
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

export interface RunDetailReadDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's refusal to answer. */
  readonly runId: string
  /** The injected host. Its absence is the ROUTER'S 503, not this function's. */
  readonly host: AgentHost
  /**
   * WHO IS ON THE OTHER END OF THIS SOCKET (405-10, D-09) — and therefore whether masked
   * placeholders are restored on the way out.
   *
   * IT DEFAULTS TO `'machine'`, WHICH IS THE MASKED POSTURE, and the default is the whole point.
   * A door that has not thought about who is reading gets today's behaviour: the projection travels
   * exactly as the subscriber wrote it, placeholders and all. Restoration is something an arm has
   * to ASK for, in one token, at a place a reader can see — which is the fail-closed direction
   * for a seam whose failure mode is putting a credential on a wire.
   *
   * `'human'` IS PASSED BY EXACTLY ONE ARM: the LOCAL door's `GET /api/runs/:id/detail` in
   * `routes.ts`. The authed REMOTE door's `GET /run/:runId/detail` (`run-service-routes.ts`,
   * 405-05) passes nothing and stays masked by construction — a bearer token authenticates a
   * CLIENT, not a person's browser session, so restoring there would hand declared secrets to every
   * token holder and every intermediary. 405-05 recorded that as a deliberate reversal of a
   * CONTEXT.md integration point; reversing it back is adding `boundary: 'human'` to that dispatch.
   */
  readonly boundary?: 'human' | 'machine'
}

/** `GET /api/runs/:id/detail` — what the rebuilt run-detail page reads (D-03). */
export function serveRunDetailRead(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RunDetailReadDeps,
): void {
  // THE SAME-SITE GUARD, AND IT IS GATED ON `boundary` BECAUSE THIS FUNCTION SERVES TWO DOORS
  // (405 CR-01, second pass).
  //
  // WHY IT LIVES HERE AND NOT AT THE ROUTER'S DISPATCH. The four sibling arms carry their guard in
  // `routes.ts` because their seam call is in `routes.ts`. This arm's seam call is the line below,
  // in this file, and it is the RICHEST restored body on the door — the whole run-detail
  // projection. A guard placed at the dispatch would sit in a different file from the crossing it
  // protects, which is exactly the split that let this arm be missed in the first pass: an
  // invariant that reads one router cannot see a crossing in another module. Beside the seam, a
  // future caller that opts into `'human'` inherits the guard instead of having to remember it.
  //
  // WHY `boundary === 'human'` AND NOT UNCONDITIONALLY. The authed REMOTE door dispatches this same
  // function with no `boundary`, and that door is legitimately reached at a NON-loopback Host. An
  // unconditional loopback check here would refuse every real remote read — a guard that breaks the
  // door it was not written for. Gating on `boundary` makes the refusal fire exactly when
  // restoration fires: the local human arm, and only it.
  //
  // WHAT IT IS FOR, GIVEN CORS IS ALREADY CLOSED HERE. `respondJson` writes no cross-origin grant,
  // so a page on another ORIGIN already cannot read this body. What the grant's absence does NOT
  // stop is DNS rebinding — the attacker's own name resolves to loopback, so the browser treats the
  // read as same-origin and asks for no grant at all. The Host check inside `refuseCrossSiteRequest`
  // is the rung that closes that, and it ADMITS the caller that sends no `Origin` at all, which is
  // the local non-browser drive this door also serves.
  //
  // ORDERING. The router decodes the run id before calling this function, so a cross-site caller
  // with an undecodable id still meets that 400 first. That is left as it is: the 400 is a statement
  // about the caller's own input and discloses nothing about any run, where every answer this
  // function can give does.
  if (deps.boundary === 'human' && refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readRunDetail(deps.host, deps.runId).then(
    (outcome) => {
      if (outcome.kind === 'refused') {
        respondJson(res, outcome.status, outcome.body)
        return
      }
      // THE SEAM, PER STRING ON THE PROJECTION TREE AND NEVER ON THE SERIALIZED BODY (Pitfall 3).
      // A restored value carrying a quote would break a body unmasked after `JSON.stringify`;
      // walked before it, the value is escaped like any other string. A refusal body is NEVER
      // walked: it holds this door's own closed words and nothing a run ever masked.
      respondJson(
        res,
        200,
        deps.boundary === 'human'
          // The display seam can restore an entire auth-state JSON string. Sanitize last,
          // just like the other human run reads, so restoration cannot bypass redaction.
          ? sanitizeAuthStateForResponse(
            unmaskTreeForDisplay(deps.host, outcome.body, { runId: deps.runId }),
          )
          : outcome.body,
      )
    },
    // The read classifies every refusal it can name; anything reaching here is this module
    // failing, which is a 500 by name and never a body that looks like an answer.
    (error: unknown) => { respondJson(res, 500, refusalFor(error).body) },
  )
}

// ---- 405-05 (D-12/D-13/D-15 · DETL-03): the ref-RESOLVING arm, on both doors ---------------------
//
// `GET /api/runs/:runId/artifacts/:sha` locally, `GET /run/:runId/artifacts/:sha` on the authed
// remote door, and BOTH call the one function below. The run-detail read hands a page a `sha`; this
// is where that sha becomes an image, and if the two doors resolved it through two implementations
// then "the same artifact" would mean two things depending on which credential asked.
//
// THE BYTES CROSS THE FUNCTION LAYER (D-13). This module constructs no store, joins no path and
// imports nothing that can read a file. Containment is `FsEvidenceArtifactStore`'s own rule —
// `slugBranch` over the runId, a 64-lowercase-hex check over the sha — reached through the op, so
// there is exactly one place in the product where a caller-supplied string becomes a path segment.
//
// THE SHA IS VALIDATED BY THE OP'S OWN INPUT SCHEMA, AND WHICH FIELD FAILED IS THE ANSWER. A
// malformed run id and a malformed sha are different mistakes a caller can fix, so the parse's
// failure paths are read apart rather than collapsed into one 400.
//
// NOTHING ECHOES THE REQUEST. Every refusal body is a fixed shape carrying a closed word; a body
// that quoted the sha would reflect attacker-chosen bytes back through a door that has no reason
// to offer one (T-405-18).

/** The immutable-caching header set a CONTENT ADDRESS earns (D-12). */
const ARTIFACT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export type RunArtifactReadOutcome =
  | {
    readonly kind: 'ok'
    readonly sha: string
    readonly contentType: string
    readonly bytes: Buffer
  }
  | RunDetailRefusal

/**
 * The op's refusals, classified into this door's vocabulary.
 *
 * `EvidenceBlobAbsentError` AND `RunNotFoundError` ARE BOTH 404 AND THEY ARE NOT THE SAME 404
 * (D-15). One says the link names a run nothing recorded; the other says the run is right there and
 * holds no blob under that address — a screenshot the evidence diet collected, a ref that declared
 * itself incomplete, or an artifact never written. The page renders the second as a visible
 * "unavailable" state and the first as a broken link, and it can only do that because the words
 * differ. Neither body carries the sha.
 */
function artifactRefusalFor(error: unknown): RunDetailRefusal {
  const name = errorNameOf(error)
  if (name === 'RunNotFoundError') {
    return { kind: 'refused', status: 404, body: { error: 'unknown_run' } }
  }
  if (name === 'EvidenceBlobAbsentError') {
    return { kind: 'refused', status: 404, body: { error: 'blob_absent' } }
  }
  if (name === 'FunctionNotBoundError') {
    return {
      kind: 'refused',
      status: 503,
      body: { error: 'agent_host_unavailable', reason: errorMessageOf(error) },
    }
  }
  return { kind: 'refused', status: 500, body: { error: 'read_failed', reason: name } }
}

/**
 * THE READ. Exported so a cell can measure the outcome without a socket, and so the authed remote
 * door answers with byte-identical bytes by CALLING this rather than by a second spelling.
 */
export async function readRunArtifact(
  host: AgentHost,
  runId: string,
  sha: string,
): Promise<RunArtifactReadOutcome> {
  const parsed = RunsArtifactInputSchema.safeParse({ runId, sha })
  if (!parsed.success) {
    // WHICH FIELD, not merely THAT it failed. `runIdSchema` refuses exactly the ids the path layer
    // would have to rewrite, and the sha regex refuses everything that is not a content address;
    // telling a caller which of the two it got wrong costs one issue-path read and is the whole
    // difference between an actionable 400 and a shrug.
    const blamesSha = parsed.error.issues.some((issue) => issue.path[0] === 'sha')
    return {
      kind: 'refused',
      status: 400,
      body: { error: blamesSha ? 'malformed_sha' : 'invalid_run_id' },
    }
  }

  try {
    const result = await host.invokeFunction(
      host.registry,
      host.runsArtifactFunctionId,
      parsed.data,
      host.caller,
    ) as RunsArtifactResult
    return {
      kind: 'ok',
      sha: result.sha,
      contentType: result.contentType,
      // The ONE decode in the product. The op encodes without a host API because its package may
      // not name one; this package may, and this is the layer whose job is bytes on a socket.
      bytes: Buffer.from(result.bytesBase64, 'base64'),
    }
  } catch (error) {
    return artifactRefusalFor(error)
  }
}

export interface RunArtifactReadDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's refusal to answer. */
  readonly runId: string
  /** The RAW sha segment. Never decoded: a content address contains nothing percent-encoding
   * could represent, so a segment that needed decoding is already not one. */
  readonly sha: string
  /** The injected host. Its absence is the ROUTER'S 503, not this function's. */
  readonly host: AgentHost
}

/**
 * `GET /api/runs/:runId/artifacts/:sha` — a ref, resolved (D-12).
 *
 * THE HEADERS ARE THE FEATURE AS MUCH AS THE BYTES.
 * - `ETag: "<sha>"` — the content address IS the validator; there is nothing else it could be, and
 *   nothing that could make it stale, because bytes cannot change under a hash of themselves.
 * - `Cache-Control: public, max-age=31536000, immutable` — for the same reason. A revalidation of
 *   an immutable resource is a round trip that can only ever answer "yes, still".
 * - `X-Content-Type-Options: nosniff` — the second half of the T-405-15 mitigation. The op refuses
 *   to NAME a type a browser executes; this refuses to let the browser guess one anyway.
 * - `Content-Length` — from the op's own declared `byteLength` by way of the decoded buffer.
 *
 * `If-None-Match` IS HONOURED because it is three lines against a header set that promises a year
 * of caching, and a client that revalidates anyway should not be made to re-download a screenshot.
 */
export function serveRunArtifact(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RunArtifactReadDeps,
): void {
  void readRunArtifact(deps.host, deps.runId, deps.sha).then(
    (outcome) => {
      if (outcome.kind === 'refused') {
        respondJson(res, outcome.status, outcome.body)
        return
      }
      if (res.headersSent || res.writableEnded) {
        res.destroy()
        return
      }
      const etag = `"${outcome.sha}"`
      // THE VALIDATOR IS COMPARED WHOLE, against the quoted form this door writes. No weak-match
      // and no list parse: this door mints exactly one validator per resource and a request that
      // presents anything else has not seen this resource.
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': ARTIFACT_CACHE_CONTROL })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': outcome.contentType,
        'Content-Length': outcome.bytes.byteLength,
        ETag: etag,
        'Cache-Control': ARTIFACT_CACHE_CONTROL,
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(outcome.bytes)
    },
    // The read classifies every refusal it can name; anything reaching here is this module
    // failing, which is a 500 by name and never a body that looks like an answer.
    (error: unknown) => { respondJson(res, 500, artifactRefusalFor(error).body) },
  )
}
