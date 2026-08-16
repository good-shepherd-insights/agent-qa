// The capability catalog: the projection, the alias probe table, and the comparator
// (Phase 398 plan 01 — XPLN-01, D-01 / D-03 / D-05 / D-06 / D-07 / D-08).
//
// WHAT THE CATALOG IS FOR. The golden ledger next door answers "did a capability's contract move".
// This artifact answers "what can this product do, in the words a person reads" — and it is the
// ONE data source behind `init --agent`, the chat `/` type-ahead, the starter prompts and the
// `explain` op. Because those four all project one artifact, "the manifest and the type-ahead
// agree" stops being a promise and becomes an identity.
//
// PRODUCED, NEVER AUTHORED. Every value in a row comes out of a live seam: op rows from the
// declarations of a REAL `composeCliLocalAgent()` composition, surfaces from the shipped
// `mapping.ts` partition, alias targets from the shipped resolver table's own resolution, skill
// rows from the shipped SKILL.md frontmatter. Nothing below states an op id, a tool name or a
// scope. A hand-written catalog can encode a capability the product does not have, and the
// freshness leg would then red only on that impossible row while agreeing about everything real.
//
// THE REGEN CANNOT BE ONE KEYSTROKE. There is no snapshot here and no `--update` path: this module
// offers the regen script a PRINT between sentinels (see {@link CATALOG_EMIT_BEGIN}), never a
// write. The ONE writer is `scripts/398-regen-catalog.sh --write`, which refuses to run while any
// other leg of this suite is red and whose `--selftest` proves that refusal fires.
//
// ONE RECIPE. The script and the freshness leg call the same {@link capabilityCatalogFromRoot}, and
// the composition it walks is the golden's own {@link withGoldenRootDeclarations} — so the two
// committed projections cannot disagree about which registry they were taken from.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { FunctionDeclaration } from '@vostride/agent-qa-agent'
import { CHAT_RESOLVER_TABLE } from '@vostride/agent-qa-agent'
import {
  canonicalJson,
  catalogRowKey,
  committedFileText,
  sha256hex,
  type CapabilityCatalog,
  type CatalogAliasRow,
  type CatalogOpRow,
  type CatalogRow,
  type CatalogSkillRow,
  type CatalogSurface,
} from '@vostride/agent-qa-schema'
import { parse as parseYaml } from 'yaml'

import {
  CATALOG_REGEN_INSTRUCTION,
  CATALOG_REGEN_SCRIPT,
  resolveCapabilityCatalogPath,
} from '../../capability-catalog/loader.js'
import { resolveAgentQaSkillsDirectory } from '../../commands/skills.js'
import { goldenPartitionOf, withGoldenRootDeclarations } from './golden.js'

export { CATALOG_REGEN_INSTRUCTION, CATALOG_REGEN_SCRIPT }

// ---- Where things are ----------------------------------------------------------------------------

/** This directory, so every path below is found rather than guessed at from a working directory. */
const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * The committed artifact's path, from the loader's OWN resolution.
 *
 * Not re-derived here: the file the suite compares against must be, by construction, the file the
 * shipped loader reads. A relative path spelled in this directory would agree with the loader right
 * up until the artifact moved.
 */
export const CATALOG_PATH = resolveCapabilityCatalogPath(CONFORMANCE_DIR)

/**
 * The agent-qa root, found by the workspace marker.
 *
 * Doc paths are REPO-RELATIVE (D-07) and the artifact is byte-compared across machines, so an
 * absolute path anywhere in a row would make the committed file a property of whoever last ran the
 * script. The walk stops at the file that defines the workspace rather than counting `..` segments,
 * which is a count that goes wrong silently when a directory is added.
 */
export function agentQaRoot(startDir: string = CONFORMANCE_DIR): string {
  let current = startDir
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(
        'the agent-qa root could not be found from '
        + `${startDir} — no ancestor carries pnpm-workspace.yaml`,
      )
    }
    current = parent
  }
}

/** A path inside the repo, as the artifact records it: repo-relative, POSIX separators. */
function repoRelative(absolutePath: string): string {
  return relative(agentQaRoot(), absolutePath).split(/[\\/]/u).join('/')
}

// ---- The note the committed file carries ---------------------------------------------------------

