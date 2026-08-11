// `authoring.draft.write` — the authoring loop as a catalogued capability (394, D-01).
//
// THE ONE PUBLIC ENTRY, AND THAT IS THE DESIGN. D-01 puts all six stages inside a single
// registered op rather than registering a stage each, because the stage ORDER is an invariant and
// a caller that could reach the stages independently could break it. 392 D-07 binds every registry
// op into the chat planner's toolset 1:1, so a `authoring.draft.compile` beside a
// `authoring.draft.verify` would be a planner that can verify a draft it never deduplicated, or
// author one it never read a brief for — and "dedup-before-author" would degrade from a property
// of the code into a hope about the plan the model happened to make. Everything below the surface
// still crosses the function layer: the loop reaches `authoring.draft.verify` through
// `invokeFunction`, so SC1's "every stage is a gated function-layer call" holds without the stages
// being separately dispatchable.
//
// THE ID IS `authoring.draft.write`, three lowercase dot segments, no underscore — the spelling
// `authoring-verify-draft.ts` reserved beside itself when it chose `authoring.draft.verify`. The
// two shipped mechanisms that force it are unchanged and were re-measured for this op:
//   1. `parity-coverage.test.ts` requires every registered id to match `^[a-z]+(?:\.[a-z]+)+$`
//      off the registry. `authoring.draft.write` matches; `authoring.draft_write` does not.
//   2. `chat/tool-names.ts` maps ids to provider-safe tool names by `.` ↔ `_` and REFUSES an id
//      that already carries `_`, because such a name has two pre-images under the inverse. Since
//      the planner binds every op, an underscore id would raise `ChatToolNameError` for the WHOLE
//      projection rather than merely looking unconventional (T-394-07).
// `draft` is the subject and `write` is the verb, so the pair reads `authoring.draft.{write,
// verify}` and 394's edit op joins as `authoring.draft.edit` (plan 09) with no renaming.
//
// THREE SCOPES, AND THE THIRD IS THE POINT. `authoring.draft.verify` declares `run` and `read`
// because its whole effect is the gate-runs it takes. This op does all of that AND writes a file
// into the user's workspace, so it declares `test-write` as well — the power declared where it is
// enforced (384's law), on the same reasoning the evaluator's own comment gives for refusing to
// declare only `run`: a caller holding `run` + `read` must not reach a file write through a nested
// call that this layer would otherwise have refused them. 394-01 minted `test-write` for exactly
// this declaration and proved the refusal by name; this is the op that spends it.
//
// THE MINTED CALLER NARROWS, NEVER WIDENS (T-394-05). Stage 4 dispatches
// `authoring.draft.verify` on a caller the composition mints with EXACTLY that op's two declared
// scopes — a subset of this op's three. The outer invocation has already been checked for all
// three, so nothing reachable through the inner caller was unreachable to whoever asked for the
// draft, and the inner call cannot reach anything `authoring.draft.verify` itself could not.
//
// INPUT REFUSAL IS THE FIRST HALF OF `invoke`, for the reason the evaluator states and one more:
// `intent` is free text from an arbitrary caller that reaches an LLM and then becomes bytes on
// disk (T-394-06). The schema refuses the shape; the shelf refuses what the model produced, by
// parsing before it writes.

import {
  AuthoringDraftWriteInputSchema,
  AuthoringDraftWriteOutputSchema,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringDraftWriteInput,
  AuthoringDraftWriteOutput,
} from '@vostride/agent-qa-schema'

import { runAuthoringLoop } from '../../authoring/loop.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const AUTHORING_DRAFT_WRITE_FUNCTION_ID = 'authoring.draft.write'

export const authoringDraftWriteSpec: FunctionSpec<
  AuthoringDraftWriteInput,
  AuthoringDraftWriteOutput
