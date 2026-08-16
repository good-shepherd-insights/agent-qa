// The inherited adjudications, made checkable (Phase 397 plan 05 — D-16 / D-17 / D-20).
//
// WHY THIS FILE EXISTS. Three earlier phases wrote promissory notes against 397: a reservation in
// `function-scope.ts` saying this phase would extend the scope union, twenty-nine rows in
// `DELETION-INVENTORY.md` marked `dropped-pending-397-adjudication`, and two `adjudication: '397'`
// entries in `mapping.ts`'s degraded-output list. D-20 pays them AT the artifact that carries the
// promise, dated and in place, rather than in a central adjudication document — so the artifacts
// answer and the phase SUMMARY only narrates.
//
// A RULING WRITTEN IN PROSE IS A RULING THAT CAN GO STALE SILENTLY, and this phase's whole thesis
// is that a claim nothing checks is not a claim. So each ruling above is joined here to the thing it
// describes: the scope union's LENGTH and MEMBERS beside its closure note, the disposition column
// beside the rows it disposes of, the degraded entries beside their dated comments. Re-opening the
// union un-dated, adding a pending row without ruling it, or deleting a disposition comment is a
// named RED in this file rather than a diff nobody reads.
//
// EVERY REGISTER HERE SELF-CHECKS IN BOTH DIRECTIONS. The lesson this project keeps re-learning is
// that a register asserting completeness over an artifact it silently failed to parse reports a
// clean bill of health for an empty set. So the disposition parser, the unknown-scope census and
// the degraded-comment scanner are each a PURE function over text or data, driven both against the
// real artifact and against synthetic controls — one well-formed (must produce no finding) and one
// deliberately broken (must produce exactly one, naming the offender). The controls are spelled
// `..._397_05` so 397-09's mutation script can tell an intentional fixture from a planted one.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. The degraded contracts' ABSENCE of an advertised
// `outputSchema` is owned by `packages/mcp`'s own projection suite, which probes the conversion in
// both directions at server build (RESEARCH Pitfall 9). Re-pinning it here would be the
// redundant-mechanism trap: two registers over one universe, free to diverge. This file asserts the
// JOIN — that the two entries name real projected tools and ops — and nothing more.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENT_QA_TOOL_PROJECTIONS, DEGRADED_OUTPUT_CONTRACTS } from '@vostride/agent-qa-mcp'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { registryDeclarations } from './adapters.js'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `conformance` → `__tests__` → `src` → `cli` → `packages` → the workspace root. */
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..')

const SCOPE_SOURCE_PATH = join(REPO_ROOT, 'packages/schema/src/functions/function-scope.ts')
const INVENTORY_PATH = join(REPO_ROOT, 'packages/mcp/DELETION-INVENTORY.md')
const MAPPING_SOURCE_PATH = join(REPO_ROOT, 'packages/mcp/src/mapping.ts')

const readSource = (path: string): string => readFileSync(path, 'utf8')

// ---- D-16: the scope union, closed at six ------------------------------------------------------

/**
 * The closure note's anchor, and the reservation it replaced.
 *
 * TWO STRINGS RATHER THAN ONE, because the two failure modes are different. A missing anchor is the
 * note having been deleted or re-dated; a REAPPEARING reservation is the union being re-opened by
 * someone restoring the sentence that let three phases extend it. Only asserting the first would
 * pass a file that carried both.
 */
const CLOSURE_ANCHOR = 'SCOPE UNION CLOSED (2026-08-16 · Phase 397 · D-16)'
const RETIRED_RESERVATION = 'Phase 397 extends this closed union'

/** The union, restated once. Adding or renaming a member reds the first cell below. */
const PINNED_SCOPES: readonly string[] = [
  'read',
  'run',
  'config-write',
  'knowledge-write',
  'approval-write',
  'test-write',
]

/** Just enough of a declaration to ask the census question, so the control can be a literal. */
interface ScopeBearing {
  readonly id: string
  readonly requiredScopes: readonly string[]
}

/**
 * Scopes named by a declaration that the union does not hold — the census red D-16 leans on.
 *
 * A PURE FUNCTION over declarations rather than an inline loop, so the same code that reads the
 * real registry can be driven with a declaration carrying tomorrow's `issues-write`. Without that
 * control the cell would assert that a set the type system already constrains is what the type
 * system says it is, which is a tautology wearing a test's clothes.
 */
