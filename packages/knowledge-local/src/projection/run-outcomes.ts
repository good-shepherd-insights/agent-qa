/**
 * Run-outcome projection: per-test outcome counters and exercised-anchor sets (ABRF-02, D-14/D-15).
 *
 * Third application of the handoff-to-projection fold idiom (after curation emit and canary
 * emit): a pure projection over one CompletedRunHandoff, a SQLite writer against the one
 * derived-index connection, and a full rebuild that reproduces identical tables from
 * `.agent-qa/runs/<runId>/handoff.json` scans alone (L12 — derived state is disposable).
 *
 * The projection knows ABOUT tests (identity, counters, anchors, flags) and never CONTAINS
 * them: no test file content enters the store, and tests are never memidex-indexed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import {
  canonicalJson,
  guardCompletedRunHandoff,
  normalizeAnchor,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  CompletedRunHandoff,
  PerTestOutcome,
  StepEvidence,
} from '@vostride/agent-qa-schema'

import { ensureRunOutcomeTables, openIndexWriter } from '../index-open.js'

/**
 * Stamped into the curation-tail receipt's projection component. Bump when the fold
 * semantics or table shapes change so already-receipted runs refold on the next tail.
 */
export const RUN_OUTCOMES_PROJECTION_VERSION = 1

/**
 * PROVISIONAL last-N window for per-test outcome history (~10 pending ABRF-02 ranking
 * measurements). Entries are {buildOrdinal, passed} — ordinals only, wall-clock never.
 */
export const LAST_OUTCOMES_LIMIT = 10

/**
 * PROVISIONAL quarantine threshold: a test whose flake count reaches this value is
 * flagged quarantined for ABRF-02's exemplar ranking to deprioritize. Tuning belongs
 * to the ranking plan; the derived-flag shape is the contract here.
 */
export const QUARANTINE_FLAKE_THRESHOLD = 3

/**
 * Mirrors runner-local's HANDOFF_FILE. knowledge-local sits below runner-local in the
 * package layering, so the constant cannot be imported without inverting the dependency
 * direction; the rebuild receives the runs root and joins this fixed leaf name.
 */
const RUN_HANDOFF_FILE = 'handoff.json'

/** Anchor extraction seam: the CLI tail passes its exercisedAnchors(step) walk. */
export type ExtractStepAnchors = (step: StepEvidence) => Anchor[]

export interface ProjectRunOutcomesOptions {
  /**
   * Gate-run exclusion flag (Pitfall 7): internal validation runs — M4's
   * verify-before-present gate and eval cassette replays are the named future setters —
   * must contribute zero counter changes so replays cannot inflate exemplar trust.
   * PROVISIONAL plumbing: the tail's invoker passes it; a handoff-level
   * `excludedFromOutcomes: true` marker is honored regardless of the caller's flag.
   */
  excluded: boolean
  extractAnchors: ExtractStepAnchors
}

export interface RunOutcomeTestDelta {
  filePath: string
  testName: string
  passed: boolean
  heals: number
  flake: boolean
  /** canonicalJson(normalizeAnchor(...)) keys — byte-deterministic (ABRF-02 encoding edge). */
  anchorKeys: string[]
}

export interface RunOutcomesProjection {
  runId: string
  buildOrdinal: number
  excluded: boolean
  tests: RunOutcomeTestDelta[]
}

export type ApplyRunOutcomesResult =
  | { kind: 'applied'; tests: number }
  | { kind: 'already-applied'; tests: 0 }

export interface RebuildRunOutcomesOptions {
  extractAnchors: ExtractStepAnchors
}

export interface RebuildRunOutcomesReport {
  folded: number
  skipped: number
}

export interface FoldRunOutcomesOptions {
  /** Absolute agent-qa-knowledge root hosting the derived index SQLite. */
  knowledgeRoot: string
  handoff: CompletedRunHandoff
  excluded: boolean
  extractAnchors: ExtractStepAnchors
}

export type FoldRunOutcomesReport = ApplyRunOutcomesResult

interface OutcomeEntry {
  buildOrdinal: number
  passed: boolean
}

function handoffMarksExcluded(handoff: unknown): boolean {
  return typeof handoff === 'object'
    && handoff !== null
    && (handoff as { excludedFromOutcomes?: unknown }).excludedFromOutcomes === true
}

