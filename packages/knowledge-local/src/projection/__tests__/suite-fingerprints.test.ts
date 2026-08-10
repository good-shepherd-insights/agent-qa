import { DatabaseSync } from 'node:sqlite'

import {
  actionAnchorElement,
  type Action,
  type CompletedRunHandoff,
  type ElementInfo,
  type PerTestOutcome,
  type ScopeKey,
  type StepEvidence,
  type SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { ensureRunOutcomeTables } from '../../index-open.js'
import {
  applyRunOutcomes,
  projectionPartition,
  projectRunOutcomes,
} from '../run-outcomes.js'
import {
  foldSuiteFingerprints,
  SUITE_FINGERPRINTS_TABLE,
} from '../suite-fingerprints.js'

const SHOP_SCOPE: ScopeKey = { tier: 'product', key: 'shop-web' }
const SHOP_PRODUCT = projectionPartition(SHOP_SCOPE).product

// The anchor walk the fold reuses resolves an element from `stateBefore.elements` by the ref the
// planned action carried, so a fixture sub-action is (action type, ref, the element that ref
// names, and the URL context around it). Everything below is built through these helpers rather
// than as row literals: the expected ELEMENT bytes are computed by schema's own
// `actionAnchorElement` in each assertion, so a fixture cannot pin a string this recipe would
// never mint (the produced-not-literal law).
interface SubActionFixture {
  type: string
  ref?: string
  role?: string
  name?: string
  url?: string
  urlAfter?: string
  success?: boolean
}

interface TestFixture {
  filePath: string
  testName: string
  outcome?: PerTestOutcome['outcome']
  steps?: SubActionFixture[][]
}

function elementInfo(ref: string, role: string, name: string): ElementInfo {
  return {
    ref,
    role,
    name,
    nameNormalized: name,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  } as unknown as ElementInfo
}

function screenState(url: string | undefined, elements: ElementInfo[], timestamp: number): unknown {
  return {
    platform: 'web',
    tree: '',
    elements,
    refMap: {},
    timestamp,
    metadata: {},
    ...(url === undefined ? {} : { url }),
  }
}

function subActionEvidence(fixture: SubActionFixture): SubActionEvidence {
  const elements = fixture.ref === undefined
    ? []
    : [elementInfo(fixture.ref, fixture.role ?? 'button', fixture.name ?? 'checkout')]
  return {
    plan: `plan ${fixture.type}`,
    plannedAction: {
      type: fixture.type,
      ...(fixture.ref === undefined ? {} : { ref: fixture.ref }),
    } as unknown as Action,
    stateBefore: screenState(fixture.url, elements, 0),
    ...(fixture.urlAfter === undefined
      ? {}
      : { stateAfter: screenState(fixture.urlAfter, [], 1) }),
    result: { success: fixture.success ?? true },
  } as unknown as SubActionEvidence
}

function stepEvidence(stepIndex: number, subActions: SubActionFixture[]): StepEvidence {
  return {
    stepIndex,
    stepText: `step ${stepIndex}`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: SHOP_SCOPE,
      asOfBuild: 1,
      budget: 1,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'fixture-brief-digest',
    },
    subActions: subActions.map(subActionEvidence),
    verifierVerdict: { pass: true, reasoning: 'fixture verdict' },
  } as unknown as StepEvidence
}

function perTest(fixture: TestFixture, testIndex: number): PerTestOutcome {
  return {
    testId: `${fixture.filePath}::${fixture.testName}`,
    testName: fixture.testName,
    filePath: fixture.filePath,
    testIndex,
    outcome: fixture.outcome ?? 'passed',
    steps: (fixture.steps ?? []).map((subActions, index) => stepEvidence(index, subActions)),
  } as unknown as PerTestOutcome
}

function handoffFixture(input: {
  runId: string
  buildOrdinal: number
  tests: TestFixture[]
  excludedFromOutcomes?: true
}): CompletedRunHandoff {
  return {
    schemaVersion: 3,
    runId: input.runId,
    buildOrdinal: input.buildOrdinal,
    scope: SHOP_SCOPE,
    executionContext: 'ci',
    aggregateVerdict: 'passed',
    configDigests: {
      suiteConfigDigest: 'fixture-suite-config-digest',
      testConfigDigest: 'fixture-test-config-digest',
    },
    startedAt: input.buildOrdinal * 1_000,
    endedAt: input.buildOrdinal * 1_000 + 1,
    tests: input.tests.map((fixture, testIndex) => perTest(fixture, testIndex)),
    ...(input.excludedFromOutcomes === true ? { excludedFromOutcomes: true } : {}),
  } as unknown as CompletedRunHandoff
}

