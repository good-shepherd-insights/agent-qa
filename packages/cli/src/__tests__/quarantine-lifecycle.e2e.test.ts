// The phase's headline story, executable: in, visibly suppressed, auto-out, honest again — and
// never a silent forever (Phase 390, FLAK-02 / FLAK-03, CONTEXT "Specific Ideas").
//
// Eight runs against ONE knowledge root, driving the REAL machinery at every hop:
//
//   - the run-start snapshot        `resolveRunQuarantineSnapshot` over the committed ledger (D-16)
//   - the run itself                the real `startRun` member loop over production-shape
//                                   descriptors, which is where the disposition decides whether
//                                   OTHER tests run (390-10 / CR-01) — the aggregate and the exit
//                                   code are read off that session, never computed beside it
//   - both reporters                the real JUnit document and the real console bytes (D-15)
//   - the post-run fold             `LOCAL_CURATION_CAPABILITIES.foldRunOutcomes` — real sqlite,
//                                   real projection, real detection, real ledger append (D-08)
//
// Nothing here is stubbed except the browser: member outcomes are scripted, because the phenomenon
// under test is what the SYSTEM does with a sequence of pass/fail results, not how a test fails.
//
// THREE LAWS THIS FILE OBEYS
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
//
//  3. THE VERDICT LEG CROSSES THE MEMBER LOOP (390-10, closing CR-01). Every hop drives `startRun`
//     over TWO same-group members — the tracked test plus a sibling — because a one-member run
//     cannot observe the fail-fast poisoning at all, and computing the aggregate BESIDE the shell
//     (which is what this file did until 390-10) leaves the loop where the poisoning lives
//     unexercised at all eight hops. `executed` is asserted in both directions: an un-licensed
//     failure still fail-fasts its sibling (run A, run H), a licensed one does not (run B). The
//     anti-silencing direction — a licensed failure in front of a genuinely failing, UN-licensed
//     sibling — has its own pin at the bottom of this file, because it is the direction that turns
//     a red build green and an execution-only assertion would not catch it.

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
import { mapVerdictToExitCode, startRun } from '@vostride/agent-qa-runner'
import type { RunConfig, RunMemberDescriptor, TestResult } from '@vostride/agent-qa-runner'
import { afterEach, describe, expect, it } from 'vitest'

import { createConsoleReporter, QUARANTINE_TEST_ANNOTATION } from '../reporters/console-reporter.js'
import { JUNIT_QUARANTINE_MARKER_BLOCK, createJunitReporter } from '../reporters/junit-reporter.js'

/**
 * The composition's REQUIRED quarantine identity mint (390-12 / D-01). Passthrough here: this
 * fixture already speaks canonical workspace-relative bytes, and the recipe itself stays pinned
 * in core's `workspace-paths.test.ts` — what these hosts exercise is everything BUT quarantine.
 */
const MINT_IDENTITY = (filePath: string): string => filePath

// The committed ledger's path is spelled here as a LITERAL rather than imported from the package
// that owns it: this suite is asserting on the artifact a human will find in their repository, and
// a constant imported from the writer would move with the writer and keep every assertion green.
const QUARANTINE_LEDGER_FILE = 'quarantine.jsonl'

const PRODUCT = 'shop-web'
const FILE_PATH = 'tests/checkout.yaml'
const TEST_NAME = 'checkout completes the payment sheet'
const ANCHOR_NAME = 'pay now'

/**
 * The suite this run's members belong to.
 *
 * `cli/src/commands/run.ts:1961` sets `failFastGroup: prepared.suiteKey` on EVERY member of every
 * suite, unconditionally — so a real suite run always has a shared group, and a fixture without one
 * is drawn from outside the shape production ever produces. Both members below carry it.
 */
const SUITE_GROUP = 'tests/checkout.suite.yaml'

