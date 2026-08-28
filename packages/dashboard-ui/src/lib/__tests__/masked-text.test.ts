// THE CHIP PARSER'S CELLS (405-11 Task 1 · DETL-02, D-10).
//
// The marker vocabulary is schema's; this file asserts the SPLIT, not the spelling. Every fixture
// below builds its markers with `maskedMarker` rather than typing the delimiter, so a change to the
// spelling moves these cells with it instead of leaving them green against a form nobody emits.

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { MASKED_MARKER_DELIMITER, MASKED_MARKER_PATTERN, maskedMarker } from '@vostride/agent-qa-schema'

import { splitMaskedText, truncateMaskedText } from '../masked-text'

const SECRET = maskedMarker('secret')
const EMAIL = maskedMarker('email')

describe('splitMaskedText', () => {
  it('splits a run into its text and its markers, in order', () => {
    expect(splitMaskedText(`user ${SECRET} at ${EMAIL}!`)).toEqual([
      { kind: 'text', text: 'user ' },
      { kind: 'masked', category: 'secret' },
      { kind: 'text', text: ' at ' },
      { kind: 'masked', category: 'email' },
      { kind: 'text', text: '!' },
    ])
  })

  it('hands back one text segment for a run with nothing masked', () => {
    expect(splitMaskedText('nothing to hide here')).toEqual([
      { kind: 'text', text: 'nothing to hide here' },
    ])
  })

  it('hands back no segments at all for an empty run', () => {
    expect(splitMaskedText('')).toEqual([])
  })

  it('emits no empty text segment when a marker sits at either end', () => {
    expect(splitMaskedText(`${SECRET}${EMAIL}`)).toEqual([
      { kind: 'masked', category: 'secret' },
      { kind: 'masked', category: 'email' },
    ])
  })

  // A delimiter that fences nothing is TEXT. Swallowing it into a chip would claim a redaction the
  // seam never made, and dropping it would edit the producer's own sentence.
  it('passes a stray delimiter through as the literal text it is', () => {
    const stray = `${MASKED_MARKER_DELIMITER} not a marker ${MASKED_MARKER_DELIMITER}`
    expect(splitMaskedText(stray)).toEqual([{ kind: 'text', text: stray }])
  })

  it('passes an unknown category through as text rather than inventing a chip for it', () => {
    const unknown = `${MASKED_MARKER_DELIMITER}masked:other${MASKED_MARKER_DELIMITER}`
    expect(splitMaskedText(unknown)).toEqual([{ kind: 'text', text: unknown }])
  })

  // The pattern is `global`; a shared RegExp carries `lastIndex` between calls. A parser that did
  // not reset it would split the first string correctly and miss the marker in the second.
  it('splits the same marker again on a second call', () => {
    const once = splitMaskedText(`a ${SECRET} b`)
    expect(splitMaskedText(`a ${SECRET} b`)).toEqual(once)
  })
})

// ── THE TRUNCATION BOUNDARY (405-14 Task 2 · DETL-02, WINDOWS #287).
//
// The banner shows a word-bounded PREVIEW of the run's failure summary, and the whole point of
// `truncateMaskedText` is that the parse happens BEFORE the budget: a marker is one word, kept
// whole or dropped whole, never sliced. The cells below pin the two sides of that boundary (a
// marker AT the budget, a marker one past it), the segment-word contract, and the byte-identity
// promise for an input that was never over.
//
// EVERY ASSERTION ABOUT ABSENCE IS SPELLED WITH `MASKED_MARKER_DELIMITER`, never with the
// character — this file's own law one describe up.

/** The marker categories a run carries, in order — what "a prefix of the input's markers" means. */
function maskedCategoriesOf(text: string): string[] {
  return splitMaskedText(text)
    .filter((segment) => segment.kind === 'masked')
    .map((segment) => (segment as { category: string }).category)
}

/** What is left of a run once every COMPLETE marker is removed. */
function withoutCompleteMarkers(text: string): string {
  return text.replace(new RegExp(MASKED_MARKER_PATTERN.source, 'gu'), '')
}

/**
 * What `truncateMaskedText` will CHARGE a run: one word per marker, one per whitespace-free token.
 *
 * DERIVED FROM THE SHIPPED SPLIT, so a cell can say "exactly at the budget" and mean it. The
 * boundary cell below used to spell its own count in a comment, and the comment was wrong by one —
 * it claimed the `total === maxWords` edge while exercising `total < maxWords`, so an off-by-one
 * flipping `<=` to `<` in the helper would have left it green (WINDOWS #290).
 */
function budgetedWordsOf(text: string): number {
  return splitMaskedText(text).reduce(
    (total, segment) =>
      total
      + (segment.kind === 'masked'
        ? 1
        : segment.text.split(/\s+/u).filter((token) => token !== '').length),
    0,
  )
}

/**
 * The word budget these cells spend, chosen here and belonging to nothing else.
 *
 * IT IS NOT THE BANNER'S. `FAILURE_BANNER_PREVIEW_WORDS` is the published budget the failure banner
 * shows, and it is exercised against the component in
 * `components/run-detail/__tests__/failure-banner.test.tsx`, which imports it. This file measures
 * the HELPER, whose budget is an argument — naming the number locally is what stops a reader taking
 * these cells for coverage of the banner's published budget (WINDOWS #292).
 */
const BUDGET = 20

