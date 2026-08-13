// The config envelope payload arm (Phase 395, D-01 / D-03 / D-17 · CFGM-01/03/04).
//
// THE FOURTH KIND, AND THE ENVELOPE LEARNS NOTHING. 391's envelope header promised exactly this:
// "393–396 add payload arms; nothing in the inbox, the grant machinery or the digest has to learn
// about them, because none of those read the payload." A config proposal is therefore a payload,
// and `PROPOSAL_ENVELOPE_STATUSES` is untouched — "blocked" (395-02/04's schema-fail and
// guardrail-hit dispositions) arrives as an additive member of THIS arm's own discriminant, never
// as a fifth envelope status that every existing reader would have to be re-taught.
//
// `payloadKind` IS A DISCRIMINANT AT ONE MEMBER, on the envelope's own reasoning about `kind`: a
// second arm added later gets compile-time coverage at every site that narrows, while a boolean
// would get none. Plan 395-01 ships `applyable` alone; the construct pipeline already returns a
// discriminated result, so `blocked` is a member and not a redesign.
//
// MAP, NOT TERRITORY — WITH ONE DELIBERATE EXCEPTION. Every other arm on this envelope carries refs
// and one-liners and leaves the artifact on a shelf. This one carries the new file CONTENT and the
// rendered diff BYTES, because there is no shelf: the bytes a person approved and the bytes that
// get committed must be provably the same bytes (D-19), and a record holding only a reference to
// them could not make that comparison auditable after the fact. The digests beside them are what
// makes the claim checkable rather than asserted.

import { z } from 'zod'

/** Version 1: the first shape. No config proposal exists on disk anywhere yet. */
export const CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION = 1

/**
 * What accepting this proposal would do to one file. The `patch/` vocabulary's own three words.
 *
 * Spelled here as a closed const array rather than reused from `patch.ts`'s internal one because
 * that array is private to the patch schema; the words are identical on purpose and a reader
 * comparing them is comparing one vocabulary, not two.
 */
export const CONFIG_FILE_CHANGE_KINDS = ['add', 'modify', 'delete'] as const

export type ConfigFileChangeKind = (typeof CONFIG_FILE_CHANGE_KINDS)[number]

/**
 * One file the apply would write, and the claim about what it read.
 *
 * `baseDigest` AND `path` TRAVEL TOGETHER AS ONE FACT, the arrangement `TestDraftProposalV1`'s own
 * `targetPath`/`sourceDigest` pair states at proposal-arms.ts:157-172: a digest is a claim about
 * the bytes AT a path, so a path recomputed later by a second recipe could disagree with the one
 * the digest was taken over, and the apply's re-check would then be comparing a file nobody looked
 * at.
 *
 * ABSENT `baseDigest` IS A CLAIM ABOUT ABSENCE, never a waiver. It means the proposal read no file
 * at that path, so an apply must find no file there either — a config file somebody else has since
 * created is exactly the collision the field exists to catch.
 */
export const ConfigProposalFileSchema = z.object({
  /** Workspace-relative, as the host's own identity mint spells it. */
  path: z.string().min(1),
  changeKind: z.enum(CONFIG_FILE_CHANGE_KINDS),
  /** sha256 of the file's RAW committed bytes as the proposal re-read them (D-17, CFGM-04). */
  baseDigest: z.string().min(1).optional(),
  /** The bytes the apply would write, base64 of raw. Empty string for a `delete`. */
  newContentBase64: z.string(),
}).strict()

export type ConfigProposalFile = z.infer<typeof ConfigProposalFileSchema>

/**
 * The applyable arm: a change that passed whole-config validation and is waiting on a person.
 *
 * `shownDiffBase64` AND `shownDiffDigest` ARE BOTH STORED, and the pair is D-19 rather than a
 * redundancy. The digest alone would make the equality checkable and the evidence unreadable; the
 * bytes alone would make it re-derivable and therefore not a record of what was SHOWN. 394's
 * no-silent-drop lesson stated as a field pair: an asserted register nobody can re-check is
 * arithmetic, not evidence.
 */
export const ConfigProposalApplyableV1Schema = z.object({
  schemaVersion: z.literal(CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION),
  payloadKind: z.literal('applyable'),
  /** The bare id of the op that constructed this — `config.field.set` and its later siblings. */
  action: z.string().min(1),
  /** One line a person reads in an inbox list, and the apply's commit subject. */
  summaryLine: z.string().min(1),
  files: z.array(ConfigProposalFileSchema).min(1),
  /** The rendered unified diff's exact bytes, base64 of raw (D-19). */
  shownDiffBase64: z.string().min(1),
  /** sha256 over exactly those bytes. */
  shownDiffDigest: z.string().min(1),
  /**
   * D-02's three-tier approval, as a per-PROPOSAL flag computed from actual VALUES.
   *
   * MINIMAL IN THIS PLAN AND HONEST ABOUT IT: a plain in-set field edit computes `false` with no
   * reasons, which is the true answer for that change. The full per-value classifier — secret-
   * adjacent fields, new origins, hook additions, out-of-set paths — is 395-04's, and it lands as
   * a producer behind these same two fields rather than as a new shape. A static per-op map could
   * not see a base-URL change to a new origin, which is why the flag is per proposal.
   */
  crossBoundary: z.boolean(),
  crossBoundaryReasons: z.array(z.string().min(1)),
}).strict()

