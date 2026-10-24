/**
 * 414 D-09/D-10/D-11/D-12 gate-set selection (ROOT-08 SC3, ROOT-09 SC4) — the
 * one place that answers "which committed entries may gate THIS candidate".
 *
 * Composition law: a PURE FILTER over already-loaded entries. `eval-local`
 * owns every read of the committed root and hands the partition in; the
 * candidate's provenance is DATA the caller assembles (416's promotion bridge,
 * 417's gate), never assembled here. No host API, no clock, no digest.
 *
 * Exclusion law (ROOT-03/ROOT-08): no run that bred a candidate may gate it.
 * The keys are the three the committed entry carries — `run_links.runId`,
 * `receiptDigest`, `captured_at_ordinal` — and nothing else. D-13 already
 * removed the handoff path from the entry; `CandidateProvenance` mirrors that
 * with exactly three fields, so exclusion CANNOT key on a path even by
 * mistake. The `__tests__/gate-set.test-d.ts` never-bar pins that shape.
 *
 * D-09: all four split arms gate. A private held-out entry is unreachable
 * through the proposer's `/reader` port and is still a first-class member of
 * the gate set here — `isProposerVisibleEntry` has no say at gate time.
 *
 * D-11 (the refusal that makes the law non-vacuous): a candidate whose three
 * key arrays are ALL empty gets `unprovenanced-candidate` and no gate set at
 * all. An empty `excluded[]` is only ever a MEASUREMENT over a non-empty key
 * set; without this arm a candidate carrying no provenance would sail through
 * with "nothing to exclude" and gate itself.
 *
 * D-12 (standing law: a threshold is chosen only after the floor is measured):
 * `minimumGateSet` is a REQUIRED integer input. There is no default, no rate,
 * no ratio and no rounding anywhere in this file — the comparison is the
 * integer `total(after) < minimumGateSet`, and the raw per-split counts before
 * and after exclusion ride the verdict so Phase 415 can price the floor from
 * observed numbers rather than from an authored guess.
 *
 * Every excluded entry is a typed row (the `silver-sampling.ts` doctrine:
 * never silently dropped), and both lists are sorted by `cassetteId` so two
 * calls over the same inputs serialise identically.
 */
import type { CorpusEntry } from '../labels/corpus-entry'

/**
 * Why an entry left the gate set. Precedence when an entry matches more than
 * one key is the declaration order below: run > receipt > ordinal. The run is
 * the coarsest and most direct statement of "this candidate came from here",
 * so it is the reason worth reporting when several hold at once.
 */
export type ExclusionReason = 'run-contributed' | 'receipt-contributed' | 'ordinal-contributed'

/** Declaration-order projection of `ExclusionReason` (the 414 D-22 bar idiom). */
export const EXCLUSION_REASONS = [
  'run-contributed',
  'receipt-contributed',
  'ordinal-contributed',
] as const satisfies readonly ExclusionReason[]

/**
 * The candidate's own provenance, assembled by the caller from the record
 * under promotion. EXACTLY three keys (ROOT-08 SC3): a path is not provenance
 * and can never become one here.
 */
export interface CandidateProvenance {
  /** Source run ids that contributed to this candidate. */
  runIds: readonly string[]
  /** Receipt digests of the decisions that contributed to this candidate. */
  receiptDigests: readonly string[]
  /** Build ordinals the contributing runs were captured at. */
  capturedAtOrdinals: readonly number[]
}

/** Raw integer counts per split x visibility. Never a rate — D-12. */
export interface GateSetCounts {
  natural: number
  heldOutShared: number
  heldOutPrivate: number
  adversarial: number
}

/** All four keys present at zero, so an absent split is never a missing key. */
export function emptyGateSetCounts(): GateSetCounts {
  return { natural: 0, heldOutShared: 0, heldOutPrivate: 0, adversarial: 0 }
}

/** The ONE counter the gate set, the posture and the census share. */
export function countGateSet(entries: readonly CorpusEntry[]): GateSetCounts {
  const counts = emptyGateSetCounts()

  for (const entry of entries) {
    if (entry.split === 'natural') {
      counts.natural += 1
    } else if (entry.split === 'adversarial') {
      counts.adversarial += 1
    } else if (entry.heldOutVisibility === 'private') {
      counts.heldOutPrivate += 1
    } else {
      counts.heldOutShared += 1
    }
  }

  return counts
}

/** One entry removed from the gate set, and why (never a silent drop). */
export interface GateSetExclusion {
  cassetteId: string
  reason: ExclusionReason
}

/** Counts of the partition before exclusion and of the surviving gate set after it. */
export interface GateSetCountPair {
  before: GateSetCounts
  after: GateSetCounts
}

/**
 * The three honest answers (D-11). 416's receipt and 417's gate consume this
 * vocabulary verbatim, so a rename is a cross-phase contract change.
 */
