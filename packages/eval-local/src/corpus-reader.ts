/**
 * The proposer's ONLY read over the committed corpus (414 D-18 / D-19 / D-20, ROOT-10).
 *
 * The corpus is a train / validation / test partition. `natural` is the optimise set the
 * proposer may read and learn from; held-out `shared` is a VISIBLE validation set — readable,
 * still gated on; held-out `private` is the unseen test set. A measurement the thing being
 * measured can read is not a measurement, so the private arm is unreachable from here: not
 * listable, not loadable, not countable.
 *
 * Existence non-leak (D-19, the anti-pattern this module exists to make impossible): a private
 * cassetteId answers with the SAME `{ kind: 'not-found' }` an id that was never committed gets.
 * There is deliberately no `not-visible` arm — an arm that distinguishes the two tells the
 * proposer the id exists, which is the whole of what the private set withholds. For the same
 * reason there is no count method, no `listProducts`, and no visibility parameter: each of those
 * is a channel through which the size or the shape of the unseen set could be inferred.
 *
 * Refusals and notices from the underlying read are NOT exposed. A refused committed file is an
 * operator's problem, not the proposer's, and the paths it names are root-shaped information.
 *
 * Composition law (eval-local's ownership contract): this module reads and FILTERS. The
 * visibility predicate itself (`isProposerVisibleEntry`) lives in eval core beside the type it
 * narrows, so the filter here and the never-bar in `__tests__/reader.test-d.ts` are talking
 * about one definition rather than two that could drift.
 *
 * D-18 declined a physically separate private root, so the pin is at the PORT and at the TYPE:
 * `packages/eval-local/src/reader.ts` publishes exactly this function, `validate:arch` holds
 * every non-cli importer to that subpath, and three cells RED if a private-returning export or
 * method is added.
 */

import { isProposerVisibleEntry } from '@vostride/agent-qa-eval'
import type {
  LeafCassette,
  ProposerVisibleCorpusEntry,
  StandaloneLabelRecord,
} from '@vostride/agent-qa-eval'

import { readCommittedCorpus } from './committed-corpus-source.js'

export type { ProposerVisibleCorpusEntry } from '@vostride/agent-qa-eval'

/**
 * The two-arm answer every load gives. `not-found` is TOTAL: it covers an id that does not
 * exist, an id whose bytes are unreadable, and an id the proposer may not see — deliberately
 * indistinguishable (D-19).
 */
export type CorpusReaderLoad<TLoaded> = ({ kind: 'loaded' } & TLoaded) | { kind: 'not-found' }

/** A visible entry's cassette bundle, or nothing. */
export type CorpusCassetteLoad = CorpusReaderLoad<{ cassette: LeafCassette }>

/** A visible entry's standalone label record, or nothing. */
export type CorpusLabelLoad = CorpusReaderLoad<{ record: StandaloneLabelRecord }>

/**
 * The port. EXACTLY three methods — every addition is a widening of what a proposer may learn
 * about the measurement it is being scored against, so the set is pinned by name in three places.
 */
export interface CorpusReader {
  /** Every proposer-visible entry, cassetteId ascending; optionally one product's slice. */
  listEntries(product?: string): readonly ProposerVisibleCorpusEntry[]
  /** The cassette bundle for a VISIBLE entry; `not-found` for anything else. */
  loadCassette(cassetteId: string): CorpusCassetteLoad
  /** The label record for a VISIBLE entry; `not-found` for anything else. */
  loadLabel(cassetteId: string): CorpusLabelLoad
}

interface VisibleSlice {
  visible: readonly ProposerVisibleCorpusEntry[]
  visibleIds: ReadonlySet<string>
  cassettesById: ReadonlyMap<string, LeafCassette>
  labelsById: ReadonlyMap<string, StandaloneLabelRecord>
}

/**
 * Open a read port over the committed root at `committedRoot`.
 *
 * The root is read ONCE, lazily on first use, and the visible slice is kept: a port whose answers
 * changed mid-session would let a proposer watch the corpus move. An absent or unreadable root is
 * an empty port — `listEntries()` is `[]` and every load is `not-found` — never a throw, matching
 * the read leg's own posture for a hand-editable, git-tracked document.
 */
export function openCorpusReader(committedRoot: string): CorpusReader {
  let slice: VisibleSlice | undefined

  function load(): VisibleSlice {
    if (slice === undefined) {
      const read = readCommittedCorpus(committedRoot)
      const visible = read.snapshot.entries.filter((entry): entry is ProposerVisibleCorpusEntry =>
        isProposerVisibleEntry(entry),
      )
      slice = {
        visible,
        visibleIds: new Set(visible.map((entry) => entry.cassetteId)),
        cassettesById: read.snapshot.cassettesById,
        labelsById: read.snapshot.labelsById,
      }
    }
    return slice
  }

  return {
    listEntries(product?: string): readonly ProposerVisibleCorpusEntry[] {
      const { visible } = load()
      if (product === undefined) return visible
      return visible.filter((entry) => entry.product === product)
    },

    loadCassette(cassetteId: string): CorpusCassetteLoad {
      const { visibleIds, cassettesById } = load()
      if (!visibleIds.has(cassetteId)) return { kind: 'not-found' }
      const cassette = cassettesById.get(cassetteId)
      if (cassette === undefined) return { kind: 'not-found' }
      return { kind: 'loaded', cassette }
    },

    loadLabel(cassetteId: string): CorpusLabelLoad {
      const { visibleIds, labelsById } = load()
      if (!visibleIds.has(cassetteId)) return { kind: 'not-found' }
      const record = labelsById.get(cassetteId)
      if (record === undefined) return { kind: 'not-found' }
      return { kind: 'loaded', record }
    },
  }
}
