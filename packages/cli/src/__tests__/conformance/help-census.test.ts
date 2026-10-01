// The help ↔ catalog census, the help text's argument contract, and the skills' command vocabulary
// (Phase 398 plan 09 — XPLN-01, D-01 / SC-1 / Pitfall 5).
//
// WHAT THESE LEGS ARE FOR. `resolver-table.ts`'s header states a law in prose: help text kept
// anywhere other than the canon it documents is a second list of what chat understands, free to
// drift from the one that actually routes. It was a law nothing enforced, and it had already been
// broken — the `digest` line advertised "the latest run digest" while the rule it sits fifteen
// lines below refuses a bare `digest` on purpose. These cells turn the prose into a comparison.
//
// WHICH TWO SETS THE CENSUS COMPARES, SAID PLAINLY (397 D-14's lesson, re-measured in 398). It
// compares (1) the alias tokens named by `CHAT_HELP_ENTRIES` against (2) the committed catalog's
// alias rows, plus the shipped `CHAT_DIRECTIVES`, plus the aliases the catalog producer's own probe
// table classifies as the passthrough. Every member of both sides is read from a shipped module or
// the committed artifact; nothing here is a list somebody typed.
//
// AND WHAT IT THEREFORE CANNOT SEE. A census compares MEMBERSHIP. It is blind to a rule whose
// matching CLAUSE moved while its name stayed — which is exactly the drift that was live in this
// repo — so the argument-contract cell below closes that half by driving the shipped resolver with
// each line's own bare verb. It is equally blind to a capability listing rendered on a surface
// neither set enumerates: a second help string in some other command file is not a member of either
// side, so it touches neither. The second-list sweep is the cell that watches for that, and it
// watches by SEARCHING FOR THE VOCABULARY the shipped modules produce rather than by holding a list
// of forbidden strings — a rule that can only refuse what it can name cannot be driven to zero by
// naming more things.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Command } from 'commander'

import {
  CHAT_DIRECTIVES,
  CHAT_HELP_ENTRIES,
  CHAT_HELP_TEXT,
  CHAT_RESOLVER_TABLE,
  resolveClause,
} from '@vostride/agent-qa-agent'
import { AGENT_QA_TOOL_PROJECTIONS, V1_TOOL_MIGRATION_MAP } from '@vostride/agent-qa-mcp'
import { describe, expect, it } from 'vitest'

import {
  buildStarterPrompts,
  completionCandidatesFor,
  passthroughFormOf,
  STARTER_PROMPT_COUNT,
  typedVerbs,
} from '../../capability-catalog/chat-discovery.js'
import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import {
  DEDICATED_READ_VERBS,
  INIT_AGENT_INSTRUCTIONS_VERB,
} from '../../capability-catalog/manifest.js'
import {
  AGENT_QUESTION_MAP,
  buildAgentInstructionPointer,
  buildKnowledgeAgentGuide,
  KNOWLEDGE_SKILL_NAME,
} from '../../commands/knowledge-guide.js'
import { resolveAgentQaSkillsDirectory } from '../../commands/skills.js'
import { createAgentQaProgram } from '../../program.js'
import { agentQaRoot, buildCatalogSkillRows, CHAT_ALIAS_PROBES } from './catalog.js'
import { SURFACE_ROSTER } from './roster.js'

