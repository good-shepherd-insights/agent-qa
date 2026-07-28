// The schema-derived config visibility walker (Phase 384, Plan 10 — T-384-17, BL-02).
//
// The masker's disclosure rule is stated POSITIVELY and derived MECHANICALLY here: a
// configuration value is visible only where the schema constrains BOTH its key and its
// value type. Wherever the OPERATOR names the key — a record whose key type is an open
// string rather than a fixed set — and the schema accepts a free-form value under it, the
// key name carries no information about secrecy, so every path through that node is
// opaque. Walking the config schema yields that set instead of listing it, which is the
// whole point: the three free-form records this repo has today fall out of the walk, and
// so does a fourth on the day someone adds one, with no list to be wrong about.
//
// Three-valued on purpose, because "not declared free-form" and "declared constrained"
// are different claims:
//   - `constrained` — every segment resolved, and nothing on the way admitted a free-form
//     value. This is the ONLY class that earns visibility.
//   - `free-form`   — the walk reached an operator-named record with a free-form value, or
//     an unknown/any node. Masked unconditionally.
//   - `undeclared`  — the walk could not resolve the path at all. Masked too: a path the
//     schema does not describe is a path the schema does not vouch for. Every unrecognised
//     node shape lands here, so a walker gap over-masks rather than leaks.
//
// This module reads the schema as DATA. It receives the config schema as a runtime
// parameter and imports nothing but zod's public types, so it is legal under the FUNC-02
// surface firewall and needs no ledger entry — new-in-384 code must never need one.

import type { ZodType } from 'zod'

/** How the schema classifies one dot-path. Only `constrained` earns visibility. */
export type ConfigPathClass = 'constrained' | 'free-form' | 'undeclared'

export interface ConfigVisibilityOracle {
  /** The full verdict, for tests and diagnostics. */
  classify(dotPath: string): ConfigPathClass
  /**
   * True unless the schema constrains the key AND the value type for every segment.
   * Fail-closed: both `free-form` and `undeclared` are opaque.
   */
  isOpaque(dotPath: string): boolean
}

/**
 * A zod node's definition, read structurally.
 *
 * Zod 4 publishes `.def` on every schema; this reads it without asserting a concrete node
 * class, so an unrecognised `type` degrades to `undeclared` (masked) rather than throwing.
 */
interface ZodNodeDef {
  type: string
  innerType?: unknown
  getter?: unknown
  out?: unknown
  in?: unknown
  keyType?: unknown
  valueType?: unknown
  element?: unknown
  options?: unknown
  shape?: unknown
}

/** Guards against a schema that is cyclic through `z.lazy` or pathologically deep. */
const MAX_WALK_DEPTH = 64

function defOf(node: unknown): ZodNodeDef | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const def = (node as { def?: unknown }).def
  if (typeof def !== 'object' || def === null) return undefined
  const type = (def as { type?: unknown }).type
  return typeof type === 'string' ? (def as ZodNodeDef) : undefined
}

/**
 * Strip the wrappers that carry no key/value information of their own.
 *
 * `pipe` unwraps to its OUTPUT side, and that is load-bearing rather than incidental: the
 * config schema's root is a retired-key pre-scan piped into the strict object, and the
 * pre-scan's input side is `z.any()`. A walker that unwrapped a pipe to its input would
 * classify the ENTIRE configuration as free-form, mask every value, and make every leak
 * assertion pass for the wrong reason. The oracle tests therefore carry a known-visible
 * positive control beside every leak case.
 */
function unwrap(node: unknown, depth: number): unknown {
  let current = node
  for (let step = depth; step < MAX_WALK_DEPTH; step++) {
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
        current = def.out
        break
      default:
        return current
    }
  }
  return current
}

function optionsOf(def: ZodNodeDef): readonly unknown[] {
  return Array.isArray(def.options) ? def.options : []
}

/**
 * True when the OPERATOR chooses this record's keys.
 *
 * An open string key type means the name is the operator's, so the name is not evidence
 * of anything. A fixed key set (an enum or literal) is the schema naming the key, which is
 * what makes the key half of the visibility rule decidable. Unrecognised key shapes count
 * as operator-named, which is the fail-closed direction.
 */
function isOperatorNamedKey(node: unknown, depth: number): boolean {
  const def = defOf(unwrap(node, depth))
  if (def === undefined) return true
  if (def.type === 'enum' || def.type === 'literal') return false
  if (def.type === 'union') {
    return optionsOf(def).some((option) => isOperatorNamedKey(option, depth + 1))
  }
  return true
}

