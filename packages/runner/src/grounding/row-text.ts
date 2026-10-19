// The row of an element (Phase 438, D-02 · RESEARCH Pattern 3): one definition on web, Android
// and iOS. CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports — imports only schema types.
//
// The row container of an element is the element itself when its role is in ROW_CONTAINER_ROLES,
// else its nearest ancestor (via hierarchy.parentRef) in ROW_CONTAINER_ROLES; when neither exists,
// the element itself when it is a `cell`, else its nearest `cell` ancestor (iOS
// XCUIElementTypeCell maps to `cell`; on web a table cell is always found below its `row` first).
// A row container is its own row (438 gap round, WR-04), so a clicked listitem or row is checked
// against its own row words. Row text is the container's name, its folded static text, then every
// descendant's name and text in document order. A row container that is the element itself then
// carries the own line (name and folded text) of every enclosing container of its own role,
// nearest first, so `2025 > Invoices` reads 'Invoices 2025' and `Invoices > 2025 > Q1` reads
// 'Q1 2025 Invoices' (438 gap round 2, WR-10; 444.1 D-15, D-17). The row's own line comes first,
// so a length cap keeps it; an enclosing container of another role (an article around a table
// row) never joins, so its prose never moves the row; and no other descendant of an enclosing
// container joins, so a sibling row's words never join.
// No container means the row is unknown — never a contradiction (Android layout groups are
// filtered out of the observation, so a list row there has no container). strictMatch, the cache
// locator's row lift, the heal's prior row and the web binding (observe-time and dispatch-time
// row text) all read this one definition.
//
// Containment compares word tokens after NFKC and lowercasing. Each stated word must equal a row
// word or be a prefix (two or more characters) of a non-number row word; a number must match a row
// number exactly: 'Elm St' is in '7 Elm Street, Springfield', '7' is not in '17 Elm Street'.
// Digit grouping (438 gap round 2, WR-11; 444.1 D-16; within D-03). Grouping separators: `,`, `_`,
// U+202F and U+00A0 between a digit and exactly three digits (no further digit), so '1,234' equals
// '1234', and a well-formed lakh group `\d{1,2}(,\d{2})+,\d{3}`, so '1,00,000' equals '100000'.
// U+00A0 and U+202F are read before NFKC, which would turn them into a plain space; `,` and `_`
// after it, so a full-width comma groups too. Not grouping: U+2009 and U+2007 (NFKC turns them
// into a plain space), `'`, U+066C, and `.`, a decimal point; `1.234,50`-style grouping stays open.
// A comma run is also a list: wordTokens is the grouped reading (read by stated-target.ts,
// strict-match.ts and cache/value.ts) and listWordTokens the list reading, every comma a split.
// rowContains agrees when both texts read the same way, either way, agree: 'Order 947' is in
// 'Orders 947,948'. A reading is global per text, never chosen per run (RESEARCH A5), so a text
// mixing a grouped number and a list can still refuse, which fails safe.
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
const NO_BREAK_GROUP_SEPARATOR = /(?<=\p{N})[\u00A0\u202F](?=\p{N}{3}(?!\p{N}))/gu
const GROUP_SEPARATOR = /(?<=\p{N})[,_](?=\p{N}{3}(?!\p{N}))/gu
const UNDERSCORE_GROUP_SEPARATOR = /(?<=\p{N})_(?=\p{N}{3}(?!\p{N}))/gu
const LAKH_GROUP = /(?<!\p{N},?)\p{N}{1,2}(?:,\p{N}{2})+,\p{N}{3}(?!\p{N}|,\p{N})/gu

function tokens(text: string | undefined, commasGroup: boolean): string[] {
  if (text === undefined) return []
  const normalized = text.replace(NO_BREAK_GROUP_SEPARATOR, '').normalize('NFKC')
  const grouped = commasGroup
    ? normalized
        .replace(LAKH_GROUP, (group) => group.replace(/,/g, ''))
        .replace(GROUP_SEPARATOR, '')
    : normalized.replace(UNDERSCORE_GROUP_SEPARATOR, '')
  return grouped
    .toLowerCase()
    .split(NOT_LETTER_OR_DIGIT)
    .filter((word) => word.length > 0)
}

/**
 * Word tokens of a text: digit groups joined, NFKC, lowercased, split on every run that is not a
 * letter or digit.
 */
export function wordTokens(text: string | undefined): string[] {
  return tokens(text, true)
}

export function listWordTokens(text: string | undefined): string[] {
  return tokens(text, false)
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
  const chain = [element, ...ancestorsOf(element, byRef)]
  return (
    chain.find((candidate) => ROW_CONTAINER_ROLES.includes(candidate.role))
    ?? chain.find((candidate) => candidate.role === FALLBACK_CONTAINER_ROLE)
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
  if (container.ref === element.ref && ROW_CONTAINER_ROLES.includes(element.role)) {
    for (const enclosing of ancestorsOf(element, byRef)) {
      if (enclosing.role === element.role) parts.push(enclosing.name, enclosing.text ?? '')
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > 0 ? joined : undefined
}

/** Whether every stated row word is in the row text (equal, or a prefix of a non-number word). */
export function rowContains(rowText: string, statedRow: string): boolean {
  return [wordTokens, listWordTokens].some((read) => {
    const rowWords = read(rowText)
    const statedWords = read(statedRow)
    if (statedWords.length === 0) return true
    return statedWords.every((stated) =>
      rowWords.some((word) => {
        if (word === stated) return true
        if (isNumber(stated) || isNumber(word)) return false
        return stated.length >= MIN_PREFIX_LENGTH && word.startsWith(stated)
      }),
    )
  })
}
