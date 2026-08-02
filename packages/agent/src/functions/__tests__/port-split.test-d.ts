// The read/write port split, pinned where it is decided (Phase 387 plan 06, KREV-01 / Pitfall 2).
//
// WHY A `.test-d.ts` AND NOT A `.test.ts`. Every claim in this file is a claim about an
// INTERFACE, and this package's `vitest.config.ts` sets `typecheck.include` to `*.test-d.ts`
// only — so a `.test.ts` is type-stripped by esbuild and never checked. 387-02 measured that
// blindness directly: deleting a field from `StepEvidence` outright left all 702 runtime cases
// green. A runtime assertion here would have been a control that cannot fail, and "the reader
// port has no write member" is exactly the sort of claim that reads like proof while pinning
// nothing.
//
// It lives under `__tests__/` rather than beside the module it pins. That is not taste: the
// arch dependency extractor treats any file OUTSIDE a `__tests__` directory as production
// source, so a `.test-d.ts` sibling of `spec.ts` typechecks fine and then fails `validate:arch`
// with `packages/agent external deps: unexpected vitest` (387-04 hit this exact trap). The
// vitest `typecheck.include` glob matches either location.

import { expectTypeOf } from 'vitest'

import type {
  FunctionDeps,
  KnowledgeApplyOutcome,
  KnowledgeProposalRequest,
  KnowledgeReaderPort,
  KnowledgeReviewPort,
  OptionalFunctionDepKey,
  RunsReaderPort,
  StepEvidenceLookup,
} from '../spec.js'

// ---- 1. The reader port carries NO write-shaped member ----------------------------------------
//
// Stated as an EXACT member set rather than as "does not have propose". A negative check per
// forbidden name is a list somebody has to remember to extend, and the write verb that arrives
// under a name nobody thought of is precisely the one it would miss. Exact equality fails on
// ANY arrival, which is the drift this pin exists to catch — including a `commit`, an `apply`,
// or a plausible-looking `promote`.
expectTypeOf<keyof KnowledgeReaderPort>().toEqualTypeOf<
  'listBundles' | 'inspectRecords' | 'diffSince' | 'showRecord'
>()

// The same claim from the other side, and it is not redundant with the one above: it is what
// makes a WIDENING of the reader into the review port a compile error rather than something a
// reviewer has to notice. If someone folded the mutating verbs into the reader, this line would
// start passing — so it is asserted to be false.
expectTypeOf<KnowledgeReaderPort>().not.toMatchTypeOf<KnowledgeReviewPort>()

// ---- 2. The write port is OPTIONAL and joins the reporting vocabulary --------------------------
//
// `OptionalFunctionDepKey` is what makes an absent binding a VISIBLE `unbound` rather than a
// call that fails far away, and `spec.ts` requires every further optional member to join it.
// Pinned as an exact union so an optional dep can never arrive without that reporting: adding
// `knowledgeReview?` to `FunctionDeps` and forgetting this union would leave the mutating verbs
// unable to declare what they are bound through.
expectTypeOf<OptionalFunctionDepKey>().toEqualTypeOf<'runInvocation' | 'knowledgeReview'>()

// Every member of that union must actually be an optional member of the deps record — the half
// that would otherwise let the union name a dep nobody supplies.
expectTypeOf<OptionalFunctionDepKey>().toMatchTypeOf<keyof FunctionDeps>()
expectTypeOf<FunctionDeps['knowledgeReview']>().toEqualTypeOf<KnowledgeReviewPort | undefined>()
expectTypeOf<FunctionDeps['knowledge']>().toEqualTypeOf<KnowledgeReaderPort>()

// The review port's own surface, pinned for the same exact-set reason as the reader's: 387-08
// implements against this and a third member arriving quietly would be a third power no host
// declared.
expectTypeOf<keyof KnowledgeReviewPort>().toEqualTypeOf<'propose' | 'apply'>()
expectTypeOf<KnowledgeProposalRequest['verb']>().toEqualTypeOf<'accept' | 'reject' | 'forget'>()
expectTypeOf<KnowledgeApplyOutcome['forgetReceipt']>().toBeNullable()

// ---- 3. The step-evidence read distinguishes four situations, not two -------------------------
//
// The why-verb's honesty rests on telling "no such run" from "no such step" from "your address
// matches more than one step". A `StepEvidence | undefined` return would have collapsed all
// three into one silence, and the arm that matters most — ambiguity — would have been reported
// as an absence. Pinned as the exact discriminant set.
expectTypeOf<StepEvidenceLookup['kind']>().toEqualTypeOf<
  'found' | 'run-not-recorded' | 'step-not-found' | 'ambiguous-step-address'
>()

// The read is on the RUNS port, never the knowledge port. That placement is the whole reason
// re-running retrieval is not a temptation the why-verb has to resist: its substrate is a run's
// recorded evidence, and the op is handed no serving capability at all.
expectTypeOf<RunsReaderPort>().toHaveProperty('readStepEvidence')
expectTypeOf<KnowledgeReaderPort>().not.toHaveProperty('readStepEvidence')