function countedOutcome(outcome: PerTestOutcome['outcome']): boolean | undefined {
  switch (outcome) {
    case 'passed':
    case 'healed':
      return true
    case 'failed':
    case 'timeout':
      return false
    default:
      // 'skipped' and 'cancelled' members never ran to a verdict — no counter entry.
      return undefined
  }
}

function testDelta(
  test: PerTestOutcome,
  extractAnchors: ExtractStepAnchors,
): RunOutcomeTestDelta | undefined {
  const passed = countedOutcome(test.outcome)
  if (passed === undefined) return undefined

  const steps = test.steps ?? []
  const anchorKeys = new Set<string>()
  for (const step of steps) {
    for (const anchor of extractAnchors(step)) {
      anchorKeys.add(canonicalJson(normalizeAnchor(anchor)))
    }
  }

  return {
    filePath: test.filePath,
    testName: test.testId,
    passed,
    heals: steps.filter((step) => step.selfHeal !== undefined).length,
    flake: test.rootCause?.class === 'flake',
    anchorKeys: [...anchorKeys].sort(),
  }
}

/** Pure fold: identical handoff bytes yield identical row deltas. */
export function projectRunOutcomes(
  handoff: CompletedRunHandoff,
  opts: ProjectRunOutcomesOptions,
): RunOutcomesProjection {
  const excluded = opts.excluded || handoffMarksExcluded(handoff)
  const tests = excluded
    ? []
    : (handoff.tests ?? []).flatMap((test) => {
        const delta = testDelta(test, opts.extractAnchors)
        return delta === undefined ? [] : [delta]
      })
  return {
    runId: String(handoff.runId),
    buildOrdinal: handoff.buildOrdinal,
    excluded,
    tests,
  }
}

function mergeOutcomeEntries(
  existingJson: string | undefined,
  entry: OutcomeEntry,
): string {
  let entries: OutcomeEntry[] = []
  if (existingJson !== undefined) {
    try {
      const parsed: unknown = JSON.parse(existingJson)
      if (Array.isArray(parsed)) entries = parsed as OutcomeEntry[]
    } catch {
      // A malformed history heals through the rebuild; start the window fresh.
    }
  }
  entries.push(entry)
  // Ordinal-sorted (tiebreak on passed) so incremental fold order and rebuild scan order
  // produce byte-identical windows — the L12 parity requirement.
  entries.sort((a, b) =>
    a.buildOrdinal - b.buildOrdinal || Number(a.passed) - Number(b.passed),
  )
  return canonicalJson(entries.slice(-LAST_OUTCOMES_LIMIT))
}

function runAlreadyApplied(db: DatabaseSync, runId: string): boolean {
  return db
    .prepare('SELECT 1 AS present FROM run_outcome_applied_runs WHERE run_id = ?')
    .get(runId) !== undefined
}

/**
 * Writer against the one index connection. Idempotent per runId: the applied-runs marker
 * commits in the same transaction as the counter rows, so a crash-rerun tail that refolds
 * an already-applied run (receipt withheld mid-tail) changes nothing.
 */
