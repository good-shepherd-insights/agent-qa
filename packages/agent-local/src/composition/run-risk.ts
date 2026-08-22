// The run gate's action descriptor (Phase 401, D-05 + D-06).
//
// ONE recipe, in one file, because the alternative measured badly before: a descriptor built at
// each call site is a classification each host can spell differently, and the whole point of the
// gate at `startRun` is that every host's run is classified the same way.
//
// WHY IT LIVES IN agent-local/composition RATHER THAN IN cli. The CLI, the daemon and the
// dashboard all start runs, and a recipe that lives inside one surface is a recipe the other two
// re-derive. This module therefore takes a PLAIN target-class value, never a `ResolvedTarget` and
// never anything else shaped like a CLI type — agent-local must not import the CLI, and the input
// being a bare union is what keeps that true by construction.

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

/**
 * A target's declared environment, as the config carries it (`TargetSchema.environment`).
 *
 * `undefined` is a first-class member and means UNDECLARED — not "unknown, assume harmless".
 */
export type RunTargetClass = 'local' | 'shared' | undefined

/**
 * The action name the CORE-level run gate classifies.
 *
 * DELIBERATELY NOT `fn:runs.start`, which is what the `runs.start` OP declares at the function
 * layer (`agent/src/functions/ops/runs-start.ts`). The two gates see two different actions and
 * that separation is load-bearing rather than cosmetic: a standing grant matches on the exact
 * action name (`grantCovers` → `grant.actionClass === action.name`), so approving the op can never
 * silently approve every run the op goes on to start, and vice versa. Each gets its own audit row.
 */
export const RUN_START_RISK_ACTION_NAME = 'run:start'

/**
 * Build the descriptor the run gate evaluates.
 *
 * THE TIER IS THE WHOLE DECISION (D-05, spec/v2/execution-safety.md §2.1):
 *
 * - `local` → `mutating-local`, which the ratified table allows in EVERY execution context. A run
 *   against a loopback fixture spends this machine's resources and touches nothing another party
 *   shares, so CI and the authoring loop keep working with no credential at all.
 * - `shared` → `mutating-shared` → ask → in any non-interactive context with no trust, a
 *   fail-closed denial. That is the criterion this phase's gate exists to enforce.
 *
 * AND UNDECLARED IS SHARED (D-06). `undefined` maps to `mutating-shared` HERE — one place, on the
 * restrictive side — rather than being defaulted away in the config schema where an honest
 * `shared` and a silence would become the same bytes. Nothing is quietly trusted because a URL
 * looked local; there are no URL heuristics in this file and there must not be.
 *
 * `recognized: true` with no `readOnly` puts the classifier's own floor at `mutating-local`, and
 * the declared tier is proposed alongside it — most-restrictive-wins, so the floor can only ever
 * agree with or be raised by the declaration, never lower it.
 *
 * COMPOSITION-DERIVED, NEVER CALLER INPUT (T-401-05). `targetClass` is the resolved config's own
 * declaration. A request field a caller could set would be a channel for moving an action down
 * the ladder, which is the one thing a classification input must not be.
 */
export function buildRunRiskDescriptor(
  targetClass: RunTargetClass,
  disclosure?: string,
): RiskActionDescriptor {
  return {
    name: RUN_START_RISK_ACTION_NAME,
    recognized: true,
    declaredTier: targetClass === 'local' ? 'mutating-local' : 'mutating-shared',
    // Display-only and never classified (schema law on `RiskActionDescriptor.disclosure`): what
    // THIS invocation is about to do, for the person a confirm prompt reaches. Omitted rather
    // than set to undefined so an undisclosed descriptor is byte-identical to one built before
    // this parameter existed.
    ...(disclosure === undefined ? {} : { disclosure }),
  }
}
