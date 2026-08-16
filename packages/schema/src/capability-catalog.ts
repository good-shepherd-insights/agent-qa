// The capability-catalog row DTOs (Phase 398 plan 01 — XPLN-01, D-05 / D-06 / D-07 / D-08).
//
// WHAT THE CATALOG IS FOR. The golden ledger (397 D-05) is change control: it records what a
// capability IS so a widened scope is a one-line diff. This artifact answers a different question —
// what a PERSON or an external agent can reach, in the words they would read — and it is the one
// data source behind `init --agent`, the chat `/` type-ahead, the starter prompts and the `explain`
// op. Two committed projections of one registry could drift, so they do not: a census cell asserts
// the op rows here and the golden's rows are the same set in both directions (D-01).
//
// THREE ROW KINDS, ONE DISCRIMINATED UNION (D-05). A registry op, a chat alias that resolves to
// one, and a shipped skill are three different things a person can be told about, and a flat shape
// that could describe any of them would be a shape every consumer has to defend against. `kind` is
// the discriminant every consumer switches on. Capability count is the OP rows: adding an alias
// does not add a capability.
//
// NOTHING HERE IS HAND-WRITTEN AT THE ARTIFACT (D-08). Descriptions come from the zod/FunctionSpec
// summaries that already feed chat and MCP; `params` is the declaration's own inert input
// projection, carried VERBATIM through the one shipped lens and never converted a second time. A
// poorly-reading description is fixed at its zod source, where it improves every surface at once.
//
// PRESENCE RULES LIVE AT THE PRODUCER AND ITS CENSUS, NOT IN A REFINEMENT. `mcpTool` is present iff
// the row claims the `mcp` surface, `docAbsentReason` iff `docPath` is null. Those are asserted by
// named cells in `packages/cli/src/__tests__/conformance/catalog.test.ts` rather than by a
// `superRefine` here, because a refined member cannot sit under `z.discriminatedUnion` and the
// discriminant is the more load-bearing of the two properties.

import { z } from 'zod'

import { FunctionScopeSchema } from './functions/function-scope'

/**
 * The surface vocabulary IS the pinned roster (D-06), not a superset of it.
 *
 * `chat` and `mcp` are the two surfaces 397's parity suite measures; the CLI's handlers are
 * deliberately absent (397 D-03's two-surface claim). The catalog never claims a surface nothing
 * measures — a third member arrives here only when a third roster row and its adapter do.
 */
export const CatalogSurfaceSchema = z.enum(['chat', 'mcp'])
export type CatalogSurface = z.infer<typeof CatalogSurfaceSchema>

/**
 * One example call's arguments, DERIVED from the row's own params (spec §3.3, D-08).
 *
 * WHY IT IS AN OBJECT AND NOT A BARE RECORD. `"exampleCall": { "arguments": {} }` reads, in the
 * committed file, as "call this with no arguments" — which is a true and useful thing to say about
 * an op whose every property is optional. A bare `{}` in that position would read as a missing
 * value, and the distinction between "nothing is required" and "nobody derived one" is exactly what
 * the nullable arm plus {@link CatalogOpRowSchema.exampleCallAbsentReason} exists to keep apart.
 *
 * NOTHING HERE IS AUTHORED. The values come out of one pure function over the row's own JSON-Schema
 * projection; a hand-written example is a second contract that agrees with the schema until the day
 * the schema moves, and the agent that copied it is the one who finds out.
 */
export const CatalogExampleCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
}).strict()
export type CatalogExampleCall = z.infer<typeof CatalogExampleCallSchema>