function unknownScopeFindings(declarations: readonly ScopeBearing[]): readonly string[] {
  const union = new Set<string>(FunctionScopeSchema.options)
  return declarations.flatMap((declaration) =>
    declaration.requiredScopes
      .filter((scope) => !union.has(scope))
      .map((scope) => `${declaration.id} requires '${scope}', which the scope union does not hold`))
}

// ---- D-17 / D-20: the deletion inventory's disposition column -----------------------------------

const DISPOSITION_COLUMN = 'Disposition (397, 2026-08-16)'
const PENDING_MARK = 'dropped-pending-397-adjudication'

/** A ruled row, as the parser reads it. */
interface InventoryRow {
  /** The row's own first cell — a number in the tools table, a label in the other two. */
  readonly key: string
  /** True iff the 396 column left this row pending 397's adjudication. */
  readonly pending: boolean
  /** The 397 cell, trimmed. */
  readonly ruling: string
}

interface InventoryReading {
  readonly rows: readonly InventoryRow[]
  readonly findings: readonly string[]
}

/** `gap → …` and `not-a-gap → …` for a pending row; `n/a → …` for one that was never pending. */
const RULED_GAP = /^gap → \S/
const RULED_NOT_A_GAP = /^not-a-gap → \S/
const RULED_NOT_PENDING = /^n\/a → \S/

/**
 * Read every table that carries the 397 column, and say what is wrong with it.
 *
 * PURE, AND OVER TEXT, so the two controls below can hand it a table with a hole in it. The parser
 * finds its columns BY HEADER NAME rather than by position: a column inserted before it would
 * otherwise shift every reading by one and the register would report rulings that are really
 * somebody else's reason text.
 */
function parseInventory(markdown: string): InventoryReading {
  const rows: InventoryRow[] = []
  const findings: string[] = []
  const cellsOf = (line: string): readonly string[] =>
    line.slice(1, line.lastIndexOf('|')).split('|').map((cell) => cell.trim())

  let headers: readonly string[] | null = null
  let rulingAt = -1
  let dispositionAt = -1

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      headers = null
      continue
    }
    if (headers === null) {
      const candidate = cellsOf(trimmed)
      if (!candidate.includes(DISPOSITION_COLUMN)) continue
      headers = candidate
      rulingAt = candidate.indexOf(DISPOSITION_COLUMN)
      dispositionAt = candidate.indexOf('Disposition')
      if (dispositionAt < 0) findings.push('a table carries the 397 column with no 396 disposition column')
      continue
    }
    if (/^\|[\s|:-]+\|$/.test(trimmed)) continue

    const cells = cellsOf(trimmed)
    const key = cells[0] ?? '(no key)'
    if (cells.length !== headers.length) {
      findings.push(`row ${key}: ${cells.length} cells against ${headers.length} headers`)
      continue
    }
    const ruling = cells[rulingAt] ?? ''
    const pending = (cells[dispositionAt] ?? '') === PENDING_MARK
    rows.push({ key, pending, ruling })

    if (ruling === '') {
      findings.push(`row ${key}: no 397 disposition`)
      continue
    }
    if (pending && !RULED_GAP.test(ruling) && !RULED_NOT_A_GAP.test(ruling)) {
      findings.push(`row ${key}: pending row ruled "${ruling.slice(0, 40)}" — outside gap / not-a-gap`)
    }
    if (!pending && !RULED_NOT_PENDING.test(ruling)) {
      findings.push(`row ${key}: never-pending row ruled "${ruling.slice(0, 40)}" — expected n/a`)
    }
  }

  return { rows, findings }
}

const tally = (reading: InventoryReading): { gap: number, notAGap: number, notPending: number } => ({
  gap: reading.rows.filter((row) => RULED_GAP.test(row.ruling)).length,
  notAGap: reading.rows.filter((row) => RULED_NOT_A_GAP.test(row.ruling)).length,
  notPending: reading.rows.filter((row) => RULED_NOT_PENDING.test(row.ruling)).length,
})

