/**
 * D-07's durable, idempotent rebuild signal survives the one-shot CLI process that detected a
 * degraded index. Phase 378's drainer consumes it. The marker lives in the gitignored
 * memory/index partition (Research Pitfall 10), so it deliberately bypasses committed egress.
 */
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from 'zod'

export const REBUILD_MARKER_FILE = '.rebuild-requested'

export type RebuildReason = 'absent' | 'corrupt' | 'locked' | 'schema-version'

export interface RebuildRequest {
  reason: RebuildReason
  detail: string
  /** D-17 diagnostic operations metadata only; never an input to validity or serving decisions. */
  requestedAt: string
}

export interface RequestRebuildOptions {
  knowledgeRoot: string
  reason: RebuildReason
  detail: string
}

export type ReadRebuildRequestOutcome =
  | { present: false }
  | { present: true; request: RebuildRequest | undefined }

const rebuildRequestSchema = z
  .object({
    reason: z.enum(['absent', 'corrupt', 'locked', 'schema-version']),
    detail: z.string(),
    requestedAt: z.string(),
  })
  .strict()

function markerPath(knowledgeRoot: string): string {
  return join(knowledgeRoot, 'memory', 'index', REBUILD_MARKER_FILE)
}

/**
 * Write the first rebuild signal atomically; later signals never overwrite its diagnostic cause.
 */
export function requestRebuild(opts: RequestRebuildOptions): void {
  const file = markerPath(opts.knowledgeRoot)
  mkdirSync(dirname(file), { recursive: true })
  if (existsSync(file)) return

  const request: RebuildRequest = {
    reason: opts.reason,
    detail: opts.detail,
    requestedAt: new Date().toISOString(),
  }
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, `${JSON.stringify(request)}\n`, { encoding: 'utf8', flag: 'wx' })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Read a marker through a strict disk-boundary guard; malformed bytes remain a bare signal. */
export function readRebuildRequest(knowledgeRoot: string): ReadRebuildRequestOutcome {
  const file = markerPath(knowledgeRoot)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return existsSync(file)
      ? { present: true, request: undefined }
      : { present: false }
  }

  try {
    const parsed = rebuildRequestSchema.safeParse(JSON.parse(raw))
    return parsed.success
      ? { present: true, request: parsed.data }
      : { present: true, request: undefined }
  } catch {
    return { present: true, request: undefined }
  }
}

/** Consume the durable rebuild signal. Clearing an absent marker is intentionally a no-op. */
export function clearRebuildRequest(knowledgeRoot: string): void {
  rmSync(markerPath(knowledgeRoot), { force: true })
}
