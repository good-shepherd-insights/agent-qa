// `entities.resolve` — any reference in, a typed resolution out (Phase 387, ENTY-01 / D-09).
//
// The reference may be a short-ID, an `agentqa://` URI, or free text a human typed; the
// answer is one of exactly three arms — a hit, a small disambiguation set, or an honest miss.
// There is no fourth "best effort" arm, and that closed union is the never-guess contract in
// type form: a surface cannot render a maybe, because it is never handed one.
//
// The op does no resolution of its own. The injected directory port decides WHAT the answer
// is; this file's whole contribution is turning the store layer's descriptors into cards
// through the one producer, which is what makes the ENTY-02 claim hold at every surface that
// calls it (chat in 392, MCP in 396, the CLI here and now).

import {
  EntitiesResolveInputSchema,
  EntityCardResolutionSchema,
} from '@vostride/agent-qa-schema'
import type {
  EntitiesResolveInput,
  EntityCardResolution,
  EntityResolution,
} from '@vostride/agent-qa-schema'

import { produceEntityCard } from '../entity-cards/produce-card.js'
import { ENTITIES_RESOLVE_FUNCTION_ID } from './entities-ids.js'
import type { FunctionSpec } from '../spec.js'

export { ENTITIES_RESOLVE_FUNCTION_ID }

/**
 * Descriptor union → card union, arm for arm.
 *
 * Written as an exhaustive switch rather than a spread-and-patch so a fourth arm added to the
 * resolution vocabulary later is a compile error here instead of a silently unrendered case.
 */
function renderResolution(resolution: EntityResolution): EntityCardResolution {
  switch (resolution.kind) {
    case 'resolved':
      return {
        kind: 'resolved',
        card: produceEntityCard(resolution.descriptor),
        score: resolution.score,
      }
    case 'ambiguous':
      return {
        kind: 'ambiguous',
        candidates: resolution.candidates.map((candidate) => ({
          card: produceEntityCard(candidate.descriptor),
          score: candidate.score,
        })),
      }
    case 'none':
      return resolution
  }
}

export const entitiesResolveSpec: FunctionSpec<EntitiesResolveInput, EntityCardResolution> = {
  id: ENTITIES_RESOLVE_FUNCTION_ID,
  summary: 'Resolve any entity reference to a card, a disambiguation set, or an honest miss.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  input: EntitiesResolveInputSchema,
  output: EntityCardResolutionSchema,
  risk: { name: `fn:${ENTITIES_RESOLVE_FUNCTION_ID}`, recognized: true, readOnly: true },
  async invoke(input, deps) {
    // Read-tier despite D-01's lazy mint, and the distinction is deliberate: minting records
    // an ADDRESS for something that already existed. It creates no entity, changes no
    // knowledge, and is invisible in every projection except the one that hands out names.
    return renderResolution(await deps.entities.resolve(input.ref))
  },
}
