// The one thing the committed ledger is committed FOR: quarantine state written on machine A
// suppresses on checkout B (Phase 390, CR-02 / D-01, FLAK-02).
//
// WHY THIS FILE EXISTS. `quarantine.jsonl` lives at the knowledge root and travels in git so a
// fresh CI checkout inherits the disposition. The match that decides whether it applies is an exact
// string compare on `(filePath, testName)`. Before 390-08 the `filePath` leg was the CLI's ABSOLUTE
// resolved path, so the bytes a ledger carried were bytes only the machine that wrote them could
// ever produce — the artifact was committed for an inheritance it structurally could not deliver,
// and no single-root fixture could see it, because under one root the absolute paths agree.
//
// THE SHAPE OF THE PIN (the 388 two-sided contract law). Both halves run through PRODUCTION code
// and they run under DIFFERENT temp roots:
//
//   writer half, under root A   real descriptors from `buildDirectRunMembers` -> a handoff ->
//                               `LOCAL_CURATION_CAPABILITIES.foldRunOutcomes`, three failing
//                               ordinals, until detection itself authors the `entered` event
//   the artifact travels        the committed file is COPIED to root B, the way git would deliver it
//   reader half, under root B   real descriptors minted under root B -> `resolveRunQuarantineSnapshot`
//                               -> `quarantineAppliesToTest`
//
// Neither half is handed the other's bytes. The assertions anchor OUTSIDE the code's own field
// relations — exact fixture strings, the exact schemaVersion number, and the ABSENCE of either
// temp-root prefix anywhere in the committed file — so "both sides agree" cannot be satisfied by
// two halves that are wrong in the same way.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseTestFile } from '@vostride/agent-qa-core'
import type { ParsedTestBinding } from '@vostride/agent-qa-core'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  exercisedAnchors,
  quarantineAppliesToTest,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ElementInfo,
  MemberTestOutcome,
  PerTestOutcome,
  QuarantineAppliedEntry,
  ScreenState,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import {
  LOCAL_CURATION_CAPABILITIES,
  resolveRunQuarantineSnapshot,
} from '@vostride/agent-qa-agent-local'
import { afterEach, describe, expect, it } from 'vitest'

import { buildDirectRunMembers } from '../commands/direct-run-members.js'

// Spelled as a literal rather than imported from the writer: this suite asserts on the artifact a
// human finds in their repository, and a constant imported from the writer would move with it.
const QUARANTINE_LEDGER_FILE = 'quarantine.jsonl'

const PRODUCT = 'shop-web'
/** The workspace-relative layout BOTH checkouts share. This string is the identity. */
const TEST_FILE_RELATIVE = 'tests/checkout.yaml'
const TEST_NAME = 'checkout completes the payment sheet'
const ANCHOR_NAME = 'pay now'

const NOW = '2026-08-05T12:00:00.000Z'
/** NOW + QUARANTINE_DEFAULT_EXPIRY_DAYS (30). */
const EXPECTED_EXPIRY = '2026-09-04T12:00:00.000Z'

const TEST_ID = 't_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'

const TEST_YAML = [
  `test-id: ${TEST_ID}`,
  `name: ${TEST_NAME}`,
  'target: storefront',
  'steps:',
  `  - click the ${ANCHOR_NAME} button`,
  '',
].join('\n')

const roots: string[] = []

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ---- two independent checkouts of the same workspace -------------------------------------------

interface Checkout {
  /** The config directory — the root every identity is relative to. */
  configDir: string
  knowledgeRoot: string
  agentQaRoot: string
  /** The absolute path of the member test file INSIDE this checkout. */
  absoluteTestFile: string
}

function checkout(prefix: string): Checkout {
  const configDir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(configDir)
  const knowledgeRoot = join(configDir, 'agent-qa-knowledge')
  const agentQaRoot = join(configDir, '.agent-qa')
  mkdirSync(knowledgeRoot, { recursive: true })
  mkdirSync(agentQaRoot, { recursive: true })
  const absoluteTestFile = join(configDir, 'tests', 'checkout.yaml')
  mkdirSync(join(configDir, 'tests'), { recursive: true })
  writeFileSync(absoluteTestFile, TEST_YAML, 'utf8')
  return { configDir, knowledgeRoot, agentQaRoot, absoluteTestFile }
}

