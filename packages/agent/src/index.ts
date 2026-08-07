export type {
  AuthoringReadPort,
  KnowledgePort,
  ToolsPort,
  PersistencePort,
  ClockPort,
} from './ports/index.js'

// 384 FUNC-01 — the typed function layer.
//
// `invokeFunction` is the ONLY exported way to run a capability, and it always crosses
// the policy gate. `FunctionSpec` (declaration + implementation), the spec-level
// `invoke`, the registry internals, and `createRegistryFromSpecs` are all deliberately
// absent from this barrel: exporting any of them would hand a surface a dispatch path
// that skips the gate (T-384-01). The arch barrel assertion pins this exact export set.
export { createFunctionRegistry, DuplicateFunctionIdError } from './functions/registry.js'
export type { CreateFunctionRegistryOptions, FunctionRegistry } from './functions/registry.js'
export {
  invokeFunction,
  FunctionDeniedError,
  FunctionInputError,
  FunctionNotBoundError,
  FunctionOriginError,
  FunctionScopeError,
  UnknownFunctionError,
} from './functions/invoke.js'
// 388 D-14 adds `PostProcessingChainState`, `PostProcessingJobRow` and
// `PostProcessingReaderPort` below: the durable chip-truth read port and the two shapes it
// answers with. Types, so none of them carries a database across this barrel — the only value
// that ever implements the port is built by a composition in the one package sqlite is legal
// in, and `invokeFunction` is still the only dispatch. They are here so a composition root can
// NAME what it supplies; `postProcessing` is an OPTIONAL member, so a host that omits it is
// making a statement rather than forgetting.
//
// The rationale lives ABOVE the clause and not inside it, and that is load-bearing rather than
// stylistic: the arch barrel pin strips comments before it grows a multi-line clause, a
// stripped comment line becomes a blank one, and a blank line ENDS the clause — so a comment
// between two names here does not annotate the export, it deletes every export in the
// statement from the pinned set.
export type {
  AnalysisArtifactReaderPort,
  ConfigReaderPort,
  EntityDirectoryPort,
  FunctionBindingStatus,
  FunctionDeclaration,
  FunctionDeps,
  FunctionResultKind,
  FunctionStream,
  KnowledgeApplyOutcome,
  KnowledgeProposalRequest,
  KnowledgeProposeOutcome,
  KnowledgeReaderPort,
  KnowledgeReviewPort,
  OptionalFunctionDepKey,
  PostProcessingChainState,
  PostProcessingJobRow,
  PostProcessingReaderPort,
  ReplayedRunEvent,
  RunInvocationPort,
  RunsReaderPort,
  StartedRun,
  StepEvidenceAddress,
  StepEvidenceLookup,
} from './functions/spec.js'
// Caller-facing refusals a surface may legitimately catch and report. Op-level errors live
// with the op that throws them; only the error CLASS crosses the barrel, never the spec.
export { RunNotFoundError } from './functions/ops/runs-get.js'
export { RunNotRecordedError } from './functions/ops/runs-start.js'
export { StreamReplayFloorError } from './functions/ops/runs-events.js'
// 387 ENTY-02: the caller-facing refusal for an address nothing ever minted. A permanently
// minted address whose entity was tombstoned still resolves (D-04) — this is not that case.
export { EntityNotFoundError } from './functions/ops/entities-get.js'
// 387 KREV-02: the why-verb's one refusal. `stepIndex` is numbered per member test, so an
// address that names no test can match two steps; the verb refuses rather than answering
// about whichever test came first, and a surface catches this to say which testIds to pick
// between.
export { AmbiguousStepAddressError } from './functions/ops/knowledge-brief-why.js'
// 387-08 D-18: the ONE op id a surface must be able to NAME rather than infer. A host that
// delegates an apply to the writer-lease holder has to put an id on the wire, and the alternative
// is a string literal in the CLI — a second declaration of a capability's name, free to drift from
// the spec that answers to it. An ID is not a dispatch handle: naming a capability still buys
// nothing without a registry, a caller and the gate.
export { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID } from './functions/ops/knowledge-review-ids.js'
// 388 D-14: the second op id a surface must be able to NAME, on exactly the footing above. The
// CLI's exit summary line (plan 04) dispatches chip truth through the registry, and the
// alternative is a string literal in the CLI — a second declaration of a capability's name,
// free to drift from the spec that answers to it. An ID is not a dispatch handle.
export { RUNS_POST_PROCESSING_FUNCTION_ID } from './functions/ops/runs-post-processing.js'
// 389 D-11: the third op id a surface must be able to NAME, on the same footing as the two
// above. Plan 07's CLI sentence block and the D-12 exit-line fetch hint both dispatch the
// analysis read through the registry, and the alternative is a string literal in the CLI — a
// second declaration of a capability's name, free to drift. An ID is not a dispatch handle.
export { ANALYSIS_GET_FUNCTION_ID } from './functions/ops/analysis-get.js'
// 390 D-13: the three quarantine verb ids, on exactly the footing of the three constants above.
// A later plan's CLI verbs and M5's quarantine management both have to put a name on the wire,
// and the alternative is a string literal in each surface — a second declaration of a
// capability's name, free to drift. An ID is not a dispatch handle.
//
// The SPECS themselves are deliberately absent, as every other op's are: `FunctionSpec` carries
// the implementation and the live validators, so exporting one would hand a surface a dispatch
// path around `invokeFunction`'s gate (T-384-01) — which for two verbs that write the committed
// ledger is precisely the escalation this plan's threat register names (T-390-11).
export { QUARANTINE_ADD_FUNCTION_ID } from './functions/ops/quarantine-add.js'
export { QUARANTINE_LIST_FUNCTION_ID } from './functions/ops/quarantine-list.js'
export { QUARANTINE_RELEASE_FUNCTION_ID } from './functions/ops/quarantine-release.js'

