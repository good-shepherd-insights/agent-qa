// The phase's headline story, executable: in, visibly suppressed, auto-out, honest again — and
// never a silent forever (Phase 390, FLAK-02 / FLAK-03, CONTEXT "Specific Ideas").
//
// Eight runs against ONE knowledge root, driving the REAL machinery at every hop:
//
//   - the run-start snapshot        `resolveRunQuarantineSnapshot` over the committed ledger (D-16)
//   - the aggregate verdict rule    `deriveAggregateVerdict` + `mapVerdictToExitCode` (D-14)
//   - both reporters                the real JUnit document and the real console bytes (D-15)
//   - the post-run fold             `LOCAL_CURATION_CAPABILITIES.foldRunOutcomes` — real sqlite,
//                                   real projection, real detection, real ledger append (D-08)
//
// Nothing here is stubbed except the browser: member outcomes are scripted, because the phenomenon
// under test is what the SYSTEM does with a sequence of pass/fail results, not how a test fails.
//
// TWO LAWS THIS FILE OBEYS
//
//  1. EVERY HOP IS ID-ADDRESSED AND TWO-SIDED (the 388 contract law). Each transition asserts the
//     ledger BEFORE and AFTER by runId/ordinal, reading the real `quarantine.jsonl` bytes rather
//     than inheriting a conclusion from the previous assertion. `released-auto` is pinned ABSENT
//     after the fourth passing ordinal and PRESENT after the fifth, so the threshold is a
//     measurement and not a coincidence.
//
//  2. RUN A'S OWN FAILURE IS PINNED, NOT TOLERATED. Detection is one run behind BY DESIGN
//     (D-08 + D-16): the crossing is computed in the post-run fold, and the disposition is read at
//     the NEXT run's start. So the run that crosses still fails honestly. That red is the timing
//     law holding, and a change that "fixed" it would have quarantine relieving its own crossing —
//     which is how a real regression gets silenced by the build that discovers it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMaskingContext } from '@vostride/agent-qa-safety'
import { invokeFunction } from '@vostride/agent-qa-agent'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  asRef,
  exercisedAnchors,
  quarantineAppliesToTest,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ElementInfo,
  FunctionCaller,
  MemberTestOutcome,
  PerTestOutcome,
  QuarantineAppliedEntry,
  RunEventEnvelope,
  RunEventType,
  RunStatus,
  ScreenState,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import {
  LOCAL_CURATION_CAPABILITIES,
  composeLocalAgent,
  resolveRunQuarantineSnapshot,
} from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import { deriveAggregateVerdict, mapVerdictToExitCode } from '@vostride/agent-qa-runner'
import { afterEach, describe, expect, it } from 'vitest'

import { createConsoleReporter, QUARANTINE_TEST_ANNOTATION } from '../reporters/console-reporter.js'
import { JUNIT_QUARANTINE_MARKER_BLOCK, createJunitReporter } from '../reporters/junit-reporter.js'

// The committed ledger's path is spelled here as a LITERAL rather than imported from the package
// that owns it: this suite is asserting on the artifact a human will find in their repository, and
// a constant imported from the writer would move with the writer and keep every assertion green.
const QUARANTINE_LEDGER_FILE = 'quarantine.jsonl'

const PRODUCT = 'shop-web'
const FILE_PATH = 'tests/checkout.yaml'
const TEST_NAME = 'checkout completes the payment sheet'
const ANCHOR_NAME = 'pay now'

/** The run-start instant every run in the A..H timeline is driven at. */
const NOW = '2026-08-05T12:00:00.000Z'
/** `NOW` + QUARANTINE_DEFAULT_EXPIRY_DAYS (30), which is what the ledger must stamp. */
const EXPECTED_EXPIRY = '2026-09-04T12:00:00.000Z'

const CALLER: FunctionCaller = { surface: 'cli', grantedScopes: ['read'], safeMode: false }

