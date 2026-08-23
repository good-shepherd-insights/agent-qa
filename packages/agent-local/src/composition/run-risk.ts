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

/**
 * The sentence a person is asked to approve a run ON (401-14, D-11, W-1).
 *
 * ONE SPELLING, HERE, for `buildRunRiskDescriptor`'s own reason: a preview composed at each door
 * is a preview each door can word differently, and the whole point of one gate at `startRun` is
 * that every host's run is described to a person the same way. There is exactly one production
 * consumer — the core's single `evaluate()` call-site — and no door composes its own prose.
 *
 * DISPLAY-ONLY, UNDER THE SAME LAW AS THE FIELD IT FILLS. `RiskActionDescriptor.disclosure` is
 * never read by the classifier, so nothing here can move an action up or down the ladder: this
 * function names no tier, and `targetNames` reaches the descriptor through `disclosure` and
 * nowhere else. It is the human-readable projection of the same resolution that produced
 * `targetClass` — one resolution, two renderings — which is why the names arrive beside the class
 * rather than from a second pass a door made later (two passes are free to disagree, and a
 * disclosure that disagreed with the tier would be the worst possible version of this field).
 *
 * IT SAYS `undeclared` OUT LOUD. D-06 classifies an undeclared target as shared, and a preview
 * that rendered that as a bare "shared" would be telling a person the config says something it
 * does not. Both facts fit in one clause, so both are stated.
 *
 * AN EMPTY NAME LIST STILL YIELDS A SENTENCE. A run whose members declare no target at all is
 * exactly the case a person most needs told; an empty string here would render as no preview at
 * all and put this back where W-1 found it.
 *
 * IT ATTRIBUTES THE DECLARATION, IT DOES NOT ASSERT AN ENVIRONMENT (401-15, WR-06 · UAT test 4).
 *
 * The clause used to name ONE environment for the WHOLE member set, which is a claim the input
 * cannot support: the class arriving here is a FOLD over the members (most-restrictive-wins), and
 * a fold answer is a property of the set, not of any member. For `[shared, undefined]` the fold
 * answers `undefined`, and the sentence read
 *
 *     targets staging, weird (environment: undeclared, which classifies as shared)
 *
 * — telling a person that `staging` is undeclared when the config declares it `shared`. The tier
 * was right and the FACT was wrong, at the one moment somebody is deciding. So the clause now says
 * what the CONFIG DECLARES, scoped the way the fold actually scopes it: `every target` for the one
 * answer that really is universal, `at least one target` for the two that are existential. No
 * member is described as anything, so no member can be described as the wrong thing.
 *
 * IT STILL NEVER UNDERSTATES. `every target local` is reachable from exactly one fold answer, and
 * that answer is only produced when every member declared `local` — so a set carrying a shared or
 * undeclared member can never render the sentence that would invite a person to approve it as a
 * local run. That is the property this function is most dangerous without, and it is asserted.
 *
 * THE CLASSIFICATION CONSEQUENCE STAYS VISIBLE. `which classifies as shared` rides both undeclared
 * arms, because D-06 is the whole reason the tier is what it is, and a preview that dropped it
 * would leave a person reading `undeclared` with no idea why they were being asked at all.
 */
export function buildRunDisclosure(
  targetClass: RunTargetClass,
  targetNames: readonly string[],
): string {
  const declaration =
    targetClass === 'local'
      ? 'declared: every target local'
      : targetClass === 'shared'
        ? 'declared: at least one target shared'
        : targetNames.length === 0
          ? 'declared: nothing at all, which classifies as shared'
          : 'declared: at least one target undeclared, which classifies as shared'
  const targets = renderTargetNames(targetNames)
  return `Start a run against ${targets} (${declaration}).`
}

/**
 * The member names, as one noun phrase — the only place this function interpolates its input.
 *
 * Separate from the sentence above so the DECLARATION clause and the NAME list are two independent
 * things to get right: WR-06 is about what the clause claims, WR-01 is about what the names can do
 * to the line they sit on, and folding them into one expression is how a later edit to either one
 * quietly changes the other.
 */
function renderTargetNames(targetNames: readonly string[]): string {
  if (targetNames.length === 0) return 'no declared target'
  if (targetNames.length === 1) return `target ${targetNames[0]!}`
  return `targets ${targetNames.join(', ')}`
}
