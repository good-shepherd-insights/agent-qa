// THE COMPLETE SET OF `ChatApprovalDecisionRecord` DECLARATIONS IN THIS REPOSITORY — and there is
// exactly one of them (401-01, D-13's companion invariant).
//
// WHY A CENSUS AND NOT A LINE PIN. The defect this file guards is not a wrong line, it is a SECOND
// SPELLING. Until 401-01 this type was declared twice — once in the composition root and once,
// structurally mirrored, in the cli's confirm wrapper — and the two were free to drift the moment
// either producer changed. That is what left NEW-AUDIT-01 half-closed: hardening one declaration
// leaves the other standing, and the drop persists on whichever door reads the un-hardened one.
// Phases 388, 390, 392 and 400-17 each paid for the same class. So the subject here is the SET.
//
// THE PROMOTE IS WHAT IS PINNED, NOT MERELY THE COUNT. One declaration is not enough on its own:
// two spellings could be collapsed into the WRONG package and the count would still read 1, while
// `agent-local` — which may not import `cli` — would be left importing nothing and re-minting its
// own. So the surviving declaration's package is asserted by name.
//
// THE DISCOVERY PREDICATE IS THE PART MOST LIKELY TO BE VACUOUS, so it is asserted rather than
// trusted (the require-anchor census's own lesson). A scan that walked zero directories, or a
// matcher that matched nothing, would report "exactly one... " — no, it would report zero, but a
// scan that silently walked a wrong-but-existing root and a matcher that could not see a
// declaration at all are indistinguishable from a clean tree by their VERDICT. Both are therefore
// asserted: a floor on the files scanned, and a discrimination cell that runs the same matcher over
// a synthetic source carrying a second declaration and proves it is SEEN.
//
// TESTS ARE EXCLUDED FROM THE SCAN because the discrimination cell below writes the defective shape
// on purpose — as a string, so it is not even a file the walker could reach.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const TESTS_DIR = dirname(fileURLToPath(import.meta.url))
/** `packages`. */
const PACKAGES_ROOT = resolve(TESTS_DIR, '..', '..', '..')

/**
 * The floor on the walker's own yield.
 *
 * Read off the tree independently of this scan (`find packages/*​/src -name '*.ts' | wc -l` was well
 * past four figures at the time of writing), never off this scan's output — a floor taken from the
 * thing it guards certifies itself.
 */
const MINIMUM_SOURCES_SCANNED = 500

/** The package the canonical declaration must live in — `cli` may import it, never the reverse. */
const CANONICAL_PACKAGE = 'agent-local'

/**
 * Both ways TypeScript declares this name: `interface X {` and `type X =`.
 *
 * A DECLARATION MATCHER, NOT A USAGE ONE. Imports, type annotations and re-exports all mention the
 * name and none of them mints a second contract; a matcher that counted mentions would red on the
 * very promote it exists to protect (the cli surface now IMPORTS this type, and must).
 */
const DECLARATION = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface\s+ChatApprovalDecisionRecord\b|type\s+ChatApprovalDecisionRecord\s*[<=])/mu

/** Every declaration site in one source, by 1-based line number. */
export function declarationLines(source: string): number[] {
  return source
    .split('\n')
    .map((line, index) => (DECLARATION.test(line) ? index + 1 : 0))
    .filter((line) => line !== 0)
}

interface ScannedSource {
  readonly pkg: string
  /** Relative to `packages/`, so a failure message reads the same on every machine. */
  readonly relPath: string
  readonly source: string
}

/** Every product `.ts` file under `packages/​*​/src`. */
function scanProductSources(packagesRoot: string = PACKAGES_ROOT): ScannedSource[] {
  const found: ScannedSource[] = []
  for (const pkgEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!pkgEntry.isDirectory() || pkgEntry.name === 'node_modules') continue
    const srcRoot = join(packagesRoot, pkgEntry.name, 'src')
    let srcStat
    try {
      srcStat = statSync(srcRoot)
    } catch {
      continue
    }
    if (!srcStat.isDirectory()) continue
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
          continue
        }
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.isFile()) continue
        if (!/\.[cm]?ts$/u.test(entry.name)) continue
        if (/\.test(?:-d)?\.[cm]?ts$/u.test(entry.name)) continue
        found.push({
          pkg: pkgEntry.name,
          relPath: relative(packagesRoot, full),
          source: readFileSync(full, 'utf8'),
        })
      }
    }
    walk(srcRoot)
  }
  return found
}

describe('ChatApprovalDecisionRecord has exactly one declaration, in the composition root', () => {
  const scanned = scanProductSources()

  it('scanned a tree that is actually there', () => {
    // Neither of these can be satisfied by an empty or wrong-rooted walk, and there is no branch in
    // this file that turns an unreadable file or a missing directory into a skip.
    expect(scanned.length).toBeGreaterThanOrEqual(MINIMUM_SOURCES_SCANNED)
    expect(
      [...new Set(scanned.map((entry) => entry.pkg))],
      'the walker did not reach both packages this type crosses, so its verdict is about a tree '
      + 'that is not the one under test',
    ).toEqual(expect.arrayContaining([CANONICAL_PACKAGE, 'cli']))
  })

  it('declares the record in exactly one place, and that place is agent-local', () => {
    const sites = scanned.flatMap((entry) =>
      declarationLines(entry.source).map((line) => `${entry.relPath}:${String(line)}`))

    expect(
      sites,
      'a second declaration of the approval-decision record was minted; two structurally-mirrored '
      + 'spellings of one contract drift the moment either producer changes, which is the shape '
      + 'that left NEW-AUDIT-01 half-closed',
    ).toHaveLength(1)
    expect(
      sites[0],
      'the surviving declaration moved out of the composition root; `cli` may import `agent-local` '
      + 'and never the reverse, so a canon that lives anywhere else forces a second one',
    ).toContain(`${CANONICAL_PACKAGE}/src/`)
  })

  it('SEES a second declaration, and stays quiet about an import of the first', () => {
    // THE MUTATION BAR. Without this cell the census could be a matcher that never matches, which
    // is indistinguishable from a clean tree by its verdict alone. The bar is the implementation
    // the census must red on, not the suite it passes.
    expect(declarationLines([
      'export interface ChatApprovalDecisionRecord {',
      '  readonly actionClass: string',
      '}',
    ].join('\n'))).toEqual([1])
    expect(declarationLines('type ChatApprovalDecisionRecord = { actionClass: string }'))
      .toEqual([1])
    expect(declarationLines('  interface ChatApprovalDecisionRecord {')).toEqual([1])

    // AND THE OTHER HALF: the promote's whole point is that other packages MENTION this type. A
    // matcher that counted mentions would refuse the fix it was written to protect.
    expect(declarationLines([
      "import type { ChatApprovalDecisionRecord } from '@vostride/agent-qa-agent-local'",
      'const ledger = async (decision: ChatApprovalDecisionRecord): Promise<void> => {}',
      "export type { ChatApprovalDecisionRecord } from './compose-local-agent.js'",
    ].join('\n'))).toEqual([])
  })
})
