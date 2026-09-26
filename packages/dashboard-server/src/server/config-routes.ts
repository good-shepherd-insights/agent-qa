// 2026-09-26, 429-01 D-19/D-22: the field-merge config write. A page on another site may never
// drive it, and no answer carries a cross-origin read grant.
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  classifyConfigPath,
  CONFIG_REVISION_ABSENT,
  ConfigRevealRequestSchema,
  ConfigUndoRequestSchema,
  ConfigWriteRequestSchema,
} from '@vostride/agent-qa-schema'

import type { ConfigManager } from '../config/index.js'
import type { UndoStore } from '../config/undo-store.js'
import { respondJson } from '../run-service/run-detail-routes.js'
import { readJsonBody } from './body-parser.js'
import { refuseCrossSiteRequest } from './cross-site.js'

/**
 * PATCH /api/config. The body is a change set; the answer is the revision now on disk, and for an
 * undoable change set a single-use Undo token (429-11 D-24).
 */
export function registerConfigWriteRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { readonly configManager: ConfigManager; readonly undoStore: UndoStore },
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
    const undoable = parsed.data.undoable === true
    let outcome: Awaited<ReturnType<ConfigManager['applyChanges']>>
    try {
      outcome = await deps.configManager.applyChanges(parsed.data.changes, { capturePriors: undoable })
    } catch {
      respondJson(res, 500, { error: 'write_failed' })
      return
    }
    if (outcome.kind === 'ok') {
      if (undoable && outcome.priors !== undefined) {
        const undo = deps.undoStore.put({ kind: 'config', priors: outcome.priors }, Date.now())
        respondJson(res, 200, { revision: outcome.revision, undo })
        return
      }
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

/** GET /api/config/revision. The sha256 of the file's bytes, even when they do not parse. */
export function registerConfigRevisionRoute(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: { readonly configManager: ConfigManager },
): void {
  deps.configManager.readWithRevision().then((read) => {
    res.setHeader('Cache-Control', 'no-store')
    const revision = read.kind === 'absent' ? CONFIG_REVISION_ABSENT : read.revision
    respondJson(res, 200, { revision })
  }, () => { respondJson(res, 500, { error: 'read_failed' }) })
}

/**
 * POST /api/config/reveal (429-06 D-09). One in-file secret per explicit request, same-site only,
 * never cached and never logged. It reads the config file alone: never auth.json, never the env.
 */
export function registerConfigRevealRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { readonly configManager: ConfigManager },
): void {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  if (refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  const contentType = req.headers['content-type']?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    respondJson(res, 400, { error: 'invalid_write_input' })
    return
  }
  void readJsonBody<unknown>(req).then(async (body) => {
    const parsed = ConfigRevealRequestSchema.safeParse(body)
    if (!parsed.success) {
      respondJson(res, 400, { error: 'invalid_write_input' })
      return
    }
    const { path } = parsed.data
    const classified = path.map((segment) => (typeof segment === 'object' ? 0 : segment))
    if (classifyConfigPath(classified) !== 'secret') {
      respondJson(res, 422, { error: 'reveal_not_secret' })
      return
    }
    const outcome = await deps.configManager.revealAt(path)
    if (outcome.kind === 'not_found') {
      respondJson(res, 404, { error: 'reveal_not_found' })
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    respondJson(res, 200, { value: outcome.value })
  }, () => { respondJson(res, 400, { error: 'invalid_write_input' }) })
    .catch(() => { respondJson(res, 500, { error: 'reveal_failed' }) })
}

/**
 * POST /api/config/undo (429-11 D-24). Redeems a token once and restores on the server, so the
 * page never writes back a copy it holds only masked. Same-site only; a newer write always wins.
 */
export function registerConfigUndoRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: { readonly configManager?: ConfigManager; readonly undoStore: UndoStore },
): void {
  if (req.method !== 'POST') {
    respondJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  if (refuseCrossSiteRequest(req) !== undefined) {
    respondJson(res, 403, { error: 'cross_site_refused' })
    return
  }
  void readJsonBody<unknown>(req).then(async (body) => {
    const parsed = ConfigUndoRequestSchema.safeParse(body)
    if (!parsed.success) {
      respondJson(res, 400, { error: 'invalid_write_input' })
      return
    }
    const payload = deps.undoStore.take(parsed.data.token, Date.now())
    if (payload === undefined) {
      respondJson(res, 410, { error: 'undo_expired' })
      return
    }
    if (deps.configManager === undefined) {
      respondJson(res, 503, { error: 'config_unavailable' })
      return
    }
    const outcome = await deps.configManager.restorePriors(payload.priors)
    if (outcome.kind === 'ok') {
      respondJson(res, 200, { restored: true, revision: outcome.revision })
      return
    }
    respondJson(res, outcome.error === 'undo_conflict' ? 409 : 422, { error: outcome.error })
  }, () => { respondJson(res, 400, { error: 'invalid_write_input' }) })
    .catch(() => { respondJson(res, 500, { error: 'write_failed' }) })
}
