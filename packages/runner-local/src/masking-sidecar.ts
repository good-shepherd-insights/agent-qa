// The per-run masking digest sidecar (Phase 405 plan 02, D-08).
//
// WHAT IT IS. A run's masking context mints `<SECRET_n>` placeholders in registration order and
// holds the placeholder→value map in memory only (spec/v2/execution-safety.md §4: run-scoped,
// never persisted in clear). That map dies with the process, which is why a dashboard restarted
// after a run cannot tell WHICH declared secret `<SECRET_3>` stood for — it can only count, and
// counting breaks the moment the host's secret sources change shape. This file writes the durable
// VALUE IDENTITY that closes that gap:
//
//   <root>/runs/<slug(runId)>/masking-digests.json
//
// in the SAME run family as events.jsonl / handoff.json / artifact.json / blobs/, addressed
// through the same `RUNS_SUBDIR` + `slugBranch` traversal guard, so a planner-supplied
// `../..`-shaped runId can never escape the runs root (the FsEventLog / FsEvidenceArtifactStore
// idiom, T-405-08).
//
// WHY A KEYED HMAC AND NOT A BARE HASH (T-405-06). A bare `sha256(value)` sidecar is a secret
// oracle: declared secrets are frequently short, low-entropy, or drawn from a guessable space, and
// anyone holding the file could confirm a guess offline with one hash. `HMAC-SHA256(hostKey, value)`
// cannot be confirmed without the host key, which never leaves this machine and never appears in
// the sidecar, in a log, or in an error message. The digest is therefore a value IDENTIFIER, not a
// value: two runs that masked the same secret produce the same digest on this host and nothing
// legible anywhere else.
//
// WHY EMAIL PLACEHOLDERS ARE NEVER HERE (D-10). `<EMAIL_n>` is minted lazily inside `mask()` from
// text the host never declared, so no host source can re-derive it later; a digest of one would be
// an entry nothing could ever match. Such a placeholder renders as a typed masked chip instead.
// The writer's caller supplies only SECRET rows (`snapshotRegistered()` filters them).
//
// ROTATION IS DELETION. Removing `<root>/masking-key` invalidates every earlier run's digests at
// once; those placeholders then degrade to typed chips, which is the honest answer rather than a
// wrong match.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { join } from 'node:path'

import { slugBranch } from './branch-resolver.js'
import { RUNS_SUBDIR } from './event-log.js'

/** The one sidecar file name, written into each slugged run dir. */
export const MASKING_DIGESTS_FILE = 'masking-digests.json'

/** The host-local key file, at the runtime root beside build-ordinals.json. Never in git. */
export const MASKING_HOST_KEY_FILE = 'masking-key'

/** The on-disk schema version. A reader that does not recognise it reports absence, never a match. */
export const MASKING_DIGESTS_SCHEMA_VERSION = 1

/** The one digest algorithm this schema version admits. */
const MASKING_DIGESTS_ALGORITHM = 'hmac-sha256'

/** Bytes of host key material. 32 is the HMAC-SHA256 block-appropriate size. */
const HOST_KEY_BYTES = 32

const HOST_KEY_HEX_RE = /^[0-9a-f]{64}$/

export interface MaskingDigestsFile {
  schemaVersion: typeof MASKING_DIGESTS_SCHEMA_VERSION
  algorithm: typeof MASKING_DIGESTS_ALGORITHM
  /** placeholder (`<SECRET_0>`) -> lowercase 64-hex keyed digest of the value it stood for. */
  entries: Record<string, string>
}

/** One row the caller hands the writer. The `value` is digested here and never written. */
export interface MaskingDigestEntry {
  placeholder: string
  value: string
}

export interface WriteMaskingDigestsInput {
  /** Runtime root (e.g. DEFAULT_AGENT_QA_DIR = '.agent-qa'). */
  root: string
  /** The run these digests belong to; slugged before it becomes a path segment. */
  runId: string
  /** The host key from `resolveMaskingHostKey`. */
  key: Buffer
  entries: ReadonlyArray<MaskingDigestEntry>
}

