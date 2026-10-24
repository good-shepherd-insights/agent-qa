/**
 * THE STANDALONE KNOWLEDGE EXPLORER ABSENCE CENSUS (PXH-UAT-03; 433 D-22, UI-011) — the dashboard UI
 * carries no standalone Memory or Knowledge explorer: no route, no navigation URL, no palette entry
 * and no explorer page or component, comments included.
 *
 * WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. The milestone ships knowledge inside a
 * run, never as a separate browsing surface. Until this file, that absence was only implied: the
 * sidebar and palette pins list what IS there, and a router table that grew one more child, a nav
 * item pointing at a new page or a palette entry for one would leave every one of those suites green
 * as long as the pinned items were still present. So each spelling an explorer would need has a
 * cell here that REDs by name on its arrival, printing the file and line that brought it.
 *
 * THE UNIVERSE, BY PATH RULE. Every `.ts`/`.tsx` under the dashboard UI's `src`, with the production
 * subset split off by the 412 path rule (no `__tests__` path segment and no `.test` or `.test-d`
 * suffix) and never by naming a file. Tests are out of scope on purpose: a routed-ref fixture and
 * the fall-through cells legitimately spell explorer-shaped paths to prove they lead nowhere. The
 * root is declared as a URL beside this file plus a literal directory string, the shape the mutation
 * engine's arrival proof can follow, so a planted return in any production file under it provably
 * reaches this census. A non-vacuity cell pins that the universe is large and holds the router, the
 * sidebar and the palette, so the census cannot pass by scanning nothing.
 *
 * COMMENTS COUNT. Needles match the raw source text, line by line, as decoded UTF-8, with a plain
 * substring test. No tokenizer, syntax tree or comment stripper stands between the tree and the
 * verdict: a note that spells an explorer route is a hit exactly like a live one. Surviving prose
 * names the CONCEPT, never the spelling. The planted-positive cell plants every needle in a comment
 * as well as in code.
 *
 * WHY THE NEEDLES ARE COMPOUNDS. The bare words are everywhere in this UI, legitimately: the run's
 * Knowledge tab, the knowledge config section, feedback marks that fix knowledge, the memory shortcut
 * on the run navbar. Each needle is a compound whose count at rest was measured as zero, in two
 * families. Name needles (page test ids, route-map members, page and explorer component names) match
 * case-sensitively. Route and URL needles (a quote or backtick opening onto a slash and the stem, and
 * a router child path opening onto the stem) match the lower-cased line, so every case spelling of a
 * path is one needle, and their stems are cut short so plural, trailing-slash, hyphenated and
 * sub-path spellings fall inside them.
 *
 * THE KEPT NAMES ARE A POSITIVE CONTROL, NEVER A FILTER. The run-scoped Knowledge tab and knowledge
 * rendered elsewhere stay allowed (note 6). Its tab value, its tab-content component and its per-run
 * read are excluded from nothing. One cell asserts BY NAME that each is present at rest in the
 * production file that owns it, and another that no needle is a substring of any of them, so no
 * needle was ever narrowed around a kept name and none will accuse one.
 *
 * THIS FILE CANNOT MATCH ITSELF. Every needle is assembled at run time from two halves, and each
 * split is chosen so that neither half is a needle, so no whole needle is spelled in this source —
 * the header and the labels included, which is why they name concepts and never spellings. The last
 * cell asserts the property over this file's own bytes, with each family's own matching rule.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGES = new URL('../../../', import.meta.url)
const THIS_FILE = fileURLToPath(import.meta.url)

const UI_ROOT = 'dashboard-ui/src/'

type Family = 'name' | 'route'

interface NeedleEntry {
  readonly label: string
  readonly halves: readonly [string, string]
  readonly family: Family
}

const joined = (entry: NeedleEntry): string => entry.halves[0] + entry.halves[1]

// ---------------------------------------------------------------------------------------------
// The inventory
// ---------------------------------------------------------------------------------------------

/** Explorer page and component names, matched case-sensitively. */
const NAME_NEEDLES: NeedleEntry[] = [
  { label: 'the knowledge page test id, prefix form', halves: ['page-', 'Knowledge'], family: 'name' },
  { label: 'the memory page test id, prefix form', halves: ['page-', 'Memory'], family: 'name' },
  { label: 'the knowledge page test id, suffix form', halves: ['knowledge-', 'page'], family: 'name' },
  { label: 'the memory page test id, suffix form', halves: ['memory-', 'page'], family: 'name' },
  { label: 'the route-map member for memory', halves: ['routes.', 'memor'], family: 'name' },
  { label: 'the route-map member for knowledge', halves: ['routes.', 'knowledge'], family: 'name' },
  { label: 'the memory page component', halves: ['Memory', 'Page'], family: 'name' },
  { label: 'the knowledge page component', halves: ['Knowledge', 'Page'], family: 'name' },
  { label: 'the memory explorer component', halves: ['Memory', 'Explorer'], family: 'name' },
  { label: 'the knowledge explorer component', halves: ['Knowledge', 'Explorer'], family: 'name' },
]

