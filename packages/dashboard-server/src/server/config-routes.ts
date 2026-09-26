// 2026-09-26, 429-01 D-19/D-22: the field-merge config write. A page on another site may never
// drive it, and no answer carries a cross-origin read grant.
import type { IncomingMessage, ServerResponse } from 'node:http'

import { ConfigWriteRequestSchema } from '@vostride/agent-qa-schema'

import type { ConfigManager } from '../config/index.js'
import { respondJson } from '../run-service/run-detail-routes.js'
import { readJsonBody } from './body-parser.js'
import { refuseCrossSiteRequest } from './cross-site.js'

/** PATCH /api/config. The body is a change set; the answer is the revision now on disk. */
export function registerConfigWriteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { readonly configManager: ConfigManager },
): void {
  if (refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readJsonBody<unknown>(req).then(async (body) => {
    const parsed = ConfigWriteRequestSchema.safeParse(body)
    if (!parsed.success) {
      respondJson(res, 400, { error: 'invalid_write_input' })
      return
    }
    let outcome: Awaited<ReturnType<ConfigManager['applyChanges']>>
    try {
      outcome = await deps.configManager.applyChanges(parsed.data.changes)
    } catch {
      respondJson(res, 500, { error: 'write_failed' })
      return
    }
    if (outcome.kind === 'ok') {
      respondJson(res, 200, { revision: outcome.revision })
      return
    }
    if (outcome.error === 'invalid_write_input') {
      respondJson(res, 400, { error: outcome.error })
      return
    }
    respondJson(res, 422, outcome.issues === undefined
      ? { error: outcome.error }
      : { error: outcome.error, issues: outcome.issues })
  }, () => { respondJson(res, 400, { error: 'invalid_write_input' }) })
    .catch(() => { respondJson(res, 500, { error: 'write_failed' }) })
}
