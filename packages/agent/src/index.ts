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
// 391 D-16/D-17: the per-run digest's id, on exactly the footing of the three above. The CLI's
// `digest` verb, the tail's digest block and the exit-line fetch pointer all have to put this
// name on the wire, and the alternative is a string literal in each — a second declaration of a
// capability's name, free to drift. An ID is not a dispatch handle.
export { RUNS_DIGEST_FUNCTION_ID } from './functions/ops/runs-digest.js'
// 392 plan 07: the run LISTING's id, on the same footing. The `status` alias resolves to it, so the
// composed compound e2e's assertion that the second clause really dispatched there must break when
// the op is renamed — which it cannot if the test compares against a string it spelled itself
// (387 D-11's imported-not-literal rule). A string is not a dispatch handle.
export { RUNS_LIST_FUNCTION_ID } from './functions/ops/runs-list.js'
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
// 392 D-24: the chat turn entry's id, plus the id of the ONE op the tracer's deterministic table
// resolves to. Both on exactly the footing of the constants above — a name a surface puts on the
// wire, never a dispatch handle.
//
// `AGENT_ASK_FUNCTION_ID` is the one a production surface names: `agent-qa ask` and the REPL both
// reach the turn engine through `invokeFunction` with this id, which is what makes chat a CLIENT of
// the function layer rather than a holder of a private power (§3's L10 law).
//
// `PROPOSALS_LIST_FUNCTION_ID` is published for the resolver table's rule that ids are IMPORTED,
// never literal (387 D-11): the tracer's cross-package assertion that the executed clause really
// dispatched to the proposals listing must break when that op is renamed, and it cannot if it is
// comparing against a string it spelled itself.
export { AGENT_ASK_FUNCTION_ID } from './functions/ops/agent-ask.js'
export { PROPOSALS_LIST_FUNCTION_ID } from './functions/ops/proposals-list.js'
export { createTurnEngine } from './chat/turn-engine.js'
export { CHAT_HELP_TEXT, CHAT_RESOLVER_TABLE, resolveClause } from './chat/resolver-table.js'
export { deterministicOverrideStrategy, unhandledReason } from './chat/reconcile.js'
// 392 plan 10, D-16: the two halves of the dotted-id ↔ provider-safe tool-name mapping that a
// reader of a MODEL PLAN needs. Published because plan 10's mutation proof composes the real host
// with a reconciliation strategy that trusts the model's plan verbatim — the override-OFF arm —
// and such a strategy has to turn a tool name back into the id the function layer answers to. A
// differential that spelled its own `.` ↔ `_` rename would be a second catalogue, which is the
// exact drift `tool-names.ts` exists as one module to prevent, and it would let the off-arm fail
// for a reason that has nothing to do with the override being off.
//
// Neither is a dispatch path. `isChatMetaToolName` answers a boolean about a string;
// `fromToolName` REFUSES the two orchestration names and otherwise returns a string. Nothing on
// either side of the mapping can reach a registry, a capability or a host API, and an id that
// nothing registered still dies at `invokeFunction`'s own named refusal.
//
// `ANSWER_ONLY_TOOL_NAME` joins them in 392-14 for the same reason and no other. Removing
// `PlannerStageOutcome.answer` left those two differentials — whose whole content is the ABSENCE of
// a read of `input.mapped` — needing to re-derive the turn-level prose carry they deliberately
// model, and the only alternative was a literal `'answer_only'` in each of them: the second
// catalogue this module exists to prevent, in the files least able to afford one.
export { ANSWER_ONLY_TOOL_NAME, fromToolName, isChatMetaToolName } from './chat/tool-names.js'
// 392 plan 02, D-09: the real conjunction grammar. Published because the composition root binds
// it as the engine's `ClauseSplitter`, and it REPLACES the tracer's whole-utterance splitter,
// which is deleted rather than left beside it — one bound answer, not two available ones.
export { splitClauses } from './chat/clause-split.js'
// 392 plan 03, CHAT-05 / D-19: what a damaged session file MEANS, and what a resumed session
// remembers. Published because every storage adapter has to reach the SAME verdict about a
// half-written log — `agent-local`'s JSONL adapter and its in-memory twin both call `repairSession`
// on the resume path, and M5's session reader will too. A second adapter deciding for itself
// whether a turn dangled is two hosts disagreeing about whether a conversation happened.
//
// Neither is dispatch and neither can reach a host capability: both are pure functions over
// records, with no filesystem, no model and no registry anywhere in their reach.
export { repairSession, replaySession } from './chat/session-repair.js'
// 392 plan 05, D-21: the session pin holder and its refusal. Published because the two things
// that consume it are BOTH outside this package — the composition root that binds
// `asGateDeny()` as the gate's session overlay, and the REPL that catches `ChatPinError` to tell
// a person their class matched nothing. Neither is dispatch and neither can loosen anything: the
// holder has no unpin, the DTO has no allow list, and the predicate answers a boolean whose only
// true branch makes the gate refuse. What the factory reaches is the registry LISTING, so a pin
// is validated against declarations and cannot touch a capability.
export { ChatPinError, createPinOverlay } from './chat/pin-overlay.js'
export type { ChatPinOverlayHolder } from './chat/pin-overlay.js'
// 392 plan 08, RESEARCH Open Q2: the live turn state. Published because its two consumers are the
// composition root that creates it and the REPL that renders from it, and neither is in this
// package. It is a plain in-memory container — no fs, no model, no dispatch, and no subscription
// — and the module head carries the ratified reason it is not the SDK's `AbstractChat` yet.
export { createChatState } from './chat/chat-state.js'
export type {
  ChatLastTurn,
  ChatStateContainer,
  ChatStateSnapshot,
  CreateChatStateInput,
} from './chat/chat-state.js'
// 392 plan 08, D-23: the chat-open banner. Published because the only surface that opens a chat is
// the REPL, in `cli`. It composes REGISTERED reads through the invoke binding it is handed, holds
// no reader of its own, and has no timer — the suite pins the last of those as source text,
// because a scheduler would pass every behavioural case.
export { composeBanner } from './chat/banner.js'
// 392 plan 09, D-15 / CHAT-03: the frozen corpus and the one validator that reads a scenario back.
// Published because the two lane runners live outside this package — the hermetic gate in
// `agent-local` and the live gate in `cli` — and both must iterate THE SAME admitted list. A
// manifest each runner assembled for itself would be two denominators, which is the treadmill this
// list exists to stop. Neither export can reach a host: the manifest is a frozen array of records,
// and `parseScenario` takes an already-decoded document precisely so no file reader lives in a
// storageNeutral package.
export { parseScenario, scenarioRelativePath } from './chat/scenario-loader.js'
// 392 plan 09, CHAT-03 / D-15: the pinned ceiling and the ONE projection over `mark_unhandled`
// rows. Published because the same function has to serve two readings that must never disagree —
// the harness's rate over the frozen corpus, and a live deployment's field rate over its session
// logs. A second counter somewhere else would be a second definition of what a refusal is.
export { MARK_UNHANDLED_CEILING, ceilingExceeded, computeMarkUnhandledRate } from './chat/ceiling.js'
export type { MarkUnhandledCounts } from './chat/ceiling.js'
export { SCENARIO_CORPUS, SCENARIO_CORPUS_VERSION } from './chat/scenarios/manifest.js'
export type { ScenarioCorpusEntry } from './chat/scenarios/manifest.js'
// 392 plan 06, CHAT-04 / D-20: the compaction trigger policy. Published because the ONLY thing
// that can bind it is outside this package — the composition root, which is also the only place
// holding a `TokenAccounting` instance and a session log to emit onto. An unpublished hook would
// be a seat declared in `ports.ts` with no reachable way to fill it.
//
// The two constants ride along deliberately. They are the numbers D-20 pins, and a pin nobody can
// READ is a pin a second surface re-spells with a different value; publishing them is what lets a
// later conformance assertion name them rather than a literal. Neither is dispatch, neither is a
// host capability, and the hook reaches a model only through the accounting instance it is HANDED
// — it cannot construct one, cannot resolve capabilities, and cannot reach a provider.
export {
  CHAT_MINIMUM_CONTEXT,
  COMPACTION_RATIO,
  createChatCompactionHook,
  maybeCompact,
  replayToModelMessages,
} from './chat/compaction.js'
export type {
  ChatCompactionHookDeps,
  ChatDegradeOptions,
  ChatDegradeOutcome,
  ChatTokenAccounting,
  CompactionPass,
  CompactionPassInput,
} from './chat/compaction.js'
export type { TurnEngine, TurnEngineDeps } from './chat/turn-engine.js'
// 392 plan 07, D-04 / CHAT-05: what a session's configuration IS, as the drift check compares it.
// Published as types only — the diff and the fold stay internal to the engine, because the one
// caller that could reach them is the engine itself and a published differ would be a second place
// a `model_change` could be born. What the composition root needs is the ability to NAME the state
// it re-reads per turn, which is exactly these two.
export type { ChatConfigState, ChatToolsetFingerprint } from './chat/config-drift.js'
// 392 plan 07, CHAT-01 / CHAT-06 / D-07: stage 2, published because plan 04 built it and this is
// the plan that BINDS it — the composition root is its only caller, exactly as that plan said.
//
// Neither value is a private power. `projectPlannerTools` reads the registry LISTING and emits
// execute-less tools: what it produces cannot run anything, by the absence of a callback rather
// than by a promise. `createPlannerStage` takes an already-built model and answers with a PLAN;
// it names no provider, cannot construct a model, and the arch rollcall reds the build if that
// stops being true. `ChatLanguageModel` rides along because a composition root that binds a model
// must be able to name the one shape allowed here — an object, never a model id a global registry
// would resolve by constructing a client (CHAT-06's second door, closed at the type).
export { createPlannerStage } from './chat/planner-stage.js'
export { projectPlannerTools } from './chat/planner-tools.js'
export type { ChatLanguageModel } from './chat/planner-stage.js'
// The repair contract's own vocabulary. A caller that could invoke `repairSession` but not NAME
// what it hands over or gets back would spell the shapes again locally, which is the second
// vocabulary this subtree is written to avoid (388 C13).
export type {
  ChatReplayMessage,
  RepairSessionOptions,
  SessionLogLine,
  SessionRepair,
  SessionReplay,
} from './chat/session-repair.js'
// 392 plan 02: `ChatResolution` joins the three plan-01 shapes because it is what the published
// `resolveClause` now RETURNS — a two-variant union with no confidence member, and pinning it on
// the barrel is what makes a third variant (or a number) a visible edit rather than an incidental
// one. `ChatDirectiveName` rides along because the entry union names it.
export type {
  ChatDirectiveName,
  ChatResolution,
  ChatResolverEntry,
  ChatResolverRule,
  ChatResolverTable,
} from './chat/resolver-table.js'
// 392 plan 04: stage 2's contract vocabulary. `PlannerStagePort` already named an outcome shape;
// now that shape is the model's RAW plan — unexecuted tool calls plus the optional prose answer and
// the optional typed transport failure — and the three pieces are published for the reason the
// repair contract's were: a composition root that can supply a planner but cannot NAME what one
// answers with would spell the shapes again locally (388 C13). None of them is dispatch: a tool
// call is a description of an intention, and the only thing that can act on one is the reconciler.
//
// 392 plan 07: `ClauseAction` and the stage name it carries. An execute verdict's steps now say
// WHICH stage proved each binding, because the caller a clause runs under is decided by that fact
// and by nothing else (Pitfall 1) — and a consumer holding a verdict it cannot fully NAME would
// spell the shape again locally, which is the second vocabulary this subtree avoids (388 C13).
// 392 plan 08: the directive handlers and the live-state sink. Both are seats a COMPOSITION fills
// — the handlers are how `/model` and `/pin` stop being refusals, and the sink is how a surface
// learns the turn id it would otherwise never see. Types only; nothing here dispatches.
export type {
  CallerMint,
  ChatBindingStage,
  ChatClause,
  ChatDirectiveHandlers,
  ChatInvokeBinding,
  ChatModelDirectiveOutcome,
  ChatTurnStateSink,
  ClauseAction,
  ClauseSplitter,
  CompactionHook,
  PlannerStageFailure,
  PlannerStageOutcome,
  PlannerStagePort,
  PlannerToolCall,
  ReconcileInput,
  ReconcileStrategy,
  ReconcileVerdict,
  ResolvedClause,
} from './chat/ports.js'
export type { ChatTurnPort } from './functions/spec.js'

// 391-06: the clustered BLOCK layout, relocated here from the CLI when it acquired its second
// caller (`runs.digest`'s first section). Published on the same footing as the sentence renderer
// below and for the same reason — one layout, imported, never a second composition per surface.
// Pure string work over an op result: no fs, no model, no store, no dispatch. It sits ahead of
// its sibling because the barrel pin compares by the barrel's OWN order.
export { renderAnalysisClusterBlock } from './analysis/render-cluster-block.js'

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
