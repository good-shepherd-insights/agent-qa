// The config envelope payload arm (Phase 395, D-01 / D-03 / D-17 · CFGM-01/03/04).
//
// THE FOURTH KIND, AND THE ENVELOPE LEARNS NOTHING. 391's envelope header promised exactly this:
// "393–396 add payload arms; nothing in the inbox, the grant machinery or the digest has to learn
// about them, because none of those read the payload." A config proposal is therefore a payload,
// and `PROPOSAL_ENVELOPE_STATUSES` is untouched — "blocked" (395-02/04's schema-fail and
// guardrail-hit dispositions) arrives as an additive member of THIS arm's own discriminant, never
// as a fifth envelope status that every existing reader would have to be re-taught.
//
// `payloadKind` IS A DISCRIMINANT, on the envelope's own reasoning about `kind`: a second arm gets
// compile-time coverage at every site that narrows, while a boolean would get none. Plan 395-01
// shipped `applyable` alone and predicted this; 395-02 added `blocked`, and the prediction was paid
// exactly as written — `applyablePayload()` in `agent/src/config-mutation/construct.ts` stopped
// compiling at the one point every apply path funnels through, and both callers were routed there.
//
// THE BLOCKED ARM IS SECRET-FREE BY CONSTRUCTION, NOT BY DISCIPLINE (D-10). It has no diff field and
// no file-content field, and it is `.strict()`, so a payload carrying `shownDiffBase64` or
// `newContentBase64` does not parse. That is deliberately a STRUCTURAL claim: the whole point of
// blocking on a guardrail hit is that the bytes must not become persistable, and a rule that
// depended on a producer remembering to leave two fields empty would be one careless mint away from
// a secret sitting in a proposals directory forever.
//
// MAP, NOT TERRITORY — WITH ONE DELIBERATE EXCEPTION. Every other arm on this envelope carries refs
// and one-liners and leaves the artifact on a shelf. This one carries the new file CONTENT and the
// rendered diff BYTES, because there is no shelf: the bytes a person approved and the bytes that
// get committed must be provably the same bytes (D-19), and a record holding only a reference to
// them could not make that comparison auditable after the fact. The digests beside them are what
// makes the claim checkable rather than asserted.

import { z } from 'zod'

import { CROSS_BOUNDARY_REASONS } from './constants'

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
  /**
   * CONSTRAINED TO THE CLOSED VOCABULARY (D-02), not to `string`.
   *
   * The grant machinery refuses on these words and every surface renders them, so a free-form
   * string would let a classifier invent a fifth class that reads fine in an inbox and matches
   * nothing on the enforcement side. A reason nobody can enumerate is a reason nobody can refuse on.
   */
  crossBoundaryReasons: z.array(z.enum(CROSS_BOUNDARY_REASONS)),
}).strict()

export type ConfigProposalApplyableV1 = z.infer<typeof ConfigProposalApplyableV1Schema>

/**
 * Why a proposal is blocked. One POSTURE, two reasons (CFGM-01 / D-10).
 *
 * TWO REASONS AND NOT TWO POSTURES: a schema failure and a guardrail hit arrive by different roads
 * and mean different things to a person, but they produce the same artifact — a record that names
 * what was found and carries no payload to apply. Splitting them into two shapes would give every
 * surface two things to render for one decision that is always "there is nothing here to accept".
 */
export const CONFIG_BLOCKED_REASONS = ['schema-fail', 'guardrail-hit'] as const

export type ConfigBlockedReason = (typeof CONFIG_BLOCKED_REASONS)[number]

