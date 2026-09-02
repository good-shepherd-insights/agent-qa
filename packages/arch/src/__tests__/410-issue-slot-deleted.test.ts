/**
 * THE PHASE-410 DELETION CENSUS (D-04) — the retired sixth entity kind, and everything that
 * addressed it, is grep-clean across every workspace package's `src`, tests and comments included.
 *
 * WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 410 narrowed the entity kind
 * vocabulary from six kinds to five, and one resolution reason left with it. A set that got
 * SMALLER has a failure mode a passing suite cannot see: the removed member coming back. Nothing
 * in a green run fails when a retired kind, prefix, scheme or reason is re-added — an assertion
 * that a shape CONTAINS what it should contain is satisfied by a shape that contains more. So the
 * narrowing is pinned by cells that RED on its return, and every one of them is measured by
 * hand-mutation in `.planning/phases/410-the-bug-entity-kind/410-MUTATION-LEDGER.md`, which reads
 * the process exit code rather than arguing from a green suite.
 *
 * THIS CELL IS THE LEXICAL HALF, OVER TWO UNIVERSES. Six needles have ZERO occurrences across
 * `packages/<pkg>/src` for every workspace package — `.ts`/`.tsx`, with only `dist`,
 * `node_modules`, `.turbo` and `coverage` pruned. A seventh, the quoted status literal of the
 * roadmap's criterion 2, is scoped to the PRODUCTION subset of that same universe, built by a
 * PATH RULE — no `__tests__` path segment and no `.test.ts`/`.test.tsx` suffix — and never by
 * naming a file. As in 409, the six are scanned over TESTS AS WELL AS SOURCE, because D-04 makes
 * this phase the owner of every occurrence of its needle set in the package trees, not only the
 * production ones. COMMENTS COUNT. A retirement note that spells a retired token is a hit exactly
 * like a live reference is, because the promise is "this string is not in the tree", not "no code
 * reads it" — which is why D-07 has the surviving prose state the surviving rule and name the
 * CONCEPT rather than the token.
 *
 * WHY THE KIND NEEDLE IS A REGEX AND NOT A SUBSTRING. A bare word-bounded match is case-sensitive
 * so lower-case debug words never match and the upper-case debugging token has no word boundary
 * before its last three letters — which is exactly what a plain substring match cannot express,
 * and why the kind needle alone is a `RegExp`. One residue survives that: three English uppercase
 * spellings measured in files outside this phase, two after `CALLER ` and one after `A `. A
 * negative lookbehind for those two prefixes excludes them, and the negative-control cell below
 * pins that behaviour so the lookbehind can neither silently widen nor silently swallow a real
 * occurrence.
 *
 * THIS FILE CANNOT MATCH ITSELF. Every needle is assembled at run time from two halves, so the
 * whole token is never spelled in this source. Because the census scans tests, this file sits
 * inside its own universe: a needle spelled literally here would RED the very cell that spells it,
 * and the two-half construction is load-bearing rather than decorative. The last cell below asserts
 * that property over this file's own bytes. Convention lifted verbatim from
 * `packages/arch/src/__tests__/409-issue-slot-deleted.test.ts` (D-10/D-14, phase 409), which this
 * file sits beside and does not edit — 409 D-14 reserves in-place widening for Phase 412.
 *
 * PHASE 412 (CLSR-01) WIDENS THIS NEEDLE SET IN PLACE. Every needle added there needs its own
 * two-half entry here and its own planted-positive leg in the ledger.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const THIS_FILE = fileURLToPath(import.meta.url)
/** `packages/arch/src/__tests__` -> `packages`. */
const PACKAGES_DIR = join(HERE, '..', '..', '..')

// ---------------------------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------------------------

/**
 * The kind needle (see the header for why it is not a substring). No `g` flag, so `.test` is
 * stateless and one call per line cannot carry `lastIndex` into the next.
 */
const KIND_NEEDLE = new RegExp('(?<!CALLER |A )\\bB' + 'UG\\b')

/**
 * The D-04 needle set, in CONTEXT.md's order: the retired entity kind itself, the short-ID prefix
 * that addressed it, its URI scheme, the resolution reason that named it, the error the ledger
 * raised when asked to mint into it, and the dashboard fixture that rendered it.
 *
 * Every needle is built from two halves so this file cannot satisfy its own inventory, and each
 * split is chosen so NEITHER half spells the three-letter kind token: the phase's own acceptance
 * grep over this file is a bare substring match, so the fixture needle splits before its last
 * five characters rather than at the underscore.
 */
