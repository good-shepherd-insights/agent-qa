// RED-first pins for the detection ladder's PURE rule (Phase 390, D-05/D-06/D-07/D-10/D-11).
//
// Three properties are load-bearing here and each is pinned two-sided:
//
//  1. The ladder boundaries. 1 ordinal is nothing, 2 is FLAGGED (visibility only — zero ledger
//     bytes), 3 ESCALATES. One build of warning before action is the whole point of D-06, so the
//     step below and the step above every threshold are both asserted.
//  2. The gate is TWO tables, each TOTAL over the closed eight-class verdict vocabulary.
//     DISPOSITION restricts auto-quarantine to the three §6.4 A3 classes; the other FIVE escalate
//     loudly and append nothing, so a real regression is never auto-silenced. FLOOR ELIGIBILITY
//     (390-16) then asks whether the evidence behind the class is about this test or about the
//     run — only `flake` may auto-quarantine on the deterministic floor's word alone. Both tables
//     are asserted key-for-key against VERDICT_CLASSES itself, so a ninth class cannot be
//     silently un-decided on either axis.
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
  QUARANTINE_FLOOR_ELIGIBILITY,
  QUARANTINE_WINDOW_ORDINALS,
  evaluateQuarantineDetection,
  hasSameBuildPassAndFail,
} from '../detection.js'
import type {
  QuarantineDetectionFailure,
  QuarantineDetectionTestWindow,
  QuarantineOrdinalOutcome,
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
    // No signature by default (390-19), for the same reason the producer defaults to AUTHORED:
    // every pre-existing leg keeps its exact current meaning and no legacy assertion silently
    // changes direction. The signature axis is varied EXPLICITLY, on both sides, in its own suite.
    sameBuildPassAndFail: false,
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
    enteredCount: 1,
    firstEnteredAt: '2026-07-06T12:00:00.000Z',
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

// A quarantine decision requires an AUTHORED verdict (390-16, G-390-3).
//
// The disposition table decides WHETHER a class may ever auto-quarantine. It cannot decide the
// other axis: whether the EVIDENCE behind the class is about this test or about the whole run.
// `classifyRootCause`'s `environment` arms are two run-scoped health-probe reads, so one down
// dependency classifies every failing member of a suite identically; `timeout` is per-test but as
// consistent with an app_bug as with flakiness. `flake` is the one class the floor observes
// directly and per-test (the test literally passed on retry), so gating it would make
// auto-quarantine unreachable on any project running without an analysis budget — FLAK-01's
// promise itself.
//
// Every leg below is PAIRED. "Does not quarantine" is load-bearing only if the same fixture with
// the producer flipped DOES quarantine — otherwise it could be passing for want of recurrence.
describe('floor eligibility: an auto-quarantine class the floor may not act on alone', () => {
  const AUTHORED_REQUIRED_AUTO_CLASSES: readonly VerdictClass[] = ['environment', 'timeout']

  it('is TOTAL over the closed vocabulary — no member left un-decided', () => {
    expect(Object.keys(QUARANTINE_FLOOR_ELIGIBILITY).sort()).toEqual([...VERDICT_CLASSES].sort())
  })

  it('makes authored-required the value of every class but flake', () => {
    // Stated as data so the reason a reader can check is the reason the gate checks. The five
    // escalate-only classes carry the STRICT value deliberately: it is unobservable today, which
    // is exactly why a future one-line disposition flip must not silently license the floor too.
    expect(
      VERDICT_CLASSES.filter((name) => QUARANTINE_FLOOR_ELIGIBILITY[name] === 'floor-eligible'),
    ).toEqual(['flake'])
  })

  it.each(AUTHORED_REQUIRED_AUTO_CLASSES)(
    'REFUSES to auto-quarantine a floor-produced %s crossing, loudly',
    (verdictClass: VerdictClass) => {
      const result = evaluate({
        failures: [failure({
          verdictClass,
          producer: 'deterministic-classifier',
          fingerprint: `fp::${verdictClass}`,
        })],
      })

      expect(result.events).toEqual([])
      expect(result.flagged).toEqual([])
      // Refused is not dropped: the crossing lands where the curation tail already renders it and
      // the build keeps failing. A silent third arm would be the anti-silencing defect in a hat.
      expect(result.escalatedNotQuarantined).toHaveLength(1)
      expect(result.escalatedNotQuarantined[0]).toMatchObject({
        verdictClass,
        producer: 'deterministic-classifier',
        occurrenceOrdinals: QUARANTINE_ESCALATE_THRESHOLD,
      })
    },
  )

  it.each(AUTHORED_REQUIRED_AUTO_CLASSES)(
    'ACCEPTS the same %s crossing once analyze-run authored it — the accept-direction control',
    (verdictClass: VerdictClass) => {
      const result = evaluate({
        failures: [failure({
          verdictClass,
          producer: 'analyze-run',
          fingerprint: `fp::${verdictClass}`,
        })],
      })

      expect(result.escalatedNotQuarantined).toEqual([])
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ kind: 'entered', verdictClass })
    },
  )

  it.each(['deterministic-classifier', 'analyze-run'] as const)(
    'auto-quarantines a %s-produced flake — FLAK-01 survives with no analysis budget',
    (producer) => {
      const result = evaluate({
        failures: [failure({ verdictClass: 'flake', producer })],
      })

      expect(result.escalatedNotQuarantined).toEqual([])
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({ kind: 'entered', verdictClass: 'flake' })
    },
  )

  it('leaves the five escalate-only classes untouched on BOTH producer values', () => {
    const nonA3 = VERDICT_CLASSES.filter((name) => !AUTO_QUARANTINE_CLASSES.includes(name))
    for (const producer of ['deterministic-classifier', 'analyze-run'] as const) {
      const result = evaluate({
        failures: nonA3.map((verdictClass) => failure({
          verdictClass,
          producer,
          fingerprint: `fp::${verdictClass}`,
          testName: `${TEST_NAME} ${verdictClass}`,
        })),
      })
      // The disposition table refuses them FIRST, so the floor axis never gets a say — an
      // authored config_error is still not quarantinable, which is the point of two tables.
      expect(result.events).toEqual([])
      expect(result.escalatedNotQuarantined).toHaveLength(5)
    }
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

// ---- The auto-entry's owner, stated over the prior entry's state (390-18 / G-390-4) --

// The auto-`entered` used to stamp the unassigned literal unconditionally, so a human who had
// claimed an entry via `add --owner` lost that claim the next time the window lapsed and the
// fingerprint re-crossed. `operations.ts`'s RENEW path already refuses to do this and says so in
// its own comment — the rule was written down once and applied in one of the two places it governs.
//
// The rule is stated per prior-entry state because the two reachable states MEAN different things:
// a lapsed window is the SAME window continuing (suppression stopped, nobody closed it, the person
// who claimed it still holds it), while a released window was deliberately closed by a human and a
// later crossing opens a genuinely new one — where D-12's honest-absence rule says `unassigned` is
// the truthful answer. Both directions are pinned below on one fixture family, because a
// carry-forward rule with only a positive case is satisfiable by carrying always.

describe("the auto-entry's owner over the prior entry's state (390-18)", () => {
  function enteredOwner(entries: QuarantineEntryState[]): unknown {
    const result = evaluate({ failures: [failure()], entries })
    expect(result.events).toHaveLength(1)
    return (result.events[0] as unknown as Record<string, unknown>).owner
  }

  it('carries a claimed owner forward across a LAPSE — the same window continuing', () => {
    expect(enteredOwner([activeEntry({ state: 'expired', owner: 'alice' })])).toBe('alice')
  })

  it('does NOT carry an owner across a deliberate RELEASE — a human closed that window', () => {
    expect(enteredOwner([activeEntry({ state: 'released', owner: 'alice' })]))
      .toBe(QUARANTINE_UNASSIGNED_OWNER)
  })

  it('carries the unassigned literal across a lapse when there was nothing to carry', () => {
    expect(enteredOwner([activeEntry({ state: 'expired' })])).toBe(QUARANTINE_UNASSIGNED_OWNER)
  })

  it('stamps unassigned when there is no prior entry at all — unchanged', () => {
    expect(enteredOwner([])).toBe(QUARANTINE_UNASSIGNED_OWNER)
  })

  it('reads the prior entry for THIS identity only, never another test\'s owner', () => {
    expect(enteredOwner([
      activeEntry({ testName: 'some other test', state: 'expired', owner: 'alice' }),
    ])).toBe(QUARANTINE_UNASSIGNED_OWNER)
  })

  // The third member of the state union, asserted rather than assumed. A `quarantined` prior entry
  // never reaches the authoring branch at all — the ladder skips an already-suppressed identity
  // before it — so there is no owner decision to make for it, and this leg is what says so.
  it("a 'quarantined' prior entry never reaches the owner rule — the ladder skipped it", () => {
    const result = evaluate({
      failures: [failure()],
      entries: [activeEntry({ state: 'quarantined', owner: 'alice' })],
    })
    expect(result.events).toEqual([])
    expect(result.flagged).toEqual([])
    expect(result.escalatedNotQuarantined).toEqual([])
  })

  it('decides per identity across a batch — one carries, one does not', () => {
    const other = { testName: 'a second test' }
    const result = evaluate({
      failures: [failure(), failure({ ...other })],
      entries: [
        activeEntry({ state: 'expired', owner: 'alice' }),
        activeEntry({ ...other, state: 'released', owner: 'bob' }),
      ],
    })
    expect(result.events).toHaveLength(2)
    const byName = new Map(
      result.events.map((event) => {
        const line = event as unknown as Record<string, unknown>
        return [line.testName as string, line.owner] as const
      }),
    )
    expect(byName.get(TEST_NAME)).toBe('alice')
    expect(byName.get('a second test')).toBe(QUARANTINE_UNASSIGNED_OWNER)
  })
})

// ---- The per-test flake signature: a same-build pass∧fail (390-19 / G-390-5) ----
//
// `distinctOrdinalOutcomes`' own docstring already names this shape "the §8.2 flake signature
// itself", and the exit path reads it in the SAFE direction: a mixed ordinal collapses to
// not-passed so it can never buy a release. 390-19 reads the SAME grouping in the other direction,
// as the per-test evidence the floor arm of the auto-quarantine gate now requires.
//
// PAIRED AND DIRECTIONAL BY CONSTRUCTION. A predicate with only a positive case is satisfiable by
// `return true`, so each leg below has a negative partner that a relaxation would flip: the
// two-builds leg is what a "some pass and some fail ANYWHERE in the window" relaxation reds, and
// the one-answer leg is what dropping the pass∧fail conjunction reds.
describe('the same-build pass∧fail signature (390-19)', () => {
  function ordinals(...entries: readonly [number, boolean][]): QuarantineOrdinalOutcome[] {
    return entries.map(([buildOrdinal, passed]) => ({ buildOrdinal, passed }))
  }

  it('HOLDS when ONE build ordinal carries both a pass and a fail', () => {
    expect(hasSameBuildPassAndFail(ordinals([5, true], [5, false]))).toBe(true)
  })

  it('does NOT hold when one build ordinal carries one answer', () => {
    expect(hasSameBuildPassAndFail(ordinals([5, false], [5, false]))).toBe(false)
    expect(hasSameBuildPassAndFail(ordinals([5, true], [5, true]))).toBe(false)
  })

  // The leg a "some pass and some fail anywhere in the window" relaxation reds. Two builds is a
  // test that broke and was fixed, which is the ordinary shape of software, not a flake.
  it('does NOT hold across TWO builds — a later fix is not a flake signature', () => {
    expect(hasSameBuildPassAndFail(ordinals([5, false], [6, true]))).toBe(false)
    expect(hasSameBuildPassAndFail(ordinals([5, true], [6, false]))).toBe(false)
  })

  it('does not hold on an empty window, nor on a single entry either way', () => {
    expect(hasSameBuildPassAndFail([])).toBe(false)
    expect(hasSameBuildPassAndFail(ordinals([5, true]))).toBe(false)
    expect(hasSameBuildPassAndFail(ordinals([5, false]))).toBe(false)
  })

  it('answers identically for the same entries SHUFFLED — no projection read-order dependence', () => {
    const withSignature = ordinals([4, true], [5, false], [5, true], [6, false])
    expect(hasSameBuildPassAndFail(withSignature)).toBe(true)
    expect(hasSameBuildPassAndFail([...withSignature].reverse())).toBe(true)

    const withoutSignature = ordinals([4, true], [5, false], [6, false], [7, true])
    expect(hasSameBuildPassAndFail(withoutSignature)).toBe(false)
    expect(hasSameBuildPassAndFail([...withoutSignature].reverse())).toBe(false)
  })

  // AGREEMENT WITH THE SIBLING LAW, on ONE shared fixture. This is a cheap GUARD, not the
  // mechanism: both `hasSameBuildPassAndFail` and `distinctOrdinalOutcomes` call the one
  // `groupByBuildOrdinal` helper in detection.ts, so "two runs in one build are one ordinal" has a
  // single spelling in CODE. If this leg were the only thing holding them together, the two would
  // be free to drift the moment somebody edited one.
  it('agrees with the exit path: a signature ordinal collapses to NOT-passed, buying no release', () => {
    const window = passingWindow(QUARANTINE_AUTO_EXIT_PASSES)
    // Ordinal 3 carries a pass (from `passingWindow`) and a fail — the signature, inside a window
    // whose distinct-ordinal COUNT is still QUARANTINE_AUTO_EXIT_PASSES.
    const mixed = [...window.ordinals, { buildOrdinal: 3, passed: false }]

    expect(hasSameBuildPassAndFail(mixed)).toBe(true)
    expect(
      evaluate({
        entries: [activeEntry()],
        testWindows: [{ ...window, ordinals: mixed }],
      }).events,
    ).toEqual([])
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

  // 390-17 / G-390-4. The exit path is TOTAL across the states in which an entry is still LISTED.
  // A lapsed window is still listed, still renewable and still in the triage queue, so a test
  // FIXED while its window was lapsed genuinely leaves quarantine — a `released-auto` over it
  // closes something real. Before this, only a manual `release` could, and a fixed test sat in the
  // list forever. The half of the old filter that was always right — a CLOSED window stays closed —
  // is kept and pinned on its own leg below, so the widened rule cannot swallow it.
  it('auto-releases an entry whose deadline has LAPSED — a fixed test leaves on the same terms', () => {
    const result = evaluate({
      entries: [activeEntry({ state: 'expired' })],
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

  it('COMPLEMENT: does NOT re-release an already released entry — a closed window stays closed', () => {
    const result = evaluate({
      entries: [activeEntry({ state: 'released' })],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES)],
    })
    expect(result.events).toEqual([])
  })

  // The exit PREDICATE is unchanged by the widening: a lapsed entry earns its release on exactly
  // the same evidence a suppressing one does, one step either side of both boundaries.
  it('a LAPSED entry ONE ordinal short of the threshold still authors nothing', () => {
    const result = evaluate({
      entries: [activeEntry({ state: 'expired' })],
      testWindows: [passingWindow(QUARANTINE_AUTO_EXIT_PASSES - 1)],
    })
    expect(result.events).toEqual([])
  })

  it('a LAPSED entry with a mixed-outcome ordinal inside the window authors nothing', () => {
    const window = passingWindow(QUARANTINE_AUTO_EXIT_PASSES)
    const ordinals = [...window.ordinals, { buildOrdinal: 3, passed: false }]
    expect(
      evaluate({
        entries: [activeEntry({ state: 'expired' })],
        testWindows: [{ ...window, ordinals }],
      }).events,
    ).toEqual([])
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
