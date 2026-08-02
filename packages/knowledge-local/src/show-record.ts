// `showRecord` — one committed record with the provenance that justifies it (Phase 387, KREV-01).
//
// WIRING, in the sense KREV-01's claim requires: every value here is read off the bundle the
// maintenance scanner already loads, and the view is the SAME projection `inspectRecords`
// renders (`toInspectRecordView`), not a second one written to the same description. No index
// is opened, no query is run, and nothing about trust is recomputed — `deriveBundleTrust` is
// the one fold and this module calls it exactly as its sibling does.
//
// Two decisions are worth stating because they are not the obvious ones.
//
// ABSENCE IS A RESULT. A record id that names no committed bundle is an ordinary reviewer
// question — an id pasted out of a stale issue, a record forgotten between two reads — and it
// has to be distinguishable from a store that could not be read at all. So the miss is a typed
// arm and the unreadable store still throws.
//
// THE SERVING FIREWALL DOES NOT APPLY. `inspectRecords` withholds non-servable records from an
// UNQUALIFIED query, which is right for a listing. Addressing one record by its exact id is not
// an unqualified query: it is the explicit gesture that function's own contract admits, and
// D-04's law is that a permanent address always resolves to something whose status says what
// happened to it. Hiding a superseded record from someone who named it would answer "there is
// no such record" about a record that plainly exists.

import { KnowledgeRecordShowResultSchema } from '@vostride/agent-qa-schema'
import type { KnowledgeRecordShowResult } from '@vostride/agent-qa-schema'

import { deriveBundleTrust } from './bundle-read.js'
import { toInspectRecordView } from './inspect.js'
import {
  enumerateMaintenanceBundleDirs,
  loadMaintenanceBundle,
} from './maintenance-scan.js'

export interface ShowRecordOptions {
  knowledgeRoot: string
  recordId: string
}

/**
 * Show one record, or report by name that nothing is committed under that id.
 *
 * A knowledge root with no bundles — or no `memory/` directory at all — is an ordinary
 * `not-found`, because the enumerator already treats a missing tree as empty. That is the
 * FUNC-04 empty edge: an empty store answers, it does not throw.
 */
export function showRecord(options: ShowRecordOptions): KnowledgeRecordShowResult {
  for (const entry of enumerateMaintenanceBundleDirs(options.knowledgeRoot)) {
    const bundle = loadMaintenanceBundle(entry)
    if (bundle.manifest.id !== options.recordId) continue

    return KnowledgeRecordShowResultSchema.parse({
      kind: 'found',
      schemaVersion: 1,
      record: toInspectRecordView(entry, bundle, deriveBundleTrust(bundle)),
      // The bundle's own committed provenance, verbatim. A record shown without it is an
      // assertion; shown with it, it is evidence — and paraphrasing it here would have made
      // this module a second author of a claim the bundle already makes about itself.
      provenance: bundle.provenance,
      summary: bundle.summary,
      body: bundle.body,
    })
  }

  return KnowledgeRecordShowResultSchema.parse({
    kind: 'not-found',
    schemaVersion: 1,
    recordId: options.recordId,
  })
}
