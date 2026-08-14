// The config editor's host ports (Phase 395, D-01/D-03/D-17 · CFGM-01/03/04).
//
// FOUR CAPABILITIES THIS PACKAGE CANNOT NAME, and each is a port for a reason that is measured
// rather than stylistic:
//
//   configFiles     — reads the pinned config file SET as RAW BYTES, and performs the typed field
//                     mutation. Both are host facts. The read is `fs`, which this package may not
//                     touch at all. The MUTATION is the `yaml` Document API — comment-preserving,
//                     the shipped `agent-qa config set` idiom — and `packages/agent`'s ownership
//                     contract pins its external dependencies at exactly `['ai', 'zod']`
//                     (`ownership-contract.ts`, reconciled against package.json by `validate:arch`).
//                     Adding `yaml` to that list to bring the mutation in-layer would have widened
//                     the boundary rather than respected it, so the edit lives with the reader that
//                     already owns the file format.
//   configValidate  — whole-config validation (CFGM-01) is `core`'s `AgentQaConfigSchema` /
//                     `validateProject`, and `agent` does not depend on `core` — `validate:arch`
//                     reds that edge with no legal repair. The `draftApply` idiom exactly.
//   configApply     — git, and the person's own history. A host fact by definition.
//   configProposals — persisting the envelope is `knowledge-local`'s `writePendingProposalRecord`,
//                     one package away, exactly as `AuthoringProposalsWritePortLike` is.
//
// THE READ IS RAW BYTES ON PURPOSE (D-17). A port that answered text would put a decode between the
// file and the digest taken over it, which is 394's CR-02 defect class in its original form: two
// halves of one digest contract, each hashing a different representation, agreeing on every input
// anybody happened to try.
//
// `ConfigReaderPort` IS NOT WIDENED, and it must not be. Its contract is masked-only — "There is
// deliberately no unmasked variant on this port" (`spec.ts:636-643`) — because a capability that
// could ask for unmasked values would make masking optional. These ports read COMMITTED FILE BYTES,
// which is a different fact from a resolved configuration and carries no resolved secrets: what is
// on disk is what a person already has in their repository.

import type {
  ConstructionScanPart,
  ConstructionScanReport,
} from '@vostride/agent-qa-safety'

import type {
  ConfigApplyOutcome,
  ConfigProposalApplyableV1,
  ConfigProposalV1,
} from '@vostride/agent-qa-schema'

/** A dotted config path's new value. The three scalar shapes a config field can hold. */
export type ConfigFieldValue = string | number | boolean

/**
 * A value of any shape the configuration format can hold (395-05).
 *
 * SCALARS ARE NOT ENOUGH ONCE MORE THAN ONE OP WRITES. `config.field.set` addresses one leaf, so its
 * DTO's scalar union was the whole vocabulary. `config.target.create` writes a target ENTRY — a map
 * of `platform`, `url` and possibly an auth binding — and `config.hook.add` writes a hook ENTRY into
 * a sequence. Composing those out of several scalar writes would mean several parses of the same
 * file, each free to disagree with the last about what it was editing, for an edit a person reads as
 * one block.
 *
 * IT IS THE FORMAT'S VOCABULARY, NOT ANY OP'S. Three scalars, sequences and maps is what yaml holds;
 * nothing here names a target, a hook or a plugin. A per-op value type would be the mutation fork
 * this phase's construction pipeline exists to avoid.
 */
export type ConfigStructuredValue =
  | ConfigFieldValue
  | readonly ConfigStructuredValue[]
  | { readonly [key: string]: ConfigStructuredValue }

/**
 * What the document holds at a path, as a STRUCTURAL fact rather than as a value (395-05).
 *
 * WHY THIS EXISTS AT ALL: three of this phase's ops have to answer a question about the document
 * before they may mutate it. Does `registry.targets.shop` already exist (a create is never an
 * upsert)? Does it exist at all (an edit of an absent target is a typed not-found, and 387's
 * never-guess posture says the refusal lists the names that DO exist)? How long is the hook
 * sequence, so an append writes past its end rather than over its last member? `packages/agent`
 * cannot parse yaml — its ownership contract pins external dependencies at `['ai', 'zod']` — so the
 * document's shape is a host fact exactly as its bytes are.
 *
 * IT ANSWERS SHAPE, NEVER CONTENT, and the line is drawn there deliberately. `keys` and `length`
 * describe the container; the values inside it are not returned. A port that answered "what is at
 * this path" would be a second, unmasked config reader — the capability `ConfigReaderPort`'s header
 * says must not exist — reached through the back door of a mutation helper.
 */
