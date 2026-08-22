// The `authoring.draft.verify` op contract (393, D-01).
//
// D-01 sketches the verb as `authoring.verify_draft`; that spelling is unrepresentable — the
// parity taxonomy regex forbids underscores and the chat tool-name mapping refuses one (393-07).
// The schema symbols keep the sketch's camel-case spelling; the dispatchable id does not.
//
// The planner binds ALL registry ops 1:1 (392 D-07), so this op is chat-reachable the moment
// it registers — its input is crossing a trust boundary from an arbitrary caller, not being
// handed over between two halves of the same program. `.strict()` plus a non-empty path is
// therefore the refusal surface, not a formality. Path-boundary enforcement (is this draft
// inside the workspace at all?) belongs at the op invoke where the resolved config exists;
// this schema's job is to make sure the invoke is never handed a shape it must guess about.

import { z } from 'zod'

import { AuthoringFunnelSchema } from '../authoring/funnel'
import { DraftReceiptSchema, DraftRefSchema } from '../authoring/draft-receipt'
import { FanOutReportSchema } from '../authoring/fan-out'
import { PatchOpSchema } from '../authoring/patch-ops'
import { TestDraftProposalV1Schema } from '../authoring/proposal-arms'
import type { ScopeTier } from '../identity/scope-key'

export const AuthoringVerifyDraftInputSchema = z.object({
  /** Path to the draft test file to evaluate. Resolved and boundary-checked at the invoke. */
  draftPath: z.string().min(1),
  /**
   * Draft mode: run the stability gate ONCE instead of the pinned N.
   *
   * D-18 makes this consequential rather than a speed knob — a draft-mode evaluation's
   * disposition is forced to `unverified` unconditionally, so nothing evaluated this way can
   * be auto-kept no matter how its four booleans read. Only the literal marker is accepted,
   * matching the `gateRun` / `excludedFromOutcomes` carrier idiom: `false` is a refusal, not a
   * synonym for absence, so a caller cannot half-express the intent.
   */
  draftMode: z.literal(true).optional(),
  /**
   * The invoking session, carried to the receipt this evaluation mints.
   *
   * Optional and never defaulted, under {@link DraftReceiptSchema}'s own absence-is-exclusion rule
   * — see the field's doc there for why a defaulted ref is the one shape that misattributes.
   */
  sessionRef: z.string().min(1).optional(),
  /**
   * The suite file this draft proposes to JOIN — the stability read's target (394-19, D-14).
   *
   * ABSENT MEANS THE DRAFT'S OWN FILE, which is the right answer for a standalone verify: a
   * committed suite file IS its own target. It is a CHOSEN contract rather than a derivation
   * because on the loop path the draft sits on a one-test-per-file shelf, so a target derived from
   * `draftPath` can never have neighbours and D-14's `neighbours-flaky` arm was unreachable from
   * `authoring.draft.write` for that reason alone. Only the caller knows which suite a draft would
   * join; the loop computes it through the same `authoredSuiteTargetPath` its accept arm uses.
   */
  targetSuitePath: z.string().min(1).optional(),
}).strict()

export type AuthoringVerifyDraftInput = z.infer<typeof AuthoringVerifyDraftInputSchema>

/**
 * The op returns the receipt it persisted — the same bytes, not a summary of them (D-19), so a
 * caller never has to re-read the store to learn what was just decided.
 */
export const AuthoringVerifyDraftOutputSchema = DraftReceiptSchema

export type AuthoringVerifyDraftOutput = z.infer<typeof AuthoringVerifyDraftOutputSchema>

// ---- `authoring.draft.write`: the six-stage loop's one public entry (394, D-01 · WTST-01) ------

/**
 * The scope the brief is read at and the draft is authored for.
 *
 * A module-private schema on the `functions/runs.ts` and `functions/knowledge.ts` idiom — each
 * file that has to validate a scope keeps its own, because there is no exported `ScopeKeySchema`
 * in this package and minting one now would publish a fourth spelling of a two-field object three
 * files already validate identically.
 */