/** A control table with the shape of the real ones and none of their length. */
function controlTable(rulings: readonly string[]): string {
  const header = `| # | v1 tool | Disposition | Registry op / reason | ${DISPOSITION_COLUMN} |`
  const rule = '|---|---------|-------------|----------------------|---|'
  const marks = [PENDING_MARK, PENDING_MARK, 'projected-by-396-tool']
  const body = rulings.map((ruling, index) =>
    `| control.row.397.05.${index + 1} | \`t\` | ${marks[index]} | reason | ${ruling} |`)
  return ['prose above', '', header, rule, ...body, '', 'prose below'].join('\n')
}

// ---- The fourth adjudication: the two degraded output contracts ---------------------------------

const DEGRADED_ANCHOR = '397 DISPOSITION (2026-08-16 · D-20): keep-degraded'

/**
 * The literal source of the degraded list, so a comment can be asserted about.
 *
 * Read off DISK rather than off the built package, deliberately: comments do not survive the build,
 * and the ruling IS a comment. A cell asking `dist` about it would be asking the one artifact that
 * cannot answer.
 */
function degradedListBlock(source: string): string {
  const start = source.indexOf('export const DEGRADED_OUTPUT_CONTRACTS')
  if (start < 0) return ''
  const end = source.indexOf('] as const satisfies readonly OutputSchemaDegradation[])', start)
  return end < 0 ? '' : source.slice(start, end)
}

/**
 * What each entry's own comment window is missing.
 *
 * The window is the text between the previous entry's `tool:` line and this one's, which is exactly
 * where its comment lives. Walking forward with a cursor rather than searching the whole block
 * matters: a single anchor at the top of the list would otherwise satisfy both entries, and "one
 * entry was ruled and the other rode along" is the failure this scan exists to name.
 */
function degradedDispositionFindings(
  block: string,
  tools: readonly string[],
): readonly string[] {
  if (block === '') return ['mapping.ts no longer carries a readable DEGRADED_OUTPUT_CONTRACTS list']
  const findings: string[] = []
  let cursor = 0
  for (const tool of tools) {
    const at = block.indexOf(`tool: '${tool}'`, cursor)
    if (at < 0) {
      findings.push(`${tool}: no entry in the declared list`)
      continue
    }
    const window = block.slice(cursor, at)
    cursor = at
    if (!window.includes(DEGRADED_ANCHOR)) {
      findings.push(`${tool}: no dated 397 keep-degraded disposition above its entry`)
      continue
    }
    if (window.replace(/\s+/g, ' ').length < 300) {
      findings.push(`${tool}: carries the anchor with no reason under it`)
    }
  }
  return findings
}

// ================================================================================================

