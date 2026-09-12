// The circularity arbiter's RUN-OWNED DURABLE STATE (Phase 422 plan 14, D-18 / D-19).
//
// WHY THIS FILE EXISTS AT ALL. The arbiter spends model calls to answer "was the served memory
// the reason this step failed". That spend happens BEFORE `enqueueAnalyzeRun` publishes the
// analysis row, so between the two there is a window in which the process can die having spent
// real provider calls and published nothing. A retry that re-derives its state from what the
// enqueue carries would re-spend every one of them, because the enqueue is precisely the thing
// that did not happen. So the state lives HERE, on disk, keyed by the exposure it describes, and
// the enqueue reads it rather than producing it.
//
// INTERRUPTED IS DERIVED, NEVER DECLARED (the 422-06 shape). There is no `status` field on any
// record in this store and there must never be one: a status the crashing code has to clear is a
// status a crash leaves wrong. What is written instead is a RESERVATION before the call and a
// COMPLETION after it, both write-once, both under the same full-identity key. An attempt that
// was interrupted is therefore a reservation with no completion beside it — a fact that follows
// from what IS on disk rather than from what a dying process managed to say about itself.
//
// ALLOWANCE IS COUNTED IN RESERVATIONS, NOT COMPLETIONS. A reservation is the authorization to
// spend, so an interrupted attempt keeps its charge: the remote call may well have happened and
// this process has no way to know, and a budget that refilled itself on every crash is not a
// budget. Completions written with NO reservation — a capped-out exposure, an exposure the root
// posture forbade — are RESULTS rather than spends and are deliberately free.
//
// THE DURABILITY IDIOM IS `canary-run-state.ts`'s, copied on purpose (422-PATTERNS S3): strict
// parse, canonical bytes, write-once `linkSync`, file and directory `fsync`, and a conflict
// raised when an existing file's bytes differ. Two writers racing on one key therefore either
// agree byte-for-byte or one of them is told; neither silently wins.
//
// Import discipline (FUNC-02): `@vostride/agent-qa-schema` and node built-ins only. The evidence
// row's shape has exactly one owner and this file re-spells none of it.

import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

import { z } from 'zod'
import {
  MisdirectionRecordResultSchema,
  canonicalJson,
  sha256hex,
} from '@vostride/agent-qa-schema'
import type { MisdirectionRecordResult } from '@vostride/agent-qa-schema'

export const MISDIRECTION_POLICY_FILE = 'misdirection-policy.json'
export const MISDIRECTION_RESERVATIONS_DIR = 'misdirection-reservations'
export const MISDIRECTION_COMPLETIONS_DIR = 'misdirection-completions'
export const MISDIRECTION_POSTURE_FILE = 'misdirection-posture.json'

/**
 * Whether ANY production composition forwards `PostRunJobCapabilities.readMisdirectionRootPosture`
 * (422 D-19; WINDOWS #427).
 *
 * A CONSTANT and not a probe, because the binding is a property of the shipped composition rather
 * than of a running host: `postRunCapabilities` in `agent-local` forwards the four Gate-1 ports,
 * the staging port and the per-job bound, and it forwards NO posture reader — so the handler's own
 * `readMisdirectionPosture` falls to its fail-closed `'eval-root'` default on every production run.
 *
 * The value is therefore what this build can honestly say about the backing an operator is
 * ACTUALLY getting, and the disclosure below renders it rather than the posture the arbiter
 * recorded. A line that read the recorded `no-eval-root` and printed `declared-only` would tell an
 * operator their circularity claim carries the D-19 BYOM exemption when the analysis that stamped
 * the verdict never saw it.
 *
 * It is pinned by a raw-source cell in `__tests__/adversarial-disclosure.test.ts` (the S6 idiom):
 * the day a composition binds the member, that cell reds and this constant has to be revisited
 * rather than quietly disagreeing with the code.
 */
export const MISDIRECTION_POSTURE_BOUND_AT_HOST = false

/**
 * The FULL identity one check is keyed by (D-18).
 *
 * Five components and not four: 422-11 keys evidence by EXPOSURE `(step, record)` because a
 * record served on two steps is two checks, and the decision ordinal is carried beside them
 * because a step's live decision is what the arbiter actually replays. A key missing any one of
 * these would let a second, genuinely different check be read as a duplicate of the first.
 */
export interface MisdirectionCheckKey {
  readonly runId: string
  readonly perTest: number
  readonly stepIndex: number
  readonly decisionOrdinal: number
  readonly recordId: string
}

