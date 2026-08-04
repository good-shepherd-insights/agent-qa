// The anchor-extraction walk moved to schema (Phase 389, D-13) — this module re-exports it.
//
// `exercisedAnchors` and its helpers are pure over schema types and now have consumers on
// both sides of the package graph (the agent-side cluster function, 390's recurrence window,
// and this tail), so the ONE implementation lives in
// `@vostride/agent-qa-schema`'s identity module and every existing CLI call site keeps
// compiling unchanged through these re-exports. Only `elementNaturalKey` stays local: it is
// this tail's own display key, consumed nowhere else.

import type { ResolvedElementEvidence } from '@vostride/agent-qa-schema'

export {
  actionRefs,
  classifySubActionRoute,
  elementAnchor,
  exercisedAnchors,
  resolvedElementEvidence,
  uniqueAnchors,
} from '@vostride/agent-qa-schema'
export type { ClassifiedRoute, ResolvedElementEvidence } from '@vostride/agent-qa-schema'

export function elementNaturalKey(evidence: ResolvedElementEvidence): string {
  return `${evidence.element.role}:${evidence.element.nameNormalized}:${evidence.ordinal}`
}
