// The function-layer contract types (Phase 384, FUNC-01 / D-08 / D-09 / D-14 / D-15).
//
// `FunctionDeclaration` is the public, capability-free VIEW of an op: everything a
// surface needs to discover, describe, and project the capability (MCP tool listings,
// the 397 golden snapshot, the `agent-qa fn --list` catalog) and nothing that runs it.
// `FunctionSpec` adds the LIVE input/output validators and the implementation, and NEVER
// leaves this directory — the package barrel exports the declaration type only, so no
// surface can acquire a dispatch path that skips `invokeFunction`'s gate call (T-384-01),
// nor a handle on the schema objects that dispatch enforces with (T-384-14).

import type { EventLogPort } from '@vostride/agent-qa-runner'
import type { z } from 'zod'

import type {
  CompletedRunHandoff,
  EntityDescriptor,
  EntityResolution,
  ForgetReceiptV1,
  FunctionScope,
  InspectRecordView,
  JobStatus,
  KnowledgeAcceptInput,
  KnowledgeBundleSummary,
  KnowledgeForgetInput,
  KnowledgeApplyOutcomeKind,
  KnowledgeProposalV1,
  KnowledgeRecordShowInput,
  KnowledgeRecordShowResult,
  KnowledgeTargetRef,
  KnowledgeRecordsDiffInput,
  KnowledgeRecordsInspectInput,
  KnowledgeRejectInput,
  MaskedResolvedConfig,
  QuarantineOperationsPort,
  RecordChange,
  RiskActionDescriptor,
  RunAnalysisArtifact,
  RunId,
  RunNotification,
  RunsStartInput,
  StepEvidence,
} from '@vostride/agent-qa-schema'

import type { RecurrenceProvider } from '../analysis/render-sentence.js'
import type { ChainJobIds } from '../jobs/chain-identity.js'
import type { JobIdSource } from '../jobs/engine.js'

/**
 * How an op returns its result (D-08).
 *
 * `unary` resolves ONE value, validated against the spec's `output` contract.
 * `stream` resolves a {@link FunctionStream} whose elements each honour that same
 * `output` contract — the contract describes one element, never the iterable.
 */
export type FunctionResultKind = 'unary' | 'stream'

/**
 * A stream op's result (D-08): a typed async iterable of seq-stamped elements.
 *
 * Connection-independent by construction — every element carries its own resume token, so
 * a caller that observed token N re-invokes with that token and receives N + 1 onward.
 * Nothing about the iterable is bound to the transport that produced it, which is why
 * 386's live attach and this phase's completed-run replay are the SAME contract.
 */
export type FunctionStream<Element = unknown> = AsyncIterable<Element>

/**
 * One replayed run event, defined AS the element type the runner's `EventLogPort.read`
 * yields. Binding it to the runner contract rather than restating the envelope means the
 * layer cannot drift out of step with the log the runner actually writes.
 */
export type ReplayedRunEvent = ReturnType<EventLogPort['read']>[number]

/**
 * Whether the op's implementation is bound in THIS composition (D-09). A declared-but-
 * unbound op is a visible state, never a silent gap: coverage checks must treat
 * `unbound` as covered-but-unbound rather than as an absent capability.
 *
 * It is a property of a COMPOSITION, not of a spec, and since 385 (D-16) it is computed
 * that way: the field lives on {@link FunctionDeclaration} — which a registry mints from
 * the deps it was handed — and on no spec. A spec that carried a static `'bound'` would be
 * making a claim about compositions it is not part of, and the first composition that
 * omitted the implementation would report `bound` and lie. There is no literal to flip.
 */
export type FunctionBindingStatus = 'bound' | 'unbound'

/**
 * The OPTIONAL members of {@link FunctionDeps} — the deps whose presence varies by host.
 *
 * A spec naming one of these in {@link FunctionSpec.boundThrough} is bound exactly in the
 * compositions that supplied it. This union is the whole vocabulary: a capability cannot
 * become conditionally bound on something the deps record does not declare, so "which
 * compositions can run this op" is answerable by reading two lines.
 */