/**
 * True when the schema accepts a free-form value here.
 *
 * `unknown`/`any` is the obvious case. A bare primitive is the same case in practice: a
 * record of operator-named keys onto arbitrary strings constrains the SHAPE of the value
 * and nothing about its content, which is exactly how a provider-headers map carries a
 * credential. A structured container (object, record, array) is NOT free-form — the walk
 * descends into it instead, so a constrained leaf under an operator-named record stays
 * visible. A union is free-form when ANY of its options is.
 */
function admitsFreeFormValue(node: unknown, depth: number): boolean {
  if (depth >= MAX_WALK_DEPTH) return true
  const def = defOf(unwrap(node, depth))
  if (def === undefined) return true
  switch (def.type) {
    case 'object':
    case 'interface':
    case 'record':
    case 'array':
    case 'tuple':
    case 'map':
    case 'set':
      return false
    case 'union':
    case 'intersection':
      return optionsOf(def).some((option) => admitsFreeFormValue(option, depth + 1))
    default:
      return true
  }
}

const NUMERIC_SEGMENT = /^\d+$/u

function classifyFrom(
  node: unknown,
  segments: readonly string[],
  depth: number,
): ConfigPathClass {
  if (depth >= MAX_WALK_DEPTH) return 'undeclared'
  const def = defOf(unwrap(node, depth))
  if (def === undefined) return 'undeclared'

  // Landing on, or passing through, an unconstrained value ends the walk: everything at or
  // below it is the operator's own data.
  if (def.type === 'unknown' || def.type === 'any') return 'free-form'

  if (def.type === 'union') {
    // A path is constrained if it is constrained under SOME option — the plugin
    // declaration union is `{ package } | { path }`, and either arm is a real declaration.
    let verdict: ConfigPathClass = 'undeclared'
    for (const option of optionsOf(def)) {
      const optionVerdict = classifyFrom(option, segments, depth + 1)
      if (optionVerdict === 'constrained') return 'constrained'
      if (optionVerdict === 'free-form') verdict = 'free-form'
    }
    return verdict
  }

  if (def.type === 'record') {
    // The rule, in one place: operator-named key + free-form value = opaque, for the record
    // itself and for everything beneath it. Otherwise the operator's key is consumed and
    // the walk descends into the structured value, so `registry.devices.<name>.platform`
    // stays visible while `registry.devices.<name>.match.<anything>` does not.
    if (
      isOperatorNamedKey(def.keyType, depth + 1)
      && admitsFreeFormValue(def.valueType, depth + 1)
    ) {
      return 'free-form'
    }
    if (segments.length === 0) return 'constrained'
    return classifyFrom(def.valueType, segments.slice(1), depth + 1)
  }

  if (segments.length === 0) return 'constrained'

  if (def.type === 'object' || def.type === 'interface') {
    const shape = def.shape
    if (typeof shape !== 'object' || shape === null) return 'undeclared'
    const child = (shape as Record<string, unknown>)[segments[0]!]
    if (child === undefined) return 'undeclared'
    return classifyFrom(child, segments.slice(1), depth + 1)
  }

  if (def.type === 'array') {
    if (!NUMERIC_SEGMENT.test(segments[0]!)) return 'undeclared'
    return classifyFrom(def.element, segments.slice(1), depth + 1)
  }

  // Segments remain but the node is a leaf: the path is not one the schema describes.
  return 'undeclared'
}

/**
 * Walk a config schema once and return the oracle the masker consults per entry.
 *
 * The walk is LIVE against whatever schema is handed in — there is no snapshot of node
 * names and no list of known free-form paths — so the day the schema grows another
 * operator-named record, the masker covers it without being edited.
 */
export function buildConfigVisibilityOracle(schema: ZodType): ConfigVisibilityOracle {
  const cache = new Map<string, ConfigPathClass>()

  function classify(dotPath: string): ConfigPathClass {
    const cached = cache.get(dotPath)
    if (cached !== undefined) return cached
    const segments = dotPath === '' ? [] : dotPath.split('.')
    const verdict = classifyFrom(schema, segments, 0)
    cache.set(dotPath, verdict)
    return verdict
  }

  return {
    classify,
    isOpaque(dotPath: string): boolean {
      return classify(dotPath) !== 'constrained'
    },
  }
}
