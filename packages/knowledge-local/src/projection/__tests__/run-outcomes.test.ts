import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  canonicalJson,
  normalizeAnchor,
  type Anchor,
  type CompletedRunHandoff,
  type PerTestOutcome,
  type StepEvidence,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { ensureRunOutcomeTables } from '../../index-open.js'
import {
  applyRunOutcomes,
  projectRunOutcomes,
  rebuildRunOutcomes,
} from '../run-outcomes.js'

interface StepFixture {
  stepIndex: number
  anchors?: Anchor[]
  selfHealed?: boolean
}

interface TestFixture {
  filePath: string
  testId: string
  outcome: PerTestOutcome['outcome']
  rootCauseClass?: string
  steps?: StepFixture[]
}

function stepEvidence(fixture: StepFixture): StepEvidence {
  return {
    stepIndex: fixture.stepIndex,
    anchors: fixture.anchors ?? [],
    ...(fixture.selfHealed === true
      ? { selfHeal: { failedDecision: {}, recoveringDecision: {} } }
      : {}),
  } as unknown as StepEvidence
}

function perTest(fixture: TestFixture): PerTestOutcome {
  return {
    testId: fixture.testId,
    filePath: fixture.filePath,
    testIndex: 0,
    outcome: fixture.outcome,
    steps: (fixture.steps ?? []).map(stepEvidence),
    ...(fixture.rootCauseClass === undefined
      ? {}
      : { rootCause: { class: fixture.rootCauseClass } }),
  } as unknown as PerTestOutcome
}

function handoffFixture(input: {
  runId: string
  buildOrdinal: number
  tests: TestFixture[]
  excludedFromOutcomes?: boolean
}): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: input.runId,
    buildOrdinal: input.buildOrdinal,
    executionContext: 'ci',
    tests: input.tests.map(perTest),
    ...(input.excludedFromOutcomes === true ? { excludedFromOutcomes: true } : {}),
  } as unknown as CompletedRunHandoff
}

const extractAnchors = (step: StepEvidence): Anchor[] =>
  (step as unknown as { anchors?: Anchor[] }).anchors ?? []

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  ensureRunOutcomeTables(db)
  return db
}

interface TableDump {
  outcomes: unknown[]
  anchors: unknown[]
  appliedRuns: unknown[]
}

function dumpTables(db: DatabaseSync): string {
  const dump: TableDump = {
    outcomes: db.prepare(
      'SELECT * FROM run_test_outcomes ORDER BY file_path, test_name',
    ).all(),
    anchors: db.prepare(
      'SELECT * FROM run_test_anchors ORDER BY file_path, test_name, anchor_normalized_json',
    ).all(),
    appliedRuns: db.prepare(
      'SELECT run_id FROM run_outcome_applied_runs ORDER BY run_id',
    ).all(),
  }
  return JSON.stringify(dump)
}

const checkoutAnchor: Anchor = { t: 'el', role: 'button', name: 'checkout', ordinal: 0 }
const cartPageAnchor: Anchor = { t: 'page', route: '/cart' }
const payAnchor: Anchor = { t: 'el', role: 'button', name: 'pay now', ordinal: 1 }

