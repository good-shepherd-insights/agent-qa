// Pure toggle/picker idempotency comparator (Phase 359 · EXEC-04 · D-14/D-15 · spec §12.13).
//
// CRITICAL: provider-neutral + storage-neutral. No driver imports, no node:* imports, no live
// probes. Judges ONLY the persisted grounded observation (the same settled ScreenState the
// planner grounded against, Pitfall 10) — never re-observes. Suppresses an action on POSITIVE
// evidence only (D-15): a missing/undefined state never satisfies. The dispatch-seam wiring
// (D-14) and the D-16 oracle read land in Plan 08; this is the comparator they call.

import type { ScreenState } from '@vostride/agent-qa-schema'
import type { IdempotentNoopMeta } from './metadata.js'

export type DesiredState = 'checked' | 'unchecked' | 'selected' | 'unselected'

export interface DesiredStateAction {
  type: string
  ref?: string
  desiredState?: DesiredState
  value?: string
}

const PICKER_TYPES = new Set(['select', 'nativeSelect', 'pickerSelect'])

export function desiredStateSatisfied(
  action: DesiredStateAction,
  screenState: ScreenState,
): IdempotentNoopMeta | undefined {
  if (action.ref === undefined) return undefined
  const element = screenState.elements.find((el) => el.ref === action.ref)
  if (!element) return undefined

  if ((action.type === 'tap' || action.type === 'click') && action.desiredState) {
    switch (action.desiredState) {
      case 'checked':
        return element.state.checked === true ? { currentState: 'checked' } : undefined
      case 'unchecked':
        return element.state.checked === false ? { currentState: 'unchecked' } : undefined
      case 'selected':
        return element.state.selected === true ? { currentState: 'selected' } : undefined
      case 'unselected':
        return element.state.selected === false ? { currentState: 'unselected' } : undefined
    }
  }

  if (PICKER_TYPES.has(action.type) && action.value !== undefined) {
    if (element.value !== undefined && element.value === action.value) {
      return { currentState: element.value }
    }
  }

  return undefined
}