export interface ConfigPathFacts {
  /** The dotted path this fact is about, echoed so a caller reading several cannot misalign them. */
  readonly path: string
  readonly present: boolean
  /** Absent when the path holds nothing. */
  readonly kind?: 'scalar' | 'map' | 'sequence'
  /** A map's keys, in document order. The names a disambiguation refusal lists. */
  readonly keys?: readonly string[]
  /** A sequence's length. What an append writes at. */
  readonly length?: number
}

/** One member of the pinned config SET, with the bytes it holds right now. */
export interface ConfigFileBytes {
  /** Workspace-relative, as the host's identity mint spells it. */
  readonly path: string
  /** Absent means the file is not there — a fact, never a zero-length stand-in for one. */
  readonly bytes?: Uint8Array
}

/**
 * The config file SET, enumerated — never matched.
 *
 * A SET AND NOT A GLOB (394-39's population lesson, RESEARCH Pitfall 5). The host derives the
 * members from the config itself — the config yaml, the hooks file it names, the managed gitignore
 * block — so "which files are config" has one answer that a porcelain check, an out-of-set
 * classifier and an apply all read. A pattern would answer differently on the first repository
 * whose layout nobody anticipated, and it would do so silently.
 */
export interface ConfigFileSet {
  /** Which member of {@link ConfigFileSet.files} is the config yaml a field edit addresses. */
  readonly configFile: string
  /**
   * Which member is the hooks file (395-05).
   *
   * NAMED RATHER THAN GUESSED. `config.hook.add` writes this member and no other, and the two ways
   * to find it without being told are both wrong: matching on `hooks.yaml` ignores the fact that
   * `workspace.hooksFile` can name anything, and "the yaml that is not the config" breaks the day
   * the set grows a third yaml. The host reads the name from the config it just parsed, which is the
   * same read `enumerateConfigFileSet` was given.
   */
  readonly hooksFile: string
  readonly files: readonly ConfigFileBytes[]
}

/**
 * What the comment-preserving edit produced, and what it replaced.
 *
 * `previousValue` RIDES THE SAME PARSE THAT WROTE THE NEW ONE (395-04, D-02). The per-value
 * cross-boundary classifier has to compare the committed value against the proposed one — a base URL
 * pointing at a NEW origin is the case a per-op map cannot see — and the only alternative to
 * returning it here was a second read of the same bytes through a second parse, free to disagree
 * with the one the mutation actually applied. One parse answers both halves of one edit.
 *
 * ABSENT MEANS "there was no scalar there": either the path held nothing, or it held a map or a
 * sequence. Both are true statements about what the edit replaced, and neither is a value an origin
 * comparison can be taken over — a wholesale subtree replacement is flagged on its own grounds
 * (secret-adjacency) rather than by pretending its old value was a string.
 */
export interface ConfigFieldSetResult {
  readonly bytes: Uint8Array
  readonly previousValue?: ConfigFieldValue
}

export interface ConfigFilesPortLike {
  /** Re-read the committed set. Called at PROPOSAL time, which is CFGM-04's own law. */
  read(): Promise<ConfigFileSet>
  /**
   * The typed field mutation, comment-preserving, over exactly the bytes it was handed.
   *
   * TAKES THE BYTES RATHER THAN RE-READING THEM. The caller has just re-read the file and is about
   * to digest what it read; a mutation that opened the file again would edit a version the digest
   * is not about, which is a freshness hole inside the freshness contract.
   *
   * 395-05 WIDENED `value` from a scalar to {@link ConfigStructuredValue}. See that type's header:
   * the widening is the yaml FORMAT's vocabulary arriving in full, not an op's shape leaking into
   * the port. `previousValue` still answers scalars only, because that is the only case an origin
   * comparison can be taken over.
   */
  setField(input: {
    readonly bytes?: Uint8Array
    readonly path: string
    readonly value: ConfigStructuredValue
  }): Promise<ConfigFieldSetResult>
  /**
   * What the document HOLDS at each path, structurally (395-05). See {@link ConfigPathFacts}.
   *
   * EVERY PATH IN ONE CALL, SO EVERY ANSWER COMES FROM ONE PARSE. An op that asked twice could be
   * told the target is absent and then, from a second parse of the same bytes, be given a key list
   * that contains it. The bytes are handed in for `setField`'s reason, one paragraph up.
   */
  inspect(input: {
    readonly bytes?: Uint8Array
    readonly paths: readonly string[]
  }): Promise<readonly ConfigPathFacts[]>
  /**
   * A fresh canonical hook id (395-05).
   *
   * A HOST FACT FOR THE REASON `mintProposalId` IS ONE. `core`'s `HookDefinitionSchema` refuses any
   * id `isCanonicalHookId` does not accept — `h_` followed by ten id-agent words — and that mint
   * lives in `@vostride/agent-qa-ids`, which is not among this package's internal dependencies. It
   * also draws randomness, and nothing in `packages/agent` reads a clock or an entropy source. A
   * hand-formatted id would be the "don't hand-roll" row of this phase's research arriving as a
   * defect: it would parse as a string, be written into a person's repository, and be refused by
   * the hooks schema at the next run rather than at the proposal.
   */
  mintHookId(): string
}