export type OptionalFunctionDepKey =
  | 'runInvocation'
  | 'knowledgeReview'
  | 'postProcessing'
  | 'analysis'
  | 'recurrence'
  | 'quarantine'

/**
 * The capability is declared, but no implementation is bound in THIS composition (D-09).
 *
 * Deliberately distinct from `UnknownFunctionError`: the contract exists, is listed, and
 * projects into a catalog — what is absent is the binding. A caller (or a coverage check)
 * that could not tell those two apart would read a staged capability as a hole in the API,
 * which is the silent gap `bindingStatus` exists to prevent.
 *
 * Declared here beside {@link FunctionBindingStatus} rather than beside the pipeline's
 * other refusals so an unbound op can throw it without an op → invoke → registry → op
 * import cycle; `invoke.ts` re-exports it, so the layer's refusal vocabulary still reads
 * as one set at the call site.
 */
export class FunctionNotBoundError extends Error {
  constructor(readonly functionId: string) {
    super(`${functionId} is declared but not bound in this composition`)
    this.name = 'FunctionNotBoundError'
  }
}

/**
 * The scalar metadata every capability carries, shared by the public view and the
 * internal spec.
 *
 * `id` is dot-namespaced `domain.verb` (D-15) over the fixed domain taxonomy
 * (tests · runs · memory · analysis · eval · gates · config · agent).
 *
 * The two CONTRACT fields are deliberately NOT here. They are the one place the view and
 * the spec must differ in kind — a projection on one, a live validator on the other — and
 * splitting them out is what makes that difference a property of the type system rather
 * than a rule someone has to remember at the seam (BL-01 / T-384-08).
 */
export interface FunctionMetadata {
  id: string
  /** One-line human description; rendered by catalogs and `agent-qa fn --list`. */
  summary: string
  /** Capability scopes a caller's grants must cover. Enforced in `invokeFunction`. */
  requiredScopes: readonly FunctionScope[]
  /**
   * This op may only be run on behalf of a person (391 D-06). Enforced in `invokeFunction`.
   *
   * The self-grant rule, expressed as DATA on the op rather than as a rule about callers. An op
   * that widens what the agent may do without asking — accepting a proposal, revoking a standing
   * grant — cannot be the agent's own decision to make, and the alternative spelling for that is
   * `if (caller.surface === 'chat')` in the dispatch path, which is the private-powers pattern
   * this whole layer abolishes. Here the requirement is declared where the capability is, checked
   * once, and visible on the declaration a listing renders.
   *
   * `true` is the only value: `requiresHumanOrigin: false` and an absent field would be two
   * spellings of the same permission, and a boolean invites a caller-supplied one.
   *
   * OPTIONAL because the overwhelming majority of ops genuinely do not care who is asking —
   * reads, run starts, everything the agent is supposed to do autonomously. A required field
   * would have made every spec state an opinion it does not have.
   */
  requiresHumanOrigin?: true
  resultKind: FunctionResultKind
  /** The descriptor this op projects into for the policy gate. */
  risk: RiskActionDescriptor
}

/**
 * An INERT description of one declared contract: a JSON-Schema document, deep-frozen.
 *
 * A projection has no `parse` and no `safeParse` — there is nothing on it to run and
 * nothing on it to replace. That is the whole point. The surface-visible view used to
 * carry the live `z.ZodType`, and because ops assign the schema package's own exported
 * validators, a single write reached through a permitted `registry.list()` replaced the
 * contract vocabulary every firewalled surface imports, for the whole process. Publishing
 * a projection removes the object that write needed rather than adding a rule about it.
 *
 * D-14 already named the input contract "also the JSON-Schema projection source"; on the
 * declaration that description is now literal, and it is the shape 396's MCP tool listing
 * consumes.
 */
export type FunctionSchemaProjection = Readonly<Record<string, unknown>>

/**
 * The public, capability-free description of one registered capability.
 *
 * Carries no live validator and nothing runnable: every value reachable through a
 * declaration is data. `invokeFunction` reads the enforcing schema off the {@link
 * FunctionSpec} instead, which never leaves this directory.
 */
