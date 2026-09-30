// 2026-09-08, 419 D-13: the browser mark door dispatches the same op as the CLI.
// 2026-10-01, 432-14 (D-14): one request, one dispatch. The confirm scope it used to carry, and the
// frame it entered around the call, are deleted with the run-confirm pair.
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  RunsMarkInputSchema,
  type MarkRefusal,
  type RunsMarkOutcome,
} from '@vostride/agent-qa-schema'

import type { AgentHost } from '../chat/host.js'
import { unmaskTreeForDisplay } from '../masking/display-tree.js'
import { readJsonBody } from '../server/body-parser.js'
import { refuseCrossSiteRequest } from '../server/cross-site.js'
import { refusalFor, respondJson, type RunDetailRefusal } from './run-detail-routes.js'

export type RunMarkOutcome =
  | { readonly kind: 'ok'; readonly body: RunsMarkOutcome }
  | RunDetailRefusal
  | {
    readonly kind: 'refused'
    readonly status: 403
    /** 2026-09-30, 432-09 (D-15): a plain reason, and nothing a caller must act on. */
    readonly body: MarkRefusal
  }

/**
 * Address comes from the route; the body may never replace it or claim a caller identity. The body
 * is the op's own strict input minus `runId`, so a field the op does not declare is refused here
 * before anything is dispatched.
 */
export async function markRun(
  host: AgentHost,
  runId: string,
  body: unknown,
): Promise<RunMarkOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_mark_input' } }
  }
  const input = body as Record<string, unknown>
  const parsed = RunsMarkInputSchema.safeParse({ ...input, runId })
  if (!parsed.success || 'runId' in input) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_mark_input' } }
  }
  try {
    const result = await host.invokeFunction(
      host.registry, host.runsMarkFunctionId, parsed.data, host.caller,
    )
    return { kind: 'ok', body: result as RunsMarkOutcome }
  } catch (error) {
    // Realm-independent classification: dashboard-server cannot import the agent package.
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'FunctionDeniedError') {
      return { kind: 'refused', status: 403, body: {
        error: 'mark_denied',
        // Closed prose avoids reflecting a note, corrected expectation or provider error.
        reason: 'The safety gate denied this mark.',
      } }
    }
    return refusalFor(error)
  }
}

/** POST /api/runs/:id/mark. Only the local human boundary restores successful output. */
export function registerRunMarkRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: {
    readonly host: AgentHost
    readonly runId: string
    readonly boundary?: 'human' | 'machine'
  },
): void {
  if (deps.boundary === 'human' && refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readJsonBody<unknown>(req).then(async (body) => {
    const outcome = await markRun(deps.host, deps.runId, body)
    if (outcome.kind === 'refused') {
      respondJson(res, outcome.status, outcome.body)
      return
    }
    respondJson(res, 200, deps.boundary === 'human'
      ? unmaskTreeForDisplay(deps.host, outcome.body, { runId: deps.runId })
      : outcome.body)
  }, () => { respondJson(res, 400, { error: 'invalid_mark_input' }) })
    .catch(() => { respondJson(res, 500, { error: 'read_failed' }) })
}
