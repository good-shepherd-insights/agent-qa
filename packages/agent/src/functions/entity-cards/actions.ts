// The card's `actions[]` (Phase 387, ENTY-02 / D-11).
//
// A card's actions are REGISTRY OP REFS. A card can therefore only advertise capabilities the
// registry already contains, which is what makes an advertised action invokable identically
// over chat, CLI and MCP, subjects it to safe-mode listing filters for free, and lets 397's
// parity suite assert that every action any card offers actually resolves. A freeform action
// string would have been a second capability vocabulary — the private-power drift L10 exists
// to prevent — and there is deliberately no way to construct one here.

import type { ActionRef, EntityDescriptor } from '@vostride/agent-qa-schema'

import { ENTITIES_GET_FUNCTION_ID } from '../ops/entities-ids.js'

/** Every kind offers the card itself. Per-kind tables land in 387-07 Task 2. */
export function actionsForKind(descriptor: EntityDescriptor): ActionRef[] {
  return [
    {
      functionId: ENTITIES_GET_FUNCTION_ID,
      label: 'Open card',
      inputSeed: { ref: descriptor.shortId },
    },
  ]
}