export interface FunctionDeclaration extends FunctionMetadata {
  /**
   * Whether THIS composition can run the op (D-09/D-16).
   *
   * Computed by the registry from the deps it was constructed with, never copied off a
   * spec. A listing is therefore a fact about the host a caller is talking to: the same
   * capability reads `bound` from a composition that supplied its implementation and
   * `unbound` from one that did not, and `invokeFunction` refuses on exactly that answer.
   */
  bindingStatus: FunctionBindingStatus
  /** Inert JSON-Schema projection of the runtime input contract (D-14). */
  input: FunctionSchemaProjection
  /**
   * Inert JSON-Schema projection of the runtime output contract (D-14).
   *
   * For a `unary` op the underlying contract describes the whole result. For a `stream`
   * op it describes ONE element, never the iterable, and a catalog reads this projection
   * as the element schema its transport (SSE frame, MCP notification) carries.
   */
  output: FunctionSchemaProjection
}

/**
 * INTERNAL: metadata plus the LIVE contracts plus the implementation. Deliberately absent
 * from the package barrel — exporting this type (or any helper taking one and running it)
 * would hand a surface a private power, which is precisely what the function layer
 * abolishes.
 *
 * A spec is NOT a declaration: it extends the shared scalar metadata and re-declares the
 * two contract fields as live `z.ZodType`s. `invokeFunction` is the only reader of those,
 * and it reaches them through the module-private internals seam.
 */
export interface FunctionSpec<Input = unknown, Output = unknown> extends FunctionMetadata {
  /**
   * The OPTIONAL dep this implementation dispatches through, when it has one (D-16).
   *
   * Absent — the ordinary case — means the implementation needs only the required deps,
   * which every composition supplies by type, so the op is bound wherever it is registered.
   * Present means the op is bound exactly in the compositions that supplied that dep, and
   * `unbound` everywhere else. This field is the whole of a spec's say in the matter: a
   * spec states what its implementation NEEDS, and the composition's answer to that need is
   * what the declaration reports.
   */
  boundThrough?: OptionalFunctionDepKey
  /** Runtime input contract (D-14) — the validator `invokeFunction` enforces with. */
  input: z.ZodType<Input>
  /**
   * Runtime output contract (D-14).
   *
   * For a `unary` op this is the contract for the whole result, and `invokeFunction`
   * validates against it. For a `stream` op it is the contract for ONE element: parsing
   * the iterable itself against it would be a category error.
   */
  output: z.ZodType<Output>
  invoke(input: Input, deps: FunctionDeps): Promise<Output>
}

/**
 * INTERNAL: metadata plus live contracts plus the implementation for a `stream` op (D-08).
 *
 * `Element` is what the declared `output` contract describes — ONE element, never the
 * iterable. The stream is ACQUIRED inside `invoke` rather than lazily on first iteration,
 * so an acquisition refusal (a resume token below the replay floor, say) surfaces as an
 * invocation failure instead of as a stream that dies half-delivered.
 *
 * A stream spec is registered by widening to {@link FunctionSpec}: the registry stores one
 * spec shape, and `invokeFunction` branches on the DECLARED `resultKind`, never on what
 * the implementation happens to return.
 */
export interface FunctionStreamSpec<Input = unknown, Element = unknown>
  extends FunctionMetadata {
  boundThrough?: OptionalFunctionDepKey
  resultKind: 'stream'
  input: z.ZodType<Input>
  output: z.ZodType<Element>
  invoke(input: Input, deps: FunctionDeps): Promise<FunctionStream<Element>>
}

/**
 * Injected read port over the completed runs recorded for a project.
 *
 * `packages/agent` is `storageNeutral`: no host builtin is importable here. Every byte of run
 * state arrives through this port, built at the composition root over the concrete
 * `runner-local` handoff store.
 */