/** Sorted, so a named RED reads the same on every machine. */
function sorted(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

/** The first token of a help line's syntax — the word a person types alone. */
function bareVerbOf(syntax: string): string {
  return syntax.trim().split(/\s+/u)[0] ?? ''
}

/**
 * Whether the line PROMISES that a bare verb is enough.
 *
 * `<angle>` is a required argument and `[square]` an optional one, which is the convention the
 * entries already use and the one every CLI help page in this repo uses. Reading it here is what
 * turns a typographic habit into a claim the resolver can be held to.
 */
function requiresArgument(syntax: string): boolean {
  return /<[^>]+>/u.test(syntax)
}

describe('the /help census — one list of what chat understands', () => {
  it('names every row of the shipped resolver table, and no row it does not have', () => {
    const helpAliases = sorted(CHAT_HELP_ENTRIES.map((entry) => entry.alias))
    const tableAliases = sorted(CHAT_RESOLVER_TABLE.map((rule) => rule.alias))

    expect(helpAliases.length, 'the help entries are empty — this census would range nothing')
      .toBeGreaterThan(0)
    expect(
      helpAliases,
      'the help text and the table it sits beside disagree about what chat understands — '
      + 'a help line with no rule behind it is a promise nothing keeps, and a rule with no help '
      + 'line is a capability a person can only find by reading source',
    ).toEqual(tableAliases)
  })

  it('set-equals the committed catalog\'s aliases plus the directives plus the passthrough', () => {
    const catalog = loadCapabilityCatalog()
    const catalogAliases = catalog.rows
      .filter((row) => row.kind === 'alias')
      .map((row) => row.alias)
    // The passthrough is recognised the way the producer recognises it: by the probe table's own
    // classification, which the catalog's census pins against the shipped rules in both
    // directions. Spelling `fn` here would be this file's opinion about which rule is generic.
    const passthroughAliases = CHAT_ALIAS_PROBES
      .filter((probe) => probe.expects === 'passthrough')
      .map((probe) => probe.alias)

    expect(catalogAliases.length, 'the committed catalog carries no alias rows').toBeGreaterThan(0)
    expect(passthroughAliases.length, 'no probe classifies a rule as the passthrough')
      .toBeGreaterThan(0)

    const understood = sorted([...catalogAliases, ...CHAT_DIRECTIVES, ...passthroughAliases])
    const helpAliases = sorted(CHAT_HELP_ENTRIES.map((entry) => entry.alias))

    expect(
      helpAliases,
      'the help text and the ONE capability catalog disagree — every line of help is either a '
      + 'catalogued alias, a session directive or the passthrough, and every one of those has a '
      + 'line (SC-1: one source, no second list)',
    ).toEqual(understood)
  })

  it('renders CHAT_HELP_TEXT from the entries, so the sentences cannot drift from the join keys', () => {
    for (const entry of CHAT_HELP_ENTRIES) {
      expect(
        CHAT_HELP_TEXT,
        `the rendered help omits the ${entry.alias} line's syntax`,
      ).toContain(entry.syntax)
      expect(
        CHAT_HELP_TEXT,
        `the rendered help omits the ${entry.alias} line's summary`,
      ).toContain(entry.summary)
    }
  })

  it('each line\'s argument claim is what the SHIPPED rule actually does', () => {
    // The half a set comparison cannot reach. Every line is driven against the real resolver with
    // its own bare verb: a line showing a required argument must NOT resolve alone (the table's
    // near-miss law), and a line showing none must resolve — to its own rule, not to a neighbour's.
    const findings: string[] = []
    for (const entry of CHAT_HELP_ENTRIES) {
      const verb = bareVerbOf(entry.syntax)
      const resolution = resolveClause(CHAT_RESOLVER_TABLE, verb)
      if (requiresArgument(entry.syntax)) {
        if (resolution.kind !== 'unresolved') {
          findings.push(
            `${entry.alias}: help shows "${entry.syntax}" (an argument is required) but the `
            + `shipped rule resolves the bare "${verb}" to ${resolution.alias}`,
          )
        }
        continue
      }
      if (resolution.kind !== 'resolved') {
        findings.push(
          `${entry.alias}: help shows "${entry.syntax}" (no argument needed) but the shipped `
          + `rule does not resolve the bare "${verb}" at all — a person typing exactly what help `
          + 'printed reaches the planner instead of the capability',
        )
        continue
      }
      if (resolution.alias !== entry.alias) {
        findings.push(
          `${entry.alias}: the bare "${verb}" resolves to ${resolution.alias}, so this line `
          + 'documents a rule other than the one it names',
        )
      }
    }

    // Not vacuous in either direction: the cell has to range at least one line of each class, or
    // it could pass by asserting nothing about the arm that drifted.
    const required = CHAT_HELP_ENTRIES.filter((entry) => requiresArgument(entry.syntax))
    expect(required.length, 'no help line claims a required argument — the cell ranges one arm only')
      .toBeGreaterThan(0)
    expect(
      CHAT_HELP_ENTRIES.length - required.length,
      'no help line claims to work bare — the cell ranges one arm only',
    ).toBeGreaterThan(0)

    expect(
      findings,
      'the help text claims things the resolver does not do',
    ).toEqual([])
  })
})

/**
 * The three packages a chat session's own code lives in, and the one file that owns the vocabulary.
 *
 * The sweep ranges the SURFACE and the two layers behind it rather than this package alone,
 * because a second help listing is likeliest to grow where the directives are handled — and that is
 * `agent-local`'s composition, not a command file.
 */
const SWEEP_ROOTS = ['packages/cli/src', 'packages/agent/src', 'packages/agent-local/src']

/** The one module allowed to spell the vocabulary: the table the vocabulary belongs to. */
const VOCABULARY_OWNER = join('packages', 'agent', 'src', 'chat', 'resolver-table.ts')

/** Every `.ts` file under a directory, tests excluded — the sweep's universe. */
function sourceFilesUnder(root: string): readonly string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue
      found.push(...sourceFilesUnder(candidate))
      continue
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(candidate)
  }
  return found
}

/**
 * A comment line, approximately.
 *
 * The sweep skips them because a comment is not something a person reads at the prompt — this
 * file's own header names four directive forms while discussing them. The approximation is stated
 * rather than hidden: a directive listing hidden in a TRAILING comment on a line of code is not
 * detected, and it is also not rendered.
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/**
 * Whether a body names a directive form AS A FORM rather than as part of a path.
 *
 * MEASURED, NOT ASSUMED (2026-08-17): the first version of this sweep matched substrings and fired
 * on `commands/init.ts` for `'../model-defaults.js'` and for the URL `iana.org/help/…`. Both are
 * paths, and neither is a listing of anything. The boundary conditions are what make the difference
 * — a form a person types is preceded by whitespace or a quote and followed by whitespace,
 * punctuation or the end of the string, which a path segment never is on both sides at once.
 */
function namesDirectiveForm(body: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')
  return new RegExp(`(^|[\\s'"\`(\\[,])${escaped}($|[\\s'"\`)\\],.;:!?])`, 'mu').test(body)
}