export type ConfigProposalApplyableV1 = z.infer<typeof ConfigProposalApplyableV1Schema>

/**
 * The config payload arm, discriminated on {@link ConfigProposalApplyableV1Schema.shape.payloadKind}.
 *
 * One member today. See the file header for why it is a union anyway.
 */
export const ConfigProposalV1Schema = z.discriminatedUnion('payloadKind', [
  ConfigProposalApplyableV1Schema,
])

export type ConfigProposalV1 = z.infer<typeof ConfigProposalV1Schema>

/**
 * What a config apply COMMITTED, or what it found already committed.
 *
 * `already-applied` IS AN ARM, NEVER A THROW, and it carries the ORIGINAL receipt. The reasoning is
 * `knowledge.proposal.apply`'s, quoted from its own header: "a retrying surface — a dropped socket,
 * a re-issued MCP call, an operator pressing the key twice — must be able to learn that its apply
 * already happened AND what it did; a throw would say the first half while discarding the receipt,
 * which is the one thing the caller asked for." (CFGM-03's idempotency edge.)
 */
export const ConfigApplyCommitSchema = z.object({
  /** `agent` today; 395-06's dirty-tree discipline adds the human-first commit beside it. */
  role: z.enum(['agent', 'human']),
  /** The commit hash, abbreviated as git prints it. */
  hash: z.string().min(1),
}).strict()

export type ConfigApplyCommit = z.infer<typeof ConfigApplyCommitSchema>

export const ConfigApplyOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('applied'),
    commits: z.array(ConfigApplyCommitSchema).min(1),
    /** The workspace-relative paths this apply wrote, in the order the commit names them. */
    files: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({
    outcome: z.literal('already-applied'),
    commits: z.array(ConfigApplyCommitSchema).min(1),
    files: z.array(z.string().min(1)).min(1),
  }).strict(),
])

export type ConfigApplyOutcome = z.infer<typeof ConfigApplyOutcomeSchema>

/**
 * `config.field.set`'s input (D-03).
 *
 * ANY SCHEMA-ADDRESSABLE PATH, and the absence of a settable-field whitelist is the decision rather
 * than an omission — a whitelist is the door-enumeration failure this project has measured twice: a
 * rule that can only refuse what it can NAME cannot be driven to zero by naming more things. The
 * guards here are whole-input by construction instead: post-mutation validation of the ENTIRE
 * config (CFGM-01) for correctness, and D-02's per-value classifier for safety.
 */
export const ConfigFieldSetInputSchema = z.object({
  /** A dotted config path, e.g. `use.timeout` — split on `.` by the yaml Document mutation. */
  path: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
}).strict()

export type ConfigFieldSetInput = z.infer<typeof ConfigFieldSetInputSchema>

/**
 * What a propose op answers: the proposal it filed, or the reason there is nothing to decide.
 *
 * A TYPED RESULT RATHER THAN A THROW for the two ordinary outcomes. `invalid` is CFGM-01's
 * validation running BEFORE the proposal surfaces — a mutation that would break the whole config
 * never becomes something a person can accept. `no-change` is a set of a value the config already
 * holds, which is not an error and not a proposal either.
 *
 * 395-02/04 turn `invalid` into a BLOCKED proposal record rather than a bare refusal; the arm is
 * named for the fact rather than for today's disposition so that change is additive.
 */
export const ConfigProposeOutputSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('proposed'),
    proposalId: z.string().min(1),
    summaryLine: z.string().min(1),
    crossBoundary: z.boolean(),
    crossBoundaryReasons: z.array(z.string().min(1)),
    files: z.array(z.string().min(1)).min(1),
    /** The rendered diff a surface prints, as text. The record keeps the bytes. */
    shownDiff: z.string(),
  }).strict(),
  z.object({
    outcome: z.literal('invalid'),
    /** Whole-config validation issues, in the validator's own words. */
    issues: z.array(z.string().min(1)).min(1),
  }).strict(),
  z.object({ outcome: z.literal('no-change'), path: z.string().min(1) }).strict(),
])

export type ConfigProposeOutput = z.infer<typeof ConfigProposeOutputSchema>

/** `config.proposal.apply`'s input: an ID, never a document (the knowledge apply's law). */
export const ConfigProposalApplyInputSchema = z.object({
  proposalId: z.string().min(1),
}).strict()

export type ConfigProposalApplyInput = z.infer<typeof ConfigProposalApplyInputSchema>
