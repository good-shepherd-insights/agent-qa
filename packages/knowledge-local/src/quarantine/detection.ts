// The detection ladder: the pure rule that turns fingerprint recurrence into quarantine lifecycle
// events (Phase 390, D-05/D-06/D-07/D-10/D-11/D-12).
//
// PURE BY CONSTRUCTION. Every input arrives as plain data — recurrence answers the projection
// already computed, per-test ordinal windows, the folded ledger state, and `now`. This module reads
// no clock, opens no database and touches no filesystem, which is what lets every threshold be
// pinned one step either side with zero flake. `expiresAt` is DERIVED from the supplied `now`
// (390-01's wall-clock-purity-by-argument pattern, extended from the fold to the rule that authors).
//
// THE LADDER (D-06). Flag early, act at N. A fingerprint at QUARANTINE_FLAG_FLOOR distinct
// occurrence ordinals is FLAGGED — visibility only, zero ledger bytes — and at
// QUARANTINE_ESCALATE_THRESHOLD it ESCALATES. "Flags and then escalates" is temporally real: one
// build of warning before anything changes.
//
// THE GATE IS TWO TOTAL TABLES OVER ONE CLOSED UNION (D-05, extended by 390-16). Escalation routes
// through QUARANTINE_CLASS_DISPOSITIONS and QUARANTINE_FLOOR_ELIGIBILITY, both keyed on the CLOSED
// eight-member VerdictClass union rather than a set membership test. That shape is deliberate: a
// ninth verdict class cannot compile until someone decides BOTH answers for it, so each gate's
// INPUT DOMAIN is enumerated, not just its outputs.
//
//  - DISPOSITION answers "may this class ever auto-quarantine". Only the three classes
//    issue-curation §6.4 routes to A3 may. The other five escalate LOUDLY and append nothing.
//  - FLOOR ELIGIBILITY answers the axis the class set alone cannot express: is the EVIDENCE behind
//    the class about THIS TEST, or about the run? `flake` is the floor's one directly-observed
//    per-test signal (it passed on retry) and is floor-eligible; everything else needs an AUTHORED
//    `analyze-run` verdict before it may silence anything.
//
// A crossing that either table refuses lands in `escalatedNotQuarantined` — the build keeps
// failing, because auto-silencing a real regression is the one outcome this phase exists to
// prevent. There is deliberately NO third arm: a refused crossing that goes nowhere is the
// anti-silencing defect wearing another hat.
//
// THE UPSTREAM SHARPENING THIS MODULE DELIBERATELY DOES NOT TAKE. `classifyRootCause`'s two
// run-scoped probe arms arguably should not mint a PER-TEST verdict at all — a down dependency is
// a run-level condition, closer to `config_error` — and fixing it there would be more correct and
// would help every verdict consumer, not just this one. But that rewrites phase 373's documented,
// pinned branch order, which is that module's contract and not this one's. Named here so the next
// reader knows the producer gate closes the MEASURED path rather than the root cause.
//
// WHY THE OTHER FIVE ARE ESCALATE-ONLY, individually:
//
//  - `app_bug` / `test_bug`: a real regression and a genuinely broken test. Humans quarantine
//    known-broken tests deliberately through the `add` verb (D-12); nothing here does it for them.
//  - `unknown`: the LLM-judge abstention AND the deterministic floor's answer for any failure
//    carrying no verdict at all. Auto-quarantining it would silence essentially every recurring
//    failure on a project running without analysis, which is the anti-silencing defect wearing a
//    different hat.
//  - `config_error`: the harness or project is misconfigured. Deterministic, fixable, and it will
//    not heal itself — suppressing it hides the one thing a human must act on.
//  - `llm_error`: our own model plumbing failed. That is evidence about the agent, never evidence
//    that the test is flaky.
//
// SERIALIZATION and EGRESS belong to the caller. This module returns events as data; the fold
// appends them through `appendQuarantineEvents`, inside the writer-lease scope, after the
// projection transaction has committed.