describe('no second list of what chat understands', () => {
  it('no CLI module other than the resolver table spells the directive vocabulary', () => {
    // THE SEARCH TERMS ARE PRODUCED, NOT LISTED. They are the shipped directive names plus the
    // passthrough aliases, in the form a person types them — so a fifth directive is swept for the
    // day it lands, without this cell being edited. A guard that could only refuse the four names
    // written here would be an enumeration, and an enumeration is refuted by adding a fifth.
    const forms = sorted([
      ...CHAT_DIRECTIVES.map((directive) => `/${directive}`),
      ...CHAT_ALIAS_PROBES
        .filter((probe) => probe.expects === 'passthrough')
        .map((probe) => `/${probe.alias}`),
    ])
    expect(forms.length, 'the sweep searches for nothing').toBeGreaterThan(1)

    const root = agentQaRoot()
    const swept: string[] = []
    const findings: string[] = []
    for (const sweepRoot of SWEEP_ROOTS) {
      for (const file of sourceFilesUnder(join(root, sweepRoot))) {
        const repoRelative = relative(root, file)
        if (repoRelative === VOCABULARY_OWNER) continue
        swept.push(repoRelative)
        const code = readFileSync(file, 'utf8')
          .split('\n')
          .filter((line) => !isCommentLine(line))
          .join('\n')
        const named = forms.filter((form) => namesDirectiveForm(code, form))
        // TWO OR MORE is the shape of a LISTING. One form on its own is a module that mentions a
        // directive (an error message about `/quit`, say); two or more in one module is a module
        // that has started enumerating the vocabulary, which is the second list SC-1 forbids.
        if (named.length >= 2) findings.push(`${repoRelative} names ${named.join(', ')}`)
      }
    }
    expect(swept.length, 'the sweep read no files').toBeGreaterThan(100)

    // Not vacuous: the detector must fire on a planted listing, or a fragment assembled wrong
    // would leave it quietly searching for nothing.
    const planted = `  ${forms[0] ?? ''}   this list\n  ${forms[1] ?? ''}   end the session`
    expect(
      forms.filter((form) => namesDirectiveForm(planted, form)).length,
      'the sweep no longer recognises a planted directive listing',
    ).toBeGreaterThanOrEqual(2)
    // …and it must NOT fire on the two path shapes that made the first version of this cell red on
    // an innocent file. A boundary rule that forgot one of its boundaries is a sweep nobody can
    // leave switched on.
    const paths = "import { X } from '../model-defaults.js'\nconst u = 'https://iana.org/help/x'"
    expect(
      forms.filter((form) => namesDirectiveForm(paths, form)),
      'the sweep reads path segments as directive forms again',
    ).toEqual([])

    expect(
      findings,
      'a CLI module has started enumerating the chat directive vocabulary — the one list lives in '
      + 'CHAT_HELP_ENTRIES beside the table that routes it, and every consumer renders THAT',
    ).toEqual([])
  })
})

/**
 * The AUTHORED skills tree, which is not the one that ships.
 *
 * MEASURED THE HARD WAY (2026-08-17). `packages/cli/skills` is a GENERATED COPY: the CLI package's
 * `prepack` runs `copy:skills`, which deletes that directory and rebuilds it from this one. A guard
 * that read only the resolved (packaged) directory would certify a reconciliation that the next
 * `prepack` silently undoes — which is exactly what happened while this plan was being written, and
 * `validate:publish` is what surfaced it. Both trees are ranged, so a fix applied to one and not the
 * other is a named RED rather than a regression waiting for the next release.
 */
const SKILLS_SOURCE_DIR = 'skills'

/**
 * Every file a skill DIRECTORY carries, not just its SKILL.md.
 *
 * MEASURED, AND THE REASON THIS IS NOT SCOPED TO SKILL.md (2026-08-17). The first version of the
 * guard read only the three SKILL.md files, and it would have passed while
 * `agent-qa-authoring/references/agent-qa-contracts.json` — a file the skill's own step 3 tells an
 * agent to LOAD — still instructed `agent_qa_generate_id`. A guard scoped to one file of a
 * multi-file input class certifies that file, not the class. The universe here is the whole
 * directory the CLI's own resolution finds, minus binaries.
 */
function shippedSkillFiles(): readonly { name: string; path: string }[] {
  const resolved = resolveAgentQaSkillsDirectory(dirname(fileURLToPath(import.meta.url)))
  const roots = [join(agentQaRoot(), SKILLS_SOURCE_DIR)]
  if (resolved.source !== 'missing') roots.push(resolved.path)

  const found: { name: string; path: string }[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const skill of readdirSync(root)) {
      const skillDir = join(root, skill)
      if (!statSync(skillDir).isDirectory()) continue
      for (const file of filesUnderSkill(skillDir)) {
        found.push({ name: relative(agentQaRoot(), file), path: file })
      }
    }
  }
  return found.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

/** Every file under a skill directory, recursively — the whole of what a skill ships. */
function filesUnderSkill(root: string): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const candidate = join(root, entry)
    if (statSync(candidate).isDirectory()) {
      found.push(...filesUnderSkill(candidate))
      continue
    }
    found.push(candidate)
  }
  return found
}

/**
 * Every `agent_qa_*` identifier a document mentions.
 *
 * TOKENISED, NOT SUBSTRING-MATCHED, and the difference is the cell rather than a nicety:
 * `agent_qa_get_run` is a retired v1 name AND a prefix of the live `agent_qa_get_run_digest`, so a
 * `body.includes(v1Name)` guard would red on the correct replacement and stay red until somebody
 * "fixed" it by putting the retired name back. The scan reads whole identifiers and asks about
 * membership.
 */
function toolTokensIn(body: string): readonly string[] {
  return sorted(body.match(/agent_qa_[a-z0-9_]+/gu) ?? [])
}

