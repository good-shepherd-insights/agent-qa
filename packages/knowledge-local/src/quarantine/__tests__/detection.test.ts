// RED-first pins for the detection ladder's PURE rule (Phase 390, D-05/D-06/D-07/D-10/D-11).
//
// Three properties are load-bearing here and each is pinned two-sided:
//
//  1. The ladder boundaries. 1 ordinal is nothing, 2 is FLAGGED (visibility only — zero ledger
//     bytes), 3 ESCALATES. One build of warning before action is the whole point of D-06, so the
//     step below and the step above every threshold are both asserted.
//  2. The class gate is TOTAL over the closed eight-class verdict vocabulary. Auto-quarantine is
//     restricted to the three §6.4 A3 classes; the other FIVE escalate loudly and append nothing,
//     so a real regression is never auto-silenced. The disposition table is asserted key-for-key
//     against VERDICT_CLASSES itself, so a ninth class cannot be silently un-dispositioned.
//  3. Purity. `now` arrives as an argument and the module reads no clock, no fs and no database —
//     asserted behaviourally (identical inputs, identical bytes) AND by a source scan, because a
//     rule that reads a clock cannot have its expiry boundary pinned.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  VERDICT_CLASSES,
  canonicalJson,
} from '@vostride/agent-qa-schema'
import type { QuarantineEntryState, VerdictClass } from '@vostride/agent-qa-schema'

import {
  AUTO_QUARANTINE_CLASSES,
  QUARANTINE_AUTO_EXIT_PASSES,
  QUARANTINE_CLASS_DISPOSITIONS,
  QUARANTINE_DEFAULT_EXPIRY_DAYS,
  QUARANTINE_ESCALATE_THRESHOLD,
  QUARANTINE_FLAG_FLOOR,
  QUARANTINE_WINDOW_ORDINALS,
  evaluateQuarantineDetection,
} from '../detection.js'
import type {
  QuarantineDetectionFailure,
  QuarantineDetectionTestWindow,
} from '../detection.js'

/** The rule's own source — the purity assertions read it rather than trusting a doc comment. */
const DETECTION_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'detection.ts',
)

const PRODUCT = 'example-web'
const FILE_PATH = 'tests/checkout.test.yaml'
const TEST_NAME = 'checkout completes'
const FINGERPRINT = '{"name":"submit","ordinal":0,"role":"button","t":"el"}::flake'
const NOW = '2026-08-05T12:00:00.000Z'
/** NOW + QUARANTINE_DEFAULT_EXPIRY_DAYS (30 d), computed by hand so the constant is pinned. */
const EXPECTED_EXPIRY = '2026-09-04T12:00:00.000Z'

function failure(
  overrides: Partial<QuarantineDetectionFailure> = {},
): QuarantineDetectionFailure {
  return {
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    fingerprint: FINGERPRINT,
    verdictClass: 'flake',
    // AUTHORED by default (390-16), so every pre-existing leg keeps varying exactly ONE axis: the
    // disposition table's. The floor-eligibility axis is varied EXPLICITLY, in its own suite, with
    // both producer values named on both sides. A shared default of 'deterministic-classifier'
    // would have silently folded the two tables' effects together in every legacy assertion.
    producer: 'analyze-run',
    occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD,
    windowOrdinals: QUARANTINE_WINDOW_ORDINALS,
    ...overrides,
  }
}

/** A test window of `count` DISTINCT ordinals, every one of them passing. */
function passingWindow(
  count: number,
  overrides: Partial<QuarantineDetectionTestWindow> = {},
): QuarantineDetectionTestWindow {
  return {
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    ordinals: Array.from({ length: count }, (_unused, index) => ({
      buildOrdinal: index + 1,
      passed: true,
    })),
    ...overrides,
  }
}

function activeEntry(overrides: Partial<QuarantineEntryState> = {}): QuarantineEntryState {
  return {
    product: PRODUCT,
    filePath: FILE_PATH,
    testName: TEST_NAME,
    fingerprint: FINGERPRINT,
    verdictClass: 'flake',
    owner: QUARANTINE_UNASSIGNED_OWNER,
    enteredAt: '2026-07-06T12:00:00.000Z',
    expiresAt: '2026-09-01T12:00:00.000Z',
    state: 'quarantined',
    ...overrides,
  }
}

function evaluate(input: {
  failures?: QuarantineDetectionFailure[]
  testWindows?: QuarantineDetectionTestWindow[]
  entries?: QuarantineEntryState[]
  now?: string
}) {
  return evaluateQuarantineDetection({
    failures: input.failures ?? [],
    testWindows: input.testWindows ?? [],
    entries: input.entries ?? [],
    now: input.now ?? NOW,
  })
}

