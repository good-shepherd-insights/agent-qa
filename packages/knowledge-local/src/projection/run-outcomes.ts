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
  ANALYSIS_FILE,
  admitAnalysisArtifactForRun,
  canonicalJson,
  errorTextOf,
  exercisedAnchors,
  failingStepOf,
  failureFingerprint,
  guardCompletedRunHandoff,
  guardRunAnalysisArtifact,
  normalizeAnchor,
  resolveRunVerdicts,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  CompletedRunHandoff,
  PerTestOutcome,
  RunAnalysisArtifact,
  ScopeKey,
  StepEvidence,
  Verdict,
  VerdictClass,
} from '@vostride/agent-qa-schema'

import type { GuardrailPolicy } from '@vostride/agent-qa-schema'
import { QuarantineLedgerVersionError } from '@vostride/agent-qa-schema'
import type { QuarantineLedgerEvent } from '@vostride/agent-qa-schema'

import { ensureRunOutcomeTables, openIndexWriter } from '../index-open.js'
import { evaluateQuarantineDetection } from '../quarantine/detection.js'
import type {
  QuarantineDetectionFailure,
  QuarantineDetectionSighting,
  QuarantineDetectionTestWindow,
} from '../quarantine/detection.js'
import {
  appendQuarantineEvents,
  foldQuarantineLedgerState,
  readQuarantineLedger,
} from '../quarantine/ledger.js'
import type {
  QuarantineAppendOutcome,
  RefusedQuarantineLine,
} from '../quarantine/ledger.js'
import { fingerprintRecurrence } from './fingerprint-window-read.js'
import { readTestOutcomeHistory } from './run-outcome-read.js'

/**
 * Stamped into the curation-tail receipt's projection component. Bump when the fold
 * semantics or table shapes change so already-receipted runs refold on the next tail.
 * Version 2 partitions every row and applied-run marker, forcing existing receipts to
 * refold through the product/scope-keyed shape. Version 3 (390 D-02/D-07/D-09) reads
 * RESOLVED verdicts instead of the handoff's deterministic floor, adds the fingerprint-keyed
 * recurrence window, and deletes the provisional derived `quarantined` column — the derived
 * index is gitignored and rebuildable (L12), so this bump IS the migration.
 */
export const RUN_OUTCOMES_PROJECTION_VERSION = 3

/**
 * PROVISIONAL last-N window for per-test outcome history (~10 pending ABRF-02 ranking
 * measurements). Entries are {buildOrdinal, passed} — ordinals only, wall-clock never.
 */
export const LAST_OUTCOMES_LIMIT = 10

/**
 * Mirrors runner-local's HANDOFF_FILE. knowledge-local sits below runner-local in the
 * package layering, so the constant cannot be imported without inverting the dependency
 * direction; the rebuild receives the runs root and joins this fixed leaf name.
 */
const RUN_HANDOFF_FILE = 'handoff.json'

/** Anchor extraction seam: the CLI tail passes its exercisedAnchors(step) walk. */
export type ExtractStepAnchors = (step: StepEvidence) => Anchor[]

/**
 * Projection inputs contain no exclusion override. The durable handoff marker is the sole
 * authority for current-run folds, sibling backfill, and full rebuild alike (D-14 §6).
 */
export interface ProjectRunOutcomesOptions {
  extractAnchors: ExtractStepAnchors
  /**
   * The run's persisted analysis artifact when one exists (390 D-09, the `ProjectCanaryOutcomes
   * Input.artifact` precedent). DATA, not a port: `foldRunOutcomes` and `rebuildRunOutcomes` each
   * load it from the run's own dir through the one shared loader and hand it here, so ONE
   * projection function with ONE signature serves both paths — a second signature only one path
   * calls is exactly how L12 rebuild parity breaks in silence.
   */
  artifact?: RunAnalysisArtifact
}

/**
 * What a FAILED member contributes to the fingerprint-keyed recurrence window (390 D-07).
 *
 * The fingerprint is composed through the ONE exported vocabulary — `failingStepOf`/`errorTextOf`
 * over `exercisedAnchors`, keyed by `failureFingerprint` — so this window and the render-time
 * cluster presentation cannot disagree about what "the same failure" is. The verdict class is part
 * of the key by recipe, which is why it travels beside it rather than being re-derived downstream.
 */
