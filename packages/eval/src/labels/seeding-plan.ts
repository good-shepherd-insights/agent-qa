/**
 * D-16 corpus-seeding planner — the composition root of the pure label
 * factory (LABEL-01..03, ROOT-03).
 *
 * Planner law (D-16): this plan is the ONLY decision-maker. It composes the
 * pair matcher, the silver sampler, and the record/entry projections into
 * one typed SeedingPlan with every case fully materialized (cassette id +
 * label record + corpus entry). eval-local EXECUTES the plan byte-for-byte;
 * no selection or labeling decision is left to the storage side.
 *
 * Membership law (D-13): the plan's cases ARE the commit scope. Exactly the
 * seeded silver selections plus pair members appear — nothing else may land
 * in the committed corpus, by construction. Every non-member is accounted
 * for by a typed pair skip or silver exclusion carried forward verbatim.
 *
 * Partition law (414 D-07): the split is decided BEFORE the entry is
 * projected. `assignSplit` runs inside the admit closure and its result is
 * handed to `projectCorpusEntry` as an INPUT, so no post-hoc relabel path
 * exists anywhere in the seeder — a split can only change by re-deriving the
 * whole entry from a changed manifest, which is a named migration.
 *
 * The partition parameters and the D-04 fields are caller-supplied DATA:
 * eval core imports no runner-local constants, and module discipline bans
 * clock APIs here — the CLI and eval-local resolve the committed manifest,
 * the ISO capture time and the target environment and pass them in.
 */
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import type { LeafCassette } from '../cassette/cassette'
import type { ExtractedCassette } from '../extract/extract-run'
import { deriveRunSlug } from '../extract/ids'
import { projectCorpusEntry, resolveProductPartition } from './corpus-entry'
import type { CorpusEntry, TargetEnvironment } from './corpus-entry'
import { projectPairLabelRecords, projectSilverLabelRecord } from './label-record'
import type { StandaloneLabelRecord } from './label-record'
import { collectSelfHealPairs } from './pair-matching'
import type { PairSkip } from './pair-matching'
import { DEFAULT_SILVER_PER_TEST_CAP, selectSilverCassettes } from './silver-sampling'
import type { SilverExclusion } from './silver-sampling'
import { assignSplit } from './split-assignment'
import type { PartitionParams } from './split-assignment'

/** Caller-suppliable curation policy (D-11) — NOT frozen-config measurement. */
export interface SeedingParams {
  /** Per-test silver cap; defaults to DEFAULT_SILVER_PER_TEST_CAP. */
  silverPerTestCap?: number
}

/** One fully materialized corpus admission — id, record, and entry agree. */
export interface SeedingPlanCase {
  cassetteId: string
  labelRecord: StandaloneLabelRecord
  corpusEntry: CorpusEntry
}

/** The complete deterministic description of what joins the committed corpus. */
export interface SeedingPlan {
  product: string
  runId: string
  runSlug: string
  /** Exactly the pair members + silver selections, cassetteId ascending (D-13). */
  cases: SeedingPlanCase[]
  /** Matcher skips, verbatim — never silent. */
  pairSkips: PairSkip[]
  /** Sampler exclusions, verbatim — never silent. */
  silverExclusions: SilverExclusion[]
  /** Both pair classes counted so a starved channel is visible (D-07). */
  pairCounts: { total: number; sameState: number; differingState: number }
  /** Count of 'procedure-granularity' exclusions among silverExclusions. */
  proceduresExcludedCount: number
}

export interface BuildSeedingPlanInput {
  handoff: CompletedRunHandoff
  cassettes: readonly ExtractedCassette[]
  /**
   * The product's committed partition parameters (414 D-05/D-07). REQUIRED:
   * no default fraction exists anywhere on the eval side.
   */
  partition: PartitionParams
  /**
   * D-04 ISO wall-clock capture time, resolved by the caller. Omitted when
   * it does not resolve — never fabricated.
   */
  capturedAt?: string
  /** D-04 target environment, resolved by the caller. Omitted when unknown. */
  targetEnvironment?: TargetEnvironment
  params?: SeedingParams
}