interface LedgerLine {
  kind: string
  product: string
  filePath: string
  testName: string
  owner?: string
  expiresAt?: string
  reason?: string
}

const roots: string[] = []
const hosts: LocalAgentHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close?.()
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ---- fixture shapes ---------------------------------------------------------------------------

/**
 * One failing step carrying a real anchor through the PRODUCTION extractor (`exercisedAnchors`).
 *
 * The evidence shape is what makes the failure fingerprint real: the same anchor + step text + error
 * across runs is what lets `fingerprintRecurrence` count three occurrences of ONE failure rather
 * than three unrelated reds.
 */
function failingStep(buildOrdinal: number): StepEvidence {
  const element: ElementInfo = {
    ref: asRef('e1'),
    role: 'button',
    name: ANCHOR_NAME,
    nameNormalized: ANCHOR_NAME,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
  const stateBefore: ScreenState = {
    platform: 'web',
    tree: '',
    elements: [element],
    refMap: {},
    url: '/checkout',
    timestamp: 1,
    metadata: {
      coordSpace: 'viewport',
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
      captureMode: 'textOnly',
    },
  }
  return {
    stepIndex: 0,
    stepText: `click the ${ANCHOR_NAME} button`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: PRODUCT },
      asOfBuild: buildOrdinal,
      budget: 0,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'lifecycle-brief-digest',
    },
    subActions: [{
      plan: `click ${ANCHOR_NAME}`,
      plannedAction: { type: 'click', ref: element.ref },
      stateBefore,
      result: { success: false, error: `Error: element "${ANCHOR_NAME}" not found` },
    }],
    verifierVerdict: { pass: false, reasoning: `the ${ANCHOR_NAME} button never appeared` },
  } as unknown as StepEvidence
}

function flakeVerdict(): Verdict {
  return {
    class: 'flake',
    producer: 'deterministic-classifier',
    confidence: 0.6,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: `the ${ANCHOR_NAME} button never appeared`,
    },
    memoryMisdirectionRuledOut: false,
    perTest: 0,
  } as Verdict
}

interface RunScript {
  runId: string
  buildOrdinal: number
  outcome: Extract<MemberTestOutcome, 'passed' | 'failed'>
}

function handoffFor(
  script: RunScript,
  quarantined: readonly QuarantineAppliedEntry[],
  memberQuarantined: boolean,
): CompletedRunHandoff {
  const failed = script.outcome === 'failed'
  const member = {
    testId: `${script.runId}-checkout`,
    testName: TEST_NAME,
    filePath: FILE_PATH,
    testIndex: 0,
    outcome: script.outcome,
    steps: failed ? [failingStep(script.buildOrdinal)] : [],
    ...(failed ? { rootCause: flakeVerdict() } : {}),
    // 390 D-14: the disposition rides BESIDE the outcome, which stays truthful.
    ...(memberQuarantined ? { quarantined: true as const } : {}),
  } as unknown as PerTestOutcome
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: script.runId as CompletedRunHandoff['runId'],
    buildOrdinal: script.buildOrdinal,
    scope: { tier: 'product', key: PRODUCT },
    executionContext: 'ci',
    aggregateVerdict: failed ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: script.buildOrdinal * 1_000,
    endedAt: script.buildOrdinal * 1_000 + 1,
    tests: [member],
    // D-16: what the run was operating under, copied from the snapshot it was handed.
    ...(quarantined.length > 0 ? { quarantineApplied: quarantined } : {}),
  } as unknown as CompletedRunHandoff
}