describe('detection ladder constants', () => {
  it('pins issue-curation §7.3 and D-06/D-10/D-11 defaults verbatim', () => {
    expect(QUARANTINE_FLAG_FLOOR).toBe(2)
    expect(QUARANTINE_ESCALATE_THRESHOLD).toBe(3)
    expect(QUARANTINE_WINDOW_ORDINALS).toBe(5)
    expect(QUARANTINE_AUTO_EXIT_PASSES).toBe(5)
    expect(QUARANTINE_DEFAULT_EXPIRY_DAYS).toBe(30)
  })

  it('carries a retune comment on every threshold and adds no config key', () => {
    const source = readFileSync(DETECTION_SOURCE, 'utf8')
    // The 386 D-15 idiom: pinned constants that are retuned in source, never lifted into config.
    // Four thresholds are minted here; the fifth (the window) is re-exported from its own home.
    expect(source.match(/retune/gi)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).not.toMatch(/process\.env/)
  })

  it('spells the A3 auto-quarantine set exactly once, derived from the disposition table', () => {
    expect([...AUTO_QUARANTINE_CLASSES].sort()).toEqual(['environment', 'flake', 'timeout'])
  })
})

describe('the class gate is TOTAL over the closed verdict vocabulary', () => {
  it('dispositions every one of the eight VERDICT_CLASSES — no member left unenumerated', () => {
    expect(Object.keys(QUARANTINE_CLASS_DISPOSITIONS).sort())
      .toEqual([...VERDICT_CLASSES].sort())
  })

  it.each(VERDICT_CLASSES)(
    'routes %s the same way at escalation as its disposition declares',
    (verdictClass: VerdictClass) => {
      const result = evaluate({
        failures: [failure({ verdictClass, fingerprint: `fp::${verdictClass}` })],
      })
      const autoQuarantines = QUARANTINE_CLASS_DISPOSITIONS[verdictClass] === 'auto-quarantine'
      expect(result.events).toHaveLength(autoQuarantines ? 1 : 0)
      expect(result.escalatedNotQuarantined).toHaveLength(autoQuarantines ? 0 : 1)
      // Either way the crossing is VISIBLE — an escalation that appends nothing must still be
      // loud, or D-05's gate degrades into silence of a different shape.
      const surfaced = autoQuarantines
        ? result.events.map((event) => event.testName)
        : result.escalatedNotQuarantined.map((sighting) => sighting.testName)
      expect(surfaced).toEqual([TEST_NAME])
    },
  )

  it('never auto-quarantines the five non-A3 classes, at ANY recurrence', () => {
    const nonA3 = VERDICT_CLASSES.filter((name) => !AUTO_QUARANTINE_CLASSES.includes(name))
    expect(nonA3).toHaveLength(5)
    const result = evaluate({
      failures: nonA3.map((verdictClass) => failure({
        verdictClass,
        fingerprint: `fp::${verdictClass}`,
        testName: `${TEST_NAME} ${verdictClass}`,
        // 5-in-5: the maximum the window can express, so this cannot pass for want of recurrence.
        occurrenceOrdinals: QUARANTINE_WINDOW_ORDINALS,
      })),
    })
    expect(result.events).toEqual([])
    expect(result.escalatedNotQuarantined).toHaveLength(5)
  })
})

describe('ladder boundaries, pinned one step either side', () => {
  it('answers nothing at ONE occurrence ordinal — below the flag floor', () => {
    const result = evaluate({
      failures: [failure({ occurrenceOrdinals: QUARANTINE_FLAG_FLOOR - 1 })],
    })
    expect(result).toEqual({ events: [], flagged: [], escalatedNotQuarantined: [] })
  })

  it('FLAGS at exactly two — visibility only, zero ledger bytes', () => {
    const result = evaluate({
      failures: [failure({ occurrenceOrdinals: QUARANTINE_FLAG_FLOOR })],
    })
    expect(result.events).toEqual([])
    expect(result.escalatedNotQuarantined).toEqual([])
    expect(result.flagged).toEqual([
      {
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        fingerprint: FINGERPRINT,
        verdictClass: 'flake',
        // The sighting mirrors the failure whole — the producer travels with it (390-16).
        producer: 'analyze-run',
        occurrenceOrdinals: 2,
        windowOrdinals: QUARANTINE_WINDOW_ORDINALS,
      },
    ])
  })

  it('ESCALATES at exactly three, and stops flagging it', () => {
    const result = evaluate({
      failures: [failure({ occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD })],
    })
    expect(result.flagged).toEqual([])
    expect(result.events).toHaveLength(1)
  })
})

describe('the entered event an escalation authors', () => {
  it('carries unassigned ownership and an expiry stamped from the SUPPLIED now', () => {
    const result = evaluate({ failures: [failure()] })
    expect(result.events).toEqual([
      {
        schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
        kind: 'entered',
        at: NOW,
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        fingerprint: FINGERPRINT,
        verdictClass: 'flake',
        owner: QUARANTINE_UNASSIGNED_OWNER,
        expiresAt: EXPECTED_EXPIRY,
      },
    ])
  })

  it('moves the expiry with `now` — the deadline is derived, never a stored default', () => {
    const [event] = evaluate({
      failures: [failure()],
      now: '2026-08-06T12:00:00.000Z',
    }).events
    expect(event).toMatchObject({ expiresAt: '2026-09-05T12:00:00.000Z' })
  })
})