/**
 * The D-09 construction scan, bound to the host's own masking seed sources (395-04, CFGM-02).
 *
 * A CLOSURE RATHER THAN THE FUNCTION ITSELF, and the closed-over half is the whole point. The scan
 * `packages/safety` exports takes `(parts, seeds)`; the SEEDS are host facts — the resolved
 * environment slice the run masker is built from — and this package reads no environment. Binding
 * them at the composition root is what makes the values this scan knows and the values the masker
 * hides one set by construction (D-09's sibling-input law), rather than two lists that agree today.
 *
 * SYNCHRONOUS, because the scan it wraps is pure and synchronous. A promise here would invite an
 * implementation that went and fetched something, which is the property the scan's own purity
 * contract exists to keep.
 *
 * NO POLICY ARGUMENT, DELIBERATELY — see the scan's file header. An operator's egress policy answers
 * "may this text reach a model provider"; this answers "is a secret about to be written into a git
 * commit", and a shared knob would let a defensible `awsKey: 'off'` disable the second one.
 */
export interface ConfigScanPortLike {
  scan(parts: readonly ConstructionScanPart[]): ConstructionScanReport
}

/**
 * One thing whole-config validation said, and the file it said it ABOUT (395-10 · WR-11).
 *
 * THE MESSAGE IS THE VALIDATOR'S OWN WORDS; the path is not. This layer neither classifies nor
 * renders the words — a closed issue vocabulary here would be a second, weaker copy of `core`'s
 * schema refinements, out of date the first time one of them is added — but WHICH FILE an issue is
 * about is a fact the validator alone knows, and a string that had already joined the two could
 * only be split again by parsing it back apart.
 *
 * WHY IT IS SPLIT AT ALL. A blocked record's `paths` used to be the DIFFED files, so a proposal
 * that edited the config yaml and was refused because the committed hooks file does not parse named
 * the one file that was fine. A person following that reference finds nothing wrong and re-tries the
 * edit. The pipeline now unions these paths into the record's, which it can only do if the path
 * arrives as a path.
 */
export interface ConfigValidationIssue {
  /** The config-set member the issue is about — never a dotted config path. */
  readonly path: string
  /**
   * The validator's own sentence. It may contain a dotted config path; it may not contain a VALUE.
   *
   * THE SECOND HALF IS A CONTRACT AND NOT A HOPE, and 395-10 is where it was learned: the vendored
   * `yaml` package pretty-prints a parse error with a verbatim excerpt of the offending source line,
   * and an implementation that interpolated that error text published whatever that line held onto
   * three surfaces. A message derived from a library's error must be reduced to the facts this
   * product chose to publish — for a parse failure, its POSITION.
   */
  readonly message: string
}

/**
 * What whole-config validation said about the candidate config (CFGM-01).
 */
export type ConfigValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ConfigValidationIssue[] }

export interface ConfigValidatePortLike {
  /**
   * The WHOLE CANDIDATE SET as it would stand after the mutation — never the changed field alone,
   * and since 395-05 never the changed FILE alone either.
   *
   * THE SET, BECAUSE THE CONFIG IS MORE THAN ONE FILE. `config.hook.add` writes the hooks file and
   * leaves the config yaml untouched; a validator that only ever saw the config yaml would have
   * declared that proposal valid without reading the only bytes it changed. D-03's law is that the
   * guards here are WHOLE-INPUT by construction, and the whole input is the pinned file set: the
   * host validates each member it has a schema for (the config yaml against `core`'s
   * `AgentQaConfigSchema`, the hooks file against `HooksFileSchema`) and passes over the ones it
   * does not (`.gitignore` is a member of the set and has no schema).
   *
   * MEMBERS WITH NO BYTES ARE ABSENT FILES, and absent is a legal state for every member but the
   * config yaml — a project with no hooks file is an ordinary project, not an invalid one.
   */
  validate(input: {
    readonly configFile: string
    /** The hooks file member, so the validator picks a schema by NAME rather than by extension. */
    readonly hooksFile: string
    /** Every member of the pinned set, with the bytes it would hold if this proposal applied. */
    readonly files: readonly ConfigFileBytes[]
  }): Promise<ConfigValidation>
}