const scopeKeySchema = z.object({
  tier: z.enum(['global', 'product', 'suite', 'test'] satisfies readonly ScopeTier[]),
  key: z.string().min(1),
}).strict()

/**
 * How one loop invocation ended — the CLOSED vocabulary, declared whole in 394-02 (D-01).
 *
 * All four members exist from the tracer onward and only `drafted` is reachable in it. That is
 * deliberate rather than premature: the loop is a six-stage pipeline whose stages land across
 * plans 04, 05 and 06, and a vocabulary that grew a member per plan would make each of those a
 * change to the SHAPE every consumer branches on — the op's output contract, 396's MCP
 * projection, 397's parity walk — instead of a new branch behind a discriminant they already
 * read. Declaring the whole set now costs one enum and buys three plans that add a case.
 *
 *   `drafted`  the draft was compiled, staged and verified; the receipt carries the verdict.
 *   `refused`  stage 2 found the intent already covered and ended the invocation (D-04, plan 04).
 *   `repaired` stage 5 routed to bounded repair and a later iteration passed (D-08/D-10, plan 05).
 *   `finding`  stage 5 routed to the app-broken branch: a correctly-failing draft (D-11, plan 06).
 */
export const AUTHORING_LOOP_OUTCOMES = [
  'drafted',
  'refused',
  'repaired',
  'finding',
] as const

export type AuthoringLoopOutcomeKind = (typeof AUTHORING_LOOP_OUTCOMES)[number]

/**
 * The two continuations a dedup refusal offers (394 D-04) — CLOSED, and minted here.
 *
 * It lives in `schema` rather than beside the lane that produces it because the op's output
 * validates it and chat renders it, and 384 D-16 puts a DTO's vocabulary where every surface
 * reading it can share one spelling. A second `as const` in `agent` would be the drift that law
 * exists to prevent, and would make "which continuation did an author take" — a question plan
 * 07's funnel asks — answerable two ways.
 *
 * TWO MEMBERS, and neither covers the other. An author whose intent really is the existing test
 * takes `extend-that-test`; an author whose intent is a DIFFERENT assertion about the same flow
 * has nothing to extend and takes `name-the-differing-assertion`, which is the honest question to
 * put to someone the screen may have over-flagged. Offering only the first would make an
 * over-flagging screen — the ratified safe direction — unappealable.
 */
export const AUTHORING_DEDUP_CONTINUATIONS = [
  'extend-that-test',
  'name-the-differing-assertion',
] as const

export type AuthoringDedupContinuation = (typeof AUTHORING_DEDUP_CONTINUATIONS)[number]

/**
 * What a stage-2 refusal NAMES (394 D-04).
 *
 * THE OUTPUT'S ONE PAYLOAD ARM, AND THE EXCEPTION IS PRINCIPLED. The output contract below states
 * that it carries no payload per outcome, because a finding's evidence and a proposal's diff ride
 * 391's envelope into the inbox and a second copy here would be a second place to read one
 * artifact. A dedup refusal has NO such home: nothing was authored, so there is no draft, no
 * receipt, no gate-run and no envelope, and D-04 makes the refusal a typed op RESULT that ends the
 * invocation and is rendered by chat. Omitting the payload would not avoid a second read path, it
 * would remove the only one — leaving a caller told `refused` with no way to learn what it
 * matched, which is precisely the refuse-and-LINK requirement.
 *
 * `matchedRef` is the reference a caller hands to `entities.resolve`, spelled
 * `<filePath>::<testName>`. It is deliberately NOT a `TST-###` short-ID: a short-ID exists only
 * once something has sighted the entity, sighting is what mints the permanent address, and no
 * `TST` sighting source is wired on any host in this build — so printing one would publish an
 * address that resolves to nothing (ENTY-01's never-guess law).
 *
 * `threshold` rides beside `score` because a refusal reporting 0.52 without saying what it was
 * compared against cannot tell an author whether their intent was borderline or identical.
 */
