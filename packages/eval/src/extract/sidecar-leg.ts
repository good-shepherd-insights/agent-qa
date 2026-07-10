import type { Action, ElementInfo, SubActionEvidence } from '@vostride/agent-qa-schema'
import type {
  CassetteSidecarLeg,
  GoldAnchorDescriptor,
} from '../cassette/sidecar-leg'

export interface ProjectSidecarLegInput {
  subAction: SubActionEvidence
}

export interface ProjectSidecarLegResult {
  leg: CassetteSidecarLeg
  anchorUnresolved: boolean
}

function actionRef(action: Action): string | undefined {
  return 'ref' in action && typeof action.ref === 'string' ? action.ref : undefined
}

function actionValue(action: Action): string | undefined {
  switch (action.type) {
    case 'fill':
      return action.text
    case 'select':
    case 'nativeSelect':
      return action.value
    case 'pickerSelect':
      return 'value' in action ? action.value : undefined
    default:
      return undefined
  }
}

function anchorDescriptor(
  element: ElementInfo,
  elements: readonly ElementInfo[],
): GoldAnchorDescriptor {
  let ordinal = 0
  for (const candidate of elements) {
    if (
      candidate.role !== element.role ||
      candidate.nameNormalized !== element.nameNormalized
    ) {
      continue
    }
    if (candidate.ref === element.ref) break
    ordinal += 1
  }

  return {
    role: element.role,
    nameNormalized: element.nameNormalized,
    ordinal,
    ref: element.ref,
  }
}

function equivalenceSet(
  goldElement: ElementInfo,
  elements: readonly ElementInfo[],
): readonly GoldAnchorDescriptor[] {
  const descriptors: GoldAnchorDescriptor[] = [anchorDescriptor(goldElement, elements)]
  const linkedRefs = [
    ...(goldElement.hierarchy?.parentRef === undefined
      ? []
      : [goldElement.hierarchy.parentRef]),
    ...(goldElement.hierarchy?.childRefs ?? []),
  ]
  const seen = new Set<string>([goldElement.ref])

  for (const linkedRef of linkedRefs) {
    if (seen.has(linkedRef)) continue
    const linkedElement = elements.find((element) => element.ref === linkedRef)
    if (linkedElement === undefined) continue
    seen.add(linkedRef)
    descriptors.push(anchorDescriptor(linkedElement, elements))
  }

  return descriptors
}

/**
 * Projects matcher evidence without interpreting operation aliases or gates; Phase 369 owns
 * that policy and receives the recorded action verb verbatim as `opClass`.
 */
export function projectSidecarLeg({
  subAction,
}: ProjectSidecarLegInput): ProjectSidecarLegResult {
  const ref = actionRef(subAction.plannedAction)
  const goldElement = ref === undefined
    ? undefined
    : subAction.stateBefore.elements.find((element) => element.ref === ref)
  const goldAnchor = goldElement === undefined
    ? undefined
    : anchorDescriptor(goldElement, subAction.stateBefore.elements)
  const goldValue = actionValue(subAction.plannedAction)
  const annotation = subAction.result.annotation

  return {
    leg: {
      goldAction: subAction.plannedAction,
      opClass: subAction.plannedAction.type,
      ...(goldValue === undefined ? {} : { goldValue }),
      ...(goldAnchor === undefined ? {} : { goldAnchor }),
      equivalenceSet: goldElement === undefined
        ? []
        : equivalenceSet(goldElement, subAction.stateBefore.elements),
      ...(annotation === undefined ? {} : { annotation }),
    },
    anchorUnresolved: ref !== undefined && goldElement === undefined,
  }
}