/**
 * Why a propose call produced NO PROPOSAL AT ALL (Phase 395-05).
 *
 * A THIRD DISPOSITION, AND THE DISTINCTION FROM `blocked` IS DELIBERATE RATHER THAN COSMETIC. A
 * blocked record is FILED: the change was constructible, a person can find the refusal in the inbox,
 * and the reason is a fact about the RESULTING CONFIGURATION (it would not validate, or it would
 * carry a secret). A refusal here is a fact about the REQUEST — the target already exists, the target
 * does not exist, the value is not a reference — and there is no candidate configuration to file,
 * because none was ever built. Filing one would put a row in a person's inbox for a call the agent
 * should simply make again correctly.
 *
 * The four members, and what each one is a fact about:
 *
 *   target-exists         — `config.target.create` against a name the registry already holds. A
 *                           create is never an upsert; the caller wanted `config.target.edit`.
 *   target-not-found      — an edit or an auth binding naming a target that is not configured. The
 *                           refusal lists the configured names (387's never-guess posture).
 *   refs-only             — D-11: the input carried something that is not a reference. The value is
 *                           never quoted, and no file was mutated before this was decided.
 *   unsupported-reference — the reference is legal and this configuration schema has nowhere to put
 *                           it. An honest "not here" naming where the value belongs, rather than a
 *                           write whole-config validation would refuse a step later.
 *   no-agent-commit       — 395-06/D-07: `config.undo.propose` against a history that carries no
 *                           agent configuration commit. There is nothing to reverse, which is a
 *                           fact about the repository the caller asked about and not a refusal a
 *                           person needs to find in an inbox later.
 *   undo-needs-delete     — the reverse of the located commit would DELETE a config file it
 *                           created, and this write path has no delete: the proposal payload
 *                           carries file CONTENT, and an apply that wrote empty bytes where a
 *                           deletion belongs would leave a file behind while reporting the undo
 *                           done. Refused whole rather than applied by halves.
 *   not-a-hostname        — 395-08/D-15: the token `config.project.scaffold` was given does not
 *                           parse as a hostname, so there is no origin to derive and the product
 *                           will not invent one from model memory. The refusal asks for a URL or a
 *                           configured target name (387's disambiguation posture) and names
 *                           neither a guess nor a candidate.
 *   already-configured    — a scaffold against a project that already has a config file. Scaffold
 *                           creates the configuration FROM ZERO; adding a target to a project that
 *                           has one is `config.target.create`, whose own create-is-never-an-upsert
 *                           refusal is the guard for that case. Writing a whole config over an
 *                           existing one would be the widest silent overwrite in this phase.
 *   unrenderable-diff     — 395-02's `UnrenderableConfigDiffError`, answered as data rather than
 *                           thrown, because the scaffold is the one op that composes bytes it did
 *                           not author (a project's existing `.gitignore`) into a file it proposes.
 *
 * RETUNE: owned by whoever owns D-01's action class. A member is added when an op learns to refuse a
 * REQUEST for a reason a person can act on without opening an inbox.
 */
export const CONFIG_REFUSAL_REASONS = [
  'target-exists',
  'target-not-found',
  'refs-only',
  'unsupported-reference',
  'no-agent-commit',
  'undo-needs-delete',
  'not-a-hostname',
  'already-configured',
  'unrenderable-diff',
] as const

export type ConfigRefusalReason = (typeof CONFIG_REFUSAL_REASONS)[number]

/**
 * One thing the guardrail scan found, described so a person can act without the value being shown.
 *
 * `redactedFingerprint` IS THE WHOLE DESIGN OF THIS SHAPE. A finding that quoted the secret would
 * reintroduce, in the block record, exactly the leak the block exists to prevent — and the block
 * record is persisted, so it would outlive the proposal it refused. A stable non-reversing
 * fingerprint lets two findings be compared ("this is the same value as in your other file")
 * without either of them carrying it.
 */
export const ConfigScanFindingSchema = z.object({
  /** Workspace-relative path of the file the finding is in. */
  path: z.string().min(1),
  /** The config path or diff line label, when the detector can name one. */
  field: z.string().min(1).optional(),
  /** Which detector fired, in the safety package's own vocabulary (D-09). */
  detector: z.string().min(1),
  /** A short, non-reversing marker for the matched value. NEVER the value. */
  redactedFingerprint: z.string().min(1),
}).strict()

export type ConfigScanFinding = z.infer<typeof ConfigScanFindingSchema>

/**
 * The blocked arm: a change that will not be offered, and the report of why.
 *
 * NO DIFF, NO CONTENT, NO EXCEPTIONS. Read the file header — the absence of those fields IS D-10.
 * `paths` names the files implicated, which is a REFERENCE and the most a person needs to go look;
 * `scanFindings` and `validationIssues` are the report for the two reasons respectively, and both
 * are optional because a `schema-fail` has no scan findings and a `guardrail-hit` has no validation
 * issues, which is a fact about the two roads in rather than a shape that half-applies.
 *
 * There is no `crossBoundary` flag here either: that flag exists to decide whether a standing
 * approval may cover an apply, and there is no apply to cover.
 */