describe('Phase 397 — the inherited adjudications, discharged at their artifacts', () => {
  describe('D-16: the capability-scope union closes at six, dated', () => {
    it('holds exactly the six members the closure note ratifies', () => {
      expect(FunctionScopeSchema.options.length, 'the scope union grew or shrank').toBe(6)
      expect([...FunctionScopeSchema.options]).toEqual(PINNED_SCOPES)
    })

    it('carries the dated closure note, and no longer carries the reservation it replaced', () => {
      const source = readSource(SCOPE_SOURCE_PATH)
      expect(source, 'function-scope.ts read back empty').toContain('FunctionScopeSchema')
      expect(source, 'the dated D-16 closure anchor is gone from function-scope.ts')
        .toContain(CLOSURE_ANCHOR)
      expect(source, 'the 2026-07-28 reservation is back — the union has been re-opened un-dated')
        .not.toContain(RETIRED_RESERVATION)
    })

    it('states the growth rule and names issues-write as the anticipated first extension', () => {
      const source = readSource(SCOPE_SOURCE_PATH)
      // Both halves of the rule, and the anticipated door. A note that kept the anchor while losing
      // the rule would be a date with nothing under it.
      expect(source, 'the closure note no longer demands a privilege-conflation argument')
        .toContain('PRIVILEGE CONFLATION')
      expect(source, 'the closure note no longer demands a scenario-table row')
        .toContain('scenario-table row')
      expect(source, 'the closure note no longer demands a golden-registry update')
        .toContain('golden-registry update')
      expect(source, 'the closure note no longer names issues-write as the expected extension')
        .toContain('`issues-write`')
      // The lineage, so the three inherited counter-notes cannot be summarised away undated.
      for (const date of ['2026-08-02', '2026-08-07', '2026-08-11']) {
        expect(source, `the ${date} extension's date has left the file`).toContain(date)
      }
    })

    it('is a union every declared capability can be measured against', () => {
      expect(unknownScopeFindings(registryDeclarations())).toEqual([])
    })

    it('would name an op that minted a scope outside the union', () => {
      // The control, and the reason the cell above is not a tautology. `issues-write` is the exact
      // member D-16 anticipates, so this fixture is also a rehearsal of the day it arrives.
      const findings = unknownScopeFindings([
        { id: 'control.scope.397.05', requiredScopes: ['read', 'issues-write'] },
      ])
      expect(findings.length).toBe(1)
      expect(findings[0]).toContain('control.scope.397.05')
      expect(findings[0]).toContain('issues-write')
    })
  })

  describe('D-17 / D-20: every pending deletion-inventory row is ruled', () => {
    it('parses all forty rows of the three tables that carry the column', () => {
      const reading = parseInventory(readSource(INVENTORY_PATH))
      // The denominator, so a parse that silently found nothing cannot report a clean register.
      expect(reading.rows.length, 'the inventory parse found a different number of rows').toBe(40)
      expect(reading.rows.filter((row) => row.pending).length, 'pending rows').toBe(29)
    })

    it('leaves no row unruled and none outside the closed vocabulary', () => {
      expect(parseInventory(readSource(INVENTORY_PATH)).findings).toEqual([])
    })

    it('rules seven gaps, twenty-two non-gaps, and eleven never-pending rows', () => {
      expect(tally(parseInventory(readSource(INVENTORY_PATH))))
        .toEqual({ gap: 7, notAGap: 22, notPending: 11 })
    })

    it('routes each ruled gap to a named owner rather than to nobody', () => {
      const gaps = parseInventory(readSource(INVENTORY_PATH)).rows
        .filter((row) => RULED_GAP.test(row.ruling))
      for (const row of gaps) {
        // A gap whose owner is "397" would be this phase minting the op D-17 forbids it to mint.
        expect(row.ruling, `row ${row.key} names no owning milestone`).toMatch(/M\d/)
        expect(row.ruling, `row ${row.key} routes its gap back to this phase`).not.toContain('397)')
      }
    })

    it('keeps the file\'s own count sentences equal to the rows they count', () => {
      const flat = readSource(INVENTORY_PATH).replace(/\s+/g, ' ')
      const counts = /33 rows — \*\*(\d+) `projected-by-396-tool`\*\*, \*\*(\d+) `dropped-pending-397-adjudication`\*\*/
        .exec(flat)
      expect(counts, 'the tools table\'s count sentence is gone or reworded').not.toBeNull()
      // The measured tools tally: eleven never-pending rows, twenty-two pending ones. The sentence
      // as first written on 2026-08-15 said 12 and 21 and was never true; this cell is why it
      // cannot drift again.
      expect(Number(counts?.[1]), 'projected count').toBe(11)
      expect(Number(counts?.[2]), 'dropped-pending count').toBe(22)

      const declared = (label: string): number => {
        const found = new RegExp(`\\*\\*\`${label}[^*]*\\*\\* — [^*]*\\*\\*(\\d+) rows\\.\\*\\*`).exec(flat)
        expect(found, `the header no longer declares a count for ${label}`).not.toBeNull()
        return Number(found?.[1])
      }
      const measured = tally(parseInventory(readSource(INVENTORY_PATH)))
      expect(declared('gap → ')).toBe(measured.gap)
      expect(declared('not-a-gap → ')).toBe(measured.notAGap)
      expect(declared('n/a → ')).toBe(measured.notPending)
    })

    it('finds nothing wrong with a well-formed control table', () => {
      const reading = parseInventory(controlTable([
        'gap → M5 (live view), which owns the work',
        'not-a-gap → answered by an op that already exists',
        'n/a → projected by 396; nothing pends here.',
      ]))
      expect(reading.findings).toEqual([])
      expect(reading.rows.length).toBe(3)
    })

    it('names the row when a pending row carries no ruling at all', () => {
      const reading = parseInventory(controlTable([
        'gap → M5 (live view), which owns the work',
        '',
        'n/a → projected by 396; nothing pends here.',
      ]))
      expect(reading.findings.length).toBe(1)
      expect(reading.findings[0]).toContain('control.row.397.05.2')
      expect(reading.findings[0]).toContain('no 397 disposition')
    })

    it('names the row when a pending row is ruled outside the vocabulary', () => {
      const reading = parseInventory(controlTable([
        'gap → M5 (live view), which owns the work',
        'still pending, revisit later',
        'n/a → projected by 396; nothing pends here.',
      ]))
      expect(reading.findings.length).toBe(1)
      expect(reading.findings[0]).toContain('control.row.397.05.2')
      expect(reading.findings[0]).toContain('outside gap / not-a-gap')
    })

    it('names the row when the column is missing from it entirely', () => {
      const table = controlTable([
        'gap → M5 (live view), which owns the work',
        'not-a-gap → answered by an op that already exists',
        'n/a → projected by 396; nothing pends here.',
      ]).replace('| control.row.397.05.2 | `t` | dropped-pending-397-adjudication | reason | '
        + 'not-a-gap → answered by an op that already exists |',
      '| control.row.397.05.2 | `t` | dropped-pending-397-adjudication | reason |')
      const reading = parseInventory(table)
      expect(reading.findings.length).toBe(1)
      expect(reading.findings[0]).toContain('control.row.397.05.2')
      expect(reading.findings[0]).toContain('4 cells against 5 headers')
    })
  })

  describe('D-20\'s fourth adjudication: the two degraded output contracts', () => {
    it('declares exactly the two entries 397 was named to adjudicate', () => {
      expect(DEGRADED_OUTPUT_CONTRACTS.map((entry) => [entry.tool, entry.opId])).toEqual([
        ['agent_qa_start_run', 'runs.start'],
        ['agent_qa_list_runs', 'runs.list'],
      ])
      for (const entry of DEGRADED_OUTPUT_CONTRACTS) {
        expect(entry.adjudication, entry.tool).toBe('397')
      }
    })

    it('carries a dated keep-degraded disposition above each entry', () => {
      const block = degradedListBlock(readSource(MAPPING_SOURCE_PATH))
      expect(block, 'the degraded list read back empty').toContain('agent_qa_start_run')
      expect(degradedDispositionFindings(
        block,
        DEGRADED_OUTPUT_CONTRACTS.map((entry) => entry.tool),
      )).toEqual([])
    })

    it('names the entry whose disposition is missing, and does not let a sibling cover for it', () => {
      // The control: one anchor, two entries. A scan that searched the whole block would call this
      // ruled — which is precisely how a second degradation could land under a comment written
      // about the first.
      const control = [
        'export const DEGRADED_OUTPUT_CONTRACTS = Object.freeze([',
        `  // ${DEGRADED_ANCHOR}. ${'A reason long enough to be a reason rather than a stamp. '.repeat(5)}`,
        '  Object.freeze({',
        '    tool: \'control_degraded_397_05_a\',',
        '  }),',
        '  Object.freeze({',
        '    tool: \'control_degraded_397_05_b\',',
        '  }),',
      ].join('\n')
      const findings = degradedDispositionFindings(
        control,
        ['control_degraded_397_05_a', 'control_degraded_397_05_b'],
      )
      expect(findings.length).toBe(1)
      expect(findings[0]).toContain('control_degraded_397_05_b')
      expect(findings[0]).toContain('no dated 397 keep-degraded disposition')
    })

    it('names an entry whose disposition is an anchor with nothing under it', () => {
      const control = [
        'export const DEGRADED_OUTPUT_CONTRACTS = Object.freeze([',
        `  // ${DEGRADED_ANCHOR}.`,
        '  Object.freeze({',
        '    tool: \'control_degraded_397_05_c\',',
        '  }),',
      ].join('\n')
      const findings = degradedDispositionFindings(control, ['control_degraded_397_05_c'])
      expect(findings.length).toBe(1)
      expect(findings[0]).toContain('carries the anchor with no reason under it')
    })

    it('joins each degraded entry to a real projected tool and op, and asserts nothing more', () => {
      // The JOIN only. Whether the tool advertises an outputSchema is probed at server build and
      // owned by the projection suite (Pitfall 9); a second pin here could disagree with it.
      for (const entry of DEGRADED_OUTPUT_CONTRACTS) {
        const projection = AGENT_QA_TOOL_PROJECTIONS.find((candidate) => candidate.name === entry.tool)
        expect(projection, `${entry.tool} is degraded but no longer a projected tool`).toBeDefined()
        expect([...(projection?.ops ?? [])], `${entry.tool} no longer projects ${entry.opId}`)
          .toContain(entry.opId)
      }
    })
  })
})
