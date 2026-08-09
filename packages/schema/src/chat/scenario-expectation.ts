// The routing scenario contract (Phase 392, CHAT-02 / D-13 / D-15).
//
// Routing is a TESTED CONTRACT rather than reviewer discipline: each scenario is a file, the
// corpus is versioned, and the `mark_unhandled` ceiling is computed over that frozen denominator.
// This module is the vocabulary those files are written in, minted in schema because three
// packages read it — the harness that runs a scenario, the meta-test that walks the resolver table
// looking for one, and the ceiling computation over the manifest.
//
// EXACTLY TWO EXPECTATIONS EXIST, and the smallness is the design. A scenario either says "this
// must be carried out" or "this must be refused with nothing carried out". There is no partial
// arm, because D-10's atomicity means there is no partial OUTCOME: a turn that could not route
// one clause executed zero of them.
//
// NO FRACTIONAL CONFIDENCE MEMBER EXISTS ANYWHERE IN THIS VOCABULARY, and its absence is load-
// bearing rather than an omission. Stage-1 resolution is binary by construction (D-09): an exact
// predicate hit, or nothing. A confidence field would be the first half of a threshold, and a
// threshold is precisely how an OVERRIDING path — one whose verdict beats a model's — acquires a
// false-positive rate. Precision 1.0 is a property of the mechanism, and a number here would make
// it a property of a tuning value instead.

import { z } from 'zod'

/** What a scenario asserts about its turn. Closed, spelled once (388 C13). */
export const SCENARIO_EXPECTATIONS = ['should_execute', 'fail_closed'] as const

export type ScenarioExpectationKind = (typeof SCENARIO_EXPECTATIONS)[number]

/**
 * The scenario classes (D-13's two lanes, three classes).
 *
 * `deterministic` scenarios never touch the LLM BY CONTRACT — which is why they need no mock, and
 * why "no mocks in either lane" is a true statement rather than an aspiration. `planner` and
 * `compound` run against a live model as a release gate.
 */
export const SCENARIO_CLASSES = ['deterministic', 'planner', 'compound'] as const

export type ScenarioClass = (typeof SCENARIO_CLASSES)[number]

/** Where a scenario runs. `hermetic` is per-commit CI; `live` is the release gate (D-13). */
export const SCENARIO_LANES = ['hermetic', 'live'] as const

export type ScenarioLane = (typeof SCENARIO_LANES)[number]

/**
 * What the turn must have done.
 *
 * `executed` is REQUIRED on both arms, and on the `fail_closed` arm it is the whole point: D-10's
 * claim is `executed == 0`, and an optional count would let a fail-closed scenario assert a
 * refusal while staying silent about whether anything ran on the way to it.
 *
 * `planned` is optional because it is only meaningful where a planner ran; `compound/` scenarios
 * that pin planned-equals-executed supply it, deterministic ones have nothing to say.
 *
 * `argsPin` is D-12's half: a scenario can pin the ARGUMENTS the executed op received, which is
 * how "the mapper's binding beat the model's" becomes an assertion rather than a hope.
 *
 * `namesClause` is D-08's: a fail-closed turn must name what it could not do, and a scenario that
 * only checked the status would pass against a silent drop.
 */
export const ScenarioExpectationSchema = z.object({
  kind: z.enum(SCENARIO_EXPECTATIONS),
  planned: z.number().int().nonnegative().optional(),
  executed: z.number().int().nonnegative(),
  ops: z.array(z.string()).optional(),
  argsPin: z.record(z.string(), z.unknown()).optional(),
  namesClause: z.string().optional(),
})

export const ChatScenarioSchema = z.object({
  id: z.string().min(1),
  class: z.enum(SCENARIO_CLASSES),
  lane: z.enum(SCENARIO_LANES),
  utterance: z.string().min(1),
  expect: ScenarioExpectationSchema,
})

export type ScenarioExpectation = z.infer<typeof ScenarioExpectationSchema>
export type ChatScenario = z.infer<typeof ChatScenarioSchema>
