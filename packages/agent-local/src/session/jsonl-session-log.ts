// The chat session log's JSONL disk adapter (Phase 392, CHAT-05 / D-17 / D-18 / D-19).
//
// APPEND-ONLY, AND THE FILE IS NEVER REWRITTEN. That is the requirement CHAT-05 states literally,
// and it is also what makes the log usable as the triage report D-18 describes: a reader can trust
// that line N means the same thing it meant when it was written, and a crash can only ever cost the
// tail. Every verb below is either an append or a read; there is no update path to misuse.
//
// THE DURABILITY POSTURE IS COPIED FROM `job-checkpoint-store.ts`, not re-derived. Four things come
// across verbatim, each of them a platform quirk already debugged once in this repo:
//
//   1. The narrow injectable fs facade — exactly the calls this module makes and nothing else. A
//      wide facade invites a test to answer on its own behalf.
//   2. The two-factory seam — production options have NO fs member, so "append without the fsync"
//      is not a one-argument change a composition root can make by accident. The seam is a second
//      exported function a test names explicitly.
//   3. Exclusive create (`'wx'`) for a new session, so a torn file from an earlier crash can never
//      be mistaken for this one's.
//   4. `SAFE_PATH_SEGMENT` and its named refusal — a session id is a caller-supplied string that
//      becomes a path, which is the T-392-01 spoofing surface exactly.
//
// WHAT THIS ADAPTER DELIBERATELY DOES NOT DO IS REPAIR. Torn-tail tolerance, dangling-turn
// detection and the synthesized `aborted` event are plan 03's, and they are a different KIND of
// work: repair decides what a damaged file MEANS, and a decision like that belongs in one place
// with its own corpus rather than smuggled into an adapter's read loop. Until then `open` is
// strict-but-minimal — a malformed header is a named refusal, because a session whose header
// cannot be read is not a session this build can append to safely.

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { CURRENT_CHAT_SESSION_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  ChatSessionEvent,
  ChatSessionHeader,
  OpenedChatSession,
  SessionLogPort,
} from '@vostride/agent-qa-schema'

/** Directory segment under the agent-qa runtime root. Gitignored, per D-17. */
export const CHAT_SESSIONS_SUBDIR = 'sessions'

/**
 * Ids that are safe as a single path segment.
 *
 * The same class `job-checkpoint-store.ts` uses, and the same reasoning: leading dots are excluded
 * so `..` cannot be an id at all, and the class admits no separator on any platform.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** A caller-supplied session id that could not be a path segment (T-392-01). */
export class InvalidChatSessionIdError extends Error {
  override readonly name = 'InvalidChatSessionIdError'

  constructor(readonly sessionId: string) {
    super(
      `${JSON.stringify(sessionId)} is not a usable chat session id. Ids are minted by this `
      + 'adapter and are limited to letters, digits, dot, dash and underscore.',
    )
  }
}

/**
 * A session id that names no session.
 *
 * A REFUSAL and never a create (D-17, RESEARCH Open Q4). Creating a fresh session for a mistyped
 * `--session` would tell a person their history was lost when in fact it was never looked at, and
 * would do so in the one direction no later read can undo.
 */
export class UnknownChatSessionError extends Error {
  override readonly name = 'UnknownChatSessionError'

  constructor(readonly sessionId: string) {
    super(`No chat session ${sessionId} exists under this project's runtime root.`)
  }
}

/** Bytes that do not describe a session this build can append to. */
export class ChatSessionHeaderError extends Error {
  override readonly name = 'ChatSessionHeaderError'

  constructor(
    readonly sessionId: string,
    readonly detail: string,
  ) {
    super(`The session file for ${sessionId} cannot be read: ${detail}.`)
  }
}

/**
 * Exactly the filesystem calls this module makes, and nothing else.
 *
 * `'a'` is the append-mode open the whole design rests on: the kernel places every write at the
 * current end of file, so two writers cannot interleave a partial line, and no offset bookkeeping
 * exists here to get wrong.
 */
export interface ChatSessionFs {
  mkdirSync(path: string, options: { readonly recursive: true }): void
  openSync(path: string, flags: 'a' | 'wx'): number
  writeFileSync(fd: number, data: string, encoding: 'utf8'): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  readFileSync(path: string, encoding: 'utf8'): string
}

/** The production implementation, frozen so it cannot be patched from a distance. */
export const REAL_CHAT_SESSION_FS: ChatSessionFs = Object.freeze({
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readFileSync,
})

/**
 * What a production caller supplies: a root and the session's opening context.
 *
 * The absence of an fs member is the guarantee, exactly as it is on `CreateJobCheckpointStoreOptions`.
 */
export interface CreateJsonlSessionLogOptions {
  /** Absolute path to the agent-qa runtime root, typically `<project>/.agent-qa`. */
  readonly root: string
  /** ISO instant source — the composition's clock, never `Date.now()` reached for here. */
  readonly now: () => string
  /**
   * The model in force when the session opens. Drift is `model_change` events, never a rewrite.
   *
   * A THUNK rather than a string, because a composition root resolves its model lazily — a host
   * that only lists the registry must not pay a provider resolution — and a header built from a
   * value captured at construction would name whatever was true before that resolution ran.
   */
  readonly model: () => string
  /** The toolset fingerprint at open, on the same thunk reasoning as `model` above. */
  readonly toolsetHash: () => string
  /** Random source for the id suffix, injectable so a test can pin an id. */
  readonly random?: () => number
}

