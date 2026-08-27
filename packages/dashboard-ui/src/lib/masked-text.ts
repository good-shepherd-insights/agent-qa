// SPLITTING A PROJECTION STRING INTO TEXT AND MASKED MARKERS (405-11 · DETL-02, D-10).
//
// PURE AND TOTAL. No React, no DOM. The renderer is a separate module so this half can be reasoned
// about — and mutated — without a jsdom root, and so the same split is available to any surface
// that needs to know whether a sentence carries a redaction at all.
//
// THE SPELLING IS SCHEMA'S, NEVER RESPELLED HERE. `MASKED_MARKER_PATTERN` is minted once in the
// browser-safe kernel (405-06) and the display-unmask seam (405-10) emits with the same module.
// Writing the delimiter locally would recreate exactly the silent drift that minting it once
// removed: a parser that misses the seam's marker passes a raw placeholder straight to the DOM,
// which is the state D-10 exists to forbid. There is no delimiter literal in this file.
//
// A MARKER THE PATTERN DOES NOT RECOGNISE IS TEXT. A lone delimiter, or a body naming a category
// nobody publishes, is passed through as the literal characters it is: swallowing it into a chip
// would claim a redaction the seam never made, and dropping it would silently edit the producer's
// own sentence. Both are worse than showing what was actually recorded.

import { MASKED_MARKER_PATTERN, type MaskedCategory } from '@vostride/agent-qa-schema'

/** One run of ordinary text, or one marker standing in for a value nobody may see. */
export type MaskedSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'masked'; readonly category: MaskedCategory }

/**
 * Split a text run into its ordinary text and its masked markers, in the producer's order.
 *
 * EMPTY TEXT SEGMENTS ARE NEVER EMITTED — two adjacent markers, or a marker at either end, would
 * otherwise produce a zero-length run that renders as nothing and only exists to be skipped by
 * every consumer. An empty input therefore yields no segments at all, which is the same statement
 * one level up.
 *
 * The pattern is `global` and shared, so its `lastIndex` survives between calls. `matchAll` resets
 * it on entry; a bare `.test()` loop would not, and would miss the marker in every second string.
 */
export function splitMaskedText(text: string): MaskedSegment[] {
  const segments: MaskedSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(MASKED_MARKER_PATTERN)) {
    const start = match.index
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) })
    segments.push({ kind: 'masked', category: match[1] as MaskedCategory })
    cursor = start + match[0].length
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}
