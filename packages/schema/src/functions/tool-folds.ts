// The declared fold contracts (2026-08-16, Phase 396 plan 04 — D-01 / D-16 · MCPS-02).
//
// WHY THIS FILE IS IN `schema` AND NOT IN `packages/mcp`. A fold is an MCP-surface idea: several
// sibling registry ops arrive through ONE tool with a discriminated-union input, because the
// registry is finer-grained than the workflow a caller is actually in (D-01). The natural home for
// the composition is therefore the MCP package — and it cannot live there. That package's runtime
// dependency allow-list is exactly the two protocol packages (D-20, enforced by `validate:arch`),
// deliberately naming no validator library, and composing a discriminated union is a zod operation.
// The alternative — composing at the JSON-Schema level inside `packages/mcp` — is worse than
// inconvenient: every arm below is a `.strict()` object, so `additionalProperties: false` would
// REJECT the discriminant key that a JSON-Schema-level composition had just added to it. A fold
// built that way would advertise a contract that refuses every call made against it.
//
// So the composition happens where zod lives, which is also where this repository mints its DTOs
// (384 D-16). Nothing here is a new shape: every arm is an op's OWN input DTO with one literal
// property added, and every fold output is composed from the arms' own output contracts. No field
// is re-declared, so an arm that gains a field gains it here on the next build.
//
// THE DISCRIMINANT VALUE IS THE OP ID. Not a short verb — `'config.field.set'`, not `'set_field'`.
// That is what makes the tool handler's dispatch mechanical rather than a second lookup table: the
// handler reads the discriminant, checks it against the tool's DECLARED op set, and invokes exactly
// that op. A short verb would have needed a verb -> op map somewhere, and a map is a place two
// spellings of one fact can disagree. The op ids are spelled as literals here because this package
// may not import the function layer; `packages/mcp`'s bump guard reads them back OUT of the
// composed schema and compares them against the registry's own enumeration, so the restatement is
// pinned by a produced-not-literal check rather than trusted.

import { z } from 'zod'

import {
  ConfigAuthSetInputSchema,
  ConfigFieldSetInputSchema,
  ConfigHookAddInputSchema,
  ConfigProjectScaffoldInputSchema,
  ConfigTargetCreateInputSchema,
  ConfigTargetEditInputSchema,
  ConfigUndoProposeInputSchema,
} from '../config-mutation/actions'
import { ConfigProposeOutputSchema } from '../config-mutation/proposal'
import {
  KnowledgeAcceptProposeInputSchema,
  KnowledgeForgetProposeInputSchema,
  KnowledgeProposeOutcomeSchema,
  KnowledgeRejectProposeInputSchema,
} from '../knowledge/review-verbs'
import {
  AuthoringDraftEditInputSchema,
  AuthoringDraftEditOutputSchema,
  AuthoringVerifyDraftInputSchema,
  AuthoringVerifyDraftOutputSchema,
} from './authoring'

/**
 * The key whose literal names which arm a fold call is about.
 *
 * A constant rather than the string `'action'` written at each of its call sites: the key the
 * union discriminates on, the key the tool handler strips, and the key the bump guard reads back
 * are THE SAME key, and two spellings of it would fail as a call that validates and then dispatches
 * nowhere.
 */
export const TOOL_FOLD_DISCRIMINANT = 'action'

/**
 * The prose a caller reads about the discriminant, carried ON the schema.
 *
 * D-16's last clause is that human-facing descriptions live on the zod schemas so one source feeds
 * both surfaces. The discriminant is the one field of a fold that no arm DTO can describe — it does
 * not exist until the fold is composed — so if its meaning is not attached here it is attached
 * nowhere, and a caller is left inferring the vocabulary from a `const` list.
 */
const DISCRIMINANT_DESCRIPTION =
  'Which registry operation this call is for. The value is the operation id itself; the rest of '
  + 'the object is that operation\'s own input.'

/** One arm's discriminant: the op id as a literal, carrying the shared prose. */
function armLiteral<Id extends string>(opId: Id): z.ZodLiteral<Id> {
  return z.literal(opId).describe(DISCRIMINANT_DESCRIPTION)
}