describe('the shipped skills quote only live commands', () => {
  it('names no member of the v1 migration map (the list produced from the module)', () => {
    // THE FORBIDDEN SET IS THE MODULE'S, READ AT TEST TIME. Spelling the retired names here would
    // be a copy that stops covering the map the day it grows — and the map growing is precisely
    // when a skill is most likely to be quoting something that just died.
    const retired = new Set(V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name))
    expect(retired.size, 'the migration map is empty — this cell would forbid nothing')
      .toBeGreaterThan(0)

    const files = shippedSkillFiles()
    expect(files.length, 'no shipped skill file was found — the cell would range nothing')
      .toBeGreaterThan(0)

    const findings: string[] = []
    for (const file of files) {
      for (const token of toolTokensIn(readFileSync(file.path, 'utf8'))) {
        if (retired.has(token)) findings.push(`${file.name}: ${token}`)
      }
    }

    expect(
      findings,
      'a shipped skill instructs a RETIRED v1 tool name — the skills are doc links in the '
      + 'capability catalog, so a skill quoting a dead command is the product telling an agent to '
      + 'call something that answers unknown-tool (Pitfall 5)',
    ).toEqual([])
  })

  it('every tool a skill names is one the shipped mapping actually projects', () => {
    // THE STRONGER RULE, AND WHY BOTH ARE HERE. The cell above refuses what the migration map can
    // NAME, so a tool renamed in some future phase without an inventory row would slip past it.
    // This one asks the opposite question at the choke point — is this name LIVE — which needs no
    // list of what is forbidden and cannot be defeated by a name nobody wrote down.
    const live = new Set(AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name))
    expect(live.size, 'the shipped mapping projects no tools — this cell would allow anything')
      .toBeGreaterThan(0)

    const findings: string[] = []
    let scanned = 0
    for (const file of shippedSkillFiles()) {
      for (const token of toolTokensIn(readFileSync(file.path, 'utf8'))) {
        scanned += 1
        if (!live.has(token)) findings.push(`${file.name}: ${token}`)
      }
    }
    // Not vacuous: skills that named no tool at all would pass this cell by saying nothing, and a
    // skill set that stopped naming tools is a skill set that stopped being useful.
    expect(scanned, 'no shipped skill names a tool — the cell certifies nothing').toBeGreaterThan(0)

    expect(
      findings,
      'a shipped skill names a tool the MCP mapping does not project — every command a skill '
      + "quotes has to be one a caller can actually invoke today (SC-2's premise)",
    ).toEqual([])
  })
})

describe('the chat host\'s discovery UX is a projection of the catalog', () => {
  it('offers every alias row in the form the shipped resolver actually answers', () => {
    // THE ACCEPTANCE CRITERION, DRIVEN. Every alias the catalog carries must be reachable by
    // typing its first letter — and the candidate that comes back must be a form the table
    // answers, which is asserted rather than assumed: an offered word the resolver refuses is a
    // surface inventing a vocabulary, and it would look exactly like this cell passing.
    const rows = loadCapabilityCatalog().rows
    const aliasRows = rows.filter((row) => row.kind === 'alias')
    expect(aliasRows.length, 'the catalog carries no alias rows').toBeGreaterThan(0)

    const bareVerbs = typedVerbs(CHAT_HELP_ENTRIES).bareVerbs
    const findings: string[] = []
    for (const row of aliasRows) {
      const syntax = CHAT_HELP_ENTRIES.find((entry) => entry.alias === row.alias)?.syntax
      if (syntax === undefined) {
        findings.push(`${row.alias}: no help entry carries a typed form for it`)
        continue
      }
      const verb = syntax.trim().split(/\s+/u)[0] ?? ''
      if (!bareVerbs.includes(verb) && !verb.startsWith('/')) {
        findings.push(`${row.alias}: "${verb}" is in neither half of the typed vocabulary`)
        continue
      }
      const offered = completionCandidatesFor(verb.slice(0, 1), rows, CHAT_HELP_ENTRIES)
      if (!offered.includes(verb)) {
        findings.push(`${row.alias}: typing "${verb.slice(0, 1)}" does not offer "${verb}"`)
      }
    }
    expect(findings, 'an alias row the completer cannot surface').toEqual([])
  })

  it('reaches every catalogued op through the passthrough, and binds the op it names', () => {
    // The catalog earning its place: the resolver table is a CAP of five aliases, so this is the
    // only way a person finds the other capabilities. Each candidate is then driven through the
    // SHIPPED resolver, so a candidate that reads plausibly and binds nothing is a RED.
    const rows = loadCapabilityCatalog().rows
    const passthrough = passthroughFormOf(CHAT_HELP_ENTRIES)
    expect(passthrough, 'no shipped rule behaves as the generic passthrough').toBeDefined()

    const offered = completionCandidatesFor(passthrough ?? '', rows, CHAT_HELP_ENTRIES)
    const opRows = rows.filter((row) => row.kind === 'op')
    expect(opRows.length, 'the catalog carries no op rows').toBeGreaterThan(0)
    expect(offered.length, 'the passthrough offers a different number of ops than the catalog has')
      .toBe(opRows.length)

    const findings: string[] = []
    for (const candidate of offered) {
      const resolution = resolveClause(CHAT_RESOLVER_TABLE, candidate)
      if (resolution.kind !== 'resolved' || resolution.entry.kind !== 'op') {
        findings.push(`${candidate}: the shipped table binds nothing`)
        continue
      }
      // Hoisted, because a second read of `resolution.entry` loses the narrowing under `tsc` even
      // though `vitest --typecheck` accepts it — 398-04's trap, measured again here.
      const bound = resolution.entry.functionId
      if (!rows.some((row) => row.kind === 'op' && row.id === bound)) {
        findings.push(`${candidate}: binds ${bound}, which has no catalog row`)
      }
    }
    expect(findings, 'a passthrough candidate the shipped resolver does not answer').toEqual([])
  })

  it('offers nothing mid-sentence — a chat line is an utterance, not a command line', () => {
    const rows = loadCapabilityCatalog().rows
    expect(completionCandidatesFor('why did the checkout ', rows, CHAT_HELP_ENTRIES)).toEqual([])
    expect(completionCandidatesFor('', rows, CHAT_HELP_ENTRIES).length).toBeGreaterThan(0)
  })

  it('renders the same starter prompts from the same rows, every time', () => {
    const rows = loadCapabilityCatalog().rows
    const first = buildStarterPrompts(rows, CHAT_HELP_ENTRIES)
    const second = buildStarterPrompts([...rows].reverse(), CHAT_HELP_ENTRIES)

    expect(first.length, 'a session opens with no suggestions').toBe(STARTER_PROMPT_COUNT)
    // SAME ROWS, SAME PROMPTS — including when the rows arrive in a different order, which is the
    // property that makes the selection deterministic rather than incidental.
    expect(second, 'the starter prompts depend on the order the rows arrived in').toEqual(first)

    // Every line is CATALOG TEXT, not a sentence this surface wrote.
    const descriptions = rows.filter((row) => row.kind === 'alias').map((row) => row.description)
    for (const prompt of first) {
      expect(
        descriptions.some((description) => prompt.includes(description)),
        `a starter prompt carries text no catalog row provided: ${prompt}`,
      ).toBe(true)
    }
  })
})