/**
 * Which of the migration map's three closed answers a retired v1 tool name gets (D-13).
 *
 * THIS IS A SECOND SPELLING OF `V1MigrationArm`, AND IT IS TIED RATHER THAN TRUSTED. The arm
 * vocabulary is owned by `packages/mcp`'s migration map, which cannot be imported here: `mcp`
 * depends on `schema`, and a DTO package that imported a surface package would invert the workspace
 * (384 D-16). The two spellings are held together from both sides — the producer's projection
 * function takes a `V1ToolMigrationEntry` and returns this DTO, so an arm minted in `mcp` and
 * missing here fails to COMPILE; and a census cell asserts these options set-equal the arms the
 * shipped map actually carries, so an arm written here that nothing uses is a named RED.
 */
export const CatalogMigrationArmSchema = z.enum(['renamed-to', 'retired', 'pending'])
export type CatalogMigrationArm = z.infer<typeof CatalogMigrationArmSchema>

/**
 * One v1 tool name and its ruled disposition, projected VERBATIM from the shipped map (D-14).
 *
 * `.strict()` for the reason every DTO here is strict, and one more: this section is what an
 * external agent still pinned to a v1 name reads, so a field that arrived by accident would be a
 * sentence the product did not mean to say to a caller it cannot see.
 */
export const CatalogMigrationEntrySchema = z.object({
  /** The v1 tool name, verbatim from the inventory's tool table. */
  v1Name: z.string().min(1),
  arm: CatalogMigrationArmSchema,
  /** The live v2 tool carrying the capability. Present only on `renamed-to`. */
  v2Tool: z.string().min(1).optional(),
  /** The inventory's ruled reason, dated. */
  note: z.string().min(1),
  /** What to call instead. Present on `retired` and `pending`. */
  route: z.string().min(1).optional(),
  /** The milestone owning the absence. Present only on `pending`. */
  owner: z.string().min(1).optional(),
}).strict()
export type CatalogMigrationEntry = z.infer<typeof CatalogMigrationEntrySchema>

/**
 * One registry op, as a person reads it.
 *
 * `mcpUnprojectedReasonKey` is the VISIBLE ABSENCE arm (D-06): an op with no MCP door carries the
 * class of the shipped `UNPROJECTED_OPS` reason rather than a blank column, so "deliberately not
 * projected" and "nobody has looked at it" are different values instead of the same hole.
 */
export const CatalogOpRowSchema = z.object({
  kind: z.literal('op'),
  /** The registry op id, under the dot taxonomy. */
  id: z.string().min(1),
  /** The declaration's own `summary` — the sentence every other surface already renders. */
  description: z.string().min(1),
  /** The declaration's inert input projection, verbatim. NEVER re-converted here. */
  params: z.record(z.string(), z.unknown()),
  surfaces: z.array(CatalogSurfaceSchema).min(1),
  /** Present iff `surfaces` contains `mcp`. */
  mcpTool: z.string().min(1).optional(),
  /** Present iff `surfaces` omits `mcp` — the visible-absence arm. */
  mcpUnprojectedReasonKey: z.string().min(1).optional(),
  /** Repo-relative path into a shipped doc, or an explicit null. Never a guessed URL (D-07). */
  docPath: z.string().min(1).nullable(),
  /** A heading within `docPath`, when the row deep-links rather than naming a whole file. */
  docAnchor: z.string().min(1).optional(),
  /** Present iff `docPath` is null — the dated reason there is no doc yet. */
  docAbsentReason: z.string().min(1).optional(),
  requiredScopes: z.array(FunctionScopeSchema),
  /**
   * A call an agent can copy, derived from `params` — or an explicit null (spec §3.3, D-08).
   *
   * NULL IS NOT "no arguments". An op whose properties are all optional gets
   * `{ "arguments": {} }`, because calling it with nothing is a real call. Null means the
   * derivation REFUSED to show a value it could not prove the shipped contract would accept, and
   * `exampleCallAbsentReason` says which construct it refused on. An example that would be
   * rejected on arrival is worse than none: the agent that copies it learns a shape the product
   * does not have, and learns it from the product's own manifest.
   */
  exampleCall: CatalogExampleCallSchema.nullable(),
  /** Present iff `exampleCall` is null — which construct the derivation would not guess at. */
  exampleCallAbsentReason: z.string().min(1).optional(),
}).strict()

