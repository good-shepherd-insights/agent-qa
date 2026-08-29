// The run-KNOWLEDGE read route (Phase 407 plan 01, LERN-01 / LERN-02 · D-05).
//
// `GET /api/runs/:id/knowledge` is what the Knowledge tab reads, and this module is the whole of
// the HTTP half: validate the id with the OP'S OWN input schema, dispatch through the injected
// host, map the op's named refusals onto status codes. IT FORMATS NOTHING. It composes no summary
// line, folds no channel and opens no database — `runs.knowledge` is THE single producer of what
// a run used and learned (407 D-05), and a second producer on this door is the 405 D-01
// anti-pattern restated one surface later.
//
// ONE ADAPTER, ON THE ANALYSIS ARM'S FOOTING (406 D-04). The local door is the only door that
// serves this today, and the function is still written as an adapter both doors could call
// because that is what stopped `runs.detail` and `analysis.get` from forking: two doors resolving
// one read through two implementations means "the same run's knowledge" depends on which
// credential asked.
//
// ONLY THE HUMAN DOOR RESTORES. The projection carries PRODUCER TEXT throughout — each step's
// `stepText`, every served brief line's summary, every caution's sentence — and handoff narration
// is masked at rest, so those strings arrive carrying `<SECRET_n>` exactly as `failureSummary`
// does. The local arm passes `boundary: 'human'` and the body crosses `unmaskTreeForDisplay`; a
// bearer-authed remote row would pass nothing and stay masked by the option's `'machine'` default,
// because a token authenticates a CLIENT and not a person's browser session (405-10, D-09).
//
// THE REFUSAL VOCABULARY IS IMPORTED, NEVER RESPELLED. `refusalFor` is the detail adapter's;
// `unknown_run` / `agent_host_unavailable` / `read_failed` mean here exactly what they mean two
// modules away. Note that `unknown_run` is nearly unreachable through THIS op by design: a run
// whose handoff is gone answers `kind: 'evidence-incomplete'` with a 200, because D-06 makes a
// pruned handoff a RESULT the page renders rather than a refusal it has to catch.

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  RunsKnowledgeInputSchema,
  type RunKnowledgeProjection,
} from '@vostride/agent-qa-schema'

import type { AgentHost } from '../chat/host.js'
import { unmaskTreeForDisplay } from '../masking/display-tree.js'
import { refuseCrossSiteRequest } from '../server/cross-site.js'
import { refusalFor, respondJson, type RunDetailRefusal } from './run-detail-routes.js'

export type RunKnowledgeReadOutcome =
  | { readonly kind: 'ok'; readonly body: RunKnowledgeProjection }
  | RunDetailRefusal

/**
 * THE READ. Exported so a cell can measure the outcome without a socket, and so any second door
 * answers with byte-identical bytes by CALLING this rather than by a second spelling that agrees
 * on the day it is written.
 */
export async function readRunKnowledge(
  host: AgentHost,
  runId: string,
): Promise<RunKnowledgeReadOutcome> {
  // THE ID IS VALIDATED BY THE OP'S OWN INPUT SCHEMA, HERE, BEFORE THE DOOR IS TOUCHED
  // (T-407-01). Not a second regex: `runIdSchema` refuses exactly the ids the path layer would
  // have to REWRITE before using them, and the whole point of that codec is that there is one of
  // it. Refusing early also means an untrusted path segment never reaches a dispatch at all.
  const parsed = RunsKnowledgeInputSchema.safeParse({ runId })
  if (!parsed.success) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_run_id' } }
  }

  try {
    const projection = await host.invokeFunction(
      host.registry,
      host.runsKnowledgeFunctionId,
      parsed.data,
      host.caller,
    ) as RunKnowledgeProjection
    return { kind: 'ok', body: projection }
  } catch (error) {
    return refusalFor(error)
  }
}

export interface RunKnowledgeReadDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's refusal to answer. */
  readonly runId: string
  /** The injected host. Its absence is the ROUTER'S 503, not this function's. */
  readonly host: AgentHost
  /**
   * WHO IS ON THE OTHER END OF THIS SOCKET — and therefore whether masked placeholders are
   * restored on the way out. `'machine'` by default, which is the masked posture: restoration is
   * something an arm has to ASK for, in one token, at a place a reader can see.
   *
   * `'human'` IS PASSED BY EXACTLY ONE ARM: the LOCAL door's `GET /api/runs/:id/knowledge` in
   * `routes.ts`. Any authed remote row passes nothing and stays masked by construction.
   */
  readonly boundary?: 'human' | 'machine'
}

/** `GET /api/runs/:id/knowledge` — the Knowledge tab's one read (D-05). */
export function serveRunKnowledgeRead(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RunKnowledgeReadDeps,
): void {
  // THE SAME-SITE GUARD, GATED ON `boundary` FOR THE REASON THE DETAIL ADAPTER RECORDS (405
  // CR-01): this arm's seam call is the line below, in this file, and any remote door dispatches
  // the same function from a legitimately non-loopback Host. An unconditional check would refuse
  // the door it was not written for; gated, the refusal fires exactly when restoration does.
  //
  // `respondJson` already writes no cross-origin grant, so a page on another ORIGIN cannot read
  // this body. What that does not stop is DNS rebinding — the attacker's own name resolves to
  // loopback, so the browser treats the read as same-origin and asks for no grant at all. The Host
  // check inside `refuseCrossSiteRequest` is the rung that closes it, and it ADMITS the caller
  // that sends no `Origin`, which is the local non-browser drive this door also serves.
  if (deps.boundary === 'human' && refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readRunKnowledge(deps.host, deps.runId).then(
    (outcome) => {
      if (outcome.kind === 'refused') {
        respondJson(res, outcome.status, outcome.body)
        return
      }
      // THE SEAM, PER STRING ON THE PROJECTION TREE AND NEVER ON THE SERIALIZED BODY (405
      // Pitfall 3). A restored value carrying a quote would break a body unmasked after
      // `JSON.stringify`; walked before it, the value is escaped like any other string. A refusal
      // body is NEVER walked: it holds this door's own closed words and nothing a run ever masked.
      respondJson(
        res,
        200,
        deps.boundary === 'human'
          ? unmaskTreeForDisplay(deps.host, outcome.body, { runId: deps.runId })
          : outcome.body,
      )
    },
    // The read classifies every refusal it can name; anything reaching here is this module
    // failing, which is a 500 by name and never a body that looks like an answer.
    (error: unknown) => { respondJson(res, 500, refusalFor(error).body) },
  )
}