describe('truncateMaskedText', () => {
  // THE BUDGET BOUNDARY, FROM BELOW. A marker that is exactly the last word the budget pays for is
  // kept ENTIRE. The old page-local helper computed the budget over raw whitespace tokens, so what
  // "the 20th word" meant depended on how many whitespace-free runs the marker's spelling happened
  // to occupy — a fact about the delimiter, not about the sentence.
  it('keeps a marker that is exactly the last budgeted word, whole, and ends the preview with it', () => {
    const before = Array.from({ length: BUDGET - 1 }, (_, index) => `w${String(index + 1)}`).join(' ')
    const input = `${before} ${EMAIL} tail one ${SECRET} more`

    const result = truncateMaskedText(input, BUDGET)

    expect(result.isTruncated).toBe(true)
    expect(result.text.endsWith(`${EMAIL}...`)).toBe(true)
    // A PREFIX of the input's markers, and nothing invented.
    expect(maskedCategoriesOf(result.text)).toEqual(['email'])
    expect(maskedCategoriesOf(input).slice(0, 1)).toEqual(maskedCategoriesOf(result.text))
    // No delimiter survives outside a complete marker — a half-cut marker would show up here.
    expect(withoutCompleteMarkers(result.text)).not.toContain(MASKED_MARKER_DELIMITER)
  })

  // AND FROM ABOVE. One word past the budget the marker is dropped ENTIRELY — never its opening
  // delimiter, never its body. That is the state D-10 forbids and the state this ordering prevents.
  it('drops a marker that is one word past the budget, whole, leaving no delimiter behind', () => {
    const before = Array.from({ length: BUDGET }, (_, index) => `w${String(index + 1)}`).join(' ')
    const input = `${before} ${EMAIL}`

    const result = truncateMaskedText(input, BUDGET)

    expect(result.isTruncated).toBe(true)
    expect(maskedCategoriesOf(result.text)).toEqual([])
    expect(result.text).not.toContain(MASKED_MARKER_DELIMITER)
    expect(result.text).toBe(`${before}...`)
  })

  // THE SEGMENT-WORD CONTRACT. A marker glued to the text on both sides is still ONE word, and the
  // text either side is one word each — the budget is spent over segments, not over whitespace.
  it('charges a marker glued to text exactly one word, and re-emits it unchanged', () => {
    const input = `contact:${EMAIL}.`

    expect(truncateMaskedText(input, 3)).toEqual({ text: input, isTruncated: false })

    const cut = truncateMaskedText(input, 2)
    expect(cut.isTruncated).toBe(true)
    expect(cut.text).toBe(`contact: ${EMAIL}...`)
    expect(maskedCategoriesOf(cut.text)).toEqual(['email'])
  })

  // BYTE-IDENTICAL WHEN NOTHING WAS CUT, AT THE `total === maxWords` EDGE ITSELF. The join
  // normalises whitespace, and normalising a producer's own sentence when it was never over the
  // budget would be this helper editing text it was only asked to shorten.
  //
  // THE BUDGET IS DERIVED FROM THE FIXTURE, NEVER TYPED BESIDE IT. This cell used to spell `8`
  // against a sentence that parses to SEVEN words, so it exercised `total < maxWords` while its
  // comment claimed the equality edge — and the `<=` boundary for a MARKER-BEARING string had no
  // cell at all (WINDOWS #290). Reading the count out of the shipped split is what stops the claim
  // and the fixture drifting apart again.
  it('hands back an input EXACTLY at the budget byte-identical, irregular whitespace and all', () => {
    const input = `Step\t1/1  "probe"\nfailed: ${EMAIL}\n\nand ${SECRET}`
    const atBudget = budgetedWordsOf(input)

    // Four text words, the email marker, one text word, the secret marker — a marker costs one.
    expect(atBudget).toBe(7)
    expect(truncateMaskedText(input, atBudget)).toEqual({ text: input, isTruncated: false })

    // AND THE OTHER SIDE OF THE SAME EDGE: one word more than the budget pays for is over it.
    const oneWordLonger = `${input} tail`
    expect(budgetedWordsOf(oneWordLonger)).toBe(atBudget + 1)
    expect(truncateMaskedText(oneWordLonger, atBudget).isTruncated).toBe(true)
  })

  // THE ELLIPSIS IS A CONSEQUENCE, NOT DECORATION: it appears if and only if something was cut, and
  // a plain sentence truncates exactly as the shipped page-local helper did.
  it('appends the ellipsis only when it truncated, and matches the shipped plain-word behaviour', () => {
    const words = Array.from({ length: BUDGET + 1 }, (_, index) => `w${String(index + 1)}`)
    const oneOver = words.join(' ')

    const cut = truncateMaskedText(oneOver, BUDGET)
    expect(cut).toEqual({ text: `${words.slice(0, BUDGET).join(' ')}...`, isTruncated: true })

    const kept = truncateMaskedText(words.slice(0, BUDGET).join(' '), BUDGET)
    expect(kept.isTruncated).toBe(false)
    expect(kept.text.endsWith('...')).toBe(false)
  })
})

// ── THE FILE'S OWN LAW, MEASURED RATHER THAN STATED (WINDOWS #291).
//
// The header and the truncation preamble both declare that no cell types the delimiter. Two did
// anyway, and each asserted its input came back as a SINGLE TEXT SEGMENT — so a respelling of
// `MASKED_MARKER_DELIMITER` would have turned both fixtures into ordinary prose carrying no
// delimiter at all, left both green, and left neither measuring stray-delimiter or unknown-category
// parsing. A law nothing reads is a comment.

describe('this file, as its own subject', () => {
  it('types the marker delimiter nowhere in its own source', () => {
    const source = readFileSync(new URL(import.meta.url), 'utf8')

    // The identifier is asserted first, so a read that found the wrong file cannot pass by silence.
    expect(source).toContain('MASKED_MARKER_DELIMITER')
    expect(source.includes(MASKED_MARKER_DELIMITER)).toBe(false)
  })
})
