// The migration map's census (Phase 398 plan 02, D-13 · XPLN-03).
//
// WHY A CENSUS AND NOT A REVIEW. `migration-map.ts` is a MACHINE PROJECTION of a human adjudication
// record — `DELETION-INVENTORY.md`'s tool table, whose every row was ruled and dated by 397. A hand-
// transcribed projection of a document is a copy, and a copy drifts silently in exactly one
// direction nobody notices: the document gains a row and the copy does not. So the denominator here
// is THE PARSED DOCUMENT, never a number written in this file. Both directions are asserted — a map
// entry with no inventory row is a stray, an inventory row with no map entry is a hole, and each
// reds by NAME rather than as a count mismatch a reader then has to go diff by hand.
//
// THE PARSE IS SCOPED AND ITS OWN DENOMINATOR IS CHECKED. Only the `## Tools` section is parsed:
// the prompt row and the six resource rows are not tool-call names, so a caller can never send them
// and the map has nothing to say about them. A parse that matched zero rows would make the
// set-equality cells red loudly rather than pass, but it would red for the wrong reason and send a
// reader to the map instead of to the regex, so the section's own declared row count ("## Tools (33
// rows)") is read out of the heading and compared against the rows the regex found. Document versus
// document; this file contributes no integer to that comparison.
//
// THE JOIN IS PRODUCED, NOT LITERAL. Every `renamed-to` target is checked against the live tool
// names enumerated from `AGENT_QA_TOOL_PROJECTIONS`, so a v2 tool renamed in `mapping.ts` reds here
// rather than leaving the map pointing at a name no listing will ever carry.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { AGENT_QA_TOOL_PROJECTIONS } from '../mapping.js'
import { V1_TOOL_MIGRATION_MAP } from '../migration-map.js'

const INVENTORY_PATH = fileURLToPath(new URL('../../DELETION-INVENTORY.md', import.meta.url))

/** The whole adjudication record, read at test time. */
function inventoryText(): string {
  return readFileSync(INVENTORY_PATH, 'utf8')
}

/**
 * The `## Tools` section only — from its heading to the next top-level heading.
 *
 * Scoping the slice is what keeps the prompt row and the six `agent-qa://schema/...` resource rows
 * out of the denominator: neither is a name a caller can put in a `tools/call`, so neither is a
 * member of the map's universe. The slice is produced from the document's own headings rather than
 * from a line range, which would rot the first time a paragraph moves.
 */
function toolsSection(text: string): string {
  const start = text.indexOf('\n## Tools')
  expect(start, 'the inventory has no "## Tools" section heading').toBeGreaterThan(-1)
  const rest = text.slice(start + 1)
  const end = rest.indexOf('\n## ')
  return end === -1 ? rest : rest.slice(0, end)
}

/** The count the section heading itself declares, e.g. `## Tools (33 rows)`. */
function declaredToolRowCount(section: string): number {
  const match = /^## Tools \((\d+) rows\)/mu.exec(section)
  expect(match, 'the "## Tools" heading does not declare its own row count').not.toBeNull()
  return Number(match![1])
}

/**
 * The v1 tool names, parsed out of the section's numbered table rows.
 *
 * The numbered first column is the discriminator: it is a property of the tools table and of no
 * other table in the document, so a row that is not a tool row cannot match even if the slice above
 * were ever widened by accident.
 */
function inventoryToolNames(section: string): readonly string[] {
  const rows = /^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|/gmu
  return [...section.matchAll(rows)].map((match) => match[1] as string)
}

function parsedInventoryNames(): readonly string[] {
  return inventoryToolNames(toolsSection(inventoryText()))
}

/** The live v2 tool names, enumerated from the declared projections. Never typed out here. */
function liveToolNames(): ReadonlySet<string> {
  return new Set(AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name))
}

/** A date in the one spelling this repository writes them in. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/u

/**
 * The five `n/a -> projected by 396` inventory rows whose target ops ended up UNPROJECTED after
 * 396 plan 04's fold decisions (RESEARCH assumption A4). They are named here because the
 * adjudication that they are `retired` rather than `renamed-to` is a DECISION this plan made, and a
 * decision nobody pinned is a decision the next executor gets to make differently.
 */
const A4_ADJUDICATED_ROWS: readonly string[] = [
  'agent_qa_get_config',
  'agent_qa_get_run',
  'agent_qa_get_run_steps',
  'agent_qa_get_run_logs',
  'agent_qa_get_run_execution_logs',
]

