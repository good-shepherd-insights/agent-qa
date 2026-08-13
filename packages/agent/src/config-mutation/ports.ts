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
   */
  setField(input: {
    readonly bytes?: Uint8Array
    readonly path: string
    readonly value: ConfigFieldValue
  }): Promise<ConfigFieldSetResult>
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
 * What whole-config validation said about the candidate config (CFGM-01).
 *
 * ISSUES AS STRINGS in the validator's own words: this layer neither classifies nor renders them,
 * it reports them. A closed issue vocabulary here would be a second, weaker copy of `core`'s schema
 * refinements, out of date the first time one of them is added.
 */
export type ConfigValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly string[] }

export interface ConfigValidatePortLike {
  /** The WHOLE config as it would stand after the mutation — never the changed field alone. */
  validate(input: { readonly configFile: string; readonly bytes: Uint8Array }): Promise<ConfigValidation>
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
