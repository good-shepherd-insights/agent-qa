// The gate evaluator's ports (Phase 393, D-02/D-03 · WTST-02).
//
// The evaluator needs three capabilities this package cannot name: it must START AND READ RUNS
// (the runner's composition), it must READ THE SUITE FINGERPRINT INDEX (knowledge-local's derived
// index), and it must PERSIST A RECEIPT (knowledge-local's durable store). `agent`'s dependencies
// are exactly `runner`, `safety`, `schema`, `ai` and `zod`; acquiring an edge to `core` or
// `knowledge-local` would be a `validate:arch` violation with no legal repair. So the capabilities
// arrive as STRUCTURAL MIRRORS — the `TestOutcomeHistoryLike` precedent in `jobs/kinds.ts` — and
// `composeLocalAgent()` binds the real implementations, which are assignable unchanged.
//
// WHICH SHAPES ARE MIRRORS AND WHICH ARE NOT. `DraftRunPortLike` is deliberately typed in the
// REAL schema vocabulary (`RunsStartInput`, `RunStartAcknowledgement`, `CompletedRunHandoff`)
// rather than in a hand-rolled echo of it. Those types live in `schema`, which this package
// already depends on, so there is no dependency to invert — and a mirror of them would be a
// second spelling of a contract `runs.start`/`runs.get` already own, free to drift from the ops
// it exists to describe. The mirror discipline applies where the dependency points the other way;
// it is not a house style to apply everywhere.