export interface ReadMaskingDigestsInput {
  root: string
  runId: string
}

/**
 * Read (or mint on first use) the host-local HMAC key.
 *
 * Created 0600 under the runtime root — already git-ignored — and `chmodSync`'d after the write so
 * a permissive umask cannot widen it (writeFileSync's `mode` is masked by umask; chmod is not).
 * A malformed or short existing key file is REPLACED rather than trusted, because a truncated key
 * would silently weaken every digest derived from it.
 */
export function resolveMaskingHostKey(agentQaRoot: string): Buffer {
  const keyFile = join(agentQaRoot, MASKING_HOST_KEY_FILE)

  const existing = readHostKeyHex(keyFile)
  if (existing !== undefined) return Buffer.from(existing, 'hex')

  mkdirSync(agentQaRoot, { recursive: true })
  const key = randomBytes(HOST_KEY_BYTES)
  writeFileSync(keyFile, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(keyFile, 0o600)
  return key
}

function readHostKeyHex(keyFile: string): string | undefined {
  let raw: string
  try {
    raw = readFileSync(keyFile, 'utf8')
  } catch {
    return undefined
  }
  const hex = raw.trim()
  return HOST_KEY_HEX_RE.test(hex) ? hex : undefined
}

/**
 * The value identifier: `HMAC-SHA256(hostKey, value)` as lowercase hex.
 *
 * Deliberately takes the key as an argument rather than resolving it: the run resolves the key once
 * and digests many values, and a per-value file read would be both slower and a second place the
 * key file's path is spelled.
 */
export function digestMaskedValue(key: Buffer, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex')
}

/**
 * Write the run's sidecar, replacing it whole.
 *
 * WHOLE-FILE REPLACEMENT IS CORRECT HERE, not lossy: the masking map only ever GROWS within a run
 * and a placeholder's index never changes, so a later write is always a superset of an earlier one.
 * Merging would add a way for a stale entry to outlive the map it describes.
 *
 * Written temp-then-rename in the same directory (the build-tag-map idiom) so a reader never
 * observes a half-written sidecar. Nothing here logs or throws with a value in the message.
 */
export function writeMaskingDigests(input: WriteMaskingDigestsInput): void {
  const dir = join(input.root, RUNS_SUBDIR, slugBranch(input.runId))
  mkdirSync(dir, { recursive: true })

  const entries: Record<string, string> = {}
  for (const entry of input.entries) {
    entries[entry.placeholder] = digestMaskedValue(input.key, entry.value)
  }

  const payload: MaskingDigestsFile = {
    schemaVersion: MASKING_DIGESTS_SCHEMA_VERSION,
    algorithm: MASKING_DIGESTS_ALGORITHM,
    entries,
  }

  const file = join(dir, MASKING_DIGESTS_FILE)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(payload)}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * Read a run's sidecar, or report a typed absence.
 *
 * ABSENCE COVERS EVERY UNRECOGNISED SHAPE — missing file, unparseable bytes, a foreign
 * `schemaVersion`, a foreign `algorithm`, a non-string digest. A reader that guessed at any of
 * those could restore a placeholder to the WRONG value, which is strictly worse than the honest
 * degrade to a typed masked chip (D-10).
 */
export function readMaskingDigests(input: ReadMaskingDigestsInput): MaskingDigestsFile | undefined {
  const file = join(input.root, RUNS_SUBDIR, slugBranch(input.runId), MASKING_DIGESTS_FILE)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }

  if (!isRecord(parsed)) return undefined
  if (parsed.schemaVersion !== MASKING_DIGESTS_SCHEMA_VERSION) return undefined
  if (parsed.algorithm !== MASKING_DIGESTS_ALGORITHM) return undefined
  if (!isRecord(parsed.entries)) return undefined

  const entries: Record<string, string> = {}
  for (const [placeholder, digest] of Object.entries(parsed.entries)) {
    if (typeof digest !== 'string') continue
    entries[placeholder] = digest
  }

  return {
    schemaVersion: MASKING_DIGESTS_SCHEMA_VERSION,
    algorithm: MASKING_DIGESTS_ALGORITHM,
    entries,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
