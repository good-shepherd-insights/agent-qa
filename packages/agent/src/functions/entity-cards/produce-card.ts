// THE entity card producer (Phase 387, ENTY-02 / D-10 / D-11 / D-12).
//
// One producer, in the function layer, and every surface's card is its output. That is not a
// tidiness claim — it is what makes the chat card, the MCP `structuredContent` and M5's UI
// *projections* rather than three renderers that agree until one of them is edited. The
// claim is testable precisely because the store layer has no vocabulary for a card at all:
// `knowledge-local` returns descriptors, and the only code in this repo that builds an
// `EntityCard` is this file.
//
// RENDER, never recompute — the discipline `knowledge.bundles.list` established for derived
// trust fields, applied to entity state. The owning store decided what an entity's status
// is; this function's job is to carry that decision into the card vocabulary and to REFUSE
// rather than repair a status the kind does not declare. `EntityCardSchema.parse` is where
// that refusal happens (D-12), so an unrecognised store state surfaces as a named contract
// failure at the seam instead of as a card that quietly reads `active`.

import { EntityCardSchema, formatEntityUri } from '@vostride/agent-qa-schema'
import type { ActionRef, EntityCard, EntityDescriptor, KeyFact } from '@vostride/agent-qa-schema'

import { ENTITIES_GET_FUNCTION_ID } from '../ops/entities-ids.js'

/**
 * The card's `actions[]` are REGISTRY OP REFS (D-11).
 *
 * A card can therefore only advertise capabilities the registry already contains, which is
 * what makes an advertised action invokable identically over chat, CLI and MCP, subjects it
 * to safe-mode listing filters for free, and lets 397's parity suite assert that every action
 * any card offers actually resolves. A freeform action string would have been a second
 * capability vocabulary — the private-power drift L10 exists to prevent — and there is
 * deliberately no way to construct one here.
 */
function actionsFor(descriptor: EntityDescriptor): ActionRef[] {
  return [
    {
      functionId: ENTITIES_GET_FUNCTION_ID,
      label: 'Open card',
      inputSeed: { ref: descriptor.shortId },
    },
  ]
}

/**
 * Deterministic facts computed from store data — never LLM-authored (D-12).
 *
 * The tracer stage carries the one fact that is true of every kind: the machine id the
 * address maps FROM, which is what a QA engineer needs in order to correlate a short-ID with
 * a log line, a directory name or a bundle id. Per-kind projections (a run's verdict, a
 * test's last failure, a target's rename) expand in 387-07 and expand HERE, without the
 * producer moving.
 */
function keyFactsFor(descriptor: EntityDescriptor): KeyFact[] {
  const facts: KeyFact[] = [{ label: 'machine id', value: descriptor.machineId }]
  if (descriptor.successorMachineId !== undefined) {
    // D-03's "with its rename visible", made literal. The old address keeps resolving to the
    // old name — anything else would make an existing CI log's reference quietly mean a
    // different target — and the card is where the reader learns what it became.
    facts.push({
      label: 'renamed to',
      value: descriptor.successorMachineId,
      ref: formatEntityUri(descriptor.kind, `${descriptor.kind}-${descriptor.successorMachineId}`),
    })
  }
  return facts
}

/**
 * Render one descriptor as the one card shape.
 *
 * `url` is ABSENT (D-10). The producer would compute it from a configured dashboard base URL
 * using the pinned route shape, and v52 configures none — so rather than emitting a link to a
 * route nothing serves, the field is omitted. M5 turns it on by setting config; neither the
 * schema nor this function changes.
 */
export function produceEntityCard(descriptor: EntityDescriptor): EntityCard {
  return EntityCardSchema.parse({
    kind: descriptor.kind,
    id: descriptor.shortId,
    // Recomputed from the address rather than copied off the descriptor: the URI and the
    // short-ID are two spellings of ONE address, and deriving one from the other is what
    // stops a card from ever carrying two that disagree.
    uri: formatEntityUri(descriptor.kind, descriptor.shortId),
    title: descriptor.title,
    status: descriptor.statusSource,
    keyFacts: keyFactsFor(descriptor),
    actions: actionsFor(descriptor),
  }) as EntityCard
}