import type {
  AuthoringBrief,
  AuthoringVerifyDraftInput,
  CompletedRunHandoff,
  DraftReceipt,
  ProposalRecord,
  RunStartAcknowledgement,
  RunsStartInput,
  ScopeKey,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'

import type { JobModelCapability } from '../jobs/record-llm-authorship.js'

/**
 * A parsed draft, reduced to what the four gates and the receipt read.
 *
 * The HOST parses: `parseTestFile` lives in `core` and yields steps as `string | { step: string }`,
 * so the caller narrows to text before handing them down (the parse-at-host precedent in
 * `cli/src/curation/authoring-test-discovery.ts`). This is the same posture
 * `ParsedDraftStepsLike` takes in `assertion-strength.ts`, widened with the identity fields the
 * receipt and the member-outcome join need.
 *
 * `testName` is spelled `testName`, not `name`, on purpose. The stable identity is
 * (`filePath`, `testName`) — the project-wide rule, never `testId` — and gate 1 finds the draft's
 * own member inside a run document by comparing against `PerTestOutcome.testName`. A mirror that
 * spelled it `name` would put a rename at exactly the join where using the wrong field is the
 * mistake the rule exists to prevent.
 */
export interface ParsedDraftLike {
  /** The parser's canonical `t_` id. Provenance on the receipt; never the join key. */
  readonly testId: string
  /** Identity half one, as the runner records it on `PerTestOutcome.filePath`. */
  readonly filePath: string
  /** Identity half two: the parsed test's display name, as `PerTestOutcome.testName`. */
  readonly testName: string
  /**
   * The parsed test's `target` — the name `agent-qa run` resolves against the config.
   *
   * REQUIRED, exactly as `TestDefinitionSchema` requires the key: a document that carries none is
   * not a parsed test at all, so an optional mirror here would be a second, weaker answer to what
   * the parser already decided.
   *
   * IT IS HERE BECAUSE IT IS CHECKED, and unlike `context` it is checked precisely because it is
   * NOT editable (394-37, WR-04). `runs.start` types this value into a live application:
   * `resolveTarget` throws on a name the config does not declare, inside a real child process, up
   * to `DRAFT_STABILITY_RUNS_N` times — and `target` is outside `EDITABLE_POINTER_ROOTS`, so no
   * repair patch may correct it. The one place that can refuse it cheaply is the compile stage,
   * which already holds the vocabulary it serves the prompt; this field is what lets it compare.
   */
  readonly target: string
  /** Pre-interpolation NL step text. Post-interpolation text can carry resolved secrets (D-19). */
  readonly steps: readonly string[]
  /**
   * The parsed test's `context` block, pre-interpolation, optional exactly as
   * `TestDefinitionSchema.context` is — post-interpolation text can carry resolved secrets (D-19).
   *
   * IT IS HERE BECAUSE IT IS EDITABLE. `context` is one of the three `EDITABLE_POINTER_ROOTS`, so
   * a patch can write it; a mirror that omitted it made the credential gate blind to a whole root
   * by TYPE SHAPE rather than by a missed entry in a locations array.
   */
  readonly context?: string
  /** Digest of the draft bytes evaluated, so a later edit cannot inherit this receipt. */
  readonly contentDigest: string
}

/**
 * The run capability, shaped as the `runs.start` / `runs.get` op pair (D-02, op-calls-op).
 *
 * There is no second in-host marker-stamping site: the evaluator asks for a gate-run through the
 * same input contract every other caller uses, and the runner stamps the handoff. What the
 * evaluator does with the acknowledgment is CONFIRM — `runs.start` copies both markers off the
 * durable record rather than echoing the request, so an acknowledgment that comes back without
 * them is the host saying the run was not accepted as a gate-run.
 */
export interface DraftRunPortLike {
  start(input: RunsStartInput): Promise<RunStartAcknowledgement>
  get(runId: string): Promise<CompletedRunHandoff | undefined>
}

/**
 * One open dispatch scope, as this package sees it (401-08, D-08).
 *
 * A MIRROR, and this one earns the mirror discipline `DraftRunPortLike` is exempt from: the real
 * shape lives in `agent-local`'s composition and is spelled in `@vostride/agent-qa-safety`
 * vocabulary, neither of which this package may name. What crosses is one verb with no arguments
 * and no return value, which is the whole of what the loop needs to say.
 */
export interface DispatchGrantLeaseLike {
  dispose(): void
}

/**
 * Where the 394 dispatch confirm's ONE approval becomes something the child gate runs can use.
 *
 * `open()` TAKES NOTHING. The loop is not permitted to name the action class it is being granted,
 * the scope it is granted in, or how many runs the grant covers — all three are composition
 * facts, and a parameter for any of them would be a channel for widening an approval a person
 * already gave. What the loop owns is the LIFETIME: it opens the scope before the first stage that
 * can spend a run and disposes it in a `finally`.
 */
export interface DispatchGrantPortLike {
  open(): DispatchGrantLeaseLike
}

/**
 * The suite-fingerprint read port (D-15), mirroring `createSuiteFingerprintIndex`'s three verbs.
 *
 * Synchronous, because the real implementation reads a local SQLite table and is. Partition
 * scoping is the binder's job: the real factory REQUIRES a product, so a bound index is already
 * scoped and this shape has no scoping knob to get wrong.
 */
export interface SuiteFingerprintIndexLike {
  /** The union D-14's novel-element test compares against. Empty table, empty union. */
  elementUnion(): ReadonlySet<string>
  /** The identities that HAVE fingerprint rows — the fingerprint lane's population. */
  coveredTests(): readonly SuiteTestIdentity[]
  /** One identity's ordered elements, for the per-test subsumption row on the finding. */
  elementsForTest(filePath: string, testName: string): readonly string[]
}

/** The stable test identity, spelled once. */
export interface SuiteTestIdentity {
  readonly filePath: string
  readonly testName: string
}

/**
 * One suite test as TEXT, for D-16's degraded lane.
 *
 * The population is the authored-test universe MINUS `coveredTests()` — an evidence-less test is
 * one the derived index has no rows for, which the index deliberately does not conflate with
 * "uncovered". Building that difference is the host's job: the suite is not a fact the derived
 * index owns.
 *
 * Carries no `title` beside `testName`. A parsed test has ONE display name, so a separate title
 * field would be two spellings of one fact and a reader would have to guess which of them the
 * similarity actually reads.
 */
export interface SuiteTextCorpusEntryLike {
  readonly filePath: string
  readonly testName: string
  /** Pre-interpolation step text, same rule as the draft's. */
  readonly stepsText: readonly string[]
}

/**
 * The durable receipts store (D-19), mirroring `createDraftReceiptsStore`'s write verb.
 *
 * Only `put` — this evaluator writes and never reads back. The real store's `get`/`list` exist for
 * 394's proposal envelope, and a port that named verbs its holder never calls would invite a
 * binder to supply implementations nothing exercises.
 */
export interface DraftReceiptsStoreLike {
  put(receipt: DraftReceipt): Promise<void>
}

/**
 * The READ half of the same store (394-07, D-12 · WTST-05) — the funnel's whole substrate.
 *
 * A SECOND, NARROWER MIRROR rather than a `list` member added to the write port above, and the
 * split is the point: the evaluator writes and never reads back, and the funnel reads and never
 * writes. One port carrying both verbs would let a composition hand the funnel projection a
 * capability to overwrite the very records it is reporting on — and the whole claim of D-12 is
 * that nothing new is persisted, which is easier to keep when the projection is structurally
 * unable to persist anything.
 *
 * `list()` and nothing else. The real store's `get(contentDigest)` exists, and the funnel has no
 * use for it: a funnel is about a POPULATION, and a port able to fetch one receipt by address
 * would invite a projection that walked digests it learned somewhere else — a second denominator
 * beside the one `list()` defines.
 */
export interface DraftReceiptsReadPortLike {
  list(): Promise<DraftReceipt[]>
}

// ---- the authoring LOOP's two host halves (394, D-01 · WTST-01) ---------------------------------
//
// The loop needs three things this package cannot name, and they group into exactly two facts
// about a host rather than into three deps. Stages 1-2 READ what the project already knows — the
// authoring brief and the authored suite as text — before a byte is authored. Stage 3 COMPILES:
// it needs a model and it needs somewhere to put what the model produced. A host either can do
// each half or it cannot, and `composeLocalAgent()` supplies both halves or neither.
//
// `AuthoringBrief` and `ScopeKey` are used in the REAL schema vocabulary rather than mirrored,
// on the `DraftRunPortLike` reasoning stated at the top of this file: those types live in
// `schema`, which this package already depends on, so there is no dependency to invert and a
// mirror of them would be a second spelling of a contract `AuthoringReadPort` already owns.

/**
 * The read half of the loop (stages 1-2).
 *
 * TWO VERBS, ONE FACT. `getAuthoringBrief` is the substrate stage 3 compiles from;
 * `suiteTextCorpus` is the comparison universe stage 2 screens the intent against. A host that
 * could serve one and not the other does not exist — both are reads of this project's own state
 * through capabilities the composition root holds together — so splitting them would make "can
 * this host run the loop's read stages" two questions with one answer, and would let a
 * composition report the op bound while dedup-before-author had nothing to compare against. An
 * empty corpus is a legitimate answer; an absent one is a host that cannot screen.
 *
 * `suiteTextCorpus` yields the SHIPPED {@link SuiteTextCorpusEntryLike} rather than a second
 * entry shape, so stage 2 and gate 3's degraded lane screen the same rows through the same
 * `textSimilarity` and cannot drift into two notions of what a suite test's text is.
 */
export interface AuthoringReadPortLike {
  getAuthoringBrief(intent: string, scope: ScopeKey): Promise<AuthoringBrief>
  suiteTextCorpus(): Promise<readonly SuiteTextCorpusEntryLike[]>
  /**
   * The names a `target` may legally take in this project (394-33, WR-07).
   *
   * A VOCABULARY, NOT A DERIVATION, and that is the whole of what it fixes. `TestDefinitionSchema`
   * requires a `target`, nothing validates one before `runs.start` types it into a live
   * application, and `target` is outside `EDITABLE_POINTER_ROOTS` so no repair patch can correct
   * it — yet stage 3's prompt asked for the value while serving no list to choose from. The Scope
   * block is not that list: `deriveDefaultAuthoringScope` answers a PRODUCT
   * (`target.product ?? targetName`), so on any project where a target declares a product under a
   * different name, the scope key is not a configured target at all.
   *
   * A THIRD VERB ON THE READ HALF rather than a port of its own, on this interface's own stated
   * reasoning: it is a READ of this project's own state through capabilities the composition root
   * already holds, and a host that can serve the brief and the suite corpus but not the names its
   * own config declares does not exist. It is deliberately NOT on `AuthoringScopePortLike` — that
   * port answers WHICH SCOPE THIS PROJECT AUTHORS FOR and can legitimately refuse; this one
   * enumerates and never refuses. An empty array is a legitimate answer (a config declaring no
   * targets), and the block a reader is served says so in words rather than rendering nothing.
   */
  configuredTargetNames(): Promise<readonly string[]>
}

/**
 * The host's answer to "which scope does this project author for?" when the caller named none.
 *
 * SEPARATE FROM {@link AuthoringReadPortLike} rather than a third verb on it, because the two are
 * different facts about a host. The read half needs a knowledge index; this needs the resolved
 * config and the workspace's committed tests, and a host can genuinely have one without the
 * other. Bundling them would make a composition that can derive a scope but serve no brief report
 * the whole read half absent.
 *
 * IT EITHER ANSWERS OR IT THROWS, and there is no third arm. A `ScopeKey | undefined` would put
 * the never-guess decision back at the op, one layer from the evidence — the host is the only
 * side that knows WHICH candidates it saw, and D-19's posture is that a refusal names them.
 */
export interface AuthoringScopePortLike {
  deriveDefault(): Promise<ScopeKey>
}

/**
 * What staging a compiled draft produced — parsed and written, or refused and NOT written.
 *
 * The refusal arm is the T-394-06 mitigation expressed as a return type. Model-authored YAML is
 * the one input on this path that no schema at the op boundary can vet, so it is parsed before it
 * becomes a file; a shape that could only answer "here is your path" would have forced the caller
 * to discover an unparsable draft one stage later, from the verify op, with the bytes already on
 * disk.
 */
export type DraftStageOutcome =
  | { readonly kind: 'staged'; readonly draft: ParsedDraftLike }
  | { readonly kind: 'unparsable'; readonly reason: string }

/**
 * The compile half of the loop (stage 3).
 *
 * ONE BUNDLED CAPABILITY rather than two deps, on the shipped `draftEvaluation` precedent: a host
 * with a model and no shelf cannot author, and a host with a shelf and no model has nothing to
 * author with, so binding them separately would let a composition list this op `bound` and fail
 * far from whichever half was forgotten.
 *
 * `write` TAKES THE BYTES AND NOTHING ELSE. The digest is computed by the host over the bytes it
 * is writing, never supplied by the caller — `DraftRef.contentDigest`'s whole promise is that a
 * later edit cannot inherit an earlier receipt, and a caller that could name the digest could
 * name one that is not the digest of anything. The path is minted from that digest, so nothing
 * the model emitted reaches the filesystem as a path component either.
 *
 * The returned draft's `filePath` is WORKSPACE-RELATIVE, which is one spelling doing three jobs:
 * it is what `authoring.draft.verify` takes as `draftPath`, what `runs.start` accepts in
 * `patterns`, and what the runner records on `PerTestOutcome.filePath` so gates 1-2 can find the
 * draft's own member.
 */
export interface DraftShelfPortLike {
  /**
   * The model stage 3 authors with — built by the host through `createModel` (389 D-04).
   *
   * A FACTORY and not an object, on the composition root's own `model` idiom: a model is
   * resolved at most once and lazily, when something actually needs one, so a composition can
   * bind this capability without constructing a client for a host that never authors a draft.
   */
  model(): Promise<JobModelCapability>
  /** Parse, then write, in that order. An unparsable draft leaves nothing on disk. */
  write(contents: string): Promise<DraftStageOutcome>
  /**
   * Apply an RFC-6902 patch set to a staged draft and stage the result (394-06, D-09/D-20).
   *
   * THE ONE PATCH APPLIER, REACHED THROUGH A PORT RATHER THAN AN IMPORT. `applyPatchSetToTestDoc`
   * lives in `core` — it needs the yaml CST so untouched nodes keep their source bytes — and this
   * package may not depend on `core` at all (the FUNC-02 firewall stated at the top of this file).
   * The host binds this verb over that applier, so the repair loop and the user-facing edit op are
   * two consumers of one contract, which is the property a patch vocabulary with a single consumer
   * cannot keep.
   *
   * It answers the SAME `DraftStageOutcome` the whole-document `write` answers, and for the same
   * reason: what comes back from a model cannot be trusted to still be a runnable test document
   * after it is applied, so the result is parsed before it is anything else, and an unparsable
   * result leaves the shelf as it was.
   */
  applyPatches(draft: ParsedDraftLike, patchSet: TestEditPatchSet): Promise<DraftStageOutcome>
  /**
   * The run capability stage 5 reads evidence through and the repair arm probes with (394-06).
   *
   * ON THIS BUNDLE rather than as a fourth loop dep, on the bundle's own stated reasoning: none of
   * these capabilities is independently bindable. `verifyDraft` already dispatches an op that
   * starts gate runs, so a host that can verify a draft can start and read one by construction —
   * a shelf bound without this would be a host that can ask whether a draft is any good and cannot
   * look at the runs that answered.
   *
   * It is the HANDOFF reader (`DraftRunPortLike.get`) and not `runs.get`'s projection, because the
   * router decides on per-step execution evidence — terminations, planning failures, cycle flags —
   * and none of that survives a `RunDetail`, whose only step-shaped field is a count.
   */
  readonly runs: DraftRunPortLike
  /**
   * The dispatch scope this invocation's gate runs are approved under (401-08, D-08).
   *
   * OPTIONAL, and absent is the honest posture rather than a degraded one: a host whose runs never
   * reach an ask-tier gate — a project declaring its target `local`, which the ratified table
   * allows in EVERY execution context — needs no grant at all, and a loop that REQUIRED one would
   * make a policy affordance a binding requirement. Where it is absent the child gate runs cross
   * the gate exactly as they did before this field existed.
   *
   * ON THIS BUNDLE beside `runs`, on the bundle's own rule: it is not independently bindable. A
   * host that can start a gate run is exactly the host whose approval to start one can be scoped.
   */
  readonly dispatchGrants?: DispatchGrantPortLike
  /**
   * Stage 4, dispatched as the REGISTERED `authoring.draft.verify` op (D-01, op-calls-op).
   *
   * A closure the composition root mints over the registry it is building, exactly as
   * `createDraftEvaluation`'s `startGateRun` is minted over the same deferred reference — it is
   * how a registered op reaches a sibling registered op without this package being able to name a
   * registry. It rides THIS bundle rather than a dep of its own because it is not independently
   * bindable either: a host that can compile and stage a draft but cannot verify one would author
   * a test and then have nothing to say about whether it is worth keeping, which is the one answer
   * the loop exists to produce.
   */
  verifyDraft(input: AuthoringVerifyDraftInput): Promise<DraftReceipt>
}

/**
 * Where a loop outcome BECOMES something a person can find (394-18, D-05/D-11 · WTST-05).
 *
 * THE PORT EXISTS BECAUSE THE STORE IS ONE PACKAGE AWAY. Persisting a proposal is
 * `knowledge-local`'s `writePendingProposalRecord`, and `agent` may not depend on it — the FUNC-02
 * firewall stated at the top of this file. `composeLocalAgent()` binds that verb here, exactly as
 * it binds the receipts store and the draft applier.
 *
 * WHY THE HOST MINTS THE ID AND STAMPS THE INSTANT. `ProposalRecordSchema` requires an id whose
 * shape is `ProposalIdSchema`'s, which the durable store owns along with `mintProposalId` — an id
 * minted in this package would be a second recipe for a value that becomes a filename in another.
 * And `origin.at` is a CLOCK READ: nothing in `agent` reads one (`grep -rn 'Date.now()'` over
 * `packages/agent/src` outside `__tests__` returns nothing, measured at this plan), because a
 * composition that pinned its clock for a test would otherwise still have its proposals expire
 * against real wall time. The caller supplies what only IT knows — the kind, the payload, and which
 * op emitted it — and is told which id the store filed it under.
 *
 * The payload types are read off the SHIPPED `ProposalRecord` rather than mirrored, on this file's
 * own stated discipline: they live in `schema`, which this package already depends on, so there is
 * no dependency to invert and a mirror would be a second spelling of the envelope's own arms.
 */
export interface AuthoringProposalsWritePortLike {
  put(record: AuthoringProposalWrite): Promise<{ readonly proposalId: string }>
}

/**
 * One proposal to persist: its kind, its correlated payload, and its attribution.
 *
 * DISCRIMINATED AND CORRELATED, following {@link ProposalRecord}'s own mapped-type idiom, so a
 * binder that narrowed on `kind` learns what `payload` is. `knowledge` is deliberately NOT a member
 * — a knowledge proposal is minted by the review verbs with their own targets and deltas, and a
 * second door into that store from the authoring loop would be a second answer to what a knowledge
 * proposal is.
 */
export type AuthoringProposalWrite = {
  [K in 'test-draft' | 'finding']: {
    readonly kind: K
    /** The emitting op's bare id — provenance for a person reading an inbox, never a match key. */
    readonly emittedBy: string
    /**
     * The run this proposal is attributable to, if the caller can name ONE (394-18).
     *
     * An authoring invocation spends up to nine child runs, so "which run produced this" is a real
     * question with a wrong answer available. The rule is BORROWED rather than invented: stage 5
     * already routes on the LAST gate run the receipt names — gate 2 early-stops on a verdict flip,
     * so the run that stopped it is the one carrying what the gates ultimately reported — and this
     * is that same run. Absent when the receipt names none, which is the honest answer rather than
     * a gap: `runs.digest` attributes rows by exactly this field, so a fabricated id would put a
     * proposal in a stranger's digest.
     */
    readonly runId?: string
    readonly payload: Extract<ProposalRecord, { kind: K }>['payload']
  }
}['test-draft' | 'finding']

/**
 * The one-commit apply (394-10, D-06 · WTST-01), as a host capability this package cannot name.
 *
 * A STRUCTURAL MIRROR on this file's stated discipline: writing a file and making a git commit
 * needs the CHECKOUT ROOT and `workspaceRelativeIdentityPath`, both of which live in `core`, which
 * `agent` may not depend on. `composeLocalAgent()` binds the CLI host's `applyTestDraftAsOneCommit`
 * here unchanged.
 *
 * IT IS NOT ON `DraftShelfPortLike`. Every member of that bundle is a capability the AUTHORING LOOP
 * exercises, and this one is exercised by `proposals.accept` — a different op, reached by a human
 * decision, on a host that need not be able to author anything at all (a read-only surface can
 * still hold a person's accept). Bundling it would have made "can this host run the loop" and "can
 * this host commit an accepted draft" one question with one answer, which they are not.
 *
 * THE REQUEST CARRIES THE PAYLOAD RATHER THAN ONLY AN ID. It was minted that way because nothing
 * persisted a `test-draft` record on any host, so a port taking an id alone would have been asking
 * a host to look up something no store could hold. 394-18 landed that store, and the shape is KEPT
 * on its own merits rather than by inertia: the accept has already read the envelope to learn which
 * kind it is dispatching, so handing the payload it is holding to the route it chose is one read,
 * and an id would make the host read the same record a second time — with a window in between in
 * which the two reads can disagree about the very digest the apply re-checks.
 */
export interface DraftApplyPortLike {
  apply(request: TestDraftApplyRequestLike): Promise<TestDraftApplyResultLike>
}

/** What accepting a `test-draft` asks the host to write and commit. */
export interface TestDraftApplyRequestLike {
  readonly proposalId: string
  /** The staged draft's workspace-relative shelf path — where the bytes come from. */
  readonly draftPath: string
  /** Where they go. Boundary-checked at the host by the identity mint and nothing else. */
  readonly targetPath: string
  /** Absent means the proposal read no target, which the host re-checks as a claim about absence. */
  readonly sourceDigest?: string
  /** The line a person read in their inbox; becomes the commit subject. */
  readonly summaryLine: string
}

export interface TestDraftApplyResultLike {
  readonly filePath: string
  readonly commit: string
}
