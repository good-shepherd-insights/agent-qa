/**
 * THE PHASE-411 DELETION CENSUS (D-14) — the retired proposal arm, and the route it hung on, are
 * grep-clean across every workspace package's `src`, tests and comments included.
 *
 * WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 411 narrowed the proposal kind
 * vocabulary from four kinds to three, re-spelled the router's second post-verify route, and turned
 * the loop's app-broken branch into an outcome that writes no envelope at all. A set that got
 * SMALLER has a failure mode a passing suite cannot see: the removed member coming back. Nothing in
 * a green run fails when a retired kind, schema, interface, helper or digest string is re-added —
 * an assertion that a shape CONTAINS what it should contain is satisfied by a shape that contains
 * more. So the narrowing is pinned by cells that RED on its return, and every one of them is
 * measured by hand-mutation in
 * `.planning/phases/411-write-test-s-app-broken-branch-report-the-verdict-and-stop/411-MUTATION-LEDGER.md`,
 * which reads the process exit code rather than arguing from a green suite.
 *
 * THIS CELL IS THE LEXICAL HALF, OVER TWO UNIVERSES. Thirteen needles have ZERO occurrences across
 * `packages/<pkg>/src` for every workspace package — `.ts`/`.tsx`, with only `dist`,
 * `node_modules`, `.turbo` and `coverage` pruned. Two more, the side-counter access and its object
 * key, are scoped to the FUNNEL subset of that same universe, built by a PATH RULE — a file under
 * `src/authoring/` (with or without a `__tests__` segment) whose basename opens with the funnel
 * stem, or a funnel op's cell under `src/functions/__tests__/` — and NEVER by naming a file. The
 * scope has to be a rule rather than a list because the same two words survive legitimately in the
 * CLI's config-scan report, in the safety guardrail, in the conformance corpus and in the runner's
 * legacy-retirement cell; a global needle would RED on twenty homonyms that this phase does not
 * own. As in 409 and 410, the thirteen are scanned over TESTS AS WELL AS SOURCE, because D-02 makes
 * this phase the owner of every occurrence of its needle set in the package trees, not only the
 * production ones. COMMENTS COUNT. A retirement note that spells a retired token is a hit exactly
 * like a live reference is, because the promise is "this string is not in the tree", not "no code
 * reads it" — which is why D-09 has the surviving prose state the surviving rule and name the
 * CONCEPT rather than the token. The English word itself is not a needle (D-02): the spec keeps it,
 * and only identifier-shaped and quoted spellings are retired.
 *
 * THIS FILE CANNOT MATCH ITSELF. Every needle is assembled at run time from two halves, so the
 * whole token is never spelled in this source. Because the census scans tests, this file sits
 * inside its own universe: a needle spelled literally here would RED the very cell that spells it,
 * and the two-half construction is load-bearing rather than decorative. The last cell below asserts
 * that property over this file's own bytes. Convention lifted verbatim from
 * `packages/arch/src/__tests__/410-issue-slot-deleted.test.ts` (D-14, phase 410) and its own
 * predecessor in 409, which this file sits beside and does NOT edit — 409 D-14 reserves in-place
 * widening for Phase 412.
 *
 * PHASE 412 (CLSR-01) WIDENS OR MERGES THIS NEEDLE SET IN PLACE. Every needle added there needs its
 * own two-half entry here and its own planted-positive leg in the ledger.
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

/** One inventory entry: the concept the census names, and the token it refuses. */
interface NeedleEntry {
  readonly label: string
  readonly needle: string
}

