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

function rootCause(verdictClass: VerdictClass, perTest = 0): Verdict {
  return {
    class: verdictClass,
    producer: 'deterministic-classifier',
    confidence: 0.6,
    evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: ERROR_TEXT },
    memoryMisdirectionRuledOut: false,
    perTest,
  } as Verdict
}

function handoffFixture(input: {
  runId: string
  buildOrdinal: number
  passed?: boolean
  verdictClass?: VerdictClass
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
      ...(passed ? {} : { rootCause: rootCause(input.verdictClass ?? 'flake') }),
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
    rootCause: rootCause(verdictClass, index),
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
  verdictClass?: VerdictClass
  testName?: string
  filePath?: string
  policy?: GuardrailPolicy
} = {}): FoldRunOutcomesReport {
  let last: FoldRunOutcomesReport | undefined
  for (const buildOrdinal of [1, 2, 3]) {
    last = fold(env, handoffFixture({
      runId: `run-${opts.testName ?? 'default'}-${String(buildOrdinal)}`,
      buildOrdinal,
      ...(opts.verdictClass === undefined ? {} : { verdictClass: opts.verdictClass }),
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

  it('does not release an entry whose deadline has already lapsed', () => {
    const env = harness('agent-qa-detect-exit-expired')
    appendQuarantineEvents(
      env.knowledgeRoot,
      [enteredEvent({ expiresAt: '2026-07-10T12:00:00.000Z' })],
      { auditBaseDir: env.auditBaseDir },
    )

    let report: FoldRunOutcomesReport | undefined
    for (const buildOrdinal of [1, 2, 3, 4, 5]) {
      report = fold(env, handoffFixture({
        runId: `run-lapsed-${String(buildOrdinal)}`,
        buildOrdinal,
        passed: true,
      }))
    }

    if (report?.quarantine.kind !== 'evaluated') throw new Error('expected an evaluation')
    expect(report.quarantine.events).toEqual([])
    expect(ledgerLines(env)).toHaveLength(1)
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