const extractAnchors = (): [] => []

function openDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  ensureRunOutcomeTables(db)
  return db
}

interface FingerprintRow {
  product: string
  file_path: string
  test_name: string
  seq: number
  element: string
  run_id: string
  build_ordinal: number
}

function fingerprintRows(db: DatabaseSync): FingerprintRow[] {
  return db.prepare(`
    SELECT * FROM ${SUITE_FINGERPRINTS_TABLE}
    ORDER BY product, file_path, test_name, seq
  `).all() as unknown as FingerprintRow[]
}

function elementsFor(db: DatabaseSync, filePath: string, testName: string): string[] {
  return fingerprintRows(db)
    .filter((row) => row.file_path === filePath && row.test_name === testName)
    .map((row) => row.element)
}

/** THE production path: one fold pass, both projections, one applied-runs marker. */
function foldThroughRunOutcomes(db: DatabaseSync, handoff: CompletedRunHandoff): void {
  applyRunOutcomes(db, projectRunOutcomes(handoff, { extractAnchors }))
}

/** The standalone door the gate evaluator's own harness uses. */
function foldDirectly(
  db: DatabaseSync,
  handoff: CompletedRunHandoff,
  excluded = false,
): void {
  foldSuiteFingerprints(db, handoff, { product: SHOP_PRODUCT, excluded })
}

const CHECKOUT_TEST: TestFixture = {
  filePath: 'suite/checkout.test.ts',
  testName: 'checkout happy path',
  steps: [
    [
      { type: 'click', ref: 'e1', role: 'button', name: 'checkout', url: '/cart' },
      { type: 'assertValue', url: '/cart' },
    ],
  ],
}

const LOGIN_TEST: TestFixture = {
  filePath: 'suite/login.test.ts',
  testName: 'login with a valid password',
  steps: [[{ type: 'fill', ref: 'e9', role: 'textbox', name: 'password', url: '/login' }]],
}

const CHECKOUT_CLICK_ELEMENT = actionAnchorElement({
  kind: 'action',
  type: 'click',
  anchor: { t: 'el', role: 'button', name: 'checkout', ordinal: 0 },
  route: '/cart',
})

const CHECKOUT_ASSERT_ELEMENT = actionAnchorElement({
  kind: 'assert',
  type: 'assertValue',
  anchor: { t: 'page', route: '/cart' },
})

const LOGIN_FILL_ELEMENT = actionAnchorElement({
  kind: 'action',
  type: 'fill',
  anchor: { t: 'el', role: 'textbox', name: 'password', ordinal: 0 },
  route: '/login',
})

