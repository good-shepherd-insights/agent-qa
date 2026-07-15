/**
 * Per-candidate write-ahead intents for the deterministic commit tail.
 *
 * Plan 378-10 must write and fsync an intent before a bundle publish rename can happen, then
 * clear it only after the index delta apply confirms. One file per candidate makes both
 * replacement and removal atomic without log compaction.
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { canonicalJson } from '@vostride/agent-qa-schema'
import { z } from 'zod'

export const JOURNAL_SUBDIR = 'memory/queue/journal'
export const COMMIT_INTENT_SCHEMA_VERSION = 1

const CANDIDATE_ID = /^[0-9a-f]{64}$/
const INTENT_FILE = /^([0-9a-f]{64})\.intent\.json$/

export const commitIntentSchema = z
  .object({
    schemaVersion: z.literal(COMMIT_INTENT_SCHEMA_VERSION),
    candidateId: z.string().regex(CANDIDATE_ID),
    bundleId: z.string().min(1),
    deltaKind: z.enum(['Add', 'Confirm', 'Supersede', 'Deprecate', 'MintUnknown', 'Noop']),
    targetRecordId: z.string().min(1).optional(),
    epoch: z.number().int().positive(),
  })
  .strict()

export type CommitIntent = z.infer<typeof commitIntentSchema>

export type ListedCommitIntent =
  | { parsed: CommitIntent }
  | { malformed: true; candidateId: string }

function journalRoot(knowledgeRoot: string): string {
  if (!isAbsolute(knowledgeRoot)) {
    throw new TypeError('knowledgeRoot must be absolute')
  }
  return join(knowledgeRoot, JOURNAL_SUBDIR)
}

function intentPath(knowledgeRoot: string, candidateId: string): string {
  const parsedCandidateId = z.string().regex(CANDIDATE_ID).parse(candidateId)
  return join(journalRoot(knowledgeRoot), `${parsedCandidateId}.intent.json`)
}

function bestEffortFsyncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      code !== 'ENOENT' &&
      code !== 'EINVAL' &&
      code !== 'EISDIR' &&
      code !== 'EPERM' &&
      code !== 'ENOTSUP'
    ) {
      throw error
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/** Durably replace one candidate's intent before any reader-visible bundle mutation. */
export function writeCommitIntent(knowledgeRoot: string, intent: CommitIntent): void {
  const parsed = commitIntentSchema.parse(intent)
  const file = intentPath(knowledgeRoot, parsed.candidateId)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${randomUUID()}`
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx')
    writeFileSync(fd, `${canonicalJson(parsed)}\n`, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, file)
    bestEffortFsyncDirectory(dirname(file))
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

/** Clear one confirmed intent after its index projection has been applied. */
export function clearCommitIntent(knowledgeRoot: string, candidateId: string): void {
  const file = intentPath(knowledgeRoot, candidateId)
  rmSync(file, { force: true })
  bestEffortFsyncDirectory(dirname(file))
}

/** List strict intents in candidate-id order while retaining torn bytes as recovery signals. */
export function listCommitIntents(knowledgeRoot: string): ListedCommitIntent[] {
  let names: string[]
  try {
    names = readdirSync(journalRoot(knowledgeRoot), { withFileTypes: true })
      .filter((entry) => entry.isFile() && INTENT_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  return names.map((name) => {
    const candidateId = INTENT_FILE.exec(name)![1]!
    try {
      const parsed = commitIntentSchema.safeParse(
        JSON.parse(readFileSync(join(journalRoot(knowledgeRoot), name), 'utf8')),
      )
      return parsed.success && parsed.data.candidateId === candidateId
        ? { parsed: parsed.data }
        : { malformed: true, candidateId }
    } catch {
      return { malformed: true, candidateId }
    }
  })
}
