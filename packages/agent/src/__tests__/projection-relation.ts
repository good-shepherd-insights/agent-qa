// The relation between a declared contract and the projection published for it
// (Phase 384, Plan 11 — WR-02 / M-03).
//
// Not a test file (the suite collects `*.test.ts`), and not production code either: it is
// the shared half of an acceptance criterion that both agent test files state.
//
// WHY IT EXISTS. The gate it replaces asserted only the SHAPE of a projection — a plain
// object, a nonzero key count, one of `type`/`properties`/`anyOf`/`items`, no `parse`. The
// round-3 verifier replaced `toSchemaProjection`'s body with a frozen constant that
// discards its `schema` argument and the entire agent suite passed, 78/78. A criterion that
// a constant satisfies certifies nothing, and 396's MCP tool listing and 397's golden
// snapshot are both admitted through this one.
//
// The remedy is not a stricter shape check — it is writing the criterion as a RELATION
// between two artifacts. Every expected key set below is READ off the paired spec's own
// live zod shape with `Object.keys`; no field name, no key list and no per-id expected
// document appears anywhere in this file or in its callers. Two forms were falsified by the
// verifier and are deliberately absent: comparing projections to each other for
// distinctness (only 4 of 6 shipped projections are distinct, so a near-constant passes),
// and enumerating expected values by id (a seventh capability re-opens the hole).

import { expect } from 'vitest'
import type { z } from 'zod'

import { configGetSpec } from '../functions/ops/config-get.js'
import { knowledgeBundlesListSpec } from '../functions/ops/knowledge-bundles-list.js'
import { runsEventsSpec } from '../functions/ops/runs-events.js'
import { runsGetSpec } from '../functions/ops/runs-get.js'
import { runsListSpec } from '../functions/ops/runs-list.js'
import { runsStartSpec } from '../functions/ops/runs-start.js'

/** The live half of the pair: the zod contracts a spec declares, before any projection. */
export interface DeclaredContracts {
  readonly input: z.ZodType
  readonly output: z.ZodType
}

/**
 * Every spec singleton, keyed by the id its declaration is listed under.
 *
 * This map is a GROWTH SEAM, and both callers assert exact set equality between its keys
 * and the ids the registry lists — so a seventh capability added in 386 or 387 reddens both
 * files until its spec is paired here, rather than silently arriving with an unchecked
 * projection. It reproduces the discipline `INVOCATION_SAMPLES` already applies to calling.
 */
export const CONTRACTS_BY_ID: Readonly<Record<string, DeclaredContracts>> = {
  'config.get': configGetSpec,
  'knowledge.bundles.list': knowledgeBundlesListSpec,
  'runs.events': runsEventsSpec,
  'runs.get': runsGetSpec,
  'runs.list': runsListSpec,
  'runs.start': runsStartSpec,
}

/** A zod node's definition, read structurally so an unfamiliar kind degrades rather than throws. */
interface ZodNodeDef {
  type: string
  innerType?: unknown
  in?: unknown
  getter?: unknown
  element?: unknown
  options?: unknown
  left?: unknown
  right?: unknown
  shape?: unknown
}

const MAX_UNWRAP_STEPS = 32

function defOf(node: unknown): ZodNodeDef | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const def = (node as { def?: unknown }).def
  if (typeof def !== 'object' || def === null) return undefined
  const type = (def as { type?: unknown }).type
  return typeof type === 'string' ? (def as ZodNodeDef) : undefined
}

/**
 * Strip the wrappers that carry no key information.
 *
 * A `pipe` unwraps to its INPUT side, and the direction is load-bearing: `toSchemaProjection`
 * projects with `io: 'input'`, so the published document describes what a caller SENDS. That
 * is the opposite of the config visibility walker's rule, which reads the output side —
 * two modules, two correct answers, for two different questions.
 */
function unwrap(node: unknown): unknown {
  let current = node
  for (let step = 0; step < MAX_UNWRAP_STEPS; step++) {
    const def = defOf(current)
    if (def === undefined) return current
    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'nonoptional':
      case 'default':
      case 'prefault':
      case 'catch':
      case 'readonly':
        current = def.innerType
        break
      case 'lazy':
        if (typeof def.getter !== 'function') return current
        current = (def.getter as () => unknown)()
        break
      case 'pipe':
        current = def.in
        break
      default:
        return current
    }
  }
  return current
}

/** A property the caller may omit — exactly what JSON Schema leaves out of `required`. */
function isOptionalLike(node: unknown): boolean {
  const def = defOf(node)
  if (def === undefined) return false
  return def.type === 'optional' || def.type === 'default' || def.type === 'prefault'
}

function armsOf(def: ZodNodeDef): readonly unknown[] {
  if (Array.isArray(def.options)) return def.options
  if (def.left !== undefined || def.right !== undefined) {
    return [def.left, def.right].filter((arm) => arm !== undefined)
  }
  return []
}

/**
 * Assert that `projection` is derived from `schema` — the load-bearing acceptance criterion.
 *
 * Object roots: the projection's `properties` key set equals the zod shape's OWN key set,
 * and its `required` set equals the shape keys whose property is not optional-like. Array
 * roots: the projection carries `items` and the relation recurses into the element. Union
 * roots: the projection carries an option list of matching arity and the relation recurses
 * per arm. Both sides of every equality are computed from the values in hand.
 */
export function expectProjectionDerivedFrom(
  schema: unknown,
  projection: unknown,
  label: string,
): void {
  const def = defOf(unwrap(schema))
  if (def === undefined) throw new Error(`${label}: paired schema exposes no zod definition`)
  expect(typeof projection, label).toEqual('object')
  expect(projection, label).not.toBeNull()
  const document = projection as Record<string, unknown>

  if (def.type === 'object' || def.type === 'interface') {
    const shape = def.shape as Record<string, unknown> | undefined
    if (typeof shape !== 'object' || shape === null) {
      throw new Error(`${label}: object contract exposes no shape`)
    }
    const shapeKeys = Object.keys(shape)
    const properties = (document['properties'] ?? {}) as Record<string, unknown>
    expect(Object.keys(properties).sort(), `${label}.properties`).toEqual([...shapeKeys].sort())

    const published = (document['required'] ?? []) as readonly string[]
    expect([...published].sort(), `${label}.required`).toEqual(
      shapeKeys.filter((key) => !isOptionalLike(shape[key])).sort(),
    )
    return
  }

  if (def.type === 'array') {
    const items = document['items']
    if (items === undefined) throw new Error(`${label}: array contract projected without items`)
    expectProjectionDerivedFrom(def.element, items, `${label}[]`)
    return
  }

  if (def.type === 'union') {
    const arms = armsOf(def)
    const published = (document['anyOf'] ?? document['oneOf']) as unknown[] | undefined
    if (!Array.isArray(published)) {
      throw new Error(`${label}: union contract projected without an option list`)
    }
    expect(published.length, `${label}.anyOf arity`).toEqual(arms.length)
    arms.forEach((arm, index) => {
      expectProjectionDerivedFrom(arm, published[index], `${label}|${index}`)
    })
    return
  }

  // A scalar-rooted contract has no key set to relate. None of the twelve contracts this
  // phase registers is one; if a later phase declares one, the relation above is what needs
  // extending, and this clause is deliberately narrow so that is visible.
  expect(Object.keys(document).length, label).toBeGreaterThan(0)
}
