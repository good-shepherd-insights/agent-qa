// Concrete per-product buildOrdinal counter (Phase 361, D-18 / SESSION-05).
//
// A storageImplementation home for node:fs + node:path (the FsActionCache / FsStorageStateStore
// boundary) — this project-local counter fs write lives here, never in the runner. On-disk layout:
//
//   <root>/build-ordinals.json   ({ [product]: number })
//
// D-18 derivation (spec/v2/eval-and-core-types.md §A8): buildOrdinal is a per-product run counter
// incremented at run start. Read → increment the product key → write-temp → atomic same-dir rename.
// The rename is the ONE deliberate step up from a plain writeFile (a reader never observes a
// half-written map); there is NO lockfile / flock machinery. Best-effort semantics: a corrupt or
// missing state file restarts the product at 1 without throwing (D-18). Concurrent same-product
// runs may read the same prior value and share an ordinal. D-15 ratifies that as correct semantics:
// ordinals identify builds, not runs; conflicting observations at one ordinal route to MintUnknown
// through the strictly-greater supersession rule.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The project-local state file holding the per-product ordinal map. */
export const BUILD_ORDINALS_FILE = 'build-ordinals.json'

export interface NextBuildOrdinalOptions {
  /** Runtime root (e.g. DEFAULT_AGENT_QA_DIR = '.agent-qa'). */
  root: string
  /** The product whose counter to advance. */
  product: string
}

export async function nextBuildOrdinal(opts: NextBuildOrdinalOptions): Promise<number> {
  const file = join(opts.root, BUILD_ORDINALS_FILE)
  const map = readOrdinals(file)

  const next = (map[opts.product] ?? 0) + 1
  map[opts.product] = next

  // Write-temp then atomic same-dir rename — a reader never sees a partial map (D-18).
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(map)}\n`, 'utf-8')
  renameSync(tmp, file)

  return next
}

function readOrdinals(file: string): Record<string, number> {
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    // Missing state ⇒ start fresh (best-effort, D-18).
    return {}
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed as Record<string, number>
  } catch {
    // A corrupt/partial state file restarts every product at 1 rather than crashing (D-18).
    return {}
  }
}