/**
 * `chat-<UTCyyyymmdd-HHMMSS>-<4 base36>`.
 *
 * Sorted-by-name equals sorted-by-time, which is what makes a plain directory listing the session
 * list; the random tail is what keeps two sessions opened in the same second distinct. Every
 * character is in `SAFE_PATH_SEGMENT` by construction, so a minted id can never be refused by the
 * guard that protects a supplied one.
 */
export function mintChatSessionId(nowIso: string, random: () => number): string {
  const stamp = nowIso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-').replace('Z', '')
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  return `chat-${stamp}-${suffix}`
}

function requireSessionId(sessionId: string): string {
  if (!SAFE_PATH_SEGMENT.test(sessionId)) throw new InvalidChatSessionIdError(sessionId)
  return sessionId
}

/**
 * The header guard: version BEFORE shape.
 *
 * The order is the same decision `job-checkpoint-store.ts:231-237` states — a version mismatch has
 * a remedy an operator can act on, and reporting it as a generic shape failure names a field
 * instead. The `readonly` cast is safe because the value is re-validated field by field below.
 */
function guardHeader(sessionId: string, line: string): ChatSessionHeader {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new ChatSessionHeaderError(sessionId, 'its first line is not JSON')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new ChatSessionHeaderError(sessionId, 'its header line is not an object')
  }
  const header = parsed as Record<string, unknown>
  if (header.schemaVersion !== CURRENT_CHAT_SESSION_SCHEMA_VERSION) {
    throw new ChatSessionHeaderError(
      sessionId,
      `it declares schemaVersion ${String(header.schemaVersion)} and this build reads `
      + String(CURRENT_CHAT_SESSION_SCHEMA_VERSION),
    )
  }
  if (header.sessionId !== sessionId) {
    throw new ChatSessionHeaderError(
      sessionId,
      `its header names session ${String(header.sessionId)}`,
    )
  }
  return header as unknown as ChatSessionHeader
}

export function createJsonlSessionLog(options: CreateJsonlSessionLogOptions): SessionLogPort {
  return createJsonlSessionLogOn(REAL_CHAT_SESSION_FS, options)
}

/**
 * The same log over an injected filesystem. TEST SEAM — production uses the factory above.
 *
 * It exists because the syscall ORDER is the durability property and no crash test can observe it
 * (the kernel does not drop pages it already holds when a process dies). Keeping it a separate
 * function rather than an optional field means a production construction cannot reach it by filling
 * in one more property.
 */
export function createJsonlSessionLogOn(
  fs: ChatSessionFs,
  options: CreateJsonlSessionLogOptions,
): SessionLogPort {
  if (!isAbsolute(options.root)) {
    throw new TypeError('chat session log root must be absolute')
  }
  const sessionsRoot = join(options.root, CHAT_SESSIONS_SUBDIR)
  const random = options.random ?? Math.random

  let fd: number | undefined

  function pathFor(sessionId: string): string {
    return join(sessionsRoot, `${sessionId}.jsonl`)
  }

  function readLines(sessionId: string): string[] | undefined {
    try {
      return fs
        .readFileSync(pathFor(sessionId), 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  return {
    open(sessionId?: string): Promise<OpenedChatSession> {
      fs.mkdirSync(sessionsRoot, { recursive: true })

      if (sessionId !== undefined) {
        const id = requireSessionId(sessionId)
        const lines = readLines(id)
        // The refusal, not a create. See `UnknownChatSessionError`.
        if (lines === undefined || lines.length === 0) throw new UnknownChatSessionError(id)
        const header = guardHeader(id, lines[0]!)
        const events = lines.slice(1).map((line) => JSON.parse(line) as ChatSessionEvent)
        if (fd !== undefined) fs.closeSync(fd)
        fd = fs.openSync(pathFor(id), 'a')
        return Promise.resolve({ header, events })
      }

      const createdAt = options.now()
      const id = mintChatSessionId(createdAt, random)
      const header: ChatSessionHeader = {
        schemaVersion: CURRENT_CHAT_SESSION_SCHEMA_VERSION,
        sessionId: id,
        createdAt,
        model: options.model(),
        toolsetHash: options.toolsetHash(),
      }
      // Exclusive create, then fsync the header BEFORE the file is used: a session file that
      // exists at all is a session file whose header is on the device.
      const created = fs.openSync(pathFor(id), 'wx')
      try {
        fs.writeFileSync(created, `${JSON.stringify(header)}\n`, 'utf8')
        fs.fsyncSync(created)
      } finally {
        fs.closeSync(created)
      }
      if (fd !== undefined) fs.closeSync(fd)
      fd = fs.openSync(pathFor(id), 'a')
      return Promise.resolve({ header, events: [] })
    },

    append(event: ChatSessionEvent): Promise<void> {
      if (fd === undefined) {
        throw new TypeError('a chat session event cannot be appended before the session is opened')
      }
      // One JSON document per line, written through an `O_APPEND` fd so the kernel places it at
      // the end of file. No offset is tracked here, which is what makes a second writer's line
      // impossible to interleave with a partial one of ours.
      fs.writeFileSync(fd, `${JSON.stringify(event)}\n`, 'utf8')
      return Promise.resolve()
    },

    turnBoundary(): Promise<void> {
      if (fd !== undefined) fs.fsyncSync(fd)
      return Promise.resolve()
    },

    close(): Promise<void> {
      if (fd !== undefined) {
        fs.closeSync(fd)
        fd = undefined
      }
      return Promise.resolve()
    },
  }
}