/**
 * A second test in the SAME suite as the tracked one — never quarantined, never folded into the
 * projection. It exists so the member loop is non-degenerate: with one member there is nothing
 * behind the tracked test for a poisoned group to skip, and the whole CR-01 defect class is
 * unobservable.
 */
const SIBLING_FILE_PATH = 'tests/login.yaml'
const SIBLING_TEST_NAME = 'login accepts a returning customer'

const TRACKED_MEMBER: RunMemberDescriptor = {
  testId: 'checkout',
  testIndex: 0,
  name: TEST_NAME,
  filePath: FILE_PATH,
  failFastGroup: SUITE_GROUP,
}

const SIBLING_MEMBER: RunMemberDescriptor = {
  testId: 'login',
  testIndex: 1,
  name: SIBLING_TEST_NAME,
  filePath: SIBLING_FILE_PATH,
  failFastGroup: SUITE_GROUP,
}

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

/** The runner-level result a scripted member answers with. */
function shellResult(testId: string, outcome: 'passed' | 'failed'): TestResult {
  return {
    name: testId,
    filePath: `${testId}.test.ts`,
    status: outcome,
    steps: [{
      name: `click the ${ANCHOR_NAME} button`,
      status: outcome,
      duration: 1,
      ...(outcome === 'failed' ? { error: `Error: element "${ANCHOR_NAME}" not found` } : {}),
    }],
    duration: 1,
  }
}

interface ShellLeg {
  aggregate: RunStatus
  exitCode: number
  /** The disposition the SHELL matched for the tracked member, read off its handoff. */
  memberQuarantined: boolean
  /** Which members the executor was actually reached for, in order. */
  executed: readonly string[]
}

/**
 * The run itself — `startRun` over the production descriptor shape (390-10, closing CR-01).
 *
 * This is the leg that used to be a direct `deriveAggregateVerdict` call sitting BESIDE the shell.
 * Computing the verdict from a scripted outcome answered the aggregate question correctly and asked
 * the member-loop question not at all: the fail-fast poisoning that decides whether the sibling ever
 * executes lives in the loop, and no hop crossed it. Now the aggregate, the exit code and the
 * per-member disposition all come off one real session, so a change to the loop is visible here.
 *
 * The run-start snapshot is passed as plain data exactly as `run.ts` passes it (D-16); the runner
 * gains no port for it.
 */
async function runThroughShell(
  script: RunScript,
  snapshotAtStart: readonly QuarantineAppliedEntry[],
  siblingOutcome: 'passed' | 'failed',
): Promise<ShellLeg> {
  const executed: string[] = []
  const session = startRun({
    runId: script.runId as RunConfig['runId'],
    scope: { tier: 'product', key: PRODUCT },
    executionContext: 'ci',
    buildOrdinal: script.buildOrdinal,
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    members: [TRACKED_MEMBER, SIBLING_MEMBER],
    executor: async (member) => {
      executed.push(member.testId)
      return shellResult(
        member.testId,
        member.testId === TRACKED_MEMBER.testId ? script.outcome : siblingOutcome,
      )
    },
    quarantined: snapshotAtStart,
  })
  const { verdict, handoff } = await session.done
  const tracked = handoff.tests.find((test) => test.testId === TRACKED_MEMBER.testId)
  return {
    aggregate: verdict,
    exitCode: mapVerdictToExitCode(verdict),
    memberQuarantined: tracked?.quarantined === true,
    executed,
  }
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
  /** Which members the run shell actually reached the executor for (390-10). */
  executed: readonly string[]
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
  // (2) THE RUN — the real member loop over production-shape descriptors. The aggregate, the exit
  //     code and the tracked member's disposition are all read off this one session rather than
  //     computed beside it, so the fail-fast poisoning decision is on every hop's path (390-10).
  //     The sibling passes here; the anti-silencing case gives it a failure of its own.
  const { aggregate, exitCode, memberQuarantined, executed } = await runThroughShell(
    script,
    snapshotAtStart,
    'passed',
  )

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
    executed,
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
    // …and because nothing licenses it, the failure poisons its suite group and the sibling behind
    // it never runs — pre-390 within-suite fail-fast (D-15), unchanged by the disposition guard
    expect(runA.executed).toEqual(['checkout'])
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
    // THE OTHER HALF OF FLAK-02 (390-10 / CR-01): the licensed failure changes the aggregate rule
    // and NOTHING ELSE. It does not poison its group, so the sibling behind it still runs. Compare
    // run A one hop above — identical members, identical group, opposite disposition, opposite
    // answer to "did the sibling execute".
    expect(runB.executed).toEqual(['checkout', 'login'])
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
      // nothing failed, so nothing poisoned: both members ran
      expect(run.executed).toEqual(['checkout', 'login'])
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
    // the exit path restored the fail-fast too: with no disposition, the failure poisons again
    expect(runH.executed).toEqual(['checkout'])
    expect(runH.junitXml).toContain('<failure')
    expect(runH.junitXml).not.toContain(JUNIT_QUARANTINE_MARKER_BLOCK)
    expect(runH.consoleOutput).not.toContain(QUARANTINE_TEST_ANNOTATION)
    expect(runH.consoleOutput).toContain('Tests:  0 of 1 passed\n')
  }, 120_000)
})

