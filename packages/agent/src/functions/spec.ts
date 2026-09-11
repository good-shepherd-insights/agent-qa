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
  AgentAskInput,
  AgentAskResult,
  ClauseReceiptStatus,
  CompletedRunHandoff,
  CommitReceipt,
  EntityDescriptor,
  EntityResolution,
  ForgetReceiptV1,
  FeedbackPort,
  FunctionScope,
  InspectRecordView,
  JobStatus,
  KnowledgeAcceptInput,
  KnowledgeBundleSummary,
  KnowledgeCandidateInjectionResult,
  KnowledgeGatesListResult,
  KnowledgeForgetInput,
  KnowledgeMarkInput,
  KnowledgeApplyOutcomeKind,
  KnowledgeProposalV1,
  KnowledgeRecordShowInput,
  KnowledgeRecordShowResult,
  KnowledgeTargetRef,
  LiveStreamDeclaration,
  LiveUrlSigner,
  KnowledgeRecordsDiffInput,
  KnowledgeRecordsInspectInput,
  KnowledgeRejectInput,
  EvidenceBlobLookup,
  EvidenceBlobPresence,
  MaskedResolvedConfig,
  ProposalsInboxPort,
  QuarantineOperationsPort,
  RecordChange,
  RiskActionDescriptor,
  RunAnalysisArtifact,
  RunDetailRows,
  RunId,
  RunNotification,
  RunsStartInput,
  StandingGrantsPort,
  StepEvidence,
} from '@vostride/agent-qa-schema'

import type { AuthoringFunnelPortLike } from '../authoring/funnel.js'
import type {
  ConfigApplyPortLike,
  ConfigFilesPortLike,
  ConfigProposalsWritePortLike,
  ConfigScanPortLike,
  ConfigScaffoldContentPortLike,
  ConfigUndoSourcePortLike,
  ConfigValidatePortLike,
} from '../config-mutation/ports.js'
import type { CapabilityCatalogPort } from '../explain/port.js'
import type { EvaluateDraftPorts } from '../authoring/verify-draft.js'
import type {
  AuthoringProposalsWritePortLike,
  AuthoringReadPortLike,
  AuthoringScopePortLike,
  DraftApplyPortLike,
  DraftShelfPortLike,
  ParsedDraftLike,
} from '../authoring/ports.js'
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
  | 'liveView'
  | 'runInvocation'
  | 'knowledgeReview'
  | 'postProcessing'
  | 'runDetail'
  | 'evidenceBlobs'
  | 'analysis'
  | 'recurrence'
  | 'quarantine'
  | 'proposalsInbox'
  | 'standingGrants'
  | 'chatTurn'
  | 'draftEvaluation'
  | 'authoringRead'
  | 'authoringScope'
  | 'draftShelf'
  | 'authoringFunnel'
  | 'draftApply'
  | 'authoringProposals'
  | 'configFiles'
  | 'configValidate'
  | 'configApply'
  | 'configProposals'
  | 'configScan'
  | 'configUndoSource'
  | 'scaffoldContent'
  | 'capabilityCatalog'
  | 'feedback' // 2026-09-08, 419 GATE3-01: the Gate-3 mark port

/**
 * 419 GATE3-01: the union previously had only a type-level pin, invisible to vitest.
 * Like DELTA_ORIGINS and MARKS, this runtime projection makes removal measurable.
 */
export const OPTIONAL_FUNCTION_DEP_KEYS = [
  'liveView',
  'runInvocation',
  'knowledgeReview',
  'postProcessing',
  'runDetail',
  'evidenceBlobs',
  'analysis',
  'recurrence',
  'quarantine',
  'proposalsInbox',
  'standingGrants',
  'chatTurn',
  'draftEvaluation',
  'authoringRead',
  'authoringScope',
  'draftShelf',
  'authoringFunnel',
  'draftApply',
  'authoringProposals',
  'configFiles',
  'configValidate',
  'configApply',
  'configProposals',
  'configScan',
  'configUndoSource',
  'scaffoldContent',
  'capabilityCatalog',
  'feedback',
] as const satisfies readonly OptionalFunctionDepKey[]

type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type _Cover = ExactlyEqual<(typeof OPTIONAL_FUNCTION_DEP_KEYS)[number], OptionalFunctionDepKey>
const _optionalFunctionDepKeysCover: _Cover = true
void _optionalFunctionDepKeysCover

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
 * `id` is dot-namespaced `domain.verb` (D-15) over ONE canonical domain taxonomy.
 *
 * 2026-08-16 (397 D-18): this docstring used to repeat D-15's original eight domains
 * (tests · runs · memory · analysis · eval · gates · config · agent), and six later phases
 * shipped ids in domains that list does not contain — so the sentence had been false for a
 * month by the time anyone checked it. The taxonomy is now DATA rather than prose, pinned in
 * the conformance suite's `domain-list.ts` with a one-line charter apiece and censused
 * against this registry in both directions. An id in an unpinned domain is a named RED
 * there; widening the taxonomy is a reviewed one-line diff to that table. Ids are never
 * renamed to suit it — they are the shipped, locked contract, and the taxonomy serves them.
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
 * What one clause's result MEANT, as the op that produced it reports (Phase 399.1, D-01/D-02/D-03).
 *
 * TWO FIELDS AND NO THIRD. `status` is the one bit a surface must not get wrong — whether the thing
 * was carried out — and `outcome` is the sentence that says which road it came in by. Anything
 * larger would be a second payload channel, and the payload has one (`results[]`).
 *
 * `not-run` IS ABSENT FROM THE STATUS SET, AND ITS ABSENCE IS THE POINT. That member describes a
 * clause the ENGINE deliberately never attempted after an earlier one failed — a fact about the
 * turn, which no op can know and none may claim. The three a classifier may return are derived from
 * the schema's own vocabulary rather than re-spelled, so a fifth receipt status cannot appear here
 * without somebody deciding whether an op may return it.
 *
 * THE `failed` MEMBER IS WHAT MAKES THIS FAIL-CLOSED POSSIBLE (D-03). A result the declared fold
 * cannot read reports `failed` with a named outcome, never `executed`: an unreadable result might be
 * a refusal, so success is the one claim a receipt must never default to.
 */