/**
 * The member identity THIS checkout mints, through the production descriptor builder.
 *
 * This is the load-bearing hop: reverting `buildDirectRunMembers` to copy the binding's absolute
 * path is exactly the pre-390-08 defect, and it reds every assertion below.
 */
function mintedIdentity(env: Checkout): string {
  const parsed = parseTestFile(TEST_YAML, env.absoluteTestFile)
  expect(parsed.errors).toEqual([])
  const bindings: ParsedTestBinding[] = parsed.tests.map((test) => ({
    test,
    filePath: env.absoluteTestFile,
    fileContent: TEST_YAML,
  }))
  const { members } = buildDirectRunMembers(bindings, env.configDir)
  expect(members).toHaveLength(1)
  return members[0].filePath
}

// ---- fixture shapes (the lifecycle E2E's idiom, trimmed to one member) --------------------------

function failingStep(buildOrdinal: number): StepEvidence {
  const element: ElementInfo = {
    ref: 'e1' as ElementInfo['ref'],
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
      briefDigest: 'portability-brief-digest',
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

function handoffFor(input: {
  runId: string
  buildOrdinal: number
  outcome: Extract<MemberTestOutcome, 'passed' | 'failed'>
  /** The descriptor identity this run's checkout minted — never a literal. */
  filePath: string
  quarantined: readonly QuarantineAppliedEntry[]
}): CompletedRunHandoff {
  const failed = input.outcome === 'failed'
  const member = {
    testId: `${input.runId}-checkout`,
    testName: TEST_NAME,
    filePath: input.filePath,
    testIndex: 0,
    outcome: input.outcome,
    steps: failed ? [failingStep(input.buildOrdinal)] : [],
    ...(failed ? { rootCause: flakeVerdict() } : {}),
  } as unknown as PerTestOutcome
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: input.runId as CompletedRunHandoff['runId'],
    buildOrdinal: input.buildOrdinal,
    scope: { tier: 'product', key: PRODUCT },
    executionContext: 'ci',
    aggregateVerdict: failed ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: input.buildOrdinal * 1_000,
    endedAt: input.buildOrdinal * 1_000 + 1,
    tests: [member],
    ...(input.quarantined.length > 0 ? { quarantineApplied: input.quarantined } : {}),
  } as unknown as CompletedRunHandoff
}

function ledgerText(env: Checkout): string {
  const path = join(env.knowledgeRoot, QUARANTINE_LEDGER_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function ledgerLines(env: Checkout): Array<Record<string, unknown>> {
  return ledgerText(env)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * Drive the WRITER half under one checkout: three failing ordinals of the same fingerprint, each
 * through the real post-run fold, until detection authors the `entered` event itself.
 */
function driveCrossingUnder(env: Checkout): string {
  const identity = mintedIdentity(env)
  for (const buildOrdinal of [1, 2, 3]) {
    LOCAL_CURATION_CAPABILITIES.foldRunOutcomes({
      knowledgeRoot: env.knowledgeRoot,
      handoff: handoffFor({
        runId: `run-portability-${buildOrdinal}`,
        buildOrdinal,
        outcome: 'failed',
        filePath: identity,
        quarantined: [],
      }),
      extractAnchors: exercisedAnchors,
      quarantine: { now: NOW, auditBaseDir: env.agentQaRoot },
    })
  }
  return identity
}

/** Deliver the committed artifact to another checkout, the way `git checkout` would. */
function deliverLedger(from: Checkout, to: Checkout): void {
  cpSync(
    join(from.knowledgeRoot, QUARANTINE_LEDGER_FILE),
    join(to.knowledgeRoot, QUARANTINE_LEDGER_FILE),
  )
}

// ---- the differential ---------------------------------------------------------------------------

describe('the committed quarantine ledger crosses checkout roots (CR-02 / D-01)', () => {
  it('suppresses on a checkout that never saw the machine that wrote the entry', () => {
    const machineA = checkout('agent-qa-390-portability-A-')
    const ciCheckoutB = checkout('agent-qa-390-portability-B-')

    // --- writer half, entirely under root A ---
    const identityUnderA = driveCrossingUnder(machineA)
    const written = ledgerLines(machineA)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      kind: 'entered',
      product: PRODUCT,
      filePath: TEST_FILE_RELATIVE,
      testName: TEST_NAME,
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
    })

    // --- the artifact travels; root B has no other trace of root A ---
    deliverLedger(machineA, ciCheckoutB)

    // --- reader half, entirely under root B ---
    const identityUnderB = mintedIdentity(ciCheckoutB)
    const snapshotUnderB = resolveRunQuarantineSnapshot({
      knowledgeRoot: ciCheckoutB.knowledgeRoot,
      product: PRODUCT,
      now: NOW,
    })

    expect(snapshotUnderB).toEqual([{
      product: PRODUCT,
      filePath: TEST_FILE_RELATIVE,
      testName: TEST_NAME,
      expiresAt: EXPECTED_EXPIRY,
    }])
    // THE CLAIM: root B's own member, minted from root B's own absolute path, matches the entry
    // root A wrote. The two checkouts never exchanged anything but the committed file.
    expect(quarantineAppliesToTest(snapshotUnderB, {
      filePath: identityUnderB,
      testName: TEST_NAME,
    })).toBe(true)

    // The two checkouts genuinely differ on disk, and genuinely agree on identity.
    expect(machineA.configDir).not.toBe(ciCheckoutB.configDir)
    expect(machineA.absoluteTestFile).not.toBe(ciCheckoutB.absoluteTestFile)
    expect(identityUnderA).toBe(TEST_FILE_RELATIVE)
    expect(identityUnderB).toBe(TEST_FILE_RELATIVE)
  })

  it('leaks no checkout root into the committed bytes', () => {
    const machineA = checkout('agent-qa-390-portability-bytes-A-')
    const ciCheckoutB = checkout('agent-qa-390-portability-bytes-B-')
    driveCrossingUnder(machineA)
    deliverLedger(machineA, ciCheckoutB)

    // Anchored on the file's own bytes, not on a relation between two of the code's fields.
    const committed = ledgerText(machineA)
    expect(committed.length).toBeGreaterThan(0)
    expect(committed).not.toContain(machineA.configDir)
    expect(committed).not.toContain(ciCheckoutB.configDir)
    expect(committed).not.toContain(tmpdir())

    for (const line of ledgerLines(machineA)) {
      expect(line.filePath).toBe(TEST_FILE_RELATIVE)
      expect(line.schemaVersion).toBe(2)
    }
  })

  it('refuses a hand-edited absolute-path line while its healthy neighbours still apply', () => {
    const machineA = checkout('agent-qa-390-portability-refuse-A-')
    const ciCheckoutB = checkout('agent-qa-390-portability-refuse-B-')
    driveCrossingUnder(machineA)
    deliverLedger(machineA, ciCheckoutB)

    // A human (or a pre-390-08 build) writes a machine-local identity into the committed file.
    const damaged = {
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'entered',
      at: NOW,
      product: PRODUCT,
      filePath: join(machineA.configDir, 'tests', 'legacy.yaml'),
      testName: 'legacy checkout',
      fingerprint: 'fp-legacy',
      verdictClass: 'flake',
      owner: QUARANTINE_UNASSIGNED_OWNER,
      expiresAt: EXPECTED_EXPIRY,
    }
    appendFileSync(
      join(ciCheckoutB.knowledgeRoot, QUARANTINE_LEDGER_FILE),
      `${JSON.stringify(damaged)}\n`,
      'utf8',
    )

    const warnings: string[] = []
    const snapshotUnderB = resolveRunQuarantineSnapshot({
      knowledgeRoot: ciCheckoutB.knowledgeRoot,
      product: PRODUCT,
      now: NOW,
      warn: (message) => warnings.push(message),
    })

    // Refusal-as-data: the damaged line is named to a human, not silently dropped.
    expect(warnings.join('\n')).toContain('unreadable line')
    expect(warnings.join('\n')).toContain('line 2')
    // The healthy relative-identity neighbour is UNAFFECTED — a damaged line withholds nothing else.
    expect(snapshotUnderB.map((entry) => entry.filePath)).toEqual([TEST_FILE_RELATIVE])
    expect(quarantineAppliesToTest(snapshotUnderB, {
      filePath: mintedIdentity(ciCheckoutB),
      testName: TEST_NAME,
    })).toBe(true)
    // And the machine-local entry licenses nothing, on this checkout or any other.
    expect(quarantineAppliesToTest(snapshotUnderB, {
      filePath: damaged.filePath,
      testName: damaged.testName,
    })).toBe(false)
  })
})
