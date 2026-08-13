// The proposal construction pipeline (Phase 395, CFGM-01 / CFGM-04 · D-01 / D-03 / D-17).
//
// SIX STEPS IN ONE ORDER, AND THE ORDER IS THE CONTRACT:
//
//   1. RE-READ the committed files. CFGM-04's proposal-time law, and it is the first step rather
//      than an optimisation: every digest this proposal records is a claim about what was on disk
//      at the moment the proposal was made, so reading anything cached would make the apply's
//      re-check compare against a file nobody looked at.
//   2. MUTATE, comment-preservingly, through the host's yaml Document port. A parse→object→stringify
//      round trip destroys every comment in the house-style config and widens the rendered diff past
//      the point a person can review it, which is CFGM-01's whole subject.
//   3. VALIDATE THE WHOLE CONFIG, before anything surfaces. CFGM-01 is explicit that validation runs
//      BEFORE the proposal exists, so a mutation that breaks the config never becomes something a
//      person can accept. It validates the ENTIRE candidate rather than the changed field, because
//      D-03 removed the settable-field whitelist deliberately — the guards here are whole-input by
//      construction or they are door enumeration.
//   4. RENDER the diff and take the digests, through the ONE schema primitive (D-17). Construction
//      and apply call the same export; that is the whole of the CR-02 mitigation.
//   5. CLASSIFY cross-boundary-ness. Minimal in 395-01 and honest about it — see below.
//   6. MINT the envelope and persist it through the 391 store.
//
// NOTHING HERE COMMITS. The proposal is the artifact; the git commit happens only after a person
// accepts, through a port this module cannot reach. That is L10's one write path expressed as a
// module boundary rather than as a rule somebody has to remember.
//
// PURE OVER PORTS. Every host fact — bytes, the yaml edit, validation, the store — arrives as a
// dependency, so the pipeline is drivable end to end with no filesystem and no git, and the composed
// case in `cli` drives it with the real ones.

import { base64Encode, renderConfigDiff, utf8Decode } from '@vostride/agent-qa-schema'
import type {
  ConfigDiffFileInput,
  ConfigProposalApplyableV1,
  ConfigProposalFile,
  ConfigProposeOutput,
  ConfigProposalV1,
} from '@vostride/agent-qa-schema'

import { CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type {
  ConfigFieldValue,
  ConfigFilesPortLike,
  ConfigProposalsWritePortLike,
  ConfigValidatePortLike,
} from './ports.js'

export interface ConstructConfigFieldSetInput {
  /** The emitting op's bare id — becomes the payload's `action` and the envelope's `emittedBy`. */
  readonly action: string
  readonly path: string
  readonly value: ConfigFieldValue
}

export interface ConstructConfigProposalDeps {
  readonly configFiles: ConfigFilesPortLike
  readonly configValidate: ConfigValidatePortLike
  readonly configProposals: ConfigProposalsWritePortLike
}

/**
 * The one-line summary a person reads in an inbox and git records as the commit subject.
 *
 * REFS AND VALUES, NEVER THE DIFF. The whole envelope vocabulary is map-not-territory about summary
 * lines (391 D-18), and this one keeps to it: what changed and to what, in one clause. The bytes are
 * one `proposals.show` away.
 */
export function configFieldSetSummaryLine(path: string, value: ConfigFieldValue): string {
  return `set ${path} to ${typeof value === 'string' ? value : String(value)}`
}

/**
 * Construct, validate and file a `config.field.set` proposal.
 *
 * ANSWERS A TYPED RESULT for both ordinary non-proposal outcomes rather than throwing. `invalid` is
 * CFGM-01 running before the surface; `no-change` is a set of a value the config already holds,
 * which is neither an error nor a decision anybody should be asked to make. 395-02/04 turn `invalid`
 * into a BLOCKED proposal record; the arm is named for the FACT rather than for today's disposition,
 * so that change is additive and no caller re-learns anything.
 */
export async function constructConfigFieldSetProposal(
  input: ConstructConfigFieldSetInput,
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  // (1) CFGM-04: re-read at proposal time. Everything below is about these bytes and no others.
  const set = await deps.configFiles.read()
  const target = set.files.find((file) => file.path === set.configFile)
  if (target === undefined) {
    throw new TypeError(
      `the config file set names ${JSON.stringify(set.configFile)} as its config file, but the set `
      + `does not contain it — a set that cannot see its own config file cannot be edited`,
    )
  }

  // (2) The comment-preserving edit, over exactly the bytes just read.
  const mutated = await deps.configFiles.setField({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    path: input.path,
    value: input.value,
  })

  if (target.bytes !== undefined && bytesEqual(target.bytes, mutated)) {
    return { outcome: 'no-change', path: input.path }
  }

  // (3) CFGM-01: the WHOLE candidate config, before anything surfaces.
  const validation = await deps.configValidate.validate({
    configFile: set.configFile,
    bytes: mutated,
  })
  if (!validation.ok) {
    return {
      outcome: 'invalid',
      // Non-empty by contract; a validator that refused without saying why would leave a person with
      // nothing to act on, so an empty list is turned into the one honest sentence available.
      issues: validation.issues.length > 0
        ? [...validation.issues]
        : ['the configuration was refused by whole-config validation, which reported no detail'],
    }
  }

  // (4) THE ONE PRIMITIVE. The apply recomputes through this same export and byte-compares (D-19).
  const diffInput: ConfigDiffFileInput[] = [{
    path: target.path,
    ...(target.bytes === undefined ? {} : { oldBytes: target.bytes }),
    newBytes: mutated,
  }]
  const rendered = renderConfigDiff(diffInput)

  const digests = rendered.perFileDigests[0]
  const change = rendered.changes[0]
  if (digests === undefined || change === undefined) {
    throw new TypeError('the diff primitive rendered no file for a change that has one')
  }

  const files: ConfigProposalFile[] = [{
    path: target.path,
    changeKind: change.changeKind,
    ...(digests.oldDigest === undefined ? {} : { baseDigest: digests.oldDigest }),
    newContentBase64: base64Encode(mutated),
  }]

  // (5) D-02, MINIMAL AND HONEST. A plain in-set field edit is not cross-boundary, and `false` with
  // no reasons is the true answer for it rather than a stub. The per-VALUE classifier — secret-
  // adjacent fields, a base URL pointing at a new origin, hook additions, paths outside the set —
  // is 395-04's, and it lands as a producer behind these same two fields. A static per-op map could
  // never see a base-URL change to a new origin, which is why the flag is per proposal.
  const payload: ConfigProposalApplyableV1 = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'applyable',
    action: input.action,
    summaryLine: configFieldSetSummaryLine(input.path, input.value),
    files,
    shownDiffBase64: base64Encode(rendered.diffBytes),
    shownDiffDigest: rendered.diffDigest,
    crossBoundary: false,
    crossBoundaryReasons: [],
  }

  // (6) Into the 391 store, through the same envelope every other proactive write rides.
  const { proposalId } = await deps.configProposals.put({
    kind: 'config',
    emittedBy: input.action,
    payload,
  })

  return {
    outcome: 'proposed',
    proposalId,
    summaryLine: payload.summaryLine,
    crossBoundary: payload.crossBoundary,
    crossBoundaryReasons: [...payload.crossBoundaryReasons],
    files: files.map((file) => file.path),
    shownDiff: utf8Decode(rendered.diffBytes),
  }
}

/**
 * Narrow a stored config payload to the arm an apply can act on.
 *
 * A ONE-LINE FUNCTION THAT EARNS ITS EXISTENCE AT THE NEXT PLAN. `ConfigProposalV1` has one arm
 * today, so this assignment compiles; the moment 395-02 adds the `blocked` arm the type becomes a
 * real union and this line STOPS COMPILING — at the one place every apply path funnels through,
 * naming the two callers that must decide what a blocked payload means. The alternative, each
 * caller handing `envelope.payload` straight to its port, would have widened silently: a blocked
 * proposal would reach an apply as an object with the right field names and be committed.
 */
export function applyablePayload(payload: ConfigProposalV1): ConfigProposalApplyableV1 {
  return payload
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}