export type GateSetVerdict =
  | {
      verdict: 'ok'
      gateEntries: readonly CorpusEntry[]
      excluded: readonly GateSetExclusion[]
      counts: GateSetCountPair
    }
  | {
      verdict: 'empty-gate-set'
      /** `empty`: nothing survived at all. `below-minimum`: some did, too few. */
      reason: 'empty' | 'below-minimum'
      /** The floor this verdict was judged against, so a reader never guesses. */
      minimumGateSet: number
      excluded: readonly GateSetExclusion[]
      counts: GateSetCountPair
    }
  | { verdict: 'unprovenanced-candidate' }

export interface SelectGateSetInput {
  /** The already-loaded committed entries; may span several products. */
  entries: readonly CorpusEntry[]
  /** The product partition to gate within (D-03). */
  product: string
  /** The candidate's own provenance, assembled by the caller. */
  candidate: CandidateProvenance
  /** REQUIRED integer floor, >= 1. No default exists anywhere (D-12). */
  minimumGateSet: number
}

function totalOf(counts: GateSetCounts): number {
  return counts.natural + counts.heldOutShared + counts.heldOutPrivate + counts.adversarial
}

function byCassetteId(a: { cassetteId: string }, b: { cassetteId: string }): number {
  if (a.cassetteId < b.cassetteId) return -1
  if (a.cassetteId > b.cassetteId) return 1
  return 0
}

/**
 * Decide which of the three keys removed this entry, at run > receipt >
 * ordinal precedence. An entry matching two or three keys yields ONE reason —
 * an adjacency merges, it never duplicates the row.
 */
function reasonFor(
  entry: CorpusEntry,
  runIds: ReadonlySet<string>,
  receiptDigests: ReadonlySet<string>,
  capturedAtOrdinals: ReadonlySet<number>,
): ExclusionReason | undefined {
  if (runIds.has(entry.run_links.runId)) return 'run-contributed'
  if (receiptDigests.has(entry.receiptDigest)) return 'receipt-contributed'
  if (capturedAtOrdinals.has(entry.captured_at_ordinal)) return 'ordinal-contributed'
  return undefined
}

/**
 * Select the entries a candidate may be gated on: the product partition's
 * natural, held-out (shared AND private) and adversarial entries as ONE set,
 * minus every entry the candidate's own provenance names.
 *
 * Throws `TypeError` when `minimumGateSet` is not a positive integer. By the
 * time a value reaches here it came from a caller's own configuration, so a
 * violation is a caller bug, not untrusted data (the `baseline-pointer.ts`
 * precedent). Malformed ENTRY bytes are refused far upstream by the corpus
 * entry guard.
 */
export function selectGateSet(input: SelectGateSetInput): GateSetVerdict {
  const { entries, product, candidate, minimumGateSet } = input

  if (!Number.isInteger(minimumGateSet) || minimumGateSet < 1) {
    throw new TypeError(
      `minimumGateSet must be an integer of at least 1 (got ${String(minimumGateSet)})`,
    )
  }

  // D-11: refuse BEFORE measuring anything. A candidate that names no run, no
  // receipt and no ordinal has not earned a gate set — it would gate itself.
  const hasProvenance =
    candidate.runIds.length > 0 ||
    candidate.receiptDigests.length > 0 ||
    candidate.capturedAtOrdinals.length > 0
  if (!hasProvenance) {
    return { verdict: 'unprovenanced-candidate' }
  }

  const runIds = new Set(candidate.runIds)
  const receiptDigests = new Set(candidate.receiptDigests)
  const capturedAtOrdinals = new Set(candidate.capturedAtOrdinals)

  // D-09: every arm of the partition gates. Another product's entry is out of
  // scope entirely — neither gated on nor reported as an exclusion.
  const partition = entries.filter(entry => entry.product === product)

  const gateEntries: CorpusEntry[] = []
  const excluded: GateSetExclusion[] = []

  for (const entry of partition) {
    const reason = reasonFor(entry, runIds, receiptDigests, capturedAtOrdinals)
    if (reason === undefined) {
      gateEntries.push(entry)
    } else {
      excluded.push({ cassetteId: entry.cassetteId, reason })
    }
  }

  // Sorted so no Set or filter iteration order leaks into the verdict.
  gateEntries.sort(byCassetteId)
  excluded.sort(byCassetteId)

  const counts: GateSetCountPair = {
    before: countGateSet(partition),
    after: countGateSet(gateEntries),
  }
  const afterTotal = totalOf(counts.after)

  if (afterTotal === 0) {
    return { verdict: 'empty-gate-set', reason: 'empty', minimumGateSet, excluded, counts }
  }

  // D-12: an integer comparison against the caller's floor. No rate, no
  // fraction, no rounding — the floor's real value is Phase 415's to commit.
  if (afterTotal < minimumGateSet) {
    return { verdict: 'empty-gate-set', reason: 'below-minimum', minimumGateSet, excluded, counts }
  }

  return { verdict: 'ok', gateEntries, excluded, counts }
}
