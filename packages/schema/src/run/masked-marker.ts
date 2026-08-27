// THE MASKED-MARKER VOCABULARY — one spelling, shared by two packages that never meet.
//
// Phase 405-06 Task 3 · DETL-02, D-10.
//
// WHO USES THIS, AND WHY IT LIVES HERE. Exactly two things have to agree on this vocabulary:
//
//   1. The dashboard host's DISPLAY-UNMASK SEAM (405-10, in the CLI composition). It restores
//      declared secrets from the host's current sources at read time; a placeholder it CANNOT
//      restore is rewritten into a marker minted by `maskedMarker` rather than left as a raw
//      `<SECRET_1>` in text a person is about to read.
//   2. The dashboard-ui CHIP PARSER (405-11). It splits a text run on `MASKED_MARKER_PATTERN` and
//      paints each marker as a visibly-masked chip, so a reader can tell deliberate redaction
//      apart from a broken page.
//
// Those two plans are written in the same wave, by different plans, in different packages. If they
// each spelled the marker themselves, a drift between the two spellings would fail SILENTLY and in
// the worst direction: either the parser does not recognise the seam's marker and passes it through
// as literal text, or — worse — the seam emits a form the parser misses and a raw placeholder
// reaches the DOM, which is precisely the state D-10 exists to forbid. Minting the spelling once
// here, in the browser-safe kernel both sides already depend on, makes that drift impossible rather
// than merely unlikely.
//
// SCHEMA MUST NOT IMPORT SAFETY. `PLACEHOLDER_PATTERN` MIRRORS `formatPlaceholder`'s
// `<${category}_${index}>` spelling from `@vostride/agent-qa-safety`; it does not import it, because
// this package is the kernel every other package depends on and safety sits downstream of it. The
// mirror is deliberate and is pinned by this module's own cells — if safety ever changes its
// placeholder form, this pattern is the second place that has to move, and the cells say so.
//
// This module has NO imports at all: pure constants, one pure function, browser-safe by construction.

/**
 * The character that fences a marker at both ends: U+241F SYMBOL FOR UNIT SEPARATOR.
 *
 * It is a PICTURE of a control character, not one. A real 0x1F would be mangled or stripped by
 * JSON transport, a SQLite TEXT column and a DOM text node; this codepoint survives all three
 * intact, while remaining something no human would type into a test instruction by accident.
 *
 * Rejected: a `[masked:...]` bracket form, which collides with the `[secret:NAME]` source-level
 * idiom a person writes in a test — a marker must not be confusable with something authored.
 */
export const MASKED_MARKER_DELIMITER = '␟'

/**
 * The two things a marker can stand for.
 *
 * A closed set, deliberately: the chip copy is written per category (405-11 renders
 * `MASKED_SECRET_LABEL` and `MASKED_EMAIL_LABEL`), so a third category could not be rendered
 * without someone writing a third sentence for it.
 */
export type MaskedCategory = 'secret' | 'email'

/**
 * Mint the marker for a placeholder the display seam could not restore.
 *
 * `maskedMarker('secret')` is the exact string the chip parser splits on. The category is carried
 * INSIDE the marker rather than inferred from context, because the two categories mean different
 * things to a reader: a masked secret is a value this host's config could restore if it were
 * declared, while a masked email was minted by detection during masking and has no source to
 * restore from at all.
 */
export function maskedMarker(category: MaskedCategory): string {
  return `${MASKED_MARKER_DELIMITER}masked:${category}${MASKED_MARKER_DELIMITER}`
}

/**
 * Every marker in a text run, capturing the category.
 *
 * The body is an EXPLICIT alternation of the two categories rather than a permissive `\w+`: a
 * malformed or unknown body must match nothing, so that text which merely happens to contain the
 * delimiter is passed through as the literal text it is rather than swallowed into a chip.
 *
 * It is `global`, so callers that reuse it across text runs must reset `lastIndex` — `matchAll`
 * and `replaceAll` do this themselves; a bare `.test()` in a loop does not.
 */
export const MASKED_MARKER_PATTERN = /␟masked:(secret|email)␟/g

/**
 * Every masking placeholder in a text run, capturing the category and the index.
 *
 * Mirrors `formatPlaceholder(category, index)` from the safety package — `<SECRET_0>`, `<EMAIL_12>`
 * — with the category restricted to the closed set safety publishes. `<SECRET_>` (no index),
 * `<secret_1>` (wrong case) and a bare `SECRET_1` (unbracketed) all match nothing, so a
 * near-miss is never mistaken for a placeholder the seam should have restored.
 *
 * It is `global` on the same terms as {@link MASKED_MARKER_PATTERN}.
 */
export const PLACEHOLDER_PATTERN = /<(SECRET|EMAIL)_(\d+)>/g
