import type { OwnershipContract } from '../contract-types.js'
import type { SpecifierHit } from './extract-specifiers.js'

/**
 * The eval-local proposer port rule (414 D-18 / D-20, ROOT-10 SC5).
 *
 * `@vostride/agent-qa-eval-local`'s MAIN entry is the GATE side: it hands out the committed
 * corpus root as an fs path, the seeding writer, the baseline pointer writer and the replay
 * store — powers that decide what a run is scored against. A proposer must never hold any of
 * them; it may only READ the split-filtered, visibility-filtered slice the `/reader` subpath
 * exports. So the specifier itself is the enforcement point: outside `packages/cli/`, naming
 * the main entry is the violation, and `/reader` is the only spelling that passes.
 *
 * This binds BEFORE the proposer code exists on purpose. When Phase 422 gives `agent-local` a
 * corpus port, the rule already holds it to `/reader` — no new cell, no reviewer remembering.
 * A wall built after the thing it is meant to stop is a wall with a hole in its history.
 *
 * The sibling `reader-carveout.ts` rule (knowledge-local) is the transplanted idiom; its
 * `KNOWLEDGE_LOCAL_WALL_RATIONALES` block — which walls `packages/eval*` off knowledge-local for
 * replay hermeticity — is a different direction entirely and stays untouched (D-20).
 */
export const EVAL_LOCAL_MAIN_ENTRY = '@vostride/agent-qa-eval-local'
export const EVAL_LOCAL_READER_ENTRY = `${EVAL_LOCAL_MAIN_ENTRY}/reader`

/** eval-local's own sources reach their siblings relatively; the rule has nothing to say there. */
export const EVAL_LOCAL_PACKAGE_DIR = 'packages/eval-local'

/**
 * Where the eval-local main entry may be named at all.
 *
 * A trailing slash makes this a directory PREFIX, and a prefix is what it has to be: the CLI's
 * `eval-session-composition.ts` names the main entry on four lines, two of them
 * `export type { … } from '@vostride/agent-qa-eval-local'` re-exports, and `SPECIFIER_RE` counts
 * a type re-export as a hit exactly like a value import. Pinning a single file would still work
 * today and would break the moment the composition root splits — and the failure would look like
 * an architecture violation rather than a stale pin.
 *
 * The prefix does NOT say how many files under it may do it, and deliberately so: the CLI is the
 * composition layer, not a singleton file, so the sibling knowledge rule's "exactly one importer"
 * arm has no analogue here. What it must still say is that SOMEBODY uses it —
 * `findEvalLocalAllowanceUnusedOffenders` below.
 */
export const EVAL_LOCAL_MAIN_ENTRY_ALLOWLIST = ['packages/cli/'] as const

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/')
}

function isAllowedMainEntryFile(file: string): boolean {
  return EVAL_LOCAL_MAIN_ENTRY_ALLOWLIST.some((entry) => (
    entry.endsWith('/') ? file.startsWith(entry) : file === entry
  ))
}

/**
 * Direction 1: a file outside the allowance names the gate-side main entry.
 *
 * Handed EVERY contract's source hits by the aggregate, not the sibling rule's
 * `READER_CARVEOUT_SCANNED_DIRS` slice — the packages this rule exists to hold (`agent`,
 * `agent-local`, `knowledge-local`) are not in that list, so a scoped version would pass forever
 * while the thing it names went unchecked.
 *
 * `EVAL_LOCAL_READER_ENTRY` is never an offender, anywhere. That is the whole point: the rule
 * does not forbid reaching eval-local, it forbids reaching it through the door that writes.
 */
export function findEvalLocalMainEntryOffenders(
  contract: OwnershipContract,
  hits: readonly SpecifierHit[],
): string[] {
  if (contract.packageDir === EVAL_LOCAL_PACKAGE_DIR) return []

  const offenders: string[] = []

  for (const hit of hits) {
    if (hit.specifier !== EVAL_LOCAL_MAIN_ENTRY) continue
    const file = normalizeRepoPath(hit.file)
    if (isAllowedMainEntryFile(file)) continue

    offenders.push(
      `eval-local-reader-carveout: ${file}:${String(hit.line)} ⇏ ${hit.specifier}`
      // Deliberately NOT spelled "must import '<entry>'": `SPECIFIER_RE` matches
      // `import '…'` anywhere in a scanned source line, so that phrasing made this rule's own
      // message an undeclared dependency of `packages/arch` and REDdened dep reconciliation.
      + ` (main entry is the gate side; proposer packages must name '${EVAL_LOCAL_READER_ENTRY}')`,
    )
  }

  return offenders
}

/**
 * Direction 2: the allowance is used by NO file.
 *
 * This is how a path-keyed rule usually dies — it passes forever, checks nothing, and reads like
 * proof. It also doubles as the guard against a mistyped prefix, because a wrong prefix leaves the
 * real importer unallowed (direction 1 fires) AND the allowance unused (this fires), so the two
 * offenders together name the mistake rather than one of them alone naming the wrong file.
 *
 * Takes the union of hits across every scanned package rather than one package's, because "used by
 * nobody in the workspace" cannot be decided from a slice of it. Unlike the knowledge writer rule
 * there is no upper arm: the allowance is a directory of composition files, and several of them
 * legitimately name the entry.
 */
export function findEvalLocalAllowanceUnusedOffenders(hits: readonly SpecifierHit[]): string[] {
  const importers = new Set<string>()

  for (const hit of hits) {
    if (hit.specifier !== EVAL_LOCAL_MAIN_ENTRY) continue
    const file = normalizeRepoPath(hit.file)
    if (isAllowedMainEntryFile(file)) importers.add(file)
  }

  if (importers.size > 0) return []

  return [
    `eval-local-reader-carveout: the eval-local main-entry allowance`
    + ` [${EVAL_LOCAL_MAIN_ENTRY_ALLOWLIST.join(', ')}] is used by no file — either the prefix is`
    + ' wrong or the last importer left, and an allowance nothing uses is a rule that cannot fail',
  ]
}