function threeOutcomeHandoff(): CompletedRunHandoff {
  return handoffFixture({
    runId: 'run-a',
    buildOrdinal: 7,
    tests: [
      {
        filePath: 'suite/checkout.test.ts',
        testId: 'checkout happy path',
        outcome: 'passed',
        steps: [
          { stepIndex: 0, anchors: [checkoutAnchor, cartPageAnchor], selfHealed: true },
        ],
      },
      {
        filePath: 'suite/checkout.test.ts',
        testId: 'checkout declined card',
        outcome: 'failed',
        rootCauseClass: 'app_bug',
        steps: [{ stepIndex: 0, anchors: [payAnchor] }],
      },
      {
        filePath: 'suite/login.test.ts',
        testId: 'login after retry',
        outcome: 'passed',
        rootCauseClass: 'flake',
        steps: [{ stepIndex: 0 }],
      },
    ],
  })
}

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('run-outcome projection fold (ABRF-02, D-14)', () => {
  it('folds pass/failure/heal/flake counters, last-N ordinals, and normalized anchor rows', () => {
    const db = openDb()
    const projection = projectRunOutcomes(threeOutcomeHandoff(), {
      excluded: false,
      extractAnchors,
    })

    const result = applyRunOutcomes(db, projection)
    expect(result).toEqual({ kind: 'applied', tests: 3 })

    const rows = db.prepare(
      'SELECT * FROM run_test_outcomes ORDER BY file_path, test_name',
    ).all() as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)

    const happy = rows.find((row) => row.test_name === 'checkout happy path')
    expect(happy).toMatchObject({
      file_path: 'suite/checkout.test.ts',
      passes: 1,
      failures: 0,
      heals: 1,
      flake_count: 0,
      quarantined: 0,
      last_build_ordinal: 7,
    })
    expect(happy?.last_outcomes_json).toBe(
      canonicalJson([{ buildOrdinal: 7, passed: true }]),
    )

    const declined = rows.find((row) => row.test_name === 'checkout declined card')
    expect(declined).toMatchObject({
      file_path: 'suite/checkout.test.ts',
      passes: 0,
      failures: 1,
      heals: 0,
      flake_count: 0,
    })
    expect(declined?.last_outcomes_json).toBe(
      canonicalJson([{ buildOrdinal: 7, passed: false }]),
    )

    const retried = rows.find((row) => row.test_name === 'login after retry')
    expect(retried).toMatchObject({
      file_path: 'suite/login.test.ts',
      passes: 1,
      failures: 0,
      flake_count: 1,
    })

    const anchorRows = db.prepare(
      'SELECT * FROM run_test_anchors ORDER BY file_path, test_name, anchor_normalized_json',
    ).all() as Array<Record<string, unknown>>
    expect(
      anchorRows
        .filter((row) => row.test_name === 'checkout happy path')
        .map((row) => row.anchor_normalized_json)
        .sort(),
    ).toEqual(
      [
        canonicalJson(normalizeAnchor(checkoutAnchor)),
        canonicalJson(normalizeAnchor(cartPageAnchor)),
      ].sort(),
    )
    expect(
      anchorRows
        .filter((row) => row.test_name === 'checkout declined card')
        .map((row) => row.anchor_normalized_json),
    ).toEqual([canonicalJson(normalizeAnchor(payAnchor))])
  })

  it('stores only identity, counters, and anchors — never test file content', () => {
    const db = openDb()
    const outcomeColumns = db.prepare('PRAGMA table_info(run_test_outcomes)').all()
      .map((row) => String((row as Record<string, unknown>).name))
      .sort()
    expect(outcomeColumns).toEqual([
      'failures',
      'file_path',
      'flake_count',
      'heals',
      'last_build_ordinal',
      'last_outcomes_json',
      'passes',
      'quarantined',
      'test_name',
    ])
    const anchorColumns = db.prepare('PRAGMA table_info(run_test_anchors)').all()
      .map((row) => String((row as Record<string, unknown>).name))
      .sort()
    expect(anchorColumns).toEqual(['anchor_normalized_json', 'file_path', 'test_name'])
  })

  it('is idempotent per runId: refolding an already-applied run changes nothing', () => {
    const db = openDb()
    const projection = projectRunOutcomes(threeOutcomeHandoff(), {
      excluded: false,
      extractAnchors,
    })

    expect(applyRunOutcomes(db, projection)).toEqual({ kind: 'applied', tests: 3 })
    const before = dumpTables(db)

    expect(applyRunOutcomes(db, projection)).toEqual({ kind: 'already-applied', tests: 0 })
    expect(dumpTables(db)).toBe(before)
  })

  it('contributes zero counter changes when the gate-run exclusion flag is set (Pitfall 7)', () => {
    const db = openDb()
    const projection = projectRunOutcomes(threeOutcomeHandoff(), {
      excluded: true,
      extractAnchors,
    })
    expect(projection.tests).toEqual([])

    applyRunOutcomes(db, projection)
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_test_outcomes').get()).toMatchObject({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_test_anchors').get()).toMatchObject({ n: 0 })
  })

  it('honors a handoff-level exclusion marker even when the caller passes excluded=false', () => {
    const excluded = handoffFixture({
      runId: 'run-gate',
      buildOrdinal: 9,
      excludedFromOutcomes: true,
      tests: [{
        filePath: 'suite/gate.test.ts',
        testId: 'internal gate replay',
        outcome: 'passed',
      }],
    })
    const projection = projectRunOutcomes(excluded, { excluded: false, extractAnchors })
    expect(projection.excluded).toBe(true)
    expect(projection.tests).toEqual([])
  })

  it('rebuild over the runs tree reproduces the incremental fold byte-identically (L12)', () => {
    const handoffs = [
      handoffFixture({
        runId: '001-first',
        buildOrdinal: 1,
        tests: [
          {
            filePath: 'suite/checkout.test.ts',
            testId: 'checkout happy path',
            outcome: 'passed',
            steps: [{ stepIndex: 0, anchors: [checkoutAnchor] }],
          },
        ],
      }),
      handoffFixture({
        runId: '002-second',
        buildOrdinal: 2,
        tests: [
          {
            filePath: 'suite/checkout.test.ts',
            testId: 'checkout happy path',
            outcome: 'failed',
            rootCauseClass: 'app_bug',
            steps: [{ stepIndex: 0, anchors: [checkoutAnchor, cartPageAnchor] }],
          },
        ],
      }),
      handoffFixture({
        runId: '003-third',
        buildOrdinal: 3,
        tests: [
          {
            filePath: 'suite/checkout.test.ts',
            testId: 'checkout happy path',
            outcome: 'passed',
            rootCauseClass: 'flake',
            steps: [{ stepIndex: 0, anchors: [checkoutAnchor] }],
          },
          {
            filePath: 'suite/login.test.ts',
            testId: 'login after retry',
            outcome: 'passed',
            steps: [{ stepIndex: 0, anchors: [payAnchor], selfHealed: true }],
          },
        ],
      }),
    ]

    const incremental = openDb()
    for (const handoff of handoffs) {
      applyRunOutcomes(
        incremental,
        projectRunOutcomes(handoff, { excluded: false, extractAnchors }),
      )
    }

    const runsRoot = tempDir('run-outcomes-rebuild-')
    for (const handoff of handoffs) {
      const dir = join(runsRoot, String(handoff.runId))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'handoff.json'), JSON.stringify(handoff))
    }

    const rebuilt = openDb()
    // Pre-seed stale rows to prove the rebuild clears before scanning.
    applyRunOutcomes(rebuilt, projectRunOutcomes(handoffFixture({
      runId: 'stale-run',
      buildOrdinal: 99,
      tests: [{ filePath: 'stale/file.test.ts', testId: 'stale', outcome: 'passed' }],
    }), { excluded: false, extractAnchors }))

    const report = rebuildRunOutcomes(rebuilt, runsRoot, { extractAnchors })
    expect(report).toEqual({ folded: 3, skipped: 0 })
    expect(dumpTables(rebuilt)).toBe(dumpTables(incremental))
  })

  it('rebuild over an empty or missing runs dir yields empty tables without error (ABRF-02 empty edge)', () => {
    const emptyRoot = tempDir('run-outcomes-empty-')
    const db = openDb()
    expect(rebuildRunOutcomes(db, emptyRoot, { extractAnchors })).toEqual({
      folded: 0,
      skipped: 0,
    })
    expect(rebuildRunOutcomes(db, join(emptyRoot, 'missing'), { extractAnchors })).toEqual({
      folded: 0,
      skipped: 0,
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_test_outcomes').get()).toMatchObject({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM run_test_anchors').get()).toMatchObject({ n: 0 })
  })

  it('skips old-shape handoffs lacking per-test filePath with a counted skip, never a throw (A2)', () => {
    const runsRoot = tempDir('run-outcomes-skip-')
    const good = handoffFixture({
      runId: '001-good',
      buildOrdinal: 4,
      tests: [{
        filePath: 'suite/checkout.test.ts',
        testId: 'checkout happy path',
        outcome: 'passed',
      }],
    })
    mkdirSync(join(runsRoot, '001-good'), { recursive: true })
    writeFileSync(join(runsRoot, '001-good', 'handoff.json'), JSON.stringify(good))

    const oldShape = {
      schemaVersion: 3,
      runId: '002-old',
      buildOrdinal: 2,
      executionContext: 'ci',
      // Pre-381 v3 handoff: per-test filePath absent — must be skipped structurally.
      tests: [{ testId: 'legacy test', testIndex: 0, outcome: 'passed', steps: [] }],
    }
    mkdirSync(join(runsRoot, '002-old'), { recursive: true })
    writeFileSync(join(runsRoot, '002-old', 'handoff.json'), JSON.stringify(oldShape))

    const db = openDb()
    const report = rebuildRunOutcomes(db, runsRoot, { extractAnchors })
    expect(report).toEqual({ folded: 1, skipped: 1 })

    const rows = db.prepare('SELECT test_name FROM run_test_outcomes').all()
    expect(rows).toEqual([{ test_name: 'checkout happy path' }])
  })

  it('marks a test quarantined once its flake count crosses the provisional threshold', () => {
    const db = openDb()
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      applyRunOutcomes(db, projectRunOutcomes(handoffFixture({
        runId: `run-flake-${ordinal}`,
        buildOrdinal: ordinal,
        tests: [{
          filePath: 'suite/flaky.test.ts',
          testId: 'flaky test',
          outcome: 'passed',
          rootCauseClass: 'flake',
        }],
      }), { excluded: false, extractAnchors }))
    }
    const row = db.prepare(
      'SELECT flake_count, quarantined FROM run_test_outcomes',
    ).get()
    expect(row).toMatchObject({ flake_count: 3, quarantined: 1 })
  })
})