/** Route and URL literals, matched against the lower-cased line; every needle is lower case. */
const ROUTE_NEEDLES: NeedleEntry[] = [
  { label: 'a double-quoted memory URL', halves: ['"/me', 'mor'], family: 'route' },
  { label: 'a single-quoted memory URL', halves: ["'/me", 'mor'], family: 'route' },
  { label: 'a template-literal memory URL', halves: ['`/me', 'mor'], family: 'route' },
  { label: 'a double-quoted knowledge URL', halves: ['"/know', 'ledge'], family: 'route' },
  { label: 'a single-quoted knowledge URL', halves: ["'/know", 'ledge'], family: 'route' },
  { label: 'a template-literal knowledge URL', halves: ['`/know', 'ledge'], family: 'route' },
  { label: 'a double-quoted memory router path', halves: ['path: "', 'memor'], family: 'route' },
  { label: 'a single-quoted memory router path', halves: ["path: '", 'memor'], family: 'route' },
  { label: 'a double-quoted knowledge router path', halves: ['path: "', 'knowledge'], family: 'route' },
  { label: 'a single-quoted knowledge router path', halves: ["path: '", 'knowledge'], family: 'route' },
]

const EVERY_NEEDLE: NeedleEntry[] = [...NAME_NEEDLES, ...ROUTE_NEEDLES]

/** The run-scoped Knowledge tab's names (note 6), each with the production file that owns it. */
const KEPT: ReadonlyArray<readonly [name: string, file: string, what: string]> = [
  ['value="knowledge"', 'dashboard-ui/src/components/run-detail/tab-panels.tsx', 'the tab value'],
  ['TabKnowledge', 'dashboard-ui/src/components/run-detail/tab-knowledge.tsx', 'the tab-content component'],
  ['/api/runs/${encodeURIComponent(id)}/knowledge`', 'dashboard-ui/src/lib/api.ts', 'the per-run read'],
]

// ---------------------------------------------------------------------------------------------
// The universe
// ---------------------------------------------------------------------------------------------