import {
  CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
  QUARANTINE_UNASSIGNED_OWNER,
  VERDICT_CLASSES,
} from '@vostride/agent-qa-schema'
import type {
  QuarantineEntryState,
  QuarantineLedgerEvent,
  QuarantineOwner,
  Verdict,
  VerdictClass,
} from '@vostride/agent-qa-schema'

// §7.3's locked window is spelled ONCE, beside the table it slides over. Re-exported here because
// the ladder's own contract is incomplete without it, and a second declaration is how a threshold
// and the window it is counted against drift apart.
export { QUARANTINE_WINDOW_ORDINALS } from '../projection/fingerprint-window-read.js'

/**
 * Visibility floor (D-06): distinct occurrence ordinals at which a fingerprint becomes suspected
 * flaky. Pinned, never config — retune from operational evidence in this source, where the change
 * is reviewable.
 */
export const QUARANTINE_FLAG_FLOOR = 2

/**
 * issue-curation §7.3's locked trigger, verbatim: the same fingerprint at three distinct ordinals
 * inside the window escalates. Pinned constant with no config key (386 D-15) — retune it here.
 */
export const QUARANTINE_ESCALATE_THRESHOLD = 3

/**
 * D-10's exit: M consecutive PASSING distinct build ordinals release a quarantined test. Five is
 * symmetric with the detection window by design (~17% escape odds for a 30%-failure flake) and sits
 * inside LAST_OUTCOMES_LIMIT, so no window widening is needed. Retune from operational evidence.
 */
export const QUARANTINE_AUTO_EXIT_PASSES = 5

/**
 * D-11's default lifetime in days. On lapse suppression STOPS and the entry stays listed as
 * `expired`.
 *
 * This is a REVIEW CADENCE, not a cap, and the difference is the fact somebody retuning the number
 * most needs: a still-crossing fingerprint re-enters with a fresh `expiryFrom(now)` on the very
 * next fold, indefinitely and with no attenuation. Measured over four full cycles (2026-08-06): 4
 * `entered` lines, 4 distinct deadlines, 0 released, cycle 4 indistinguishable from cycle 1. So
 * raising this number lengthens the gap between red builds; it does not change how many there
 * eventually are. A human deadline in a human-reviewed file; retune from operational evidence,
 * never from config.
 */
export const QUARANTINE_DEFAULT_EXPIRY_DAYS = 30

/** What escalation does with a verdict class. */
export type QuarantineDisposition = 'auto-quarantine' | 'escalate-only'

/**
 * The class gate, as a TOTAL function over the closed verdict vocabulary (D-05).
 *
 * `satisfies Record<VerdictClass, QuarantineDisposition>` is the load-bearing part: adding a ninth
 * member to VERDICT_CLASSES makes this object a compile error until its quarantine disposition is
 * decided. A `Set` of three names would have compiled forever while silently treating every future
 * class as escalate-only by accident rather than by decision.
 */
export const QUARANTINE_CLASS_DISPOSITIONS = {
  flake: 'auto-quarantine',
  environment: 'auto-quarantine',
  timeout: 'auto-quarantine',
  app_bug: 'escalate-only',
  test_bug: 'escalate-only',
  config_error: 'escalate-only',
  llm_error: 'escalate-only',
  unknown: 'escalate-only',
} as const satisfies Record<VerdictClass, QuarantineDisposition>

/**
 * Exactly issue-curation §6.4's A3 routing, DERIVED from the disposition table rather than spelled
 * a second time (388 C13) — the set and the table can never disagree about a class.
 */
export const AUTO_QUARANTINE_CLASSES: readonly VerdictClass[] = VERDICT_CLASSES.filter(
  (name) => QUARANTINE_CLASS_DISPOSITIONS[name] === 'auto-quarantine',
)

/** Whether a class may auto-quarantine on the deterministic floor's word alone. */
export type QuarantineFloorEligibility = 'floor-eligible' | 'authored-required'