// 389 D-05/D-08: THE sentence renderer, and the recurrence seam it joins through. The value
// is a pure string composer over typed parts — no fs, no model, no store — published so plan
// 07's CLI print and every later surface import THIS symbol rather than composing a second
// sentence (SC3's "no second code path" is structural, not reviewed). The three port types
// are what a composition root implements to bind the seam: 389 bound it to v51's run-outcome
// projection (plan 06), and 390-06 rebound the SAME seam to its fingerprint window plus the
// committed ledger's ladder state (`RecurrenceLadder`, published for the same reason its
// siblings are — the composition root names it in the function that computes it). None of this
// is dispatch and none of it reaches storage, so publishing it opens no path around
// `invokeFunction`.
export { renderVerdictSentence } from './analysis/render-sentence.js'
export type {
  RecurrenceAnswer,
  RecurrenceLadder,
  RecurrenceProvider,
  RecurrenceQuery,
} from './analysis/render-sentence.js'

// 389 D-13..D-16: render-time pure clustering over the one fingerprint vocabulary. A total
// deterministic function of (resolved verdicts, handoff) — no store, no port, no minted
// identity (the cluster DTO carries the fingerprint value, count and member refs ONLY; a
// short-ID or an address here would be a second problem-identity vocabulary beside the issue
// engine's, which is exactly what D-16 forbids). Published so plan 07's CLI block and every
// later surface fold through ONE function rather than re-deriving groups.
export { clusterVerdicts } from './analysis/cluster.js'
export type { AnalysisCluster, AnalysisClusterMember } from './analysis/cluster.js'

// The human display boundary (v48 masking discipline): surfaces render function-layer
// results as prose, and prose is the sole unmasking surface.
//
// What that boundary does TODAY, stated before the reason it is published. It is a no-op.
// The two CLI surfaces this phase built — `renderStream` and `emitHuman`, in
// packages/cli/src/commands/fn.ts:107-146 — each construct a FRESH masking context and
// register nothing in it, and the only `.register(` call in non-test CLI source is in
// commands/run.ts:949, on an unrelated path. An empty context has nothing to substitute
// back, so unmasking is currently the identity function on every surface built here and
// disposing it clears nothing. Wiring a run-scoped context into human rendering is Phase
// 386's, with its daemon and live surfaces.
//
// The helpers are published now because 386's wiring must not have to widen the firewall to
// happen. The FUNC-02 surface allow-list is exactly {agent, schema} and D-01 forbids new
// code from ever joining the legacy ledger, so a surface reaching the safety package
// directly would be a firewall violation with no legal repair; re-exporting the two helpers
// here is what keeps that later wiring an ordinary, non-breaking change. This is research
// Open Question 1, resolved as Pitfall 4 option (a) — STAGED, not currently load-bearing.
//
// They are safe to publish on this barrel precisely because they are NOT dispatch: neither
// one can resolve, gate, or run a capability, so re-exporting them opens no path around
// `invokeFunction` (T-384-01). Both belong to the pinned export set the plan-07 barrel
// assertion freezes.
export { createMaskingContext, unmaskForHumanOutput } from '@vostride/agent-qa-safety'