export interface RunsReaderPort {
  /** Every completed run this project can load. Missing run storage yields `[]`. */
  list(): Promise<readonly CompletedRunHandoff[]>
  /**
   * One completed run by id, or `undefined` when no such run is recorded.
   *
   * Absence is a RESULT, not an error: the typed refusal is the op's to throw, so the
   * "not found" vocabulary lives in this layer rather than in every composition root.
   * Implementations resolve the id against the runs they already enumerate — never by
   * joining a caller-supplied string onto a filesystem path (T-384-08).
   */
  get(runId: RunId): Promise<CompletedRunHandoff | undefined>
  /**
   * Replay one run's recorded event stream, starting at `fromSeq` and in `seq` order.
   *
   * The exact `EventLogPort.read(fromSeq)` contract the v49 bus already replays against,
   * lifted behind a port so this layer needs no host access. A run with no recorded
   * events replays as an ordinary empty result — nothing was truncated, so nothing is
   * refused. When events below `fromSeq` existed but are no longer available, the
   * implementation rejects with the runner's `ReplayIncompleteError` carrying the lowest
   * seq it can still serve; the op turns that into the layer's typed refusal. Serving a
   * silently truncated prefix is the one thing an implementation may never do.
   */
  readEvents(runId: RunId, fromSeq: number): Promise<readonly ReplayedRunEvent[]>
  /**
   * Read back ONE step's persisted evidence — the substrate `knowledge.brief.why` answers
   * from (Phase 387, KREV-02 / D-15).
   *
   * On the RUNS port and not on the knowledge port, and that placement is the whole honesty
   * argument rather than filing. A step's evidence is a record of what happened during a run;
   * the knowledge index is a record of what is true now. Answering "why did the brief say
   * this" out of the second would answer a different question than the one asked, and the op
   * that answers it is given no serving capability at all, so re-running retrieval is not a
   * temptation it has to resist.
   */
  readStepEvidence(
    runId: RunId,
    address: StepEvidenceAddress,
  ): Promise<StepEvidenceLookup>
}

/**
 * Which step's evidence is wanted.
 *
 * `testId` is optional and its optionality is the never-guess contract, not a convenience:
 * `StepEvidence.stepIndex` is numbered per MEMBER TEST, so a run with two tests has two step
 * 0s and `(runId, stepIndex)` addresses neither of them. A single-test run needs no
 * disambiguator; a multi-test run that omits it has asked an ambiguous question, and the
 * lookup says so by name rather than answering about whichever test happened to be first.
 */
export interface StepEvidenceAddress {
  readonly stepIndex: number
  readonly testId?: string
}

/**
 * What a step-evidence read found — four situations a caller phrases four different ways.
 *
 * A bare `StepEvidence | undefined` was the obvious shape and it is the wrong one: it
 * collapses "no such run was ever recorded", "that run has no such step" and "your address
 * matches more than one step" into one silence. The why-verb has to distinguish the first two
 * (its no-trace vocabulary already does, and a surface tells the reader to go looking in one
 * case and not the other), and it must never treat the third as an absence — an ambiguous
 * address answered with a `not found` would be a wrong answer wearing an honest one's clothes.
 */
export type StepEvidenceLookup =
  | { readonly kind: 'found'; readonly evidence: StepEvidence }
  | { readonly kind: 'run-not-recorded' }
  | { readonly kind: 'step-not-found' }
  | { readonly kind: 'ambiguous-step-address'; readonly testIds: readonly string[] }

/**
 * Injected read port over the committed knowledge store.
 *
 * Backed by the knowledge-local `/reader` package entry at the composition root. The
 * writer-gated main entry is unreachable from this layer by construction.
 */