/**
 * The SECOND total table over the same closed vocabulary (390-16, G-390-3).
 *
 * The disposition table above answers "may this class ever auto-quarantine". It cannot answer the
 * other question, because the answer is not a property of the class name: is the EVIDENCE behind
 * the class a statement about THIS TEST, or about the run it happened to be in? This table answers
 * that, and it is a table rather than `if (cls === 'environment' || cls === 'timeout')` for exactly
 * the reason D-05 gave for the first one — a rule stated over a subset of its own input domain
 * compiles forever while treating every future class as an accident. A ninth member of
 * VERDICT_CLASSES is a compile error here until someone decides its floor eligibility.
 *
 * Per class, with the reasoning that decides it:
 *
 *  - `flake` → FLOOR-ELIGIBLE. `classifyRootCause`'s rule is `retryCount > 0` on a final-attempt
 *    pass: the test LITERALLY passed on retry. That is the definition of flaky, observed directly,
 *    per-test, needing no LLM. Gating it would make auto-quarantine unreachable on every project
 *    running without an analysis budget — which is FLAK-01's promise itself.
 *  - `environment` → AUTHORED-REQUIRED. Two of its three arms are RUN-SCOPED probe reads
 *    (`baselineProbe.error !== undefined`, `baselineProbe.status >= 500`) that fire before any
 *    per-test signal. One down staging dependency classifies every failing member of a suite
 *    identically; the measured blast radius was 6 of 6 tests under one shared 30-day deadline.
 *  - `timeout` → AUTHORED-REQUIRED. Per-test, but semantically thin: "exceeded the budget" is as
 *    consistent with an `app_bug` (an infinite spinner, a deadlock) as with flakiness. Telling
 *    those apart is what `analyze-run` exists for.
 *  - THE FIVE ESCALATE-ONLY CLASSES → AUTHORED-REQUIRED. They never reach the auto-quarantine
 *    branch today, so this value is not observable — which is precisely why it is the strict one.
 *    It makes authored-required the DEFAULT for any future widening of the disposition table, so a
 *    later one-line class flip cannot silently also license the floor (T-390-16-04).
 *
 * WHY NOT flip the disposition table instead. That is wrong in both directions: it would disable
 * auto-quarantine for genuinely ANALYZED environment/timeout failures, and it would leave
 * floor-minted `flake` firing. The consistent rule — the one 390-05 already ratified once when it
 * made `unknown` escalate-only — is that a quarantine decision requires an AUTHORED verdict, and
 * `producer` is what makes that rule expressible.
 */
export const QUARANTINE_FLOOR_ELIGIBILITY = {
  flake: 'floor-eligible',
  environment: 'authored-required',
  timeout: 'authored-required',
  app_bug: 'authored-required',
  test_bug: 'authored-required',
  config_error: 'authored-required',
  llm_error: 'authored-required',
  unknown: 'authored-required',
} as const satisfies Record<VerdictClass, QuarantineFloorEligibility>

/**
 * Both tables must agree before a crossing may author an `entered` line: the class's disposition
 * is auto-quarantine AND (the class is floor-eligible OR this crossing's verdict was authored).
 * Everything else routes to `escalatedNotQuarantined` — loud, rendered, build still failing.
 */
function autoQuarantines(failure: QuarantineDetectionFailure): boolean {
  if (QUARANTINE_CLASS_DISPOSITIONS[failure.verdictClass] !== 'auto-quarantine') return false
  return QUARANTINE_FLOOR_ELIGIBILITY[failure.verdictClass] === 'floor-eligible'
    || failure.producer === 'analyze-run'
}

/**
 * One failed fingerprint this run contributed, with the recurrence the projection answered for it.
 * Test identity travels beside the fingerprint because a crossing has to name the test it
 * quarantines; the recurrence itself is keyed `(product, fingerprint)` (D-07).
 */
