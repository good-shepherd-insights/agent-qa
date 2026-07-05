// Deterministic five-class stagnation classifier (Phase 358 · CYCLE-02 · D-02 · Pattern 2).
//
// CRITICAL: provider-neutral + storage-neutral. No Node builtin imports, no fs/sharp, no
// core/model/adapter package imports — a pure runner-side function, testable without the
// loop, keeping `validate:arch` green.
//
// classifyStagnation keys on TYPED SIGNALS ONLY — element roles, bounds, element state,
// settle-gate flags, and the fill re-read result. It NEVER switches on free element text
// (V5/injection posture): an element literally named "Loading" with no progressbar role and
// a settled screen is `unresponsive`, not `transient-load`. There is no LLM in the classifier
// (L9). Anything the typed rules cannot place falls through to `unresponsive` — the D-02
// unknown-track default (the planner then gets raw diff facts with no recommended remedy).

import type { ScreenState, ElementInfo, StagnationClass } from '@vostride/agent-qa-schema'
import type { ActionResult } from '../../platform.js'

export type { StagnationClass } from '@vostride/agent-qa-schema'

/**
 * The obstruction role set — a CLOSED const derived from what the shipped adapters
 * provably emit (research A1, verified by grepping adapter role vocabularies):
 *   - `dialog` / `alertdialog`: web (Playwright ARIA snapshot passes the authored role
 *     token through `parseAriaSnapshot`; `<dialog>` maps to `dialog`).
 *   - `alert`: mobile/iOS (`core/src/mobile/role-map.ts` maps `XCUIElementTypeAlert` and the
 *     Android xml-parser allow-lists `alert`).
 * Extend ONLY with roles an adapter provably mints — never a free-text heuristic.
 */
export const OBSTRUCTION_ROLES: ReadonlySet<string> = new Set(['dialog', 'alertdialog', 'alert'])

/**
 * The transient-load role set — the busy/progress indicators the adapters mint:
 * `progressbar` (web `<progress>`; mobile `ProgressBar` / `ProgressIndicator` /
 * `ActivityIndicator` all map to `progressbar`). Closed and evidence-derived.
 */
export const LOADING_ROLES: ReadonlySet<string> = new Set(['progressbar'])

export interface StagnationAnchor {
  role: string
  nameNormalized: string
  ordinal: number
}

export interface ClassifyStagnationInput {
  stateBefore: ScreenState
  stateAfter: ScreenState
  /** The target anchor (357 vocabulary) for the off-screen bounds check. */
  anchor?: StagnationAnchor
  /** The settle-gate outcome; `settled === false` is the poll-cap instability signal. */
  settleResult?: { settled: boolean }
  /** The action result; the fill re-read mismatch drives `input-didnt-land`. */
  actionResult?: ActionResult
}

function resolveAnchor(state: ScreenState, anchor: StagnationAnchor): ElementInfo | undefined {
  let seen = 0
  for (const el of state.elements) {
    if (el.role === anchor.role && el.nameNormalized === anchor.nameNormalized) {
      if (seen === anchor.ordinal) return el
      seen += 1
    }
  }
  return undefined
}

/** A new obstruction-role subtree appeared in the fresh state (present after, absent before). */
function hasNewObstruction(before: ScreenState, after: ScreenState): boolean {
  const beforeRoles = new Set(before.elements.map((e) => e.role))
  return after.elements.some((e) => OBSTRUCTION_ROLES.has(e.role) && !beforeRoles.has(e.role))
}

function hasLoadingRole(state: ScreenState): boolean {
  return state.elements.some((e) => LOADING_ROLES.has(e.role))
}

function isOutsideViewport(bounds: NonNullable<ElementInfo['bounds']>, meta: ScreenState['metadata']): boolean {
  return (
    bounds.y >= meta.viewportHeight ||
    bounds.x >= meta.viewportWidth ||
    bounds.y + bounds.height <= 0 ||
    bounds.x + bounds.width <= 0
  )
}

function fillRereadMismatch(actionResult?: ActionResult): boolean {
  const raw = actionResult?.metadata?.['fillReread']
  if (raw && typeof raw === 'object' && 'expected' in raw && 'actual' in raw) {
    const { expected, actual } = raw as Record<string, unknown>
    return typeof expected === 'string' && typeof actual === 'string' && expected !== actual
  }
  return false
}

/**
 * Classify a no-local-effect observation into one of the five ladder classes. Pure;
 * typed-signal precedence order: obstruction → off-screen → transient-load →
 * input-didnt-land → unresponsive (the D-02 unknown-track default).
 */
export function classifyStagnation(input: ClassifyStagnationInput): StagnationClass {
  const { stateBefore, stateAfter, anchor, settleResult, actionResult } = input

  // 1. Obstruction — a new dialog/alert-role subtree blocks the target.
  if (hasNewObstruction(stateBefore, stateAfter)) return 'obstruction'

  // 2. Off-screen — the anchor resolves but its bounds fall outside the viewport.
  if (anchor) {
    const target = resolveAnchor(stateAfter, anchor)
    if (target?.bounds && isOutsideViewport(target.bounds, stateAfter.metadata)) return 'off-screen'
  }

  // 3. Transient-load — a busy/progressbar role is present, OR the settle gate never
  //    quiesced (poll cap hit ⇒ settled:false).
  if (hasLoadingRole(stateAfter) || settleResult?.settled === false) return 'transient-load'

  // 4. Input-didn't-land — the §12.11 re-read annotation reports a value mismatch.
  if (fillRereadMismatch(actionResult)) return 'input-didnt-land'

  // 5. Unknown ⇒ unresponsive track (D-02).
  return 'unresponsive'
}