/** The bus stream a real run of this one member would publish. */
function envelopesFor(script: RunScript, aggregate: RunStatus): RunEventEnvelope[] {
  let seq = 0
  const env = <P>(type: RunEventType, payload: P): RunEventEnvelope =>
    ({ seq: ++seq, ts: 1_000 + seq, runId: script.runId, type, payload }) as RunEventEnvelope
  const failed = script.outcome === 'failed'
  return [
    env('runStarted', {
      busSchemaVersion: 1,
      scope: { tier: 'product', key: PRODUCT },
      executionContext: 'ci',
      buildOrdinal: script.buildOrdinal,
      configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
      memberTestCount: 1,
    }),
    env('testStarted', {
      testId: `${script.runId}-checkout`,
      testIndex: 0,
      name: TEST_NAME,
      filePath: FILE_PATH,
      totalSteps: 1,
    }),
    env('stepStarted', { testIndex: 0, stepIndex: 0, stepText: `click the ${ANCHOR_NAME} button` }),
    env('stepFinalized', {
      testIndex: 0,
      stepIndex: 0,
      cacheStatus: 'miss',
      verifierVerdict: { pass: !failed, reasoning: 'checkout' },
      selfHealOccurred: false,
      briefDigest: 'lifecycle-brief-digest',
      status: failed ? 'failed' : 'passed',
      durationMs: 1_200,
      ...(failed ? { error: `Error: element "${ANCHOR_NAME}" not found` } : {}),
    }),
    env('testFinished', {
      testId: `${script.runId}-checkout`,
      testIndex: 0,
      outcome: script.outcome,
      durationMs: 1_500,
      ...(failed ? { failureSummary: `${ANCHOR_NAME} never appeared` } : {}),
    }),
    env('runFinished', { aggregateVerdict: aggregate, disposition: 'detached', finalSeq: seq }),
  ]
}

// ---- the harness ------------------------------------------------------------------------------

interface Harness {
  root: string
  agentQaRoot: string
  knowledgeRoot: string
}

function harness(prefix: string): Harness {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const knowledgeRoot = join(root, 'knowledge')
  mkdirSync(agentQaRoot, { recursive: true })
  mkdirSync(knowledgeRoot, { recursive: true })
  return { root, agentQaRoot, knowledgeRoot }
}

function ledgerLines(env: Harness): LedgerLine[] {
  const path = join(env.knowledgeRoot, QUARANTINE_LEDGER_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerLine)
}

interface DrivenRun {
  runId: string
  buildOrdinal: number
  /** What the ledger licensed for THIS run, read once before any member could execute (D-16). */
  snapshotAtStart: readonly QuarantineAppliedEntry[]
  memberQuarantined: boolean
  aggregate: RunStatus
  exitCode: number
  junitXml: string
  consoleOutput: string
  ledgerBefore: LedgerLine[]
  ledgerAfter: LedgerLine[]
}

/**
 * One whole run, start to fold, through the production path at every hop.
 *
 * The ORDER matters and mirrors `run.ts`: the snapshot is resolved BEFORE the member executes, the
 * verdict is derived from the snapshot the run started with, and the fold — which is where a new
 * crossing is detected — happens strictly AFTER the exit code is decided. That ordering is what
 * makes detection one run behind, and it is reproduced here rather than assumed.
 */