/**
 * Compose the output a fold advertises from its arms' own output contracts.
 *
 * DEDUPED BY OBJECT IDENTITY, and the collapse is the point rather than an optimisation. Six of the
 * seven config actions and all three knowledge proposes answer with literally the same schema
 * object, so a `z.union` over them would advertise `anyOf: [X, X, X, …]` — a document that says
 * nothing the single member does not, while implying to a reader that the arms differ. When the
 * arms genuinely differ (the authoring fold), the union survives and is advertised.
 *
 * Identity and not deep equality: two structurally identical schemas built in two places are
 * exactly the drift D-16 exists to forbid, so collapsing them would hide it.
 */
function foldOutput(arms: readonly z.ZodType[]): z.ZodType {
  const distinct: z.ZodType[] = []
  for (const arm of arms) if (!distinct.includes(arm)) distinct.push(arm)
  const [only] = distinct
  if (only !== undefined && distinct.length === 1) return only
  return z.union(distinct as [z.ZodType, z.ZodType, ...z.ZodType[]])
}

// ---- `agent_qa_refine_test`: edit an existing test, or verify a draft ---------------------------

const refineArms = [
  AuthoringDraftEditInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('authoring.draft.edit'),
  }),
  AuthoringVerifyDraftInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('authoring.draft.verify'),
  }),
] as const

/**
 * The one fold whose arms answer DIFFERENT shapes — an edit proposal on one side, a keep-gate
 * receipt on the other — so its advertised output is a real union rather than a collapsed one.
 */
export const AuthoringRefineFoldInputSchema = z.discriminatedUnion(
  TOOL_FOLD_DISCRIMINANT,
  refineArms,
)

export type AuthoringRefineFoldInput = z.infer<typeof AuthoringRefineFoldInputSchema>

export const AuthoringRefineFoldOutputSchema = foldOutput([
  AuthoringDraftEditOutputSchema,
  AuthoringVerifyDraftOutputSchema,
])

// ---- `agent_qa_propose_config_change`: the closed seven-action class ----------------------------

const configArms = [
  ConfigFieldSetInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.field.set'),
  }),
  ConfigTargetCreateInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.target.create'),
  }),
  ConfigTargetEditInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.target.edit'),
  }),
  ConfigAuthSetInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.auth.set'),
  }),
  ConfigHookAddInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.hook.add'),
  }),
  ConfigProjectScaffoldInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.project.scaffold'),
  }),
  ConfigUndoProposeInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('config.undo.propose'),
  }),
] as const

/**
 * D-01's own named example, and the reason `.extend()` on the shipped DTOs matters rather than a
 * fresh shape per arm: 395 made every one of these `.strict()` on a stated security argument (an
 * unrecognised key from a model is either a hallucination the op would ignore or a smuggling
 * attempt), and extending preserves that — a `bogus` key is still refused at the boundary, now
 * one layer earlier, by the SDK, before the handler runs.
 */
export const ConfigChangeFoldInputSchema = z.discriminatedUnion(
  TOOL_FOLD_DISCRIMINANT,
  configArms,
)

export type ConfigChangeFoldInput = z.infer<typeof ConfigChangeFoldInputSchema>

export const ConfigChangeFoldOutputSchema = foldOutput(
  configArms.map(() => ConfigProposeOutputSchema),
)

// ---- `agent_qa_propose_knowledge_change`: accept, reject, forget --------------------------------

const knowledgeArms = [
  KnowledgeAcceptProposeInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('knowledge.accept.propose'),
  }),
  KnowledgeRejectProposeInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('knowledge.reject.propose'),
  }),
  KnowledgeForgetProposeInputSchema.extend({
    [TOOL_FOLD_DISCRIMINANT]: armLiteral('knowledge.forget.propose'),
  }),
] as const

export const KnowledgeChangeFoldInputSchema = z.discriminatedUnion(
  TOOL_FOLD_DISCRIMINANT,
  knowledgeArms,
)

export type KnowledgeChangeFoldInput = z.infer<typeof KnowledgeChangeFoldInputSchema>

export const KnowledgeChangeFoldOutputSchema = foldOutput(
  knowledgeArms.map(() => KnowledgeProposeOutcomeSchema),
)
