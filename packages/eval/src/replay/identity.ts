import type { Action, ElementInfo } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'

/**
 * D-11 normalized decision identity — the ONE tier-2 equivalence vocabulary (op-class +
 * resolved same-screen target + normalized value). It is defined once here in eval core;
 * Phase 369's matcher MUST import this rather than mint a second equivalence. `target` is
 * legitimately absent for coordinate-only ops or an unresolvable ref; `value` is typed-absent
 * for non-value-bearing ops and is never fabricated. The `ref` is used only to resolve
 * role/nameNormalized/ordinal — the raw ref never enters the identity.
 */
export interface DecisionIdentity {
  opClass: string
  target?: { role: string; nameNormalized: string; ordinal: number }
  value?: string
}

function resolveTarget(
  action: Action,
  elements: readonly ElementInfo[],
): DecisionIdentity['target'] {
  const view = action as unknown as Record<string, unknown>
  const ref = typeof view.ref === 'string' ? view.ref : undefined
  if (ref === undefined) return undefined
  const element = elements.find(candidate => candidate.ref === ref)
  if (element === undefined) return undefined
  // Ordinal among same role + nameNormalized siblings in elements order — the exact
  // resolveActionAnchorKey precedent (runner planner.ts). Identity keys on this, never the ref.
  const ordinal = elements
    .filter(candidate => candidate.role === element.role && candidate.nameNormalized === element.nameNormalized)
    .findIndex(candidate => candidate.ref === element.ref)
  if (ordinal < 0) return undefined
  return { role: element.role, nameNormalized: element.nameNormalized, ordinal }
}

/**
 * The ONE D-03 value normalization shared by identity grouping and the matcher value axis:
 * trim, casefold, then collapse internal whitespace. Tokenization and F1 remain in
 * match/value.ts so this primitive owns vocabulary normalization only.
 */
export function normalizeValueText(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Normalize a value-bearing action's payload through the shared D-03 value vocabulary.
 * Returns undefined for non-value-bearing ops (typed-absent, never fabricated).
 */
export function normalizeIdentityValue(action: Action): string | undefined {
  const view = action as unknown as Record<string, unknown>
  const raw =
    typeof view.value === 'string'
      ? view.value
      : typeof view.text === 'string'
        ? view.text
        : undefined
  return raw === undefined ? undefined : normalizeValueText(raw)
}

/**
 * Resolve one recorded/replayed action into its normalized decision identity against the
 * observation elements it was grounded on. Coordinate-only ops and unresolvable refs yield a
 * target-absent identity (opClass still present).
 */
export function computeDecisionIdentity(
  action: Action,
  elements: readonly ElementInfo[],
): DecisionIdentity {
  const target = resolveTarget(action, elements)
  const value = normalizeIdentityValue(action)
  return {
    opClass: action.type,
    ...(target === undefined ? {} : { target }),
    ...(value === undefined ? {} : { value }),
  }
}

/** Canonical, construction-order-independent key for grouping identities in a map (Task 1 reuse). */
export function decisionIdentityKey(identity: DecisionIdentity): string {
  return canonicalJson(identity)
}