export interface KnowledgeReaderPort {
  /** Every committed bundle, already projected to the schema-owned listing row. */
  listBundles(): Promise<readonly KnowledgeBundleSummary[]>
  /**
   * The maintenance view of every record matching a closed structural filter (KREV-01).
   *
   * Wiring over the reader entry's own `inspectRecords`, and the return type says so: it is
   * that function's view schema and not a paraphrase of it. KREV-01's "no new memidex code"
   * claim survives only while that stays literally true, and the first field of a paraphrase
   * to drift would be the one nobody looked at.
   */
  inspectRecords(input: KnowledgeRecordsInspectInput): Promise<readonly InspectRecordView[]>
  /** Every record change since a build ordinal — the reader entry's `diffSince`, wired. */
  diffSince(input: KnowledgeRecordsDiffInput): Promise<readonly RecordChange[]>
  /**
   * One record with the provenance that justifies it, or a named absence.
   *
   * Absence is a RESULT here rather than a refusal the port throws, because a record id that
   * names nothing is an ordinary reviewer question and not a broken store. The op renders the
   * answer; it never decides what "found" means.
   */
  showRecord(input: KnowledgeRecordShowInput): Promise<KnowledgeRecordShowResult>
}

/**
 * Injected WRITE capability over knowledge review — accept, reject and forget (Phase 387,
 * KREV-01 / D-17, declared here and implemented in 387-08).
 *
 * A SEPARATE port from {@link KnowledgeReaderPort}, and separate is the point. Widening the
 * reader with propose/apply would have handed a write path to every composition that only
 * ever wanted to list bundles — including the read-only surfaces the physically-separate
 * reader entry exists to keep write-free — and no lint could have told the two apart
 * afterwards, because they would have been one type. The split is what keeps "this host can
 * read knowledge" and "this host can change it" two different, separately answerable
 * questions.
 *
 * OPTIONAL on {@link FunctionDeps} and joined to {@link OptionalFunctionDepKey} for the same
 * reason `runInvocation` is: a host that cannot mutate knowledge — a listing registry, a
 * read-only surface, a daemon before it holds the writer lease — must report that as a
 * VISIBLE `unbound` on the verbs by name, not as a call that fails somewhere far away.
 *
 * Two verbs and not five, because the mutating half is two STEPS rather than three verbs
 * (D-17): propose computes the typed deltas and commits nothing; apply routes a minted
 * proposal's deltas through the Curator's single commit path. Which verb is being proposed
 * is data on the request, so a fourth review verb later is a new arm rather than a new
 * member — and a port whose member set grows with the vocabulary is a port every host has to
 * be re-taught.
 */
export interface KnowledgeReviewPort {
  /**
   * Compute what a verb WOULD change and mint a proposal for it. Commits nothing.
   *
   * The receipt preview a forget carries is computed here for the same reason: "show me what
   * would be removed" has to be answerable before anything is removed, or the answer arrives
   * too late to act on.
   */
  propose(request: KnowledgeProposalRequest): Promise<KnowledgeProposeOutcome>
  /**
   * Apply a minted proposal by id, routing its deltas through the one commit path (D-18).
   *
   * Takes an ID rather than a proposal document: a caller that could hand back an edited
   * proposal would be able to apply deltas nothing ever computed, which is the whole reason
   * the two steps are two steps.
   */
  apply(proposalId: string): Promise<KnowledgeApplyOutcome>
}

/**
 * Which review verb is being proposed, with the input that verb takes.
 *
 * Discriminated rather than a widened single input, so `reject`'s required reason cannot be
 * omitted by asking for an accept — the arms carry genuinely different obligations and a
 * union is where a type system can enforce that.
 */
/**
 * What proposing produced, or the named absence (387-08).
 *
 * 387-06 declared `propose` as returning a proposal outright. A target ref that names nothing is
 * an ordinary reviewer mistake rather than a broken store — an id pasted out of a stale issue, a
 * record forgotten between two reads — and the plan's own contract is "a typed not-found, never
 * a throw". A bare proposal cannot carry that answer, so the port returns this union instead, on
 * exactly the reasoning D-1 applied to `showRecord`.
 */
export type KnowledgeProposeOutcome =
  | { readonly kind: 'proposed'; readonly proposal: KnowledgeProposalV1 }
  | { readonly kind: 'target-not-found'; readonly target: KnowledgeTargetRef }