export interface QuarantineDetectionFailure {
  product: string
  filePath: string
  testName: string
  fingerprint: string
  verdictClass: VerdictClass
  /**
   * WHICH pipeline authored `verdictClass` on the CROSSING run (390-16). The floor-eligibility
   * gate reads this beside the class, because for some classes the class alone does not say
   * whether the evidence is about this test or about the whole run.
   *
   * WHY THE CROSSING RUN'S PRODUCER, and not all three occurrence ordinals'. Gating on every
   * ordinal in the window would need a new `producer` column on `run_fingerprint_windows` plus an
   * index rebuild — cheap in itself, since L12 makes the projection a gitignored rebuildable
   * derivation — but it is a strictly larger change that buys nothing: the crossing run is the one
   * AUTHORING the `entered` line, so its evidence is the evidence the entry rests on. Recorded
   * here so the next reader does not have to re-derive the choice (T-390-16-05, accepted).
   */
  producer: Verdict['producer']
  /** DISTINCT build ordinals inside the window carrying this fingerprint. */
  occurrenceOrdinals: number
  /** DISTINCT build ordinals inside the window carrying ANY failure — the honest denominator. */
  windowOrdinals: number
}

/** One recorded outcome, ordinal-keyed. Mirrors the projection's per-test outcome window entry. */
export interface QuarantineOrdinalOutcome {
  buildOrdinal: number
  passed: boolean
}

/** One quarantined test's recent outcome window — the auto-exit's only input. */
export interface QuarantineDetectionTestWindow {
  product: string
  filePath: string
  testName: string
  /** May carry several entries per ordinal (two runs in one build); order is irrelevant. */
  ordinals: readonly QuarantineOrdinalOutcome[]
}

export interface EvaluateQuarantineDetectionInput {
  failures: readonly QuarantineDetectionFailure[]
  testWindows: readonly QuarantineDetectionTestWindow[]
  /** The ledger folded against this same `now` — the suppression and exit input. */
  entries: readonly QuarantineEntryState[]
  /** ISO-8601 instant. The ONLY way wall clock enters this rule. */
  now: string
}

/** A crossing the caller must SHOW: flagged, or escalated-and-deliberately-not-quarantined. */
export interface QuarantineDetectionSighting {
  product: string
  filePath: string
  testName: string
  fingerprint: string
  verdictClass: VerdictClass
  /**
   * The crossing run's producer, carried onto the sighting so an operator can ACT on it.
   * `escalatedNotQuarantined` has two distinct causes with two different human actions: a class
   * that is never auto-quarantinable (run `analyze-run` and it still will not be), versus a class
   * that would have been had a verdict been authored (run `analyze-run` and it will be). Those
   * read identically on the curation tail's line unless the producer travels with the sighting.
   */
  producer: Verdict['producer']
  occurrenceOrdinals: number
  windowOrdinals: number
}

export interface QuarantineDetectionResult {
  /** Lifecycle events to append, entered-then-released, each group identity-sorted. */
  events: QuarantineLedgerEvent[]
  /** At the flag floor: suspected flaky, no state change, no ledger write (D-06). */
  flagged: QuarantineDetectionSighting[]
  /** Escalated but class-gated away from auto-quarantine — the build keeps failing (D-05). */
  escalatedNotQuarantined: QuarantineDetectionSighting[]
}

const MS_PER_DAY = 86_400_000

function identityKey(identity: {
  product: string
  filePath: string
  testName: string
}): string {
  return JSON.stringify([identity.product, identity.filePath, identity.testName])
}

function sighting(failure: QuarantineDetectionFailure): QuarantineDetectionSighting {
  return {
    product: failure.product,
    filePath: failure.filePath,
    testName: failure.testName,
    fingerprint: failure.fingerprint,
    verdictClass: failure.verdictClass,
    producer: failure.producer,
    occurrenceOrdinals: failure.occurrenceOrdinals,
    windowOrdinals: failure.windowOrdinals,
  }
}

/**
 * The deadline an auto-entry is licensed for. Derived from the SUPPLIED instant — `Date.parse` of a
 * caller's argument is arithmetic, not a clock read. An unparseable `now` is a caller bug, so it
 * surfaces as a thrown RangeError from `toISOString` rather than silently minting a forever entry.
 */
function expiryFrom(now: string): string {
  return new Date(Date.parse(now) + QUARANTINE_DEFAULT_EXPIRY_DAYS * MS_PER_DAY).toISOString()
}

