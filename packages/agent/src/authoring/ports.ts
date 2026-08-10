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
  CompletedRunHandoff,
  DraftReceipt,
  RunStartAcknowledgement,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

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
