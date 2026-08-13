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
  ConfigApplyOutcome,
  ConfigProposalApplyableV1,
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
  }): Promise<Uint8Array>
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
    readonly payload: ConfigProposalApplyableV1
  }): Promise<{ readonly proposalId: string }>
}