describe('re-entry suppression while a window is OPEN', () => {
  it('appends no second entered for a fingerprint already quarantined', () => {
    const result = evaluate({ failures: [failure()], entries: [activeEntry()] })
    expect(result.events).toEqual([])
    expect(result.flagged).toEqual([])
    expect(result.escalatedNotQuarantined).toEqual([])
  })

  it('CONTROL: an entry for a DIFFERENT test does not suppress this one', () => {
    const result = evaluate({
      failures: [failure()],
      entries: [activeEntry({ testName: 'some other test' })],
    })
    expect(result.events).toHaveLength(1)
  })

  it('re-enters a test whose entry has EXPIRED — suppression already stopped (D-11)', () => {
    const result = evaluate({
      failures: [failure()],
      entries: [activeEntry({ state: 'expired' })],
    })
    expect(result.events).toHaveLength(1)
  })

  it('re-enters a RELEASED test that crosses again (D-10: re-entry needs no special rule)', () => {
    const result = evaluate({
      failures: [failure()],
      entries: [activeEntry({ state: 'released' })],
    })
    expect(result.events).toHaveLength(1)
  })
})

describe('auto-exit at M passing ordinals (D-10)', () => {
  it('releases after exactly QUARANTINE_AUTO_EXIT_PASSES distinct passing ordinals', () => {
    const result = evaluate({
      entries: [activeEntry()],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES)],
    })
    expect(result.events).toEqual([
      {
        schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
        kind: 'released-auto',
        at: NOW,
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
      },
    ])
  })

  it('does NOT release at one ordinal short of the threshold', () => {
    const result = evaluate({
      entries: [activeEntry()],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES - 1)],
    })
    expect(result.events).toEqual([])
  })

  it('does not release when the most recent distinct ordinals include a failure', () => {
    const window = passingWindow(QUARANTINE_AUTO_EXIT_PASSES)
    const ordinals = [...window.ordinals]
    ordinals[ordinals.length - 1] = { buildOrdinal: QUARANTINE_AUTO_EXIT_PASSES, passed: false }
    expect(evaluate({ entries: [activeEntry()], testWindows: [{ ...window, ordinals }] }).events)
      .toEqual([])
  })

  it('counts an ordinal as passing only when EVERY run at that ordinal passed', () => {
    const window = passingWindow(QUARANTINE_AUTO_EXIT_PASSES)
    // Two runs inside one build: the distinct-ordinal count is still 5, but ordinal 3 is mixed.
    const ordinals = [...window.ordinals, { buildOrdinal: 3, passed: false }]
    expect(evaluate({ entries: [activeEntry()], testWindows: [{ ...window, ordinals }] }).events)
      .toEqual([])
  })

  it('ignores ordinals older than the most recent M when they failed', () => {
    const ordinals = [
      { buildOrdinal: 1, passed: false },
      ...Array.from({ length: QUARANTINE_AUTO_EXIT_PASSES }, (_unused, index) => ({
        buildOrdinal: index + 2,
        passed: true,
      })),
    ]
    expect(
      evaluate({ entries: [activeEntry()], testWindows: [{
        product: PRODUCT,
        filePath: FILE_PATH,
        testName: TEST_NAME,
        ordinals,
      }] }).events,
    ).toHaveLength(1)
  })

  it('does NOT auto-release an EXPIRED entry — release applies to active windows only', () => {
    const result = evaluate({
      entries: [activeEntry({ state: 'expired' })],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES)],
    })
    expect(result.events).toEqual([])
  })

  it('does NOT re-release an already released entry', () => {
    const result = evaluate({
      entries: [activeEntry({ state: 'released' })],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES)],
    })
    expect(result.events).toEqual([])
  })

  it('releases only the test whose window passed, in a multi-entry product', () => {
    const result = evaluate({
      entries: [activeEntry(), activeEntry({ testName: 'still flaky' })],
      testWindows: [
        passingWindow(QUARANTINE_AUTO_EXIT_PASSES),
        passingWindow(QUARANTINE_AUTO_EXIT_PASSES - 1, { testName: 'still flaky' }),
      ],
    })
    expect(result.events.map((event) => event.testName)).toEqual([TEST_NAME])
  })
})

describe('purity — no clock, no fs, no database', () => {
  it('answers identically for identical (input, now) pairs', () => {
    const input = {
      failures: [failure()],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES, { testName: 'released one' })],
      entries: [activeEntry({ testName: 'released one' })],
    }
    expect(canonicalJson(evaluate(input))).toBe(canonicalJson(evaluate(input)))
  })

  it('reads no wall clock and opens no store — asserted on the source', () => {
    const source = readFileSync(DETECTION_SOURCE, 'utf8')
    expect(source).not.toMatch(/Date\.now/)
    expect(source).not.toMatch(/new Date\(\)/)
    expect(source).not.toMatch(/node:fs/)
    expect(source).not.toMatch(/node:sqlite/)
    expect(source).not.toMatch(/db\.prepare/)
  })
})