export type KnowledgeProposalRequest =
  | { readonly verb: 'accept'; readonly input: KnowledgeAcceptInput }
  | { readonly verb: 'reject'; readonly input: KnowledgeRejectInput }
  | { readonly verb: 'forget'; readonly input: KnowledgeForgetInput }

/**
 * What an apply reports: the proposal in its applied state, and — for a forget — the receipt.
 *
 * The receipt is a separate field rather than the whole return value because D-04 gives it a
 * second life as the permanent card content a forgotten entity's address resolves to. A value
 * that had to be dug out of a proposal wrapper to serve that use would have been designed for
 * one use plus an unwrapping step.
 */
export interface KnowledgeApplyOutcome {
  /**
   * Whether THIS call is the one that committed (387-08).
   *
   * Not decoration, and not on the interface 387-06 declared. Applying a proposal twice is an
   * ordinary thing for a retrying surface to do, and the second call has to be able to say
   * "already applied, here is what it did" — which an outcome with no discriminant cannot say,
   * and which a throw would say while discarding the receipt the caller asked for.
   */
  readonly outcome: KnowledgeApplyOutcomeKind
  readonly proposal: KnowledgeProposalV1
  /** Present exactly when the applied verb was `forget` (D-19). */
  readonly forgetReceipt?: ForgetReceiptV1
}

/**
 * Injected read port over the entity directory (Phase 387, ENTY-01 / D-09).
 *
 * Two verbs, and the split is the never-guess contract expressed as a type. `resolve` takes
 * anything a human or a model might say and answers with a closed three-arm union, so a
 * caller is structurally unable to receive a maybe. `get` takes an address that already
 * exists and answers with the entity or with nothing.
 *
 * Descriptor-level on purpose. The port carries FACTS about an entity and never a card,
 * which is what leaves exactly one card producer in this layer (ENTY-02): a composition
 * cannot render, because it is handed no vocabulary in which to do so.
 *
 * `get` may not mint. `resolve` sights, and sighting is what assigns a permanent address
 * (D-01); a `get` that could write would make every card render on every surface a
 * potential mutation of the one durable store this system never rebuilds.
 */
export interface EntityDirectoryPort {
  resolve(ref: string): Promise<EntityResolution>
  get(ref: string): Promise<EntityDescriptor | undefined>
}

/**
 * One post-run chain job as the chip projection needs to see it (Phase 388, D-14).
 *
 * Two fields, because two is what the mapping asks: the published status, and whether somebody
 * currently holds the job. The claim is a separate axis rather than a status member on purpose
 * — the store keeps it in a column for exactly that reason (385) — and it is what makes
 * `running` distinguishable from `pending` without inventing a state the job contract does not
 * name. Everything else on a row (attempts, timestamps, the payload) is state a CHIP has no
 * business rendering, so the port does not carry it across.
 */
export interface PostProcessingJobRow {
  readonly status: JobStatus
  /** Whether a drainer holds this job right now. `false` covers queued and terminal alike. */
  readonly claimed: boolean
}

/**
 * What one run's post-run chain has durably recorded, by member (Phase 388, D-14).
 *
 * Every member is OPTIONAL, and each absence is a real, different situation: no analyze-run row
 * means nothing was ever enqueued for this run; no curate-memory row means the analysis has not
 * chained yet; no triage-issues row is the reserved slot (D-04/D-15). Padding any of them with a
 * synthetic row would erase exactly the distinction the projection reads.
 */
export interface PostProcessingChainState {
  readonly analyzeRun?: PostProcessingJobRow
  readonly curateMemory?: PostProcessingJobRow
  readonly triageIssues?: PostProcessingJobRow
  /** The chain-terminal record, once the terminal transaction wrote it (D-09). */
  readonly notification?: RunNotification
}

