// THE FROZEN CORPUS MANIFEST (Phase 392 plan 09, D-15 / CHAT-03).
//
// This list IS the ceiling denominator. Not the contents of the `scenarios/` directory, not a glob,
// not "whatever the runner found" — this list. The distinction is the single most expensive lesson
// this project has recorded: a scoring set that grows as work is added lets the measured ratio
// drift without anyone deciding to move it, and every round of the arc then reports progress that
// nobody chose (RESEARCH Pitfall 2, the treadmill law).
//
// So membership is a DELIBERATE EDIT. `scenario-manifest.test.ts` walks both directions — a listed
// scenario with no file and a file with no line both fail the build — which means a scenario cannot
// join the denominator by being written, only by being admitted. When it is admitted, `CORPUS_VERSION`
// moves and the number reported afterwards is a number about a different corpus, stated as such.
//
// THE EXPECTATION KIND IS PART OF THE LINE. The ceiling is computed over `should_execute` entries,
// so a scenario flipping arm changes the denominator as surely as one being added. D-08's flip law
// already makes a flip a phase's arrival proof; carrying the kind here makes it a two-file edit.
//
// PURE DATA, NO IMPORTS BEYOND THE VOCABULARY. Nothing here reads a file or parses a byte, because
// `packages/agent` is storageNeutral and because a manifest that could DERIVE itself from a disk
// would be the glob it exists to refuse.

import type { ScenarioClass, ScenarioExpectationKind, ScenarioLane } from '@vostride/agent-qa-schema'

/**
 * The corpus this build measures against.
 *
 * BUMPED WHENEVER THE CORPUS STOPS BEING THE SAME CORPUS — a member added or removed, an
 * expectation kind flipped, or an utterance re-authored. A recorded rate can then always be
 * attributed to a known set, and a rate quoted without one is a number whose meaning cannot be
 * reconstructed after the next scenario lands.
 *
 * v1 — 392 plan 02 seeded 13 deterministic + the canon compound pair; 392 plan 08 flipped the four
 *      directive scenarios to `should_execute` before this manifest existed.
 * v2 — 392 plan 09 admits the `planner/` seeds (the live lane's natural-language arm).
 * v3 — 392 plan 09, after the FIRST live execution: `run-42-and-digest`'s digest clause names its
 *      run (the original was unsatisfiable under D-10's pre-flight atomicity — see that file), and
 *      `list-recent-runs` is re-authored as a request to DO something rather than a question about
 *      the project.
 * v4 — 392 plan 11, the gap round for 392-VERIFICATION's CR-03 and CR-04: two `compound/` cells
 *      admitted, both `fail_closed`, so the ceiling's `should_execute` denominators are unmoved
 *      (11 hermetic, 3 live) and the two defects the corpus could not see now have permanent
 *      cells. `pin-and-write-test` is the corpus's first HERMETIC compound cell — both halves are
 *      deterministic, and its lane is named as an exception in `scenario-manifest.test.ts` rather
 *      than derived from its class. The verifier's third probe (two overlapping sessions on one
 *      composition, CR-01/CR-02) is deliberately NOT a cell here: the scenario runner is
 *      single-turn by design, so it lands as a composition-level concurrency test in plan 392-12.
 */
export const SCENARIO_CORPUS_VERSION = 4

/**
 * One admitted scenario.
 *
 * Every field is a CLAIM the closure test checks against the file, rather than a convenience copy:
 * class and id address it, lane decides which gate runs it, and kind decides whether it counts
 * toward the `mark_unhandled` denominator.
 */
export interface ScenarioCorpusEntry {
  readonly id: string
  readonly class: ScenarioClass
  readonly lane: ScenarioLane
  readonly kind: ScenarioExpectationKind
}

const entry = (value: ScenarioCorpusEntry): ScenarioCorpusEntry => value

/**
 * The admitted set, in class order and then in the order each arrived.
 *
 * Deterministic scenarios run hermetic per commit; `planner` and `compound` run in the live-model
 * lane as a release gate (D-13). There is no third lane and no scenario outside this list.
 */
export const SCENARIO_CORPUS: readonly ScenarioCorpusEntry[] = Object.freeze([
  // --- deterministic: the ten canon aliases (392-02) -------------------------------------------
  entry({ id: 'run', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'status', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'test-ref', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'digest', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'proposals', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'fn', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  // The four directives. `executed: 0` on a `should_execute` arm is the SHAPE, not a compromise:
  // a directive names no capability, so it crosses the function layer zero times on a turn that
  // did exactly what was asked (392-08's flip).
  entry({ id: 'model', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'pin', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'help', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'quit', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  // --- deterministic: the three stage-1 edge scenarios (392-02) ---------------------------------
  entry({ id: 'quoted-conjunction', class: 'deterministic', lane: 'hermetic', kind: 'should_execute' }),
  entry({ id: 'near-miss-alias', class: 'deterministic', lane: 'hermetic', kind: 'fail_closed' }),
  // FLIPS TO should_execute when the authoring loop registers `write_test` (393/394). The flip is
  // that phase's arrival proof and it moves this line too, which is the point.
  entry({ id: 'fn-unknown-op', class: 'deterministic', lane: 'hermetic', kind: 'fail_closed' }),
  // --- planner: natural language, live lane (392-09) --------------------------------------------
  entry({ id: 'list-recent-runs', class: 'planner', lane: 'live', kind: 'should_execute' }),
  entry({ id: 'explain-flaky', class: 'planner', lane: 'live', kind: 'should_execute' }),
  // D-08's LIVE arm: a capability that has not shipped, phrased the way a person would phrase it.
  // The hermetic `fn-unknown-op` proves the backstop names an unknown op id; this proves the
  // planner cannot invent one from prose either.
  entry({ id: 'write-test-for-checkout', class: 'planner', lane: 'live', kind: 'fail_closed' }),
  // --- compound: the canon pair, live lane (392-02) ---------------------------------------------
  entry({ id: 'run-42-and-digest', class: 'compound', lane: 'live', kind: 'should_execute' }),
  entry({ id: 'write-test-2fa-and-run', class: 'compound', lane: 'live', kind: 'fail_closed' }),
  // --- compound: the two gap-round regression cells (392-11) -------------------------------------
  // The verifier's own probes, admitted so neither defect can return silently. Both are
  // `fail_closed`, so neither enters the ceiling denominator: what they add is the ability to SEE a
  // refused turn that carried something out, which `executed == 0` alone never could.
  entry({ id: 'run-42-and-delete-root', class: 'compound', lane: 'live', kind: 'fail_closed' }),
  entry({ id: 'pin-and-write-test', class: 'compound', lane: 'hermetic', kind: 'fail_closed' }),
])