> = {
  id: AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  summary: 'Author a test for an intent, verify it against the keep-gates, and return its receipt.',
  requiredScopes: ['test-write', 'run', 'read'],
  resultKind: 'unary',
  // The WRITE half, which is the half that makes this op mutating: a host with no model and no
  // shelf cannot author at all. The read half is bound with it or not at all — see the invoke's
  // second check, which refuses on either half by the same name.
  boundThrough: 'draftShelf',
  input: AuthoringDraftWriteInputSchema,
  output: AuthoringDraftWriteOutputSchema,
  // `authoring.draft.verify`'s tier argument, and it lands in the same place for the same
  // reasons — plus one this op adds. `recognized: true` with no `readOnly` puts the classifier's
  // floor at mutating-local; `declaredTier` states that tier rather than relying on the floor; the
  // name tokens (fn · authoring · draft · write) hit neither destructive lexicon.
  //
  // `mutating-local` and not `mutating-shared`, even though this op writes a file. What it writes
  // is a DRAFT on the gitignored shelf — `tests/.agent-qa-drafts/`, invisible to suite discovery
  // and to `git`, staged so a run can verify it — and nothing here reaches the authored suite or
  // any shared signal. Acceptance is what puts a draft into the repository, and acceptance is a
  // person's decision on 391's inbox (D-05), behind an op of its own. Raising the tier here would
  // ASK in every context and DENY in fail-closed ones, which would leave the loop unable to author
  // in CI while still not being the place the shared write actually happens.
  //
  // Plan 08 raises the ask to the dispatch confirm with D-03's fan-out preview. That is one gate
  // at one decision point; a second one here would be a second prompt for one act.
  risk: {
    name: `fn:${AUTHORING_DRAFT_WRITE_FUNCTION_ID}`,
    recognized: true,
    declaredTier: 'mutating-local',
  },
  async invoke(input, deps) {
    // `invokeFunction` already refused this composition on `draftShelf`, so reaching here with no
    // port means an in-layer caller holding the spec directly; the refusal is the same named error
    // either way (384, D-09).
    const shelf = deps.draftShelf
    const read = deps.authoringRead
    // BOTH halves, by the SAME name. `boundThrough` names one key, and a host missing the read
    // half would otherwise list this op `bound` and then serve an EMPTY brief — a draft compiled
    // against nothing this project knows, indistinguishable at the caller from one compiled
    // against everything it knows. That is the answer this check exists to make impossible.
    if (shelf === undefined || read === undefined) {
      throw new FunctionNotBoundError(AUTHORING_DRAFT_WRITE_FUNCTION_ID)
    }

    const result = await runAuthoringLoop(
      {
        intent: input.intent,
        scope: input.scope,
        ...(input.draftMode === undefined ? {} : { draftMode: input.draftMode }),
      },
      { read, shelf },
    )

    // Projected arm-agnostically, which is what lets plans 05-06 land a branch inside the loop and
    // reach this line unchanged. The two optional spreads carry a `drafted` invocation's draft and
    // receipt and are simply absent on a stage-2 refusal, which has neither.
    //
    // THE REFUSAL PAYLOAD IS READ OFF THE SCREENING, not off the outcome. The `refused` arm of
    // `AuthoringLoopOutcome` stays exactly the shape 394-02 declared — it is a discriminant, not a
    // carrier — and what a refusal has to NAME is a fact about the dedup screening that produced
    // it. Reading it here is what makes D-04's refuse-and-LINK reach a caller at all: a chat
    // surface told `refused` with no `refusal` could report that something matched but never say
    // what, and re-invoking is the only continuation this stateless design offers.
    const outcome = result.outcome
    const dedup = result.dedup
    return {
      outcome: outcome.kind,
      ...(outcome.draftRef === undefined ? {} : { draftRef: outcome.draftRef }),
      ...(outcome.receipt === undefined ? {} : { receipt: outcome.receipt }),
      ...(dedup.kind === 'duplicate'
        ? {
          refusal: {
            filePath: dedup.evidence.matched.filePath,
            testName: dedup.evidence.matched.testName,
            matchedRef: dedup.evidence.matchedRef,
            score: dedup.evidence.score,
            threshold: dedup.evidence.threshold,
            sharedTokens: dedup.evidence.sharedTokens,
            comparedTests: dedup.comparedTests,
            continuations: [...dedup.continuations],
          },
        }
        : {}),
    }
  },
}
