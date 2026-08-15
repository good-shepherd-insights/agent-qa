// Op contract -> `registerTool` config (Phase 396 plans 01 + 04, D-16 / MCPS-02).
//
// WHY THIS FILE EXISTS. Everything a caller learns about a tool — its title, its description, the
// JSON Schema of its input, the JSON Schema of its result, and the hints a host uses to decide
// whether to confirm before calling it — is DERIVED here from what the op already declares, and is
// authored nowhere. That is D-16's "drift impossible by construction" made into a module: there is
// no second place to update when an op's contract changes, because there is no first place.
//
// ONE CONVERSION ROUTE, CHOSEN AND STATED. The op's live Standard-Schema contract is handed to
// `registerTool` untouched and the SDK converts it (zod 4.4.2 is above the 4.2 floor the
// self-conversion needs). The rejected alternative was to run the function layer's own
// `toSchemaProjection` and hand the result to `fromJsonSchema`. Both work; having both is the
// defect. The route taken is the one where the object advertised in `tools/list` and the object
// `invokeFunction` validates against are the SAME object rather than two derivations of it.
//
// ANNOTATIONS ARE DERIVED, AND THEY NEVER ENFORCE. `readOnlyHint` and friends steer a host's UX —
// whether to auto-approve, whether to warn. They are not a permission system and this file is not a
// gate: enforcement is `invokeFunction`'s scope check and the policy gate underneath it. Because
// they only steer, the honest thing is to derive them mechanically from what the op declares about
// itself rather than to hand-write a hint per tool that can quietly become a lie.
//
// DEGRADATION IS LOUD (plan 04). One conversion route means one place a construct can be
// unrepresentable, and this is it: the output-mode conversion is PROBED for every tool before the
// contract is advertised. An unrepresentable output that the mapping has not declared throws by
// name; a declared one ships with no `outputSchema` and a sentence in the description saying so.
// What never happens is a silently narrowed document — a listing that looks complete and describes
// a shape nothing produces.
//
// Protocol grounding: SEP-2106 loosened `inputSchema`/`outputSchema` to full JSON Schema 2020-12,
// which is what makes handing the SDK a real contract — refinements, unions, descriptions and all —
// viable at all; SEP-2549 makes the resulting listing cacheable, which is why nothing here varies
// per call.

import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server'
import type { FunctionScope, RiskActionDescriptor } from '@vostride/agent-qa-schema'

import { compositionOf, DEGRADED_OUTPUT_CONTRACTS } from './mapping.js'
import type { ToolOpContracts, ToolProjection } from './mapping.js'

/**
 * The draft the SDK converts every advertised schema to.
 *
 * Pinned here to the SDK's own `JSON_SCHEMA_CONVERSION_TARGET` (`src-CX2iR2pK.mjs`) because the
 * probe below must ask the SAME question `tools/list` will ask. A probe run against a different
 * target would be measuring a conversion nobody performs.
 */
const JSON_SCHEMA_CONVERSION_TARGET = 'draft-2020-12'

/**
 * Everything the derivation reads about ONE op, assembled by `catalog.ts`.
 *
 * The two halves come from two places on purpose. `summary`, `requiredScopes` and `risk` are read
 * off the registry's own declaration for this host, so they describe the composition a caller is
 * actually talking to; `input` and `output` are the live contracts named by the mapping table,
 * because the registry deliberately publishes only inert projections of those (T-384-14). Nothing
 * in this record is authored by this package — it is two views of the op, joined by its id.
 */
export interface ProjectedOpSpec {
  readonly id: string
  readonly summary: string
  readonly requiredScopes: readonly FunctionScope[]
  readonly risk: RiskActionDescriptor
  readonly input: StandardSchemaWithJSON
  readonly output: StandardSchemaWithJSON
}

/**
 * Exactly the `registerTool` config fields this projection derives.
 *
 * `outputSchema` is OPTIONAL, and its absence is a decision rather than a gap — see
 * `DEGRADED_OUTPUT_CONTRACTS` and `probeOutputSchema` below.
 */
export interface RegisterToolConfig {
  readonly title: string
  readonly description: string
  readonly inputSchema: StandardSchemaWithJSON
  readonly outputSchema?: StandardSchemaWithJSON
  readonly annotations: ToolAnnotations
}