describe('the suite-fingerprint table (393 D-15, gate 3s comparison substrate)', () => {
  it('writes one ordered row set per (filePath, testName) from sub-action evidence', () => {
    const db = openDb()
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-a',
      buildOrdinal: 4,
      tests: [CHECKOUT_TEST, LOGIN_TEST],
    }))

    const rows = fingerprintRows(db)
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.product === SHOP_PRODUCT)).toBe(true)
    expect(rows.every((row) => row.run_id === 'run-fp-a' && row.build_ordinal === 4)).toBe(true)

    // ORDER is part of the recipe (D-13): the sequence is what a later §4.1 enrichment builds on.
    expect(elementsFor(db, 'suite/checkout.test.ts', 'checkout happy path')).toEqual([
      CHECKOUT_CLICK_ELEMENT,
      CHECKOUT_ASSERT_ELEMENT,
    ])
    expect(
      rows
        .filter((row) => row.file_path === 'suite/checkout.test.ts')
        .map((row) => row.seq),
    ).toEqual([0, 1])

    // Keyed by STABLE identity, never testId: the second test is a separate row set.
    expect(elementsFor(db, 'suite/login.test.ts', 'login with a valid password')).toEqual([
      LOGIN_FILL_ELEMENT,
    ])
  })

  it(
    'writes ZERO fingerprint rows for a handoff flagged excludedFromOutcomes — '
    + 'a gate-run never seeds the union it is later compared against (WTST-06, Pitfall 8)',
    () => {
      const db = openDb()
      foldThroughRunOutcomes(db, handoffFixture({
        runId: 'run-fp-gate',
        buildOrdinal: 4,
        tests: [CHECKOUT_TEST, LOGIN_TEST],
        excludedFromOutcomes: true,
      }))

      expect(fingerprintRows(db)).toEqual([])
      // The same run is excluded from the outcome counters, which is the point: ONE exclusion
      // read gates BOTH projections, so the two tables can never disagree about a gate-run.
      expect(db.prepare('SELECT * FROM run_test_outcomes').all()).toEqual([])
    },
  )

  it('excludes a flagged handoff through the standalone fold door as well', () => {
    const db = openDb()
    foldDirectly(db, handoffFixture({
      runId: 'run-fp-gate-direct',
      buildOrdinal: 4,
      tests: [CHECKOUT_TEST],
    }), true)

    expect(fingerprintRows(db)).toEqual([])
  })

  it('replaces one identity\'s rows from newer evidence and leaves other identities untouched', () => {
    const db = openDb()
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-old',
      buildOrdinal: 4,
      tests: [CHECKOUT_TEST, LOGIN_TEST],
    }))

    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-new',
      buildOrdinal: 9,
      tests: [{
        ...CHECKOUT_TEST,
        steps: [[{ type: 'click', ref: 'e2', role: 'link', name: 'pay now', url: '/pay' }]],
      }],
    }))

    expect(elementsFor(db, 'suite/checkout.test.ts', 'checkout happy path')).toEqual([
      actionAnchorElement({
        kind: 'action',
        type: 'click',
        anchor: { t: 'el', role: 'link', name: 'pay now', ordinal: 0 },
        route: '/pay',
      }),
    ])
    expect(elementsFor(db, 'suite/login.test.ts', 'login with a valid password')).toEqual([
      LOGIN_FILL_ELEMENT,
    ])
  })

  it('keeps the newest evidence when an OLDER run folds afterwards (fold order cannot decide)', () => {
    const db = openDb()
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-new',
      buildOrdinal: 9,
      tests: [CHECKOUT_TEST],
    }))
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-old',
      buildOrdinal: 4,
      tests: [{
        ...CHECKOUT_TEST,
        steps: [[{ type: 'click', ref: 'e2', role: 'link', name: 'pay now', url: '/pay' }]],
      }],
    }))

    const rows = fingerprintRows(db)
    expect(rows.every((row) => row.run_id === 'run-fp-new')).toBe(true)
    expect(elementsFor(db, 'suite/checkout.test.ts', 'checkout happy path')).toEqual([
      CHECKOUT_CLICK_ELEMENT,
      CHECKOUT_ASSERT_ELEMENT,
    ])
  })

  it('contributes no rows for a test with no usable sub-action evidence (D-16s text lane)', () => {
    const db = openDb()
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-bare',
      buildOrdinal: 4,
      tests: [
        { filePath: 'suite/bare.test.ts', testName: 'no steps at all' },
        { filePath: 'suite/bare.test.ts', testName: 'a step with no sub-actions', steps: [[]] },
        {
          filePath: 'suite/bare.test.ts',
          testName: 'a sub-action with neither element nor route',
          steps: [[{ type: 'delay' }]],
        },
      ],
    }))

    expect(fingerprintRows(db)).toEqual([])
  })

  it('contributes no element for a sub-action whose result did not succeed', () => {
    const db = openDb()
    foldThroughRunOutcomes(db, handoffFixture({
      runId: 'run-fp-failed',
      buildOrdinal: 4,
      tests: [{
        filePath: 'suite/checkout.test.ts',
        testName: 'checkout happy path',
        steps: [[
          { type: 'click', ref: 'e1', role: 'button', name: 'checkout', url: '/cart' },
          { type: 'click', ref: 'e2', role: 'button', name: 'confirm', url: '/cart', success: false },
        ]],
      }],
    }))

    expect(elementsFor(db, 'suite/checkout.test.ts', 'checkout happy path')).toEqual([
      CHECKOUT_CLICK_ELEMENT,
    ])
  })

  it('re-applying the same run leaves the rows byte-identical (convergent, not marker-gated)', () => {
    const db = openDb()
    const handoff = handoffFixture({
      runId: 'run-fp-a',
      buildOrdinal: 4,
      tests: [CHECKOUT_TEST, LOGIN_TEST],
    })
    foldDirectly(db, handoff)
    const first = fingerprintRows(db)
    foldDirectly(db, handoff)

    expect(fingerprintRows(db)).toEqual(first)
  })
})