export interface RunOutcomeFailureKey {
  fingerprint: string
  verdictClass: VerdictClass
}

export interface RunOutcomeTestDelta {
  filePath: string
  testName: string
  passed: boolean
  heals: number
  flake: boolean
  /** canonicalJson(normalizeAnchor(...)) keys — byte-deterministic (ABRF-02 encoding edge). */
  anchorKeys: string[]
  /** Present for exactly the failed members — a pass contributes no window row (D-07). */
  failure?: RunOutcomeFailureKey
}

export interface RunOutcomesProjection {
  product: string
  scope: ScopeKey
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

/**
 * What the fold needs before it may evaluate the quarantine detection ladder (390 D-08).
 *
 * Grouped and OPTIONAL on purpose: a caller that cannot supply a clock and an audit location does
 * not get a silently empty evaluation, it gets `{kind: 'not-evaluated', reason: 'not-requested'}`
 * on the report. "Detection ran and found nothing" and "detection never ran" are different facts.
 */
export interface QuarantineDetectionOptions {
  /**
   * The ISO-8601 instant the evaluation is anchored to — the drain's own wall clock, read ONCE by
   * the caller. The fold and the rule below it stay clock-free (390-01's purity-by-argument), which
   * is what lets both expiry and the ladder be pinned one step either side.
   */
  now: string
  /** Explicit audit location for the ledger's committed-egress checkpoint; never inferred. */
  auditBaseDir: string
  policy?: GuardrailPolicy
}

export interface FoldRunOutcomesOptions {
  /** Absolute agent-qa-knowledge root hosting the derived index SQLite. */
  knowledgeRoot: string
  handoff: CompletedRunHandoff
  extractAnchors: ExtractStepAnchors
  /**
   * The run's own directory (`.agent-qa/runs/<slug(runId)>/`). When supplied, the fold loads
   * `analysis.json` from it so the counters read RESOLVED verdicts (D-09). Absent — a caller that
   * has no run dir — folds the deterministic floor, byte-identically to pre-390.
   */
  runDir?: string
  /** Present when the caller wants the D-08 detection step; absent skips it explicitly. */
  quarantine?: QuarantineDetectionOptions
}

/**
 * What the fold's detection step did, as DATA (390 Pitfall 4).
 *
 * Every arm is a fact the caller can print. In particular an `'egress-blocked'` append is a value,
 * not an exception: a guardrail refusal that vanished inside a catch is exactly how an `entered`
 * event goes missing in silence, and a missing `entered` event is a test that keeps failing builds
 * with nobody told why it was supposed to stop.
 */
export type QuarantineFoldOutcome =
  | { kind: 'not-evaluated'; reason: 'already-applied' | 'not-requested' }
  /** The committed ledger could not be read at all — detection refuses rather than guessing. */
  | { kind: 'ledger-unreadable'; reason: string }
  | {
      kind: 'evaluated'
      append: QuarantineAppendOutcome
      events: readonly QuarantineLedgerEvent[]
      flagged: readonly QuarantineDetectionSighting[]
      escalatedNotQuarantined: readonly QuarantineDetectionSighting[]
      refusedLines: readonly RefusedQuarantineLine[]
    }

export type FoldRunOutcomesReport = ApplyRunOutcomesResult & {
  quarantine: QuarantineFoldOutcome
}

interface OutcomeEntry {
  buildOrdinal: number
  passed: boolean
}

/**
 * Derive the projection partition from the same scope-key law as committed records.
 * Product bytes are path-safe to match serving's productSlug bind; the raw scope pair
 * stays alongside them for the shared scope-ladder predicate.
 */
export function projectionPartition(scope: ScopeKey): {
  product: string
  scopeTier: ScopeKey['tier']
  scopeKey: string
} {
  return {
    product: slugBranch(scope.key),
    scopeTier: scope.tier,
    scopeKey: scope.key,
  }
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

/**
 * The RESOLVED class per member test, computed ONCE per fold (390 D-09, mirroring the canary
 * fold's `resolveAttributionClasses` member-for-member — same class of fold, same input treatment).
 *
 * Two layers, in overwrite order:
 *
 *  1. Members OUTSIDE the accessor's domain first — a clean pass keeps its persisted class, which
 *     is how the runner's one pass-mintable `flake` (classifyRootCause's retry rule) still counts.
 *  2. THE one supersedable-verdict read, `resolveRunVerdicts` (D-10): artifact verdicts when the
 *     artifact is present, the deterministic floor when it is absent. It OVERWRITES layer 1
 *     wherever it governs, which is exactly how an unknown→flake upgrade moves the flake counter
 *     instead of the projection contradicting the resolved verdict.
 *
 * ACCEPTED SHAPE (the 389-06 precedent): a run whose artifact is written AFTER its fold never
 * refolds — the `run_outcome_applied_runs` marker is final — so an upgraded class reaches the
 * counters and the fingerprint windows only through LATER runs. The rebuild path re-reads every
 * artifact from disk, which is where a late upgrade eventually lands.
 */
function resolveProjectionClasses(
  handoff: CompletedRunHandoff,
  artifact: RunAnalysisArtifact | undefined,
): ReadonlyMap<number, Verdict['class']> {
  const members = handoff.tests ?? []
  const classes = new Map<number, Verdict['class']>()
  for (const member of members) {
    if (member.rootCause !== undefined) classes.set(member.testIndex, member.rootCause.class)
  }
  // The accessor traverses `tests` on the floor path; the rebuild's WR-03 wall admits a handoff
  // whose `tests` key is absent, so it is normalized to the same empty array used above.
  for (const verdict of resolveRunVerdicts(artifact, { ...handoff, tests: members })) {
    classes.set(verdict.perTest, verdict.class)
  }
  return classes
}

function testDelta(
  test: PerTestOutcome,
  extractAnchors: ExtractStepAnchors,
  resolvedClasses: ReadonlyMap<number, Verdict['class']>,
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

  const resolvedClass = resolvedClasses.get(test.testIndex)
  return {
    filePath: test.filePath,
    testName: test.testName,
    passed,
    heals: steps.filter((step) => step.selfHeal !== undefined).length,
    flake: resolvedClass === 'flake',
    anchorKeys: [...anchorKeys].sort(),
    ...(passed ? {} : { failure: failureKey({ ...test, steps }, resolvedClass) }),
  }
}

/**
 * The window key for one failed member (390 D-07).
 *
 * Every input rule is IMPORTED, never respelled here: which step the failure is about
 * (`failingStepOf`), which recorded bytes describe it (`errorTextOf`), which anchors it touched
 * (`exercisedAnchors`), and how those compose into the frozen key (`failureFingerprint`). The
 * anchor walk is schema's own — deliberately NOT the injected `extractAnchors` seam, which exists
 * so callers can vary the projection's anchor ROWS; keying the window through a variable seam would
 * let the window and the cluster presentation drift apart on a test host.
 *
 * A failed member always has a resolved class (`resolveRunVerdicts` mints `unknown` for a failure
 * carrying no verdict), so the fallback below is a total-function guard, not an expected path.
 */
function failureKey(
  test: PerTestOutcome,
  resolvedClass: VerdictClass | undefined,
): RunOutcomeFailureKey {
  const step = failingStepOf(test)
  const anchors = step === undefined ? [] : exercisedAnchors(step)
  const verdictClass = resolvedClass ?? 'unknown'
  return {
    fingerprint: failureFingerprint(
      { anchors, errorText: errorTextOf(step, test) },
      verdictClass,
    ),
    verdictClass,
  }
}

/** Pure fold: identical (handoff, artifact) bytes yield identical row deltas. */
export function projectRunOutcomes(
  handoff: CompletedRunHandoff,
  opts: ProjectRunOutcomesOptions,
): RunOutcomesProjection {
  const partition = projectionPartition(handoff.scope)
  const excluded = handoff.excludedFromOutcomes === true
  const resolvedClasses = resolveProjectionClasses(handoff, opts.artifact)
  const tests = excluded
    ? []
    : (handoff.tests ?? []).flatMap((test) => {
        const delta = testDelta(test, opts.extractAnchors, resolvedClasses)
        return delta === undefined ? [] : [delta]
      })
  return {
    product: partition.product,
    scope: { tier: partition.scopeTier, key: partition.scopeKey },
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

function runAlreadyApplied(db: DatabaseSync, product: string, runId: string): boolean {
  return db
    .prepare(`
      SELECT 1 AS present
      FROM run_outcome_applied_runs
      WHERE product = ? AND run_id = ?
    `)
    .get(product, runId) !== undefined
}

/**
 * Writer against the one index connection. Idempotent per product/runId: the applied-runs
 * marker commits in the same transaction as the counter rows, so a crash-rerun tail that
 * refolds an already-applied partition (receipt withheld mid-tail) changes nothing.
 */
export function applyRunOutcomes(
  db: DatabaseSync,
  projection: RunOutcomesProjection,
): ApplyRunOutcomesResult {
  ensureRunOutcomeTables(db)
  if (runAlreadyApplied(db, projection.product, projection.runId)) {
    return { kind: 'already-applied', tests: 0 }
  }

  const selectRow = db.prepare(`
    SELECT passes, failures, heals, flake_count, last_outcomes_json, last_build_ordinal
    FROM run_test_outcomes
    WHERE product = ? AND file_path = ? AND test_name = ?
  `)
  const upsertRow = db.prepare(`
    INSERT INTO run_test_outcomes (
      product, scope_tier, scope_key, file_path, test_name, passes, failures, heals,
      flake_count, last_outcomes_json, last_build_ordinal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (product, file_path, test_name) DO UPDATE SET
      scope_tier = excluded.scope_tier,
      scope_key = excluded.scope_key,
      passes = excluded.passes,
      failures = excluded.failures,
      heals = excluded.heals,
      flake_count = excluded.flake_count,
      last_outcomes_json = excluded.last_outcomes_json,
      last_build_ordinal = excluded.last_build_ordinal
  `)
  const insertAnchor = db.prepare(`
    INSERT OR IGNORE INTO run_test_anchors (
      product, scope_tier, scope_key, file_path, test_name, anchor_normalized_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)
  // 390 D-07: window rows commit in the SAME transaction as the counters and behind the SAME
  // applied-runs marker, so a refold can neither double-count a recurrence nor leave counters and
  // windows describing different histories. OR IGNORE makes the uniqueness constraint the second
  // line of defence rather than an error path.
  const insertWindow = db.prepare(`
    INSERT OR IGNORE INTO run_fingerprint_windows (
      product, file_path, test_name, fingerprint, verdict_class, build_ordinal, run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  db.exec('BEGIN IMMEDIATE')
  try {
    for (const test of projection.tests) {
      const existing = selectRow.get(projection.product, test.filePath, test.testName) as
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
        projection.product,
        projection.scope.tier,
        projection.scope.key,
        test.filePath,
        test.testName,
        passes,
        failures,
        heals,
        flakeCount,
        mergeOutcomeEntries(existing?.last_outcomes_json, {
          buildOrdinal: projection.buildOrdinal,
          passed: test.passed,
        }),
        lastBuildOrdinal,
      )
      for (const anchorKey of test.anchorKeys) {
        insertAnchor.run(
          projection.product,
          projection.scope.tier,
          projection.scope.key,
          test.filePath,
          test.testName,
          anchorKey,
        )
      }
      if (test.failure !== undefined) {
        insertWindow.run(
          projection.product,
          test.filePath,
          test.testName,
          test.failure.fingerprint,
          test.failure.verdictClass,
          projection.buildOrdinal,
          projection.runId,
        )
      }
    }
    db.prepare('INSERT INTO run_outcome_applied_runs (product, run_id) VALUES (?, ?)')
      .run(projection.product, projection.runId)
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

/**
 * One run's persisted analysis artifact, loaded from that run's OWN dir (390 D-09). THE shared
 * loader: the incremental fold and the full rebuild both call it, which is what keeps L12 parity
 * true rather than asserted.
 *
 * The fs glue is local; every rule that matters belongs to schema. An absent file is `undefined` —
 * the deterministic floor. A newer schemaVersion is the guard's typed hard failure, never swallowed
 * into a silent floor. A PRESENT file recording ANOTHER run's id is refused by identity
 * (`admitAnalysisArtifactForRun`, G-389-3A) and folds to the floor: counters and windows never key
 * off another run's verdicts, the 388 cross-instance class.
 */
function loadRunArtifact(runDir: string, runId: string): RunAnalysisArtifact | undefined {
  let bytes: string
  try {
    bytes = readFileSync(join(runDir, ANALYSIS_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const admission = admitAnalysisArtifactForRun(
    guardRunAnalysisArtifact(JSON.parse(bytes)),
    runId,
  )
  return admission.kind === 'admitted' ? admission.artifact : undefined
}

function loadRebuildHandoff(file: string): CompletedRunHandoff | undefined {
  try {
    const guarded = guardCompletedRunHandoff(JSON.parse(readFileSync(file, 'utf8')))

    // WR-03 / L12 fail-closed boundary: EVERY structural access on this untrusted
    // persisted document stays inside this try. A malformed file is a counted skip,
    // never an exception that aborts the disposable derived-state rebuild.
    const tests = (guarded as { tests?: unknown }).tests
    if (tests !== undefined && !Array.isArray(tests)) return undefined

    // RESEARCH A2 / v2 no-back-compat: pre-fix v3 handoffs lacking the REQUIRED
    // per-test filePath or human testName still load. The guard-level shape hook and
    // this consumer wall are independent: reject unsafe members and steps here before
    // projection traversal can observe them.
    const structurallyCurrent = (tests ?? []).every((test) => {
      if (test === null || typeof test !== 'object' || Array.isArray(test)) return false

      const member = test as {
        filePath?: unknown
        testName?: unknown
        steps?: unknown
      }
      return (
        typeof member.filePath === 'string'
        && member.filePath.length > 0
        && typeof member.testName === 'string'
        && member.testName.length > 0
        && (member.steps === undefined
          || (Array.isArray(member.steps)
            && member.steps.every(
              (step) => step !== null && typeof step === 'object' && !Array.isArray(step),
            )))
      )
    })
    return structurallyCurrent ? guarded : undefined
  } catch {
    return undefined
  }
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
    DELETE FROM run_fingerprint_windows;
  `)

  const report: RebuildRunOutcomesReport = { folded: 0, skipped: 0 }
  if (!existsSync(runsRoot)) return report

  const runDirs = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(runsRoot, entry.name))
    .filter((dir) => existsSync(join(dir, RUN_HANDOFF_FILE)))
    .sort()

  for (const runDir of runDirs) {
    const handoff = loadRebuildHandoff(join(runDir, RUN_HANDOFF_FILE))
    if (handoff === undefined) {
      report.skipped += 1
      continue
    }
    // D-09 / L12: `analysis.json` is read from beside `handoff.json` through the SAME loader the
    // incremental fold uses, so the rebuild reproduces resolved-verdict tables byte-identically.
    const artifact = loadRunArtifact(runDir, String(handoff.runId))
    applyRunOutcomes(db, projectRunOutcomes(handoff, {
      extractAnchors: opts.extractAnchors,
      ...(artifact === undefined ? {} : { artifact }),
    }))
    report.folded += 1
  }
  return report
}

/**
 * The D-08 detection step: evaluate the quarantine ladder over the JUST-COMMITTED window and
 * append whatever lifecycle events it authors.
 *
 * ORDERING, stated rather than pretended (Open Q1). The projection lives in SQLite and the ledger
 * is a committed JSONL file; there is no transaction that spans both, so this cannot be atomic and
 * the code does not claim to be. The append orders AFTER the projection commit, which means a
 * crash — or an egress refusal — between the two leaves the counters applied and no event written.
 * That state SELF-HEALS: the window is still crossed, so the next applied fold re-evaluates and
 * appends then. The opposite order (append first) would have the strictly worse failure: a
 * quarantine entry for a run whose counters never landed.
 *
 * The reads below run on the same connection immediately after `applyRunOutcomes` returned
 * `'applied'`, so the recurrence they see includes this run.
 */
function evaluateQuarantineForFold(
  db: DatabaseSync,
  projection: RunOutcomesProjection,
  knowledgeRoot: string,
  opts: QuarantineDetectionOptions,
): QuarantineFoldOutcome {
  let read
  try {
    read = readQuarantineLedger(knowledgeRoot)
  } catch (error) {
    // Refuse, never heal. A ledger this build cannot parse is committed truth it must not guess
    // at — evaluating against "no entries" would re-quarantine released tests and re-enter open
    // ones. The counters already applied; only detection stands down, and it says so.
    if (error instanceof QuarantineLedgerVersionError) {
      return { kind: 'ledger-unreadable', reason: error.message }
    }
    throw error
  }
  const entries = foldQuarantineLedgerState(read.events, opts.now)

  const failures: QuarantineDetectionFailure[] = projection.tests.flatMap((test) =>
    test.failure === undefined ? [] : [{
      product: projection.product,
      filePath: test.filePath,
      testName: test.testName,
      fingerprint: test.failure.fingerprint,
      verdictClass: test.failure.verdictClass,
      ...fingerprintRecurrence(
        db,
        { product: projection.product, fingerprint: test.failure.fingerprint },
        projection.buildOrdinal,
      ),
    }])

  // Exit candidates are every OPEN entry in this product — not only the tests that ran here. A
  // test whose window filled with passes several runs ago must still be released.
  const testWindows: QuarantineDetectionTestWindow[] = entries.flatMap((entry) => {
    if (entry.state !== 'quarantined' || entry.product !== projection.product) return []
    const history = readTestOutcomeHistory(db, {
      product: entry.product,
      filePath: entry.filePath,
      testName: entry.testName,
    })
    if (history === undefined) return []
    return [{
      product: entry.product,
      filePath: entry.filePath,
      testName: entry.testName,
      ordinals: history.lastOutcomes,
    }]
  })

  const detection = evaluateQuarantineDetection({
    failures,
    testWindows,
    entries,
    now: opts.now,
  })

  const append = appendQuarantineEvents(knowledgeRoot, detection.events, {
    auditBaseDir: opts.auditBaseDir,
    ...(opts.policy === undefined ? {} : { policy: opts.policy }),
  })

  return {
    kind: 'evaluated',
    append,
    events: detection.events,
    flagged: detection.flagged,
    escalatedNotQuarantined: detection.escalatedNotQuarantined,
    refusedLines: read.refusedLines,
  }
}

/**
 * Incremental fold wrapper for the post-verdict tail: opens the one index writer, applies
 * the projection, and closes. The tail invokes it inside the SAME crash boundary and the
 * SAME (extended) receipt as candidate/canary emit — never a second marker file.
 *
 * Detection hangs off the `'applied'` arm ONLY (D-08). `applyRunOutcomes` answers
 * `'already-applied'` from an early return that fires before its transaction even opens, so
 * "a refold never double-quarantines" is true by POSITION — there is no second idempotency
 * condition here to keep in sync with the marker.
 */
export function foldRunOutcomes(opts: FoldRunOutcomesOptions): FoldRunOutcomesReport {
  const artifact = opts.runDir === undefined
    ? undefined
    : loadRunArtifact(opts.runDir, String(opts.handoff.runId))
  const projection = projectRunOutcomes(opts.handoff, {
    extractAnchors: opts.extractAnchors,
    ...(artifact === undefined ? {} : { artifact }),
  })
  const handle = openIndexWriter(opts.knowledgeRoot)
  try {
    const applied = applyRunOutcomes(handle.db, projection)
    if (applied.kind !== 'applied') {
      return { ...applied, quarantine: { kind: 'not-evaluated', reason: 'already-applied' } }
    }
    if (opts.quarantine === undefined) {
      return { ...applied, quarantine: { kind: 'not-evaluated', reason: 'not-requested' } }
    }
    return {
      ...applied,
      quarantine: evaluateQuarantineForFold(
        handle.db,
        projection,
        opts.knowledgeRoot,
        opts.quarantine,
      ),
    }
  } finally {
    handle.close()
  }
}
