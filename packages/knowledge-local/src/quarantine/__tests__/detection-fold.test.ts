// Detection at its ONE correct site: inside the post-run fold, behind the applied-runs gate
// (Phase 390, D-08 / Open Q1 / Pitfall 3 / Pitfall 4).
//
// These drive the REAL fold — real sqlite, real projection, real committed ledger bytes — because
// the pure rule's table cannot see any of the three properties that matter here:
//
//  1. IDEMPOTENCY IS POSITIONAL. `applyRunOutcomes` answers `already-applied` from an early return
//     that fires BEFORE its transaction opens, so hanging detection off the `applied` arm makes
//     "a refold never double-quarantines" true by construction rather than by a re-checked
//     condition. The differential that reds only on the SECOND drain is the Pitfall 3 warning sign.
//  2. THE APPEND ORDERS AFTER THE COMMIT, and that is not atomic — deliberately. A prevented append
//     leaves the window crossed and the NEXT applied fold re-evaluates and appends then. Documented
//     and pinned as self-healing, never pretended atomic (Open Q1).
//  3. A REFUSED APPEND IS DATA. A blocked egress that silently loses an `entered` event is the
//     defect class Pitfall 4 names, so the refusal rides out on the fold report and the tail logs
//     it. There is no bare catch anywhere on this path.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  canonicalJson,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  CompletedRunHandoff,
  GuardrailPolicy,
  PerTestOutcome,
  QuarantineLedgerEvent,
  ScopeKey,
  StepEvidence,
  Verdict,
  VerdictClass,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import {
  classifyRootCause,
  createTimeoutAbortReason,
  deriveMemberOutcome,
} from '@vostride/agent-qa-runner'
import type { TestResult } from '@vostride/agent-qa-runner'

import { foldRunOutcomes } from '../../projection/run-outcomes.js'
import type { FoldRunOutcomesReport } from '../../projection/run-outcomes.js'
import {
  AUTO_QUARANTINE_CLASSES,
  QUARANTINE_CLASS_DISPOSITIONS,
  QUARANTINE_ESCALATE_THRESHOLD,
} from '../detection.js'
import {
  QUARANTINE_LEDGER_FILENAME,
  appendQuarantineEvents,
  foldQuarantineLedgerState,
  readQuarantineLedger,
} from '../ledger.js'

const SHOP_SCOPE: ScopeKey = { tier: 'product', key: 'shop-web' }
const PRODUCT = 'shop-web'
const FILE_PATH = 'suite/checkout.test.ts'
const TEST_NAME = 'checkout retries the payment sheet'
const ERROR_TEXT = 'the payment sheet never opened'
const NOW = '2026-08-05T12:00:00.000Z'
const EXPECTED_EXPIRY = '2026-09-04T12:00:00.000Z'

const payAnchor: Anchor = { t: 'el', role: 'button', name: 'pay now', ordinal: 1 }
const extractAnchors = (step: StepEvidence): Anchor[] =>
  (step as unknown as { anchors?: Anchor[] }).anchors ?? []

const tempDirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function failingStep(): StepEvidence {
  return {
    stepIndex: 0,
    stepText: 'pay now',
    cacheStatus: 'miss',
    servedBrief: {
      scope: SHOP_SCOPE,
      asOfBuild: 1,
      budget: 1,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'detection-fixture-digest',
    },
    subActions: [],
    verifierVerdict: { pass: false, reasoning: ERROR_TEXT },
    anchors: [payAnchor],
  } as unknown as StepEvidence
}

// ---- TWO VERDICT BUILDERS, FOR TWO PRODUCERS (390-21) -----------------------------------------
//
// They are not one shortcut around the other. A verdict has exactly two producers and they are
// built in opposite directions, so this file models both:
//
//  - THE FLOOR (`deterministic-classifier`) is a FUNCTION of a member's TestResult. So the floor
//    corpus SCRIPTS a result and asks the runner's own `classifyRootCause` what it says — a caller
//    asks for "a member that blew its deadline" and gets whatever the classifier answers, rather
//    than asserting what it should have answered. 390-16 shipped green over the opposite: a
//    `CompletedRunHandoff` carrying `class: 'flake'` WITH `producer: 'deterministic-classifier'`,
//    behind an `as unknown as` cast, which the classifier cannot emit for ANY input. The
//    `FoldVerdictSpec` union below is what makes that shape stop COMPILING instead of quietly
//    passing.
//  - AN AUTHORED VERDICT (`analyze-run`) is a MODEL OUTPUT. It has no deterministic producer to
//    route through and the class genuinely IS the input, so the authored builder still takes a
//    class name — and that is faithful, not a shortcut.
//
// WHAT THE SCRIPTED RESULT DOES AND DOES NOT DECIDE HERE. It produces the VERDICT. The handoff's
// step evidence stays the fixture's own rich `failingStep()`, because this file's subject is the
// fold and the failure fingerprint it derives; the end-to-end file (cli
// `quarantine-lifecycle.e2e.test.ts`) is where the scripted result drives the real shell and the
// steps come off the run too.

/**
 * The runner's own test-deadline message, from the SINGLE MINT SITE that defines it
 * (`createTimeoutAbortReason`) — never a string literal. The matcher `isTestTimeoutMessage` and
 * this mint are deliberately single-sourced, so a literal here would pin a message the runner
 * stops emitting the day the format changes.
 */
const TEST_DEADLINE_ERROR = createTimeoutAbortReason('test', 30_000).message

/** A member that blew the hard test budget ⇒ `deriveMemberOutcome` answers `'timeout'`. */
function timedOutResult(): TestResult {
  return {
    name: TEST_NAME,
    filePath: FILE_PATH,
    status: 'failed',
    steps: [{ name: 'pay now', status: 'failed', duration: 1, error: TEST_DEADLINE_ERROR }],
    duration: 1,
  }
}

/** A member whose failing step carries a connect token ⇒ the classifier answers `'environment'`. */
function connectFailureResult(): TestResult {
  return {
    name: TEST_NAME,
    filePath: FILE_PATH,
    status: 'failed',
    steps: [{
      name: 'pay now',
      status: 'failed',
      duration: 1,
      error: 'connect ECONNREFUSED 127.0.0.1:4173',
    }],
    duration: 1,
  }
}