/**
 * One chat alias, and the op it resolves to.
 *
 * `targetOpId` is joined to the registry in BOTH directions by the census cell: an alias naming a
 * non-registry target is a named RED, and an op-alias in the shipped resolver table with no row
 * here is the same RED from the other side (D-05).
 */
export const CatalogAliasRowSchema = z.object({
  kind: z.literal('alias'),
  /** The word a person types, exactly as the resolver table names it. */
  alias: z.string().min(1),
  targetOpId: z.string().min(1),
  /** The target op's own summary — an alias does not get a second description to drift from. */
  description: z.string().min(1),
  docPath: z.string().min(1).nullable(),
  docAnchor: z.string().min(1).optional(),
  docAbsentReason: z.string().min(1).optional(),
}).strict()

/** One shipped skill, from its own SKILL.md frontmatter. */
export const CatalogSkillRowSchema = z.object({
  kind: z.literal('skill'),
  name: z.string().min(1),
  description: z.string().min(1),
  shortDescription: z.string().min(1),
  /** The skill's own SKILL.md, repo-relative — a skill always has a doc, because it IS one. */
  docPath: z.string().min(1),
}).strict()

export const CatalogRowSchema = z.discriminatedUnion('kind', [
  CatalogOpRowSchema,
  CatalogAliasRowSchema,
  CatalogSkillRowSchema,
])

/**
 * The committed artifact.
 *
 * `rowCount` and `rowsDigest` are the file's own mechanical self-check, on the golden's precedent:
 * a mint that produced a truncated document must not be able to reach the committed file, and a
 * reader must be able to tell a re-ordering from a re-content-ing without diffing every row. The
 * digest is sha256 over the ONE canonical serializer, so it is byte-level and locale-independent
 * (edge XPLN-01/encoding).
 */
export const CapabilityCatalogSchema = z.object({
  $note: z.array(z.string().min(1)).min(1),
  rowCount: z.number().int().nonnegative(),
  rowsDigest: z.string().min(1),
  rows: z.array(CatalogRowSchema),
  /**
   * The v1→v2 migration map, projected from `packages/mcp` (D-14, XPLN-03).
   *
   * It sits BESIDE the rows rather than among them because it is not a capability: an entry says
   * a name is gone and what answers the need instead, and a row kind for it would put retired
   * history into the set every consumer counts as "what this product can do".
   */
  migrationMap: z.array(CatalogMigrationEntrySchema),
  /**
   * The migration section's own count sentence.
   *
   * `rowCount` exists so a mint that produced a truncated document cannot reach the committed
   * file; this is the same mechanical self-check for the section `rowCount` does not cover. A new
   * section with no count is the hole `rowCount` was added to close, re-opened one field over.
   */
  migrationCount: z.number().int().nonnegative(),
}).strict()

// ---- The `init --agent` manifest (398-08, D-16 · XPLN-01) ----------------------------------------
//
// WHAT THE MANIFEST IS. One local, non-interactive, idempotent read: the committed catalog's rows
// and migration map, verbatim and UNFILTERED, plus this workspace's posture. It is the machine entry
// point spec §3.3 names — what an external agent reads instead of guessing — and because it is
// produced by LOADING the committed artifact rather than by re-deriving anything, `manifest ≡
// catalog` is a cell rather than a promise.
//
// IT IS NOT A GRANT LIST, AND THE SHAPE SAYS SO. The rows are every row, for every caller: per-caller
// filtering is enforced live at the MCP `tools/list` seam and nowhere else (D-16, prohibition P1). A
// manifest that filtered would be a second, quieter place the visibility law lived, and the two would
// agree until the day one of them was improved.

