// The proposal construction pipeline (Phase 395, CFGM-01 / CFGM-02 / CFGM-04 · D-01 / D-03 / D-09 /
// D-10 / D-11 / D-12 / D-17).
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
//   4. SCAN the rendered artifact AND THE WHOLE CANDIDATE SET (CFGM-02, D-09/D-12 · 395-10). Every
//      byte step (5) will read is read here first; non-empty findings mint a BLOCKED record and the
//      diff bytes are discarded — they never enter the store, so no later render can leak them.
//   5. VALIDATE THE WHOLE CANDIDATE SET. CFGM-01 is explicit that validation runs BEFORE the
//      proposal exists, so a mutation that breaks the config never becomes something a person can
//      accept. It validates the ENTIRE candidate rather than the changed field, because D-03 removed
//      the settable-field whitelist deliberately — the guards here are whole-input by construction
//      or they are door enumeration — and since 395-05 the whole input is the whole FILE SET, not
//      the config yaml alone: `config.hook.add` changes only the hooks file, and a validator that
//      never saw it would have declared valid the one artifact that proposal wrote.
//   6. CLASSIFY cross-boundary-ness from the actual VALUES (D-02), through `computeCrossBoundary`.
//   7. MINT the envelope and persist it through the 391 store.
//
// FIVE OPS, ONE PIPELINE, AND THE SPLIT BETWEEN THEM IS THE POINT (395-05, D-01). Steps 3 to 7 are
// `fileConfigProposal` and every action reaches them: what a `config.target.create` and a
// `config.field.set` do differently is which bytes they hand it, never what happens to those bytes
// afterwards. A per-action pipeline would be five places for the scan to be forgotten. What the ops
// DO own is steps 1 and 2 plus their own REQUEST refusals — a create against a name that exists, an
// edit against one that does not — because those are facts about the ask rather than about the
// resulting configuration, and the two dispositions are deliberately different artifacts (see
// `CONFIG_REFUSAL_REASONS`: a blocked record is filed and findable, a refusal is answered and gone).
//
// WHY THE SCAN RUNS BEFORE VALIDATION, WHICH IS 395-04's ONE REORDERING OF 395-01's SEQUENCE. Both
// orders satisfy CFGM-01 — validation still runs before any applyable proposal exists — and this one
// closes a disclosure channel the other leaves open. A whole-config validator reports issues IN THE
// VALIDATOR'S OWN WORDS, and those words are derived from the candidate bytes; a refusal that
// quoted the offending value would put a secret into `validationIssues`, and the blocked record is
// PERSISTED, so it would outlive the proposal it refused.
//
// AND WHY ORDER ALONE WAS NOT ENOUGH (395-10 · GAP 1 / CR-01). The ordering above was correct and
// bought nothing on the schema-fail road for a year of this phase's life, because the two steps
// RANGED DIFFERENT INPUTS: step (4) read the rendered diff, step (5) is handed the whole candidate
// set. A secret in a set member the proposal never touched was therefore validated without ever
// being scanned, and the validator's words carried it to three surfaces — measured end to end on
// the shipped CLI. The fix is a containment, not a sequence, and it is what the invariant below now
// rests on:
//
//   RANGE(step 4) ⊇ RANGE(step 5). Every candidate member with bytes is scanned WHOLE before the
//   validator is handed the candidate set. See `scanParts`.
//
// That containment is what makes the one sentence true rather than aspirational: NOTHING THIS
// PIPELINE PERSISTS IS UNSCANNED. It bounds at the detectors' own coverage and nowhere else — a
// value no detector and no seed recognises can still be interpolated into a validator's message,
// exactly as it can be written into a diff, which is one uniform bound across both roads rather
// than a second hole on this one.
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
// PURE OVER PORTS. Every host fact — bytes, the yaml edit, the document's shape, the scan's seeds,
// validation, the store — arrives as a dependency, so the pipeline is drivable end to end with no
// filesystem and no git, and the composed case in `cli` drives it with the real ones.

import {
  CONFIG_SET_GITIGNORE,
  UnrenderableConfigDiffError,
  base64Encode,
  isLegalConfigReference,
  renderConfigDiff,
  utf8Decode,
  utf8Encode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigAuthSetInput,
  ConfigDiffFileInput,
  ConfigHookAddInput,
  ConfigProposalApplyableV1,
  ConfigProposalBlockedV1,
  ConfigProposalFile,
  ConfigProjectScaffoldInput,
  ConfigProposeOutput,
  ConfigProposalV1,
  ConfigReferenceKind,
  ConfigScanFinding,
  ConfigTargetCreateInput,
  ConfigTargetEditInput,
} from '@vostride/agent-qa-schema'
import type { ConstructionScanPart } from '@vostride/agent-qa-safety'

import { CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { computeCrossBoundary } from './cross-boundary.js'
import type { CrossBoundaryFieldEdit } from './cross-boundary.js'
import { HOSTNAME_GATE_REFUSAL_DETAIL, parseHostnameToken } from './hostname-gate.js'
import type {
  ConfigFieldValue,
  ConfigFileBytes,
  ConfigFileSet,
  ConfigFilesPortLike,
  ConfigScaffoldContentPortLike,
  ConfigProposalsWritePortLike,
  ConfigScanPortLike,
  ConfigStructuredValue,
  ConfigUndoSourcePortLike,
  ConfigValidatePortLike,
} from './ports.js'

/** Where the committed configuration binds a stored auth state. See {@link AUTH_STATE_CONFIG_PATH}. */
export const AUTH_STATE_CONFIG_PATH = 'use.authState'

/** The registry map every target op addresses. */
const TARGETS_PATH = 'registry.targets'

/** The auth plugin declaration list `config.auth.set` appends a package to. */
const AUTH_PLUGINS_PATH = 'plugins.auth'

/** The hooks file's top-level sequence. Read in the HOOKS file, never in the config yaml. */
const HOOKS_PATH = 'hooks'

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
 * Everything steps 3 to 7 are allowed to know about the change one op decided to make.
 *
 * FACTS, NEVER PORTS, on `CrossBoundaryFacts`' own reasoning. An op has already done its reading and
 * its mutating by the time it builds one of these; what it hands over is the candidate set and a
 * per-VALUE account of what it wrote. The pipeline cannot go back and ask for more, which is what
 * keeps "which bytes are being proposed" a question with one answer.
 */
export interface ConfigMutationPlan {
  /** The emitting op's bare id. */
  readonly action: string
  /** What the change is ABOUT, for the blocked line: a config path, a target name, a hook name. */
  readonly subject: string
  /** The one-line summary an applyable proposal carries. May print values; see below. */
  readonly summaryLine: string
  /**
   * Every SCALAR this change writes, with what it replaced (D-02).
   *
   * FLATTENED TO LEAVES, because the classifier's rules are about values: an origin comparison needs
   * a URL and not the map that contains one. `flattenScalarEdits` does the flattening, so a
   * structured write is classified on everything inside it rather than on the path of its root.
   */
  readonly fieldEdits: readonly CrossBoundaryFieldEdit[]
  /** Whether this proposal ADDS a hook. STATED by the op, never inferred from a path (D-02). */
  readonly addsHook: boolean
  /** The pinned set with this change applied — every member, changed or not. */
  readonly candidate: readonly ConfigFileBytes[]
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
 *
 * IT TAKES A SUBJECT RATHER THAN A PATH (395-05), because five ops file blocked records now and only
 * one of them addresses a config path. What every subject has in common is that it is a REFERENCE —
 * a path, a target name, a hook name — which is the same class of fact `paths` already carries.
 */
export function configBlockedSummaryLine(subject: string, detail: string): string {
  return `${subject} — blocked: ${detail}`
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
  const target = requireConfigFile(set)

  // (2) The comment-preserving edit, over exactly the bytes just read. The previous value comes back
  // from the SAME parse that wrote the new one, because (6) has to compare the two.
  const edit = await deps.configFiles.setField({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    path: input.path,
    value: input.value,
  })

  return await fileConfigProposal({
    action: input.action,
    subject: `set ${input.path}`,
    summaryLine: configFieldSetSummaryLine(input.path, input.value),
    fieldEdits: [{
      configPath: input.path,
      ...(edit.previousValue === undefined ? {} : { oldValue: edit.previousValue }),
      newValue: input.value,
    }],
    // A field set writes a config value; it does not add a hook. `config.hook.add` is its own op and
    // supplies this fact itself. Stated rather than inferred, because inferring "a hook was added"
    // from a path would be the per-op map D-02 refused.
    addsHook: false,
    candidate: candidateSet(set, [{ path: target.path, bytes: edit.bytes }]),
  }, set, deps)
}

/**
 * Construct a `config.target.create` proposal — and refuse a collision rather than merging one.
 *
 * A CREATE IS NEVER AN UPSERT, and this is CFGM-01's adjacency edge. `setIn` at an occupied path
 * REPLACES what is there, silently and comment-destructively: a person who asked to add a target
 * would get a proposal that quietly deleted the `authState` binding, the `product` name and the
 * mobile fields of the one they already had, rendered as a diff they would have to read line by line
 * to notice. The refusal names the existing target and points at the op that edits one.
 */
export async function constructConfigTargetCreateProposal(
  input: ConfigTargetCreateInput & { readonly action: string },
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  const set = await deps.configFiles.read()
  const target = requireConfigFile(set)
  const entryPath = `${TARGETS_PATH}.${input.name}`

  // D-11 FIRST, BEFORE THE DOCUMENT IS TOUCHED. `authStateName` reaches the same landing site
  // `config.auth.set` writes, so it is the same reference and gets the same admission.
  const refusal = refuseNonReferences(deps, input.action, [
    ...(input.authStateName === undefined
      ? []
      : [{ field: 'authStateName', kind: 'auth-state-name' as const, value: input.authStateName }]),
  ])
  if (refusal !== undefined) return refusal

  const facts = await deps.configFiles.inspect({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    paths: [entryPath, TARGETS_PATH],
  })
  if (factsFor(facts, entryPath).present) {
    return {
      outcome: 'refused',
      reason: 'target-exists',
      detail:
        `the target ${input.name} is already configured at ${entryPath}; a create never replaces an `
        + 'existing target, because doing so would silently discard every field it already holds. '
        + 'Use config.target.edit to change it.',
      candidates: [...(factsFor(facts, TARGETS_PATH).keys ?? [])],
    }
  }

  // THE HOUSE STYLE, AS ONE BLOCK. `demo/init/agent-qa.config.yaml` writes a web target as
  // `name: { platform, url }`, and writing it as one structured value rather than as two scalar sets
  // means one parse, one rendered block, and a diff a person reads as the addition it is.
  const entry: ConfigStructuredValue = { platform: input.platform, url: input.url }
  let bytes = (await deps.configFiles.setField({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    path: entryPath,
    value: entry,
  })).bytes

  const fieldEdits: CrossBoundaryFieldEdit[] = flattenScalarEdits(entryPath, entry, undefined)
  if (input.authStateName !== undefined) {
    const bound = await deps.configFiles.setField({
      bytes,
      path: AUTH_STATE_CONFIG_PATH,
      value: input.authStateName,
    })
    bytes = bound.bytes
    fieldEdits.push({
      configPath: AUTH_STATE_CONFIG_PATH,
      ...(bound.previousValue === undefined ? {} : { oldValue: bound.previousValue }),
      newValue: input.authStateName,
    })
  }

  return await fileConfigProposal({
    action: input.action,
    subject: `create target ${input.name}`,
    summaryLine: `create ${input.platform} target ${input.name} at ${input.url}`,
    fieldEdits,
    addsHook: false,
    candidate: candidateSet(set, [{ path: target.path, bytes }]),
  }, set, deps)
}

/**
 * Construct a `config.target.edit` proposal — and refuse an absent target by NAME.
 *
 * THE REFUSAL LISTS THE CONFIGURED NAMES (387's never-guess posture, D-15's line). An edit of a
 * target nobody configured is almost always a near-miss — `shop` for `shop-web` — and a refusal that
 * says only "no such target" makes the next call another guess. The names are already readable
 * through `config.get`, so listing them discloses nothing.
 */
export async function constructConfigTargetEditProposal(
  input: ConfigTargetEditInput & { readonly action: string },
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  const set = await deps.configFiles.read()
  const target = requireConfigFile(set)
  const entryPath = `${TARGETS_PATH}.${input.name}`

  const refusal = refuseNonReferences(deps, input.action, [
    ...(input.changes.authStateName === undefined
      ? []
      : [{
        field: 'changes.authStateName',
        kind: 'auth-state-name' as const,
        value: input.changes.authStateName,
      }]),
  ])
  if (refusal !== undefined) return refusal

  const facts = await deps.configFiles.inspect({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    paths: [entryPath, TARGETS_PATH],
  })
  if (!factsFor(facts, entryPath).present) {
    return {
      outcome: 'refused',
      reason: 'target-not-found',
      detail:
        `no target named ${input.name} is configured at ${TARGETS_PATH}; an edit changes a target `
        + 'that exists. Use config.target.create to add one.',
      candidates: [...(factsFor(facts, TARGETS_PATH).keys ?? [])],
    }
  }

  let bytes = target.bytes
  const fieldEdits: CrossBoundaryFieldEdit[] = []
  // ORDERED, AND THE ORDER IS FIXED HERE RATHER THAN BY THE INPUT'S KEY ORDER. Two calls asking for
  // the same two changes must produce the same bytes, or the diff a person approves depends on how a
  // model happened to serialise its arguments.
  for (const [path, value] of [
    [`${entryPath}.url`, input.changes.url],
    [AUTH_STATE_CONFIG_PATH, input.changes.authStateName],
  ] as const) {
    if (value === undefined) continue
    const edited = await deps.configFiles.setField({
      ...(bytes === undefined ? {} : { bytes }),
      path,
      value,
    })
    bytes = edited.bytes
    fieldEdits.push({
      configPath: path,
      ...(edited.previousValue === undefined ? {} : { oldValue: edited.previousValue }),
      newValue: value,
    })
  }

  if (bytes === undefined) throw new TypeError('the config file has no bytes to edit')

  return await fileConfigProposal({
    action: input.action,
    subject: `edit target ${input.name}`,
    summaryLine: `edit target ${input.name}: ${fieldEdits.map((edit) =>
      `${edit.configPath} to ${String(edit.newValue)}`).join(', ')}`,
    fieldEdits,
    addsHook: false,
    candidate: candidateSet(set, [{ path: target.path, bytes }]),
  }, set, deps)
}

/**
 * Construct a `config.auth.set` proposal — references only, refused on the INPUT (D-11).
 *
 * WHAT IT WRITES, AND WHERE, IS A FACT ABOUT THIS PRODUCT'S CONFIGURATION SCHEMA RATHER THAN A
 * CHOICE. The committed configuration has exactly one place that binds a stored auth state and it is
 * `use.authState` (`AuthStateUseSchema`: a name, or `{ name, load, capture }`). It has exactly one
 * place that declares an auth plugin and it is the `plugins.auth` sequence
 * (`AuthPluginDeclarationSchema`: `{ package }` or `{ path }`, `.strict()`). It has NO place at all
 * for an environment variable's name, which is why `envVarName` is refused rather than written —
 * see the `unsupported-reference` arm below.
 *
 * THE `target` IS RESOLVED, NEVER WRITTEN, and that is deliberate. A stored auth state is captured
 * FOR a target (`AuthStateMetadata` carries both `target` and `name`), so which identity a run acts
 * as is the pair (the target the run uses, the name this configuration binds). Naming the target
 * here is what lets the op refuse a binding for a target nobody configured — a typed not-found with
 * the configured names, rather than a proposal that would bind an identity to nothing.
 */
export async function constructConfigAuthSetProposal(
  input: ConfigAuthSetInput & { readonly action: string },
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  const set = await deps.configFiles.read()
  const target = requireConfigFile(set)

  // D-11 FIRST, OVER EVERY SUPPLIED REFERENCE, BEFORE THE DOCUMENT IS TOUCHED. `target` is not in
  // this list because it is never written: a credential arriving there resolves against the registry
  // and produces `target-not-found`, which discloses nothing and says something true.
  const refusal = refuseNonReferences(deps, input.action, [
    ...(input.authStateName === undefined
      ? []
      : [{ field: 'authStateName', kind: 'auth-state-name' as const, value: input.authStateName }]),
    ...(input.pluginPackage === undefined
      ? []
      : [{ field: 'pluginPackage', kind: 'plugin-package' as const, value: input.pluginPackage }]),
    ...(input.envVarName === undefined
      ? []
      : [{ field: 'envVarName', kind: 'env-var-name' as const, value: input.envVarName }]),
  ])
  if (refusal !== undefined) return refusal

  const entryPath = `${TARGETS_PATH}.${input.target}`
  const facts = await deps.configFiles.inspect({
    ...(target.bytes === undefined ? {} : { bytes: target.bytes }),
    paths: [entryPath, TARGETS_PATH, AUTH_PLUGINS_PATH],
  })
  if (!factsFor(facts, entryPath).present) {
    return {
      outcome: 'refused',
      reason: 'target-not-found',
      detail:
        `no target named ${input.target} is configured at ${TARGETS_PATH}, so there is nothing to `
        + 'bind an auth state to. Use config.target.create to add one first.',
      candidates: [...(factsFor(facts, TARGETS_PATH).keys ?? [])],
    }
  }

  // AFTER THE SECRET CHECK, DELIBERATELY. A value that is both credential-shaped and unwritable is
  // reported as a credential, because that is the fact the person needs; the same precedence the
  // pipeline takes when a guardrail hit and a schema failure both apply.
  if (input.envVarName !== undefined) {
    return {
      outcome: 'refused',
      reason: 'unsupported-reference',
      detail:
        'this configuration schema has no field that records an environment variable\'s name: an '
        + 'auth plugin declaration is a package or a path and nothing else. The variable belongs in '
        + `the environment file the configuration names at ${ENV_FILE_CONFIG_PATH}, where the `
        + 'plugin already reads it, and no config change is needed to point at it.',
    }
  }

  let bytes = target.bytes
  const fieldEdits: CrossBoundaryFieldEdit[] = []

  if (input.authStateName !== undefined) {
    const bound = await deps.configFiles.setField({
      ...(bytes === undefined ? {} : { bytes }),
      path: AUTH_STATE_CONFIG_PATH,
      value: input.authStateName,
    })
    bytes = bound.bytes
    fieldEdits.push({
      configPath: AUTH_STATE_CONFIG_PATH,
      ...(bound.previousValue === undefined ? {} : { oldValue: bound.previousValue }),
      newValue: input.authStateName,
    })
  }

  if (input.pluginPackage !== undefined) {
    // APPENDED PAST THE END, AT A LENGTH THE DOCUMENT ITSELF REPORTED. Writing at a fixed index
    // would overwrite a declaration that is already there; writing the whole sequence back would
    // discard the ones this call did not mention.
    const declaration: ConfigStructuredValue = { package: input.pluginPackage }
    const existing = factsFor(facts, AUTH_PLUGINS_PATH)
    const at = existing.length ?? 0
    const appended = await deps.configFiles.setField({
      ...(bytes === undefined ? {} : { bytes }),
      path: existing.present ? `${AUTH_PLUGINS_PATH}.${at}` : AUTH_PLUGINS_PATH,
      value: existing.present ? declaration : [declaration],
    })
    bytes = appended.bytes
    fieldEdits.push(...flattenScalarEdits(`${AUTH_PLUGINS_PATH}.${at}`, declaration, undefined))
  }

  if (bytes === undefined) throw new TypeError('the config file has no bytes to edit')

  return await fileConfigProposal({
    action: input.action,
    subject: `bind auth for target ${input.target}`,
    summaryLine: `bind auth for target ${input.target}: ${fieldEdits.map((edit) =>
      `${edit.configPath} to ${String(edit.newValue)}`).join(', ')}`,
    fieldEdits,
    addsHook: false,
    candidate: candidateSet(set, [{ path: target.path, bytes }]),
  }, set, deps)
}

/**
 * Construct a `config.hook.add` proposal — the one action that writes a file other than the config.
 *
 * A HOOK IS CODE THIS PROJECT WILL RUN, which is why `addsHook` is STATED here rather than inferred
 * from a path (D-02) and why every hook addition is cross-boundary regardless of what it contains.
 * A standing approval covering configuration edits may not silently cover "and also run this
 * script"; the flag is what the grant machinery refuses on.
 *
 * THE ID IS MINTED BY THE HOST, NEVER FORMATTED HERE. `core`'s `HookDefinitionSchema` refuses any id
 * `isCanonicalHookId` does not accept, and that mint lives in a package this layer may not import
 * and draws randomness this layer may not read. A hand-built `h_`-prefixed string would parse as a
 * string, reach a person's repository, and be refused at the next run rather than at the proposal.
 *
 * THE APPEND IS PAST THE END OF WHAT THE DOCUMENT REPORTS, and a project with no hooks file at all
 * gets one created — which is the whole-new-file case the scan already handles, arriving before
 * 395-08's scaffold needs it.
 */
export async function constructConfigHookAddProposal(
  input: ConfigHookAddInput & { readonly action: string },
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  const set = await deps.configFiles.read()
  const hooksMember = set.files.find((file) => file.path === set.hooksFile)
  if (hooksMember === undefined) {
    throw new TypeError(
      `the config file set names ${JSON.stringify(set.hooksFile)} as its hooks file, but the set `
      + 'does not contain it — a set that cannot see its own hooks file cannot declare a hook',
    )
  }

  const facts = await deps.configFiles.inspect({
    ...(hooksMember.bytes === undefined ? {} : { bytes: hooksMember.bytes }),
    paths: [HOOKS_PATH],
  })
  const existing = factsFor(facts, HOOKS_PATH)
  const at = existing.length ?? 0

  const entry: ConfigStructuredValue = {
    id: deps.configFiles.mintHookId(),
    name: input.name,
    runtime: input.runtime,
    file: input.file,
    timeout: input.timeout ?? DEFAULT_HOOK_TIMEOUT,
    ...(input.network === undefined ? {} : { network: input.network }),
  }
  const written = await deps.configFiles.setField({
    ...(hooksMember.bytes === undefined ? {} : { bytes: hooksMember.bytes }),
    path: existing.present ? `${HOOKS_PATH}.${at}` : HOOKS_PATH,
    value: existing.present ? entry : [entry],
  })

  return await fileConfigProposal({
    action: input.action,
    subject: `add hook ${input.name}`,
    summaryLine: `add ${input.runtime} hook ${input.name} running ${input.file}`,
    fieldEdits: flattenScalarEdits(`${HOOKS_PATH}.${at}`, entry, undefined),
    // STATED, NOT INFERRED (D-02). This is the op that adds hooks; nothing has to guess.
    addsHook: true,
    candidate: candidateSet(set, [{ path: hooksMember.path, bytes: written.bytes }]),
  }, set, deps)
}

/**
 * Everything `config.project.scaffold` needs beyond what every other action needs (395-08, D-04).
 *
 * A SEPARATE TYPE, on `ConstructConfigUndoDeps`' reasoning one paragraph down: the scaffold is the
 * only action that renders content it did not compute from the committed file, so widening the
 * shared bundle would make six ops bind a port none of them can reach.
 */
export interface ConstructConfigScaffoldDeps extends ConstructConfigProposalDeps {
  readonly scaffoldContent: ConfigScaffoldContentPortLike
}

/**
 * Configure a project from zero, as ONE reviewable proposal (D-04/D-13/D-15 · CFGM-05).
 *
 * THE GATE RUNS FIRST AND IT IS THE SECURITY PROPERTY (D-15). Nothing below is reached by a token
 * that is not a hostname, and the refusal names both continuations rather than a candidate. The
 * derivation the gate returns is the ONLY source of the target name and the base URL — this
 * function computes neither — so "the LLM never invents an origin" is a statement about which
 * function produced the bytes rather than about how the model was asked.
 *
 * A CONFIGURATION THIS SCAFFOLD WOULD OVERWRITE IS A REFUSAL — AND THAT IS DECLARED TARGETS, NEVER
 * A FILE'S EXISTENCE (395-12, narrowed · SC-5's entry point). The refusal protects a person's
 * configuration from being replaced wholesale, and what this op writes is the target registry. A
 * config file that declares NO targets has nothing here to overwrite, so it is MERGED: exactly
 * `registry.targets.<name>` is inserted into the person's own bytes and no other byte of that file
 * moves. The declared-target set arrives as a STRUCTURAL fact from the inspect port — names, never
 * values — for the reason this package parses no yaml at all.
 *
 * WHY THE OLD PREDICATE WAS A PINCER RATHER THAN A GUARD, recorded because the narrowing only reads
 * as safe against it. `resolveCliChatCapabilities` reads the chat model out of `registry.llms`,
 * which lives in the config file — so the only project that can reach this op through a chat turn
 * is a project that HAS a config file, which is precisely the project the file-existence predicate
 * refused. The two conditions closed on each other and CFGM-05's sentence could not complete for
 * any project at all (WINDOWS 132's two jaws, both reproduced live by 395-VERIFICATION). Under the
 * narrowing the serving class is every project that can chat: a model, no targets, one inserted
 * entry. A project with no model anywhere still cannot chat about anything, which is WINDOWS
 * 130/133's parked question about model resolution and not a config-mutation defect.
 *
 * `config.target.create` REMAINS THE OP for adding a target to a project that already declares one,
 * and the refusal still names it — now naming the targets it will not replace, so a person reads
 * WHICH configuration is standing in the way rather than merely that one is.
 *
 * IT IS ALWAYS CROSS-BOUNDARY, AND THAT IS COMPUTED RATHER THAN ASSERTED (D-14/D-02). The scaffold
 * writes a base URL where the committed configuration had none, so `computeCrossBoundary` sees an
 * edit whose old value is absent and whose new value is an origin — and it adds a hooks file and a
 * config file that did not exist. The flag is read off the classifier the same way every other
 * proposal's is; nothing here sets it by hand. 395-07's two-sided enforcement then makes a scaffold
 * unsatisfiable by any standing grant, from either side.
 *
 * `UnrenderableConfigDiffError` IS CAUGHT HERE AND NOWHERE ELSE, and the scope is the argument.
 * 395-02 minted that refusal for the case where two byte sequences decode identically and the diff
 * renders as a blank page; every other op composes bytes it authored from a file it just read, and
 * this is the one that folds a project's EXISTING `.gitignore` — arbitrary bytes, from a file this
 * product does not own — into a file it proposes. Answering it as a typed `refused` rather than
 * letting it escape as a fault is the difference between "this project's .gitignore is not text I
 * can show you a diff of" and a stack trace in a chat turn.
 */
export async function constructConfigProjectScaffoldProposal(
  input: ConfigProjectScaffoldInput & { readonly action: string },
  deps: ConstructConfigScaffoldDeps,
): Promise<ConfigProposeOutput> {
  const verdict = parseHostnameToken(input.domain)
  if (verdict.kind === 'not-a-hostname') {
    return { outcome: 'refused', reason: 'not-a-hostname', detail: HOSTNAME_GATE_REFUSAL_DETAIL }
  }

  // (1) CFGM-04: the re-read, exactly as every other action does it.
  const set = await deps.configFiles.read()
  const existingConfig = requireConfigFile(set)

  // THE PREDICATE, NARROWED (395-12). A config file with no `registry.targets` entries declares
  // nothing this op would replace, so its existence alone is not a refusal. `inspect` answers the
  // MAP's keys — names only, never values — which is the same structural read `config.target.create`
  // already takes to list the names its own refusal offers.
  const declaredTargets = existingConfig.bytes === undefined
    ? []
    : factsFor(
      await deps.configFiles.inspect({ bytes: existingConfig.bytes, paths: [TARGETS_PATH] }),
      TARGETS_PATH,
    ).keys ?? []
  if (declaredTargets.length > 0) {
    return {
      outcome: 'refused',
      reason: 'already-configured',
      detail:
        `this project already configures ${declaredTargets.join(', ')} in ${existingConfig.path}, `
        + 'and scaffolding writes a whole target registry — it would replace what is there. Use '
        + `config.target.create to add ${verdict.targetName} to the configuration you already have.`,
      candidates: [...declaredTargets],
    }
  }

  const gitignore = set.files.find((file) => file.path === CONFIG_SET_GITIGNORE)
  // THE ROUND TRIP IS CHECKED BEFORE THE DECODE IS USED. The block is composed as TEXT, so a
  // `.gitignore` carrying bytes utf-8 does not round-trip would come back with every one of them
  // replaced by U+FFFD — a proposal that silently rewrote a file it was only supposed to append to.
  // Refused rather than repaired: this product did not author those bytes.
  if (gitignore?.bytes !== undefined && !bytesEqual(utf8Encode(utf8Decode(gitignore.bytes)), gitignore.bytes)) {
    return {
      outcome: 'refused',
      reason: 'unrenderable-diff',
      detail:
        `${gitignore.path} holds bytes that are not valid UTF-8, so appending the managed block to `
        + 'it would rewrite parts of the file you did not ask to change. Nothing has been proposed.',
    }
  }

  // WHETHER THIS SCAFFOLD ADDS A HOOKS FILE IS A FACT ABOUT THE SET, not a constant. From zero it
  // always does; merging into a project that already has one, it must not — and `addsHook` is
  // STATED by the op (D-02), so it has to stop being stated when no hook is added or the classifier
  // would flag `hook-added` for a file nobody touched.
  const hooksMember = set.files.find((file) => file.path === set.hooksFile)
  const addsHook = hooksMember?.bytes === undefined

  const rendered = await deps.scaffoldContent.render({
    targetName: verdict.targetName,
    baseUrl: verdict.baseUrl,
    ...(gitignore?.bytes === undefined ? {} : { existingGitignore: gitignore.bytes }),
    // MERGE MODE, AND ONLY WHEN THERE ARE BYTES TO MERGE INTO. Absent here is the from-zero road,
    // whose rendered bytes are byte-identical to what 395-08 shipped and what the goldens pin.
    ...(existingConfig.bytes === undefined
      ? {}
      : {
        existingConfig: {
          path: existingConfig.path,
          bytes: existingConfig.bytes,
          hooksPath: set.hooksFile,
          hooksPresent: !addsHook,
        },
      }),
  })

  try {
    return await fileConfigProposal({
      action: input.action,
      subject: `scaffold ${verdict.targetName}`,
      summaryLine: `configure this project for ${verdict.baseUrl} as target ${verdict.targetName}`,
      // THE DERIVED VALUES, AS THE EDITS THEY ARE. The classifier compares each against what the
      // committed configuration held — nothing, because there is no committed configuration — which
      // is what makes `new-origin` a computed verdict here rather than a constant this op asserts.
      fieldEdits: [
        { configPath: `${TARGETS_PATH}.${verdict.targetName}.platform`, newValue: 'web' },
        { configPath: `${TARGETS_PATH}.${verdict.targetName}.url`, newValue: verdict.baseUrl },
      ],
      // The scaffolded hooks file declares one hook, which is code this project would then run.
      // Stated by the op, as D-02 requires, and true exactly when the file did not exist a moment
      // ago — see `addsHook`'s derivation above.
      addsHook,
      candidate: candidateSet(set, [...rendered]),
    }, set, deps)
  } catch (error) {
    if (!(error instanceof UnrenderableConfigDiffError)) throw error
    return {
      outcome: 'refused',
      reason: 'unrenderable-diff',
      detail:
        `the bytes proposed for ${error.paths.join(', ')} differ from what is on disk, but the diff `
        + 'of them renders as nothing — you would be asked to approve a blank page. Nothing has '
        + 'been proposed.',
    }
  }
}

/**
 * Everything `config.undo.propose` needs beyond what every other action needs (395-06, D-07).
 *
 * A SEPARATE TYPE RATHER THAN A SIXTH MEMBER OF `ConstructConfigProposalDeps`. The undo is the only
 * action that reads git history; widening the shared bundle would have made the other five ops bind
 * a port none of them can reach, and a required dep nobody supplies is a refusal by name at five
 * call sites for a capability four of them never wanted.
 */
export interface ConstructConfigUndoDeps extends ConstructConfigProposalDeps {
  readonly configUndoSource: ConfigUndoSourcePortLike
}

/**
 * Construct the reverse of the last agent configuration commit, as an ORDINARY proposal (D-07).
 *
 * UNDO IS A PROPOSAL, AND THAT IS L10 RATHER THAN A STYLE CHOICE. There is no `config.undo.apply`
 * and there must not be: a direct-revert verb would be a SECOND channel through which committed
 * configuration changes, and every argument this phase makes about review, freshness, scanning and
 * attribution would have to be made again for it, or silently not made. What this op emits is a
 * `ConfigProposal` like any other — freshness-bound, scanned, classified, filed, and applied through
 * `config.proposal.apply`. Undo-of-undo therefore needs no special case at all: this op's own apply
 * commit carries the trailer, so it becomes the next undo's source by construction.
 *
 * THE DIFF IS CURRENT → PARENT, NOT COMMIT → PARENT, and the difference is the whole of D-07's
 * concurrency claim. `fileConfigProposal` diffs the candidate against the files as they stand RIGHT
 * NOW (CFGM-04's proposal-time re-read), so a human commit that landed after the agent's SURFACES
 * inside the revert diff — the person sees their own line in the change they are being asked to
 * approve — instead of the undo colliding with it blind or quietly reverting it too.
 *
 * `addsHook` IS MEASURED, NOT ASSUMED. Reverting a `config.hook.add` removes a hook and reverting an
 * undo of one puts it back, so "an undo never adds a hook" is false in exactly the case that
 * matters. The fact is read STRUCTURALLY through the same `inspect` port `config.hook.add` uses —
 * the length of the hooks sequence on each side — because that is a shape question, which is the
 * only kind this layer may ask about a document it cannot parse.
 *
 * WHAT THE CLASSIFIER CANNOT SEE HERE, STATED RATHER THAN PAPERED OVER. `fieldEdits` is EMPTY: D-02's
 * per-value rules — secret-adjacent fields, new origins — compare the scalar an edit writes against
 * the one it replaced, and an undo writes whole FILES whose scalars this package cannot enumerate
 * (`packages/agent` may not parse yaml, and `inspect` answers shape and deliberately never content).
 * So an undo that restores an auth binding or an older base URL is not flagged for those two
 * reasons. What still holds unconditionally: the guardrail scan runs over the whole reverted
 * artifact, whole-config validation runs over the whole candidate set, `hook-added` is measured
 * above, and `out-of-set-path` is computed from the files touched. The residue is recorded as a
 * known bound and belongs to 395-07, which owns two-sided grant enforcement and is where the
 * question "may a standing grant cover this?" is actually answered.
 */
export async function constructConfigUndoProposal(
  input: { readonly action: string },
  deps: ConstructConfigUndoDeps,
): Promise<ConfigProposeOutput> {
  const source = await deps.configUndoSource.read()
  if (source.kind === 'none') {
    return {
      outcome: 'refused',
      reason: 'no-agent-commit',
      detail:
        'there is no agent-qa configuration commit in this repository to undo. Every commit this '
        + 'product makes to your configuration carries a machine-readable marker, and history '
        + 'carries none — so there is nothing to reverse.',
    }
  }

  // A FILE THE AGENT COMMIT CREATED CANNOT BE UNDONE BY THIS WRITE PATH. Refused whole rather than
  // applied by halves: a proposal that reverted three files and left a fourth behind would report
  // an undo that did not happen, and the file left behind is the one a person is least likely to
  // notice — the hooks file a `config.hook.add` created on a project that had none.
  const created = source.files.filter((file) => file.parentBytes === undefined)
  if (created.length > 0) {
    return {
      outcome: 'refused',
      reason: 'undo-needs-delete',
      detail:
        `undoing ${source.commit} would delete ${created.map((file) => file.path).join(', ')}, `
        + 'which agent-qa created in that commit. This write path proposes file CONTENT and has no '
        + 'way to propose a deletion, so the undo is refused whole rather than applied in part. '
        + 'Delete the file yourself if that is what you want.',
    }
  }

  // (1) CFGM-04: the re-read, exactly as every other action does it. The bytes below are the ones
  // the digests will be taken over and the ones the apply will re-check.
  const set = await deps.configFiles.read()

  const reverted = source.files.flatMap((file) =>
    file.parentBytes === undefined ? [] : [{ path: file.path, bytes: file.parentBytes }])
  const candidate = candidateSet(set, reverted)

  const addsHook = await revertAddsHook(deps, set, candidate)

  return await fileConfigProposal({
    action: input.action,
    subject: `undo ${source.commit}`,
    // THE SOURCE COMMIT'S SUBJECT, QUOTED. It is a line this product wrote — `config: <the
    // proposal's own one-liner>` — so quoting it here discloses nothing that is not already in the
    // person's `git log`, and it is the one fact that makes an inbox row say WHICH change is being
    // taken back.
    summaryLine: `revert agent-qa configuration commit ${source.commit} — ${source.subject}`,
    fieldEdits: [],
    addsHook,
    candidate,
  }, set, deps)
}

/**
 * Does reverting to this candidate ADD a hook? A SHAPE question, asked of the shape port (D-02).
 *
 * TWO INSPECTS OF THE HOOKS FILE, one per side, compared on sequence LENGTH. Length is the most
 * this layer can honestly read: `inspect` answers `keys` and `length` and never values, because a
 * port that answered "what is at this path" would be the unmasked config reader the ownership
 * contract forbids, reached through a mutation helper. A longer sequence on the candidate side is a
 * hook this proposal would put back, which is code the project would then run — exactly what the
 * `hook-added` flag exists to make a person re-approve.
 */
async function revertAddsHook(
  deps: ConstructConfigProposalDeps,
  set: ConfigFileSet,
  candidate: readonly ConfigFileBytes[],
): Promise<boolean> {
  const before = set.files.find((file) => file.path === set.hooksFile)
  const after = candidate.find((file) => file.path === set.hooksFile)
  if (after === undefined) return false

  const lengthOf = async (member: ConfigFileBytes | undefined): Promise<number> => {
    if (member?.bytes === undefined) return 0
    const facts = await deps.configFiles.inspect({ bytes: member.bytes, paths: [HOOKS_PATH] })
    return factsFor(facts, HOOKS_PATH).length ?? 0
  }

  return await lengthOf(after) > await lengthOf(before)
}

/**
 * What a hook's timeout is when the caller does not say.
 *
 * PINNED, WITH A RETUNE NOTE (386 D-15). `HookDefinitionSchema` makes `timeout` REQUIRED — there is
 * no schema default to inherit — so an op whose DTO marks it optional must supply one, and the
 * alternative to a pinned value is refusing every hook whose duration the caller did not think
 * about. `30s` is what `demo/init/hooks.yaml` writes. RETUNE: owned by whoever owns the hooks
 * vocabulary; a person who wants a different one writes it in the action, and a person who disagrees
 * with the default edits their hooks file, which is one reviewable diff away either way.
 */
const DEFAULT_HOOK_TIMEOUT = '30s'

/** Where the environment values a plugin reads are declared. Named by refusals, never written. */
const ENV_FILE_CONFIG_PATH = 'workspace.envFile'

/**
 * D-11's refusal, fired on the INPUT and before anything is mutated (395-05).
 *
 * THE FAILURE IS THE VALUE ARRIVING, NOT THE VALUE BEING WRITTEN. D-11 ratified `set_auth` as
 * refs-only as LAW, and a law about what the configuration may hold is enforced too late if it is
 * enforced on the rendered artifact: by then the credential has been through a yaml serialiser, a
 * diff renderer and a digest, and the honest disposition for a proposal that carries one is a
 * refusal rather than a filed record a person has to go and delete. So this runs first, and the
 * answer is `refused` — NOTHING is filed, which is the difference from `config.field.set`, where any
 * path may legitimately hold any value and a secret is a blocked RECORD.
 *
 * TWO GATES, AND THE FIRST ONE NAMES NOTHING IT REFUSES.
 *
 *   The DETECTOR half runs first: it is the shared engine `packages/safety` owns, so a value it
 *   recognises can be named ("this is an AWS key"), which is the most useful thing a person can be
 *   told. It also carries the SEEDED half — a value the masker already knows is refused with no
 *   pattern naming its family at all, which is the only one of these gates that generalises to
 *   credential families nobody has thought of.
 *
 *   The SHAPE half runs second, and it is the structural one: `isLegalConfigReference` states what a
 *   reference IS and refuses the complement. A rule that can only refuse what it can NAME cannot be
 *   driven to zero by naming more things — so the rule below names nothing it refuses.
 *
 * NEITHER DETAIL QUOTES THE VALUE. The field is named, the law is named, and where the value belongs
 * is named; the value itself appears nowhere, because a refusal that echoed it would be the same
 * disclosure one field to the left that `configBlockedSummaryLine` exists to close.
 */
function refuseNonReferences(
  deps: ConstructConfigProposalDeps,
  action: string,
  entries: readonly { field: string; kind: ConfigReferenceKind; value: string }[],
): ConfigProposeOutput | undefined {
  if (entries.length === 0) return undefined

  const report = deps.configScan.scan(entries.map((entry) => ({
    label: action,
    field: entry.field,
    text: entry.value,
  })))
  const finding = report.findings[0]
  if (finding !== undefined) {
    return {
      outcome: 'refused',
      reason: 'refs-only',
      detail:
        `the value supplied for ${finding.field ?? 'this field'} was recognised as a secret `
        + `(${finding.detector}). ${REFS_ONLY_LAW}`,
    }
  }

  for (const entry of entries) {
    if (isLegalConfigReference(entry.kind, entry.value)) continue
    return {
      outcome: 'refused',
      reason: 'refs-only',
      detail:
        `the value supplied for ${entry.field} is not shaped like a ${entry.kind}. `
        + REFS_ONLY_LAW,
    }
  }

  return undefined
}

/** One sentence, spelled once, so five refusals cannot state the law four different ways. */
const REFS_ONLY_LAW =
  'This configuration records REFERENCES only — the name of an auth state, of a plugin package, of '
  + 'an environment variable — and never a credential, which is what keeps the committed '
  + 'configuration safe to read. Put the secret in the environment file the configuration names at '
  + 'workspace.envFile (or the secrets file at workspace.secretsFile) and pass its NAME here.'

/**
 * Steps 3 to 7, for every action (395-05).
 *
 * WHAT ARRIVES IS A CANDIDATE SET, NOT A FILE. `renderConfigDiff` is handed exactly the members
 * whose bytes differ, so a proposal's `files` list is a statement about what changed rather than
 * about which files were considered — and the digests recorded per file are the ones an apply will
 * re-check.
 */
async function fileConfigProposal(
  plan: ConfigMutationPlan,
  set: ConfigFileSet,
  deps: ConstructConfigProposalDeps,
): Promise<ConfigProposeOutput> {
  const committed = new Map(set.files.map((file) => [file.path, file]))
  const diffInput: ConfigDiffFileInput[] = []
  for (const member of plan.candidate) {
    if (member.bytes === undefined) continue
    const before = committed.get(member.path)?.bytes
    if (before !== undefined && bytesEqual(before, member.bytes)) continue
    diffInput.push({
      path: member.path,
      ...(before === undefined ? {} : { oldBytes: before }),
      newBytes: member.bytes,
    })
  }
  if (diffInput.length === 0) return { outcome: 'no-change', path: plan.subject }

  // (3) THE ONE PRIMITIVE. The apply recomputes through this same export and byte-compares (D-19).
  const rendered = renderConfigDiff(diffInput)

  // 395-02: THE PRIMITIVE IS THE AUTHORITY ON WHETHER ANYTHING CHANGED, and this narrowing is where
  // that authority is taken. The byte comparison above answers the same question earlier and more
  // cheaply — which is why it stays: it lets a set of a value the config already holds skip the
  // whole rest of the pipeline — but the answer that reaches a person comes from the same function
  // the apply will call, so the two halves cannot disagree about what "no change" means.
  if (rendered.outcome === 'unchanged') return { outcome: 'no-change', path: plan.subject }

  const digestsByPath = new Map(rendered.perFileDigests.map((digest) => [digest.path, digest]))
  const wholeFiles = rendered.changes
    .filter((change) => change.changeKind === 'add')
    .map((change) => ({
      path: change.path,
      bytes: plan.candidate.find((member) => member.path === change.path)?.bytes,
    }))

  // (4) CFGM-02, BEFORE ANYTHING SURFACES AND BEFORE ANYTHING IS FILED, AND OVER EVERYTHING STEP
  // (5) WILL READ. The candidate set is handed in beside the rendered artifact — see `scanParts`.
  const scanned = deps.configScan.scan(scanParts(rendered.changes, wholeFiles, plan.candidate))
  if (scanned.findings.length > 0) {
    // D-12: was this already in the person's repository? Asked by scanning the COMMITTED bytes with
    // the same function, so "pre-existing" is a measurement rather than an inference from diff
    // syntax. The answer changes only the sentence a person reads — the block is unconditional,
    // because CFGM-02 is scored on what RENDERS and not on who authored the bytes.
    const preExisting = deps.configScan.scan(
      set.files.flatMap((file) =>
        file.bytes === undefined ? [] : [{ label: file.path, text: utf8Decode(file.bytes) }]),
    ).findings
    const preExistingPrints = new Set(preExisting.map((finding) => finding.redactedFingerprint))
    const carriedOver = scanned.findings.some(
      (finding) => preExistingPrints.has(finding.redactedFingerprint),
    )
    const paths = [...new Set(scanned.findings.map((finding) => finding.label))]

    return await fileBlocked(deps, plan, {
      blockedReason: 'guardrail-hit',
      // NAMING A FILE IS NOT QUOTING A VALUE. The blocked line's rule is "what was attempted, never
      // what was found", and D-12 asks for one more fact than that: a person whose block is caused
      // by bytes they committed months ago needs to be told so, or they will keep re-trying an edit
      // that was never the problem. A path is a reference — the same class of fact `paths` already
      // carries — and the value itself appears nowhere.
      detail: carriedOver
        ? `your configuration already carries a secret at ${paths.join(', ')}`
        : `the proposed change would write a secret into ${paths.join(', ')}`,
      paths: paths.length > 0 ? paths : diffInput.map((file) => file.path),
      scanFindings: dedupeFindings(scanned.findings.map(toSchemaFinding)),
    })
  }

  // (5) CFGM-01: the WHOLE candidate SET — and every member of it was scanned WHOLE at step (4),
  // which is the property that makes the validator's own words safe to persist. It is a statement
  // about RANGE and not about order (395-10): the same set object is handed to both steps, so the
  // validator cannot read a byte the scan did not.
  const validation = await deps.configValidate.validate({
    configFile: set.configFile,
    hooksFile: set.hooksFile,
    files: plan.candidate,
  })
  if (!validation.ok) {
    // WR-11: THE RECORD NAMES THE FILE THE ISSUE IS ABOUT, unioned with the files this proposal
    // diffed. It used to name the diffed files alone, which pointed a person at the wrong one every
    // time the refusal came from a member the proposal never touched — an already-invalid committed
    // hooks file refuses every config proposal (see the validate port's header), and the person was
    // handed the one file that was fine. Both halves are kept: the diffed paths say what was being
    // changed, the implicated ones say where to look.
    const implicated = validation.issues.map((issue) => issue.path)
    return await fileBlocked(deps, plan, {
      blockedReason: 'schema-fail',
      detail: 'the resulting configuration is not valid',
      paths: [...new Set([...implicated, ...diffInput.map((file) => file.path)])],
      // JOINED HERE AND NOWHERE ELSE. The persisted shape is `string[]` and stays that way — every
      // render of a blocked record reads it — so the split the port now carries is a fact about the
      // PIPELINE's inputs rather than a schema change rippling out to four surfaces.
      //
      // Non-empty by contract; a validator that refused without saying why would leave a person with
      // nothing to act on, so an empty list is turned into the one honest sentence available.
      validationIssues: validation.issues.length > 0
        ? validation.issues.map((issue) => `${issue.path}: ${issue.message}`)
        : ['the configuration was refused by whole-config validation, which reported no detail'],
    })
  }

  const files: ConfigProposalFile[] = rendered.changes.map((change) => {
    const digests = digestsByPath.get(change.path)
    const bytes = plan.candidate.find((member) => member.path === change.path)?.bytes
    if (digests === undefined || bytes === undefined) {
      throw new TypeError('the diff primitive rendered a file the candidate set does not contain')
    }
    return {
      path: change.path,
      changeKind: change.changeKind,
      ...(digests.oldDigest === undefined ? {} : { baseDigest: digests.oldDigest }),
      newContentBase64: base64Encode(bytes),
    }
  })

  // (6) D-02, PER VALUE. The classifier compares the value each edit wrote against the one it
  // replaced, and reads the pinned file set from the PORT'S OWN enumeration rather than a second
  // list — `set.files` is what `enumerateConfigFileSet` answered for this workspace, so the
  // out-of-set rule and the apply's scope cannot disagree about which files are config.
  const classified = computeCrossBoundary({
    fieldEdits: plan.fieldEdits,
    addsHook: plan.addsHook,
    filesTouched: files.map((file) => file.path),
    pinnedFileSet: set.files.map((file) => file.path),
  })

  const payload: ConfigProposalApplyableV1 = {
    schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
    payloadKind: 'applyable',
    action: plan.action,
    summaryLine: plan.summaryLine,
    files,
    shownDiffBase64: base64Encode(rendered.diffBytes),
    shownDiffDigest: rendered.diffDigest,
    crossBoundary: classified.crossBoundary,
    crossBoundaryReasons: [...classified.reasons],
  }

  // (7) Into the 391 store, through the same envelope every other proactive write rides.
  const { proposalId } = await deps.configProposals.put({
    kind: 'config',
    emittedBy: plan.action,
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
 * rather than diffs, and a proposal that creates the config — or the hooks file, which
 * `config.hook.add` does on a project that has none — from nothing is that case arriving early.
 *
 * AND EVERY CANDIDATE MEMBER GETS ITS WHOLE CONTENT (395-10 · GAP 1 / CR-01). This is the RANGE
 * half, and it is a different property from the two above rather than more of them. Both of those
 * widen the scan within the artifact this proposal RENDERS; this one widens it to the artifact step
 * (5) READS. The two used to differ, and the difference was a disclosure channel that was measured
 * end to end on the shipped CLI: a secret sitting in a committed set member the proposal never
 * touched — a `hooks.yaml` nobody was editing — appeared in no hunk and in no added file, so the
 * scan returned clean; the validator was then handed that member in full, could not parse it, and
 * quoted the offending source line into `validationIssues`, which is persisted and rendered. Order
 * did not help: 395-04 had already ordered the scan before the validator, correctly, and it bought
 * nothing on that road because the two steps ranged different inputs. So the rule this function now
 * implements is a containment rather than a sequence — Range(scan) ⊇ Range(validate) — and the
 * pipeline's stated invariant is true only while it holds.
 *
 * MEMBERS ARRIVE WHOLE AND UNDEDUPLICATED against the two lists above. A member that is also an
 * added file is scanned twice, which costs a pass over bytes already in memory and produces
 * duplicate findings that `dedupeFindings` collapses on their own key. The alternative — computing
 * which member each earlier part already covered — would be a second, weaker statement of the same
 * containment, and one that could go wrong quietly. This one cannot: every member with bytes is
 * here.
 */
function scanParts(
  changes: readonly { path: string; hunks: readonly { header: string; lines: readonly string[] }[] }[],
  wholeFiles: readonly { path: string; bytes?: Uint8Array }[],
  candidate: readonly ConfigFileBytes[],
): ConstructionScanPart[] {
  const parts: ConstructionScanPart[] = changes.map((change) => ({
    label: change.path,
    text: change.hunks.map((hunk) => [hunk.header, ...hunk.lines].join('\n')).join('\n'),
  }))
  for (const file of wholeFiles) {
    if (file.bytes === undefined) continue
    parts.push({ label: file.path, text: utf8Decode(file.bytes) })
  }
  for (const member of candidate) {
    if (member.bytes === undefined) continue
    parts.push({ label: member.path, text: utf8Decode(member.bytes) })
  }
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
  plan: ConfigMutationPlan,
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
    action: plan.action,
    summaryLine: configBlockedSummaryLine(plan.subject, report.detail),
    blockedReason: report.blockedReason,
    paths: [...report.paths],
    ...(report.scanFindings === undefined ? {} : { scanFindings: [...report.scanFindings] }),
    ...(report.validationIssues === undefined
      ? {}
      : { validationIssues: [...report.validationIssues] }),
  }

  const { proposalId } = await deps.configProposals.put({
    kind: 'config',
    emittedBy: plan.action,
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

/** The config yaml, or the one refusal a set that cannot see its own config file deserves. */
function requireConfigFile(set: ConfigFileSet): ConfigFileBytes {
  const target = set.files.find((file) => file.path === set.configFile)
  if (target === undefined) {
    throw new TypeError(
      `the config file set names ${JSON.stringify(set.configFile)} as its config file, but the set `
      + `does not contain it — a set that cannot see its own config file cannot be edited`,
    )
  }
  return target
}

/** The pinned set with the given members' bytes replaced — every other member carried through. */
function candidateSet(
  set: ConfigFileSet,
  writes: readonly { path: string; bytes: Uint8Array }[],
): readonly ConfigFileBytes[] {
  const written = new Map(writes.map((write) => [write.path, write.bytes]))
  const merged = set.files.map((file) => {
    const bytes = written.get(file.path)
    return bytes === undefined ? file : { path: file.path, bytes }
  })
  // A write to a path the set does not enumerate stays in the candidate rather than being dropped:
  // the classifier's `out-of-set-path` rule exists to FLAG that case, and a member silently removed
  // here would be a change nobody could flag because nobody could see it.
  for (const write of writes) {
    if (merged.some((file) => file.path === write.path)) continue
    merged.push({ path: write.path, bytes: write.bytes })
  }
  return merged
}

/**
 * Every scalar leaf a structured write puts into the document, as per-value classifier edits.
 *
 * THE CLASSIFIER'S RULES ARE ABOUT VALUES, so a structured write has to be taken apart before it can
 * be classified: an origin comparison needs the URL string, not the map that contains it, and a
 * secret-adjacency test on the map's root path answers a different question than one on each leaf.
 * Flattening here rather than in each op is what stops four ops from having four ideas about which
 * of their values are worth classifying.
 */
function flattenScalarEdits(
  basePath: string,
  value: ConfigStructuredValue,
  oldValue: ConfigFieldValue | undefined,
): CrossBoundaryFieldEdit[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [{
      configPath: basePath,
      ...(oldValue === undefined ? {} : { oldValue }),
      newValue: value,
    }]
  }
  if (Array.isArray(value)) {
    return (value as readonly ConfigStructuredValue[]).flatMap((item, index) =>
      flattenScalarEdits(`${basePath}.${index}`, item, undefined))
  }
  return Object.entries(value as { readonly [key: string]: ConfigStructuredValue })
    .flatMap(([key, item]) => flattenScalarEdits(`${basePath}.${key}`, item, undefined))
}

/** One path's facts out of the port's answer, by NAME — never by the index a caller assumed. */
function factsFor(
  facts: readonly { path: string; present: boolean; keys?: readonly string[]; length?: number }[],
  path: string,
): { present: boolean; keys?: readonly string[]; length?: number } {
  return facts.find((fact) => fact.path === path) ?? { present: false }
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
      .join(' ')
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
