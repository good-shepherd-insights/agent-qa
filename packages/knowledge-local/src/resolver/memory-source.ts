// The MEM entity sighting source (Phase 387, plan 01 — the tracer's one wired kind).
//
// Reads through the same read-only bundle listing `knowledge.bundles.list` serves, so a
// memory entity the catalog shows and a memory entity the resolver can sight are the same
// set by construction rather than by two enumerations that agree today.
//
// Deliberately UNFILTERED by serving lifecycle, matching `listBundles`: a superseded or
// withdrawn record still has a permanent address and must still resolve (D-04). The card's
// status is what says what happened to it.

import { listBundles } from '../list-bundles.js'
import type { EntitySighting, EntitySightingSource } from './resolve.js'

/**
 * Bundle status vocabulary → the `MEM` card vocabulary (`active | tombstoned | forgotten`).
 *
 * The mapping is a TABLE and not a passthrough because the two vocabularies are genuinely
 * different: the knowledge store tracks a record's trust lifecycle, and a card reports
 * whether the thing an address names is still standing. Anything this table does not name
 * maps to `active`, which is honest for a record that exists and is not tombstoned; the
 * schema boundary is what refuses a status this table could produce but `MEM` does not
 * declare, and 387-07's per-kind projections widen it against real store states.
 */
const TOMBSTONED_BUNDLE_STATUSES: readonly string[] = ['withdrawn', 'superseded', 'retired']

function memoryStatusFor(bundleStatus: string): string {
  return TOMBSTONED_BUNDLE_STATUSES.includes(bundleStatus) ? 'tombstoned' : 'active'
}

/** Build the MEM sighting source over a knowledge root. */
export function createMemorySightingSource(
  resolveKnowledgeRoot: () => string,
): EntitySightingSource {
  function find(machineId: string): EntitySighting | undefined {
    for (const row of listBundles(resolveKnowledgeRoot())) {
      // EXACT equality. This leg is addressing, not search: a prefix or case-insensitive
      // comparison here would be tier (b) smuggled in below the never-guess contract.
      if (row.bundleId !== machineId) continue
      return {
        machineId: row.bundleId,
        title: row.summary,
        statusSource: memoryStatusFor(row.status),
      }
    }
    return undefined
  }

  return {
    kind: 'MEM',
    sight: find,
    // Sighting and hydration are the same lookup for MEM: a bundle id IS the machine id, so
    // there is no second index to consult. They stay two members on the port because for
    // RUN and TST (387-03) they will not be.
    hydrate: find,
  }
}
