/**
 * Read side of the run-outcome projection (389 ANLZ-03, RESEARCH Pitfall 2).
 *
 * `run_test_outcomes` is written by `foldRunOutcomes`/`applyRunOutcomes`; this module is
 * the one place that queries it. Strictly read-only: one prepared SELECT, no statement
 * that mutates a row, ever — the writer half stays whole in `run-outcomes.ts`.
 *
 * KEY LAW — stable test identity is `(product, filePath, testName)`, exactly the
 * projection's primary key and per-test-outcome.ts's identity rule. Callers joining from
 * a handoff use `PerTestOutcome.filePath` + `testName`, NEVER `testId` (a per-run
 * explicit id, not a durable identity).
 */
import type { DatabaseSync } from 'node:sqlite'

import { LAST_OUTCOMES_LIMIT } from './run-outcomes.js'

/** One window entry: ordinals only, wall-clock never (mirrors the writer's OutcomeEntry). */
export interface TestOutcomeEntry {
  buildOrdinal: number
  passed: boolean
}

export interface TestOutcomeHistory {
  passes: number
  failures: number
  heals: number
  flakeCount: number
  /** Ordinal-ascending, at most LAST_OUTCOMES_LIMIT entries; [] when the stored JSON is malformed. */
  lastOutcomes: TestOutcomeEntry[]
  lastBuildOrdinal: number | undefined
}

/** The projection's key, spelled the way the table is keyed. */
export interface TestOutcomeIdentity {
  product: string
  filePath: string
  testName: string
}

function isOutcomeEntry(value: unknown): value is TestOutcomeEntry {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { buildOrdinal?: unknown }).buildOrdinal === 'number'
    && typeof (value as { passed?: unknown }).passed === 'boolean'
  )
}

/**
 * Heal-to-empty parse of `last_outcomes_json` — the same tolerance posture as the
 * writer's `mergeOutcomeEntries`: a malformed history is an empty window, never a throw.
 * The ascending sort and window cap are re-derived defensively so the read-side
 * invariants hold even over bytes an older writer left behind.
 */
function parseLastOutcomes(json: string): TestOutcomeEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(isOutcomeEntry)
    .map((entry) => ({ buildOrdinal: entry.buildOrdinal, passed: entry.passed }))
    .sort((a, b) => a.buildOrdinal - b.buildOrdinal || Number(a.passed) - Number(b.passed))
    .slice(-LAST_OUTCOMES_LIMIT)
}

/**
 * Answer one test's failure history from `run_test_outcomes`, or `undefined` when the
 * projection has never counted the test — typed absence, never an empty stand-in row.
 */
export function readTestOutcomeHistory(
  db: DatabaseSync,
  identity: TestOutcomeIdentity,
): TestOutcomeHistory | undefined {
  const row = db
    .prepare(`
      SELECT passes, failures, heals, flake_count, last_outcomes_json, last_build_ordinal
      FROM run_test_outcomes
      WHERE product = ? AND file_path = ? AND test_name = ?
    `)
    .get(identity.product, identity.filePath, identity.testName) as
    | {
        passes: number
        failures: number
        heals: number
        flake_count: number
        last_outcomes_json: string
        last_build_ordinal: number | null
      }
    | undefined
  if (row === undefined) return undefined
  return {
    passes: row.passes,
    failures: row.failures,
    heals: row.heals,
    flakeCount: row.flake_count,
    lastOutcomes: parseLastOutcomes(row.last_outcomes_json),
    lastBuildOrdinal: row.last_build_ordinal ?? undefined,
  }
}