export interface ClauseVerdict {
  readonly status: Exclude<ClauseReceiptStatus, 'not-run'>
  /**
   * WHICH road, in the op's own vocabulary — `guardrail-hit`, `schema-fail`, a proposal id.
   *
   * The empty string means "this op has nothing to add", and the engine falls back to the line it
   * has always printed. It is not a second spelling of absence: a fold that had nothing to say and a
   * fold that was never declared reach the same rendered line, which is the honest outcome for both.
   */
  readonly outcome: string
}

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
  /**
   * This op composes an invocation-specific disclosure for the gate (2026-08-16, Phase 397 D-05).
   *
   * PRESENCE, AS DATA — never the callable. {@link FunctionSpec.disclose} stays exactly where it
   * is and why it is: a function-valued field on {@link FunctionMetadata} would put something
   * runnable back on every listing, which BL-01 abolishes. What crosses to a listing here is one
   * boolean fact about the op — whether a person confirming it will be shown what this particular
   * invocation costs — and reading that fact tells a caller nothing it could run.
   *
   * IT IS ON THE DECLARATION AND NOT ON THE SHARED BASE, so it cannot be authored. A spec states
   * `disclose`; the registry states `discloses`. Were it on the base, a spec could claim the flag
   * without the method, or omit it while carrying one, and the golden registry snapshot that pins
   * this column would be recording a claim rather than a fact.
   *
   * WHY IT EXISTS AT ALL: 397's conformance suite lives in `packages/cli`, where neither the spec
   * type nor the internals seam is reachable by construction. Without this projection the golden's
   * disclose column would be hand-typed from reading op source files — a literal that rots the
   * first time an op gains or loses a disclosure, silently, because nothing would compare it to
   * anything.
   *
   * `true` is the only value, for `requiresHumanOrigin`'s reason: `false` and an absent key would
   * be two spellings of one fact, and a present `undefined` would make a golden column that reads
   * `null` for an op that simply discloses nothing.
   */
  discloses?: true
  /**
   * This op folds its OWN result into a clause verdict (2026-08-20, Phase 399.1 D-01).
   *
   * PRESENCE, AS DATA — never the callable, on `discloses`' reasoning above and for its reason:
   * {@link FunctionSpec.classify} stays where it is, and a function-valued field on
   * {@link FunctionMetadata} would put something runnable back on every listing (BL-01).
   *
   * WHAT THE PROJECTION IS FOR, AND WHY IT IS NOT DECORATION. D-01 puts refusal knowledge in a
   * per-op fold rather than in a chat-side rule that pattern-matches values, because a rule that
   * can only refuse what it can NAME cannot be driven to zero by naming more things. The cost of
   * that choice is coverage: an op that never declared a fold reports the legacy `executed` for
   * every result it can return, silently. This boolean is what makes that countable — the census in
   * `packages/cli` cannot reach a spec by construction, so without it the coverage question could
   * only be answered by somebody reading forty-three op files.
   *
   * `true` is the only value, for the reason `discloses` gives: `false` and an absent key would be
   * two spellings of one fact.
   */
  classifies?: true
  /**
   * This op composes its own human-facing lines on top of the default payload render (399.1 D-04).
   *
   * PRESENCE, AS DATA, on the two flags above. The fold ADDS legibility and can never suppress: the
   * default render is the complete payload and a declared fold is printed beside it, never instead
   * of it. That is a property of the render path rather than of this flag, and the flag is here so
   * a listing — and the golden ledger — can say which ops carry one.
   */
  rendersResult?: true
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
  /**
   * What THIS invocation is about to cost, in the words a person deciding needs (394-08, D-03).
   *
   * OPTIONAL, and absent on every op with nothing invocation-specific to disclose — which is almost
   * all of them. Where it is present, `invokeFunction` calls it with the PARSED input and hands the
   * string to the gate as `RiskActionDescriptor.disclosure`, so a confirm prompt can say what the
   * approval will actually spend instead of only naming the action class.
   *
   * IT COMPOSES A MESSAGE; IT DECIDES NOTHING. The tier, the action class, the audit row and the
   * standing-grant match are all read off `risk` and are untouched by whatever this returns, so a
   * disclosure cannot widen, narrow or rename the thing being asked about.
   *
   * IT LIVES ON THE SPEC, NOT ON {@link FunctionMetadata}. A declaration is an INERT projection
   * (BL-01) — nothing reachable through `registry.list()` is runnable — and a function-valued field
   * on the shared base would have put a callable back on every listing.
   *
   * PURE BY CONTRACT: it runs inside the gate path on every ask-tier invocation, so a port reached
   * from here would be I/O placed between a caller and its authorization decision.
   */
  disclose?(input: Input): string
  /**
   * What this op's OWN result means, as a clause verdict (2026-08-20, Phase 399.1 D-01/D-02).
   *
   * THE OP FOLDS ITS OWN UNION, AND NOTHING ELSE MAY. Chat cannot tell a refusal from a success by
   * looking at a result: 399's UAT measured a credential-blocked config mutation, a validation
   * failure and a real proposal all reported as `executed` in green, because the engine derived the
   * status from throw-vs-return and every one of the three RETURNED. The knowledge of which arm of
   * `ConfigProposeOutput` is a refusal lives in exactly one place — the op that declared the union —
   * and this is that place. The alternative D-01 rejects by name is a chat-side rule matching values
   * or field names, which can only ever refuse what somebody has already thought to name.
   *
   * IT LIVES ON THE SPEC, NOT ON {@link FunctionMetadata}, and its presence projects onto the
   * declaration as {@link FunctionDeclaration.classifies} — `disclose`'s arrangement exactly.
   *
   * PURE BY CONTRACT, like `disclose`: it runs on the composition root's return path with the op's
   * own output in hand, and a port reached from here would be I/O between an act and the report of
   * what the act was.
   *
   * IT DECIDES NOTHING AND CANNOT WIDEN ANYTHING. The gate has already run, the op has already run,
   * and the audit row is already written when this is called. What it produces is the REPORT.
   *
   * REQUIRED AS OF 2026-08-20 (399.1 plan 04), AND ENFORCED IN TWO PLACES THAT SEE DIFFERENT
   * THINGS. It was optional for one plan while the fan-out landed, and an op that declared none
   * reported the legacy `{ status: 'executed', outcome: '' }` — the same line every op reported
   * before this member existed. Forty ops reported it for two phases, silently, which is the cost
   * D-01 accepted when it put refusal knowledge on the op instead of in a chat-side rule.
   *
   * LAYER ONE IS `tsc`, AT THE KEYSTROKE. An op file that omits this does not compile, so the
   * ordinary way of shipping an unclassified op is closed at the moment it is written.
   *
   * LAYER TWO IS THE CONFORMANCE CENSUS ON THE SHIPPED REGISTRY
   * (`packages/cli/src/__tests__/conformance/classifier-census.test.ts`), AND IT IS NOT A
   * RESTATEMENT OF LAYER ONE. The type is defeatable: `registry.ts` already registers
   * `runsEventsSpec as FunctionSpec`, and an `as`-cast, a spread of a partial literal, or a
   * registry assembled from another type all satisfy `tsc` while shipping an op with no fold. The
   * census reads what the product CONTAINS — the declarations a composed root lists — so it answers
   * the question the type cannot, by op id, in both directions.
   *
   * AND THE RUNTIME NO LONGER DEFAULTS. `foldFunctionResult` used to answer `executed` for an
   * absent classifier; it answers `failed`/`unclassifiable-result` now, because with this member
   * required an absent one means a cast got past both layers, and success is the one claim a
   * receipt must never default to (D-03).
   */
  classify(output: Output): ClauseVerdict
  /**
   * Extra human lines this op's result deserves, on top of the complete payload render (399.1 D-04).
   *
   * ADDITIVE BY CONTRACT. The default render is the whole masked payload, pretty-printed, and a
   * declared fold is printed BESIDE it — never instead of it, never as a filter over it. D-04 makes
   * that a law rather than a convention because RC-2's lesson is that a hand-picked field join is a
   * drop site: the fan-out report and the explain lines are legibility a person is glad of, and
   * neither is a reason to stop showing them what the op actually returned.
   *
   * PURE BY CONTRACT and PRESENCE-PROJECTED as {@link FunctionDeclaration.rendersResult}, on
   * `classify`'s arrangement above.
   */
  renderResult?(output: Output): readonly string[]
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
  /**
   * What a stream op's RESULT meant, folded over the acquisition rather than over an element
   * (2026-08-20, Phase 399.1 D-01).
   *
   * IT IS HANDED THE STREAM, NOT AN ELEMENT, AND THE TYPE SAYS SO. `foldFunctionResult` runs on the
   * composition root's return path with whatever `invoke` answered in hand, and for a stream op
   * that is the iterable. Declaring this over `Element` would have been a signature promising an
   * argument the runtime never passes.
   *
   * IT MUST NOT CONSUME WHAT IT IS GIVEN. Reading an element to decide a verdict would eat the
   * first event of the caller's replay — a side effect, on a member both this and
   * {@link FunctionSpec.classify} contract as pure. What a stream op can honestly report is that
   * the acquisition SUCCEEDED, which is a real fact here: the header above insists the stream is
   * acquired inside `invoke` precisely so an acquisition refusal is a throw rather than a stream
   * that dies half-delivered.
   *
   * REQUIRED, on {@link FunctionSpec.classify}'s reasoning and for a sharper reason here: a stream
   * spec reaches the registry through `runsEventsSpec as FunctionSpec`, so this shape's own `tsc`
   * layer is the ONLY one that fires at the keystroke for it. An optional member here would leave
   * stream ops with no type-level census at all.
   */
  classify(output: FunctionStream<Element>): ClauseVerdict
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
  /**
   * 2026-09-06, 416 D-17: gate history and the current verdict. Optional so existing
   * implementations and fakes remain type-valid; an unbound read refuses by name.
   */
  gateReceipts?(input: { candidateId: string }): Promise<KnowledgeGatesListResult>
  /**
   * 2026-09-07, 417 D-01: the DATA the Gate-1 bridge carries in. Optional so existing
   * implementations and fakes stay type-valid; an unbound read refuses by name.
   */
  candidateInjection?(input: { candidateId: string }): Promise<KnowledgeCandidateInjectionResult>
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
  /**
   * What became of the canary lines THIS run served (2026-08-29, Phase 407 · D-08).
   *
   * ONE ROW PER TUPLE ASKED ABOUT, in the order asked. The caller supplies the served-canary
   * tuples it already holds from the run's own evidence — `candidateId` is the served channel-1
   * line's id, which IS the curation candidate id — and the reader answers with the observation
   * id each tuple's outcome event would carry, plus that outcome when a surviving attributed
   * event exists. `outcome` ABSENT means "no attributed event survives for this tuple", which is
   * an ordinary state (curation has not settled, or it settled and attributed nothing) and NOT
   * an error; `observationId` is always present because it is DERIVED from the tuple —
   * `canaryOutcomeObservationId({ candidateId, runId, testId, testIndex, stepIndex })` — rather
   * than looked up, so a caller can name the event it is waiting for before that event exists.
   *
   * ON THE READER PORT AND NOT THE RUNS PORT, unlike `readStepEvidence` one interface up: the
   * SERVING half of a canary (the marker) is a fact about the run and is read from its evidence,
   * but the ATTRIBUTED half is a fact about the committed knowledge store's outcomes log. Asking
   * the runs port for it would be asking a record of what happened for a record of what is true.
   *
   * OPTIONAL, so every existing port implementation and every test fake stays type-valid. The
   * `/reader` entry implements it in 407-04 and agent-local binds it there; until then a caller
   * sees `undefined` and renders the honest not-yet-attributed state rather than a wrong badge.
   *
   * THE ANSWER CARRIES ITS OWN PARTIALITY (407-19, REVIEW WR-03). `skippedBundles` is the walk's
   * count of bundles it could not load — corrupt, truncated, or failing the integrity check that
   * catches tampering. `> 0` means the answer is PARTIAL, and a caller must not render an absent
   * `outcome` as a positive `not attributed`: on a partial walk that absence means "not found in
   * the part of the store I could read", which is a different sentence. The count rides HERE, on
   * the read that degraded, rather than being inferred from a sibling read failing on the same
   * file — an inference that does not survive the two reads seeing different stores.
   */
  canaryAttributions?(input: {
    runId: string
    tuples: readonly {
      candidateId: string
      testId: string
      testIndex: number
      stepIndex: number
    }[]
  }): Promise<{
    readonly rows: readonly {
      candidateId: string
      testIndex: number
      stepIndex: number
      observationId: string
      outcome?: 'confirmed' | 'contradicted' | 'helpful' | 'harmful'
    }[]
    readonly skippedBundles: number
  }>
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
  propose(
    request: KnowledgeProposalRequest,
    /**
     * WHO is proposing (391 D-08 / D-15) — the emitting op's id, and the run when the caller has
     * one. The proposal it mints rides into the envelope carrying this, which is what makes the
     * inbox able to answer "where did this come from" and the per-run digest able to group by run.
     *
     * A SECOND PARAMETER rather than a field on the request union, because it is a fact about the
     * CALL and not about the verb: adding it to each arm would have made every future arm restate
     * it, and an arm that forgot would mint unattributed proposals that look identical to 387-era
     * ones. Optional so a host that genuinely does not know an emitter writes the bare 387
     * document instead of a fabricated attribution.
     */
    origin?: ProposalMintOrigin,
  ): Promise<KnowledgeProposeOutcome>
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