// ---- the anti-silencing direction (390-10, closing CR-01) --------------------------------------
//
// Runs A..H assert that a licensed failure lets its sibling EXECUTE. That is necessary and not
// sufficient: a build that runs the sibling and then swallows its failure would satisfy it. The
// property actually at risk is that an UN-licensed failure behind a licensed one still reaches the
// exit code — that is the inversion the verifier measured on 2026-08-05 (executed ["flaky"] only,
// verdict 'passed', exit 0, where pre-390 the same run exited 1).
//
// So this pin gives the sibling a real failure and asserts the aggregate and the exit code, over a
// ledger entry authored by the same detection ladder every other hop uses.

describe('a quarantined failure never silences an un-quarantined one (CR-01)', () => {
  it('the failing sibling runs AND fails the build at exit 1, behind a licensed failure', async () => {
    const env = harness('agent-qa-390-antisilencing-')

    // three failing ordinals — the same crossing runs A..H drive, through the same fold
    for (const buildOrdinal of [1, 2, 3]) {
      await driveRun(env, {
        runId: `run-silence-${String(buildOrdinal)}`,
        buildOrdinal,
        outcome: 'failed',
      })
    }
    // the committed ledger now licenses the tracked test, and only the tracked test
    const snapshotAtStart = resolveRunQuarantineSnapshot({
      knowledgeRoot: env.knowledgeRoot,
      product: PRODUCT,
      now: NOW,
    })
    expect(snapshotAtStart).toEqual([{
      product: PRODUCT,
      filePath: FILE_PATH,
      testName: TEST_NAME,
      expiresAt: EXPECTED_EXPIRY,
    }])

    // the next run: the licensed test fails again, and so does its un-licensed suite sibling
    const shell = await runThroughShell(
      { runId: 'run-silence-4', buildOrdinal: 4, outcome: 'failed' },
      snapshotAtStart,
      'failed',
    )

    // Asserted as ONE shape: execution without the verdict would pass on a build that runs the
    // sibling and swallows it, and the verdict without execution would pass on a build that
    // skipped the sibling and failed for some other reason.
    expect(shell).toEqual({
      executed: ['checkout', 'login'],
      memberQuarantined: true,
      aggregate: 'failed',
      exitCode: 1,
    })
  }, 120_000)
})