/** The on-disk name of one key. Canonical JSON, so component order cannot move the file. */
export function misdirectionCheckKeyDigest(key: MisdirectionCheckKey): string {
  return sha256hex(
    canonicalJson({
      runId: key.runId,
      perTest: key.perTest,
      stepIndex: key.stepIndex,
      decisionOrdinal: key.decisionOrdinal,
      recordId: key.recordId,
    }),
  )
}

/** Two keys name the same check. Used to join a completion to its reservation. */
export function sameMisdirectionCheckKey(
  left: MisdirectionCheckKey,
  right: MisdirectionCheckKey,
): boolean {
  return misdirectionCheckKeyDigest(left) === misdirectionCheckKeyDigest(right)
}

/**
 * Where the per-run check cap came from.
 *
 * TWO WORDS AND NOT THREE, unlike the canary ablation cap beside it: no operator configuration
 * key governs this bound yet, so a `config` arm would be a word nothing in the tree can produce
 * and every reader would have to handle. It becomes three the day the knob lands, and the durable
 * policy already records which word resolved a given run.
 */
export type MisdirectionCapSource = 'flag' | 'default'
const CAP_SOURCES: readonly MisdirectionCapSource[] = ['flag', 'default']

/**
 * The run's RESOLVED per-run check cap, written once and never re-resolved.
 *
 * A cap re-read on every attempt is not a cap: a restart under a widened configuration would
 * hand a half-spent run a fresh budget, which is the one thing a bound on provider spend exists
 * to prevent. `writeMisdirectionRunPolicy` therefore preserves the ORIGINAL resolution including
 * the source it came from, exactly as `writeRunCanaryPolicy` does for the ablation cap.
 */
export interface MisdirectionRunPolicy {
  readonly schemaVersion: 1
  readonly runId: string
  readonly maxChecks: number
  readonly source: MisdirectionCapSource
}

const policySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    maxChecks: z.number().int().nonnegative(),
    source: z.enum(['flag', 'default']),
  })
  .strict()