/** The attribution a propose carries into the envelope. `at` is the store's to stamp, not ours. */
export interface ProposalMintOrigin {
  readonly emittedBy: string
  readonly runId?: string
}

export type KnowledgeProposalRequest =
  | { readonly verb: 'accept'; readonly input: KnowledgeAcceptInput }
  | { readonly verb: 'reject'; readonly input: KnowledgeRejectInput }
  | { readonly verb: 'forget'; readonly input: KnowledgeForgetInput }
  | { readonly verb: 'mark'; readonly input: KnowledgeMarkInput }

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
  readonly commitReceipt?: CommitReceipt
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
 * What one run's post-run chain has durably recorded, by member (Phase 388, D-14; narrowed to
 * the two chip stages — Phase 404, D-01, 2026-08-26).
 *
 * Every member is OPTIONAL, and each absence is a real, different situation: no analyze-run row
 * means nothing was ever enqueued for this run; no curate-memory row means the analysis has not
 * chained yet. Padding either of them with a synthetic row would erase exactly the distinction
 * the projection reads.
 *
 * This state carries exactly one member per CHIP STAGE, which since 422 D-13 is a strict subset
 * of the stages the chain runs: the chain derives a third id for the proposal stage and this
 * state deliberately does not report its row. The chips are what a surface renders, and widening
 * them is a change to a published vocabulary that D-13 did not authorise — so the third id is
 * handed to `readChain` (the reader is entitled to know the whole chain it is looking at) and
 * the projection stays two-wide. `notification.stages.proposals` is where the third stage's
 * outcome reaches a reader, and it reaches it as the durable record rather than as a chip.
 *
 * 2026-09-01 (Phase 409): the chain's third derived id left with the Issue-slot cleanup.
 * 2026-09-11 (Phase 422, D-13): a third derived id returns, without a third chip.
 */
