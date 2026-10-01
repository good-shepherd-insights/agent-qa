// The run's target-class vocabulary and the production refusal's re-export (Phase 401 D-05/D-06,
// 432-03 D-18).
//
// 2026-10-01 (432-19, D-14/D-15): THE RUN GATE'S RECIPES ARE DELETED. `buildRunRiskDescriptor`
// (the `run:start` descriptor the gate classified), `RUN_START_RISK_ACTION_NAME` and
// `buildRunDisclosure` (the sentence a person was asked to approve a run on) had no consumer after
// 432-13 removed the gate's call-site and nothing asks a person any more. What stays is the
// declaration vocabulary the production refusal folds over, and the refusal sentence itself.
//
// WHY IT LIVES IN agent-local/composition RATHER THAN IN cli. The CLI, the daemon and the
// dashboard all start runs, and a vocabulary that lives inside one surface is a vocabulary the
// other two re-derive. This module takes a PLAIN target-class value, never a `ResolvedTarget` and
// never anything else shaped like a CLI type — agent-local must not import the CLI.

/**
 * A target's declared environment, as the config carries it (`TargetSchema.environment`).
 *
 * `undefined` is a first-class member and means UNDECLARED — not "unknown, assume harmless".
 *
 * `production` (432-03, D-18) outranks every other class in a fold. A production run is refused
 * before any effect unless the config opts in (`refuseProductionWithoutOptIn`); one that is opted
 * in starts like any other run (432-13).
 */
export type RunTargetClass = 'local' | 'shared' | 'production' | undefined

// 432-04: the production refusal moved to schema, so the dashboard live editor (which may not
// import this package) shows the same sentence. Re-exported here so every existing consumer of
// this module keeps its import.
export {
  ALLOW_PRODUCTION_OPT_IN,
  buildProductionRefusal,
  distinctInFirstOccurrenceOrder,
} from '@vostride/agent-qa-schema'
