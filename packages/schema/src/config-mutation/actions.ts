// The closed action class, as input DTOs (Phase 395, D-01 / D-11 / D-13 · CFGM-01, CFGM-05).
//
// ONE DTO PER OP, NAMED FOR ITS OP ID, MINTED HERE (384 D-16). The registry op that carries each of
// these lives in `packages/agent`, the MCP projection that will publish them lives in 396, and the
// parity walk that enumerates them lives in 397 — three consumers, so the shapes live in `schema`
// where none of them owns the vocabulary. A per-op sibling shape would be three spellings whose
// disagreement is only visible at runtime.
//
// EVERY SCHEMA IS `.strict()`, AND THAT IS THE SECURITY PROPERTY RATHER THAN A STYLE. These inputs
// are filled by a language model, so an unrecognised key is not a typo to forgive: it is either a
// hallucinated field the op would silently ignore, or an attempt to smuggle a value past the shape
// the guard reasons about. `.strict()` makes both a refusal at the boundary.
//
// `ConfigAuthSetInputSchema` IS THE ONE TO READ TWICE. D-11 ratified set_auth as REFS-ONLY as law:
// it writes the NAME of an auth state, the NAME of a plugin package, the NAME of an environment
// variable — never a credential. That is enforced here by the absence of any field a credential
// could be assigned to, which is a property of the shape rather than a rule somebody remembers, and
// `__tests__/proposal.test.ts` enumerates the keyset so adding one would be a visible edit. The
// behavioural half — a literal secret arriving in one of the REFERENCE fields is itself a guardrail
// hit at construction — is 395-05's, and it is defence in depth on top of this, not instead of it.

import { z } from 'zod'

/**
 * The runtimes a hook may declare.
 *
 * SPELLED HERE rather than imported because the hooks file schema lives in `@vostride/agent-qa-core`
 * and this package may not import a first-party package (its package-class boundary). The words are
 * identical to `core`'s `HookDefinitionSchema.runtime` on purpose: a reader comparing them is
 * comparing one vocabulary seen from two layers, and a proposal that offered a fifth runtime would
 * be refused by the whole-file validation this phase runs before anything surfaces (CFGM-01).
 */
export const CONFIG_HOOK_RUNTIMES = ['node', 'bun', 'python', 'bash'] as const

export type ConfigHookRuntime = (typeof CONFIG_HOOK_RUNTIMES)[number]

/**
 * `config.target.create` — add a web target to `registry.targets`.
 *
 * `platform` IS A LITERAL, NOT AN ENUM OF THREE. The mobile platforms need a device profile, an app
 * package or a bundle id and a running Appium — facts a chat utterance does not carry and this
 * phase's scaffold cannot derive. A target class this op cannot honestly build is better refused by
 * the type than half-built by the op.
 */
export const ConfigTargetCreateInputSchema = z.object({
  /** The registry key. Also what a test's `target:` names. */
  name: z.string().min(1),
  platform: z.literal('web'),
  /** The base URL, absolute. D-15's hostname gate runs before this op is reached. */
  url: z.string().min(1),
  /** A REFERENCE to a configured auth state by name (D-11). */
  authStateName: z.string().min(1).optional(),
}).strict()

export type ConfigTargetCreateInput = z.infer<typeof ConfigTargetCreateInputSchema>

/**
 * `config.target.edit` — change an existing target's URL or auth-state binding.
 *
 * THE CHANGES ARE NESTED rather than flattened beside `name`, so "which target" and "what about it"
 * cannot be confused by a model filling the shape, and so an empty `changes` object is a
 * distinguishable input rather than an edit of nothing that looks like an edit of everything.
 * `platform` is absent deliberately: changing a target's platform is creating a different target.
 */
export const ConfigTargetEditInputSchema = z.object({
  name: z.string().min(1),
  changes: z.object({
    url: z.string().min(1).optional(),
    authStateName: z.string().min(1).optional(),
  }).strict(),
}).strict()

export type ConfigTargetEditInput = z.infer<typeof ConfigTargetEditInputSchema>

/**
 * `config.auth.set` — point a target at an auth state, a plugin, or an environment variable.
 *
 * REFS ONLY, AND THERE IS NO FIELD TO PUT A SECRET IN (D-11, ratified as law). Every field below
 * names WHERE a value lives; none of them holds one. The committed configuration therefore stays
 * secret-free by construction, which is what makes masking-at-resolution sound — a masker can only
 * mask values it can see, and the reason it can see all of them is that they never enter this file.
 */
export const ConfigAuthSetInputSchema = z.object({
  /** Which target this auth applies to, by registry name. */
  target: z.string().min(1),
  /** The NAME of a stored auth state under the configured auth-state directory. */
  authStateName: z.string().min(1).optional(),
  /** The NAME of an auth plugin package to declare under `plugins.auth`. */
  pluginPackage: z.string().min(1).optional(),
  /** The NAME of an environment variable the plugin reads. Never its value. */
  envVarName: z.string().min(1).optional(),
}).strict()

export type ConfigAuthSetInput = z.infer<typeof ConfigAuthSetInputSchema>

/**
 * `config.hook.add` — declare a hook in the hooks file.
 *
 * A HOOK IS CODE THIS PROJECT WILL RUN, which is why `hook-added` is one of the four cross-boundary
 * reasons and why this input names a FILE rather than carrying a body: the script is a thing a
 * person writes and reviews in their editor, and a proposal that carried executable text would be
 * asking for approval of two artifacts in one decision.
 */