async function driveRun(env: Harness, script: RunScript, now = NOW): Promise<DrivenRun> {
  const ledgerBefore = ledgerLines(env)

  // (1) run start — fold the committed ledger ONCE
  const snapshotAtStart = resolveRunQuarantineSnapshot({
    knowledgeRoot: env.knowledgeRoot,
    product: PRODUCT,
    now,
  })
  const memberQuarantined = quarantineAppliesToTest(snapshotAtStart, {
    filePath: FILE_PATH,
    testName: TEST_NAME,
  })

  // (2) the aggregate verdict rule and the exit code it freezes
  const aggregate = deriveAggregateVerdict({
    runCancelled: false,
    runBudgetExpired: false,
    outcomes: [script.outcome],
    quarantined: [memberQuarantined],
  })
  const exitCode = mapVerdictToExitCode(aggregate)

  // (3) both reporters, over the run's real envelope stream
  const envelopes = envelopesFor(script, aggregate)
  let junitXml = ''
  const junit = createJunitReporter({
    outputPath: join(env.root, `junit-${script.runId}.xml`),
    write: async (_path, content) => { junitXml = content },
    quarantined: snapshotAtStart,
  })
  const consoleChunks: string[] = []
  const consoleReporter = createConsoleReporter(createMaskingContext(), {
    plain: true,
    colorize: false,
    isTTY: false,
    write: (chunk) => consoleChunks.push(chunk),
    quarantined: snapshotAtStart,
  })
  for (const envelope of envelopes) {
    junit.handler(envelope)
    consoleReporter.handler(envelope)
  }
  await junit.flush()

  // (4) the durable handoff a later surface reads
  const handoff = handoffFor(script, snapshotAtStart, memberQuarantined)
  const runDir = join(env.agentQaRoot, RUNS_SUBDIR, slugBranch(script.runId))
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'handoff.json'), `${JSON.stringify(handoff)}\n`, 'utf8')

  // (5) the post-run fold — where THIS run's outcome enters the window and detection runs
  LOCAL_CURATION_CAPABILITIES.foldRunOutcomes({
    knowledgeRoot: env.knowledgeRoot,
    handoff,
    extractAnchors: exercisedAnchors,
    quarantine: { now, auditBaseDir: env.agentQaRoot },
  })

  return {
    runId: script.runId,
    buildOrdinal: script.buildOrdinal,
    snapshotAtStart,
    memberQuarantined,
    aggregate,
    exitCode,
    junitXml,
    consoleOutput: consoleChunks.join(''),
    ledgerBefore,
    ledgerAfter: ledgerLines(env),
  }
}

// ---- the signature differential: runs A..H ----------------------------------------------------

