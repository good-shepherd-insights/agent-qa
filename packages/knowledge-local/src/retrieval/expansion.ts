/**
 * Phase 377 D-08 bounded graph expansion (memory.md §5.5.4).
 *
 * The hot path is strictly one hop. Hubs are skipped entirely in both directions; the spec's
 * matched-anchor-type-only alternative is a deliberate non-choice.
 */
import type { DatabaseSync } from 'node:sqlite'

import type { PreFilterOptions } from './pre-filter.js'

export interface ExpansionSeed {
  readonly bundleId: string
  readonly nodeIds: readonly string[]
}

export type ExpansionQueryScope = PreFilterOptions

export interface ExpansionCandidate {
  readonly recordRowid: number
  readonly bundleId: string
  readonly nodeId: string
  readonly trust: number
  readonly recencyOrdinal: number
  readonly source: 'expanded'
  readonly seedBundleIds: readonly string[]
}

export function expandOneHop(
  _db: DatabaseSync,
  _seeds: readonly ExpansionSeed[],
  _queryScope: ExpansionQueryScope,
  _n: number,
): ExpansionCandidate[] {
  throw new Error('expandOneHop is not implemented')
}