/**
 * Collapse a per-test outcome window onto DISTINCT ordinals. An ordinal counts as passing only when
 * EVERY recorded run at that ordinal passed — two runs in one build are one ordinal (D-07's counting
 * law), and the safe direction for a mixed build is "not a pass", so a same-build pass∧fail (the
 * §8.2 flake signature itself) can never buy an exit.
 */
function distinctOrdinalOutcomes(
  window: QuarantineDetectionTestWindow,
): { buildOrdinal: number; passed: boolean }[] {
  const byOrdinal = new Map<number, boolean>()
  for (const entry of window.ordinals) {
    const existing = byOrdinal.get(entry.buildOrdinal)
    byOrdinal.set(entry.buildOrdinal, (existing ?? true) && entry.passed)
  }
  return [...byOrdinal.entries()]
    .map(([buildOrdinal, passed]) => ({ buildOrdinal, passed }))
    .sort((a, b) => a.buildOrdinal - b.buildOrdinal)
}

/** D-10's exit predicate: the M most recent DISTINCT ordinals exist and every one of them passed. */
function releasesOnPasses(window: QuarantineDetectionTestWindow): boolean {
  const ordinals = distinctOrdinalOutcomes(window)
  if (ordinals.length < QUARANTINE_AUTO_EXIT_PASSES) return false
  return ordinals
    .slice(-QUARANTINE_AUTO_EXIT_PASSES)
    .every((entry) => entry.passed)
}

/**
 * WHOSE NAME an auto-authored `entered` event carries, stated over the prior entry's state
 * (390-18 / G-390-4). The rule is total across the three members of `QuarantineEntryStateName`:
 *
 *  - `'expired'` → CARRY the prior owner. A lapsed window is the SAME window continuing:
 *    suppression stopped, nobody closed it, and the person who claimed it still holds it.
 *    Re-stamping the unassigned literal here silently UN-CLAIMS a window somebody had taken.
 *  - `'released'` → the UNASSIGNED literal. A release is a human deliberately closing the window;
 *    a later crossing opens a genuinely new one, and D-12's honest-absence rule (no git-identity
 *    stamping, no CODEOWNERS guessing) says the truthful answer for it is that nobody has claimed
 *    it yet. Carrying a name here would attribute a new window to somebody who signed off on the
 *    old one.
 *  - `'quarantined'` → UNREACHABLE on this path, not silently absent. The ladder skips an
 *    already-suppressed identity (`activeKeys`, above) before it ever reaches the authoring
 *    branch, so there is no owner decision to make for a suppressing entry. Pinned as unreachable
 *    in detection.test.ts rather than left to be re-derived.
 *
 * No prior entry at all → the unassigned literal, unchanged.
 *
 * TWO AUTHORING PATHS, ONE RULE ABOUT SOMEBODY'S CLAIM. `createQuarantineOperations`'s RENEW arm
 * (operations.ts) makes the same decision from the other direction: it OMITS `owner` from the
 * `renewed` event when the caller named nobody, with a comment saying that writing the unassigned
 * literal there would silently un-claim a window somebody had taken. That is the identical rule
 * over an open window; this is it over a re-entry. Naming the sibling here is cheaper than a test
 * asserting the two agree — but it only works if a reader who changes one comes looking, so the
 * cross-reference is deliberately in BOTH.
 */
function ownerForAutoEntry(prior: QuarantineEntryState | undefined): QuarantineOwner {
  if (prior === undefined) return QUARANTINE_UNASSIGNED_OWNER
  switch (prior.state) {
    case 'expired':
      return prior.owner
    case 'released':
    case 'quarantined':
      return QUARANTINE_UNASSIGNED_OWNER
  }
}

/**
 * The ladder, evaluated over one run's failures and the current ledger state.
 *
 * Ordering is deterministic — entered events (identity-sorted) then released-auto events
 * (identity-sorted) — so the committed ledger's bytes do not depend on projection iteration order.
 *
 * Suppression is keyed on ledger STATE, not on the existence of an entry: only `'quarantined'`
 * suppresses a fresh `entered`. An `'expired'` entry has already stopped suppressing (D-11) and a
 * `'released'` one closed its window, so a fresh crossing re-enters in both cases — D-10's stated
 * "re-entry needs no special rule". The repeated `entered` lines are the ledger's own record that
 * this test has been here before, which is exactly the history D-03 chose an event log to keep.
 */