// ---- 431 D-24: every name the published guidance quotes is live ---------------------------------
//
// The subjects are the generated guide, the root pointer, and every file of every skill in BOTH the
// source tree and the packaged mirror `copy:skills` produces. Tool names are checked against the MCP
// projection and the committed catalog's op rows; CLI invocations are resolved against the real
// Commander tree (`createAgentQaProgram`) and, for the verbs the capability manifest lists, against
// the manifest too. A packaged input that is absent or empty is a finding, never a skip.

interface GuidanceSubject {
  readonly name: string
  readonly body: string
}

interface GuidanceInputs {
  readonly subjects: readonly GuidanceSubject[]
  readonly findings: readonly string[]
}

function skillDirectoriesIn(root: string): readonly string[] {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((entry) => {
      const candidate = join(root, entry)
      return statSync(candidate).isDirectory() && existsSync(join(candidate, 'SKILL.md'))
    })
    .sort()
}

function subjectName(file: string): string {
  const root = agentQaRoot()
  return file.startsWith(`${root}/`) ? relative(root, file) : file
}

/** Every `references/<file>` a SKILL.md tells an agent to load must sit beside it, non-empty. */
function referenceFindings(skillDir: string): readonly string[] {
  const skillMarkdown = join(skillDir, 'SKILL.md')
  const named = sorted(readFileSync(skillMarkdown, 'utf8').match(/references\/[A-Za-z0-9._-]+/gu) ?? [])
  const findings: string[] = []
  for (const reference of named) {
    const path = join(skillDir, reference)
    if (!existsSync(path)) findings.push(`${subjectName(skillMarkdown)} names ${reference}, which is missing`)
    else if (statSync(path).size === 0) findings.push(`${subjectName(skillMarkdown)} names ${reference}, which is empty`)
  }
  return findings
}

function guidanceInputs(sourceRoot: string, packagedRoot: string): GuidanceInputs {
  const findings: string[] = []
  const subjects: GuidanceSubject[] = [
    { name: 'generated guide', body: buildKnowledgeAgentGuide() },
    { name: 'root pointer', body: buildAgentInstructionPointer().join('\n') },
  ]

  const sourceSkills = skillDirectoriesIn(sourceRoot)
  if (sourceSkills.length === 0) findings.push(`no source skill under ${subjectName(sourceRoot)}`)
  if (!existsSync(packagedRoot)) findings.push(`the packaged skills directory ${subjectName(packagedRoot)} is missing`)

  for (const skill of sourceSkills) {
    for (const file of filesUnderSkill(join(sourceRoot, skill))) {
      const packaged = join(packagedRoot, relative(sourceRoot, file))
      if (statSync(file).size === 0) findings.push(`${subjectName(file)} is empty`)
      if (!existsSync(packaged)) {
        findings.push(`${subjectName(packaged)} is missing — run copy:skills`)
        continue
      }
      if (statSync(packaged).size === 0) findings.push(`${subjectName(packaged)} is empty`)
    }
  }

  for (const root of [sourceRoot, packagedRoot]) {
    for (const skill of skillDirectoriesIn(root)) {
      findings.push(...referenceFindings(join(root, skill)))
      for (const file of filesUnderSkill(join(root, skill))) {
        subjects.push({ name: subjectName(file), body: readFileSync(file, 'utf8') })
      }
    }
  }
  return { subjects, findings }
}

function liveGuidanceInputs(): GuidanceInputs {
  return guidanceInputs(join(agentQaRoot(), SKILLS_SOURCE_DIR), join(agentQaRoot(), 'packages', 'cli', 'skills'))
}

/** The subjects that must each quote at least one tool, and at least one CLI verb. */
function nameBearing(subject: GuidanceSubject, kind: 'tools' | 'verbs'): boolean {
  if (subject.name === 'generated guide') return true
  if (subject.name === 'root pointer') return kind === 'verbs'
  return subject.name.includes(`/${KNOWLEDGE_SKILL_NAME}/`) && subject.name.endsWith('.md')
}

interface CensusResult {
  readonly scanned: number
  readonly findings: readonly string[]
}

