// The declaration's contract projection (Phase 384, Plan 09 — BL-01 / D-14 / T-384-14).
//
// One pure function: take a live zod schema, hand back an inert JSON-Schema document that
// nothing can run and nothing can rewrite. `declarationView` calls it so a listing carries
// a DESCRIPTION of the contract rather than a handle on the validator that enforces it.
//
// Depends on zod alone. It reaches for no port, no host builtin and no sibling module other
// than the contract types, which is why the surface firewall has nothing to say about it.

import { z } from 'zod'

import type { FunctionSchemaProjection } from './spec.js'

/**
 * Freeze a value and everything reachable through its own enumerable properties.
 *
 * Shallow freezing is not enough and the difference is the whole defect: sealing the top
 * object leaves every nested schema node writable, so the escape simply moves one level
 * down. The `seen` set keeps the walk terminating on a self-referential document — zod
 * emits `$ref` strings rather than object cycles today, but a guard that depends on that
 * staying true would be one library release away being wrong.
 */
function deepFreeze<Value>(value: Value, seen: WeakSet<object>): Value {
  if (typeof value !== 'object' || value === null) return value

  const node = value as unknown as object
  if (seen.has(node)) return value
  seen.add(node)

  for (const nested of Object.values(node as Record<string, unknown>)) {
    deepFreeze(nested, seen)
  }
  return Object.freeze(value)
}

/**
 * Project one declared contract into the inert form a listing publishes.
 *
 * `io: 'input'` is used for BOTH sides on purpose. Several contracts here are built over
 * branded ids whose zod definition carries a transform, and zod refuses to represent a
 * transform in its default output mode — measured over all twelve schemas this phase
 * registers (six inputs, six outputs): `input` mode succeeds for every one of them, while
 * `output` mode throws for six. Since `declarationView` runs for every registered spec on
 * every `list()` call, a mode that throws for any single schema would break listing for
 * every caller, so the mode that succeeds universally is the only correct choice. The
 * resulting document is the wire shape a caller would send or receive, which is also the
 * shape an MCP tool listing wants.
 */
export function toSchemaProjection(schema: z.ZodType): FunctionSchemaProjection {
  const projected = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  return deepFreeze(projected, new WeakSet())
}
