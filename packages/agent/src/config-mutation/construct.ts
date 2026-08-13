// The proposal construction pipeline (Phase 395, CFGM-01 / CFGM-02 / CFGM-04 · D-01 / D-03 / D-09 /
// D-10 / D-12 / D-17).
//
// SEVEN STEPS IN ONE ORDER, AND THE ORDER IS THE CONTRACT:
//
//   1. RE-READ the committed files. CFGM-04's proposal-time law, and it is the first step rather
//      than an optimisation: every digest this proposal records is a claim about what was on disk
//      at the moment the proposal was made, so reading anything cached would make the apply's
//      re-check compare against a file nobody looked at.
//   2. MUTATE, comment-preservingly, through the host's yaml Document port. A parse→object→stringify
//      round trip destroys every comment in the house-style config and widens the rendered diff past
//      the point a person can review it, which is CFGM-01's whole subject.
//   3. RENDER the diff and take the digests, through the ONE schema primitive (D-17). Construction
//      and apply call the same export; that is the whole of the CR-02 mitigation.
//   4. SCAN the rendered artifact (CFGM-02, D-09/D-12). Non-empty findings mint a BLOCKED record and
//      the diff bytes are discarded — they never enter the store, so no later render can leak them.
//   5. VALIDATE THE WHOLE CONFIG. CFGM-01 is explicit that validation runs BEFORE the proposal
//      exists, so a mutation that breaks the config never becomes something a person can accept. It
//      validates the ENTIRE candidate rather than the changed field, because D-03 removed the
//      settable-field whitelist deliberately — the guards here are whole-input by construction or
//      they are door enumeration.
//   6. CLASSIFY cross-boundary-ness from the actual VALUES (D-02), through `computeCrossBoundary`.
//   7. MINT the envelope and persist it through the 391 store.
//
// WHY THE SCAN RUNS BEFORE VALIDATION, WHICH IS 395-04's ONE REORDERING OF 395-01's SEQUENCE. Both
// orders satisfy CFGM-01 — validation still runs before any applyable proposal exists — and this one
// closes a disclosure channel the other leaves open. A whole-config validator reports issues IN THE
// VALIDATOR'S OWN WORDS, and those words are derived from the candidate bytes; a refusal that
// quoted the offending value would put a secret into `validationIssues`, and the blocked record is
// PERSISTED, so it would outlive the proposal it refused. Scanning first means every schema-fail
// record this pipeline files was built from bytes the scan had already cleared. The property is
// stated as one sentence: NOTHING THIS PIPELINE PERSISTS IS UNSCANNED.
//
// ONE POSTURE, TWO REASONS (CFGM-01 · D-10). A validation failure and a guardrail hit arrive by
// different roads and mean different things to a person, but they produce the same artifact — a
// record naming what was found and carrying no payload to apply. Both are filed, both are listable,
// and `blockedReason` is what tells them apart. A refusal that returned a message and filed nothing
// would leave the inbox with no trace that the agent had tried.
//
// NOTHING HERE COMMITS. The proposal is the artifact; the git commit happens only after a person
// accepts, through a port this module cannot reach. That is L10's one write path expressed as a
// module boundary rather than as a rule somebody has to remember.
//
// PURE OVER PORTS. Every host fact — bytes, the yaml edit, the scan's seeds, validation, the store —
// arrives as a dependency, so the pipeline is drivable end to end with no filesystem and no git, and
// the composed case in `cli` drives it with the real ones.

import { base64Encode, renderConfigDiff, utf8Decode } from '@vostride/agent-qa-schema'
import type {
  ConfigDiffFileInput,
  ConfigProposalApplyableV1,
  ConfigProposalBlockedV1,
  ConfigProposalFile,
  ConfigProposeOutput,
  ConfigProposalV1,
  ConfigScanFinding,
} from '@vostride/agent-qa-schema'
import type { ConstructionScanPart } from '@vostride/agent-qa-safety'

import { CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { computeCrossBoundary } from './cross-boundary.js'
import type {
  ConfigFieldValue,
  ConfigFilesPortLike,
  ConfigProposalsWritePortLike,
  ConfigScanPortLike,
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
  /**
   * REQUIRED, not optional, and the difference is CFGM-02. A composition that cannot scan cannot
   * safely construct: the alternative to refusing here is a pipeline that renders a diff to a person
   * with no guardrail in front of it whenever a host forgot one line of wiring, which is precisely
   * the silent-permissive direction a security control may not fail in.
   */
  readonly configScan: ConfigScanPortLike
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
 * The BLOCKED record's line, and the value is deliberately not in it.
 *
 * THE APPLYABLE LINE ABOVE CANNOT BE REUSED HERE, and this is the sharpest edge in the file. That
 * one prints the value — which is correct for a change that passed the scan, and a disclosure for
 * one that did not: a `guardrail-hit` is reached precisely when the artifact carries a secret, and
 * the most likely place for that secret is the value somebody just tried to set. A blocked record is
 * PERSISTED, listed and rendered, so a summary line built from the value would put the secret in the
 * inbox on the way to refusing it — the leak the block exists to prevent, one field to the left.
 */
export function configFieldSetBlockedSummaryLine(path: string, detail: string): string {
  return `set ${path} — blocked: ${detail}`
}

/**
 * Construct, validate, scan and file a `config.field.set` proposal.
 *
 * ANSWERS A TYPED RESULT for every ordinary outcome rather than throwing. `blocked` is a filed
 * proposal a person can find; `no-change` is a set of a value the config already holds, which is
 * neither an error nor a decision anybody should be asked to make.
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

  // (2) The comment-preserving edit, over exactly the bytes just read. The previous value comes back
  // from the SAME parse that wrote the new one, because (6) has to compare the two.
  const edit = await deps.configFiles.setField({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    path: input.path,
    value: input.value,
  })
  const mutated = edit.bytes

  if (target.bytes !== undefined && bytesEqual(target.bytes, mutated)) {
    return { outcome: 'no-change', path: input.path }
  }

  // (3) THE ONE PRIMITIVE. The apply recomputes through this same export and byte-compares (D-19).
  const diffInput: ConfigDiffFileInput[] = [{
    path: target.path,
    ...(target.bytes === undefined ? {} : { oldBytes: target.bytes }),
    newBytes: mutated,
  }]
  const rendered = renderConfigDiff(diffInput)

  // 395-02: THE PRIMITIVE IS THE AUTHORITY ON WHETHER ANYTHING CHANGED, and this narrowing is where
  // that authority is taken. The byte comparison above answers the same question earlier and more
  // cheaply — which is why it stays: it lets a set of a value the config already holds skip the
  // whole rest of the pipeline — but the answer that reaches a person comes from the same function
  // the apply will call, so the two halves cannot disagree about what "no change" means.
  if (rendered.outcome === 'unchanged') return { outcome: 'no-change', path: input.path }

  const digests = rendered.perFileDigests[0]
  const change = rendered.changes[0]
  if (digests === undefined || change === undefined) {
    throw new TypeError('the diff primitive rendered no file for a change that has one')
  }

  // (4) CFGM-02, BEFORE ANYTHING SURFACES AND BEFORE ANYTHING IS FILED.
  const scanned = deps.configScan.scan(scanParts(change.path, change.changeKind, rendered.changes, mutated))
  if (scanned.findings.length > 0) {
    // D-12: was this already in the person's repository? Asked by scanning the COMMITTED bytes with
    // the same function, so "pre-existing" is a measurement rather than an inference from diff
    // syntax. The answer changes only the sentence a person reads — the block is unconditional,
    // because CFGM-02 is scored on what RENDERS and not on who authored the bytes.
    const preExisting = target.bytes === undefined
      ? []
      : deps.configScan.scan([{ label: target.path, text: utf8Decode(target.bytes) }]).findings
    const preExistingPrints = new Set(preExisting.map((finding) => finding.redactedFingerprint))
    const carriedOver = scanned.findings.some(
      (finding) => preExistingPrints.has(finding.redactedFingerprint),
    )

    return await fileBlocked(deps, input, {
      blockedReason: 'guardrail-hit',
      // NAMING A FILE IS NOT QUOTING A VALUE. The blocked line's rule is "what was attempted, never
      // what was found", and D-12 asks for one more fact than that: a person whose block is caused
      // by bytes they committed months ago needs to be told so, or they will keep re-trying an edit
      // that was never the problem. A path is a reference — the same class of fact `paths` already
      // carries — and the value itself appears nowhere.
      detail: carriedOver
        ? `your configuration already carries a secret at ${target.path}`
        : `the proposed change would write a secret into ${target.path}`,
      paths: [target.path],
      scanFindings: dedupeFindings(scanned.findings.map(toSchemaFinding)),
    })
  }

  // (5) CFGM-01: the WHOLE candidate config. Its issues are the validator's own words over bytes the
  // scan above has already cleared, which is what makes them safe to persist.
  const validation = await deps.configValidate.validate({
    configFile: set.configFile,
    bytes: mutated,
  })
  if (!validation.ok) {
    return await fileBlocked(deps, input, {
      blockedReason: 'schema-fail',
      detail: 'the resulting configuration is not valid',
      paths: [target.path],
      // Non-empty by contract; a validator that refused without saying why would leave a person with
      // nothing to act on, so an empty list is turned into the one honest sentence available.
      validationIssues: validation.issues.length > 0
        ? [...validation.issues]
        : ['the configuration was refused by whole-config validation, which reported no detail'],
    })
  }

  const files: ConfigProposalFile[] = [{
    path: target.path,
    changeKind: change.changeKind,
    ...(digests.oldDigest === undefined ? {} : { baseDigest: digests.oldDigest }),
    newContentBase64: base64Encode(mutated),
  }]

  // (6) D-02, PER VALUE. The classifier compares the value this edit wrote against the one it
  // replaced, and reads the pinned file set from the PORT'S OWN enumeration rather than a second
  // list — `set.files` is what `enumerateConfigFileSet` answered for this workspace, so the
  // out-of-set rule and the apply's scope cannot disagree about which files are config.
  const classified = computeCrossBoundary({
    fieldEdits: [{
      configPath: input.path,
      ...(edit.previousValue === undefined ? {} : { oldValue: edit.previousValue }),
      newValue: input.value,
    }],
    // A field set writes a config value; it does not add a hook. `config.hook.add` is its own op and
    // supplies this fact itself. Stated rather than inferred, because inferring "a hook was added"
    // from a path would be the per-op map D-02 refused.
    addsHook: false,
    filesTouched: files.map((file) => file.path),
    pinnedFileSet: set.files.map((file) => file.path),
  })

  const payload: ConfigProposalApplyableV1 = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'applyable',
    action: input.action,
    summaryLine: configFieldSetSummaryLine(input.path, input.value),
    files,
    shownDiffBase64: base64Encode(rendered.diffBytes),
    shownDiffDigest: rendered.diffDigest,
    crossBoundary: classified.crossBoundary,
    crossBoundaryReasons: [...classified.reasons],
  }

  // (7) Into the 391 store, through the same envelope every other proactive write rides.
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
 * The artifact as it would be surfaced, cut into the sections a finding can be attributed to (D-12).
 *
 * CONTEXT LINES ARE IN, AND THAT IS THE WHOLE POINT. A hunk's lines are the rendered section
 * including its unchanged context, so a secret a human committed months ago and which sits three
 * lines above this change is INSIDE this text. A parts list built from the added lines alone would
 * pass an artifact that displays a secret — the most natural implementation there is, and the one
 * `scripts/395-scan-mutation.sh` applies to prove these cells discriminate.
 *
 * A CREATED FILE GETS ITS WHOLE CONTENT AS WELL. The scaffold case (395-08) surfaces whole new files
 * rather than diffs, and a proposal that creates the config from nothing is that case arriving early.
 */
function scanParts(
  path: string,
  changeKind: ConfigProposalFile['changeKind'],
  changes: readonly { path: string; hunks: readonly { header: string; lines: readonly string[] }[] }[],
  newBytes: Uint8Array,
): ConstructionScanPart[] {
  const parts: ConstructionScanPart[] = changes.map((change) => ({
    label: change.path,
    text: change.hunks.map((hunk) => [hunk.header, ...hunk.lines].join('\n')).join('\n'),
  }))
  if (changeKind === 'add') parts.push({ label: path, text: utf8Decode(newBytes) })
  return parts
}

/**
 * File a blocked record and answer with its reference.
 *
 * THE DIFF BYTES AND THE NEW CONTENT DO NOT TRAVEL HERE, and they structurally cannot: the blocked
 * payload schema has no field for either and is `.strict()` (395-02). This function therefore cannot
 * leak them by forgetting to leave them out, which is the property D-10 asked for rather than a rule
 * a producer has to remember.
 */
async function fileBlocked(
  deps: ConstructConfigProposalDeps,
  input: ConstructConfigFieldSetInput,
  report: {
    readonly blockedReason: ConfigProposalBlockedV1['blockedReason']
    readonly detail: string
    readonly paths: readonly string[]
    readonly scanFindings?: readonly ConfigScanFinding[]
    readonly validationIssues?: readonly string[]
  },
): Promise<ConfigProposeOutput> {
  const payload: ConfigProposalBlockedV1 = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'blocked',
    action: input.action,
    summaryLine: configFieldSetBlockedSummaryLine(input.path, report.detail),
    blockedReason: report.blockedReason,
    paths: [...report.paths],
    ...(report.scanFindings === undefined ? {} : { scanFindings: [...report.scanFindings] }),
    ...(report.validationIssues === undefined
      ? {}
      : { validationIssues: [...report.validationIssues] }),
  }

  const { proposalId } = await deps.configProposals.put({
    kind: 'config',
    emittedBy: input.action,
    payload,
  })

  return {
    outcome: 'blocked',
    proposalId,
    summaryLine: payload.summaryLine,
    blockedReason: payload.blockedReason,
    paths: [...payload.paths],
    ...(payload.scanFindings === undefined ? {} : { scanFindings: [...payload.scanFindings] }),
    ...(payload.validationIssues === undefined
      ? {}
      : { validationIssues: [...payload.validationIssues] }),
  }
}

/**
 * The safety report's vocabulary onto the schema's, which is ONE RENAME and no reshaping.
 *
 * `label` becomes `path` because the two packages name the same fact for two audiences: safety's
 * committed-egress vocabulary calls the section a label, and a person is told which FILE to go look
 * at. `redactedFingerprint` crosses unchanged — it is the field that makes a finding comparable
 * without being readable.
 */
function toSchemaFinding(finding: {
  label: string
  field?: string
  detector: string
  redactedFingerprint: string
}): ConfigScanFinding {
  return {
    path: finding.label,
    ...(finding.field === undefined ? {} : { field: finding.field }),
    detector: finding.detector,
    redactedFingerprint: finding.redactedFingerprint,
  }
}

/**
 * One finding per (file, field, detector, value), because a created file is scanned twice on purpose.
 *
 * The diff section of an `add` and the whole new file are the same bytes seen two ways — both are
 * scanned because 395-08's scaffold parts have no diff framing at all — and a record that listed the
 * same secret twice would make a person hunt for a second occurrence that does not exist.
 */
function dedupeFindings(findings: readonly ConfigScanFinding[]): ConfigScanFinding[] {
  const seen = new Set<string>()
  const kept: ConfigScanFinding[] = []
  for (const finding of findings) {
    const key = [finding.path, finding.field ?? '', finding.detector, finding.redactedFingerprint]
      .join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(finding)
  }
  return kept
}

/**
 * There is nothing here to apply, and saying so is the whole job.
 *
 * A NAMED REFUSAL RATHER THAN A CAST. This error exists because 395-01 predicted the compile break
 * below and said what routing it must produce; a `as ConfigProposalApplyableV1` at that line would
 * have satisfied the compiler and handed a blocked record — which by construction has no diff bytes
 * and no file content — to an apply port that would then read `undefined` where a person's
 * configuration should be. The reason is named because a person reading this in a terminal is being
 * told their change was refused BEFORE it was ever offered, which is not an error they caused.
 *
 * 395-04: `proposals.accept` no longer lets this reach a surface. It narrows the payload itself and
 * answers `not-applyable` as DATA beside the id and the reason, because an accept on a blocked
 * proposal is an ordinary thing for a person to try. This stays as the invariant guarding the PORT —
 * the funnel every apply path passes through, including ones no surface mediates.
 */
export class BlockedConfigProposalError extends TypeError {
  constructor(readonly proposalReason: string) {
    super(
      'this configuration proposal was blocked when it was constructed '
      + `(${proposalReason}), so there is nothing to apply: a blocked proposal records the report `
      + 'and deliberately never records the change. Read the report, fix what it names, and ask '
      + 'for the change again.',
    )
    this.name = 'BlockedConfigProposalError'
  }
}

/**
 * Narrow a stored config payload to the arm an apply can act on.
 *
 * THE FUNCTION 395-01 WROTE FOR THIS EXACT DAY, and it was paid. `ConfigProposalV1` had one arm
 * then, so the assignment compiled; the moment 395-02 added the `blocked` arm the type became a
 * real union and this line stopped compiling — at the one place every apply path funnels through,
 * naming both callers (`proposals.accept`'s config route and `config.proposal.apply`) with one
 * error. The alternative, each caller handing `envelope.payload` straight to its port, would have
 * widened silently: a blocked proposal would reach an apply as an object with the right field names
 * and be committed.
 *
 * D-10 IS WHAT MAKES THE REFUSAL SAFE TO STATE. The blocked record carries the scan report and no
 * payload, so refusing here cannot be routed around by a caller willing to reconstruct the change —
 * there is nothing stored to reconstruct it from.
 */
export function applyablePayload(payload: ConfigProposalV1): ConfigProposalApplyableV1 {
  if (payload.payloadKind === 'blocked') throw new BlockedConfigProposalError(payload.blockedReason)
  return payload
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false
  }
  return true
}