export const AuthoringDedupRefusalSchema = z.object({
  /** Workspace-relative path of the suite test the intent duplicates. */
  filePath: z.string().min(1),
  /** That test's display name — identity half two, never `testId`. */
  testName: z.string().min(1),
  /** The `entities.resolve` reference for it, in one spelling. */
  matchedRef: z.string().min(1),
  /** Token-set similarity, in [0,1]. */
  score: z.number().min(0).max(1),
  /** The pinned value it met or exceeded. */
  threshold: z.number().min(0).max(1),
  /** How many normalized tokens the intent and that test share — the score's numerator. */
  sharedTokens: z.number().int().min(0),
  /** How many suite tests were screened. The universe is the suite, not a covered subset. */
  comparedTests: z.number().int().min(0),
  /** Both continuations, always — see the vocabulary's own doc block. */
  continuations: z.array(z.enum(AUTHORING_DEDUP_CONTINUATIONS)).length(2),
}).strict()

export type AuthoringDedupRefusal = z.infer<typeof AuthoringDedupRefusalSchema>

/**
 * What a caller hands the loop.
 *
 * `.strict()` and a non-empty intent for the reason the verify input states above, and here the
 * argument is sharper: `intent` is free text from an arbitrary caller that reaches an LLM and then
 * becomes bytes on this workspace's disk (T-394-06). The refusal surface a schema can hold is the
 * shape and the emptiness; what the model produces is validated again, by the parser, before a
 * single byte is written.
 */