/**
 * A tool is read-only when every arm is.
 *
 * TWO SIGNALS, EITHER SUFFICIENT, and both are the op's own words: the risk descriptor's explicit
 * `readOnly`, and the structural fact that the op asks for no scope beyond `read`. They are kept
 * together rather than one being picked because they fail in different directions — an op can
 * declare `readOnly` and be wrong, and an op can be a genuine read while its author never filled in
 * the descriptor. Requiring BOTH would hide honest reads; accepting EITHER over the whole arm set
 * still needs every arm to qualify, so a fold containing one write is not read-only.
 */
function isReadOnly(specs: readonly ProjectedOpSpec[]): boolean {
  return specs.every(
    (spec) =>
      spec.risk.readOnly === true ||
      spec.requiredScopes.every((scope) => scope === 'read'),
  )
}

/**
 * Derive the honest annotation set.
 *
 * `destructiveHint` is true when ANY arm declares itself destructive — the union direction, because
 * a fold is as dangerous as its most dangerous arm and a host deciding whether to confirm is asking
 * about the call it is about to make, not about the average of the ones it could have made.
 *
 * `idempotentHint` follows `readOnlyHint` and nothing else. A read is idempotent; for anything that
 * writes, this product has no per-op declaration of idempotence to read, and asserting one from
 * nowhere is exactly the lie the honest-annotations rule forbids. When such a declaration exists,
 * this is the one line that changes.
 */
function deriveAnnotations(specs: readonly ProjectedOpSpec[]): ToolAnnotations {
  const readOnlyHint = isReadOnly(specs)
  return {
    readOnlyHint,
    destructiveHint: specs.some((spec) => spec.risk.destructive === true),
    idempotentHint: readOnlyHint,
  }
}

/**
 * Compose a human-facing description from the arms' own summaries.
 *
 * A 1:1 projection reads as its op's summary verbatim — there is nothing to add, and adding
 * something would be authoring a second description of one capability.
 *
 * A UNION FOLD lists its arms, each labelled with the op id it stands for, and says which key
 * selects between them — because a caller told only "manage configuration" cannot work out which
 * arm a given input selects, and the discriminant IS the op id.
 *
 * THE PIPELINE names its steps in order. Its second op contributes no shape to the advertisement
 * (see `AGENT_QA_COMPOSED_CONTRACTS`), so a caller reading only the schemas would never learn that
 * a second capability runs, and "what did this call actually do" is not a question a projection may
 * leave unanswerable.
 */
function describe(projection: ToolProjection, specs: readonly ProjectedOpSpec[]): string {
  const composition = compositionOf(projection)
  if (composition === 'single') return specs[0]!.summary
  const arms = specs.map((spec) => `${spec.id}: ${spec.summary}`).join('\n')
  if (composition === 'pipeline') {
    return `${arms}\nThese run in the order listed; the second runs only when the first resolves.`
  }
  return `${arms}\nSelect one with "${projection.discriminant!}", whose value is the op id above.`
}

/**
 * The sentence appended when a tool ships without an `outputSchema`.
 *
 * A caller reads descriptions; a caller does not read this repository. An omission nobody is TOLD
 * about is exactly the silent narrowing D-16 forbids, so the omission travels in the one channel
 * that reaches the other end.
 */
function degradationSentence(degradation: { readonly schema: string }): string {
  return (
    `\nThis tool advertises no outputSchema: its result contract (${degradation.schema}) contains a `
    + 'construct JSON Schema cannot represent, and a narrowed stand-in would describe a shape '
    + 'nothing produces. The result still arrives as structuredContent.'
  )
}

/**
 * Ask the SDK's own converter whether this output contract can be advertised at all.
 *
 * PROBED, NEVER ASSUMED, and probed in OUTPUT mode because that is the mode `tools/list` uses for
 * `outputSchema` — a probe in input mode would answer a question nobody asks and pass for every
 * contract this check exists to catch. The conversion is pure and deterministic, so running it once
 * here and once again inside the SDK costs a listing nothing and buys the failure a name.
 *
 * The three answers, and each one is a decision:
 *  - converts, undeclared  -> advertise it.
 *  - throws, DECLARED      -> advertise nothing, say so in the description.
 *  - throws, undeclared    -> refuse to build the tool, naming the tool, the schema and the
 *                             converter's own message. Left to the SDK this would surface as an
 *                             exception inside `tools/list`, taking the whole listing down for
 *                             every caller with no indication of which tool caused it.
 *  - converts, DECLARED    -> also refuse. A degradation entry that no longer describes reality is
 *                             a tool silently withholding a schema it could publish, and a list
 *                             that can only grow is a list that rots.
 */