describe('the quarantine lifecycle, end to end (FLAK-02 / FLAK-03)', () => {
  it('runs A..H: in at the crossing, suppressed-but-visible, auto-out after 5, honest again', async () => {
    const env = harness('agent-qa-390-lifecycle-')

    // --- ordinals 1 and 2: the failure recurs, below the escalate threshold ---------------------
    const pre1 = await driveRun(env, { runId: 'run-lifecycle-1', buildOrdinal: 1, outcome: 'failed' })
    expect(pre1.ledgerBefore).toEqual([])
    expect(pre1.ledgerAfter).toEqual([])
    expect(pre1.exitCode).toBe(1)

    const pre2 = await driveRun(env, { runId: 'run-lifecycle-2', buildOrdinal: 2, outcome: 'failed' })
    // D-06: two occurrences FLAG (visibility only) and write not one byte of ledger
    expect(pre2.ledgerBefore).toEqual([])
    expect(pre2.ledgerAfter).toEqual([])
    expect(pre2.exitCode).toBe(1)

    // --- RUN A (ordinal 3): the crossing. Enters the ledger, and STILL FAILS -------------------
    const runA = await driveRun(env, { runId: 'run-lifecycle-A', buildOrdinal: 3, outcome: 'failed' })

    // before: nothing licensed this run's failure
    expect(runA.ledgerBefore).toEqual([])
    expect(runA.snapshotAtStart).toEqual([])
    expect(runA.memberQuarantined).toBe(false)
    // THE TIMING LAW: the run that discovers the flake fails honestly (D-08 + D-16)
    expect(runA.aggregate).toBe('failed')
    expect(runA.exitCode).toBe(1)
    expect(runA.junitXml).toContain('<failure')
    expect(runA.junitXml).not.toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
    expect(runA.consoleOutput).not.toContain(QUARANTINE_TEST_ANNOTATION)
    // after: the entry exists, unassigned, with a stamped deadline
    expect(runA.ledgerAfter).toHaveLength(1)
    expect(runA.ledgerAfter[0]).toMatchObject({
      kind: 'entered',
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
    })

    // --- RUN B (ordinal 4): fails again, and the build goes GREEN ------------------------------
    const runB = await driveRun(env, { runId: 'run-lifecycle-B', buildOrdinal: 4, outcome: 'failed' })

    // before: the entry run A wrote is exactly what run B started under
    expect(runB.ledgerBefore).toEqual(runA.ledgerAfter)
    expect(runB.snapshotAtStart).toEqual([{
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      expiresAt: EXPECTED_EXPIRY,
    }])
    expect(runB.memberQuarantined).toBe(true)
    // the member outcome is untouched; the AGGREGATE is what the disposition changed
    expect(runB.aggregate).toBe('passed')
    expect(runB.exitCode).toBe(0)
    // D-15: the correct amount of red on a green build
    expect(runB.junitXml).toContain('<failure')
    expect(runB.junitXml).toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
    expect(runB.junitXml).toContain('failures="1"')
    expect(runB.junitXml).not.toContain('<skipped')
    expect(runB.consoleOutput).toContain(`FAIL ${TEST_NAME} 1s ${QUARANTINE_TEST_ANNOTATION}`)
    expect(runB.consoleOutput).toContain('Tests:  0 of 1 passed · 1 quarantined failure')
    // after: suppression writes nothing — the entry is already open (D-10 re-entry suppression)
    expect(runB.ledgerAfter).toEqual(runB.ledgerBefore)

    // --- RUNS C..G (ordinals 5..9): five consecutive passing ordinals --------------------------
    const passing: DrivenRun[] = []
    for (const [index, buildOrdinal] of [5, 6, 7, 8, 9].entries()) {
      passing.push(await driveRun(env, {
        runId: `run-lifecycle-${'CDEFG'[index]!}`,
        buildOrdinal,
        outcome: 'passed',
      }))
    }
    const [runC, runD, runE, runF, runG] = passing as [
      DrivenRun, DrivenRun, DrivenRun, DrivenRun, DrivenRun,
    ]

    // the entry stays open through all four sub-threshold passes — asserted at EVERY hop, not
    // only at the boundary, so "released only at 5" is a measurement and not a single sample
    for (const run of [runC, runD, runE, runF]) {
      expect(run.exitCode).toBe(0)
      expect(run.ledgerAfter.map((line) => line.kind)).toEqual(['entered'])
    }
    // D-10's boundary, one step either side: NOT after the fourth passing ordinal…
    expect(runF.ledgerAfter.some((line) => line.kind === 'released-auto')).toBe(false)
    // …and released after the fifth
    expect(runG.ledgerBefore).toEqual(runF.ledgerAfter)
    expect(runG.ledgerAfter).toHaveLength(2)
    expect(runG.ledgerAfter[1]).toMatchObject({
      kind: 'released-auto',
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
    })

    // --- RUN H (ordinal 10): fails after release — the build reds again ------------------------
    const runH = await driveRun(env, { runId: 'run-lifecycle-H', buildOrdinal: 10, outcome: 'failed' })

    expect(runH.ledgerBefore).toEqual(runG.ledgerAfter)
    // the released entry licenses nothing: the exit path is real, not decorative
    expect(runH.snapshotAtStart).toEqual([])
    expect(runH.memberQuarantined).toBe(false)
    expect(runH.aggregate).toBe('failed')
    expect(runH.exitCode).toBe(1)
    expect(runH.junitXml).toContain('<failure')
    expect(runH.junitXml).not.toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
    expect(runH.consoleOutput).not.toContain(QUARANTINE_TEST_ANNOTATION)
    expect(runH.consoleOutput).toContain('Tests:  0 of 1 passed\n')
  }, 120_000)
})

// ---- the expiry forcing function --------------------------------------------------------------
//
// D-11's whole point: an entry can never silently suppress forever. Both consequences of ONE lapsed
// deadline are pinned against the SAME ledger file — the run fails again, and the sentence a human
// reads says why. Either one alone would leave the other free to drift.

