// The chat session log's JSONL disk adapter (Phase 392, CHAT-05 / D-17 / D-18 / D-19).
//
// APPEND-ONLY, AND THE FILE IS NEVER REWRITTEN. That is the requirement CHAT-05 states literally,
// and it is also what makes the log usable as the triage report D-18 describes: a reader can trust
// that line N means the same thing it meant when it was written, and a crash can only ever cost the
// tail. Every verb below is either an append or a read; there is no update path to misuse. REPAIR
// obeys the same law — it APPENDS a synthesized `aborted` event and touches not one existing byte.
//
// THE DURABILITY POSTURE IS COPIED FROM `job-checkpoint-store.ts`, not re-derived. Five things come
// across verbatim, each of them a platform quirk already debugged once in this repo:
//
//   1. The narrow injectable fs facade — exactly the calls this module makes and nothing else. A
//      wide facade invites a test to answer on its own behalf.
//   2. The two-factory seam — production options have NO fs member, so "append without the fsync"
//      is not a one-argument change a composition root can make by accident. The seam is a second
//      exported function a test names explicitly, and it is deliberately NOT on this package's
//      barrel: the checkpoint store publishes neither of its factories, for the reason that a seam
//      reachable by every surface is no longer a seam.
//   3. Exclusive create (`'wx'`) for a new session, so a torn file from an earlier crash can never
//      be mistaken for this one's.
//   4. The parent-directory fsync after a create, with the `DIRECTORY_FSYNC_SWALLOWED_CODES`
//      allowlist IMPORTED rather than re-derived — a directory entry is not durable until its
//      parent is synced, and a hand-copied allowlist is how best-effort silently becomes no-effort.
//   5. `SAFE_PATH_SEGMENT` and its named refusal — a session id is a caller-supplied string that
//      becomes a path, which is the T-392-01 spoofing surface exactly.
//
// WHERE THE FSYNCS ARE, AND WHY THERE. Two, and only two, on the life of a session: one on the
// header at create (a session file that exists at all is a session file whose header is on the
// device, and whose directory entry is too), and one per TURN at `turnBoundary()`. Per turn rather
// than per event is what makes the loss bound exactly the in-flight turn — which is exactly what
// the repair below knows how to handle. Syncing per event would buy a guarantee finer than any
// reader can use, and syncing at close would leave a killed process with a turn nobody landed.
//
// WHAT REPAIR DECIDES LIVES ELSEWHERE. `repairSession` is a pure function in `packages/agent`
// beside the turn engine, because deciding what a DAMAGED file means is a different kind of work
// than moving bytes, and it deserves its own corpus rather than a branch in a read loop. This
// adapter does the raw-line half (a torn FINAL line is skipped; a damaged mid-file line is a named
// refusal) and hands guarded events onward. The header, by contrast, is refused outright: a session
// whose header this build cannot read is not a session it can safely append to.

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
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

import { DIRECTORY_FSYNC_SWALLOWED_CODES } from '../store/job-checkpoint-store.js'

/** Directory segment under the agent-qa runtime root. Gitignored, per D-17. */
export const CHAT_SESSIONS_SUBDIR = 'sessions'

/** The file extension every session log carries. A listing filters on it, nothing else. */
const SESSION_FILE_SUFFIX = '.jsonl'

/**
 * How many bytes a listing reads at a time.
 *
 * RETUNE if session headers ever grow past a line or listings become the hot path: the only
 * property this number has to have is that it is a CONSTANT, so listing a thousand sessions costs
 * a thousand small buffers rather than a thousand whole files in memory. 64 KiB is one filesystem
 * read on every platform this ships to and comfortably holds a header line many times over.
 */
export const CHAT_SESSION_READ_CHUNK_BYTES = 64 * 1024

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
 * exists here to get wrong. `'r'` appears twice for two unrelated reasons — the parent-directory
 * fsync needs a descriptor on the directory, and the listing needs a bounded read on a file.
 *
 * `writeFileSync` on a descriptor rather than `writeSync` is deliberate. `writeSync` may report a
 * SHORT write and leave the caller to loop; a loop is exactly the offset bookkeeping the append
 * mode was chosen to abolish, and a forgotten one is a half-written line — the damage shape this
 * file is otherwise built to survive. `writeFileSync` writes the whole buffer or throws, which is
 * also what the checkpoint store's facade takes.
 */
