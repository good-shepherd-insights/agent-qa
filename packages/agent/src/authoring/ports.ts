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
  /** Pre-interpolation NL step text. Post-interpolation text can carry resolved secrets (D-19). */
  readonly steps: readonly string[]
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