function toolCensus(subjects: readonly GuidanceSubject[]): CensusResult {
  const projected = new Map(AGENT_QA_TOOL_PROJECTIONS.map((projection) => [projection.name, projection.ops]))
  const catalogOps = new Set(
    loadCapabilityCatalog().rows.flatMap((row) => (row.kind === 'op' ? [row.id] : [])),
  )
  const findings: string[] = []
  let scanned = 0
  for (const subject of subjects) {
    const tokens = toolTokensIn(subject.body)
    scanned += tokens.length
    if (tokens.length === 0 && nameBearing(subject, 'tools')) {
      findings.push(`${subject.name}: quotes no agent_qa_* tool — the census would certify nothing`)
    }
    for (const token of tokens) {
      const ops = projected.get(token)
      if (ops === undefined) {
        findings.push(`${subject.name}: ${token} is not a projected MCP tool`)
        continue
      }
      for (const op of ops) {
        if (!catalogOps.has(op)) findings.push(`${subject.name}: ${token} projects ${op}, which the catalog has no row for`)
      }
    }
  }
  if (scanned === 0) findings.push('no tool name was scanned')
  return { scanned, findings }
}

interface Invocation {
  readonly text: string
  readonly flags: string[]
}

const STANDALONE_FLAG = /^--[a-z][a-z0-9-]*(?:\s+<[^>]+>)?$/u

/**
 * Every `agent-qa …` invocation a document quotes: backtick spans, and lines of fenced blocks.
 *
 * A bare flag span (`--since`) that follows an invocation in the same paragraph is that
 * invocation's flag, which is how the reference lists a verb's options. Prose that merely says
 * agent-qa is not an invocation.
 */
function invocationsIn(body: string): readonly Invocation[] {
  const invocations: Invocation[] = []
  const paragraphs: string[] = []
  let paragraph: string[] = []
  let fenced = false
  for (const line of body.split('\n')) {
    if (line.trim().startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) {
      const at = line.search(/(?:^|\s)agent-qa\s+[a-z]/u)
      if (at >= 0) invocations.push({ text: line.slice(line.indexOf('agent-qa', at)).trim(), flags: [] })
      continue
    }
    if (line.trim() === '') {
      paragraphs.push(paragraph.join(' '))
      paragraph = []
      continue
    }
    paragraph.push(line)
  }
  paragraphs.push(paragraph.join(' '))

  for (const text of paragraphs) {
    let current: Invocation | undefined
    for (const match of text.matchAll(/`([^`]+)`/gu)) {
      const span = (match[1] ?? '').trim()
      if (/^agent-qa\s+[a-z]/u.test(span)) {
        current = { text: span, flags: [] }
        invocations.push(current)
      } else if (current !== undefined && STANDALONE_FLAG.test(span)) {
        current.flags.push(span)
      }
    }
  }
  return invocations
}

function commandPathOf(command: Command): string {
  const names: string[] = []
  for (let at: Command | null = command; at?.parent != null; at = at.parent) names.unshift(at.name())
  return names.join(' ')
}

function takesValue(command: Command, flag: string): boolean | undefined {
  const option = command.options.find((entry) => entry.long === flag || entry.short === flag)
  if (option === undefined) return flag === '--help' ? false : undefined
  return option.required || option.optional
}

function resolveInvocation(program: Command, invocation: Invocation): {
  readonly command?: Command
  readonly flags: readonly string[]
  readonly findings: readonly string[]
} {
  const tokens = invocation.text.split(/\s+/u).slice(1)
  const findings: string[] = []
  let command = program
  let at = 0
  while (at < tokens.length && !(tokens[at] ?? '').startsWith('-')) {
    const name = tokens[at]
    const child = command.commands.find((entry) => entry.name() === name || entry.aliases().includes(name ?? ''))
    if (child === undefined) break
    command = child
    at += 1
  }
  if (command === program) {
    return { flags: [], findings: [`"${invocation.text}": agent-qa has no command "${tokens[0] ?? ''}"`] }
  }

  const path = `agent-qa ${commandPathOf(command)}`
  const flags: string[] = []
  const positionals: string[] = []
  for (; at < tokens.length; at += 1) {
    const token = tokens[at] ?? ''
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }
    const flag = token.split('=')[0] ?? token
    flags.push(flag)
    const value = takesValue(command, flag)
    if (value === undefined) {
      findings.push(`"${invocation.text}": ${path} has no ${flag} option`)
      if ((tokens[at + 1] ?? '').startsWith('<')) at += 1
      continue
    }
    if (value && !token.includes('=') && at + 1 < tokens.length && !(tokens[at + 1] ?? '').startsWith('-')) at += 1
  }
  for (const span of invocation.flags) {
    const flag = span.split(/\s+/u)[0] ?? span
    flags.push(flag)
    if (takesValue(command, flag) === undefined) findings.push(`"${invocation.text}" then \`${span}\`: ${path} has no ${flag} option`)
  }

  const declared = command.registeredArguments
  const variadic = declared.at(-1)?.variadic === true
  if (positionals.length > declared.length && !variadic) {
    findings.push(
      command.commands.length > 0
        ? `"${invocation.text}": ${path} has no subcommand "${positionals[0] ?? ''}"`
        : `"${invocation.text}": ${path} takes ${declared.length} argument(s), not ${positionals.length}`,
    )
  }
  const required = declared.filter((argument) => argument.required).length
  if (positionals.length < required) {
    findings.push(`"${invocation.text}": ${path} requires ${required} argument(s), the guidance gives ${positionals.length}`)
  }
  return { command, flags, findings }
}