/**
 * The D-02 needle set, in CONTEXT.md's order: the retired proposal kind as a quoted literal, its
 * payload schema family, the retired route interface and its failure-point schema, the router's
 * signal-class type, the two route/loop helper stems, the evidence helper, the corpus expectation
 * key, the router entry point, the accept-side route table key, the digest headline fragment, and
 * the cell-title stem the mutation scripts matched on.
 *
 * Every needle is built from two halves so this file cannot satisfy its own inventory, and each
 * split is chosen so NEITHER half is itself a needle: the quoted-literal needle is the shortest
 * one, so any split that leaves a bare `'` + the whole word in one half would be self-matching, and
 * the splits below therefore cut INSIDE the word rather than at a boundary.
 *
 * All fifteen entries are plain substrings, matched case-sensitively. No `RegExp` is needed this
 * phase: the retired spellings are identifier-shaped or quoted, so the English homonyms 410 had to
 * exclude with a lookbehind cannot collide with them.
 */
const FORBIDDEN: NeedleEntry[] = [
  { label: 'the retired proposal kind literal', needle: "'find" + "ing'" },
  { label: 'the retired proposal schema family', needle: 'FindingPro' + 'posal' },
  { label: 'the retired route interface', needle: 'Finding' + 'Route' },
  { label: 'the retired failure-point schema', needle: 'FindingFailure' + 'Point' },
  { label: 'the retired router signal-class type', needle: 'RouterFinding' + 'SignalClass' },
  { label: 'the retired route helper stem', needle: 'find' + 'ingRoute' },
  { label: 'the retired loop carrier', needle: 'find' + 'ingProposal' },
  { label: 'the retired evidence helper', needle: 'findingEvidence' + 'For' },
  { label: 'the retired corpus key', needle: 'findingDirection' + 'Rows' },
  { label: 'the retired router entry point', needle: 'routeRepairOr' + 'Finding' },
  { label: 'the retired accept route key', needle: 'ROUTE_FOR_KIND.f' + 'inding' },
  { label: 'the retired digest line', needle: 'find' + 'ing on ' },
  { label: 'the retired cell-title stem', needle: 'finding-' + 'branch' },
]

/**
 * The side-counter needles, scoped to the funnel subset by the path rule below. The two words are
 * ordinary English everywhere else in the tree — the CLI's config-scan report, the safety
 * guardrail, the conformance corpus, the runner's legacy-retirement cell — and only the funnel's
 * counter was retired, so a global scan here would accuse files this phase does not own.
 */
const FUNNEL_SCOPED_FORBIDDEN: NeedleEntry[] = [
  { label: 'the retired side-counter access', needle: 'sideCounters.' + 'findings' },
  { label: 'the retired side-counter key', needle: 'findings' + ':' },
]

/**
 * Only build output and dependency trees are pruned. There is no test exclusion here and there is
 * none by filename either — that is the one deliberate difference from the 405 census (D-02).
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

/**
 * The second universe, derived by PATH RULE and never by name (D-14). Both producers, both of the
 * schema producer's cells, the agent projection's cell and the funnel op's cell are admitted; the
 * homonym files are refused because they do not sit on either path. The pure-rule cell below pins
 * both directions so the scope can neither silently widen to the homonyms nor silently drop a
 * producer.
 */
const FUNNEL_RULE = /\/src\/(authoring\/(__tests__\/)?funnel|functions\/__tests__\/authoring-funnel)[^/]*\.tsx?$/

const FUNNEL_SOURCES = SOURCES.filter((f) => FUNNEL_RULE.test(f.split(sep).join('/')))