/**
 * One declared MCP credential, as the posture reports it: NAMES ONLY (395 D-11, D-16).
 *
 * `.strict()` is the mechanism, not the manners. There is deliberately no `value`, no `token` and no
 * `secret` member, and strict parsing is what turns "please don't add one" into a refusal — the same
 * argument `McpTokenEntrySchema` makes about the config file it mirrors. The values themselves are
 * dereferenced in exactly one place in this product (`resolveMcpTokens`, in the composition layer)
 * and the manifest builder has no path to that function, so refs-only here is structural rather than
 * remembered.
 */
export const AgentManifestTokenRefSchema = z.object({
  /** The operator's label for the entry. Not a secret and not matched against anything. */
  name: z.string().min(1),
  /** The NAME of the environment variable the credential lives under. Never its contents. */
  tokenEnvVar: z.string().min(1),
  /** What presenting that credential unlocks — the half of the posture that is actionable. */
  scopes: z.array(FunctionScopeSchema).min(1),
}).strict()
export type AgentManifestTokenRef = z.infer<typeof AgentManifestTokenRefSchema>

/**
 * What THIS workspace grants, hides and would accept — the local half of the manifest (D-16).
 *
 * `configuration` has THREE arms and they are three different things to tell a person. `init --agent`
 * is the command an agent runs in a directory that may not be a project yet — that is what `init` is
 * for — so `absent` (no configuration file here) is an ordinary answer and not an error. `unresolved`
 * is the other one: a file IS here and it did not parse or validate, which is a thing to FIX rather
 * than a thing to run `init` for. Folding those two together would have an agent recommend the wrong
 * action; folding either into `resolved` with an empty `tokenEnvRefs` would have it report "this
 * workspace declares no credentials" about a workspace nobody could read.
 *
 * NO ARM CARRIES A REASON STRING, deliberately. A validation message quotes the input that failed to
 * validate, and the input here is the file an operator's credentials are declared beside (395-16:
 * Node's own printer walks a cause chain with `util.inspect`, which is how a config file's contents
 * once reached a terminal). The FACT is reportable; the text is not.
 */
export const AgentManifestPostureSchema = z.object({
  /** The 396 D-07 grant a local unauthenticated caller gets, read from the shipped constant. */
  defaultScopes: z.array(FunctionScopeSchema),
  /** Whether a composition here hides above-`read` ops from a listing. */
  safeMode: z.boolean(),
  /** Declared credentials, by env-ref NAME. Never a value — see {@link AgentManifestTokenRefSchema}. */
  tokenEnvRefs: z.array(AgentManifestTokenRefSchema),
  /** Whether this workspace has a configuration, and whether it read. */
  configuration: z.enum(['resolved', 'absent', 'unresolved']),
}).strict()
export type AgentManifestPosture = z.infer<typeof AgentManifestPostureSchema>

/** What `agent-qa init --agent` prints, in full. */
export const AgentManifestSchema = z.object({
  $note: z.array(z.string().min(1)).min(1),
  rows: z.array(CatalogRowSchema),
  migrationMap: z.array(CatalogMigrationEntrySchema),
  posture: AgentManifestPostureSchema,
}).strict()
export type AgentManifest = z.infer<typeof AgentManifestSchema>

export type CatalogOpRow = z.infer<typeof CatalogOpRowSchema>
export type CatalogAliasRow = z.infer<typeof CatalogAliasRowSchema>
export type CatalogSkillRow = z.infer<typeof CatalogSkillRowSchema>
export type CatalogRow = z.infer<typeof CatalogRowSchema>
export type CapabilityCatalog = z.infer<typeof CapabilityCatalogSchema>

/**
 * The row's identity within its kind — the key every census, sort and named RED uses.
 *
 * ONE SPELLING, because "which row" is asked by the producer's sort, the freshness comparator's
 * findings and three census cells; three spellings of it would be three answers on the day a kind
 * gains a field.
 */
export function catalogRowKey(row: CatalogRow): string {
  switch (row.kind) {
    case 'op':
      return row.id
    case 'alias':
      return row.alias
    case 'skill':
      return row.name
  }
}