describe('the inventory parse is a real denominator', () => {
  it('finds the row count the section heading declares', () => {
    const section = toolsSection(inventoryText())
    expect(inventoryToolNames(section).length).toBe(declaredToolRowCount(section))
  })

  it('can answer "no rows" — the parse is a predicate, not a rubber stamp', () => {
    // The non-vacuity control. Without it, a regex that matched everything and a regex that matched
    // the right thing would be indistinguishable from the cells above.
    expect(inventoryToolNames('| x | `agent_qa_nope` | a | b |')).toEqual([])
    expect(inventoryToolNames('| 4 | `agent_qa_yes` | a | b |')).toEqual(['agent_qa_yes'])
  })

  it('parses no duplicate v1 name', () => {
    const names = parsedInventoryNames()
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the complete-set census (D-13), both directions', () => {
  it('covers every inventory tool row — a missing entry reds by name', () => {
    const mapped = new Set(V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name))
    const missing = parsedInventoryNames().filter((name) => !mapped.has(name))
    expect(missing, 'inventory tool rows with no migration-map entry').toEqual([])
  })

  it('carries no entry the inventory does not have — a stray reds by name', () => {
    const inventory = new Set(parsedInventoryNames())
    const stray = V1_TOOL_MIGRATION_MAP
      .map((entry) => entry.v1Name)
      .filter((name) => !inventory.has(name))
    expect(stray, 'migration-map entries with no inventory tool row').toEqual([])
  })

  it('is exactly the inventory set, as sorted lists', () => {
    // The two cells above name the offender; this one is the set equality itself, so a pair of
    // cancelling changes (one stray, one hole) cannot pass by having each direction blame the other.
    const mapped = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name).sort()
    expect(mapped).toEqual([...parsedInventoryNames()].sort())
  })

  it('declares no duplicate v1 name', () => {
    const names = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the renamed-to join resolves against the live catalogue (D-13)', () => {
  it('names only tools mapping.ts actually declares', () => {
    const live = liveToolNames()
    // Integrity: the enumeration found something, so the loop below is a refusal rather than an
    // empty channel that would pass over an emptied projection table.
    expect(live.size).toBeGreaterThan(0)
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      if (entry.arm !== 'renamed-to') continue
      expect(live.has(entry.v2Tool!), `${entry.v1Name} -> ${entry.v2Tool} is not a live tool`)
        .toBe(true)
    }
  })

  it('matches nothing for a near-miss target name', () => {
    const live = liveToolNames()
    expect(live.has('agent_qa_get_entity')).toBe(true)
    expect(live.has('agent_qa_get_entities')).toBe(false)
    expect(live.has('agent_qa_get')).toBe(false)
  })

  it('has renamed-to entries at all', () => {
    // Every cell in this block is a for-loop over a filtered set, and a filter that selects nothing
    // makes all of them pass. This is that block's denominator.
    const renamed = V1_TOOL_MIGRATION_MAP.filter((entry) => entry.arm === 'renamed-to')
    expect(renamed.length).toBeGreaterThan(0)
  })
})

describe('the arm shapes are closed (D-13)', () => {
  it('carries a v2Tool if and only if the arm is renamed-to', () => {
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      expect(entry.v2Tool !== undefined, `${entry.v1Name}: v2Tool vs arm ${entry.arm}`)
        .toBe(entry.arm === 'renamed-to')
    }
  })

  it('carries an owner if and only if the arm is pending', () => {
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      expect(entry.owner !== undefined, `${entry.v1Name}: owner vs arm ${entry.arm}`)
        .toBe(entry.arm === 'pending')
    }
  })

  it('gives every retired and pending entry the v2 route that answers the need', () => {
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      if (entry.arm === 'renamed-to') continue
      expect(entry.route ?? '', `${entry.v1Name} has no route`).not.toBe('')
      expect((entry.route ?? '').length, entry.v1Name).toBeGreaterThan(20)
    }
  })

  it('gives every entry a dated, non-empty note', () => {
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      expect(entry.note.length, entry.v1Name).toBeGreaterThan(20)
      expect(ISO_DATE.test(entry.note), `${entry.v1Name}: note carries no date`).toBe(true)
    }
  })

  it('declares exactly the three arm kinds and no fourth', () => {
    const arms = new Set(V1_TOOL_MIGRATION_MAP.map((entry) => entry.arm))
    expect([...arms].sort()).toEqual(['pending', 'renamed-to', 'retired'])
  })

  it('freezes every entry and the array', () => {
    expect(Object.isFrozen(V1_TOOL_MIGRATION_MAP)).toBe(true)
    for (const entry of V1_TOOL_MIGRATION_MAP) {
      expect(Object.isFrozen(entry), entry.v1Name).toBe(true)
    }
  })
})

describe('the A4 adjudication was made, not improvised', () => {
  it('rules each UNPROJECTED-target row retired, with a route and a dated A4 note', () => {
    const byName = new Map(V1_TOOL_MIGRATION_MAP.map((entry) => [entry.v1Name, entry]))
    for (const name of A4_ADJUDICATED_ROWS) {
      const entry = byName.get(name)
      expect(entry, `${name} is not in the map at all`).toBeDefined()
      expect(entry!.arm, name).toBe('retired')
      expect(entry!.v2Tool, name).toBeUndefined()
      expect(entry!.note, name).toContain('A4')
      expect(ISO_DATE.test(entry!.note), `${name}: A4 note carries no date`).toBe(true)
      expect((entry!.route ?? '').length, `${name} has no v2 route`).toBeGreaterThan(20)
    }
  })

  it('the five rows are inventory rows the document really carries', () => {
    // The list above is a literal, so it is checked against the parsed document rather than trusted.
    // A row renamed in the inventory must not leave this adjudication pointing at a ghost.
    const inventory = new Set(parsedInventoryNames())
    for (const name of A4_ADJUDICATED_ROWS) {
      expect(inventory.has(name), `${name} is not an inventory tool row`).toBe(true)
    }
  })
})