/**
 * The one write to a person's git history this phase makes (CFGM-03).
 *
 * IT TAKES THE PAYLOAD, not an id, on the `draftApply` reasoning (proposals-accept.ts:128-134): the
 * caller has ALREADY read the envelope — that is how it knows this is a config proposal — so handing
 * over what it is holding is one read. An id would make the host read the same record again with a
 * window in between in which the two reads can disagree about the very `baseDigest` the apply
 * re-checks.
 */
export interface ConfigApplyPortLike {
  apply(request: {
    readonly proposalId: string
    readonly payload: ConfigProposalApplyableV1
  }): Promise<ConfigApplyOutcome>
}

/**
 * Where a constructed config proposal becomes something a person can find.
 *
 * The host mints the id and stamps the instant, for the reasons `AuthoringProposalsWritePortLike`'s
 * header states at length: `mintProposalId` is the durable store's recipe for a value that becomes
 * a filename, and nothing in `packages/agent` reads a clock.
 */
export interface ConfigProposalsWritePortLike {
  put(record: {
    readonly kind: 'config'
    /** The emitting op's bare id — provenance for a person reading an inbox, never a match key. */
    readonly emittedBy: string
    /**
     * EITHER ARM (395-04). A blocked record is filed through the SAME store and the same envelope as
     * an applyable one, because "one posture, two reasons" means a person finds a refusal where they
     * find everything else — and because a refusal nobody can list is a refusal that leaves no trace
     * of the agent having tried. The store needs no new verb; the payload's own discriminant is what
     * every reader narrows on.
     */
    readonly payload: ConfigProposalV1
  }): Promise<{ readonly proposalId: string }>
}

/**
 * One config file the located agent commit touched, and the bytes an undo would restore (D-07).
 *
 * `parentBytes` IS THE ONLY CONTENT HERE, AND ITS SIBLINGS' ABSENCE IS THE DESIGN. The plan for
 * this port named three byte payloads per file — the bytes at the agent commit, the bytes at its
 * parent, and the file's current committed bytes. Two of the three are answers to questions this
 * pipeline already has answers for and would then hold twice: the CURRENT bytes are exactly what
 * `ConfigFilesPortLike.read` returns, and CFGM-04's proposal-time law says the construction re-reads
 * them for itself, so a second copy arriving on this port is a second value free to disagree with
 * the one the digests are taken over. The bytes AT the agent commit never enter the undo at all —
 * the reverse diff is CURRENT → PARENT, whatever current happens to be, which is precisely what
 * makes an intervening human commit surface inside the diff instead of colliding with it.
 *
 * ABSENT `parentBytes` MEANS THE AGENT COMMIT CREATED THIS FILE, and it is a fact rather than an
 * empty payload: reversing that commit would DELETE the file, which this write path cannot express
 * (see `CONFIG_REFUSAL_REASONS`' `undo-needs-delete`).
 */
export interface ConfigUndoSourceFile {
  /** Workspace-relative, as the host's own identity mint spells it. */
  readonly path: string
  /** The file's bytes at the located commit's PARENT — what reversing it would restore. */
  readonly parentBytes?: Uint8Array
}

/**
 * What history says about the last agent configuration commit (D-07).
 *
 * LOCATED BY THE TRAILER AND BY PATHSPEC, NEVER BY PROSE. The commit this describes is the most
 * recent one carrying `Agent-QA-Proposal` whose paths lie inside the pinned config set — the same
 * marker `findAppliedCommit` reads for CFGM-03's idempotency answer, so "which commits are ours"
 * has one definition in this product and the undo cannot drift from it.
 */
export type ConfigUndoSource =
  | {
    readonly kind: 'none'
  }
  | {
    readonly kind: 'found'
    /** The commit being reversed, abbreviated as git prints it. */
    readonly commit: string
    /** The proposal that commit applied, read out of its own trailer. */
    readonly proposalId: string
    /** That commit's subject line, so the undo can say what it is undoing. */
    readonly subject: string
    readonly files: readonly ConfigUndoSourceFile[]
  }