export const AuthoringDraftWriteInputSchema = z.object({
  /** Plain-English description of the test to author. */
  intent: z.string().min(1),
  /**
   * Which scope the authoring brief is read at, and the draft is authored for.
   *
   * OPTIONAL, and absent resolves from the host's configured targets and committed tests — the
   * `RunsStartInputSchema.scope` law one op over, applied here for the reason that op adopted it:
   * a model cannot know this project's product keys, and a required field it can only guess at is
   * a field it refuses the whole call over (WINDOWS 110). A supplied scope always wins; the host
   * derives only on absence, and refuses by name rather than guessing when the answer is not
   * unique.
   *
   * THE `.describe()` BELOW IS THE HUMAN-FACING HALF, AND IT IS WHY IT IS A `.describe()` RATHER
   * THAN THIS DOC BLOCK (400-04, D-19). A JSDoc comment documents this field for whoever opens
   * this file; it reaches no reader of the product. The capability catalog is PRODUCED from the
   * declarations — `params` is the JSON-Schema projection of this very object — so a description
   * attached HERE is the single edit that documents `scope` on the surfaces that project `params`,
   * and a paragraph anywhere else is a paragraph the product never says.
   *
   * WHICH SURFACES THOSE ARE WAS MEASURED, NOT ASSUMED (400-12, WINDOWS #189). An earlier version
   * of this block claimed `/help`, `explain` and the chat type-ahead were "all projections of that
   * ONE committed artifact". They are not, and the claim was measured FALSE: `/help` and the
   * type-ahead render `row.description` (the op summary) rather than `params`, and `explain`
   * deliberately withholds params from its prompt (`explain-port.ts:17`, D-10-sanctioned charter
   * design). They project a different FIELD of the same artifact. The surfaces this `.describe()`
   * actually reaches are the capability catalog row, `init --agent`, MCP `tools/list`, and the
   * dashboard's served `GET /api/chat/catalog` — the D-19 letter as RATIFIED on 2026-08-22, and
   * pinned in both directions by `packages/cli/src/__tests__/scope-doc-surfaces.test.ts`.
   * Projecting `params` into `/help` and the type-ahead stays open as a Rule-4 design question
   * (WINDOWS #189); it needs resolver-table surgery, not a wider sentence here.
   *
   * The 399 rehearsal measured what its absence costs: `/fn authoring.draft.write` ROUTES, meets
   * the confirm interactively, and then fails on `AuthoringScopeUnresolvableError` naming targets
   * the caller was never told they had to choose between — a field that is undocumented on every
   * surface a person reads is a field they can only learn about by being refused over it.
   *
   * IT DOES NOT RESTATE THE MODEL-FACING SENTENCE AND MUST NOT CONTRADICT IT.
   * `planner-tools.ts`'s `HOST_DERIVES_SCOPE` already tells the PLANNER who fills this field and
   * that the host never guesses; that sentence is load-bearing (it carries the 394-35 dist-gate
   * sentinel) and is untouched. This text says the same things in the same direction and adds the
   * half the planner has no use for: what a `/fn` caller typing JSON by hand has to pass.
   */
  scope: scopeKeySchema.optional().describe(
    'Which product this test is authored for — the target key, e.g. `automation-exercise`. '
    + "In chat the planner fills this from the person's own words: a request that names the page, "
    + 'product or site it is for supplies the scope, and nothing needs to be typed. Calling '
    + '`/fn authoring.draft.write` directly, pass it explicitly — `{"scope":{"tier":"product",'
    + '"key":"<target>"}}` — whenever this project scaffolds more than one target. When it is '
    + 'omitted the host derives it ONLY where the project has exactly one candidate product; '
    + 'otherwise the call returns a typed refusal that names every candidate so you can choose '
    + 'one. It never guesses at a product, because authoring against a guessed product writes a '
    + 'test for the wrong application.',
  ),
  /**
   * Draft mode: the stability gate runs ONCE instead of the pinned N.
   *
   * Handed straight through to `authoring.draft.verify`, marker idiom and consequences intact —
   * a draft-mode evaluation's disposition is forced to `unverified`, so nothing authored this way
   * can be auto-kept. `z.literal(true)` for the same reason it is there: `false` is a refusal, not
   * a second spelling of absence.
   */
  draftMode: z.literal(true).optional(),
  /**
   * The invoking session, threaded to every receipt this invocation mints — the loop's own and the
   * one a repaired candidate earns.
   *
   * Optional and never defaulted, under {@link DraftReceiptSchema}'s absence-is-exclusion rule; a
   * session-owning surface stamps it at the invoke and a CLI supplies nothing.
   */
  sessionRef: z.string().min(1).optional(),
}).strict()

export type AuthoringDraftWriteInput = z.infer<typeof AuthoringDraftWriteInputSchema>

