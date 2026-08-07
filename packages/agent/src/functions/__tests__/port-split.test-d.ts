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

import type { BriefWhyInput, QuarantineOperationsPort } from '@vostride/agent-qa-schema'
import { expectTypeOf } from 'vitest'

import type { mapStepEvidenceToWhy } from '../ops/knowledge-brief-why.js'
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
// 388 D-14 extends the union BY NAME rather than relaxing the equality: `postProcessing` is the
// third optional member, and the pin is what forced this line to be edited in the same change
// that added it — which is the whole mechanism.
// 389 D-10/D-08 extend it again, by name again: `analysis` (the artifact reader analysis.get
// binds through) and `recurrence` (the live-join seam the renderer consumes — optional because
// its absence is an honest no-history clause, never a refusal). The pin fired on both.
// 390 D-12/D-13 extends it a fourth time, by name again: `quarantine` — the committed ledger's
// three verbs. It fired on this one too, and that is the whole mechanism working: `tsc` refused
// the union edit until this line acknowledged it. (Note the dual-witness rule — vitest reported
// `Type Errors  no errors` for the same tree; only `tsc --noEmit` saw it.)
// 391 PROP-03 extends it a fifth time, by name again: `proposalsInbox` — the enumerable inbox's
// three verbs. It fired on this one too, and once more only under `tsc --noEmit`.
// 391 PROP-01 / D-03 extends it a sixth time, by name again: `standingGrants` — the committed
// grant ledger's list/record/revoke. It fired on this one too. Note that `record` is a member of
// the PORT and of no registered op, so this union is also the only place a reader can see that the
// mint capability exists at all: the accept escalation is its one caller.
expectTypeOf<OptionalFunctionDepKey>()
  .toEqualTypeOf<
    | 'runInvocation'
    | 'knowledgeReview'
    | 'postProcessing'
    | 'analysis'
    | 'recurrence'
    | 'quarantine'
    | 'proposalsInbox'
    | 'standingGrants'
  >()

// Every member of that union must actually be an optional member of the deps record — the half
// that would otherwise let the union name a dep nobody supplies.
expectTypeOf<OptionalFunctionDepKey>().toMatchTypeOf<keyof FunctionDeps>()
expectTypeOf<FunctionDeps['knowledgeReview']>().toEqualTypeOf<KnowledgeReviewPort | undefined>()
expectTypeOf<FunctionDeps['knowledge']>().toEqualTypeOf<KnowledgeReaderPort>()
// 390: the same two-sided claim for the quarantine dep — named in the union AND optional on the
// record, so neither half can arrive alone. The port TYPE is minted in schema (both `agent` and
// knowledge-local consume it and neither may import the other), which is why this is the one
// member here whose type is not declared in `spec.ts`.
expectTypeOf<FunctionDeps['quarantine']>().toEqualTypeOf<QuarantineOperationsPort | undefined>()
// Exactly three verbs, pinned for the same exact-set reason the review port's surface is: a
// fourth power arriving quietly would be one no host ever declared it could supply.
expectTypeOf<keyof QuarantineOperationsPort>().toEqualTypeOf<'list' | 'release' | 'add'>()

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

// ---- 4. The why-verb's ANSWERING function is handed no deps ------------------------------
//
// This is the structural half of D-15's "never re-runs retrieval". `mapStepEvidenceToWhy`
// decides what the answer is, and its parameter list is exactly (lookup, input) — so there is
// no handle in its scope through which any index could be reached, and an edit that gave it
// one would have to change this signature. The op's `invoke` does receive the full deps record
// (every op does); that it touches only `deps.runs` is a SOURCE claim, scanned and probed in
// `brief-why-source.test.ts`. The two are different strengths of guarantee and are pinned
// separately on purpose.
expectTypeOf<Parameters<typeof mapStepEvidenceToWhy>>().toEqualTypeOf<
  [StepEvidenceLookup, BriefWhyInput]
>()