export interface PostProcessingChainState {
  readonly analyzeRun?: PostProcessingJobRow
  readonly curateMemory?: PostProcessingJobRow
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
   * Durable state for the ids given, or `undefined` when this project holds no queue database
   * at all. Chain identity is still the job-kind layer's to derive, and this port only reads
   * what it is handed — which since 422 D-13 is three ids, of which the state above reports the
   * two that have chips. An implementation is free to read fewer rows than it is handed ids;
   * what it may not do is derive an id of its own.
   *
   * 2026-09-01 (Phase 409): the width dropped from three to two.
   * 2026-09-11 (Phase 422, D-13): three again, and no longer equal to the state's member count.
   *
   * `undefined` is a distinct answer from an empty state and both are honest: the first says
   * nothing has ever been enqueued here, the second says this chain's rows are not among the
   * ones that have. An implementation MUST NOT bring a database into existence to answer —
   * a status read that materialized a queue would make asking a question change the answer.
   */
  readChain(ids: ChainJobIds, runId: string): Promise<PostProcessingChainState | undefined>
}

/**
 * Injected read port over ONE run's durable dashboard projection (Phase 405, D-03).
 *
 * `packages/agent` is `storageNeutral`: no host builtin is importable here, so every row arrives
 * through this port, built at the composition root over the concrete dashboard SQLite database.
 * The port answers ROWS — members, steps, sub-actions — and nothing derived; the D-06 token sum is
 * the op's, computed once in the layer that owns the contract rather than once per host that
 * happens to hold a database.
 *
 * ABSENCE IS A RESULT, NEVER A PATH JOIN ON CALLER INPUT (the `RunsReaderPort.get` law, T-384-08).
 * A run id that names nothing answers `undefined`, and turning that into the layer's typed refusal
 * is `runs.detail`'s job — so the "not found" vocabulary lives here in one place rather than in
 * every composition root. An implementation resolves the id against the rows it already
 * enumerates; joining a caller-supplied string onto a filesystem path is the one thing it may
 * never do.
 *
 * OPTIONAL on {@link FunctionDeps} for the reason `postProcessing` is: a host with no dashboard
 * database genuinely cannot say what a run's steps were, and the alternative to reporting that by
 * name is answering an empty projection about a run it has never been able to see — a wrong answer
 * wearing a correct one's clothes.
 */
