// Descriptor-only value projection (Phase 356, CACHE-03 / D-12).
// CRITICAL: storage-neutral — no node:* imports. Projects a planned action + the
// fresh elements into a role+nameNormalized(+ordinal) descriptor and assembles a
// CachedPlanValue that provably omits raw refs/selectors/coordinates and any step
// `data` value (the overfit guard: nothing run-specific survives into the cache).

import type { ElementInfo } from '@vostride/agent-qa-schema'
import type { Action } from '../platform.js'
import type { CachedPlanValue, GroundedLocator } from './port.js'

export type { CachedPlanValue, GroundedLocator } from './port.js'

// Fields that would overfit a cached plan to one run: locator bindings (single- AND
// multi-ref lanes + emission-side target descriptors) and the raw step data value.
// Stripped from every stored planned action so nothing run-specific ever persists —
// grounding is carried SOLELY by the descriptor locators (D-12, Pitfall 5).
const OVERFIT_KEYS = new Set([
  'ref',
  'fromRef',
  'toRef',
  'target',
  'fromTarget',
  'toTarget',
  'selector',
  'coordinates',
  'coords',
  'x',
  'y',
  'center',
  'bounds',
  'data',
])

// The ordered multi-ref lanes of a drag (Pitfall 5a): one locator per ref field,
// fromRef before toRef, so replay re-resolves BOTH in a stable order.
const MULTI_REF_LANES = ['fromRef', 'toRef'] as const

function actionRef(action: Action): string | undefined {
  const ref = (action as { ref?: unknown }).ref
  return typeof ref === 'string' ? ref : undefined
}

function fieldRef(action: Action, field: string): string | undefined {
  const ref = (action as Record<string, unknown>)[field]
  return typeof ref === 'string' ? ref : undefined
}

function locatorForRef(ref: string, elements: readonly ElementInfo[]): GroundedLocator | null {
  const target = elements.find((element) => element.ref === ref)
  if (target === undefined) return null

  const siblings = elements.filter(
    (element) =>
      element.role === target.role && element.nameNormalized === target.nameNormalized,
  )
  const ordinal = siblings.indexOf(target)

  return { role: target.role, nameNormalized: target.nameNormalized, ordinal }
}

function sanitizeAction(action: Action): Action {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(action)) {
    if (OVERFIT_KEYS.has(key)) continue
    out[key] = value
  }
  return out as Action
}

/**
 * Project a planned action's target element to a descriptor-only locator. Returns
 * null when the action targets no element (e.g. navigate) or the ref no longer
 * resolves. The ordinal is the target's position among same role+nameNormalized
 * elements in the current observation order — never a stored/reused index.
 */
export function toGroundedLocator(
  action: Action,
  elements: readonly ElementInfo[],
): GroundedLocator | null {
  const ref = actionRef(action)
  if (ref === undefined) return null
  return locatorForRef(ref, elements)
}

/**
 * Derive the ordered per-lane descriptor locators for an action (Pitfall 5). A drag
 * yields one locator per ref field (fromRef, toRef order-stable) so replay re-resolves
 * BOTH; a single-ref action yields one locator; a coordinate/ref-less action yields
 * none. A drag whose lanes cannot all be grounded yields a partial list — replay treats
 * a locator-count shortfall as non-replayable (invalidate → replan).
 */
export function deriveLaneLocators(
  action: Action,
  elements: readonly ElementInfo[],
): GroundedLocator[] {
  if ((action as { type?: unknown }).type === 'drag') {
    const locators: GroundedLocator[] = []
    for (const field of MULTI_REF_LANES) {
      const ref = fieldRef(action, field)
      if (ref === undefined) break
      const locator = locatorForRef(ref, elements)
      if (locator === null) break
      locators.push(locator)
    }
    return locators
  }
  const single = toGroundedLocator(action, elements)
  return single !== null ? [single] : []
}

export interface BuildCachedPlanValueInput {
  plannedActions: readonly Action[]
  elements: readonly ElementInfo[]
  verificationOutcome: 'passed' | 'failed'
}

/**
 * Assemble a descriptor-only CachedPlanValue. Planned actions are sanitized of every
 * locator binding and step `data` value; grounding is carried solely by the
 * descriptor locators so nothing run-specific is ever persisted (D-12 overfit guard).
 */
export function buildCachedPlanValue(input: BuildCachedPlanValueInput): CachedPlanValue {
  const groundedLocator: GroundedLocator[] = []
  for (const action of input.plannedActions) {
    groundedLocator.push(...deriveLaneLocators(action, input.elements))
  }

  return {
    plannedActions: input.plannedActions.map(sanitizeAction),
    groundedLocator,
    verificationOutcome: input.verificationOutcome,
  }
}