export function applyRunOutcomes(
  db: DatabaseSync,
  projection: RunOutcomesProjection,
): ApplyRunOutcomesResult {
  ensureRunOutcomeTables(db)
  if (runAlreadyApplied(db, projection.runId)) {
    return { kind: 'already-applied', tests: 0 }
  }

  const selectRow = db.prepare(`
    SELECT passes, failures, heals, flake_count, last_outcomes_json, last_build_ordinal
    FROM run_test_outcomes
    WHERE file_path = ? AND test_name = ?
  `)
  const upsertRow = db.prepare(`
    INSERT INTO run_test_outcomes (
      file_path, test_name, passes, failures, heals, flake_count, quarantined,
      last_outcomes_json, last_build_ordinal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (file_path, test_name) DO UPDATE SET
      passes = excluded.passes,
      failures = excluded.failures,
      heals = excluded.heals,
      flake_count = excluded.flake_count,
      quarantined = excluded.quarantined,
      last_outcomes_json = excluded.last_outcomes_json,
      last_build_ordinal = excluded.last_build_ordinal
  `)
  const insertAnchor = db.prepare(`
    INSERT OR IGNORE INTO run_test_anchors (file_path, test_name, anchor_normalized_json)
    VALUES (?, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const test of projection.tests) {
      const existing = selectRow.get(test.filePath, test.testName) as
        | {
            passes: number
            failures: number
            heals: number
            flake_count: number
            last_outcomes_json: string
            last_build_ordinal: number | null
          }
        | undefined
      const passes = (existing?.passes ?? 0) + (test.passed ? 1 : 0)
      const failures = (existing?.failures ?? 0) + (test.passed ? 0 : 1)
      const heals = (existing?.heals ?? 0) + test.heals
      const flakeCount = (existing?.flake_count ?? 0) + (test.flake ? 1 : 0)
      const lastBuildOrdinal = Math.max(
        existing?.last_build_ordinal ?? projection.buildOrdinal,
        projection.buildOrdinal,
      )
      upsertRow.run(
        test.filePath,
        test.testName,
        passes,
        failures,
        heals,
        flakeCount,
        flakeCount >= QUARANTINE_FLAKE_THRESHOLD ? 1 : 0,
        mergeOutcomeEntries(existing?.last_outcomes_json, {
          buildOrdinal: projection.buildOrdinal,
          passed: test.passed,
        }),
        lastBuildOrdinal,
      )
      for (const anchorKey of test.anchorKeys) {
        insertAnchor.run(test.filePath, test.testName, anchorKey)
      }
    }
    db.prepare('INSERT INTO run_outcome_applied_runs (run_id) VALUES (?)')
      .run(projection.runId)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the apply error that caused the rollback.
    }
    throw error
  }
  return { kind: 'applied', tests: projection.tests.length }
}

function loadRebuildHandoff(file: string): CompletedRunHandoff | undefined {
  let guarded: CompletedRunHandoff
  try {
    guarded = guardCompletedRunHandoff(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
  // RESEARCH A2 / v2 no-back-compat: the schema guard validates only schemaVersion, so
  // pre-381 v3 handoffs lacking the REQUIRED per-test filePath still load. Stable test
  // identity is filePath + testId; without it the row key cannot be minted, so such
  // handoffs are skipped STRUCTURALLY here with a counted skip, never a throw.
  const structurallyCurrent = (guarded.tests ?? []).every(
    (test) => typeof test.filePath === 'string' && test.filePath.length > 0,
  )
  return structurallyCurrent ? guarded : undefined
}

/**
 * Full rebuild: clear the projection tables, scan every run dir under `runsRoot`, and
 * refold each loadable handoff. Reproduces tables byte-identical to the incremental fold
 * (L12); a rebuild over zero handoff dirs yields empty tables without error (ABRF-02
 * empty edge). Load failures and pre-381 shapes are counted skips.
 */
export function rebuildRunOutcomes(
  db: DatabaseSync,
  runsRoot: string,
  opts: RebuildRunOutcomesOptions,
): RebuildRunOutcomesReport {
  ensureRunOutcomeTables(db)
  db.exec(`
    DELETE FROM run_test_outcomes;
    DELETE FROM run_test_anchors;
    DELETE FROM run_outcome_applied_runs;
  `)

  const report: RebuildRunOutcomesReport = { folded: 0, skipped: 0 }
  if (!existsSync(runsRoot)) return report

  const handoffFiles = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsRoot, entry.name, RUN_HANDOFF_FILE))
    .filter((file) => existsSync(file))
    .sort()

  for (const file of handoffFiles) {
    const handoff = loadRebuildHandoff(file)
    if (handoff === undefined) {
      report.skipped += 1
      continue
    }
    applyRunOutcomes(db, projectRunOutcomes(handoff, {
      excluded: false,
      extractAnchors: opts.extractAnchors,
    }))
    report.folded += 1
  }
  return report
}

/**
 * Incremental fold wrapper for the post-verdict tail: opens the one index writer, applies
 * the projection, and closes. The tail invokes it inside the SAME crash boundary and the
 * SAME (extended) receipt as candidate/canary emit — never a second marker file.
 */
export function foldRunOutcomes(opts: FoldRunOutcomesOptions): FoldRunOutcomesReport {
  const projection = projectRunOutcomes(opts.handoff, {
    excluded: opts.excluded,
    extractAnchors: opts.extractAnchors,
  })
  const handle = openIndexWriter(opts.knowledgeRoot)
  try {
    return applyRunOutcomes(handle.db, projection)
  } finally {
    handle.close()
  }
}
