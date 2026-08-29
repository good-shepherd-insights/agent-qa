// What became of the canary lines a run served (Phase 407, LERN-02 · D-08).
//
// A canary has two halves that never live in the same place. The SERVING half — "this brief line
// was offered as a canary" — is a fact about the run and is read from its evidence. The
// ATTRIBUTED half — "and it was confirmed" — is a fact about the committed knowledge store and
// lives in a bundle's outcomes log, written long after the run ended, by the curation drain.
// `canaryOutcomeObservationId` is the only thing that spans them: the writer stamps it onto the
// event it appends, and this module RECOMPUTES it from the run's own tuples to find that event
// again. Recomputing rather than reading is what makes the join evidence instead of a claim —
// there is no second copy of the id to drift.
//
// READS ONLY. No writer lease is taken, no event is appended, no file is written. That is the
// T-407-11 mitigation and it is the reason this module can sit on the physically read-only
// `/reader` entry beside `diffSince` and `showRecord`: asking what became of a line must not be
// a way of deciding what becomes of it.
//
// ABSENCE IS A ROW, NOT A GAP. A tuple whose candidate has no committed bundle, or whose
// observation has been retracted, still answers a row carrying its observation id and no
// `outcome` key. The caller renders "not yet attributed" from that, which is a different and
// more honest thing than a missing row — a missing row is indistinguishable from a tuple the
// caller forgot to ask about. The same reasoning skips a bundle that will not LOAD (407-14,
// CR-03): an unreadable bundle can attribute nothing, so it must not be allowed to deny the rows
// of the bundles that read cleanly. A store this walker cannot fully load is still a store it can
// answer honestly about the readable part of; a store it cannot LIST is not, and still throws.

import { asRecordId, survivingOutcomeEvents } from '@vostride/agent-qa-schema'

import {
  KnowledgeMaintenanceScanError,
  enumerateMaintenanceBundleDirs,
  loadMaintenanceBundle,
} from '../maintenance-scan.js'
import { canaryOutcomeObservationId } from './canary-observation-id.js'

/** The four observation words. A lifecycle event carrying the same id attributes nothing. */
const ATTRIBUTING_EVENT_TYPES = [
  'confirmed',
  'contradicted',
  'helpful',
  'harmful',
] as const

export type CanaryAttributionOutcome = (typeof ATTRIBUTING_EVENT_TYPES)[number]

/** One served canary line, addressed the way the run recorded it. */
export interface CanaryAttributionTuple {
  candidateId: string
  testId: string
  testIndex: number
  stepIndex: number
}

export interface CanaryAttributionRow {
  candidateId: string
  testIndex: number
  stepIndex: number
  observationId: string
  outcome?: CanaryAttributionOutcome
}

export interface CanaryAttributionsForOptions {
  knowledgeRoot: string
  runId: string
  tuples: readonly CanaryAttributionTuple[]
}

function isAttributingType(type: string): type is CanaryAttributionOutcome {
  return (ATTRIBUTING_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * Index the surviving attributing observations of every candidate the caller asked about.
 *
 * The walk follows `showRecord`'s idiom — enumerate, load, compare `manifest.id` — because the
 * manifest is the only place a bundle's identity is verified, and matching on a directory name
 * would trust a filesystem convention no contract states. Bundles outside the candidate set are
 * enumerated but their outcomes are never folded.
 *
 * A BUNDLE THAT WILL NOT LOAD ATTRIBUTES NOTHING, AND DENIES NOTHING (407-14, CR-03). One corrupt,
 * truncated or tampered directory — quite possibly one the asking run never served a line from —
 * used to throw straight through this walk and turn the caller's whole read into a failure. It is
 * SKIPPED instead: it can contribute no outcome (that is what "will not load" means), and it has
 * no standing to withhold the outcomes of the bundles that do load. Skipping is not forgiving the
 * corruption either — the maintenance scanner beside this one still refuses to answer for such a
 * store, which is where a maintainer's fail-closed question belongs.
 *
 * ENUMERATE-LEVEL ERRORS STILL THROW. A product or bundle entry that is not a canonical directory
 * means the walker cannot even LIST the store, and a store it cannot list is not one it can answer
 * partially for — there is no way to know what was missed, so an empty-looking answer would be a
 * guess. The distinction is exactly "I read everything readable" versus "I do not know what is
 * here".
 */
function attributingOutcomesByObservationId(
  knowledgeRoot: string,
  candidateIds: ReadonlySet<string>,
): Map<string, CanaryAttributionOutcome> {
  const outcomes = new Map<string, CanaryAttributionOutcome>()
  for (const entry of enumerateMaintenanceBundleDirs(knowledgeRoot)) {
    let bundle
    try {
      bundle = loadMaintenanceBundle(entry)
    } catch (error) {
      if (error instanceof KnowledgeMaintenanceScanError) continue
      throw error
    }
    if (!candidateIds.has(bundle.manifest.id)) continue
    for (const event of survivingOutcomeEvents(bundle.events)) {
      if (event.observationId === undefined) continue
      if (!isAttributingType(event.type)) continue
      // First-wins, matching the dedupe law the surviving-events fold already applies: one
      // observation identity has one outcome, and a replayed line does not get a second vote.
      if (outcomes.has(event.observationId)) continue
      outcomes.set(event.observationId, event.type)
    }
  }
  return outcomes
}

/**
 * Answer, per served canary tuple, the observation id it would have been attributed under and the
 * committed outcome carrying that id — when one survives.
 *
 * An empty tuple list answers `[]` without touching the store: there is nothing to look up, and a
 * walk that could fail on an unrelated bundle would turn "you asked about nothing" into an error.
 */
export function canaryAttributionsFor(
  options: CanaryAttributionsForOptions,
): CanaryAttributionRow[] {
  if (options.tuples.length === 0) return []

  const outcomes = attributingOutcomesByObservationId(
    options.knowledgeRoot,
    new Set(options.tuples.map((tuple) => tuple.candidateId)),
  )

  return options.tuples.map((tuple) => {
    const observationId = canaryOutcomeObservationId({
      candidateId: asRecordId(tuple.candidateId),
      runId: options.runId,
      testId: tuple.testId,
      testIndex: tuple.testIndex,
      stepIndex: tuple.stepIndex,
    })
    const outcome = outcomes.get(observationId)
    return {
      candidateId: tuple.candidateId,
      testIndex: tuple.testIndex,
      stepIndex: tuple.stepIndex,
      observationId,
      ...(outcome === undefined ? {} : { outcome }),
    }
  })
}