/**
 * PRODUCED from this constant rather than typed into the JSON, so a hand-edit to the note reds like
 * any other row. Somebody who opens a generated file should learn what changing it means without
 * having to find the phase directory.
 */
export const CATALOG_NOTE: readonly string[] = Object.freeze([
  'GENERATED — the capability catalog for Phase 398 (XPLN-01, D-01/D-03/D-05).',
  'One row per registry capability, per chat alias and per shipped skill. This artifact is the ONE',
  'data source behind `init --agent`, the chat `/` type-ahead, the starter prompts and `explain`.',
  `DO NOT EDIT BY HAND: regenerate with "bash ${CATALOG_REGEN_SCRIPT} --write" and commit the`,
  'result as a deliberate, reviewed change. The script refuses to run while any other leg of the',
  'conformance suite is red, so a regeneration cannot launder an unrelated failure, and no',
  'test-runner update flag reaches this file.',
  'IT DESCRIBES, IT DOES NOT GATE. Nothing here grants or withholds a capability; per-caller',
  'filtering is enforced live at the MCP `tools/list` seam and nowhere else.',
])

// ---- Doc-path adjudication (D-07) ----------------------------------------------------------------

/**
 * Why a row carries no doc yet.
 *
 * The honest default, and the reason it is a CONSTANT rather than prose repeated per row: the
 * shipped doc surface is four files, almost no capability has a canonical page, and the demand
 * signal for writing one is XPLN-02's coverage log — not a column somebody felt obliged to fill.
 * A guessed or placeholder URL would be worse than an absence, because the existence cell would
 * pass on it right up until a person clicked it.
 */
export const CATALOG_DOC_ABSENT_REASON =
  'D-07 (dated 2026-08-16): no canonical doc ships for this capability yet. The explicit absence is '
  + 'the honest state — a guessed path would existence-check green and mislead a reader — and the '
  + 'abstention coverage log is the demand signal for writing one.'

/** A row's doc: a real page, or a dated reason there is none. The third state does not exist. */
export type CatalogDocAdjudication =
  | { readonly path: string; readonly anchor?: string }
  | { readonly absentReason: string }

/**
 * Every registry op's doc adjudication, one entry each (D-07).
 *
 * WHY A DECLARED TABLE AND NOT A DERIVATION. There is nothing in a `FunctionSpec` that says which
 * page documents it, and there is no honest way to guess: a path assembled from an op id would
 * existence-check green for exactly as long as somebody happened to have named a file that way. So
 * the adjudication is written, and the census below forces it to be MADE — an op that lands without
 * an entry here is a named RED, which is the only mechanism that keeps "we will document it later"
 * from becoming a column of silent blanks.
 *
 * THE HONEST DEFAULT IS ABSENCE. The shipped doc surface is four pages; almost no capability has a
 * canonical one. Filling this column by writing pages to fit it would invert the demand signal —
 * XPLN-02's abstention coverage log is what says which docs a person actually wanted.
 */
