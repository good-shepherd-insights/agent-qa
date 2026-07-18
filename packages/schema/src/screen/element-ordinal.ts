import type { ElementInfo } from './element-info'

/**
 * Return an element's document-order ordinal among elements with the same role and normalized
 * accessible name. Callers must pass the live screen's element list containing `element`.
 */
export function elementOrdinal(
  element: ElementInfo,
  elements: readonly ElementInfo[],
): number {
  let ordinal = 0
  for (const candidate of elements) {
    if (
      candidate.role !== element.role
      || candidate.nameNormalized !== element.nameNormalized
    ) {
      continue
    }
    if (candidate.ref === element.ref) return ordinal
    ordinal += 1
  }
  return ordinal
}