/** A member that PASSED on retry — the ONLY shape `classifyRootCause` mints `flake` for. */
function passedOnRetryResult(): TestResult {
  return {
    name: TEST_NAME,
    filePath: FILE_PATH,
    status: 'passed',
    steps: [{ name: 'pay now', status: 'passed', duration: 1 }],
    duration: 1,
    retryCount: 1,
  }
}

/**
 * The verdict THE RUNNER ANSWERS for a scripted member — the same three inputs the shell coexists
 * with at its one classification seam (`run/shell.ts`): the result, the derived member outcome,
 * and the member index.
 */
function producedVerdict(result: TestResult, perTest = 0): Verdict {
  const verdict = classifyRootCause({
    result,
    outcome: deriveMemberOutcome(result),
    testIndex: perTest,
  })
  if (verdict === undefined) {
    throw new Error('the classifier declined to classify this scripted member')
  }
  return verdict
}

/** An `analyze-run` verdict: a model output, so the class IS the input (see the note above). */
function authoredVerdict(verdictClass: VerdictClass, perTest = 0): Verdict {
  return {
    class: verdictClass,
    producer: 'analyze-run',
    confidence: 0.6,
    evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: ERROR_TEXT },
    memoryMisdirectionRuledOut: false,
    perTest,
  } as Verdict
}

/**
 * WHICH PRODUCER a fixture's verdict comes from — and the compile-time guard of this whole file.
 *
 * The two arms are mutually exclusive by TYPE (`?: undefined` on the opposite key), so
 * `{ produced: timedOutResult(), authored: 'flake' }` — scripting a failing member and forcing the
 * class the floor mints only on a PASS — does not compile. There is no longer any way in this file
 * to hand-write a `deterministic-classifier` verdict at all: the floor arm's class is whatever the
 * classifier answers for the scripted result, and nothing else.
 */
type FoldVerdictSpec =
  | { readonly authored: VerdictClass; readonly produced?: undefined }
  | { readonly produced: TestResult; readonly authored?: undefined }

function verdictFor(spec: FoldVerdictSpec, perTest = 0): Verdict {
  return spec.produced === undefined
    ? authoredVerdict(spec.authored, perTest)
    : producedVerdict(spec.produced, perTest)
}

/**
 * Every leg in this file that does not name a verdict spec is about fold PLUMBING — the
 * applied-arm gate, the append/commit ordering, the owner carry-forward, the anti-silencing class
 * differential — and needs a verdict the gate genuinely ADMITS to exercise it. A floor-produced
 * verdict cannot be that verdict HERE: the floor arm requires a per-crossing
 * `sameBuildPassAndFail`, the fold computes it from the crossing test's own outcome window
 * (390-21), and every plumbing fixture drives three distinct failing ordinals with no same-ordinal
 * pass — so its window carries no signature and the floor arm refuses it on the facts. The legs
 * that ARE about the producer axis name their spec explicitly, and the legs about the signature
 * build the two-runs-at-one-ordinal window the floor arm needs.
 */
const AUTHORED_FLAKE: FoldVerdictSpec = { authored: 'flake' }

function handoffFixture(input: {
  runId: string
  buildOrdinal: number
  passed?: boolean
  verdict?: FoldVerdictSpec
  testName?: string
  filePath?: string
}): CompletedRunHandoff {
  const passed = input.passed === true
  return {
    schemaVersion: 6,
    runId: input.runId,
    buildOrdinal: input.buildOrdinal,
    scope: SHOP_SCOPE,
    executionContext: 'ci',
    aggregateVerdict: passed ? 'passed' : 'failed',
    configDigests: {
      suiteConfigDigest: 'detection-suite-digest',
      testConfigDigest: 'detection-test-digest',
    },
    startedAt: input.buildOrdinal * 1_000,
    endedAt: input.buildOrdinal * 1_000 + 1,
    tests: [{
      testId: `${input.runId}-checkout`,
      testName: input.testName ?? TEST_NAME,
      filePath: input.filePath ?? FILE_PATH,
      testIndex: 0,
      outcome: passed ? 'passed' : 'failed',
      steps: [failingStep()],
      ...(passed
        ? {}
        : { rootCause: verdictFor(input.verdict ?? AUTHORED_FLAKE) }),
    } as unknown as PerTestOutcome],
  } as unknown as CompletedRunHandoff
}

/**
 * ONE run carrying TWO failing members whose ONLY difference is the resolved verdict class.
 * Same step, same anchor, same error text, same ordinal — so the class is genuinely the only
 * varied input, which is what makes the pair a differential rather than two examples.
 */
function twoClassHandoff(input: {
  runId: string
  buildOrdinal: number
  classA: VerdictClass
  classB: VerdictClass
}): CompletedRunHandoff {
  const member = (index: number, verdictClass: VerdictClass) => ({
    testId: `${input.runId}-${String(index)}`,
    testName: `${TEST_NAME} [${verdictClass}]`,
    filePath: `suite/${verdictClass}.test.ts`,
    testIndex: index,
    outcome: 'failed',
    steps: [failingStep()],
    // The AUTHORED path specifically: this differential varies the RESOLVED class directly,
    // which only an `analyze-run` verdict lets a fixture do (see the two-builders note above).
    rootCause: authoredVerdict(verdictClass, index),
  } as unknown as PerTestOutcome)
  return {
    schemaVersion: 6,
    runId: input.runId,
    buildOrdinal: input.buildOrdinal,
    scope: SHOP_SCOPE,
    executionContext: 'ci',
    aggregateVerdict: 'failed',
    configDigests: {
      suiteConfigDigest: 'detection-suite-digest',
      testConfigDigest: 'detection-test-digest',
    },
    startedAt: input.buildOrdinal * 1_000,
    endedAt: input.buildOrdinal * 1_000 + 1,
    tests: [member(0, input.classA), member(1, input.classB)],
  } as unknown as CompletedRunHandoff
}

interface FoldHarness {
  knowledgeRoot: string
  auditBaseDir: string
}

function harness(prefix: string): FoldHarness {
  return {
    knowledgeRoot: tempDir(`${prefix}-knowledge-`),
    auditBaseDir: tempDir(`${prefix}-audit-`),
  }
}

