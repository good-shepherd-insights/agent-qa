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

import { DraftReceiptSchema, DraftRefSchema } from '../authoring/draft-receipt'
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
  /** Which scope the authoring brief is read at, and the draft is authored for. */
  scope: scopeKeySchema,
  /**
   * Draft mode: the stability gate runs ONCE instead of the pinned N.
   *
   * Handed straight through to `authoring.draft.verify`, marker idiom and consequences intact —
   * a draft-mode evaluation's disposition is forced to `unverified`, so nothing authored this way
   * can be auto-kept. `z.literal(true)` for the same reason it is there: `false` is a refusal, not
   * a second spelling of absence.
   */
  draftMode: z.literal(true).optional(),
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
}).strict()

export type AuthoringDraftWriteOutput = z.infer<typeof AuthoringDraftWriteOutputSchema>