/**
 * Injected read port over the durable post-run chain state (Phase 388, D-14).
 *
 * OPTIONAL on {@link FunctionDeps}, so a host with no queue storage lists `runs.postProcessing`
 * as `unbound` BY NAME rather than answering a confident all-pending about a chain it has no
 * way to see.
 *
 * The port carries the host's `idSource` rather than resolving ids itself, and that placement
 * is the load-bearing part. Chain identity is DERIVED (RESEARCH Pattern 2), and it must be
 * derived through the same source the host's queue enqueued with — a reader that owned its own
 * derivation would address rows under other ids the moment a composition configured a different
 * source, and would report `pending` about a chain that had already finished. So the function
 * layer derives, once, through `chainJobIdsForRun`, and the port only reads what it is handed.
 *
 * Reads are fence-free by design: reading claims no authority, so a status query neither adopts
 * an epoch nor competes with the drainer that holds one.
 */
export interface PostProcessingReaderPort {
  /** The id source THIS host's queue derives job ids with. */
  readonly idSource: JobIdSource
  /**
   * Durable state for the three ids given, or `undefined` when this project holds no queue
   * database at all.
   *
   * `undefined` is a distinct answer from an empty state and both are honest: the first says
   * nothing has ever been enqueued here, the second says this chain's rows are not among the
   * ones that have. An implementation MUST NOT bring a database into existence to answer —
   * a status read that materialized a queue would make asking a question change the answer.
   */
  readChain(ids: ChainJobIds, runId: string): Promise<PostProcessingChainState | undefined>
}

/**
 * Injected read port over a run's persisted analysis artifact (Phase 389, D-10/D-11).
 *
 * `analysis.json` is the analyze-run job's own receipt; the only legal reader routes its
 * bytes through `guardRunAnalysisArtifact` (the version guard), and an implementation of
 * this port does exactly that at the composition root — the op receives a guarded document
 * or a typed absence, never raw bytes.
 *
 * `undefined` is an ANSWER, not an error: a run whose analysis never ran (budget spent,
 * daemon down, chain still in flight) has no artifact, and the ops answer it through the
 * D-10 accessor's handoff floor. That is why `runs.get` treats an UNBOUND port the same
 * way — artifact-absent — while `analysis.get` refuses by name: a listing that cannot see
 * artifacts still lists truthfully off the floor, but a caller asking for THE analysis of
 * a run must be told this host cannot serve one.
 */
export interface AnalysisArtifactReaderPort {
  /** The guarded artifact for one run, or `undefined` when none is on disk. */
  getArtifact(runId: string): RunAnalysisArtifact | undefined
}

/**
 * Injected read port over the resolved project configuration.
 *
 * The port's name says what its security contract is: it yields a config whose
 * secret-bearing values were dropped while the DTO was CONSTRUCTED. There is deliberately
 * no unmasked variant on this port — a capability that could ask for one would make the
 * masking optional, and optional masking is not masking (T-384-07).
 */
export interface ConfigReaderPort {
  getMasked(): Promise<MaskedResolvedConfig>
}

/**
 * Injected capability that STARTS a run (D-16, Phase 385).
 *
 * Its one verb resolves the identity of the run it started and nothing else. That narrowness
 * is the point: the acknowledgment a caller receives is not assembled from what this port
 * SAYS happened, it is read back off the run's own durable record through
 * {@link RunsReaderPort} — the same port `runs.get` answers from. A host that returned an id
 * without running anything therefore fails at the join rather than at a promise nobody can
 * check.
 *
 * Owning the process model is what makes this a port rather than shared code (the plan-08
 * dissection rule): a terminal host runs a suite one way, a daemon another, and neither
 * would call the other's orchestration as written.
 */
export interface RunInvocationPort {
  /**
   * Start a run for this request and resolve when the run has been recorded.
   *
   * Rejects if the run could not be started or did not complete. An implementation that
   * cannot honour the request must throw, never resolve a run id it did not produce.
   */
  start(request: RunsStartInput): Promise<StartedRun>
}

/** What {@link RunInvocationPort.start} reports: the identity of the run it started. */
export interface StartedRun {
  readonly runId: RunId
}

