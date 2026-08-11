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
  renderFanOutPreview,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringDraftWriteInput,
  AuthoringDraftWriteOutput,
} from '@vostride/agent-qa-schema'

import { authoringFanOutBound, runAuthoringLoop } from '../../authoring/loop.js'
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
  // `mutating-shared`, AND THE CONTRAST WITH `authoring.draft.verify` IS THE POINT (394-08, D-03).
  //
  // The mechanics first: `recognized: true` with no `readOnly` puts the classifier's floor at
  // mutating-local, `declaredTier` raises it from there, and the name tokens (fn · authoring ·
  // draft · write) hit neither destructive lexicon — so the declared tier is what the gate sees.
  //
  // `authoring-verify-draft.ts` chose `mutating-local` and its argument was correct FOR IT: an
  // ask-tier op denies in every fail-closed context, and an evaluator that cannot verify a draft in
  // CI is a keep-filter that stops working exactly where it needs to run unattended. Verifying is
  // all cost and no consequence — gate-runs are `excludedFromOutcomes`, so they leave no trace a
  // colleague reads.
  //
  // THIS OP IS GENUINELY DIFFERENT, and it differs in the two ways that decide a tier. It SPENDS a
  // person's compute and model budget on their own machine — up to nine full child `agent-qa run`
  // processes against their application (D-10) — and from plan 10 the artifact it produces is
  // committed. So here the ask is the POINT rather than an obstacle: WTST-08's owner decision was
  // preview and honest reporting with NO enforced budget, which makes the disclosure at this confirm
  // the only control there is. An op that asked nobody would be an unbounded fan-out with a comment
  // about how expensive it is.
  //
  // WHAT THE RAISE COSTS, STATED RATHER THAN DISCOVERED. A fail-closed context — CI, the daemon,
  // any non-interactive host — now DENIES this op by name, and the gate's own reason line names the
  // ways out (`--trust-session`, a trust credential, a standing approval). That is the ratified
  // posture and not an oversight: an unattended host authoring nine child runs against an
  // application with nobody watching is the case the preview exists to prevent, and the disclosure
  // cannot do its job where there is nobody to read it.
  //
  // TWO DECISION POINTS AND NO MORE (D-03). This confirm, and 391's inbox accept. One approval here
  // starts a loop that then runs unattended, however many runs it consumes — there is no suspended
  // mid-loop approval state, no second confirm inside the loop, and no approval token threaded
  // through the stages for a later caller to replay.
  //
  // DO NOT HARMONISE THE TWO TIERS. They are different answers because the ops differ, and a later
  // edit making them match would either put the evaluator behind a prompt it cannot answer in CI or
  // remove the only consent this phase has.
  risk: {
    name: `fn:${AUTHORING_DRAFT_WRITE_FUNCTION_ID}`,
    recognized: true,
    declaredTier: 'mutating-shared',
  },
  // D-03's fan-out preview, rendered from the ONE bound function and from NOTHING ELSE.
  //
  // `authoringFanOutBound` is the single site that assembles the three terms, and
  // `renderFanOutPreview` is the single site that turns them into words. A sum spelled here would
  // be a second arithmetic for the same number, free to drift the moment `REPAIR_ITERATION_CAP` or
  // `DRAFT_STABILITY_RUNS_N` moves — and the direction it would drift in is the one WTST-08 forbids,
  // because the number a person already approved is the one that is too small.
  //
  // NO CALLER TEXT REACHES THE PROMPT. Only `draftMode` is read: `intent` is free text from an
  // arbitrary caller (T-394-06), and a confirm message it could write would let the asker dress up
  // what they are asking a person to approve, at the one moment the person is deciding.
  disclose(input: AuthoringDraftWriteInput): string {
    return renderFanOutPreview(authoringFanOutBound(input))
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