// 385 JOBQ-01/JOBQ-02 — the agent job queue: its store port, its per-kind registry, and the
// pumpable engine over both.
//
// What is published is the CONTRACT and the two constructors a composition root calls. What
// is absent is any way to reach storage without the port: no store implementation, no
// checkpoint reader, no path helper. `agent` is storageNeutral, so a host capability
// arriving on this barrel would be a class violation with no legal repair — the store lives
// in `agent-local` and is handed in as a port at composition time.
//
// The refusals are exported as CLASSES because a caller legitimately distinguishes them:
// losing store authority means "another writer is ahead of you, stand down", while an
// undeclared successor or checkpoint means "this handler's declaration is wrong". A single
// opaque error would collapse an operational condition and a programming error together.
//
// No model accessor is exported here and none may ever be (D-11 layer 1): a job's only path
// to a model is the authorship primitive's callback argument, so a handler cannot reach one
// on its own, and the resume path therefore cannot re-invoke one by any route at all.
// The DTO vocabulary itself is NOT republished here (385 plan 02). The request, checkpoint
// envelope and handler outcome are schema's, and a consumer reaches them there — a second
// route to the same names is how two spellings of one contract start to drift.
export { JobCancellationNotRequestedError, StaleJobStoreEpochError } from './ports/index.js'
export type {
  ChainTerminalRecord,
  ClaimNextOptions,
  JobCancelOutcome,
  JobCheckpointRecord,
  JobCheckpointReadOutcome,
  JobClaimOutcome,
  JobCompleteOutcome,
  JobEnqueueOutcome,
  JobFailureDisposition,
  JobInsert,
  JobStoreDump,
  JobStoreDumpRow,
  JobStoreFence,
  JobStorePort,
} from './ports/index.js'
export {
  createJobKindRegistry,
  DuplicateJobKindError,
  IncompleteJobKindDeclarationError,
  InconsistentJobKindDeclarationError,
  UnknownJobKindError,
} from './jobs/kind-registry.js'
export type {
  FallbackContinuationInput,
  FallbackContinuationProducer,
  JobBackoffPolicy,
  JobHandler,
  JobHandlerContext,
  JobKindDeclaration,
  JobKindRegistry,
  JobPermanentFailureDisposition,
} from './jobs/kind-registry.js'
// 385 plan 04 — the six real kinds. A composition root registers THESE; the declarations are
// the contract the crash matrix iterates, and the handlers are deterministic stand-ins until
// the phases that own each kind's semantics replace them.
export { createRealJobKindRegistry, REAL_JOB_KIND_DECLARATIONS } from './jobs/kinds.js'
export type { PostRunJobCapabilities, StandInJobScript } from './jobs/kinds.js'
// 388 Pattern 2: THE post-run chain's id derivation. A value rather than a type because the
// chip projection, the chain-terminal check and every later reader must ADDRESS the same
// three rows from a runId alone — two copies of this hash input would be two chains that look
// identical in review. It reaches no storage and holds no capability: given a runId and an id
// source it returns three strings, which is why publishing it opens nothing.
export { chainJobIdsForRun } from './jobs/chain-identity.js'
export type { ChainJobIds } from './jobs/chain-identity.js'
export {
  createAgentJobQueue,
  JobCancelledError,
  MissingIdempotencyKeyError,
  UndeclaredJobCheckpointError,
  UndeclaredJobSuccessorError,
} from './jobs/engine.js'
export type {
  AgentJobQueue,
  CancelJobInput,
  CreateAgentJobQueueOptions,
  JobIdSource,
  RanJobOutcomeBase,
  RecoverAbandonedClaimsInput,
  RecoverAbandonedClaimsOutcome,
  RunNextJobInput,
  RunNextJobOutcome,
} from './jobs/engine.js'
// 385 plan 05 — the one memoizing checkpointed effect (D-10). The primitive is published so
// every later handler binds THIS contract rather than a private copy of its conditional; the
// capability beside it is a TYPE a composition root implements, and there is still no accessor
// on this barrel that could hand anyone one (D-11 layer 1).
export { recordLlmAuthorship } from './jobs/record-llm-authorship.js'
export type {
  BoundRecordLlmAuthorship,
  JobAuthorCallback,
  JobCheckpointContext,
  JobModelCapability,
  JobModelOutput,
  JobModelRequest,
  JobRecordedValueOutcome,
} from './jobs/record-llm-authorship.js'
