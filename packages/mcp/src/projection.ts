// Op contract -> `registerTool` config (Phase 396 plan 01, D-16 / MCPS-02).
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
// Protocol grounding: SEP-2106 loosened `inputSchema`/`outputSchema` to full JSON Schema 2020-12,
// which is what makes handing the SDK a real contract — refinements, unions, descriptions and all —
// viable at all; SEP-2549 makes the resulting listing cacheable, which is why nothing here varies
// per call.

import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server'
import type { FunctionScope, RiskActionDescriptor } from '@vostride/agent-qa-schema'

import type { ToolProjection } from './mapping.js'

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

/** Exactly the `registerTool` config fields this projection derives. */
export interface RegisterToolConfig {
  readonly title: string
  readonly description: string
  readonly inputSchema: StandardSchemaWithJSON
  readonly outputSchema: StandardSchemaWithJSON
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
 * something would be authoring a second description of one capability. A fold lists its arms, each
 * labelled with the op id it stands for, because a caller told only "manage configuration" cannot
 * work out which arm a given input selects, and the discriminant IS the op id.
 */
function describe(specs: readonly ProjectedOpSpec[]): string {
  if (specs.length === 1) return specs[0]!.summary
  return specs.map((spec) => `${spec.id}: ${spec.summary}`).join('\n')
}

/**
 * Derive one tool's `registerTool` config.
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
  maskText: (text: string) => string,
): RegisterToolConfig {
  if (specs.length === 0) {
    throw new McpProjectionError(
      projection.name,
      'projects no ops; a tool with no arm has nothing to validate against and nothing to call',
    )
  }

  // A fold's advertised input must accept every arm, and its output must admit every arm's result.
  // Composing that union mechanically needs a discriminant this plan's single 1:1 entry does not
  // exercise, so it is refused rather than approximated: shipping the first arm's contract for a
  // fold would advertise a schema that silently rejects valid calls to the other arms.
  if (specs.length > 1) {
    throw new McpProjectionError(
      projection.name,
      'is a declared fold; composing an arm-union contract is plan 04\'s work and is refused here '
        + 'rather than approximated by one arm\'s schema',
    )
  }

  const only = specs[0]!
  return {
    title: projection.name,
    description: maskText(describe(specs)),
    inputSchema: only.input,
    outputSchema: only.output,
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