/**
 * What one loop invocation answers.
 *
 * The receipt is the WHOLE receipt the evaluator minted and persisted, not a summary of it — the
 * verify op's own rule, inherited because this op reaches that op rather than re-deciding
 * anything. `draftRef` is carried beside it even though the receipt already holds one, because it
 * is the answer to a different question: which draft this call produced, addressable without
 * knowing that a receipt is a thing that has a ref inside it.
 *
 * There is no payload arm per outcome. A finding's evidence and a proposal's diff ride 391's
 * envelope into the inbox (D-05/D-11), so widening this contract with them would mint a second
 * place the same artifact could be read from.
 *
 * `fanOut` IS THE ONE RECORDED EXCEPTION, AND IT IS AN EXCEPTION TO THAT PARAGRAPH ON PURPOSE
 * (394-14 · WTST-08). WTST-08's owner decision was preview plus honest reporting with NO enforced
 * budget, which moves the entire mitigation for an unbounded fan-out onto DISCLOSURE: the number a
 * person is shown at the dispatch confirm is the control, and the number they are shown afterwards
 * is what makes that control falsifiable. A number nobody can read after the fact is a disclosure
 * with no second half — the person approved nine runs and has no way to learn that eleven were
 * taken. Until this field existed the loop computed the report correctly and `invoke()` discarded
 * it, so `renderFanOutReport` had zero production callers and `exceedsPreview` was a flag nothing
 * could surface (394-VERIFICATION, SC-5).
 *
 * IT IS A MAP AND NEVER A TERRITORY, which is exactly what keeps it inside the prohibition's
 * reasoning rather than beside it. The prohibition exists so one artifact is not readable from two
 * places; `FanOutReport` is not an artifact at all. It is counts, run REFERENCES and one boolean
 * about the disclosure — no draft body, no receipt payload, no step evidence, nothing a person
 * would read instead of the inbox copy. A field carrying `outcome.proposal` would be the defect
 * the paragraph above rules out and stays ruled out; this one is the disclosure's other half.
 *
 * BOTH ARE OPTIONAL, AND `outcome` SAYS WHICH TO EXPECT — the `KnowledgeApplyOutcome.forgetReceipt`
 * idiom. A `drafted`, `repaired` or `finding` invocation carries both; a `refused` one ends at
 * stage 2 with no draft compiled and therefore no receipt to mint (D-04, plan 04). Requiring them
 * would have made plan 04's arrival a WIDENING of this op's output contract — the shape change the
 * whole-vocabulary-now discipline exists to avoid — and padding a refusal with an empty receipt
 * would be worse: a receipt is a durable record of gates that ran, and a synthetic one would be a
 * verdict about a draft that was never authored.
 */
export const AuthoringDraftWriteOutputSchema = z.object({
  draftRef: DraftRefSchema.optional(),
  receipt: DraftReceiptSchema.optional(),
  outcome: z.enum(AUTHORING_LOOP_OUTCOMES),
  /**
   * Present exactly on a stage-2 `refused` invocation. See {@link AuthoringDedupRefusalSchema}
   * for why this one payload arm exists where the paragraph above rules the others out.
   */
  refusal: AuthoringDedupRefusalSchema.optional(),
  /**
   * What was previewed at the confirm, beside what this invocation actually spent.
   *
   * REQUIRED ON EVERY ARM, unlike `draftRef` and `receipt`. Those two are absent because a stage-2
   * refusal genuinely has neither. Cost is different in kind: "this invocation ran nothing" is a
   * true and useful answer, and `buildFanOutReport({ previewed: NO_RUNS_FAN_OUT_BOUND, runs: [] })`
   * is what the loop already answers with on that arm. An OPTIONAL field would make absent and
   * zero indistinguishable at a caller — "nobody counted" and "nothing ran" read the same — which
   * is the one ambiguity a disclosure may not have.
   */
  fanOut: FanOutReportSchema,
}).strict()

export type AuthoringDraftWriteOutput = z.infer<typeof AuthoringDraftWriteOutputSchema>

// ---- `authoring.funnel.get`: the honesty funnel's one read op (394, D-12/D-13 · WTST-05) -------

/**
 * The window a funnel is computed over — a CLOSED, DISCRIMINATED three-arm scope.
 *
 * IT IS A SCOPE, NOT A FILTER, and the distinction is why it exists where `quarantine.list`
 * deliberately has none. That op's header refuses a filter because "a filter here would make the
 * verb's answer depend on how it was asked" — a reader concern over rows already in hand. This
 * parameter does something different in kind: it selects WHICH INVOCATIONS the projection is over,
 * which is the projection's denominator rather than a predicate applied after it. A funnel with no
 * scope would be forced to answer all-time, and "how is this session doing" — D-12's stated
 * default and the question WTST-05 asks — would be unanswerable from any surface.
 *
 * THE SESSION ARM CARRIES THE REF, because the op cannot know it. `FunctionSpec.invoke` receives
 * `(input, deps)` and nothing else — no caller — and `FunctionDeps` holds no session. D-12's
 * "default scope = current session" is therefore a SURFACE default, honoured where the session is
 * actually known, never a schema default that would have to guess. A defaulted session ref is the
 * one shape that could quietly report a different session's drafts as this one's.
 *
 * CHAT IS THE SURFACE THAT CONSTRUCTS ONE (394-19). It stamps its own session onto the two
 * `sessionRef`-carrying authoring ops, so receipts are ATTRIBUTED; and at the same invoke it
 * supplies THIS window — the session arm by default when a planner step carries none, and the
 * session arm's REF overwritten when the model emitted one — which is D-12's surface default
 * honoured exactly where the session is known. The all-time and last-n arms pass through
 * untouched. The CLI has no session, so it constructs nothing and asks all-time, which is the
 * honest answer for a caller that has none.
 *
 * `sessionRef` is compared by EXACT STRING EQUALITY and is opaque here: this package mints no
 * session ids and parses none, so any host's spelling round-trips unexamined.
 */
export const AuthoringFunnelWindowSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('session'),
    sessionRef: z.string().min(1),
  }).strict(),
  z.object({ scope: z.literal('all-time') }).strict(),
  z.object({
    scope: z.literal('last-n'),
    /** The N most recently EVALUATED drafts, newest first by `evaluatedAt`. */
    n: z.number().int().positive(),
  }).strict(),
])

export type AuthoringFunnelWindow = z.infer<typeof AuthoringFunnelWindowSchema>

/**
 * What a caller hands the funnel read. The window and nothing else.
 *
 * `.strict()` on the loop input's reasoning: 392 D-07 binds every registry op into the planner's
 * toolset, so this shape crosses a trust boundary from an arbitrary caller rather than being
 * handed between two halves of one program.
 */
export const AuthoringFunnelGetInputSchema = z.object({
  /**
   * ITS `scope` IS A HOMONYM, AND THAT IS EXACTLY WHY IT IS DOCUMENTED HERE (400-04, D-19).
   *
   * `authoring.draft.write.scope` names a PRODUCT to author for. This op's `window.scope` names a
   * SPAN OF HISTORY to count over — `session` / `all-time` / `last-n`. Two fields spelled the same
   * with nothing in common, sitting on two ops a person meets in the same breath. D-19's doc half
   * would have made that worse, not better, if this row had inherited the product-target sentence:
   * a catalog that documented this `scope` as "the target product" would be a produced artifact
   * confidently describing a capability the product does not have.
   *
   * AND THE HUMAN IS THE ONLY READER THIS TEXT HAS. `window` is host-stamped for the planner —
   * `WINDOW_STAMPED_FUNCTION_IDS` carries this op, so `modelFacingInput()` drops `window` from
   * `required` and the model is told it will be supplied. So this description is not planner
   * guidance at all; it exists for the human-facing surfaces D-19 says were undocumented — which,
   * as MEASURED by 400-12 (WINDOWS #189), are the capability catalog row, `init --agent`, MCP
   * `tools/list` and the dashboard's served `GET /api/chat/catalog`. NOT `/help`, `explain` or the
   * type-ahead: those render `row.description`, or withhold params by charter. See the `scope`
   * field's doc block above for the full measurement and the D-19 ratification.
   */
  window: AuthoringFunnelWindowSchema.describe(
    'Which drafts to count — a span of history, NOT a product. `{"scope":"session","sessionRef":'
    + '"<id>"}` counts only what this conversation authored; `{"scope":"all-time"}` counts every '
    + 'draft this workspace has evaluated; `{"scope":"last-n","n":<count>}` counts the N most '
    + 'recently evaluated, newest first. In chat you never type this: the session supplies its own '
    + 'window, and asking about the current conversation is the default. Do not confuse it with '
    + '`authoring.draft.write`\'s `scope`, which names the product a test is authored for.',
  ),
}).strict()

export type AuthoringFunnelGetInput = z.infer<typeof AuthoringFunnelGetInputSchema>

