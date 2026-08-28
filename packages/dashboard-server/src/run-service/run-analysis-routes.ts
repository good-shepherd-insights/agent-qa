// The run-ANALYSIS read route (Phase 406 plan 01, D-04).
//
// `GET /api/runs/:id/analysis` locally, `GET /run/:runId/analysis` on the authed remote door, and
// BOTH call the one function below. This module is the whole of the HTTP half: validate the id
// with the OP'S OWN input schema, dispatch through the injected host, map the op's named refusals
// onto status codes. IT FORMATS NOTHING. It composes no sentence, folds no cluster and opens no
// database — `analysis.get` is THE single producer of a run's verdicts, sentences and clusters
// (389 D-11), and a second producer on this door is the 405 D-01 anti-pattern restated.
//
// BOTH DOORS, ONE ADAPTER (D-04). 405 D-12/D-13 established the shape and 405-05 proved why: two
// doors resolving one read through two implementations means "the same analysis" depends on which
// credential asked. The sibling detail adapter's own note says a second spelling agrees on the day
// it is written and is a wire-contract fork thereafter.
//
// ONLY THE HUMAN DOOR RESTORES. The verdict sentence QUOTES PRODUCER TEXT — the failing step's
// recorded error, which `templateSentenceParts` lifts verbatim into `observed (step N): "…"` — so
// it carries `<SECRET_n>` at rest exactly as `failureSummary` does. The local arm passes
// `boundary: 'human'` and the body crosses `unmaskTreeForDisplay`; the bearer-authed remote row
// passes nothing and stays masked by the option's `'machine'` default, because a token
// authenticates a CLIENT and not a person's browser session (405-10, D-12's masking clause).
//
// THE REFUSAL VOCABULARY IS IMPORTED, NEVER RESPELLED. `refusalFor` is the detail adapter's, made
// exported for this file; `unknown_run` / `agent_host_unavailable` / `read_failed` mean here
// exactly what they mean one module away.

import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  AnalysisGetInputSchema,
  type AnalysisGetOutput,
} from '@vostride/agent-qa-schema'

import type { AgentHost } from '../chat/host.js'
import { unmaskTreeForDisplay } from '../masking/display-tree.js'
import { refuseCrossSiteRequest } from '../server/cross-site.js'
import { refusalFor, respondJson, type RunDetailRefusal } from './run-detail-routes.js'

export type RunAnalysisReadOutcome =
  | { readonly kind: 'ok'; readonly body: AnalysisGetOutput }
  | RunDetailRefusal

/**
 * THE READ. Exported so a cell can measure the outcome without a socket, and so both doors answer
 * with byte-identical bytes by CALLING this rather than by a second spelling that agrees today.
 */
export async function readRunAnalysis(
  host: AgentHost,
  runId: string,
): Promise<RunAnalysisReadOutcome> {
  // THE ID IS VALIDATED BY THE OP'S OWN INPUT SCHEMA, HERE, BEFORE THE DOOR IS TOUCHED. Not a
  // second regex: `runIdSchema` refuses exactly the ids the path layer would have to REWRITE
  // before using them, and the whole point of that codec is that there is one of it.
  const parsed = AnalysisGetInputSchema.safeParse({ runId })
  if (!parsed.success) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_run_id' } }
  }

  try {
    const analysis = await host.invokeFunction(
      host.registry,
      host.analysisGetFunctionId,
      parsed.data,
      host.caller,
    ) as AnalysisGetOutput
    return { kind: 'ok', body: analysis }
  } catch (error) {
    return refusalFor(error)
  }
}

export interface RunAnalysisReadDeps {
  /** The DECODED run id. Decoding can throw, and that throw is the caller's refusal to answer. */
  readonly runId: string
  /** The injected host. Its absence is the ROUTER'S 503, not this function's. */
  readonly host: AgentHost
  /**
   * WHO IS ON THE OTHER END OF THIS SOCKET — and therefore whether masked placeholders are
   * restored on the way out. `'machine'` by default, which is the masked posture: restoration is
   * something an arm has to ASK for, in one token, at a place a reader can see.
   *
   * `'human'` IS PASSED BY EXACTLY ONE ARM: the LOCAL door's `GET /api/runs/:id/analysis` in
   * `routes.ts`. The remote `GET /run/:runId/analysis` row passes nothing.
   */
  readonly boundary?: 'human' | 'machine'
}

/** `GET /api/runs/:id/analysis` — the failure view's one read (D-04). */
export function serveRunAnalysisRead(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RunAnalysisReadDeps,
): void {
  // THE SAME-SITE GUARD, GATED ON `boundary` FOR THE REASON THE DETAIL ADAPTER RECORDS (405 CR-01):
  // this arm's seam call is the line below, in this file, and the remote door dispatches the same
  // function from a legitimately non-loopback Host. An unconditional check would refuse the door
  // it was not written for; gated, the refusal fires exactly when restoration does.
  if (deps.boundary === 'human' && refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readRunAnalysis(deps.host, deps.runId).then(
    (outcome) => {
      if (outcome.kind === 'refused') {
        respondJson(res, outcome.status, outcome.body)
        return
      }
      // THE SEAM, PER STRING ON THE RESULT TREE AND NEVER ON THE SERIALIZED BODY. A restored value
      // carrying a quote would break a body unmasked after `JSON.stringify`; walked before it, the
      // value is escaped like any other string. A refusal body is NEVER walked: it holds this
      // door's own closed words and nothing a run ever masked.
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