const FORBIDDEN: { label: string; needle: string | RegExp }[] = [
  { label: 'the retired entity kind', needle: KIND_NEEDLE },
  { label: 'the retired short-ID prefix', needle: 'B' + 'UG-' },
  { label: 'the retired URI scheme', needle: 'agentqa://' + 'bug' },
  { label: 'the retired resolution reason', needle: 'reserved-' + 'kind' },
  { label: 'the retired mint refusal', needle: 'BugAddressing' + 'NotAvailable' },
  { label: 'the retired dashboard fixture', needle: 'BU' + 'G_CARD' },
]

/**
 * The roadmap's criterion-2 needle, scoped to production sources only. The quote characters are
 * part of it: the bare word survives legitimately in English prose and in a dated retirement note,
 * and only the QUOTED literal was the retired status value.
 */
const PRODUCTION_ONLY_FORBIDDEN: { label: string; needle: string | RegExp }[] = [
  { label: 'the retired status literal', needle: "'reser" + "ved'" },
]

/**
 * Only build output and dependency trees are pruned. There is no test exclusion here and there is
 * none by filename either — that is the one deliberate difference from the 405 census (D-14).
 */
const SCAN_EXCLUDED_DIRS = new Set(['dist', 'node_modules', '.turbo', 'coverage'])

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SCAN_EXCLUDED_DIRS.has(entry.name)) continue
      collectSourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    out.push(full)
  }
}

/** The packages that HAVE a `src` directory, discovered from disk — never a pinned list. */
function discoverSourceRoots(): Array<{ pkg: string; dir: string }> {
  const roots: Array<{ pkg: string; dir: string }> = []
  for (const pkg of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, pkg, 'src')
    try {
      if (statSync(dir).isDirectory()) roots.push({ pkg, dir })
    } catch {
      /* a package without src contributes nothing */
    }
  }
  return roots
}

function scanFileUniverse(): string[] {
  const files: string[] = []
  for (const root of discoverSourceRoots()) collectSourceFiles(root.dir, files)
  return files
}

interface Hit {
  file: string
  line: number
  text: string
}

/** The extractor. Reads raw text: a token in a comment is a hit, by design (see the header). */
function findNeedle(needle: string | RegExp, source: string, label: string): Hit[] {
  const hits: Hit[] = []
  source.split('\n').forEach((text, index) => {
    const matched = needle instanceof RegExp ? needle.test(text) : text.includes(needle)
    if (matched) hits.push({ file: label, line: index + 1, text: text.trim() })
  })
  return hits
}

const SOURCES = scanFileUniverse()

/**
 * The second universe, derived by PATH RULE and never by name (D-04): a production source is a
 * scanned file outside any `__tests__` directory that does not carry a `.test` suffix. Ledger
 * Row 8 measures that this scope really is a path rule, by planting the same line on both sides.
 */
const PRODUCTION_SOURCES = SOURCES.filter(
  (f) => !f.includes(`${sep}__tests__${sep}`) && !/\.test\.tsx?$/.test(f),
)

