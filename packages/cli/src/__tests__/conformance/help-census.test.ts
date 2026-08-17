// The help ↔ catalog census and the help text's argument contract
// (Phase 398 plan 09 — XPLN-01, D-01 / SC-1).
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

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CHAT_DIRECTIVES,
  CHAT_HELP_ENTRIES,
  CHAT_HELP_TEXT,
  CHAT_RESOLVER_TABLE,
  resolveClause,
} from '@vostride/agent-qa-agent'
import { describe, expect, it } from 'vitest'

import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import { agentQaRoot, CHAT_ALIAS_PROBES } from './catalog.js'

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