export function readMisdirectionRunPolicy(
  runDir: string,
  runId: string,
): MisdirectionRunPolicy | undefined {
  let text: string
  try {
    text = readFileSync(join(runDir, MISDIRECTION_POLICY_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('misdirection policy unavailable')
  }
  let parsed: MisdirectionRunPolicy
  try {
    parsed = policySchema.parse(JSON.parse(text)) as MisdirectionRunPolicy
  } catch {
    throw new Error('misdirection policy invalid')
  }
  if (parsed.runId !== runId) throw new Error('misdirection policy identity mismatch')
  return parsed
}

export function writeMisdirectionRunPolicy(runDir: string, policy: MisdirectionRunPolicy): void {
  const value = policySchema.parse(policy) as MisdirectionRunPolicy
  if (!CAP_SOURCES.includes(value.source)) throw new Error('misdirection policy source invalid')
  // Resumption preserves the ORIGINAL resolution, including its recorded source.
  if (readMisdirectionRunPolicy(runDir, value.runId) !== undefined) return
  mkdirSync(runDir, { recursive: true })
  const file = join(runDir, MISDIRECTION_POLICY_FILE)
  const temporary = join(runDir, `.${MISDIRECTION_POLICY_FILE}.${randomUUID()}.tmp`)
  const text = `${canonicalJson(value)}\n`
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    fsyncPath(temporary)
    try {
      linkSync(temporary, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      readMisdirectionRunPolicy(runDir, value.runId)
    }
    fsyncPath(runDir)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/**
 * The authorization to spend ONE check, written BEFORE the call that spends it.
 *
 * It carries every identity the row it will become must bind, so a recovered attempt can be
 * described completely from the reservation alone — which is what makes an interrupted attempt
 * reportable rather than merely absent.
 */
export interface MisdirectionCheckReservation extends MisdirectionCheckKey {
  readonly schemaVersion: 1
  readonly handoffBaseDigest: string
  readonly briefDigest: string
  readonly corpusDigest: string
  readonly profileDigest: string
}

const reservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    perTest: z.number().int().nonnegative(),
    stepIndex: z.number().int().nonnegative(),
    decisionOrdinal: z.number().int().nonnegative(),
    recordId: z.string().min(1),
    handoffBaseDigest: z.string().min(1),
    briefDigest: z.string().min(1),
    corpusDigest: z.string().min(1),
    profileDigest: z.string().min(1),
  })
  .strict()

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Write-once publication of one canonical document under `dir/name`, with conflict detection. */
function publishOnce(dir: string, name: string, text: string, conflict: string): void {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  const temporary = join(dir, `.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    fsyncPath(temporary)
    try {
      linkSync(temporary, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readFileSync(file, 'utf8') !== text) {
        throw new Error(conflict)
      }
    }
    fsyncPath(dir)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function readDocuments(dir: string, unavailable: string): { name: string; text: string }[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(unavailable)
  }
  return names
    .filter((name) => !name.startsWith('.'))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
}

/**
 * Charge ONE check against this run's allowance, durably, before the call is made.
 *
 * Idempotent per key: a second reservation of the same check with the same identities is the
 * same charge and is absorbed. A second reservation with DIFFERENT identities under one key is a
 * conflict and is raised, because the key is supposed to determine them.
 */
export function reserveMisdirectionCheck(
  runDir: string,
  reservation: MisdirectionCheckReservation,
): void {
  const value = reservationSchema.parse(reservation) as MisdirectionCheckReservation
  publishOnce(
    join(runDir, MISDIRECTION_RESERVATIONS_DIR),
    `${misdirectionCheckKeyDigest(value)}.json`,
    `${canonicalJson(value)}\n`,
    'misdirection check reservation conflict',
  )
}

export function readMisdirectionCheckReservations(
  runDir: string,
  runId: string,
): MisdirectionCheckReservation[] {
  return readDocuments(
    join(runDir, MISDIRECTION_RESERVATIONS_DIR),
    'misdirection check reservations unavailable',
  ).map(({ name, text }) => {
    let value: MisdirectionCheckReservation
    try {
      value = reservationSchema.parse(JSON.parse(text)) as MisdirectionCheckReservation
    } catch {
      throw new Error('misdirection check reservation invalid')
    }
    if (value.runId !== runId || name !== `${misdirectionCheckKeyDigest(value)}.json`) {
      throw new Error('misdirection check reservation identity mismatch')
    }
    return value
  })
}

/**
 * Record ONE finished per-record result. Completed work only — an interrupted provider call is
 * never recovered here, which is the whole reason the reservation above exists separately.
 */
export function saveCompletedMisdirectionCheck(
  runDir: string,
  row: MisdirectionRecordResult,
): void {
  const value = MisdirectionRecordResultSchema.parse(row) as MisdirectionRecordResult
  publishOnce(
    join(runDir, MISDIRECTION_COMPLETIONS_DIR),
    `${misdirectionCheckKeyDigest(value)}.json`,
    `${canonicalJson(value)}\n`,
    'completed misdirection evidence conflict',
  )
}

export function readCompletedMisdirectionChecks(
  runDir: string,
  runId: string,
): MisdirectionRecordResult[] {
  return readDocuments(
    join(runDir, MISDIRECTION_COMPLETIONS_DIR),
    'completed misdirection evidence unavailable',
  ).map(({ name, text }) => {
    let value: MisdirectionRecordResult
    try {
      value = MisdirectionRecordResultSchema.parse(JSON.parse(text)) as MisdirectionRecordResult
    } catch {
      throw new Error('completed misdirection evidence invalid')
    }
    if (value.runId !== runId || name !== `${misdirectionCheckKeyDigest(value)}.json`) {
      throw new Error('completed misdirection evidence identity mismatch')
    }
    return value
  })
}

/**
 * Everything this run has durably recorded about its own arbiter work.
 *
 * `interrupted` and `spent` are DERIVED here rather than stored anywhere: the first is the set of
 * reservations with no completion beside them, the second is simply how many reservations exist.
 * Neither is a field a crashing process had to remember to write.
 */
export interface MisdirectionRunState {
  readonly policy: MisdirectionRunPolicy | undefined
  readonly reservations: readonly MisdirectionCheckReservation[]
  readonly completions: readonly MisdirectionRecordResult[]
  /** Reservations with no completion — an attempt that spent and did not finish. */
  readonly interrupted: readonly MisdirectionCheckReservation[]
  /** Allowance already charged. Reservations, never completions (see this file's header). */
  readonly spent: number
}

export function readMisdirectionRunState(runDir: string, runId: string): MisdirectionRunState {
  const reservations = readMisdirectionCheckReservations(runDir, runId)
  const completions = readCompletedMisdirectionChecks(runDir, runId)
  const completed = new Set(completions.map((row) => misdirectionCheckKeyDigest(row)))
  const interrupted = reservations.filter(
    (row) => !completed.has(misdirectionCheckKeyDigest(row)),
  )
  return {
    policy: readMisdirectionRunPolicy(runDir, runId),
    reservations,
    completions,
    interrupted,
    spent: reservations.length,
  }
}

/**
 * The evaluation-root posture this run's arbiter last operated under (D-19).
 *
 * WHY IT IS DURABLE AND NOT MERELY RETURNED. An absent evaluation root and a root that exists and
 * cannot be read record the SAME thing on the handoff — an empty ledger — and mean opposite
 * things: the first earns D-19's `declared-only` exemption, the second is an unbacked gated
 * posture that has NOT earned it. A later reader of `handoff.json` sees one empty array, so the
 * difference has to live somewhere it can actually be found. It also lets a retry re-state the
 * posture without consulting the root a second time.
 *
 * LAST WRITE WINS, unlike the cap beside it, and the asymmetry is deliberate: a cap that moved
 * would let a crash loop spend forever, while a posture that could not move would tell a fixed
 * root it is still broken. The write is the analysis artifact's rename idiom for the same reason
 * — a reader sees the whole old record or the whole new one.
 */
export interface MisdirectionRunPostureRecord {
  readonly schemaVersion: 1
  readonly runId: string
  readonly kind: 'eval-root' | 'no-eval-root' | 'broken-eval-root'
  readonly corpusDigest?: string
  readonly profileDigest?: string
  readonly reason?: string
}

const postureSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    kind: z.enum(['eval-root', 'no-eval-root', 'broken-eval-root']),
    corpusDigest: z.string().min(1).optional(),
    profileDigest: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()

export function readMisdirectionRunPosture(
  runDir: string,
  runId: string,
): MisdirectionRunPostureRecord | undefined {
  let text: string
  try {
    text = readFileSync(join(runDir, MISDIRECTION_POSTURE_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('misdirection root posture unavailable')
  }
  let parsed: MisdirectionRunPostureRecord
  try {
    parsed = postureSchema.parse(JSON.parse(text)) as MisdirectionRunPostureRecord
  } catch {
    throw new Error('misdirection root posture invalid')
  }
  if (parsed.runId !== runId) throw new Error('misdirection root posture identity mismatch')
  return parsed
}

export function writeMisdirectionRunPosture(
  runDir: string,
  record: MisdirectionRunPostureRecord,
): void {
  const value = postureSchema.parse(record) as MisdirectionRunPostureRecord
  mkdirSync(runDir, { recursive: true })
  replaceAtomically(join(runDir, MISDIRECTION_POSTURE_FILE), `${canonicalJson(value)}\n`)
}

/**
 * Publish the run's arbiter rows onto its own `handoff.json`, atomically (D-18).
 *
 * THE SIDECAR IS WRITTEN BEFORE THE ENQUEUE MINTS ITS DIGEST, which is the whole ordering this
 * plan exists to establish: `enqueueAnalyzeRun` loads the FINAL handoff and digests it, so a row
 * written afterwards would be a row the analysed bytes do not cover — and curation-time
 * attribution, which is where the only other producer could have lived, is far too late to back
 * the FIRST analysis of the run.
 *
 * ABSENT AND EMPTY STAY TWO FACTS. This function is called only when the arbiter actually ran;
 * a run with nothing to check never reaches it and keeps a handoff with no member at all.
 *
 * The durability idiom is the analysis artifact's (stage → fsync → rename → fsync dir) rather
 * than the write-once link above, because this is a REPLACEMENT of an existing document: the
 * rename is what makes a reader see either the whole old handoff or the whole new one.
 */
export function persistMisdirectionSidecar(
  handoffPath: string,
  rows: readonly MisdirectionRecordResult[],
): void {
  const value = rows.map((row) => MisdirectionRecordResultSchema.parse(row))
  const raw: unknown = JSON.parse(readFileSync(handoffPath, 'utf8'))
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('completed run handoff is not an object')
  }
  const next = { ...(raw as Record<string, unknown>), misdirectionEvidence: value }
  // `canonicalJson`, matching the posture writer above and every other document this phase
  // writes -- and matching the basis `enqueueAnalyzeRun` already digests this handoff under.
  // A plain `JSON.stringify` here was a third serialization of one document.
  replaceAtomically(handoffPath, `${canonicalJson(next)}\n`)
}

/**
 * Stage → fsync → rename → fsync dir: a reader sees the whole old document or the whole new one.
 *
 * THE EXISTING FILE'S MODE IS PRESERVED. This renames over documents another writer created --
 * `handoff.json` is the runner's -- and staging at a hardcoded `0o600` silently tightened that
 * file to owner-only on the first sidecar write, regardless of what the runner chose. `0o600`
 * remains the default for a document this function is CREATING.
 */
function replaceAtomically(path: string, text: string): void {
  const dir = dirname(path)
  const staged = join(dir, `.${randomUUID()}.tmp`)
  let mode = 0o600
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    // No existing document: this call is creating one, and owner-only is the right default.
  }
  try {
    writeFileSync(staged, text, { encoding: 'utf8', mode })
    fsyncPath(staged)
    renameSync(staged, path)
    fsyncPath(dir)
  } finally {
    rmSync(staged, { force: true })
  }
}