export interface ChatSessionFs {
  mkdirSync(path: string, options: { readonly recursive: true }): void
  openSync(path: string, flags: 'a' | 'wx' | 'r'): number
  writeFileSync(fd: number, data: string, encoding: 'utf8'): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  readSync(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): number
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string): string[]
}

/** The production implementation, frozen so it cannot be patched from a distance. */
export const REAL_CHAT_SESSION_FS: ChatSessionFs = Object.freeze({
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readSync,
  readFileSync,
  readdirSync,
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

/** One session, as a listing knows it: everything the header line says, plus how long the log is. */
export interface ChatSessionListEntry {
  readonly sessionId: string
  readonly createdAt: string
  /** The model in force when the session OPENED. Drift after that is `model_change` events. */
  readonly model: string
  /**
   * Event lines on the file, counted without parsing one.
   *
   * An EVENT count and not a turn count, and the difference is not a shortcut. A turn count is not
   * a header fact and cannot become one — the header is written once and never rewritten, which is
   * the property CHAT-05 asks for by name — so the only way to produce one is to parse every line
   * of every log, which is the work a listing exists to avoid. The line count answers "is there
   * anything in here" for a fraction of the cost, and `open()` answers everything else.
   */
  readonly eventCount: number
}

/** One session file the listing could not read, surfaced as data rather than thrown over. */
export interface RefusedChatSessionFile {
  /** The file's own name, which is what a person has to go and look at. */
  readonly file: string
  readonly reason: string
}

export interface ChatSessionListing {
  readonly sessions: readonly ChatSessionListEntry[]
  readonly refused: readonly RefusedChatSessionFile[]
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

function isSwallowableDirectoryFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return DIRECTORY_FSYNC_SWALLOWED_CODES.some((allowed) => allowed === code)
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
  if (typeof header.createdAt !== 'string' || typeof header.model !== 'string') {
    throw new ChatSessionHeaderError(sessionId, 'its header names no creation instant or model')
  }
  return header as unknown as ChatSessionHeader
}

/**
 * Every session under one runtime root, read from headers alone (D-17).
 *
 * A DAMAGED FILE IS DATA, NOT AN EXCEPTION — the grants-ledger posture (`grants/ledger.ts:73-83`).
 * A corrupt neighbour costs the caller that one entry and nothing else; throwing would let a single
 * unreadable file hide every healthy session from the person trying to find their conversation.
 *
 * It reads through the real filesystem with no injection seam, and that absence is on purpose: the
 * seam beside `createJsonlSessionLogOn` exists because syscall ORDER is a durability property no
 * crash test can observe. A listing has no such property. What it returns is its whole contract,
 * and a temp directory proves that directly.
 */
export function listSessions(root: string): ChatSessionListing {
  if (!isAbsolute(root)) throw new TypeError('chat session log root must be absolute')
  const fs = REAL_CHAT_SESSION_FS
  const sessionsRoot = join(root, CHAT_SESSIONS_SUBDIR)

  let files: string[]
  try {
    files = fs.readdirSync(sessionsRoot)
  } catch (error) {
    // No sessions directory is no sessions, not a failure: a project that has never opened chat is
    // in exactly that state, and it is the state the very first `chat` command starts from.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sessions: [], refused: [] }
    throw error
  }

  const sessions: ChatSessionListEntry[] = []
  const refused: RefusedChatSessionFile[] = []

  for (const file of [...files].sort()) {
    if (!file.endsWith(SESSION_FILE_SUFFIX)) continue
    const sessionId = file.slice(0, -SESSION_FILE_SUFFIX.length)
    try {
      const scanned = scanSessionFile(fs, join(sessionsRoot, file))
      if (scanned.headerLine === undefined) {
        refused.push({ file, reason: 'it carries no complete header line' })
        continue
      }
      const header = guardHeader(sessionId, scanned.headerLine)
      sessions.push({
        sessionId: header.sessionId,
        createdAt: header.createdAt,
        model: header.model,
        eventCount: Math.max(scanned.lineCount - 1, 0),
      })
    } catch (error) {
      refused.push({ file, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return { sessions, refused }
}

/**
 * One pass over a session file: its first line, and how many complete lines it has.
 *
 * Constant memory by construction — one reused chunk buffer, no accumulation past the header line,
 * and NO EVENT IS EVER PARSED. A listing that guarded every line would be `open()` wearing a
 * cheaper name, and would inherit `open()`'s right to refuse a whole session over one damaged line.
 */
function scanSessionFile(
  fs: ChatSessionFs,
  path: string,
): { headerLine: string | undefined; lineCount: number } {
  const fd = fs.openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(CHAT_SESSION_READ_CHUNK_BYTES)
    let headerLine: string | undefined
    let headerBytes = ''
    let lineCount = 0
    let read = fs.readSync(fd, buffer, 0, buffer.length, null)
    while (read > 0) {
      const chunk = buffer.subarray(0, read)
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 0x0a) lineCount += 1
      }
      if (headerLine === undefined) {
        headerBytes += chunk.toString('utf8')
        const newline = headerBytes.indexOf('\n')
        if (newline >= 0) headerLine = headerBytes.slice(0, newline)
        // A "header" longer than one chunk is not a header this build wrote; stop accumulating so
        // one damaged file cannot be read into memory in its entirety by a listing.
        else if (headerBytes.length > CHAT_SESSION_READ_CHUNK_BYTES) break
      }
      read = fs.readSync(fd, buffer, 0, buffer.length, null)
    }
    return { headerLine, lineCount }
  } finally {
    fs.closeSync(fd)
  }
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
 * in one more property, and keeping it off this package's barrel means no other package can reach
 * it at all. A test asserts that nothing outside `__tests__` calls it.
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

  function bestEffortFsyncDirectory(dir: string): void {
    let directoryFd: number | undefined
    try {
      directoryFd = fs.openSync(dir, 'r')
      fs.fsyncSync(directoryFd)
    } catch (error) {
      if (!isSwallowableDirectoryFsyncError(error)) throw error
    } finally {
      if (directoryFd !== undefined) fs.closeSync(directoryFd)
    }
  }

  function readLines(sessionId: string): { lineNumber: number; text: string }[] | undefined {
    let text: string
    try {
      text = fs.readFileSync(pathFor(sessionId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    // Line numbers are 1-based and count the header, so a refusal names what an editor shows the
    // person who has to go and look at the file.
    return text
      .split('\n')
      .map((line, index) => ({ lineNumber: index + 1, text: line }))
      .filter((line) => line.text !== '')
  }

  function writeEvent(target: number, event: ChatSessionEvent): void {
    // One JSON document per line, written through an `O_APPEND` fd so the kernel places it at the
    // end of file. No offset is tracked here, which is what makes a second writer's line impossible
    // to interleave with a partial one of ours.
    fs.writeFileSync(target, `${JSON.stringify(event)}\n`, 'utf8')
  }

  return {
    open(sessionId?: string): Promise<OpenedChatSession> {
      fs.mkdirSync(sessionsRoot, { recursive: true })

      if (sessionId !== undefined) {
        const id = requireSessionId(sessionId)
        const lines = readLines(id)
        // The refusal, not a create. See `UnknownChatSessionError`.
        if (lines === undefined || lines.length === 0) throw new UnknownChatSessionError(id)
        const header = guardHeader(id, lines[0]!.text)
        const events = lines.slice(1).map((line) => JSON.parse(line.text) as ChatSessionEvent)
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
      // Exclusive create, then fsync the header BEFORE the file is used, then fsync the directory
      // that now names it: a session file that exists at all is a session file whose header is on
      // the device, and whose entry survives the crash that follows.
      const created = fs.openSync(pathFor(id), 'wx')
      try {
        fs.writeFileSync(created, `${JSON.stringify(header)}\n`, 'utf8')
        fs.fsyncSync(created)
      } finally {
        fs.closeSync(created)
      }
      bestEffortFsyncDirectory(sessionsRoot)
      if (fd !== undefined) fs.closeSync(fd)
      fd = fs.openSync(pathFor(id), 'a')
      return Promise.resolve({ header, events: [] })
    },

    append(event: ChatSessionEvent): Promise<void> {
      if (fd === undefined) {
        throw new TypeError('a chat session event cannot be appended before the session is opened')
      }
      writeEvent(fd, event)
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