export function evaluateQuarantineDetection(
  input: EvaluateQuarantineDetectionInput,
): QuarantineDetectionResult {
  const activeKeys = new Set(
    input.entries
      .filter((entry) => entry.state === 'quarantined')
      .map((entry) => identityKey(entry)),
  )
  // A SECOND lookup, over ALL entries. `activeKeys` deliberately holds only the suppressing ones,
  // and a re-entry by definition has none — so the set that answers "is this test already
  // quarantined" cannot also answer "did somebody claim this test's last window".
  const priorByKey = new Map(
    input.entries.map((entry) => [identityKey(entry), entry] as const),
  )

  const flagged: QuarantineDetectionSighting[] = []
  const escalatedNotQuarantined: QuarantineDetectionSighting[] = []
  const entered: QuarantineLedgerEvent[] = []
  const expiresAt = expiryFrom(input.now)

  for (const failure of [...input.failures].sort(
    (a, b) => identityKey(a).localeCompare(identityKey(b))
      || a.fingerprint.localeCompare(b.fingerprint),
  )) {
    // An already-suppressed test needs neither a flag nor an escalation: it is already quarantined,
    // which is louder than either. Checked before the ladder so the whole rung is a no-op.
    if (activeKeys.has(identityKey(failure))) continue

    if (failure.occurrenceOrdinals >= QUARANTINE_ESCALATE_THRESHOLD) {
      if (autoQuarantines(failure)) {
        entered.push({
          schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
          kind: 'entered',
          at: input.now,
          product: failure.product,
          filePath: failure.filePath,
          testName: failure.testName,
          fingerprint: failure.fingerprint,
          verdictClass: failure.verdictClass,
          owner: ownerForAutoEntry(priorByKey.get(identityKey(failure))),
          expiresAt,
        })
      } else {
        escalatedNotQuarantined.push(sighting(failure))
      }
      continue
    }
    if (failure.occurrenceOrdinals >= QUARANTINE_FLAG_FLOOR) flagged.push(sighting(failure))
  }

  const windowsByKey = new Map(
    input.testWindows.map((window) => [identityKey(window), window] as const),
  )
  const released: QuarantineLedgerEvent[] = []
  for (const entry of [...input.entries].sort(
    (a, b) => identityKey(a).localeCompare(identityKey(b)),
  )) {
    // Release closes an entry that is still LISTED — `quarantined` or `expired`. Only a `released`
    // window is out of scope, and the old filter's justification was right about exactly that half:
    // re-releasing a closed window WOULD author an event that changes nothing while claiming the
    // exit path worked. It was wrong about the other half. A LAPSED entry is still listed, still
    // renewable, still in the triage queue and still the reason a human sees this test in
    // `quarantine.list` — a release genuinely closes it, so refusing to author one is what left a
    // FIXED test listed forever (390-17 / G-390-4). One condition was covering two states whose
    // answers differ.
    //
    // TWO SITES, ONE RULE. `evaluateQuarantineForFold` (projection/run-outcomes.ts) builds the
    // `testWindows` this loop reads, and its own exit-candidate filter must admit exactly the same
    // states. Narrow either one alone and the pair is a no-op: this loop would answer correctly
    // over a window the fold never built.
    if (entry.state === 'released') continue
    const window = windowsByKey.get(identityKey(entry))
    if (window === undefined || !releasesOnPasses(window)) continue
    released.push({
      schemaVersion: CURRENT_QUARANTINE_LEDGER_SCHEMA_VERSION,
      kind: 'released-auto',
      at: input.now,
      product: entry.product,
      filePath: entry.filePath,
      testName: entry.testName,
    })
  }

  return { events: [...entered, ...released], flagged, escalatedNotQuarantined }
}