function verbCensus(subjects: readonly GuidanceSubject[], program: Command = createAgentQaProgram()): CensusResult {
  const findings: string[] = []
  let scanned = 0
  for (const subject of subjects) {
    const invocations = invocationsIn(subject.body)
    scanned += invocations.length
    if (invocations.length === 0 && nameBearing(subject, 'verbs')) {
      findings.push(`${subject.name}: quotes no agent-qa invocation — the census would certify nothing`)
    }
    for (const invocation of invocations) {
      const resolved = resolveInvocation(program, invocation)
      findings.push(...resolved.findings.map((finding) => `${subject.name}: ${finding}`))
      if (resolved.command === undefined) continue
      const manifestEntry = DEDICATED_READ_VERBS.find((entry) => entry.verb === commandPathOf(resolved.command!))
      if (manifestEntry === undefined) continue
      for (const flag of resolved.flags) {
        const live = takesValue(resolved.command, flag) !== undefined
        if (live && flag !== '--help' && !manifestEntry.flags.includes(flag)) {
          findings.push(`${subject.name}: "${invocation.text}" uses ${flag}, which the manifest's ${manifestEntry.verb} row omits`)
        }
      }
    }
  }
  if (scanned === 0) findings.push('no agent-qa invocation was scanned')
  return { scanned, findings }
}

/** The manifest's verb rows against the live tree, and the question map's CLI and MCP halves against each other. */
function manifestFindings(program: Command = createAgentQaProgram()): readonly string[] {
  const findings: string[] = []
  const find = (path: string): Command | undefined => path.split(' ').reduce<Command | undefined>(
    (parent, name) => parent?.commands.find((command) => command.name() === name), program)

  for (const entry of DEDICATED_READ_VERBS) {
    const live = find(entry.verb)
    if (live === undefined) {
      findings.push(`manifest verb "${entry.verb}" is not a live command`)
      continue
    }
    const longs = sorted(live.options.flatMap((option) => (option.long === undefined ? [] : [option.long])))
    if (JSON.stringify(longs) !== JSON.stringify(sorted(entry.flags))) {
      findings.push(`manifest verb "${entry.verb}" lists ${sorted(entry.flags).join(' ')}, the live command has ${longs.join(' ')}`)
    }
  }
  const init = find(INIT_AGENT_INSTRUCTIONS_VERB.verb)
  for (const flag of INIT_AGENT_INSTRUCTIONS_VERB.flags) {
    if (init?.options.some((option) => option.long === flag) !== true) {
      findings.push(`manifest init flag ${flag} is not an option of the live init command`)
    }
  }

  const projected = new Map(AGENT_QA_TOOL_PROJECTIONS.map((projection) => [projection.name, projection.ops]))
  for (const row of AGENT_QUESTION_MAP) {
    const resolved = resolveInvocation(program, { text: row.cli, flags: [] })
    if (resolved.command === undefined) continue
    const entry = DEDICATED_READ_VERBS.find((verb) => verb.verb === commandPathOf(resolved.command!))
    const ops = projected.get(row.mcp) ?? []
    if (entry !== undefined && !entry.opIds.some((opId) => ops.includes(opId))) {
      findings.push(`"${row.question}": ${row.cli} invokes ${entry.opIds.join(', ')}, ${row.mcp} projects ${ops.join(', ')}`)
    }
  }
  return findings
}

