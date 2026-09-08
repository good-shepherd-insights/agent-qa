// 2026-09-08, 419 D-13: the browser mark door dispatches the same gated op as the CLI.
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  RunsMarkInputSchema,
  remediesRenderableBy,
  type GateRemedy,
  type RunsMarkOutcome,
} from '@vostride/agent-qa-schema'

import { isRunTriggerConfirmScope } from '../chat/confirm-registry.js'
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
    readonly body: {
      readonly error: 'mark_denied'
      readonly reason: string
      readonly remedies: readonly GateRemedy[]
    }
  }

export interface RunMarkFrame {
  readonly confirmScope?: string
  readonly enter?: AgentHost['enterRunTriggerScope']
}

/** Address comes from the route; the body may never replace it or claim a caller identity. */
export async function markRun(
  host: AgentHost,
  runId: string,
  body: unknown,
  frame: RunMarkFrame = {},
): Promise<RunMarkOutcome> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_mark_input' } }
  }
  const { confirmScope, ...input } = body as Record<string, unknown>
  const scope = frame.confirmScope ?? confirmScope
  if (scope !== undefined && (typeof scope !== 'string' || !isRunTriggerConfirmScope(scope))) {
    return { kind: 'refused', status: 400, body: {
      error: 'confirmScope must be a confirm scope minted by this server',
    } }
  }
  const parsed = RunsMarkInputSchema.safeParse({ ...input, runId })
  if (!parsed.success || 'runId' in input) {
    return { kind: 'refused', status: 400, body: { error: 'invalid_mark_input' } }
  }
  try {
    const run = () => host.invokeFunction(
      host.registry, host.runsMarkFunctionId, parsed.data, host.caller,
    )
    const result = await (
      scope !== undefined && frame.enter !== undefined ? frame.enter(scope, run) : run()
    )
    return { kind: 'ok', body: result as RunsMarkOutcome }
  } catch (error) {
    // Realm-independent classification: dashboard-server cannot import the agent package.
    if (typeof error === 'object' && error !== null && 'name' in error
      && error.name === 'FunctionDeniedError' && 'remedies' in error && Array.isArray(error.remedies)) {
      return { kind: 'refused', status: 403, body: {
        error: 'mark_denied',
        // Closed prose avoids reflecting a note, corrected expectation or provider error.
        reason: 'The safety gate denied this mark.',
        remedies: remediesRenderableBy('dashboard', error.remedies as GateRemedy[]),
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
    readonly enterRunTriggerScope?: AgentHost['enterRunTriggerScope']
  },
): void {
  if (deps.boundary === 'human' && refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readJsonBody<unknown>(req).then(async (body) => {
    const outcome = await markRun(deps.host, deps.runId, body, { enter: deps.enterRunTriggerScope })
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