describe('the expiry forcing function (D-11)', () => {
  // The crossing is driven at a `now` far enough in the past that the stamped 30-day deadline is
  // already behind BOTH the injected run-start instant and the composition's real system clock.
  const PAST_NOW = '2026-06-01T12:00:00.000Z'
  const LAPSED_EXPIRY = '2026-07-01T12:00:00.000Z'

  it('a lapsed deadline fails the run again AND reads as expired in the sentence', async () => {
    const env = harness('agent-qa-390-expiry-')

    // three failing ordinals at the past instant → an entry that expires 2026-07-01
    for (const buildOrdinal of [1, 2, 3]) {
      await driveRun(
        env,
        { runId: `run-expiry-${String(buildOrdinal)}`, buildOrdinal, outcome: 'failed' },
        PAST_NOW,
      )
    }
    const entered = ledgerLines(env)
    expect(entered).toHaveLength(1)
    expect(entered[0]).toMatchObject({ kind: 'entered', expiresAt: LAPSED_EXPIRY })

    const host = composeLocalAgent({
      agentQaRoot: env.agentQaRoot,
      config: { getMasked: () => Promise.reject(new Error('no config in this fixture')) },
      knowledgeRoot: () => env.knowledgeRoot,
      model: () => { throw new Error('no model in this fixture') },
    })
    hosts.push(host)
    const sentenceFor = async (runId: string): Promise<string> => {
      const answer = await invokeFunction(
        host.registry, 'analysis.get', { runId }, CALLER,
      ) as { sentences: readonly { sentence: string }[] }
      return answer.sentences[0]?.sentence ?? ''
    }

    // CONSEQUENCE 1 — the sentence says the suppression has lapsed, read from THESE ledger bytes.
    // The deadline is quoted so the reader knows which fact changed, and the clause spells out what
    // it means for them: failures count again.
    expect(await sentenceFor('run-expiry-3'))
      .toContain('quarantine expired Jul 1 — failures count again')

    // CONSEQUENCE 2 — the same lapsed entry stops suppressing. The run-start snapshot EXCLUDES an
    // expired entry, so the test that was green-listed is red again with no ledger edit at all: the
    // forcing function is a consequence of the deadline passing, never of anyone acting.
    const afterLapse = await driveRun(
      env,
      { runId: 'run-expiry-lapsed', buildOrdinal: 4, outcome: 'failed' },
      NOW,
    )
    expect(afterLapse.snapshotAtStart).toEqual([])
    expect(afterLapse.memberQuarantined).toBe(false)
    expect(afterLapse.aggregate).toBe('failed')
    expect(afterLapse.exitCode).toBe(1)
    expect(afterLapse.junitXml).toContain('<failure')
    expect(afterLapse.junitXml).not.toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
    expect(afterLapse.consoleOutput).not.toContain(QUARANTINE_TEST_ANNOTATION)

    // …and the honest red is what expiry BUYS: one failing build, not a permanent stop. That run's
    // own fold sees a still-crossed window and RE-ENTERS with a fresh deadline (390-05's accepted
    // re-entry shape; D-10's "re-entry needs no special rule"). Pinned rather than tolerated: the
    // repeated `entered` lines ARE the history D-03 chose an event log to keep, and a reader of the
    // committed file must be able to tell a re-entry from a duplicate.
    const afterReentry = ledgerLines(env)
    expect(afterReentry.map((line) => line.kind)).toEqual(['entered', 'entered'])
    expect(afterReentry[0]).toMatchObject({ kind: 'entered', expiresAt: LAPSED_EXPIRY })
    expect(afterReentry[1]).toMatchObject({
      kind: 'entered',
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
    })
    // nothing was released: an expired entry is a visible state, never a deletion (D-11)
    expect(afterReentry.some((line) => line.kind.startsWith('released'))).toBe(false)

    // The differential closes on ONE surface: the SAME accessor over the SAME ledger file now reads
    // the other arm. Two readings of one live computation, which is what makes the expired clause a
    // fact about the ledger rather than a string somebody remembered to print.
    expect(await sentenceFor('run-expiry-3')).toContain('quarantined until Sep 4')
    expect(await sentenceFor('run-expiry-3')).not.toContain('quarantine expired')
  }, 120_000)
})