/**
 * The injected-dependency record every op implementation receives. Ops are pure
 * functions of (validated input, deps) — they never reach for a host API.
 *
 * The four READ ports are required and non-partial on purpose: a composition that omits one
 * fails to typecheck. Phase 387 adds `entities` as the fourth, and it joins as REQUIRED
 * rather than optional deliberately — every host that can list a capability can also resolve
 * an address, so a host that omitted it would not be reporting a real absence, it would be
 * reporting that somebody forgot. That is precisely the state the required/optional split
 * exists to distinguish, and widening the optional side to cover a forgetting would have
 * made `unbound` mean two different things.
 *
 * The OPTIONAL members' optionality is not a relaxation of that discipline but the mechanism
 * behind it. Not every host can start a run — a read-only surface, a registry built for a
 * listing, 386's daemon before it wires its own executor — and D-09 requires that state to be
 * VISIBLE rather than a call that fails somewhere far away. Omitting `runInvocation` makes
 * `runs.start` list as `unbound` and refuse by name; supplying it makes the same capability
 * bound. Any further optional member must join {@link OptionalFunctionDepKey} so the same
 * reporting applies to it.
 *
 * `knowledgeReview` (387, KREV-01) is the second, and it is the one that makes the required/
 * optional split earn its keep on the WRITE side: the ability to read committed knowledge and
 * the ability to change it are separate powers, so they are separate members. A host that
 * supplies only the reader lists the mutating verbs as `unbound` by name — which is a true
 * statement about that host, and is exactly what widening the reader port with propose/apply
 * would have made unsayable.
 */
export interface FunctionDeps {
  runs: RunsReaderPort
  knowledge: KnowledgeReaderPort
  config: ConfigReaderPort
  entities: EntityDirectoryPort
  runInvocation?: RunInvocationPort
  knowledgeReview?: KnowledgeReviewPort
  /**
   * 388 D-14: the durable post-run chain read. The third optional member, and it joins for the
   * reason the other two did rather than by analogy — a host with no queue storage genuinely
   * cannot answer "what became of that run's analysis", and the alternative to reporting that
   * by name is answering `pending` about a chain it has never been able to see, which is a
   * wrong answer wearing a correct one's clothes.
   */
  postProcessing?: PostProcessingReaderPort
  /**
   * 389 D-10/D-11: the analysis-artifact read. `analysis.get` binds through it and refuses
   * by name where it is absent; `runs.get` reads it opportunistically and treats an unbound
   * port as artifact-absent (the floor), because the cheapest read must stay cheap and a
   * listing off the deterministic floor is honest, not degraded. Bound in plan 06's
   * composition root over the run-directory `analysis.json` + version guard.
   */
  analysis?: AnalysisArtifactReaderPort
  /**
   * 389 D-08: the live recurrence seam the one renderer joins through. OPTIONAL because a
   * host without the knowledge index genuinely has no history to answer with — and the
   * renderer's contract turns that absence into the explicit no-history clause rather than
   * a refusal, so `analysis.get` stays bound wherever `analysis` is. Bound in plan 06 to
   * v51's run-outcome projection; 390 rebinds the SAME seam to its fingerprint window.
   */
  recurrence?: RecurrenceProvider
  /**
   * 390 D-12/D-13: the committed quarantine ledger's three verbs — list, release, add.
   *
   * OPTIONAL for the reason `knowledgeReview` is, and not by analogy: a host with no knowledge
   * root genuinely cannot enumerate quarantine state, and the alternative to saying so by name
   * is answering an empty list about a ledger it has never been able to read — a wrong answer
   * wearing a correct one's clothes. On the write side the stakes are higher still: an unbound
   * `add` that no-opped would report a test as quarantined while it kept failing every build.
   *
   * ONE port for all three verbs rather than a reader/writer split, because the read/write
   * asymmetry is already stated where it is ENFORCED — `quarantine.list` declares read scopes
   * and a read-only descriptor, `release` and `add` declare a write scope and `readOnly: false`
   * — so a second port would restate at the composition root a distinction the gate makes at
   * every call. The port TYPE is minted in schema, so knowledge-local can implement it without
   * depending on the function layer.
   */
  quarantine?: QuarantineOperationsPort
}
