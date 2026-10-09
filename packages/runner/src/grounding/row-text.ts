// The row of an element (Phase 438, D-02 · RESEARCH Pattern 3): one definition on web, Android
// and iOS. CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports — imports only schema types.
//
// The row container of an element is its nearest ancestor (via hierarchy.parentRef) whose role is
// in ROW_CONTAINER_ROLES; when there is none, its nearest `cell` ancestor (iOS
// XCUIElementTypeCell maps to `cell`; on web a table cell is always found below its `row` first).
// Row text is the container's name, its folded static text, then every descendant's name and text
// in document order. No container means the row is unknown — never a contradiction (Android
// layout groups are filtered out of the observation, so a list row there has no container).
//
// Containment compares word tokens after NFKC and lowercasing. Each stated word must equal a row
// word or be a prefix (two or more characters) of a non-number row word; a number must match a row
// number exactly: 'Elm St' is in '7 Elm Street, Springfield', '7' is not in '17 Elm Street'.
//
// M2 injection boundary: row text is opaque comparison data only — never interpolated into a
// selector or an instruction, never evaluated, never used to search for an element.
//
// Pure functions: no recording, no side effects.

import type { ElementInfo, Ref } from '@vostride/agent-qa-schema'

export const ROW_CONTAINER_ROLES: readonly string[] = ['row', 'listitem', 'article', 'treeitem']

const FALLBACK_CONTAINER_ROLE = 'cell'

const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/u
const NUMBER_TOKEN = /^\p{N}+$/u
const MIN_PREFIX_LENGTH = 2

/** Word tokens of a text: NFKC, lowercased, split on every run that is not a letter or digit. */
export function wordTokens(text: string | undefined): string[] {
  if (text === undefined) return []
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(NOT_LETTER_OR_DIGIT)
    .filter((word) => word.length > 0)
}

function isNumber(word: string): boolean {
  return NUMBER_TOKEN.test(word)
}

function ancestorsOf(element: ElementInfo, byRef: Map<Ref, ElementInfo>): ElementInfo[] {
  const chain: ElementInfo[] = []
  const seen = new Set<Ref>([element.ref])
  let parentRef = element.hierarchy?.parentRef
  while (parentRef !== undefined && !seen.has(parentRef)) {
    seen.add(parentRef)
    const parent = byRef.get(parentRef)
    if (parent === undefined) break
    chain.push(parent)
    parentRef = parent.hierarchy?.parentRef
  }
  return chain
}

function rowContainerOf(
  element: ElementInfo,
  byRef: Map<Ref, ElementInfo>,
): ElementInfo | undefined {
  const chain = ancestorsOf(element, byRef)
  return (
    chain.find((ancestor) => ROW_CONTAINER_ROLES.includes(ancestor.role))
    ?? chain.find((ancestor) => ancestor.role === FALLBACK_CONTAINER_ROLE)
  )
}

function descendantsInOrder(
  container: ElementInfo,
  elements: readonly ElementInfo[],
  byRef: Map<Ref, ElementInfo>,
): ElementInfo[] {
  return elements.filter(
    (candidate) =>
      candidate.ref !== container.ref
      && ancestorsOf(candidate, byRef).some((ancestor) => ancestor.ref === container.ref),
  )
}

/**
 * The row text of an element in its observation, or undefined when the element has no row
 * container or the container's text is empty (D-02: the row is unknown).
 */
export function rowTextOf(
  element: ElementInfo,
  elements: readonly ElementInfo[],
): string | undefined {
  const byRef = new Map<Ref, ElementInfo>()
  for (const candidate of elements) byRef.set(candidate.ref, candidate)
  const container = rowContainerOf(element, byRef)
  if (container === undefined) return undefined

  const parts: string[] = [container.name, container.text ?? '']
  for (const descendant of descendantsInOrder(container, elements, byRef)) {
    parts.push(descendant.name, descendant.text ?? '')
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > 0 ? joined : undefined
}

/** Whether every stated row word is in the row text (equal, or a prefix of a non-number word). */
export function rowContains(rowText: string, statedRow: string): boolean {
  const rowWords = wordTokens(rowText)
  const statedWords = wordTokens(statedRow)
  if (statedWords.length === 0) return true
  return statedWords.every((stated) =>
    rowWords.some((word) => {
      if (word === stated) return true
      if (isNumber(stated) || isNumber(word)) return false
      return stated.length >= MIN_PREFIX_LENGTH && word.startsWith(stated)
    }),
  )
}