describe('LIVE-GUIDANCE: the guide, pointer and every source and packaged skill quote only live names', () => {
  it('LIVE-GUIDANCE-INPUTS reads the guide, the pointer and both skill trees, with nothing missing or empty', () => {
    const resolved = resolveAgentQaSkillsDirectory(dirname(fileURLToPath(import.meta.url)))
    expect(resolved.source, 'agent-qa skills resolves no packaged mirror — run copy:skills').toBe('package')

    const { subjects, findings } = liveGuidanceInputs()
    expect(findings, 'a guidance input is absent or empty').toEqual([])
    const packaged = subjects.filter((subject) => subject.name.startsWith('packages/cli/skills/'))
    const source = subjects.filter((subject) => subject.name.startsWith(`${SKILLS_SOURCE_DIR}/`))
    expect(source.length, 'no source skill file was read').toBeGreaterThan(0)
    expect(packaged.length, 'the packaged mirror has a different file count from the source').toBe(source.length)
    expect(skillDirectoriesIn(resolved.path)).toContain(KNOWLEDGE_SKILL_NAME)
  })

  it('LIVE-GUIDANCE-INPUTS names a missing or empty packaged reference instead of skipping it', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-431-12-census-'))
    try {
      const sourceRoot = join(root, 'source')
      const packagedRoot = join(root, 'packaged')
      mkdirSync(sourceRoot)
      cpSync(join(agentQaRoot(), SKILLS_SOURCE_DIR, KNOWLEDGE_SKILL_NAME), join(sourceRoot, KNOWLEDGE_SKILL_NAME), { recursive: true })

      expect(guidanceInputs(sourceRoot, packagedRoot).findings.join('\n')).toMatch(/packaged skills directory .* is missing/u)

      cpSync(sourceRoot, packagedRoot, { recursive: true })
      expect(guidanceInputs(sourceRoot, packagedRoot).findings).toEqual([])

      const reference = join(packagedRoot, KNOWLEDGE_SKILL_NAME, 'references', 'knowledge-reads.md')
      writeFileSync(reference, '')
      expect(guidanceInputs(sourceRoot, packagedRoot).findings).toEqual([
        `${reference} is empty`,
        `${join(packagedRoot, KNOWLEDGE_SKILL_NAME, 'SKILL.md')} names references/knowledge-reads.md, which is empty`,
      ])

      rmSync(reference)
      expect(guidanceInputs(sourceRoot, packagedRoot).findings).toEqual([
        `${reference} is missing — run copy:skills`,
        `${join(packagedRoot, KNOWLEDGE_SKILL_NAME, 'SKILL.md')} names references/knowledge-reads.md, which is missing`,
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('LIVE-GUIDANCE-TOOLS: every agent_qa_* name is a projected tool whose ops the catalog carries', () => {
    const { subjects } = liveGuidanceInputs()
    const live = toolCensus(subjects)
    expect(live.findings, 'the published guidance names a tool that is not live').toEqual([])
    expect(live.scanned, 'the tool census scanned fewer names than the guide alone quotes')
      .toBeGreaterThan(AGENT_QUESTION_MAP.length)

    const planted = toolCensus([
      { name: 'planted', body: 'Call `agent_qa_get_run`, then `agent_qa_get_run_overviews`.' },
    ])
    expect(planted.findings, 'the tool census accepts a stale name').toEqual([
      'planted: agent_qa_get_run is not a projected MCP tool',
      'planted: agent_qa_get_run_overviews is not a projected MCP tool',
    ])
    expect(toolCensus([]).findings).toEqual(['no tool name was scanned'])
    expect(toolCensus([{ name: 'generated guide', body: 'no tools here' }]).findings)
      .toEqual(['generated guide: quotes no agent_qa_* tool — the census would certify nothing', 'no tool name was scanned'])
  })

  it('LIVE-GUIDANCE-VERBS: every agent-qa invocation resolves in the live Commander tree and the manifest', () => {
    const { subjects } = liveGuidanceInputs()
    const program = createAgentQaProgram()
    const live = verbCensus(subjects, program)
    expect(live.findings, 'the published guidance quotes a CLI verb or flag that is not live').toEqual([])
    expect(live.scanned, 'the verb census scanned fewer invocations than the guide alone quotes')
      .toBeGreaterThan(AGENT_QUESTION_MAP.length)
    expect(manifestFindings(program), 'the capability manifest and the live CLI disagree').toEqual([])

    const planted = verbCensus([{
      name: 'planted',
      body: [
        '`agent-qa runs detail <runId>`',
        '',
        '`agent-qa runs overview <runId> --verbose`',
        '',
        '`agent-qa knowledge show`',
        '',
        'CLI: `agent-qa runs list`, with `--sort`.',
        '',
        '```text',
        'Next: agent-qa knowledge why r-brisk-heron',
        '```',
      ].join('\n'),
    }], program)
    expect(planted.findings, 'the verb census accepts a stale verb or flag').toEqual([
      'planted: "agent-qa knowledge why r-brisk-heron": agent-qa knowledge has no subcommand "why"',
      'planted: "agent-qa runs detail <runId>": agent-qa runs has no subcommand "detail"',
      'planted: "agent-qa runs overview <runId> --verbose": agent-qa runs overview has no --verbose option',
      'planted: "agent-qa knowledge show": agent-qa knowledge show requires 1 argument(s), the guidance gives 0',
      'planted: "agent-qa runs list" then `--sort`: agent-qa runs list has no --sort option',
    ])
    expect(verbCensus([], program).findings).toEqual(['no agent-qa invocation was scanned'])
  })

  it('keeps the dedicated verbs off the four-door roster and the knowledge skill in the catalog source', () => {
    expect(SURFACE_ROSTER.map((door) => door.id)).toEqual(['chat', 'mcp', 'fn', 'run-service'])
    const rosterIds = SURFACE_ROSTER.map((door) => door.id)
    for (const { verb } of DEDICATED_READ_VERBS) expect(rosterIds, verb).not.toContain(verb.split(' ')[0])
    const skillRows = buildCatalogSkillRows().map((row) => row.name)
    expect(skillRows, 'the catalog source misses a shipped skill').toEqual([...skillDirectoriesIn(join(agentQaRoot(), SKILLS_SOURCE_DIR))])
    expect(skillRows).toContain(KNOWLEDGE_SKILL_NAME)
  })
})

// 2026-10-01, 432-17 (D-02 / D-05 / D-09): `agent-qa proposals` is deleted with the inbox, including
// its `grants list | revoke` subtree. No alias is kept, so the parse tree rejects the verb the way it
// rejects any word it never had, and nothing in the help, the manifest or the dedicated-verb list
// still names it.
describe('C432-NO-PROPOSAL-CLI: there is no proposals verb', () => {
  it('C432-NO-PROPOSAL-CLI: the live Commander tree and its help name no proposals command', () => {
    const program = createAgentQaProgram()
    const names = program.commands.flatMap((command) => [command.name(), ...command.aliases()])
    expect(names.length, 'the command tree is empty, so the absence below would be vacuous').toBeGreaterThan(5)
    expect(names, 'agent-qa proposals is still registered').not.toContain('proposals')
    expect(program.helpInformation()).not.toMatch(/\bproposals\b/u)
    expect(DEDICATED_READ_VERBS.map(({ verb }) => verb).filter((verb) => verb.split(' ')[0] === 'proposals'))
      .toEqual([])
  })

  it('C432-NO-PROPOSAL-CLI: parsing a proposals or proposals-grants invocation is an unknown command', async () => {
    // Guarded first: on a tree that still registers the verb, parsing would RUN it in this cwd.
    expect(createAgentQaProgram().commands.map((command) => command.name()), 'the verb is registered')
      .not.toContain('proposals')
    for (const argv of [['proposals', 'list'], ['proposals', 'accept', 'prop_0123456789ab'], ['proposals', 'grants', 'list']]) {
      const program = createAgentQaProgram()
      let written = ''
      program.exitOverride().configureOutput({ writeErr: (text) => { written += text }, writeOut: () => {} })
      const refused = await program.parseAsync(argv, { from: 'user' }).then(
        () => undefined,
        (error: unknown) => error as { code?: string },
      )
      expect(refused?.code, argv.join(' ')).toBe('commander.unknownCommand')
      expect(written, argv.join(' ')).toMatch(/unknown command 'proposals'/u)
    }
  })
})