/**
 * The op answers the ONE computation's result, unchanged — see `authoring/funnel.ts`.
 *
 * Not a summary of it and not a re-shaping: the op re-derives nothing, so the contract IS the
 * DTO the derivation produces. The window is deliberately NOT echoed back; a caller knows what it
 * asked, and echoing it would invite a surface to render the scope off the answer rather than off
 * the request, which is two sources for one fact.
 */
export const AuthoringFunnelGetOutputSchema = AuthoringFunnelSchema

export type AuthoringFunnelGetOutput = z.infer<typeof AuthoringFunnelGetOutputSchema>

// ---- `authoring.draft.edit`: the patch contract's second consumer (394-09, D-21 · WTST-07) ------

/**
 * What a caller hands the edit op.
 *
 * TWO FIELDS, AND BOTH CROSS A TRUST BOUNDARY. `testRef` decides WHICH of a person's committed
 * tests is rewritten, and `intent` is free text that reaches a model and becomes a patch set. So
 * `.strict()` and non-empty are the shape refusal, and everything a schema cannot check is refused
 * downstream by a named error: the ref by the never-guess binder (D-19), the emitted patches by the
 * region fence, and the patched document by the parser before anything is proposed.
 *
 * `testRef` accepts the `<filePath>::<testName>` spelling this project already prints — the same
 * string a dedup refusal hands back — as well as free text, which is routed to the house resolver.
 * Which of the two arrived is not a caller's declaration but a fact about the string, decided in
 * one place; a `kind` discriminant here would let a caller assert an exact address for text that
 * is not one.
 */
export const AuthoringDraftEditInputSchema = z.object({
  /** The test to edit: `<filePath>::<testName>`, or a name to resolve. Never guessed at. */
  testRef: z.string().min(1),
  /** Plain-English description of the change. */
  intent: z.string().min(1),
}).strict()

export type AuthoringDraftEditInput = z.infer<typeof AuthoringDraftEditInputSchema>

/**
 * What one edit answers: the proposal, the draft it points at, and the diff that produced it.
 *
 * THE DIFF RIDES THE OUTPUT AND NOT THE PROPOSAL ARM, which is a decision rather than an oversight.
 * `TestDraftProposalV1` is 394-06's arm and it describes EVERY test draft this phase produces —
 * including the ones the loop authors whole, which have no diff at all, because a new file has no
 * untouched lines to have preserved (D-02). A `patches` field on the arm would therefore be absent
 * or empty for the majority of the artifacts it appears on, and an inbox reader would have to learn
 * that an empty diff means two different things. The patch set is a fact about THIS invocation, and
 * this is the shape that invocation's caller reads.
 *
 * The ops are the diff in the contract's own vocabulary, and they are more precise than a line
 * range: a JSON Pointer names a node, and the guarantee that the rendered bytes changed only where
 * those pointers reach is 394-03's frozen corpus over the very applier this op reuses — which is
 * the whole argument for reusing it rather than writing a second one.
 */
export const AuthoringDraftEditOutputSchema = z.object({
  /** The edited draft, staged on the shelf. Nothing is written to the committed suite here. */
  draftRef: DraftRefSchema,
  /** The committed test this edit was applied to, as the binder resolved it. */
  editedFrom: z.object({
    filePath: z.string().min(1),
    testName: z.string().min(1),
    /** How the ref bound: an exact address, or a unique high-confidence resolver hit (D-19). */
    boundBy: z.enum(['exact-ref', 'resolver']),
  }).strict(),
  /** The RFC-6902 ops that were applied — the diff. See the contract's doc block. */
  patches: z.array(PatchOpSchema),
  /** The model's own account of the change, stored as prose so nothing downstream parses it. */
  thoughts: z.string(),
  /** The `test-draft` arm this edit lands on 391's envelope as. */
  proposal: TestDraftProposalV1Schema,
}).strict()

export type AuthoringDraftEditOutput = z.infer<typeof AuthoringDraftEditOutputSchema>