export interface RunDetailReaderPort {
  /** One run's projected rows, or `undefined` when no such run is recorded. */
  read(runId: RunId): Promise<RunDetailRows | undefined>
}

/**
 * Injected read port over ONE run's content-addressed evidence blobs (Phase 405, D-12/D-13).
 *
 * `packages/agent` is `storageNeutral`: no filesystem is importable here, so the bytes arrive
 * through this port, built at the composition root over the SAME `FsEvidenceArtifactStore` the
 * runner wrote them with. The port answers BYTES and nothing derived — the content-type sniff is
 * `runs.artifact`'s, computed once in the layer that owns the contract rather than once per host
 * that happens to hold a runtime root.
 *
 * ABSENCE IS A RESULT, AND IT IS TWO RESULTS (D-15). See {@link EvidenceBlobLookup}: the concrete
 * store collapses "no such run" and "no such blob" into one `undefined`, and an implementation of
 * this port is where that distinction is recovered — because above it the two are different things
 * a page has to render. Turning either arm into a typed refusal is the op's job, so the "not
 * found" vocabulary lives in one place rather than in every composition root.
 *
 * THE PORT NEVER JOINS CALLER INPUT ONTO A PATH (the `RunsReaderPort.get` law, T-384-08 /
 * T-405-14). Containment is the STORE's own rule — `slugBranch` over the runId and a
 * 64-lowercase-hex check over the sha, both inside `FsEvidenceArtifactStore` — and an
 * implementation that assembled a path itself would be a second containment rule, free to be
 * weaker than the one the runner writes through.
 *
 * OPTIONAL on {@link FunctionDeps} for the reason `postProcessing` is, and for a sharper one: the
 * alternative was widening the REQUIRED {@link RunsReaderPort} with a blob verb, which every
 * daemon, MCP and test implementer of that port would then have to satisfy with storage most of
 * them do not have.
 */