function probeOutputSchema(
  projection: ToolProjection,
  output: StandardSchemaWithJSON,
): StandardSchemaWithJSON | undefined {
  const declared = DEGRADED_OUTPUT_CONTRACTS.find((entry) => entry.tool === projection.name)

  let failure: string | undefined
  try {
    output['~standard'].jsonSchema.output({ target: JSON_SCHEMA_CONVERSION_TARGET })
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
  }

  if (failure === undefined) {
    if (declared === undefined) return output
    throw new McpProjectionError(
      projection.name,
      `is listed in DEGRADED_OUTPUT_CONTRACTS for ${declared.schema}, but that contract now `
        + 'converts cleanly in output mode; remove the entry so the schema is advertised again',
    )
  }

  if (declared === undefined) {
    throw new McpProjectionError(
      projection.name,
      `advertises an output contract JSON Schema cannot represent (${failure}). Declare it in `
        + 'DEGRADED_OUTPUT_CONTRACTS with the measured message, or give the op a contract that '
        + 'converts — an unrepresentable outputSchema throws inside tools/list and takes the whole '
        + 'listing down for every caller',
    )
  }

  return undefined
}

/**
 * Derive one tool's `registerTool` config.
 *
 * `advertised` is passed IN rather than looked up here so this module stays a derivation over
 * values: `catalog.ts` owns the join between the mapping's data and this host's registry, and a
 * second lookup inside the derivation would be a second chance for the two to disagree.
 *
 * `maskText` is a REQUIRED parameter and covers the DERIVED prose. The reason is the fresh wound
 * this phase inherits: 395 closed a high-severity defect where a credential reached an MCP caller
 * through a serialization nobody had thought of as an output channel. A description is composed
 * from op summaries, and a summary is prose somebody may one day interpolate a resolved value into;
 * routing it through the masker costs nothing on the ordinary path and closes the channel
 * structurally rather than by remembering. Optionality is the failure mode here — an optional
 * masker is a masker that is absent exactly where nobody looked — so the parameter has no default
 * and the type refuses a call that omits it.
 *
 * TWO THINGS ARE DELIBERATELY NOT MASKED, and both would be damage rather than safety. The `title`
 * is the curated tool NAME from the mapping table: a declared constant in this repository's own
 * source, never data, and a masker that rewrote it would rename the tool a caller must call. The
 * SCHEMAS are contracts rather than text — masking one would corrupt the very object
 * `invokeFunction` validates against, and they carry field names and types, not values.
 */
export function toRegisterToolConfig(
  projection: ToolProjection,
  specs: readonly ProjectedOpSpec[],
  advertised: ToolOpContracts,
  maskText: (text: string) => string,
): RegisterToolConfig {
  if (specs.length === 0) {
    throw new McpProjectionError(
      projection.name,
      'projects no ops; a tool with no arm has nothing to validate against and nothing to call',
    )
  }

  if (specs.length !== projection.ops.length) {
    // Unreachable through `catalog.ts`, which resolves every arm or none, and asserted anyway: a
    // tool derived from a SUBSET of its declared arms would advertise a contract narrower than the
    // one its handler dispatches over, and the caller who found the missing arm would be told its
    // valid input was invalid.
    throw new McpProjectionError(
      projection.name,
      `declares ${projection.ops.length} ops but was derived from ${specs.length}`,
    )
  }

  const outputSchema = probeOutputSchema(projection, advertised.output)
  const degradation = outputSchema === undefined
    ? DEGRADED_OUTPUT_CONTRACTS.find((entry) => entry.tool === projection.name)
    : undefined

  const description = describe(projection, specs)
  return {
    title: projection.name,
    description: maskText(
      degradation === undefined ? description : description + degradationSentence(degradation),
    ),
    inputSchema: advertised.input,
    ...(outputSchema === undefined ? {} : { outputSchema }),
    annotations: deriveAnnotations(specs),
  }
}

/** A projection that cannot be derived honestly, named with the tool it is about. */
export class McpProjectionError extends Error {
  constructor(readonly toolName: string, detail: string) {
    super(`${toolName} ${detail}`)
    this.name = 'McpProjectionError'
  }
}