/**
 * The repository's own account of what this product last changed (D-07).
 *
 * A HOST PORT FOR THE REASON `configApply` IS ONE: it is git, and git is a host fact. It is a
 * separate port rather than a verb on `configApply` because the two answer opposite questions — one
 * writes a commit a person accepted, the other reads a commit somebody already made — and folding
 * a read into the one port through which committed configuration changes would make the write
 * surface larger for no reason.
 */
export interface ConfigUndoSourcePortLike {
  read(): Promise<ConfigUndoSource>
}

/**
 * The scaffold's CONTENT, rendered by the host that owns it (395-08, D-04 · CFGM-05).
 *
 * A PORT BECAUSE THE CONTENT LIVES IN `cli` AND `agent` MAY NOT IMPORT IT. D-04's whole claim is
 * that `agent-qa init` and `config.project.scaffold` write ONE substance; the substance is the
 * default config derivation, the yaml comment injection, the hooks template and the managed
 * `.gitignore` block, and all four live beside `init`'s filesystem machinery in
 * `commands/scaffold-content.ts`. Copying any of it here would mint the second scaffold D-04
 * exists to prevent, and the copy would fail silently — a person's proposal and their `init` would
 * simply produce different projects.
 *
 * IT TAKES THE DERIVATION, NOT THE DOMAIN. `targetName` and `baseUrl` are what
 * `parseHostnameToken` produced; handing the raw token over would put the derivation on both sides
 * of the boundary and let the host answer a different one than the gate pinned.
 *
 * `existingGitignore` IS BYTES, ABSENT WHEN THERE IS NO FILE. The block is an UPSERT: a project
 * with a `.gitignore` of its own gets the managed block appended to what it already has, and the
 * proposal's diff shows exactly that. Absent and empty are deliberately different — the first is
 * a file the apply CREATES, the second a file it rewrites.
 *
 * `existingConfig` IS THE SECOND MODE OF THE ONE PRODUCER (395-12, D-04 · CFGM-05), and it is a
 * MODE rather than a second port because D-04's claim is that there is one substance: a second
 * renderer would be exactly the drift D-04 exists to make impossible. Present when the project HAS
 * a configuration that declares no targets — the class SC-5 has to serve, because a project able to
 * hold a conversation at all is one whose `registry.llms` lives in a config file. In that mode the
 * producer inserts exactly `registry.targets.<targetName>` into the person's own bytes through the
 * comment-preserving Document API and emits no other change to that file. Absent means from zero,
 * and the from-zero render is byte-for-byte what it was before this field existed.
 */
export interface ConfigScaffoldContentPortLike {
  render(input: {
    readonly targetName: string
    readonly baseUrl: string
    readonly existingGitignore?: Uint8Array
    readonly existingConfig?: ConfigScaffoldMergeTarget
  }): Promise<readonly { readonly path: string; readonly bytes: Uint8Array }[]>
}

/**
 * The person's committed configuration, and where this scaffold's other members belong beside it.
 *
 * THE PATHS ARE CARRIED RATHER THAN DEFAULTED, on `ConfigFileSet.hooksFile`'s reasoning one contract
 * over. From zero the producer knows both names because it is inventing them; in a project that
 * already has a configuration it knows neither — `workspace.hooksFile` can name anything, and the
 * config member's own identity is whatever the pinned set spells. A scaffold that rendered
 * `hooks.yaml` into a project whose config names something else would be proposing a file OUTSIDE
 * the pinned set: flagged `out-of-set-path` and then refused by an apply that cannot scope to it.
 */
export interface ConfigScaffoldMergeTarget {
  /** Which member of the pinned set these bytes are — never assumed to be the default name. */
  readonly path: string
  /** The committed configuration this scaffold inserts exactly one target entry into. */
  readonly bytes: Uint8Array
  /** Where a hooks file belongs — the name the configuration itself declares. */
  readonly hooksPath: string
  /**
   * True when that file already exists, in which case the scaffold renders NO hooks at all.
   *
   * NOT AN OVERWRITE AND NOT A MERGE. The scaffold's hooks template is content for a project that
   * has none; composing it into a hooks file a person wrote would be the widest silent overwrite
   * this op could still make after the target-registry narrowing — the same overwrite
   * `already-configured` refuses for the config yaml, one file over.
   */
  readonly hooksPresent: boolean
}