export interface EvidenceBlobReaderPort {
  /** One blob's bytes, or which KIND of absence this host is reporting. */
  read(runId: RunId, sha: string): Promise<EvidenceBlobLookup>
  /**
   * The same question asked as a STAT — are the bytes still there — for read-time presence
   * annotation on the durable reads (Phase 406, D-17).
   *
   * OPTIONAL SO THAT EVERY EXISTING IMPLEMENTATION AND FAKE KEEPS COMPILING, and for the sharper
   * reason that absence here is a real host condition rather than an oversight: a host that cannot
   * cheaply stat its blobs is not lying about anything, and an op that finds this member missing
   * OMITS presence rather than reporting refs it never looked at as absent. A claimed absence is
   * the one answer this field must never be able to give by accident, because it renders honest
   * evidence as `evidence-incomplete`.
   *
   * IT ANSWERS THE SAME THREE WORDS `read` DOES, so the two cannot disagree about WHICH absence a
   * ref is in — the read is this answer plus the bytes, never a second rule.
   */
  has?(runId: RunId, sha: string): Promise<EvidenceBlobPresence>
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
/**
 * The live-view seam `runs.liveurl` mints through (403 D-03).
 *
 * OPTIONAL, and its absence is a GENUINE HOST FACT rather than a degraded mode: a CLI run in a
 * terminal serves no origin, so there is no URL it could honestly hand back. A host that binds it
 * supplies the per-process signer, the origin it is actually listening on, and a read of the live
 * run registry — never a token, and never a parse.
 *
 * `capabilityOf` answers `undefined` for a run this host has no live session for (the op turns
 * that into `unknown_run`) and a `LiveStreamDeclaration` — possibly `{ kind: 'none' }` — otherwise.
 * `onMinted` is the Q4(b) hook: every minted token value is offered to the host's masking store, so
 * runs started after the mint mask it if it is ever printed.
 */
export interface LiveViewPort {
  signer: LiveUrlSigner
  origin(): string | undefined
  now(): number
  capabilityOf(runId: string, handle: number): LiveStreamDeclaration | undefined
  onMinted?(token: string): void
}

export interface FunctionDeps {
  runs: RunsReaderPort
  knowledge: KnowledgeReaderPort
  config: ConfigReaderPort
  entities: EntityDirectoryPort
  runInvocation?: RunInvocationPort
  /**
   * 403 D-03: the live-view mint seam. See {@link LiveViewPort} — absent means this host has no
   * served origin, and `runs.liveurl` refuses by name rather than minting a link to nowhere.
   */
  liveView?: LiveViewPort
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
   * 405 D-03: the durable run-detail projection read. See {@link RunDetailReaderPort} — absent
   * means this host owns no dashboard projection database, and `runs.detail` refuses BY NAME
   * rather than answering an empty run about a projection it cannot observe. Bound in the CLI
   * dashboard composition over the one `DashboardDatabase` that server holds.
   */
  runDetail?: RunDetailReaderPort
  /**
   * 405 D-12/D-13: the run-scoped evidence-blob read. See {@link EvidenceBlobReaderPort} — absent
   * means this host owns no runtime root, and `runs.artifact` refuses BY NAME rather than
   * answering `blob_absent` about every artifact in the product, which would read to an operator
   * as storage loss. Bound on every LOCAL host, which is exactly the set that has run directories.
   */
  evidenceBlobs?: EvidenceBlobReaderPort
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
  /**
   * 419 GATE3-01: the mark port — assembled by the cli host over eval-local + the review
   * port; absent on hosts that cannot freeze gold.
   */
  feedback?: FeedbackPort
  /**
   * 391 PROP-03 / D-15: the proposals inbox's three verbs — list, show, reject.
   *
   * OPTIONAL for the reason `knowledgeReview` and `quarantine` are, and the stakes here sit on
   * the READ side rather than the write side for once. A host with no agent-qa runtime root
   * genuinely cannot enumerate proposals, and the alternative to saying so by name is answering
   * an empty inbox about a directory it has never been able to open — which reads exactly like
   * "nothing is waiting on you" and is the one wrong answer that makes a person stop looking.
   *
   * ONE port for all three verbs, on the quarantine port's stated reasoning: the read/write
   * asymmetry is declared where it is ENFORCED — `list`/`show` take read scopes and read-only
   * descriptors, `reject` takes `approval-write`, `readOnly: false` and `requiresHumanOrigin` —
   * so a second port would restate at the composition root a distinction the gate makes at every
   * call. The port TYPE is minted in schema, so knowledge-local can implement it without
   * depending on the function layer.
   */
  proposalsInbox?: ProposalsInboxPort
  /**
   * 391 PROP-01 / D-03: the committed standing-grant ledger's three verbs — list, record, revoke.
   *
   * OPTIONAL for the reason `quarantine` is, and the stakes are the phase's whole subject. A host
   * with no knowledge root genuinely cannot enumerate standing approvals, and the alternative to
   * saying so by name is answering an empty list about a ledger it has never been able to read —
   * which reads as "the agent has no standing permissions" and is the one wrong answer that makes
   * a person stop checking. On the write side it is worse still: an unbound `revoke` that no-opped
   * would tell somebody they had withdrawn an approval that is still in force.
   *
   * ONE port for all three, on the quarantine and inbox ports' stated reasoning — the read/write
   * asymmetry is declared where it is ENFORCED. `record` is on the port and on NO op: a standing
   * approval arises only from `proposals.accept`'s deliberate always form (D-01), so a registered
   * mint verb would be a second door into the same power, reachable without deciding anything.
   *
   * The port TYPE is minted in schema, so knowledge-local can implement it without depending on
   * the function layer.
   */
  standingGrants?: StandingGrantsPort
  /**
   * 392 D-24: the assembled chat turn engine, behind which `agent.ask` runs.
   *
   * OPTIONAL for the reason its neighbours are, and the honest absence matters more here than
   * anywhere else in this record: a host with no engine — a remote read surface, a daemon before
   * a chat host exists — genuinely cannot run a turn, and the alternative to reporting that by
   * name is answering an EMPTY turn. A person told "I understood you and did nothing" stops
   * asking, which is the same failure the unbound proposals inbox was reasoned about avoiding.
   *
   * The port is a single verb by design. Anything wider — a session lister, a history reader —
   * would be reach the turn entry does not need and would give a surface holding this dep a way
   * into session state without a registered op declaring it.
   */
  chatTurn?: ChatTurnPort
  /**
   * 393 D-01 / D-15: the two host halves one draft evaluation needs — resolve a caller's path to a
   * parsed draft, and assemble the ports the four gates run against.
   *
   * ONE BUNDLED CAPABILITY rather than five separate deps, on the `runInvocation` precedent. The
   * receipts store, the suite fingerprint index, the text corpus and the run pair are not
   * independently bindable: an index scoped to a different product than the runs were taken under
   * would compare a draft against another project's suite, and a host that could supply three of
   * the five would list this op `bound` and then fail somewhere far from the composition that
   * forgot one. Bundling makes "can this host verify a draft" a single fact.
   *
   * OPTIONAL for the reason `runInvocation` is, and here it says two things at once: a host that
   * cannot PARSE a test file and a host that cannot START a run are both hosts that cannot verify
   * a draft, and `composeLocalAgent()` binds this only when it has both.
   *
   * WHY RESOLUTION IS A SEPARATE VERB FROM EVALUATION. `packages/agent` is `storageNeutral`: it
   * cannot stat a path, read a file, or know where the workspace ends. So the three refusals that
   * need a filesystem are ANSWERED by the host and NAMED by the op — `resolveDraft` returns a
   * typed outcome and never throws a host error through the layer, and
   * `functions/ops/authoring-verify-draft.ts` maps each arm onto its own caller-facing class. The
   * alternative — a single `evaluate(draftPath)` — would have put the refusal vocabulary in
   * whichever package happened to own the syscall, one layer below where a caller catches it.
   */
  draftEvaluation?: DraftEvaluationPort
  /**
   * 394 D-01 / WTST-01: the authoring loop's read half — the brief, and the authored suite as
   * text (stages 1-2).
   *
   * OPTIONAL for the reason `draftEvaluation` is, and the honest absence is load-bearing here in
   * a way it is nowhere else in this record. A host with no knowledge index cannot serve an
   * authoring brief, and the alternative to saying so by name is compiling a test from an EMPTY
   * brief — which produces a plausible draft, authored against nothing this project knows, and
   * says so nowhere. That is a wrong answer wearing a correct one's clothes, and it is wearing
   * them into a file the user is asked to commit.
   */
  authoringRead?: AuthoringReadPortLike
  /**
   * 394-26 / WTST-01: which scope this project authors for, when the caller named none.
   *
   * OPTIONAL and consulted ONLY on absence. `authoring.draft.write`'s `scope` is optional at the
   * registry (the `runs.start` law), so an input carrying just an intent has to be resolved
   * before the loop runs — and the resolution reads the config and the workspace, which
   * `packages/agent` cannot do. A composition that binds the loop's other halves and forgets this
   * one refuses BY NAME on a scope-less call rather than authoring against a default: a guessed
   * product is a draft written for the wrong application, which is the one failure mode a silent
   * fallback here would produce.
   */
  authoringScope?: AuthoringScopePortLike
  /**
   * 394 D-01 / WTST-01: the authoring loop's compile half — the model, and the draft shelf
   * (stage 3).
   *
   * Bound with `authoringRead` or not at all: `composeLocalAgent()` supplies the pair, because a
   * host that can read but not write is not a degraded author, it is a host that must say
   * `unbound` by name. `authoring.draft.write` names THIS key in `boundThrough` — it is the half
   * that makes the op mutating — and refuses on either half's absence at the invoke, so an
   * in-layer caller holding the spec directly gets the same named error.
   */
  draftShelf?: DraftShelfPortLike
  /**
   * 394-07 D-12 / WTST-05: the honesty funnel's reads — the receipts store, the proposals inbox,
   * and (optionally within the bundle) the outcome projection and quarantine ledger D-14 consults.
   *
   * OPTIONAL for the reason `proposalsInbox` is, and the stakes sit on the READ side in the same
   * way. A host with no agent-qa runtime root cannot list draft receipts, and the alternative to
   * saying so by name is answering an all-zero funnel — which does not merely under-report, it
   * reports a loop that filtered everything, the one reading of a zero funnel that FLATTERS the
   * loop this measurement exists to keep honest.
   *
   * ONE bundle rather than separate deps, on the `draftEvaluation` reasoning: a host that could
   * list receipts and not read the inbox would answer a funnel whose `accepted` stage is
   * permanently zero, which would make the acceptance-failure flag structurally unable to fire.
   */
  authoringFunnel?: AuthoringFunnelPortLike
  /**
   * 394-10 D-06 / WTST-01: the one-commit apply an accepted `test-draft` reaches.
   *
   * OPTIONAL for the reason `knowledgeReview` is, and the stakes are this phase's whole subject. A
   * host with no checkout root genuinely cannot write a file into a suite or make a commit, and the
   * alternative to saying so BY NAME is an accept that answers `applied` for a write that did not
   * happen — a receipt for a file that is not on disk, handed to a person at the one verb whose
   * whole job is to be the honest record of what their decision did.
   *
   * Bound wherever `draftAuthoring` is, and NOT gated on the run executor beside it: applying an
   * already-decided draft needs a checkout root and nothing else. A host that cannot start runs can
   * still hold a person's accept.
   */
  draftApply?: DraftApplyPortLike
  /**
   * 394-18 D-05/D-11 · WTST-05: where a finished loop outcome BECOMES a proposal a person can find.
   *
   * OPTIONAL as a type and REQUIRED in practice for the one op that holds it, which is the same
   * arrangement `authoringRead` is under and for the same reason: `authoring.draft.write` refuses
   * at the invoke if this is absent, because an invocation that spent up to nine child runs and
   * then discarded the artifact it produced would answer `drafted` about a draft nobody can ever
   * decide on. `composeLocalAgent()` binds it beside the shelf, so a host that can author can file.
   *
   * SEPARATE FROM `authoringFunnel`, which reads the same store. That bundle is structurally unable
   * to write — the property D-12's nothing-new-is-persisted claim rests on — and folding a write
   * verb into it would hand the projection a capability to overwrite the records it reports on.
   */
  authoringProposals?: AuthoringProposalsWritePortLike
  /**
   * 395 D-03/D-17 · CFGM-01/04: the pinned config file SET as RAW BYTES, plus the comment-preserving
   * field edit over them.
   *
   * DELIBERATELY NOT A WIDENING OF {@link ConfigReaderPort}, which is masked-only by contract and
   * must stay so — a capability that could ask it for unmasked values would make masking optional,
   * and optional masking is not masking. This port answers a different question: what bytes are
   * COMMITTED in the person's repository. Those carry no resolved secrets, because D-11 makes
   * committed config refs-only by law.
   *
   * The EDIT rides the same port as the read because both are host facts. `yaml`'s Document API is
   * an external dependency `packages/agent`'s ownership contract does not admit, and admitting one
   * to bring the edit in-layer would widen a boundary rather than respect it.
   */
  configFiles?: ConfigFilesPortLike
  /**
   * 395 CFGM-01: whole-config validation, which runs BEFORE a proposal surfaces.
   *
   * A PORT because `AgentQaConfigSchema` and `validateProject` live in `@vostride/agent-qa-core`
   * and this package does not depend on it — `validate:arch` reds that edge with no legal repair.
   * The `draftApply` idiom exactly: the capability is declared here and bound in `cli`.
   */
  configValidate?: ConfigValidatePortLike
  /**
   * 395 CFGM-03: the ONE commit an accepted config proposal makes in a person's own history.
   *
   * OPTIONAL for the reason `draftApply` is, and the stakes are the same. A host with no checkout
   * root genuinely cannot commit, and the alternative to saying so BY NAME is an apply that answers
   * `applied` for a commit that does not exist — a receipt for history the repository never
   * received.
   */
  configApply?: ConfigApplyPortLike
  /**
   * 395 CFGM-01: where a constructed config proposal becomes something a person can find.
   *
   * SEPARATE FROM `authoringProposals`, which writes the same store, and the separation is not
   * ceremony: that member is bound inside the authoring bundle's own conditional spread, so folding
   * config writes into it would make a host that cannot author a test unable to propose a config
   * change — two unrelated capabilities failing together for no reason either of them names.
   */
  configProposals?: ConfigProposalsWritePortLike
  /**
   * 395 D-09/D-12 · CFGM-02: the construction-time secret scan, bound to the host's masking seeds.
   *
   * A DEP RATHER THAN A DIRECT CALL, even though this package may import `packages/safety` and does.
   * The FUNCTION is pure and could be called from here; its SEEDS are the resolved environment slice
   * the run masker is built from, and this package reads no environment. Binding the closure at the
   * composition root is what makes the values this scan knows and the values the masker hides one
   * set by construction (D-09) rather than two lists that happen to agree.
   *
   * BOUND UNCONDITIONALLY BY `composeLocalAgent`, like `configProposals` and unlike its other three
   * neighbours: there is no host that legitimately cannot scan, because the capability needs nothing
   * but the process it is already running in. It is optional here only so the deps record stays one
   * shape, and the propose ops refuse BY NAME when it is missing — a construction that cannot scan
   * must not surface a diff.
   */
  configScan?: ConfigScanPortLike
  /**
   * 395-06 D-07 · CFGM-03: the repository's own account of the last agent configuration commit.
   *
   * THE ONE DEP `config.undo.propose` HAS AND THE OTHER SIX PROPOSE OPS DO NOT. It is git — a host
   * fact by definition — and it is a port of its own rather than a verb on `configApply` because
   * the two answer opposite questions: that one writes a commit a person accepted, this one reads a
   * commit somebody already made. Its absence makes exactly one op unavailable, and it says so by
   * name.
   */
  configUndoSource?: ConfigUndoSourcePortLike
  /**
   * 395-08 D-04 · CFGM-05: the shared scaffold CONTENT, rendered by the host that owns it.
   *
   * THE ONE DEP `config.project.scaffold` HAS AND THE OTHER SEVEN PROPOSE OPS DO NOT. D-04's claim
   * is that `agent-qa init` and the scaffold proposal write one substance; that substance lives
   * beside `init`'s filesystem machinery in `packages/cli`, which this package may not import. Its
   * absence makes exactly one op unavailable, and it says so by name.
   */
  scaffoldContent?: ConfigScaffoldContentPortLike
  /**
   * 2026-08-17 (398 D-09/D-11 · XPLN-02): the four host halves one `explain` needs — the committed
   * catalog as data, the model's citation over it, and the two coverage hooks.
   *
   * ONE PORT AND NOT FOUR DEPS, on the `draftEvaluation` bundle's stated reasoning: a host that
   * could load the catalog but not cite over it would list `agent.explain` as `bound` and then
   * answer every question with a ghost citation, which abstains — safe, and useless, and reported
   * nowhere. "Can this host explain itself" is one fact.
   *
   * OPTIONAL for the reason `analysis` is, and the honest absence is unusually load-bearing here.
   * `packages/agent` is storageNeutral: it cannot read the committed artifact, so a composition
   * that omitted the port and got a degraded answer would be answering FROM MODEL MEMORY, which is
   * the single behaviour XPLN-02 exists to make impossible. The op refuses BY NAME instead.
   */
  capabilityCatalog?: CapabilityCatalogPort
}

/**
 * What a host can tell the layer about a caller-supplied draft path (393, T-393-01).
 *
 * A discriminated union rather than `ParsedDraftLike | undefined`: "there is no file there", "that
 * is a directory", "that is outside this workspace" and "that file is not a test" are four
 * different things to tell a person, and collapsing them into an absence would make the op answer
 * all four with one message. Every arm but `parsed` becomes a NAMED error at the invoke.
 */
export type DraftResolution =
  | { readonly kind: 'parsed'; readonly draft: ParsedDraftLike }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-a-file' }
  | { readonly kind: 'outside-workspace' }
  | { readonly kind: 'unparsable'; readonly reason: string }

/**
 * The capability `authoring.draft.verify` binds through (393 D-01).
 *
 * `openEvaluation` takes the resolved draft because two of the four ports depend on WHICH draft is
 * being evaluated: the suite comparison must exclude the draft's own identity from both of gate
 * 3's lanes, or a draft that already lives in the authored suite would be measured against itself
 * and could never be shown to add value. It is a separate call from `resolveDraft` so a refused
 * path costs no database handle and no suite walk.
 */
export interface DraftEvaluationPort {
  resolveDraft(draftPath: string): Promise<DraftResolution>
  openEvaluation(draft: ParsedDraftLike): Promise<EvaluateDraftPorts>
}

/**
 * The one verb `agent.ask` binds through (392 D-24).
 *
 * Typed against the SCHEMA contracts rather than against the engine's own types, which is what
 * lets the composition root hand this layer an engine without the function layer depending on how
 * a turn is assembled — and what lets 396's MCP projection describe the same shape.
 */
export interface ChatTurnPort {
  runTurn(input: AgentAskInput): Promise<AgentAskResult>
}