// ---- what the expiry lapse actually BUYS -------------------------------------------------------
//
// What D-11's lapse does, pinned against ONE ledger file: suppression stops, the run fails again,
// and the sentence a human reads says why. Either consequence alone would leave the other free to
// drift, so both are asserted here.
//
// What it does NOT do — though this block's earlier name claimed a mechanism that would have — is
// BOUND the suppression. Measured 2026-08-06: the lapse buys exactly
// ONE red build, and the same run that goes red re-suppresses itself, because the snapshot is taken
// at run start (entry lapsed ⇒ red) while the post-run fold immediately authors a fresh `entered`
// with a full new deadline. Nobody has to notice, decide, claim, renew or release anything. The
// multi-cycle characterization leg at the bottom of this block pins that loop directly.

describe('the expiry lapse: what one lapsed deadline buys (D-11)', () => {
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
      mintQuarantineIdentityPath: MINT_IDENTITY,
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
    // lapse is a consequence of the deadline passing, never of anyone acting. Which is also why it
    // bounds nothing — nobody is required to act for the suppression to come straight back.
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

    // …and the honest red is ALL the lapse buys: exactly one failing build. That run's own fold
    // sees a still-crossed window and RE-ENTERS with a fresh full-lifetime deadline (390-05's
    // accepted re-entry shape; D-10's "re-entry needs no special rule"), so the very next build is
    // green again with no human in the loop. Pinned rather than tolerated: the repeated `entered`
    // lines ARE the history D-03 chose an event log to keep, and a reader of the committed file
    // must be able to tell a re-entry from a duplicate. That the loop then repeats without
    // attenuation is the multi-cycle leg's business, below.
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

  // ---- CHARACTERIZATION: the loop, over four full cycles ---------------------------------------
  //
  // THIS LEG DOES NOT ASSERT THAT THE BEHAVIOUR IS DESIRABLE. It is a characterization pin: it
  // records what the shipped system does so that a later change to it must red a test rather than
  // pass unnoticed, and so that the corrected prose above SITE A/B/D has something enforcing it.
  // Plan 390-18 is the follow-on that makes this loop legible to a human — a re-entry counter on
  // the entry and a triage order that surfaces a test on its fourth lap differently from its
  // first. When a bound on the repetition is eventually chosen, it will be chosen against the
  // counter's evidence, and THIS is the baseline it starts from.
  //
  // The probe that produced it (390-UAT-DECISIONS-PROBE.md §4.1) is a document nobody can re-run.
  // These seven runs are the same measurement, committed and re-runnable, through the same real
  // `driveRun` path — real snapshot, real member loop, real fold, real ledger bytes.
  //
  // Three facts together say "unbounded, with no attenuation":
  //   N entered lines · N DISTINCT full-lifetime deadlines · ZERO released.
  // The zero is load-bearing in a way it was not before 390-17: the auto-exit now DOES admit a
  // lapsed window, so nothing releases here because the test never recovers — not because the exit
  // path cannot see the entry.
  describe('the loop it repeats, characterized over four cycles', () => {
    // One day past each preceding deadline, so every cycle starts on a genuinely lapsed entry.
    // Deadlines are hand-computed from QUARANTINE_DEFAULT_EXPIRY_DAYS = 30 so the constant is
    // pinned rather than re-derived by the assertion.
    const CYCLE_1_AT = '2026-01-05T12:00:00.000Z'
    const CYCLE_1_DEADLINE = '2026-02-04T12:00:00.000Z'
    const CYCLE_2_AT = '2026-02-05T12:00:00.000Z'
    const CYCLE_2_DEADLINE = '2026-03-07T12:00:00.000Z'
    /** One day INSIDE cycle 2's fresh window — the build right after the single red one. */
    const CYCLE_2_NEXT_DAY = '2026-02-06T12:00:00.000Z'
    const CYCLE_3_AT = '2026-03-08T12:00:00.000Z'
    const CYCLE_3_DEADLINE = '2026-04-07T12:00:00.000Z'
    const CYCLE_4_AT = '2026-04-08T12:00:00.000Z'
    const CYCLE_4_DEADLINE = '2026-05-08T12:00:00.000Z'

    it('re-enters on every lapse with a fresh deadline, releases nothing, and never attenuates', async () => {
      const env = harness('agent-qa-390-cycles-')

      // CYCLE 1 — the crossing. Three failing ordinals mint the first entry.
      for (const buildOrdinal of [1, 2, 3]) {
        await driveRun(
          env,
          { runId: `run-cycle1-${String(buildOrdinal)}`, buildOrdinal, outcome: 'failed' },
          CYCLE_1_AT,
        )
      }
      expect(ledgerLines(env)).toHaveLength(1)

      // CYCLE 2 — the deadline has lapsed. THE ONE RED BUILD: the run-start snapshot withholds
      // suppression, so the build fails…
      const lapsed = await driveRun(
        env,
        { runId: 'run-cycle2-lapsed', buildOrdinal: 4, outcome: 'failed' },
        CYCLE_2_AT,
      )
      expect(lapsed.snapshotAtStart).toEqual([])
      expect(lapsed.memberQuarantined).toBe(false)
      expect(lapsed.exitCode).toBe(1)

      // …and that SAME run's post-run fold re-suppressed it. The very next build — one day later,
      // no ledger edit by anyone, no human notified — is green again. That is the whole cost of a
      // lapse: exactly ONE red build, then the heartbeat resets.
      const dayAfter = await driveRun(
        env,
        { runId: 'run-cycle2-next', buildOrdinal: 5, outcome: 'failed' },
        CYCLE_2_NEXT_DAY,
      )
      expect(dayAfter.snapshotAtStart).toEqual([{
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        expiresAt: CYCLE_2_DEADLINE,
      }])
      expect(dayAfter.memberQuarantined).toBe(true)
      expect(dayAfter.exitCode).toBe(0)
      expect(dayAfter.ledgerAfter).toEqual(dayAfter.ledgerBefore)

      // CYCLES 3 and 4 — one lapsed build each. Nothing distinguishes them from cycle 2.
      for (const [buildOrdinal, at] of [[6, CYCLE_3_AT], [7, CYCLE_4_AT]] as const) {
        const cycle = await driveRun(
          env,
          { runId: `run-cycle-${String(buildOrdinal)}`, buildOrdinal, outcome: 'failed' },
          at,
        )
        expect(cycle.snapshotAtStart).toEqual([])
        expect(cycle.exitCode).toBe(1)
      }

      const lines = ledgerLines(env)

      // FACT 1 — four `entered` lines, and NOTHING was released. The exit path saw every one of
      // these lapsed entries (390-17) and correctly declined: the test never recovered.
      expect(lines.map((line) => line.kind)).toEqual(['entered', 'entered', 'entered', 'entered'])
      expect(lines.some((line) => line.kind.startsWith('released'))).toBe(false)

      // FACT 2 — four DISTINCT full-lifetime deadlines. Each re-entry MINTS one from its own
      // `now`; none is inherited, capped or shortened.
      const deadlines = lines.map((line) => line.expiresAt)
      expect(deadlines).toEqual([
        CYCLE_1_DEADLINE,
        CYCLE_2_DEADLINE,
        CYCLE_3_DEADLINE,
        CYCLE_4_DEADLINE,
      ])
      expect(new Set(deadlines).size).toBe(4)

      // FACT 3 — no attenuation: cycle 4's line is indistinguishable from cycle 2's in every field
      // except the two instants. Same unassigned owner, same identity, same event kind. There is
      // no lap counter, no escalation, no forced owner assignment — nothing that a reader of the
      // committed file could use to tell a test on its fourth lap from one on its first.
      for (const line of lines) {
        expect(line).toMatchObject({
          kind: 'entered',
          product: PRODUCT,
          filePath: FILE_PATH,
          testName: TEST_NAME,
          owner: QUARANTINE_UNASSIGNED_OWNER,
        })
      }
    }, 120_000)
  })
})
