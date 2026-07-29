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
  FunctionScope,
  KnowledgeBundleSummary,
  MaskedResolvedConfig,
  RiskActionDescriptor,
  RunId,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

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
export type OptionalFunctionDepKey = 'runInvocation'

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
}

/**
 * Injected read port over the committed knowledge store.
 *
 * Backed by the knowledge-local `/reader` package entry at the composition root. The
 * writer-gated main entry is unreachable from this layer by construction.
 */
export interface KnowledgeReaderPort {
  /** Every committed bundle, already projected to the schema-owned listing row. */
  listBundles(): Promise<readonly KnowledgeBundleSummary[]>
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
 * The three READ ports are required and non-partial on purpose: a composition that omits one
 * fails to typecheck. `runInvocation` is the single OPTIONAL member, and its optionality is
 * not a relaxation of that discipline but the mechanism behind it. Not every host can start
 * a run — a read-only surface, a registry built for a listing, 386's daemon before it wires
 * its own executor — and D-09 requires that state to be VISIBLE rather than a call that
 * fails somewhere far away. Omitting it makes `runs.start` list as `unbound` and refuse by
 * name; supplying it makes the same capability bound. Any further optional member must join
 * {@link OptionalFunctionDepKey} so the same reporting applies to it.
 */
export interface FunctionDeps {
  runs: RunsReaderPort
  knowledge: KnowledgeReaderPort
  config: ConfigReaderPort
  runInvocation?: RunInvocationPort
}
