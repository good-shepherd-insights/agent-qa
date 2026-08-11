// The type-level half of SC-2 (Phase 394, D-08 · WTST-04).
//
// SC-2's claim is about what is NOT REACHABLE, and a behavioural corpus can only ever say what a
// particular input produced. Three things are pinned here that no runtime cell can pin:
//
//   1. `FindingRoute` and `RepairRoute` are MUTUALLY NON-ASSIGNABLE. Two records differing only by
//      a `kind` literal are assignable in enough directions to make this cell decorative, so each
//      arm carries a required field the other does not have and both directions are asserted.
//   2. `PostVerifyRoute['kind']` is pinned by EQUALITY, not by a list of per-arm assertions.
//      Per-arm assertions can only say what IS there; a third arm quietly added — or one of the
//      two quietly dropped — passes every per-arm cell and fails only this line.
//   3. NEITHER EXPORTED FUNCTION CAN BE HANDED MODEL OUTPUT. The parameter lists are pinned as
//      EXACT TUPLES, so a model, a prompt, or any model-produced string threaded in as a third
//      argument is a type error here. This is T-394-17's mitigation expressed as a type: the
//      model writes a finding's explanation and never chooses the branch, and the only way to make
//      that structural rather than customary is to leave it no parameter to arrive through.
//
// This file IS typechecked. `packages/agent/vitest.config.ts` sets `typecheck.include` to
// `src/**/*.test-d.ts`, which is exactly this pattern and NOT `*.test.ts` — the sibling
// `router.test.ts` is not typechecked by vitest at all, and `tsc --noEmit` remains the only type
// authority for it.

import { expectTypeOf } from 'vitest'

import type {
  CompletedRunHandoff,
  DraftRef,
  VerdictSource,
} from '@vostride/agent-qa-schema'

import type {
  FindingRoute,
  PostVerifyRoute,
  RepairRoute,
  RouterEvidenceChannel,
  RouterFindingSignalClass,
  RouterMechanicsSignalName,
  RouterRepairSignalClass,
  RouterSignalClass,
  RunEvidenceRef,
} from '../router.js'
import type { classifyFailureEvidence, routeRepairOrFinding } from '../router.js'

// ---- 1. the two arms are mutually unreachable ---------------------------------------------

declare const repair: RepairRoute
declare const finding: FindingRoute

// `toExtend` and not the deprecated `toMatchTypeOf`, which expect-type 1.3 superseded.
//
// HOW A NEGATED PIN FAILS, since the failure mode is not obvious: `not.toExtend<E>()` takes zero
// arguments only while the assertion HOLDS. The moment the two arms become assignable the
// signature grows a required mismatch parameter and the call reads `Expected 1 arguments, but
// got 0` — so the pin reds by arity, at this exact line, rather than by silently passing.
expectTypeOf(repair).not.toExtend<FindingRoute>()
expectTypeOf(finding).not.toExtend<RepairRoute>()
expectTypeOf<FindingRoute>().not.toExtend<RepairRoute>()
expectTypeOf<RepairRoute>().not.toExtend<FindingRoute>()

// Each arm is a member of the union, so the non-assignability above is a statement about two
// live arms rather than about two types that merely happen to be unrelated.
expectTypeOf(repair).toExtend<PostVerifyRoute>()
expectTypeOf(finding).toExtend<PostVerifyRoute>()

// The REQUIRED fields that carry the separation. An arm stripped of the field the other lacks
// stops satisfying its own type, so making `mechanics` or `evidenceRefs` optional — the one
// edit that would quietly restore assignability in both directions — reds here first.
expectTypeOf<{
  kind: 'repair'
  signalClass: RouterRepairSignalClass
  failingStepIndex: number | null
}>().not.toExtend<RepairRoute>()
expectTypeOf<{
  kind: 'finding'
  signalClass: RouterFindingSignalClass
  failurePoint: null
}>().not.toExtend<FindingRoute>()

// And the whole field sets, by equality: a field added to either arm, or dropped, fails here.
expectTypeOf<keyof RepairRoute>().toEqualTypeOf<
  'kind' | 'signalClass' | 'mechanics' | 'failingStepIndex'
>()
expectTypeOf<keyof FindingRoute>().toEqualTypeOf<
  'kind' | 'signalClass' | 'failurePoint' | 'evidenceRefs'
>()

// ---- 2. the union's arm set, by equality ---------------------------------------------------

expectTypeOf<PostVerifyRoute['kind']>().toEqualTypeOf<'repair' | 'finding'>()
expectTypeOf<RepairRoute['kind']>().toEqualTypeOf<'repair'>()
expectTypeOf<FindingRoute['kind']>().toEqualTypeOf<'finding'>()

// The two signal-class partitions do not overlap and together exhaust the routable classes, so
// an arm cannot be handed a class the other arm owns.
expectTypeOf<RepairRoute['signalClass']>().toEqualTypeOf<RouterRepairSignalClass>()
expectTypeOf<FindingRoute['signalClass']>().toEqualTypeOf<RouterFindingSignalClass>()
expectTypeOf<RouterRepairSignalClass>().toEqualTypeOf<'execution-mechanics'>()
expectTypeOf<RouterFindingSignalClass>().toEqualTypeOf<
  'clean-definitive-assertion-fail' | 'mixed-evidence' | 'indefinitive-failure'
>()
expectTypeOf<RouterSignalClass>().toEqualTypeOf<
  RouterRepairSignalClass | RouterFindingSignalClass | 'no-failure' | 'no-run-evidence'
>()

// The closed mechanics and evidence-channel vocabularies, pinned the same way: a signal the
// router can name but no corpus row covers, or a channel silently dropped, fails here.
expectTypeOf<RouterMechanicsSignalName>().toEqualTypeOf<
  | 'termination'
  | 'planning-failure'
  | 'cycle'
  | 'stagnation'
  | 'member-timeout'
  | 'member-cancelled'
>()
expectTypeOf<RouterEvidenceChannel>().toEqualTypeOf<
  'step-trace' | 'state-before' | 'state-after'
>()

// ---- 3. no model output can reach the routing decision -------------------------------------

expectTypeOf<Parameters<typeof routeRepairOrFinding>>().toEqualTypeOf<
  [draftRef: DraftRef, handoff: CompletedRunHandoff | undefined]
>()
expectTypeOf<ReturnType<typeof routeRepairOrFinding>>().toEqualTypeOf<PostVerifyRoute>()

expectTypeOf<Parameters<typeof classifyFailureEvidence>>().toEqualTypeOf<
  [draftRef: DraftRef, handoff: CompletedRunHandoff | undefined]
>()
expectTypeOf<ReturnType<typeof classifyFailureEvidence>>().toEqualTypeOf<RouterSignalClass>()

// The finding arm's verdict source is the RUN's recorded one, never a free-form string a model
// could have written into it.
expectTypeOf<NonNullable<FindingRoute['failurePoint']>['verdictSource']>()
  .toEqualTypeOf<VerdictSource | undefined>()

// An evidence ref is a COORDINATE. Its key set is pinned by equality, so a payload smuggled onto
// it — a screen state, an element tree, a rendered snapshot — fails here rather than showing up
// in whatever durable record a later plan writes the finding into.
expectTypeOf<keyof RunEvidenceRef>().toEqualTypeOf<
  'runId' | 'filePath' | 'testName' | 'stepIndex' | 'subActionIndex' | 'channel'
>()
