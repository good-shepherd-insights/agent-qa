// Phase 372 G2 read legs — the report verb's input integrity layer.
//
// Inverts FsReplayRecordStore's and FsScoreStore's write legs: reads `replay.json` / `score.json`
// back from a staged cassette dir with the exact typed-refusal posture of loadCassetteBundle —
// staged files are hand-editable, cross-machine documents, so every read/parse failure becomes a
// typed ReplayRefusal instead of a throw (D-08: refusals are data; the surrounding batch always
// survives). A missing score.json is typed ABSENCE, not an error: refusal outcomes are never
// scored, the report verb counts them instead. eval-local serializes/deserializes only (F9) —
// no scoring or aggregation logic lives here; deep validation stays with eval core's guards.

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { ReplayCassetteOutcome, ReplayRefusal } from '@vostride/agent-qa-eval'

import { REPLAY_RECORD_FILE } from './replay-record-store.js'
import { SCORE_FILE, type ScoreRecord } from './score-store.js'

/** The discriminated replay-record read outcome: a persisted outcome, or a typed refusal. */
export type ReplayRecordLoad =
  | { kind: 'loaded'; outcome: ReplayCassetteOutcome }
  | { kind: 'refused'; refusal: ReplayRefusal }

/** The score read outcome: a persisted record, typed absence (never scored), or a typed refusal. */
export type ScoreRecordLoad =
  | { kind: 'loaded'; record: ScoreRecord }
  | { kind: 'absent' }
  | { kind: 'refused'; refusal: ReplayRefusal }

// Every refusal is attributed to a cassette id recovered from the dir basename: unlike
// loadCassetteBundle there is no guard step here (deep validation stays with eval core), so a
// document is never parsed-but-rejected — read/parse failures are the only refusal paths and the
// basename is the only recoverable id on them.
function refusal(cassetteId: string, detail: string): ReplayRefusal {
  return { kind: 'integrity-refusal', cassetteId, reason: 'parse-failed', detail }
}

// The shared read→parse ladder (loadCassetteBundle's posture): every failure is a returned value.
function readDocument(
  path: string,
  fallbackId: string,
): { kind: 'parsed'; document: unknown } | { kind: 'refused'; refusal: ReplayRefusal } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return {
      kind: 'refused',
      refusal: refusal(
        fallbackId,
        `Failed to read ${path}: ${(error as NodeJS.ErrnoException).message}`,
      ),
    }
  }

  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch (error) {
    return {
      kind: 'refused',
      refusal: refusal(fallbackId, `Invalid JSON at ${path}: ${(error as Error).message}`),
    }
  }

  return { kind: 'parsed', document }
}

/**
 * Read a persisted ReplayCassetteOutcome back from `<dir>/replay.json`. A replay dir without its
 * marker file is corrupt, not empty — a missing or unreadable file refuses like a parse failure.
 * Never throws; the store serialized the outcome verbatim so the parsed document is it.
 */
export function loadReplayRecord(dir: string): ReplayRecordLoad {
  const read = readDocument(join(dir, REPLAY_RECORD_FILE), basename(dir))
  if (read.kind === 'refused') return read
  return { kind: 'loaded', outcome: read.document as ReplayCassetteOutcome }
}

/**
 * Read a persisted ScoreRecord back from `<dir>/score.json`. Absence is typed and legitimate
 * (refusal outcomes are never scored); an existing-but-unreadable/unparseable file refuses.
 * Never throws.
 */
export function loadScoreRecord(dir: string): ScoreRecordLoad {
  const path = join(dir, SCORE_FILE)
  if (!existsSync(path)) return { kind: 'absent' }

  const read = readDocument(path, basename(dir))
  if (read.kind === 'refused') return read
  return { kind: 'loaded', record: read.document as ScoreRecord }
}