describe('the 411 needle set is gone from every package src, tests included (D-14)', () => {
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
    // everything (or nothing) cannot pass the scoped cells for the wrong reason. Both producers
    // must be in it by relative path — that is the only place a file is named in this census.
    const funnelRelative = FUNNEL_SOURCES.map((f) => relative(PACKAGES_DIR, f).split(sep).join('/'))
    expect(FUNNEL_SOURCES.length, `the funnel universe: ${funnelRelative.join(', ')}`)
      .toBeGreaterThanOrEqual(5)
    expect(FUNNEL_SOURCES.length).toBeLessThan(SOURCES.length)
    expect(funnelRelative).toContain('schema/src/authoring/funnel.ts')
    expect(funnelRelative).toContain('agent/src/authoring/funnel.ts')
  })

  // The scope is a RULE, asserted against synthetic paths so it holds whether or not the tree
  // currently contains any of them. Both directions: the producers and their cells are admitted,
  // and the three homonym families this phase does not own are refused.
  it('the funnel scope is a path rule — it admits both producers and their tests and refuses the config-scan homonym', () => {
    const admitted = [
      'packages/schema/src/authoring/funnel.ts',
      'packages/agent/src/authoring/funnel.ts',
      'packages/schema/src/authoring/__tests__/funnel.test-d.ts',
      'packages/agent/src/authoring/__tests__/funnel-projection.test.ts',
      'packages/agent/src/functions/__tests__/authoring-funnel-get.test.ts',
    ]
    const refused = [
      'packages/cli/src/commands/proposals.ts',
      'packages/safety/src/guardrail/construction-scan.ts',
      'packages/runner/src/loop/__tests__/legacy-retirement.test.ts',
    ]
    expect(
      admitted.filter((p) => !FUNNEL_RULE.test(p)),
      'the path rule dropped a funnel file',
    ).toEqual([])
    expect(
      refused.filter((p) => FUNNEL_RULE.test(p)),
      'the path rule admitted a homonym file',
    ).toEqual([])
  })

  // The known-positive control. Every needle is planted in a synthetic source and must be found —
  // otherwise a typo'd needle reports zero hits forever and the census measures nothing. The
  // quoted-literal entry is planted by concatenation, so the whole token exists only in memory.
  it('finds every planted needle — the known-positive control for the extractor', () => {
    for (const { label, needle } of [...FORBIDDEN, ...FUNNEL_SCOPED_FORBIDDEN]) {
      const body = needle.startsWith("'")
        ? 'const planted = ' + needle
        : `const planted = '${needle}'`
      const planted = ['const untouched = 1', body, '// tail'].join('\n')
      const hits = findNeedle(needle, planted, 'synthetic/planted.ts')
      expect(hits.length, `the extractor could not find the planted ${label}`).toBe(1)
      expect(hits[0]?.line).toBe(2)
    }
  })

  // The extractor reads COMMENTS too. Stated as its own cell because it is the property 404-02 was
  // sent back for, and a property nobody asserts is a property that drifts the first time somebody
  // "helpfully" strips comments before scanning.
  it('counts a needle inside a comment as a hit', () => {
    const { needle } = FORBIDDEN[2] as { needle: string }
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
        `a retired 411 token reappeared in the shipped tree (D-14):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  for (const { label, needle } of FUNNEL_SCOPED_FORBIDDEN) {
    it(`no funnel file spells ${label}`, () => {
      const hits: string[] = []
      for (const file of FUNNEL_SOURCES) {
        const rel = relative(PACKAGES_DIR, file).split(sep).join('/')
        for (const hit of findNeedle(needle, readFileSync(file, 'utf8'), rel)) {
          hits.push(`${hit.file}:${hit.line}: ${hit.text}`)
        }
      }
      expect(
        hits,
        `a retired 411 side-counter token reappeared in a funnel file (D-14):\n${hits.join('\n')}`,
      ).toEqual([])
    })
  }

  // A cell that cannot match itself. This file IS inside the scanned universe, so a needle spelled
  // here would already have reddened a cell above — this one names the cause instead of leaving
  // the reader to work out why the census is accusing its own source. The funnel-scoped needles are
  // included even though this file is outside that scope: a whole spelling here would still be an
  // inventory satisfying itself the moment Phase 412 widens the rule.
  it('spells none of its own needles — the inventory cannot be satisfied by this file', () => {
    const own = readFileSync(THIS_FILE, 'utf8')
    const selfHits = [...FORBIDDEN, ...FUNNEL_SCOPED_FORBIDDEN]
      .filter(({ needle }) => own.includes(needle))
      .map((entry) => entry.label)
    expect(
      selfHits,
      `this cell spells a needle it forbids; build it from two halves: ${selfHits.join(', ')}`,
    ).toEqual([])
  })
})