export const ConfigProposalBlockedV1Schema = z.object({
  schemaVersion: z.literal(CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION),
  payloadKind: z.literal('blocked'),
  /** The bare id of the op whose change was blocked. */
  action: z.string().min(1),
  /** One line a person reads in an inbox list. Says what was attempted, never what was found. */
  summaryLine: z.string().min(1),
  blockedReason: z.enum(CONFIG_BLOCKED_REASONS),
  /** The files the blocked change would have touched, by path. References, not content. */
  paths: z.array(z.string().min(1)).min(1),
  scanFindings: z.array(ConfigScanFindingSchema).optional(),
  /** Whole-config validation issues, in the validator's own words. */
  validationIssues: z.array(z.string().min(1)).optional(),
}).strict()

export type ConfigProposalBlockedV1 = z.infer<typeof ConfigProposalBlockedV1Schema>

/**
 * The config payload arm, discriminated on {@link ConfigProposalApplyableV1Schema.shape.payloadKind}.
 *
 * Two members. See the file header for what the second one cost to add, and where.
 */
export const ConfigProposalV1Schema = z.discriminatedUnion('payloadKind', [
  ConfigProposalApplyableV1Schema,
  ConfigProposalBlockedV1Schema,
])

export type ConfigProposalV1 = z.infer<typeof ConfigProposalV1Schema>

/**
 * What a propose op answers: the proposal it filed, or the reason there is nothing to decide.
 *
 * A TYPED RESULT RATHER THAN A THROW for every ordinary outcome. `no-change` is a set of a value the
 * config already holds, which is neither an error nor a decision anybody should be asked to make.
 *
 * 395-04 REPLACED 395-01's `invalid` ARM WITH `blocked`, which is the change that arm was named for.
 * A refusal that returned issues and filed nothing left the person with a message and the inbox with
 * no trace: nothing to look at later, nothing a second surface could render, and no record that the
 * agent had tried. `blocked` is a PROPOSAL — one posture, two reasons (CFGM-01/D-10) — so a
 * validation failure and a guardrail hit are both things a person can find, and the reason names
 * which road it came in by. The arm carries the proposal's ID for exactly that reason.
 *
 * IT CARRIES THE REPORT AND NEVER THE ARTIFACT, on the blocked payload's own reasoning: findings
 * name and fingerprint, validation issues are the validator's words, and no diff or file content
 * exists on this arm to leak.
 */
export const ConfigProposeOutputSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('proposed'),
    proposalId: z.string().min(1),
    summaryLine: z.string().min(1),
    crossBoundary: z.boolean(),
    /** The same closed vocabulary the payload carries — one spelling, two readers. */
    crossBoundaryReasons: z.array(z.enum(CROSS_BOUNDARY_REASONS)),
    files: z.array(z.string().min(1)).min(1),
    /** The rendered diff a surface prints, as text. The record keeps the bytes. */
    shownDiff: z.string(),
  }).strict(),
  z.object({
    outcome: z.literal('blocked'),
    /** The blocked record really was filed; this is where a person finds it. */
    proposalId: z.string().min(1),
    /** What was attempted, never what was found — the blocked payload's own line. */
    summaryLine: z.string().min(1),
    blockedReason: z.enum(CONFIG_BLOCKED_REASONS),
    paths: z.array(z.string().min(1)).min(1),
    scanFindings: z.array(ConfigScanFindingSchema).optional(),
    /** Whole-config validation issues, in the validator's own words. */
    validationIssues: z.array(z.string().min(1)).optional(),
  }).strict(),
  z.object({ outcome: z.literal('no-change'), path: z.string().min(1) }).strict(),
  z.object({
    outcome: z.literal('refused'),
    reason: z.enum(CONFIG_REFUSAL_REASONS),
    /**
     * What was refused and what to do instead, in one sentence.
     *
     * NEVER THE VALUE. A `refs-only` refusal is reached precisely when the input carried something
     * that looks like a credential, so a detail line quoting it would leak the secret on the way to
     * refusing it — the same leak `configFieldSetBlockedSummaryLine` exists to close one arm over.
     * The FIELD is named; the value is not.
     */
    detail: z.string().min(1),
    /**
     * What the caller could have meant — 387's disambiguation posture (D-15's never-guess line).
     *
     * A refusal that says "no such target" and stops makes the caller guess again; one that lists
     * the configured names lets the next call be right. These are names the config already holds,
     * so listing them discloses nothing the caller could not read with `config.get`.
     */
    candidates: z.array(z.string().min(1)).optional(),
  }).strict(),
])

export type ConfigProposeOutput = z.infer<typeof ConfigProposeOutputSchema>
