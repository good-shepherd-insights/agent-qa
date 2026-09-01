/**
 * THE PHASE-409 DELETION CENSUS (D-10, D-14) — the retired job-kind and type vocabulary is
 * grep-clean across every workspace package's `src`, tests and comments included.
 *
 * WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 409 narrowed five closed sets:
 * the shipped job kinds (six to five), the analyze-run successor constants (two to one), the
 * derived post-run chain ids (three to two), the delta vocabularies (two to one) and the record-id
 * brands (three to two). Every one of those is a set that got SMALLER, and a set that got smaller
 * has a failure mode a passing suite cannot see: the removed member coming back. Nothing in a green
 * run fails when a retired kind, id or brand is re-added — an assertion that a shape CONTAINS what
 * it should contain is satisfied by a shape that contains more. So each narrowing is pinned by a
 * cell that REDs on its return, and every one of those cells is measured by hand-mutation in
 * `.planning/phases/409-the-job-kind-layer-the-type-vocabulary/409-MUTATION-LEDGER.md`, which reads
 * the process exit code rather than arguing from a green suite.
 *
 * THIS CELL IS THE LEXICAL HALF. Every needle in the D-10 set has ZERO occurrences across
 * `packages/<pkg>/src` for every workspace package — `.ts`/`.tsx`, with only `dist`,
 * `node_modules`, `.turbo` and `coverage` pruned. Unlike the 405 census this one scans TESTS AS
 * WELL AS SOURCE, because D-10 makes this phase the owner of every occurrence of its needle set in
 * the package trees, not only the production ones. COMMENTS COUNT. A retirement note that spells a
 * retired token is a hit exactly like a live reference is, because the promise is "this string is
 * not in the tree", not "no code reads it" — which is why D-09 has the surviving prose state the
 * surviving rule and name the CONCEPT rather than the token.
 *
 * THIS FILE CANNOT MATCH ITSELF. Every needle is assembled at run time from two halves, so the
 * whole token is never spelled in this source. Because the census scans tests, this file sits
 * inside its own universe: a needle spelled literally here would RED the very cell that spells it,
 * and the two-half construction is load-bearing rather than decorative. The last cell below asserts
 * that property over this file's own bytes. Convention lifted verbatim from
 * `packages/dashboard-server/src/__tests__/405-debris-deleted.test.ts` (D-21, phase 405).
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
 * The D-10 needle set, in CONTEXT.md's order: the reserved sixth job kind and the two names that
 * addressed it, the produced-successors half of the 388 D-04 split, the never-imported chain-kinds
 * list, and the delta/id vocabulary VOCB-01..03 retired.
 *
 * Matching is plain `String.prototype.includes` over raw utf8 text, so an identifier, a string
 * literal and a comment are all the same kind of hit and no word boundary can hide one. Two
 * substring notes, both deliberate: `POST_RUN_CHAIN_TERMINAL_KINDS` — the one membership list this
 * phase RETAINED — does not contain the fifth needle as a substring, so the retained name is not a
 * false positive; and Zod's `error.issues` matches none of the nine.
 */
const FORBIDDEN: { label: string; needle: string }[] = [
  { label: 'the reserved sixth job kind', needle: 'triage-' + 'issues' },
  { label: 'the third chain id key', needle: 'triage' + 'Issues' },
  { label: "the reserved kind's checkpoint id", needle: 'issues-' + 'drafted' },
  { label: 'the produced-successors constant', needle: 'ANALYZE_RUN_PRODUCED_' + 'SUCCESSORS' },
  { label: 'the never-imported chain-kinds list', needle: 'POST_RUN_CHAIN_' + 'KINDS' },
  { label: 'the second delta vocabulary', needle: 'Issue' + 'Delta' },
  { label: 'the third id brand', needle: 'Issue' + 'Id' },
  { label: "the third id brand's cast helper", needle: 'asIssue' + 'Id' },
  { label: "the second delta vocabulary's module", needle: 'issue-' + 'delta' },
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
function findNeedle(needle: string, source: string, label: string): Hit[] {
  const hits: Hit[] = []
  source.split('\n').forEach((text, index) => {
    if (text.includes(needle)) hits.push({ file: label, line: index + 1, text: text.trim() })
  })
  return hits
}

const SOURCES = scanFileUniverse()

describe('the D-10 needle set is gone from every package src, tests included (D-14)', () => {
  // The universe control. A resolution bug that silently narrowed the scan would report the same
  // clean zero as a clean tree — 401-10's self-certifying guard, in inventory form.
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
  })

  // The known-positive control. Every needle is planted in a synthetic source and must be found —
  // otherwise a typo'd needle reports zero hits forever and the census measures nothing.
  it('finds every planted needle — the known-positive control for the extractor', () => {
    for (const { label, needle } of FORBIDDEN) {
      const planted = ['const untouched = 1', `const planted = '${needle}'`, '// tail'].join('\n')
      const hits = findNeedle(needle, planted, 'synthetic/planted.ts')
      expect(hits.length, `the extractor could not find the planted ${label}`).toBe(1)
      expect(hits[0]?.line).toBe(2)
    }
  })

  // The extractor reads COMMENTS too. Stated as its own cell because it is the property 404-02 was
  // sent back for, and a property nobody asserts is a property that drifts the first time somebody
  // "helpfully" strips comments before scanning.
  it('counts a needle inside a comment as a hit', () => {
    const { needle } = FORBIDDEN[0] as { needle: string }
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
        `a retired 409 token reappeared in the shipped tree (D-10/D-14):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  // A cell that cannot match itself. This file IS inside the scanned universe, so a needle spelled
  // here would already have reddened the cell above — this one names the cause instead of leaving
  // the reader to work out why the census is accusing its own source.
  it('spells none of its own needles — the inventory cannot be satisfied by this file', () => {
    const own = readFileSync(THIS_FILE, 'utf8')
    const selfHits = FORBIDDEN.filter(({ needle }) => own.includes(needle)).map((f) => f.label)
    expect(
      selfHits,
      `this cell spells a needle it forbids; build it from two halves: ${selfHits.join(', ')}`,
    ).toEqual([])
  })
})