export const ConfigHookAddInputSchema = z.object({
  /** The human-facing hook name; the hook id is minted host-side. */
  name: z.string().min(1),
  runtime: z.enum(CONFIG_HOOK_RUNTIMES),
  /** Workspace-relative path to the script. */
  file: z.string().min(1),
  /** A duration string as the hooks file spells them, e.g. `30s`. Host default when absent. */
  timeout: z.string().min(1).optional(),
  network: z.boolean().optional(),
}).strict()

export type ConfigHookAddInput = z.infer<typeof ConfigHookAddInputSchema>

/**
 * `config.field.set` — set any schema-addressable path (D-03).
 *
 * ANY PATH, and the absence of a settable-field whitelist is the decision rather than an omission —
 * a whitelist is the door-enumeration failure this project has measured twice: a rule that can only
 * refuse what it can NAME cannot be driven to zero by naming more things. The guards here are
 * whole-input by construction instead: post-mutation validation of the ENTIRE config (CFGM-01) for
 * correctness, and D-02's per-value classifier for safety.
 *
 * Relocated from `proposal.ts` by 395-02 so the seven action inputs are one file a reader can read
 * as the closed class it is. The shape is byte-unchanged.
 */
export const ConfigFieldSetInputSchema = z.object({
  /** A dotted config path, e.g. `use.timeout` — split on `.` by the yaml Document mutation. */
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
}).strict()

export type ConfigFieldSetInput = z.infer<typeof ConfigFieldSetInputSchema>

/**
 * `config.project.scaffold` — configure a project from zero (D-13, CFGM-05).
 *
 * ONE FIELD, AND THE MODEL FILLS ONLY THAT ONE. D-13 is explicit: the LLM picks the DOMAIN token
 * from the utterance and deterministic host code derives everything else — the scheme, the target
 * name, the file set. Every field this shape does not have is a field a model could otherwise
 * invent, and `booking.com` versus `booking.de` is a coin flip review should not have to catch.
 */
export const ConfigProjectScaffoldInputSchema = z.object({
  /** The bare domain from the utterance, e.g. `booking.com`. D-15's hostname gate ran already. */
  domain: z.string().min(1),
}).strict()

export type ConfigProjectScaffoldInput = z.infer<typeof ConfigProjectScaffoldInputSchema>

/**
 * `config.undo.propose` — propose the reverse of the last agent config commit (D-07).
 *
 * DELIBERATELY EMPTY. The reverse diff is computed HOST-side from the repository's own history, so
 * an input field naming what to undo would be a second answer to a question git already answers —
 * and a wrong one is a revert of something nobody asked about. An empty `.strict()` object is not a
 * placeholder: it refuses the arguments a model would otherwise be tempted to supply.
 */
export const ConfigUndoProposeInputSchema = z.object({}).strict()

export type ConfigUndoProposeInput = z.infer<typeof ConfigUndoProposeInputSchema>

/** `config.proposal.apply`'s input: an ID, never a document (the knowledge apply's law). */
export const ConfigProposalApplyInputSchema = z.object({
  proposalId: z.string().min(1),
}).strict()

export type ConfigProposalApplyInput = z.infer<typeof ConfigProposalApplyInputSchema>

/**
 * One commit an apply made, and whose bytes it carries.
 *
 * `human` IS ON THE ENUM BEFORE THE CODE THAT MAKES ONE EXISTS. D-05's dirty-tree discipline —
 * commit the human's bytes first, under a preserving message, then the agent's — lands in 395-06,
 * and putting the role here now means the receipts shape does not change on that day. A role added
 * later would have been a shape change reaching every surface that renders a receipt.
 */
export const ConfigApplyCommitSchema = z.object({
  role: z.enum(['agent', 'human']),
  /** The commit hash, abbreviated as git prints it. */
  hash: z.string().min(1),
}).strict()

export type ConfigApplyCommit = z.infer<typeof ConfigApplyCommitSchema>

/**
 * The receipts an apply answers with: which commits it made, and which files they carry.
 *
 * ONE SHAPE, EXTENDED BY BOTH OUTCOME ARMS rather than restated in each. The `already-applied` arm
 * carries the ORIGINAL receipt, so the two arms must agree field for field or a retrying caller
 * would be reading a different record than the first caller did — and two spellings of one shape
 * agree only until somebody edits one of them.
 */
export const ConfigApplyReceiptsSchema = z.object({
  commits: z.array(ConfigApplyCommitSchema).min(1),
  /** The workspace-relative paths this apply wrote, in the order the commit names them. */
  files: z.array(z.string().min(1)).min(1),
}).strict()

export type ConfigApplyReceipts = z.infer<typeof ConfigApplyReceiptsSchema>

/**
 * What a config apply COMMITTED, or what it found already committed.
 *
 * `already-applied` IS AN ARM, NEVER A THROW, and it carries the ORIGINAL receipt. The reasoning is
 * `knowledge.proposal.apply`'s, quoted from its own header: "a retrying surface — a dropped socket,
 * a re-issued MCP call, an operator pressing the key twice — must be able to learn that its apply
 * already happened AND what it did; a throw would say the first half while discarding the receipt,
 * which is the one thing the caller asked for." (CFGM-03's idempotency edge.)
 */
export const ConfigApplyOutcomeSchema = z.discriminatedUnion('outcome', [
  ConfigApplyReceiptsSchema.extend({ outcome: z.literal('applied') }).strict(),
  ConfigApplyReceiptsSchema.extend({ outcome: z.literal('already-applied') }).strict(),
])

export type ConfigApplyOutcome = z.infer<typeof ConfigApplyOutcomeSchema>
