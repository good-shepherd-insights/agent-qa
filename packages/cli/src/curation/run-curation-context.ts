import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { z } from 'zod'

import { completedRunDir } from './curation-tail.js'

export const RUN_CONFIG_RECORD_FILE = 'run-config.json'

const runConfigRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    configPath: z.string().min(1),
  })
  .strict()

export type RunConfigRecord = z.infer<typeof runConfigRecordSchema>

export class RunConfigRecordConflict extends Error {
  constructor(runId: string) {
    super(`Run ${runId} already records a different config.`)
    this.name = 'RunConfigRecordConflict'
  }
}

export function runConfigRecordPath(agentQaRoot: string, runId: string): string {
  return join(completedRunDir(agentQaRoot, runId), RUN_CONFIG_RECORD_FILE)
}

// A record that is absent, a symlink, not a file or not this run's is treated as absent (441-64).
export function readRunConfigRecord(
  agentQaRoot: string,
  runId: string,
): RunConfigRecord | undefined {
  const path = runConfigRecordPath(agentQaRoot, runId)
  try {
    if (!lstatSync(path).isFile()) return undefined
    const parsed = runConfigRecordSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!parsed.success) return undefined
    if (parsed.data.runId !== runId || !isAbsolute(parsed.data.configPath)) return undefined
    return parsed.data
  } catch {
    return undefined
  }
}

function syncDirectory(dir: string): void {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// 2026-10-16 (442-10, D-17): post-verdict-continuation.ts's temp-and-link write, so a reader never
// sees a partial record and an existing record is never replaced.
export function writeRunConfigRecord(agentQaRoot: string, runId: string, configPath: string): void {
  const path = runConfigRecordPath(agentQaRoot, runId)
  const record: RunConfigRecord = { schemaVersion: 1, runId, configPath: resolve(configPath) }
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    try {
      writeFileSync(fd, `${JSON.stringify(record)}\n`)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      linkSync(tmp, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (readRunConfigRecord(agentQaRoot, runId)?.configPath !== record.configPath) {
        throw new RunConfigRecordConflict(runId)
      }
    }
    syncDirectory(dirname(path))
  } finally {
    rmSync(tmp, { force: true })
  }
}