/** Every `.ts`/`.tsx` under a root, tests included, as a path relative to `packages/`. */
function listTree(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, PACKAGES), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (/\.tsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

const UI_PRODUCTION = listTree(UI_ROOT).filter(isProduction)

const read = (file: string): string => readFileSync(new URL(file, PACKAGES), 'utf8')

interface Hit {
  file: string
  line: number
  text: string
}

/** The extractor. Raw text, line by line: a needle in a comment is a hit, by design. */
function findNeedle(entry: NeedleEntry, source: string, file: string): Hit[] {
  const needle = joined(entry)
  const hits: Hit[] = []
  source.split('\n').forEach((text, index) => {
    const haystack = entry.family === 'route' ? text.toLowerCase() : text
    if (haystack.includes(needle)) hits.push({ file, line: index + 1, text: text.trim() })
  })
  return hits
}

function census(entry: NeedleEntry): string[] {
  return UI_PRODUCTION.flatMap((file) =>
    findNeedle(entry, read(file), file).map((hit) => `${hit.file}:${hit.line}: ${hit.text}`),
  )
}

describe('no standalone Memory or Knowledge explorer exists in the dashboard UI (PXH-UAT-03, D-22, UI-011)', () => {
  // A lower bound, not a pinned total: the tree grows. Measured at rest on 2026-10-04: 532 UI files,
  // 298 of them production.
  it('C433-EXPLORER-UNIVERSE-NONEMPTY: the production universe is large and holds the router, the sidebar and the palette', () => {
    expect(UI_PRODUCTION.length, `the production universe: ${UI_PRODUCTION.length} files`).toBeGreaterThan(50)
    for (const file of [
      'dashboard-ui/src/app.tsx',
      'dashboard-ui/src/components/app-sidebar.tsx',
      'dashboard-ui/src/components/command-palette.tsx',
    ]) {
      expect(UI_PRODUCTION, `${file} left the scanned universe`).toContain(file)
    }
  })

  // The known-positive control. A typo'd needle would report zero hits forever and the census would
  // measure nothing, so every needle is planted in code and in a comment and must be found. A route
  // needle must be found in every case spelling, and a name needle only in its own.
  it('C433-EXPLORER-PLANTED-POSITIVE: finds every planted needle, in code and in comments, by its family rule', () => {
    const labels = EVERY_NEEDLE.map((entry) => entry.label)
    expect(new Set(labels).size, 'two needles share a label, so two cells would share a title').toBe(labels.length)
    expect(NAME_NEEDLES.length).toBeGreaterThanOrEqual(6)
    expect(ROUTE_NEEDLES.length).toBeGreaterThanOrEqual(6)
    for (const entry of EVERY_NEEDLE) {
      const needle = joined(entry)
      expect(entry.halves.every((half) => half.length > 0), `${entry.label} has an empty half`).toBe(true)
      const spellings =
        entry.family === 'route'
          ? [
              needle,
              needle.toUpperCase(),
              needle.replace(/(["'`/])([a-z])/, (_, mark: string, letter: string) => mark + letter.toUpperCase()),
            ]
          : [needle]
      if (entry.family === 'route') {
        expect(needle, `${entry.label} must be lower case to match a lower-cased line`).toBe(needle.toLowerCase())
      }
      for (const spelling of spellings) {
        const planted = ['const untouched = 1', `const planted = ${spelling}`, `// a note naming ${spelling}`].join('\n')
        const hits = findNeedle(entry, planted, 'synthetic/planted.ts')
        expect(hits.map((hit) => hit.line), `the extractor missed ${entry.label} spelled ${spelling}`).toEqual([2, 3])
      }
      if (entry.family === 'name' && needle.toUpperCase() !== needle) {
        expect(findNeedle(entry, needle.toUpperCase(), 'synthetic/upper.ts'), `${entry.label} matched across case`).toEqual([])
      }
    }
  })

  it('C433-EXPLORER-KEPT-NAMES-PRESENT: the run-scoped Knowledge tab is present at rest in the production file that owns each name', () => {
    const absent = KEPT.filter(([name, file]) => !UI_PRODUCTION.includes(file) || !read(file).includes(name)).map(
      ([name, file, what]) => `${what} (${name} in ${file})`,
    )
    expect(absent, `a kept Knowledge tab name vanished; note 6's list must be revised by name: ${absent.join(', ')}`).toEqual([])
  })

  it('C433-EXPLORER-NEEDLE-NOT-IN-KEPT: no needle is a substring of any kept name, by its family rule', () => {
    const overlaps = EVERY_NEEDLE.flatMap((entry) =>
      KEPT.filter(([name]) => findNeedle(entry, name, 'kept').length > 0).map(([name]) => `${entry.label} in ${name}`),
    )
    expect(overlaps, `a needle would accuse a kept name: ${overlaps.join(', ')}`).toEqual([])
  })

  for (const entry of EVERY_NEEDLE) {
    it(`C433-EXPLORER-ABSENT: no production source spells ${entry.label}`, () => {
      const hits = census(entry)
      expect(hits, `a standalone explorer spelling arrived (${entry.family}):\n${hits.join('\n')}`).toEqual([])
    })
  }

  // This file is outside the universe, but a whole spelling here would still be an inventory
  // satisfying itself the moment a later phase widened the root to cover it.
  it('C433-EXPLORER-SELF-MATCH: spells none of its own needles, by each family rule', () => {
    const own = readFileSync(THIS_FILE, 'utf8')
    const selfHits = EVERY_NEEDLE.filter((entry) => findNeedle(entry, own, THIS_FILE).length > 0).map(
      (entry) => entry.label,
    )
    expect(selfHits, `this file spells a needle it forbids; build it from two halves: ${selfHits.join(', ')}`).toEqual([])
  })
})