describe('the 410 needle set is gone from every package src, tests included (D-04)', () => {
  // The universe control. A resolution bug that silently narrowed either scan would report the
  // same clean zero as a clean tree — 401-10's self-certifying guard, in inventory form.
  it('scans every package that has a src directory, and a non-trivial number of files', () => {
    const roots = discoverSourceRoots()
    expect(roots.length).toBeGreaterThan(5)

    const packagesSeen = new Set(SOURCES.map((f) => relative(PACKAGES_DIR, f).split(sep)[0]))
    const missing = roots.map((r) => r.pkg).filter((pkg) => !packagesSeen.has(pkg))
    expect(
      missing,
      `packages with src/ that contributed no scanned file: ${missing.join(', ')}`,
    ).toEqual([])

    for (const root of roots) {
      const forThisPackage = SOURCES.filter(
        (f) => relative(PACKAGES_DIR, f).split(sep)[0] === root.pkg,
      )
      expect(forThisPackage.length, `${root.pkg} contributed no scanned file`).toBeGreaterThan(0)
    }

    expect(SOURCES.length).toBeGreaterThan(500)
    // The second universe is proven non-empty and a STRICT subset, so a path rule that matched
    // everything (or nothing) cannot pass the production-only cell for the wrong reason.
    expect(PRODUCTION_SOURCES.length).toBeGreaterThan(800)
    expect(PRODUCTION_SOURCES.length).toBeLessThan(SOURCES.length)
  })

  // The known-positive control. Every needle is planted in a synthetic source and must be found —
  // otherwise a typo'd needle reports zero hits forever and the census measures nothing. The
  // RegExp entry is planted from halves too, so the whole token exists only in memory.
  it('finds every planted needle — the known-positive control for the extractor', () => {
    for (const { label, needle } of [...FORBIDDEN, ...PRODUCTION_ONLY_FORBIDDEN]) {
      const body =
        needle instanceof RegExp
          ? 'const planted = ' + "'" + 'B' + 'UG' + "'"
          : `const planted = '${needle}'`
      const planted = ['const untouched = 1', body, '// tail'].join('\n')
      const hits = findNeedle(needle, planted, 'synthetic/planted.ts')
      expect(hits.length, `the extractor could not find the planted ${label}`).toBe(1)
      expect(hits[0]?.line).toBe(2)
    }
  })

  // The negative control for the lookbehind. Without it the kind cell would RED on ordinary
  // English in packages this phase does not own; with it too wide, a real occurrence after those
  // words would hide. Both directions are asserted by one planted trio.
  it('keeps the two English collocations out — the negative control for the kind needle', () => {
    const token = 'B' + 'UG'
    const planted = [`// CALLER ${token} that`, `// WAS A ${token} here`, `// the ${token} kind`]
    const hits = findNeedle(KIND_NEEDLE, planted.join('\n'), 'synthetic/collocations.ts')
    expect(
      hits.map((hit) => hit.line),
      `the lookbehind admitted an English collocation, or dropped a real hit: ${JSON.stringify(hits)}`,
    ).toEqual([3])
  })

  // The extractor reads COMMENTS too. Stated as its own cell because it is the property 404-02 was
  // sent back for, and a property nobody asserts is a property that drifts the first time somebody
  // "helpfully" strips comments before scanning.
  it('counts a needle inside a comment as a hit', () => {
    const { needle } = FORBIDDEN[1] as { needle: string }
    const commented = `// a retirement note naming ${needle} in prose`
    expect(findNeedle(needle, commented, 'synthetic/commented.ts')).toHaveLength(1)
  })

  for (const { label, needle } of FORBIDDEN) {
    it(`no source or test spells ${label}`, () => {
      const hits: string[] = []
      for (const file of SOURCES) {
        const rel = relative(PACKAGES_DIR, file).split(sep).join('/')
        for (const hit of findNeedle(needle, readFileSync(file, 'utf8'), rel)) {
          hits.push(`${hit.file}:${hit.line}: ${hit.text}`)
        }
      }
      expect(
        hits,
        `a retired 410 token reappeared in the shipped tree (D-04):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  for (const { label, needle } of PRODUCTION_ONLY_FORBIDDEN) {
    it(`no production source spells ${label}`, () => {
      const hits: string[] = []
      for (const file of PRODUCTION_SOURCES) {
        const rel = relative(PACKAGES_DIR, file).split(sep).join('/')
        for (const hit of findNeedle(needle, readFileSync(file, 'utf8'), rel)) {
          hits.push(`${hit.file}:${hit.line}: ${hit.text}`)
        }
      }
      expect(
        hits,
        `a retired 410 status literal reappeared in production source (D-04):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  // A cell that cannot match itself. This file IS inside the scanned universe, so a needle spelled
  // here would already have reddened a cell above — this one names the cause instead of leaving
  // the reader to work out why the census is accusing its own source.
  it('spells none of its own needles — the inventory cannot be satisfied by this file', () => {
    const own = readFileSync(THIS_FILE, 'utf8')
    const selfHits = [...FORBIDDEN, ...PRODUCTION_ONLY_FORBIDDEN]
      .filter(({ needle }) => (needle instanceof RegExp ? needle.test(own) : own.includes(needle)))
      .map((entry) => entry.label)
    expect(
      selfHits,
      `this cell spells a needle it forbids; build it from two halves: ${selfHits.join(', ')}`,
    ).toEqual([])
  })
})