export const CATALOG_DOC_PATHS: readonly (readonly [string, CatalogDocAdjudication])[] =
  Object.freeze([
    // The two real links. Both are pages that document the CAPABILITY, not pages that mention it.
    Object.freeze([
      'runs.start',
      // The README's CLI section is the one shipped page that shows a person starting a run.
      Object.freeze({ path: 'README.md', anchor: 'CLI' } as const),
    ] as const),
    Object.freeze([
      'runs.postprocessing',
      // The op reads chip statuses out of durable job state; `docs/queues.md` is where that
      // substrate — the agent job queue — is the subject rather than an aside.
      Object.freeze({ path: 'docs/queues.md', anchor: 'agent job queue' } as const),
    ] as const),

    // …and the explicit absences, one per remaining op.
    Object.freeze(['agent.ask', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['analysis.get', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['authoring.draft.edit', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['authoring.draft.verify', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['authoring.draft.write', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['authoring.funnel.get', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.auth.set', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.field.set', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.get', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.hook.add', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.project.scaffold', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.proposal.apply', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.target.create', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.target.edit', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['config.undo.propose', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['entities.get', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['entities.resolve', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['grants.list', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['grants.revoke', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.accept.propose', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.brief.why', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.bundles.list', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.forget.propose', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.proposal.apply', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.record.show', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.records.diff', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.records.inspect', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['knowledge.reject.propose', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['proposals.accept', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['proposals.list', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['proposals.reject', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['proposals.show', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['quarantine.add', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['quarantine.list', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['quarantine.release', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['runs.digest', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['runs.events', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['runs.get', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
    Object.freeze(['runs.list', Object.freeze({ absentReason: CATALOG_DOC_ABSENT_REASON })] as const),
  ])

/**
 * The doc fields of one row, from the adjudication table.
 *
 * REFUSES on an unadjudicated op rather than defaulting to absence: a default would make the census
 * cell the only thing standing between a new capability and a silent blank, and the producer would
 * happily mint the blank in the meantime.
 */
export function catalogDocFieldsOf(opId: string): {
  readonly docPath: string | null
  readonly docAnchor?: string
  readonly docAbsentReason?: string
} {
  const entry = CATALOG_DOC_PATHS.find(([id]) => id === opId)
  if (entry === undefined) {
    throw new Error(
      `${opId} has no entry in CATALOG_DOC_PATHS — every registry op adjudicates its doc presence, `
      + 'either a repo-relative path or a dated reason there is none (D-07)',
    )
  }
  const adjudication = entry[1]
  if ('path' in adjudication) {
    return {
      docPath: adjudication.path,
      ...(adjudication.anchor === undefined ? {} : { docAnchor: adjudication.anchor }),
    }
  }
  return { docPath: null, docAbsentReason: adjudication.absentReason }
}

// ---- The alias probe table (D-05) ----------------------------------------------------------------

/**
 * What one shipped resolver row is, and the clause that shows it.
 *
 * WHY A PROBE AND NOT A READ. `CHAT_RESOLVER_TABLE`'s rows carry a `resolve` CLOSURE, not a
 * declared target: the op id it binds is a compile-bound import inside a function body, reachable
 * only by running it. Two ways to get the target were available. Re-stating each alias's op id here
 * would be a second capability vocabulary — the exact thing the resolver table's own header
 * forbids, and a list that agrees with the table until the day somebody re-points a rule. So the
 * BINDING is produced by running the shipped resolver, and only the CLAUSE is declared. What is
 * written here is a sentence a person could type; what ends up in a row comes out of the code.
 *
 * The key set is censused against the shipped table in both directions, so an alias that lands
 * without a probe is a named RED rather than a row that quietly disappears from the catalog.
 */
export interface ChatAliasProbe {
  /** Must match a shipped `ChatResolverRule.alias` exactly — censused both ways. */
  readonly alias: string
  /** A clause a person could type, which this rule is expected to answer. */
  readonly clause: string
  /**
   * Which arm the shipped rule must answer with. Producing a different arm is a named failure of
   * the producer, not a row: a rule that silently changed kind is exactly the drift to catch.
   */
  readonly expects: 'op' | 'directive' | 'passthrough'
  /** Why a non-`op` arm gets no catalog row. Required for `directive` and `passthrough`. */
  readonly reason?: string
}

/**
 * A second clause for the passthrough probe, distinguishable from the first.
 *
 * `/fn <op>` resolves to whatever op id was typed, so a single probe would make it look like an
 * alias bound to that id and mint a catalog row for a capability nobody declared. Two probes that
 * differ prove the binding TRACKS THE INPUT — the producer asserts the two answers differ, so the
 * passthrough is recognised by its behaviour rather than by its name.
 */
const PASSTHROUGH_PROBE_ALTERNATE = '/fn proposals.list'

export const CHAT_ALIAS_PROBES: readonly ChatAliasProbe[] = Object.freeze([
  Object.freeze({ alias: 'run', clause: 'run tests/checkout.test.yaml', expects: 'op' } as const),
  Object.freeze({ alias: 'status', clause: 'status', expects: 'op' } as const),
  Object.freeze({ alias: 'test-ref', clause: 'test checkout flow', expects: 'op' } as const),
  Object.freeze({ alias: 'digest', clause: 'digest run_2f8c1a', expects: 'op' } as const),
  Object.freeze({ alias: 'proposals', clause: 'proposals', expects: 'op' } as const),
  Object.freeze({
    alias: 'model',
    clause: '/model claude-sonnet',
    expects: 'directive',
    reason:
      'a session directive: it changes how THIS session behaves and maps to no registry op, so a '
      + 'catalog row would advertise a capability that does not exist',
  } as const),
  Object.freeze({
    alias: 'pin',
    clause: '/pin write',
    expects: 'directive',
    reason: 'a session directive (a deny-only policy overlay), not a capability',
  } as const),
  Object.freeze({
    alias: 'fn',
    clause: '/fn runs.list',
    expects: 'passthrough',
    reason:
      'the generic passthrough: it reaches EVERY registry op rather than binding one, so its row '
      + 'would be an alias whose target is whatever the caller typed. Its reach is already recorded '
      + 'by every op row carrying the chat surface',
  } as const),
  Object.freeze({
    alias: 'help',
    clause: '/help',
    expects: 'directive',
    reason: 'REPL chrome, not a capability',
  } as const),
  Object.freeze({
    alias: 'quit',
    clause: '/quit',
    expects: 'directive',
    reason: 'REPL chrome, not a capability',
  } as const),
])

// ---- The projection ------------------------------------------------------------------------------

/**
 * The MCP half of an op row, folded out of the SAME partition the golden ledger records.
 *
 * 2026-08-16 — THE SURFACE VOCABULARY IS THE ROSTER, AND IT FLOWS (D-06). `chat` and `mcp` are the
 * two surfaces `roster.ts` pins and `parity.test.ts` measures. A THIRD rostered surface does not
 * need a change here beyond its own arm: the catalog's job is to never claim a surface the parity
 * suite does not measure, and the way that stays true is that this function reads the shipped
 * partition rather than a list of surfaces written in this file.
 *
 * THE CLI STAYS OUT, deliberately (397 D-03). Its handlers are not a measured surface — they
 * compose the same registry the chat host does — so a `cli` member here would be the catalog
 * asserting a parity claim nobody checks.
 */
function mcpFieldsOf(opId: string): {
  readonly surfaces: readonly CatalogSurface[]
  readonly mcpTool?: string
  readonly mcpUnprojectedReasonKey?: string
} {
  const partition = goldenPartitionOf(opId)
  switch (partition.kind) {
    case 'projected':
      return { surfaces: ['chat', 'mcp'], mcpTool: partition.tool }
    case 'unprojected':
      return { surfaces: ['chat'], mcpUnprojectedReasonKey: partition.reason }
    case 'uncatalogued':
      // The third state is DATA here too (golden.ts's rule). An op the mapping has simply forgotten
      // is a real state, and a row that dropped the field would hide it inside an absent key.
      return { surfaces: ['chat'], mcpUnprojectedReasonKey: 'uncatalogued' }
  }
}

/**
 * One declaration, projected into one op row.
 *
 * PURE, so a control cell can build a synthetically altered row from a real one without composing
 * anything, and so the script and the suite provably share this recipe.
 */
export function catalogOpRowOf(declaration: FunctionDeclaration): CatalogOpRow {
  const mcp = mcpFieldsOf(declaration.id)
  const doc = catalogDocFieldsOf(declaration.id)
  return {
    kind: 'op',
    id: declaration.id,
    description: declaration.summary,
    // VERBATIM. `declaration.input` is already an inert projection through the ONE shipped
    // zod->JSON-Schema lens (396 D-16); converting again here would be a second recipe.
    params: declaration.input as Record<string, unknown>,
    surfaces: [...mcp.surfaces],
    ...(mcp.mcpTool === undefined ? {} : { mcpTool: mcp.mcpTool }),
    ...(mcp.mcpUnprojectedReasonKey === undefined
      ? {}
      : { mcpUnprojectedReasonKey: mcp.mcpUnprojectedReasonKey }),
    docPath: doc.docPath,
    ...(doc.docAnchor === undefined ? {} : { docAnchor: doc.docAnchor }),
    ...(doc.docAbsentReason === undefined ? {} : { docAbsentReason: doc.docAbsentReason }),
    requiredScopes: [...declaration.requiredScopes].sort(),
  }
}

/**
 * The alias rows, by running the shipped resolver over the declared probes.
 *
 * The producer REFUSES rather than degrades: a rule whose arm disagrees with its probe, a probe
 * with no rule, or a passthrough that stopped tracking its input all throw by name here. Emitting a
 * partial catalog instead would put the defect in the artifact, where the freshness leg would
 * faithfully agree with it.
 */
export function buildCatalogAliasRows(
  declarations: readonly FunctionDeclaration[],
): readonly CatalogAliasRow[] {
  const summaryByOpId = new Map(declarations.map((row) => [row.id, row.summary]))
  const probeByAlias = new Map(CHAT_ALIAS_PROBES.map((probe) => [probe.alias, probe]))
  const rows: CatalogAliasRow[] = []

  for (const rule of CHAT_RESOLVER_TABLE) {
    const probe = probeByAlias.get(rule.alias)
    if (probe === undefined) {
      throw new Error(
        `the shipped resolver table carries the alias "${rule.alias}" and CHAT_ALIAS_PROBES has no `
        + 'probe for it — an alias without a probe is an alias the catalog would silently omit',
      )
    }
    const resolved = rule.resolve(probe.clause)
    if (resolved === undefined) {
      throw new Error(
        `the probe clause ${JSON.stringify(probe.clause)} no longer resolves through the shipped `
        + `"${rule.alias}" rule — the probe must be a clause the rule answers`,
      )
    }

    if (probe.expects === 'directive') {
      if (resolved.kind !== 'directive') {
        throw new Error(
          `the "${rule.alias}" rule now resolves to a registry op, but its probe declares it a `
          + 'session directive — a directive that became a capability needs a catalog row and a '
          + 'reviewed probe change',
        )
      }
      continue
    }

    if (resolved.kind !== 'op') {
      throw new Error(
        `the "${rule.alias}" rule resolves to a session directive, but its probe declares it an `
        + `alias for a registry op`,
      )
    }

    if (probe.expects === 'passthrough') {
      const alternate = rule.resolve(PASSTHROUGH_PROBE_ALTERNATE)
      if (alternate === undefined || alternate.kind !== 'op') {
        throw new Error(
          `the "${rule.alias}" passthrough no longer answers `
          + `${JSON.stringify(PASSTHROUGH_PROBE_ALTERNATE)}`,
        )
      }
      if (alternate.functionId === resolved.functionId) {
        throw new Error(
          `the "${rule.alias}" rule answered two different clauses with the same op id `
          + `(${resolved.functionId}) — its probe declares it a passthrough, and a passthrough's `
          + 'target must track what the caller typed. A rule that now binds one op is an alias and '
          + 'needs a catalog row',
        )
      }
      continue
    }

    const description = summaryByOpId.get(resolved.functionId)
    if (description === undefined) {
      throw new Error(
        `the "${rule.alias}" alias resolves to ${resolved.functionId}, which this composition root `
        + 'does not declare — an alias naming a non-registry target is a broken door, not a row',
      )
    }
    // The alias INHERITS its target's doc adjudication rather than getting one of its own: `run`
    // and `runs.start` are one capability reached two ways, and a second doc column for the alias
    // would be a second place the deep link could go stale.
    const doc = catalogDocFieldsOf(resolved.functionId)
    rows.push({
      kind: 'alias',
      alias: rule.alias,
      targetOpId: resolved.functionId,
      description,
      docPath: doc.docPath,
      ...(doc.docAnchor === undefined ? {} : { docAnchor: doc.docAnchor }),
      ...(doc.docAbsentReason === undefined ? {} : { docAbsentReason: doc.docAbsentReason }),
    })
  }

  for (const probe of CHAT_ALIAS_PROBES) {
    if (CHAT_RESOLVER_TABLE.some((rule) => rule.alias === probe.alias)) continue
    throw new Error(
      `CHAT_ALIAS_PROBES declares a probe for "${probe.alias}", which the shipped resolver table no `
      + 'longer carries — a stray probe is a row the catalog would invent',
    )
  }

  return rows
}

/** The SKILL.md frontmatter fields the catalog folds in, as the file declares them. */
interface SkillFrontmatter {
  readonly name?: unknown
  readonly description?: unknown
  readonly metadata?: { readonly 'short-description'?: unknown }
}

function frontmatterOf(skillMarkdownPath: string): SkillFrontmatter {
  const body = readFileSync(skillMarkdownPath, 'utf8')
  // The block between the first two `---` fences. Parsed by the workspace's ONE YAML reader rather
  // than by a per-field regex: a regex that read `description:` and stopped at the newline would
  // silently truncate a folded scalar, and the catalog would quote half a sentence.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(body)
  if (match === null) {
    throw new Error(`${skillMarkdownPath} carries no YAML frontmatter block`)
  }
  return (parseYaml(match[1] ?? '') ?? {}) as SkillFrontmatter
}

/**
 * The shipped skills, as DIRECTORIES — the census's other side.
 *
 * A skill row's `name` comes from its SKILL.md frontmatter; this is the directory the file sits in.
 * They are two different sources for one identity, which is exactly why the census compares them:
 * a skill whose frontmatter name drifted from its directory is a skill two consumers would disagree
 * about, and neither of them would notice.
 */
export function shippedSkillDirectoryNames(): readonly string[] {
  const resolved = resolveAgentQaSkillsDirectory(CONFORMANCE_DIR)
  return resolved.source === 'missing' ? [] : listSkillDirectories(resolved.path)
}

/** The skill rows, from the shipped skills directory the CLI's own resolution finds. */
export function buildCatalogSkillRows(): readonly CatalogSkillRow[] {
  const resolved = resolveAgentQaSkillsDirectory(CONFORMANCE_DIR)
  if (resolved.source === 'missing') {
    throw new Error(
      `no skills directory was found at ${resolved.path} — the catalog's skill rows come from the `
      + 'shipped SKILL.md files, and a catalog minted without them would claim the product ships '
      + 'none',
    )
  }

  const rows: CatalogSkillRow[] = []
  for (const entry of listSkillDirectories(resolved.path)) {
    const skillMarkdown = join(resolved.path, entry, 'SKILL.md')
    const frontmatter = frontmatterOf(skillMarkdown)
    const name = frontmatter.name
    const description = frontmatter.description
    const shortDescription = frontmatter.metadata?.['short-description']
    if (typeof name !== 'string' || typeof description !== 'string'
      || typeof shortDescription !== 'string') {
      throw new Error(
        `${skillMarkdown} does not declare name, description and metadata.short-description as `
        + 'strings — the catalog quotes those three fields and will not guess at a missing one',
      )
    }
    rows.push({
      kind: 'skill',
      name,
      description,
      shortDescription,
      docPath: repoRelative(skillMarkdown),
    })
  }
  return rows
}

/**
 * Directory entries carrying a SKILL.md, in a stable order.
 *
 * SORTED, and the sort is not cosmetic: `readdirSync` returns filesystem order, which differs
 * between machines, and the whole catalog is byte-compared across them.
 */
function listSkillDirectories(skillsDir: string): readonly string[] {
  return readdirSync(skillsDir)
    .filter((entry) => {
      const candidate = join(skillsDir, entry)
      return statSync(candidate).isDirectory() && existsSync(join(candidate, 'SKILL.md'))
    })
    .sort()
}

// ---- The whole catalog ---------------------------------------------------------------------------

/** Rows in a canonical, machine-independent order: kind first, then the row's own key. */
function catalogRowOrder(left: CatalogRow, right: CatalogRow): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1
  const leftKey = catalogRowKey(left)
  const rightKey = catalogRowKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/**
 * Every row the live tree produces today.
 *
 * Sorted, because the registry's enumeration order is a walk and a catalog whose rows moved when a
 * registration order changed would produce a whole-file diff for a zero-row change.
 */
export function buildCatalogRows(
  declarations: readonly FunctionDeclaration[],
): readonly CatalogRow[] {
  return [
    ...declarations.map((declaration) => catalogOpRowOf(declaration)),
    ...buildCatalogAliasRows(declarations),
    ...buildCatalogSkillRows(),
  ].sort(catalogRowOrder)
}

export function capabilityCatalogOf(
  declarations: readonly FunctionDeclaration[],
): CapabilityCatalog {
  const rows = [...buildCatalogRows(declarations)]
  return {
    $note: [...CATALOG_NOTE],
    rowCount: rows.length,
    rowsDigest: sha256hex(canonicalJson(rows)),
    rows,
  }
}

/** THE recipe, shared by the regen script and the freshness leg. */
export async function capabilityCatalogFromRoot(): Promise<CapabilityCatalog> {
  return withGoldenRootDeclarations((declarations) => capabilityCatalogOf(declarations))
}

/** The committed bytes: the workspace's ONE pretty canonical serializer, one trailing newline. */
export function capabilityCatalogText(catalog: CapabilityCatalog): string {
  return committedFileText(catalog)
}

// ---- The comparator (D-03) -----------------------------------------------------------------------

/** One disagreement between the live catalog and the committed one, named by row and field. */
export interface CatalogFinding {
  readonly kind: string
  readonly key: string
  /** `row` for a whole-row presence disagreement, otherwise the field that moved. */
  readonly field: string
  readonly message: string
}

/** Deep equality through the ONE canonical serializer — sorted keys, so field order cannot lie. */
function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function rowIndex(rows: readonly CatalogRow[]): ReadonlyMap<string, CatalogRow> {
  return new Map(rows.map((row) => [`${row.kind}:${catalogRowKey(row)}`, row]))
}

/**
 * Every field on every row that disagrees, as data.
 *
 * PURE, TOTAL AND DRIVABLE. The named-RED requirement (D-03) is that a mismatch identifies WHICH
 * ROW and WHICH FIELD rather than announcing that two documents differ, and a comparator that only
 * threw could not be shown to do that without breaking the committed file.
 */
export function catalogFindings(
  live: readonly CatalogRow[],
  committed: readonly CatalogRow[],
): readonly CatalogFinding[] {
  const liveById = rowIndex(live)
  const committedById = rowIndex(committed)
  const findings: CatalogFinding[] = []

  for (const [id, row] of liveById) {
    if (committedById.has(id)) continue
    findings.push({
      kind: row.kind,
      key: catalogRowKey(row),
      field: 'row',
      message:
        `${id}: the live tree produces this ${row.kind} row and the committed catalog has none — `
        + `a new capability is a reviewed artifact entry, so ${CATALOG_REGEN_INSTRUCTION}`,
    })
  }
  for (const [id, row] of committedById) {
    if (liveById.has(id)) continue
    findings.push({
      kind: row.kind,
      key: catalogRowKey(row),
      field: 'row',
      message:
        `${id}: the committed catalog carries a ${row.kind} row the live tree no longer produces — `
        + `a removed capability is a reviewed artifact entry, so ${CATALOG_REGEN_INSTRUCTION}`,
    })
  }

  for (const [id, liveRow] of liveById) {
    const committedRow = committedById.get(id)
    if (committedRow === undefined) continue
    const fields = new Set([...Object.keys(liveRow), ...Object.keys(committedRow)])
    for (const field of [...fields].sort()) {
      const liveValue = (liveRow as unknown as Record<string, unknown>)[field]
      const committedValue = (committedRow as unknown as Record<string, unknown>)[field]
      if (sameValue(liveValue, committedValue)) continue
      findings.push({
        kind: liveRow.kind,
        key: catalogRowKey(liveRow),
        field,
        message:
          `${id}.${field}: the live tree produces ${canonicalJson(liveValue)}, the committed `
          + `catalog carries ${canonicalJson(committedValue)}`,
      })
    }
  }

  return findings
}

// ---- The emit port the regen script reads --------------------------------------------------------

/**
 * The env flag under which the suite PRINTS a freshly minted catalog, and never writes one.
 *
 * A PRINT AND NOT A WRITE, deliberately — the golden's mechanism, for the golden's reason.
 * `scripts/398-regen-catalog.sh` runs the suite with this set, lifts the text out from between the
 * sentinels and writes the file ITSELF, only after its refuse-while-red gate has passed and only
 * under `--write`. So there is no value of any environment variable, and no runner flag, that
 * causes a test run to bless this artifact.
 */
export const CATALOG_EMIT_FLAG = 'AGENT_QA_398_CATALOG_EMIT'
export const CATALOG_EMIT_BEGIN = '<<<398-01-CATALOG-BEGIN>>>'
export const CATALOG_EMIT_END = '<<<398-01-CATALOG-END>>>'

/** True when the regen script asked for the text. Nothing else in the product reads this flag. */
export function catalogEmitRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CATALOG_EMIT_FLAG] === '1'
}

/** Print the minted catalog between sentinels, for the script to lift out. */
export function emitCatalogText(text: string): void {
  process.stdout.write(`\n${CATALOG_EMIT_BEGIN}\n${text}${CATALOG_EMIT_END}\n`)
}