function fold(
  env: FoldHarness,
  handoff: CompletedRunHandoff,
  overrides: { now?: string; policy?: GuardrailPolicy; withoutQuarantine?: true } = {},
): FoldRunOutcomesReport {
  return foldRunOutcomes({
    knowledgeRoot: env.knowledgeRoot,
    handoff,
    extractAnchors,
    ...(overrides.withoutQuarantine === true ? {} : {
      quarantine: {
        now: overrides.now ?? NOW,
        auditBaseDir: env.auditBaseDir,
        ...(overrides.policy === undefined ? {} : { policy: overrides.policy }),
      },
    }),
  })
}

function ledgerPath(env: FoldHarness): string {
  return join(env.knowledgeRoot, QUARANTINE_LEDGER_FILENAME)
}

function ledgerLines(env: FoldHarness): Record<string, unknown>[] {
  if (!existsSync(ledgerPath(env))) return []
  return readFileSync(ledgerPath(env), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/** The A3 crossing, driven through three real folds: ordinals 1, 2, then the 3rd that escalates. */
function crossThreeInFive(env: FoldHarness, opts: {
  verdict?: FoldVerdictSpec
  testName?: string
  filePath?: string
  policy?: GuardrailPolicy
} = {}): FoldRunOutcomesReport {
  let last: FoldRunOutcomesReport | undefined
  for (const buildOrdinal of [1, 2, 3]) {
    last = fold(env, handoffFixture({
      runId: `run-${opts.testName ?? 'default'}-${String(buildOrdinal)}`,
      buildOrdinal,
      ...(opts.verdict === undefined ? {} : { verdict: opts.verdict }),
      ...(opts.testName === undefined ? {} : { testName: opts.testName }),
      ...(opts.filePath === undefined ? {} : { filePath: opts.filePath }),
    }), opts.policy === undefined ? {} : { policy: opts.policy })
  }
  if (last === undefined) throw new Error('no fold ran')
  return last
}

function enteredEvent(overrides: Partial<Record<string, unknown>> = {}): QuarantineLedgerEvent {
  return {
    schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    kind: 'entered',
    at: '2026-07-06T12:00:00.000Z',
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    fingerprint: 'seeded-fingerprint',
    verdictClass: 'flake',
    owner: QUARANTINE_UNASSIGNED_OWNER,
    expiresAt: '2026-12-01T12:00:00.000Z',
    ...overrides,
  } as QuarantineLedgerEvent
}

describe('detection is gated on the applied arm (D-08)', () => {
  it('appends exactly one entered line when a run crosses 3-in-5 as a flake', () => {
    const env = harness('agent-qa-detect-cross')

    const report = crossThreeInFive(env)

    expect(report.kind).toBe('applied')
    expect(report.quarantine.kind).toBe('evaluated')
    expect(ledgerLines(env)).toEqual([{
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'entered',
      at: NOW,
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      fingerprint: expect.stringContaining('::flake') as unknown as string,
      verdictClass: 'flake',
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
    }])
  })

  it('flags at the second ordinal and writes NOT ONE BYTE of ledger', () => {
    const env = harness('agent-qa-detect-flag')

    fold(env, handoffFixture({ runId: 'run-flag-1', buildOrdinal: 1 }))
    const report = fold(env, handoffFixture({ runId: 'run-flag-2', buildOrdinal: 2 }))

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.flagged).toHaveLength(1)
    expect(report.quarantine.events).toEqual([])
    expect(existsSync(ledgerPath(env))).toBe(false)
  })

  it('re-draining the SAME run appends nothing — the marker short-circuits detection', () => {
    const env = harness('agent-qa-detect-refold')
    crossThreeInFive(env)
    const afterFirst = readFileSync(ledgerPath(env), 'utf8')

    // The exact bytes the tail would replay after a withheld receipt: the same handoff, again.
    const refold = fold(env, handoffFixture({ runId: 'run-default-3', buildOrdinal: 3 }))

    expect(refold).toEqual({
      kind: 'already-applied',
      tests: 0,
      quarantine: { kind: 'not-evaluated', reason: 'already-applied' },
    })
    expect(readFileSync(ledgerPath(env), 'utf8')).toBe(afterFirst)
  })

  it('does not evaluate at all when the caller asks for no detection', () => {
    const env = harness('agent-qa-detect-off')

    let report: FoldRunOutcomesReport | undefined
    for (const buildOrdinal of [1, 2, 3]) {
      report = fold(
        env,
        handoffFixture({ runId: `run-off-${String(buildOrdinal)}`, buildOrdinal }),
        { withoutQuarantine: true },
      )
    }

    expect(report?.quarantine).toEqual({ kind: 'not-evaluated', reason: 'not-requested' })
    expect(existsSync(ledgerPath(env))).toBe(false)
  })
})

describe('the append orders AFTER the commit, and self-heals (Open Q1)', () => {
  /**
   * A committed-egress refusal is the one prevented-append this suite can induce deterministically:
   * an email-shaped token inside the test NAME travels onto the `entered` event, and the default
   * policy's `email: 'redact'` blocks a non-user-authored committed part. Flipping that one
   * detector to `off` on the NEXT fold is the whole delta — same identity, same crossed window.
   */
  const SECRET_TEST_NAME = 'checkout as qa-owner@example.com'
  const unblocked = (): GuardrailPolicy => loadGuardrailPolicy({
    detectors: {
      awsKey: 'block',
      creditCard: 'block',
      pemKey: 'block',
      bearer: 'redact',
      apiKey: 'redact',
      email: 'off',
    },
    allowlist: [],
  })

  it('surfaces a blocked append as DATA, leaves the file untouched, and appends next fold', () => {
    const env = harness('agent-qa-detect-heal')

    const blockedReport = crossThreeInFive(env, { testName: SECRET_TEST_NAME })

    expect(blockedReport.kind).toBe('applied')
    if (blockedReport.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(blockedReport.quarantine.events).toHaveLength(1)
    expect(blockedReport.quarantine.append.kind).toBe('egress-blocked')
    // Fail-closed: the checkpoint runs before a byte reaches the committed file.
    expect(existsSync(ledgerPath(env))).toBe(false)

    // The window is STILL crossed, so the next applied fold re-evaluates and appends exactly once.
    const healed = fold(
      env,
      handoffFixture({ runId: 'run-heal-4', buildOrdinal: 4, testName: SECRET_TEST_NAME }),
      { policy: unblocked() },
    )

    if (healed.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(healed.quarantine.append).toEqual({ kind: 'appended', lines: 1 })
    expect(ledgerLines(env)).toHaveLength(1)
    expect(ledgerLines(env)[0]).toMatchObject({ kind: 'entered', testName: SECRET_TEST_NAME })
  })

  it('appends no SECOND entered once the window is open — re-entry is suppressed', () => {
    const env = harness('agent-qa-detect-once')
    crossThreeInFive(env)

    const again = fold(env, handoffFixture({ runId: 'run-again-4', buildOrdinal: 4 }))

    if (again.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(again.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toHaveLength(1)
  })
})

describe('the fold report surfaces every failure mode as data (Pitfall 4)', () => {
  function writeLedger(env: FoldHarness, text: string): void {
    mkdirSync(env.knowledgeRoot, { recursive: true })
    writeFileSync(ledgerPath(env), text, 'utf8')
  }

  it('carries refused ledger lines rather than healing them away', () => {
    const env = harness('agent-qa-detect-refused')
    // One good line and one a human damaged by hand — D-12 says this file is theirs to edit.
    writeLedger(env, `${canonicalJson(enteredEvent())}\n{"kind":"entered"\n`)

    const report = fold(env, handoffFixture({ runId: 'run-refused-1', buildOrdinal: 1 }))

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.refusedLines).toHaveLength(1)
    expect(report.quarantine.refusedLines[0]?.lineNumber).toBe(2)
  })

  it('refuses to evaluate against a ledger it cannot read, and says so', () => {
    const env = harness('agent-qa-detect-unreadable')
    writeLedger(env, `${canonicalJson({ ...enteredEvent(), schemaVersion: 99 })}\n`)

    const report = fold(env, handoffFixture({ runId: 'run-unreadable-1', buildOrdinal: 1 }))

    // The counters still applied — the projection is derived and rebuildable. What must NOT happen
    // is detection guessing at committed truth it cannot parse.
    expect(report.kind).toBe('applied')
    expect(report.quarantine.kind).toBe('ledger-unreadable')
  })
})

describe('auto-exit through the real fold (D-10, FLAK-03)', () => {
  function seedQuarantined(env: FoldHarness): void {
    appendQuarantineEvents(env.knowledgeRoot, [enteredEvent()], {
      auditBaseDir: env.auditBaseDir,
    })
  }

  it('releases after the 5th passing ordinal and NOT after the 4th', () => {
    const env = harness('agent-qa-detect-exit')
    seedQuarantined(env)

    for (const buildOrdinal of [1, 2, 3, 4]) {
      const partial = fold(env, handoffFixture({
        runId: `run-pass-${String(buildOrdinal)}`,
        buildOrdinal,
        passed: true,
      }))
      if (partial.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
      expect(partial.quarantine.events).toEqual([])
    }
    expect(ledgerLines(env)).toHaveLength(1)

    const released = fold(env, handoffFixture({
      runId: 'run-pass-5',
      buildOrdinal: 5,
      passed: true,
    }))

    if (released.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(released.quarantine.events).toHaveLength(1)
    expect(ledgerLines(env)[1]).toEqual({
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'released-auto',
      at: NOW,
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
    })
  })

  // 390-17 / G-390-4, the probe's own measurement inverted into the shipped behavior. Feeding SIX
  // consecutive passing ordinals to a test whose window had LAPSED measured `releasedAutoLines: 0`
  // at every ordinal: a test that got FIXED during a lapse was listed as `expired` forever, and
  // only a manual `release` closed it. That is FLAK-03's own counter-example — an entry a fixed
  // test can never leave — so the exit path now applies in every state where an entry is LISTED.
  //
  // Driven through the REAL fold because the rule lives at TWO sites and either alone is a no-op:
  // `evaluateQuarantineDetection`'s release-loop filter, and `evaluateQuarantineForFold`'s
  // exit-candidate `testWindows` filter, which is what decides whether a window for a lapsed entry
  // is BUILT at all. With only the first changed the pure rule answers correctly over a window that
  // never arrives — a green unit test over a broken fold. Only a fold-level leg sees both.
  it('releases an entry whose deadline has already LAPSED, at the 5th passing ordinal and not the 4th', () => {
    const env = harness('agent-qa-detect-exit-expired')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [enteredEvent({ expiresAt: '2026-07-10T12:00:00.000Z' })],
      { auditBaseDir: env.auditBaseDir },
    )

    for (const buildOrdinal of [1, 2, 3, 4]) {
      const partial = fold(env, handoffFixture({
        runId: `run-lapsed-${String(buildOrdinal)}`,
        buildOrdinal,
        passed: true,
      }))
      if (partial.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
      expect(partial.quarantine.events).toEqual([])
    }
    expect(ledgerLines(env)).toHaveLength(1)

    const released = fold(env, handoffFixture({
      runId: 'run-lapsed-5',
      buildOrdinal: 5,
      passed: true,
    }))
    if (released.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(released.quarantine.events).toHaveLength(1)
    expect(ledgerLines(env)[1]).toEqual({
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'released-auto',
      at: NOW,
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
    })

    // The probe fed a SIXTH ordinal; the release must not repeat, because the window it closed is
    // now CLOSED — the same complement asserted on the pure rule, here against committed bytes.
    const sixth = fold(env, handoffFixture({
      runId: 'run-lapsed-6',
      buildOrdinal: 6,
      passed: true,
    }))
    if (sixth.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(sixth.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toHaveLength(2)

    // …and the entry reads CLOSED rather than still-lapsed: `released-auto` over a lapsed window
    // folds to `released` because the computed-`expired` arm only ever reaches an OPEN one. No
    // further change was needed in `foldQuarantineLedgerState`, and this is what says so.
    const state = foldQuarantineLedgerState(readQuarantineLedger(env.knowledgeRoot).events, NOW)
    expect(state.map((entry) => entry.state)).toEqual(['released'])
  })

  it('COMPLEMENT: never re-releases a window a human already CLOSED', () => {
    const env = harness('agent-qa-detect-exit-released')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [
        enteredEvent({ expiresAt: '2026-07-10T12:00:00.000Z' }),
        {
          schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
          kind: 'released-manual',
          at: '2026-07-20T12:00:00.000Z',
          product: PRODUCT,
          filePath: FILE_PATH,
          testName: TEST_NAME,
        },
      ],
      { auditBaseDir: env.auditBaseDir },
    )

    let report: FoldRunOutcomesReport | undefined
    for (const buildOrdinal of [1, 2, 3, 4, 5, 6]) {
      report = fold(env, handoffFixture({
        runId: `run-closed-${String(buildOrdinal)}`,
        buildOrdinal,
        passed: true,
      }))
    }

    if (report?.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toHaveLength(2)
  })

  // The two arms do not interfere: a lapsed entry whose test keeps FAILING authors nothing on the
  // exit path and still re-enters on the crossing path. Without this, "the exit path now admits a
  // lapsed window" could have been read as "a lapsed window leaves on any evidence at all".
  it('a LAPSED entry whose test keeps failing re-enters and is never released', () => {
    const env = harness('agent-qa-detect-exit-still-failing')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [enteredEvent({ expiresAt: '2026-07-10T12:00:00.000Z' })],
      { auditBaseDir: env.auditBaseDir },
    )

    crossThreeInFive(env)

    const lines = ledgerLines(env)
    expect(lines.map((line) => line.kind)).toEqual(['entered', 'entered'])
    expect(lines[1]).toMatchObject({ kind: 'entered', expiresAt: EXPECTED_EXPIRY })
  })
})

// The owner rule through the REAL fold (390-18 / G-390-4). The pure rule's table reads entries a
// caller handed it; here the entries come from the committed ledger's own fold, so what is pinned
// is that a claim a human wrote into the file survives the round trip through it — and that a
// release they made deliberately ends the claim with the window.

describe("the auto-entry's owner through the real fold (390-18)", () => {
  it("carries a human's claim across a LAPSE and re-entry", () => {
    const env = harness('agent-qa-detect-owner-lapse')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [enteredEvent({ owner: 'alice', expiresAt: '2026-07-10T12:00:00.000Z' })],
      { auditBaseDir: env.auditBaseDir },
    )

    crossThreeInFive(env)

    const lines = ledgerLines(env)
    expect(lines.map((line) => line.kind)).toEqual(['entered', 'entered'])
    expect(lines[1]).toMatchObject({ kind: 'entered', owner: 'alice', expiresAt: EXPECTED_EXPIRY })
    // And the folded row a surface reads answers the claim too, not just the committed line.
    const { events } = readQuarantineLedger(env.knowledgeRoot)
    const state = foldQuarantineLedgerState(events, NOW)
    expect(state).toHaveLength(1)
    expect(state[0]).toMatchObject({ owner: 'alice', state: 'quarantined', enteredCount: 2 })
  })

  it('COMPLEMENT: starts unassigned after a window a human deliberately RELEASED', () => {
    const env = harness('agent-qa-detect-owner-released')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [
        enteredEvent({ owner: 'alice' }),
        {
          schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
          kind: 'released-manual',
          at: '2026-07-20T12:00:00.000Z',
          product: PRODUCT,
          filePath: FILE_PATH,
          testName: TEST_NAME,
        } as QuarantineLedgerEvent,
      ],
      { auditBaseDir: env.auditBaseDir },
    )

    crossThreeInFive(env)

    const lines = ledgerLines(env)
    expect(lines.map((line) => line.kind)).toEqual(['entered', 'released-manual', 'entered'])
    expect(lines[2]).toMatchObject({ kind: 'entered', owner: QUARANTINE_UNASSIGNED_OWNER })
  })
})

describe('the anti-silencing differential: D-05 in BOTH directions', () => {
  const FLAKE_TEST = `${TEST_NAME} [flake]`
  const APP_BUG_TEST = `${TEST_NAME} [app_bug]`

  /** Plan 01's run-start snapshot rule, spelled the way agent-local spells it: state === open. */
  function activeQuarantineSet(env: FoldHarness): string[] {
    const read = readQuarantineLedger(env.knowledgeRoot)
    return foldQuarantineLedgerState(read.events, NOW)
      .filter((entry) => entry.state === 'quarantined')
      .map((entry) => entry.testName)
      .sort()
  }

  function crossBothClasses(env: FoldHarness): FoldRunOutcomesReport {
    let last: FoldRunOutcomesReport | undefined
    for (const buildOrdinal of [1, 2, 3]) {
      last = fold(env, twoClassHandoff({
        runId: `run-anti-silencing-${String(buildOrdinal)}`,
        buildOrdinal,
        classA: 'flake',
        classB: 'app_bug',
      }))
    }
    if (last === undefined) throw new Error('no fold ran')
    return last
  }

  it('quarantines the flake and REFUSES to quarantine the app_bug at the same recurrence', () => {
    const env = harness('agent-qa-anti-silencing')

    const report = crossBothClasses(env)

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')

    // Both halves genuinely crossed: the negative half is not passing for want of recurrence
    // (an assertion that something did NOT happen is load-bearing only if the input could have
    // made it happen). Both sightings answer the same occurrence count.
    const escalated = report.quarantine.escalatedNotQuarantined
    expect(escalated.map((sight) => sight.testName)).toEqual([APP_BUG_TEST])
    expect(escalated[0]?.verdictClass).toBe('app_bug')
    expect(escalated[0]?.occurrenceOrdinals).toBe(QUARANTINE_ESCALATE_THRESHOLD)

    expect(report.quarantine.events).toHaveLength(1)
    expect(report.quarantine.events[0]).toMatchObject({
      kind: 'entered',
      testName: FLAKE_TEST,
      verdictClass: 'flake',
    })
    // The occurrence count the POSITIVE half acted on, so the two halves are comparable.
    expect(ledgerLines(env).map((line) => line.testName)).toEqual([FLAKE_TEST])
  })

  it('closes the loop to FLAK-02: the app_bug test is absent from the active set', () => {
    const env = harness('agent-qa-anti-silencing-snapshot')

    crossBothClasses(env)

    // The join that makes this a product claim rather than a code claim: the SAME ledger the
    // detection wrote is folded through plan 01's state fold, which is what a run start reads.
    // The app_bug test is not in it, so its next failure still fails the build.
    expect(activeQuarantineSet(env)).toEqual([FLAKE_TEST])
  })

  it('names AUTO_QUARANTINE_CLASSES as the thing under test', () => {
    // Both mutations this differential must detect, stated as data so the reason a reader can
    // check is the same one the probe checks: deleting 'flake' from the auto set must red the
    // positive half; adding 'app_bug' must red the negative half.
    expect(AUTO_QUARANTINE_CLASSES).toContain('flake')
    expect(AUTO_QUARANTINE_CLASSES).not.toContain('app_bug')
    expect(QUARANTINE_CLASS_DISPOSITIONS.flake).toBe('auto-quarantine')
    expect(QUARANTINE_CLASS_DISPOSITIONS.app_bug).toBe('escalate-only')
  })
})

// The floor-eligibility gate, driven to COMMITTED LEDGER BYTES (390-16, G-390-3).
//
// The pure rule's table cannot show what this suite shows. Until now the fold had only ever driven
// `flake` and `app_bug` — the two classes this whole item is about, `environment` and `timeout`,
// had zero end-to-end coverage, which is how a floor-minted crossing walked all the way to a
// committed 30-day suppression through 44/44 green tests and a deep review.
//
// Every pair varies exactly ONE input: `rootCause.producer`. Same test, same step, same anchor,
// same error text, same three build ordinals, same class.
describe('a floor-produced crossing cannot buy a committed entry (390-16)', () => {
  // Both classes are still REFUSED end-to-end, but since 390-19 for DIFFERENT reasons, and the old
  // name (`AUTHORED_REQUIRED_AUTO_CLASSES`) asserted a falsehood about one of them. `environment`
  // is authored-required in QUARANTINE_FLOOR_ELIGIBILITY. `timeout` is FLOOR-ELIGIBLE and is
  // refused here only for want of the per-crossing signature — and since 390-21 that is a fact
  // about THESE FIXTURES rather than about the tree: `crossThreeInFive` drives three distinct
  // failing ordinals, so the window the fold now reads carries no same-build pass∧fail. The leg
  // that supplies one is in the 390-21 block above, and it enters. The observable answer here is
  // identical to 390-16's; the reason is not, and this file must not re-assert a reason that
  // stopped being true.
  //
  // PRODUCED, NOT DECLARED (390-21). Each row names a SCRIPTED MEMBER, and the class beside it is
  // what `classifyRootCause` ANSWERS for that member — asserted below, so a row that stopped being
  // producible reds here instead of silently pinning an input the runner cannot emit.
  const FLOOR_PRODUCED_CROSSINGS = [
    { verdictClass: 'environment' as VerdictClass, script: connectFailureResult },
    { verdictClass: 'timeout' as VerdictClass, script: timedOutResult },
  ]

  it.each(FLOOR_PRODUCED_CROSSINGS)(
    'the runner really does answer $verdictClass on the floor for that scripted member',
    ({ verdictClass, script }) => {
      expect(producedVerdict(script())).toMatchObject({
        class: verdictClass,
        producer: 'deterministic-classifier',
      })
    },
  )

  it.each(FLOOR_PRODUCED_CROSSINGS)(
    'writes ZERO ledger bytes for a floor-produced $verdictClass crossing, and escalates it instead',
    ({ verdictClass, script }) => {
      const env = harness(`agent-qa-floor-refuse-${verdictClass}`)

      const report = crossThreeInFive(env, { verdict: { produced: script() } })

      expect(report.kind).toBe('applied')
      if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
      expect(report.quarantine.events).toEqual([])
      expect(ledgerLines(env)).toEqual([])
      expect(report.quarantine.escalatedNotQuarantined).toHaveLength(1)
      expect(report.quarantine.escalatedNotQuarantined[0]).toMatchObject({
        product: PRODUCT,
        testName: TEST_NAME,
        verdictClass,
        producer: 'deterministic-classifier',
        occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD,
      })
      // FLAK-02's join: nothing suppresses, so the next failure still fails the build.
      expect(foldQuarantineLedgerState(readQuarantineLedger(env.knowledgeRoot).events, NOW))
        .toEqual([])
    },
  )

  it.each(FLOOR_PRODUCED_CROSSINGS)(
    'commits ONE entered line for the same $verdictClass crossing when analyze-run authored it',
    ({ verdictClass }) => {
      const env = harness(`agent-qa-floor-accept-${verdictClass}`)

      const report = crossThreeInFive(env, { verdict: { authored: verdictClass } })

      if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
      expect(report.quarantine.escalatedNotQuarantined).toEqual([])
      expect(report.quarantine.events).toHaveLength(1)
      expect(ledgerLines(env)).toEqual([{
        schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
        kind: 'entered',
        at: NOW,
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        fingerprint: expect.stringContaining(`::${verdictClass}`) as unknown as string,
        verdictClass,
        owner: QUARANTINE_UNASSIGNED_OWNER,
        expiresAt: EXPECTED_EXPIRY,
      }])
    },
  )

  // WHY THERE IS NO "floor-produced flake" LEG HERE, demonstrated rather than asserted (390-21).
  //
  // 390-16 wrote a leg claiming a floor-produced `flake` commits an entered line, and 390-19
  // inverted it to a refusal for the one wave the fold's fill was a constant. Both were writing
  // about an input the pipeline CANNOT BUILD, which is one of the four artifacts G-390-5 names as
  // vacuous. So the leg is gone, and what replaces it is the floor's actual rule, run: the
  // classifier mints `flake` only for a member that PASSED, and a passing member contributes no
  // failure row, so no `QuarantineDetectionFailure` can ever carry class `flake` with the floor's
  // producer. Every `flake` crossing the pipeline can build is AUTHORED, and is admitted by the
  // first disjunct — which the `analyze-run` legs above already cover.
  //
  // Since 390-21 this is also enforced by the type system: `FoldVerdictSpec`'s two arms are
  // mutually exclusive, so `{ produced: <a failing member>, authored: 'flake' }` does not compile.
  it('mints `flake` only on a member that PASSED, so no failure row can carry it', () => {
    const passedOnRetry = passedOnRetryResult()
    expect(deriveMemberOutcome(passedOnRetry)).toBe('passed')
    expect(producedVerdict(passedOnRetry)).toMatchObject({
      class: 'flake',
      producer: 'deterministic-classifier',
    })
    // The same member without the retry answers NO verdict at all — the D-01 presence rule: a
    // clean pass is not a failure to explain.
    expect(classifyRootCause({
      result: { ...passedOnRetry, retryCount: 0 },
      outcome: deriveMemberOutcome({ ...passedOnRetry, retryCount: 0 }),
      testIndex: 0,
    })).toBeUndefined()
    // And the FAILING members the floor path is actually about are never flakes.
    expect(producedVerdict(timedOutResult())).toMatchObject({ class: 'timeout' })
    expect(producedVerdict(connectFailureResult())).toMatchObject({ class: 'environment' })

    // The consequence, through the REAL fold: three passing runs contribute no failure row at all,
    // so nothing crosses and not one byte is written — there is no crossing for a floor-produced
    // `flake` to be attached to.
    const env = harness('agent-qa-floor-flake-unbuildable')
    for (const buildOrdinal of [1, 2, 3]) {
      const report = fold(env, handoffFixture({
        runId: `run-flake-pass-${String(buildOrdinal)}`,
        buildOrdinal,
        passed: true,
      }))
      if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
      expect(report.quarantine.events).toEqual([])
      expect(report.quarantine.escalatedNotQuarantined).toEqual([])
    }
    expect(ledgerLines(env)).toEqual([])
  })
})

// THE PER-CROSSING FLAKE SIGNATURE, ANSWERED BY THE FOLD (390-21 Task 1, G-390-5).
//
// 390-19 made the floor arm require a per-crossing `sameBuildPassAndFail` and filled the fold's
// only construction site with a constant `false`, so the floor disjunct was INERT IN-TREE BY
// CONSTRUCTION for one wave. These legs are the closure of that interval: they drive the REAL fold
// and observe the gate's answer change with the crossing test's OWN outcome history and nothing
// else — same class, same producer, same crossing, same three occurrence ordinals.
//
// WHY THE FOLD IS THE ONLY PLACE THAT CAN ANSWER IT. `evaluateQuarantineForFold` builds
// `testWindows` from the folded LEDGER ENTRIES — tests already quarantined — while the signature is
// needed for a CROSSING, which is by definition not in the ledger yet and therefore has NO window.
// The two reads look redundant and are not; the fold is simply the only site holding both the
// crossing's identity and the db handle.
//
// THE REAL-WORLD BOUND, stated here because this is the file a reader learns the capability from:
// two entries at one build ordinal require TWO SEPARATE APPLIED RUNS carrying the same
// `handoff.buildOrdinal`. An in-run retry cannot produce it — the member-runner collapses retries
// into one member outcome and `healed` counts as a pass — so the fixtures below fold two runs.
describe('a CROSSING test carries its own same-build pass∧fail into the gate (390-21)', () => {
  /** One fold at `buildOrdinal`, floor-produced `timeout`, pass or fail. */
  function foldTimeout(env: FoldHarness, input: {
    runId: string
    buildOrdinal: number
    passed?: boolean
    testName?: string
    filePath?: string
  }): FoldRunOutcomesReport {
    return fold(env, handoffFixture({ ...input, verdict: { produced: timedOutResult() } }))
  }

  it('AUTO-QUARANTINES a floor-produced timeout whose window carries a same-build pass', () => {
    const env = harness('agent-qa-390-21-signature-set')

    // Ordinal 1 is driven TWICE — two separate applied runs, one failing and one passing, at ONE
    // build ordinal. That pair IS the signature; the ordinal-2 and ordinal-3 failures only carry
    // the fingerprint across the escalate threshold.
    foldTimeout(env, { runId: 'run-sig-1-fail', buildOrdinal: 1 })
    foldTimeout(env, { runId: 'run-sig-1-pass', buildOrdinal: 1, passed: true })
    foldTimeout(env, { runId: 'run-sig-2', buildOrdinal: 2 })
    const report = foldTimeout(env, { runId: 'run-sig-3', buildOrdinal: 3 })

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    // No authored verdict participated anywhere: the producer on the crossing is the floor's.
    expect(report.quarantine.escalatedNotQuarantined).toEqual([])
    expect(report.quarantine.events).toHaveLength(1)
    expect(ledgerLines(env)).toEqual([{
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'entered',
      at: NOW,
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      fingerprint: expect.stringContaining('::timeout') as unknown as string,
      verdictClass: 'timeout',
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
    }])
  })

  it('REFUSES the same crossing when every ordinal carries one answer — signature clear', () => {
    const env = harness('agent-qa-390-21-signature-clear')

    // The ONLY delta from the leg above: no second run at ordinal 1. Three failing ordinals still
    // cross, so the refusal is the signature's doing and not a sub-threshold window.
    foldTimeout(env, { runId: 'run-nosig-1', buildOrdinal: 1 })
    foldTimeout(env, { runId: 'run-nosig-2', buildOrdinal: 2 })
    const report = foldTimeout(env, { runId: 'run-nosig-3', buildOrdinal: 3 })

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toEqual([])
    expect(report.quarantine.escalatedNotQuarantined).toHaveLength(1)
    expect(report.quarantine.escalatedNotQuarantined[0]).toMatchObject({
      testName: TEST_NAME,
      verdictClass: 'timeout',
      producer: 'deterministic-classifier',
      occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD,
    })
  })

  it('REFUSES a crossing for a test this run is the FIRST to count — one entry, no signature', () => {
    const env = harness('agent-qa-390-21-first-sighting')

    // Recurrence is keyed (product, fingerprint); a quarantine ENTRY is keyed on test identity.
    // So a test the projection has never counted can cross on its very first appearance, carried
    // over the threshold by a sibling that shares its failure signature. Its window then holds
    // exactly ONE entry — this run — and one entry can never be a same-build pass∧fail.
    //
    // This is the reachable form of the typed-absence case. The fold applies the projection BEFORE
    // it evaluates detection, so the crossing test ALWAYS has a row by the time the signature is
    // read; `readTestOutcomeHistory` returning `undefined` is a defensive branch the fold's own
    // ordering makes unreachable in-tree, pinned directly in
    // `projection/__tests__/run-outcome-read.test.ts` ("answers undefined for a missing row").
    const NEWCOMER = 'checkout retries the payment sheet [newcomer]'
    foldTimeout(env, { runId: 'run-first-1', buildOrdinal: 1 })
    foldTimeout(env, { runId: 'run-first-2', buildOrdinal: 2 })
    const report = foldTimeout(env, {
      runId: 'run-first-3',
      buildOrdinal: 3,
      testName: NEWCOMER,
      filePath: 'suite/newcomer.test.ts',
    })

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toEqual([])
    expect(report.quarantine.escalatedNotQuarantined).toHaveLength(1)
    expect(report.quarantine.escalatedNotQuarantined[0]).toMatchObject({
      testName: NEWCOMER,
      verdictClass: 'timeout',
      occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD,
    })
  })
})

// The RUN-SCOPED mass-quarantine shape (390-16, G-390-3; measured in 390-UAT-DECISIONS-PROBE §3.1d).
//
// This is a SEPARATE pin from the per-class pairs above on purpose. It is the form the concern
// actually takes in the field, it was invisible to the pure rule's table — which sees one failure
// at a time and cannot express "one probe result applied to N tests" — and it survived 44/44 green
// tests and a deep review.
//
// `classifyRootCause`'s `environment` arms `baselineProbe.error !== undefined` and
// `baselineProbe.status >= 500` fire BEFORE any per-test signal and depend on nothing about the
// individual test. One down staging dependency therefore classified 6 of 6 members as
// `environment`; each crossed its own 3-in-5 independently; the result was 6 `entered` lines under
// one shared 30-day deadline — a whole suite blanket-green off three red builds.
//
// THE BOUNDARY THIS PIN DOES NOT CLAIM. The producer gate closes the MEASURED mass event, because
// the arms that produce it are floor arms. It does NOT make mass quarantine impossible in general:
// six tests carrying AUTHORED `environment` verdicts still enter, and that is correct — an authored
// verdict is a statement about each test, not one probe result applied to all of them. The
// accept-direction leg below asserts exactly that, so the pin cannot be misread as the stronger
// claim.
describe('one down dependency cannot blanket-quarantine a suite (390-16)', () => {
  const SUITE_SIZE = 6

  /** N distinct failing members in ONE run — distinct TESTS, one shared failure signature. */
  function suiteHandoff(input: {
    runId: string
    buildOrdinal: number
    verdict: FoldVerdictSpec
  }): CompletedRunHandoff {
    const member = (index: number) => ({
      testId: `${input.runId}-${String(index)}`,
      testName: `${TEST_NAME} ${String(index)}`,
      filePath: `suite/member-${String(index)}.test.ts`,
      testIndex: index,
      outcome: 'failed',
      steps: [{
        ...failingStep(),
        // MEASURED note, verified against the committed bytes rather than assumed: the error-text
        // normalizer scrubs digits, so `(member 0)`…`(member 5)` collapse to ONE fingerprint. That
        // is faithful, not a fixture accident — a down dependency produces the same failure
        // signature on every member, which is what the 6/6 event looked like. Six distinct
        // ENTRIES still result, because a quarantine entry is keyed on test identity
        // (product, filePath, testName) while recurrence is keyed on (product, fingerprint).
        verifierVerdict: { pass: false, reasoning: `${ERROR_TEXT} (member ${String(index)})` },
      } as unknown as StepEvidence],
      rootCause: verdictFor(input.verdict, index),
    } as unknown as PerTestOutcome)
    return {
      schemaVersion: 6,
      runId: input.runId,
      buildOrdinal: input.buildOrdinal,
      scope: SHOP_SCOPE,
      executionContext: 'ci',
      aggregateVerdict: 'failed',
      configDigests: {
        suiteConfigDigest: 'detection-suite-digest',
        testConfigDigest: 'detection-test-digest',
      },
      startedAt: input.buildOrdinal * 1_000,
      endedAt: input.buildOrdinal * 1_000 + 1,
      tests: Array.from({ length: SUITE_SIZE }, (_unused, index) => member(index)),
    } as unknown as CompletedRunHandoff
  }

  function crossWholeSuite(
    env: FoldHarness,
    label: string,
    verdict: FoldVerdictSpec,
  ): FoldRunOutcomesReport {
    let last: FoldRunOutcomesReport | undefined
    for (const buildOrdinal of [1, 2, 3]) {
      last = fold(env, suiteHandoff({
        runId: `run-mass-${label}-${String(buildOrdinal)}`,
        buildOrdinal,
        verdict,
      }))
    }
    if (last === undefined) throw new Error('no fold ran')
    return last
  }

  it('writes ZERO entered lines for six floor-produced environment failures', () => {
    const env = harness('agent-qa-mass-floor')

    // PRODUCED: six members each scripted with a connect failure — one down dependency, which is
    // exactly the shape the measured 6-of-6 event took.
    const report = crossWholeSuite(env, 'floor', { produced: connectFailureResult() })

    expect(report.kind).toBe('applied')
    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toEqual([])

    // All six are LOUD, and every one of them genuinely crossed — a zero that came from six
    // sub-threshold windows would prove nothing about the gate.
    const escalated = report.quarantine.escalatedNotQuarantined
    expect(escalated).toHaveLength(SUITE_SIZE)
    for (const sighting of escalated) {
      expect(sighting.verdictClass).toBe('environment')
      expect(sighting.producer).toBe('deterministic-classifier')
      expect(sighting.occurrenceOrdinals).toBe(QUARANTINE_ESCALATE_THRESHOLD)
    }
    // Nothing suppresses anything: the whole suite still fails the next build.
    expect(foldQuarantineLedgerState(readQuarantineLedger(env.knowledgeRoot).events, NOW))
      .toEqual([])
  })

  it('writes SIX entered lines for the same six failures once analyze-run authored them', () => {
    const env = harness('agent-qa-mass-authored')

    const report = crossWholeSuite(env, 'authored', { authored: 'environment' })

    if (report.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.escalatedNotQuarantined).toEqual([])
    expect(report.quarantine.events).toHaveLength(SUITE_SIZE)

    const lines = ledgerLines(env)
    expect(lines).toHaveLength(SUITE_SIZE)
    expect(lines.map((line) => line.testName).sort()).toEqual(
      Array.from({ length: SUITE_SIZE }, (_unused, index) => `${TEST_NAME} ${String(index)}`).sort(),
    )
    // The measured event's signature: one shared 30-day deadline across the whole suite. The
    // fixture is genuinely capable of mass-quarantining, so the zero above is the gate's doing.
    expect(new Set(lines.map((line) => line.expiresAt))).toEqual(new Set([EXPECTED_EXPIRY]))
    expect(new Set(lines.map((line) => line.verdictClass))).toEqual(new Set(['environment']))
  })
})