function requireLeaf(
  leavesById: ReadonlyMap<string, LeafCassette>,
  cassetteId: string,
): LeafCassette {
  const cassette = leavesById.get(cassetteId)
  if (cassette === undefined) {
    throw new Error(
      `seeding plan references cassette ${cassetteId} absent from the extracted leaf set`,
    )
  }
  return cassette
}

/**
 * Project handoff evidence + extracted cassettes + seeding params into the
 * one typed seeding plan. Pure and deterministic: same input yields a
 * deep-equal plan; cases are sorted by cassetteId ascending (plain string
 * comparison — total order); the leaf Map is lookup-only. A duplicate case
 * id throws — the pair and silver channels are disjoint by construction
 * (the sampler excludes selfHeal steps), so a duplicate means the
 * channel-purity invariant broke upstream.
 */
export function buildSeedingPlan(input: BuildSeedingPlanInput): SeedingPlan {
  const { handoff, cassettes, partition, capturedAt, targetEnvironment, params } = input
  const product = resolveProductPartition(handoff.scope)
  const runId = handoff.runId
  const runSlug = deriveRunSlug(runId)

  const { pairs, skips } = collectSelfHealPairs({ handoff, cassettes })
  const { selected, exclusions } = selectSilverCassettes({
    handoff,
    cassettes,
    silverPerTestCap: params?.silverPerTestCap ?? DEFAULT_SILVER_PER_TEST_CAP,
  })

  const leavesById = new Map<string, LeafCassette>()
  for (const entry of cassettes) {
    if (entry.cassette.granularity === 'leaf') {
      leavesById.set(entry.cassette.id, entry.cassette)
    }
  }

  const admittedIds = new Set<string>()
  const cases: SeedingPlanCase[] = []
  const admit = (
    cassette: LeafCassette,
    labelRecord: StandaloneLabelRecord,
    isPairMember: boolean,
  ): void => {
    if (admittedIds.has(cassette.id)) {
      throw new Error(
        `duplicate seeding case for cassette ${cassette.id} — channel purity broke upstream`,
      )
    }
    admittedIds.add(cassette.id)
    const assignment = assignSplit({ ...partition, cassetteId: cassette.id, isPairMember })
    cases.push({
      cassetteId: cassette.id,
      labelRecord,
      corpusEntry: projectCorpusEntry({
        cassette,
        product,
        runId,
        assignment,
        capturedAt,
        targetEnvironment,
      }),
    })
  }

  let sameStateCount = 0
  for (const pair of pairs) {
    if (pair.sameState) sameStateCount += 1
    const failedCassette = requireLeaf(leavesById, pair.failedCassetteId)
    const recoveringCassette = requireLeaf(leavesById, pair.recoveringCassetteId)
    const [failedRecord, recoveringRecord] = projectPairLabelRecords({
      pair,
      failedCassette,
      recoveringCassette,
      runId,
    })
    admit(failedCassette, failedRecord, true)
    admit(recoveringCassette, recoveringRecord, true)
  }

  for (const cassetteId of selected) {
    const cassette = requireLeaf(leavesById, cassetteId)
    admit(cassette, projectSilverLabelRecord({ cassette, runId }), false)
  }

  cases.sort((a, b) => {
    if (a.cassetteId !== b.cassetteId) return a.cassetteId < b.cassetteId ? -1 : 1
    return 0
  })

  return {
    product,
    runId,
    runSlug,
    cases,
    pairSkips: skips,
    silverExclusions: exclusions,
    pairCounts: {
      total: pairs.length,
      sameState: sameStateCount,
      differingState: pairs.length - sameStateCount,
    },
    proceduresExcludedCount: exclusions.filter(
      (exclusion) => exclusion.reason === 'procedure-granularity',
    ).length,
  }
}
