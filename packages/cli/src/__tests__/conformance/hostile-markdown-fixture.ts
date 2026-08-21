// THE HOSTILE MARKDOWN FIXTURE — deliberately adversarial content, checked in on purpose (400-09).
//
// WHAT THIS FILE IS. Every string below is an ATTACK, written to be driven through the shipped
// `ChatMarkdown` render in a real browser and to fail. Nothing here is example content, nothing is
// a template, and nothing here should be copied into product code. It is named `*-fixture.ts` and
// it lives beside the cells that drive it so that a reader who greps for `javascript:` in this
// repository lands on a file whose first line says why it is here.
//
// WHY A TRANSCRIPT NEEDS ONE AT ALL (T-400-19 / T-400-20). A chat transcript paints model-authored
// prose and op-result bytes into the dashboard's own origin — the origin that serves the API which
// drives a person's local agent. Those bytes can be authored by whoever controls the site under
// test: a page title, a response body quoted in a failure message, a knowledge fact somebody's
// crawl wrote down. So the render has two guards — a raw-HTML escape and a URL-parsed link-protocol
// allow-list — and this fixture is what is fired at them.
//
// NO REAL PAYLOAD, NO REAL HOST, NO REAL CREDENTIAL. The scripts below call a function that does
// not exist and set a global nothing reads; the hosts are `.invalid`, which the DNS standard
// reserves precisely so it can never resolve. A fixture that reached out would be a test that
// depended on the internet, and one carrying a working payload would be a repository hosting one.

/** The global a successful injection would set — read back from the page, never trusted. */
export const XSS_WITNESS = '__agentQa400_09_xss__'

/**
 * A raw HTML BLOCK. `marked` would inject this verbatim without the `renderer.html` override.
 *
 * Two shapes in one block because they fail differently: an `<img onerror>` needs no script tag and
 * survives most naive tag filters, and a literal `<script>` is the case everyone remembers.
 */
export const HOSTILE_RAW_HTML_BLOCK = [
  `<img src="x" onerror="globalThis.${XSS_WITNESS} = 'img-onerror'">`,
  `<script>globalThis.${XSS_WITNESS} = 'script-tag'</script>`,
].join('\n')

/**
 * Markdown LINKS whose destinations must LOSE their href.
 *
 * A markdown link is not an HTML block: it reaches `marked`'s link renderer, which composes an
 * `<a href>` out of a destination it does not sanitise, so the raw-HTML escape leaves every one of
 * these untouched. Each spelling parses — through the browser's own `URL`, which is what the guard
 * uses — to a protocol outside the allow-list, and each is a spelling a deny-list of NAMES would
 * have had to know about in advance.
 */
export const REFUSED_LINK_DESTINATIONS: readonly string[] = Object.freeze([
  `javascript:globalThis.${XSS_WITNESS}='plain'`,
  `JaVaScRiPt:globalThis.${XSS_WITNESS}='mixed-case'`,
  `  javascript:globalThis.${XSS_WITNESS}='leading-space'`,
  'data:text/html,<script>1</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
])

/**
 * A destination `marked` does not turn into a link AT ALL, and the fixture keeps it on purpose.
 *
 * A newline inside a markdown destination breaks the link syntax, so the whole `[text](dest)`
 * construct renders as literal characters. That is inert by a different mechanism than the guard's
 * — the renderer never produced an anchor for the guard to refuse — and a fixture that quietly
 * dropped it would leave the next reader assuming the guard was what handled it.
 */
export const UNPARSED_LINK_DESTINATION = `java
script:globalThis.${XSS_WITNESS}='embedded-newline'`

/**
 * A destination that SURVIVES as an anchor, and the measured reason that is not a defect.
 *
 * `javascript&#58;…` carries an HTML entity where the scheme's colon would be. The guard parses
 * with `URL`, which does not decode HTML entities, so this string has no scheme and resolves as an
 * ordinary RELATIVE path — which the allow-list permits deliberately (relative destinations are how
 * every in-app link works). The renderer then escapes the `&`, so what reaches the document is
 * `href="javascript&amp;#58;…"`, and a browser decodes that attribute exactly once: to
 * `javascript&#58;…`, still not a colon, still a same-origin path.
 *
 * IT IS NOT ADDED TO THE REFUSED LIST, and the restraint is the module's own law rather than
 * laziness: `chat-markdown.tsx` argues at length that a deny-list of names loses to the next
 * spelling, and "refuse relative URLs that contain the letters javascript" would be precisely such
 * a rule — one that could be defeated by a spelling nobody named, while breaking legitimate paths.
 * What the cell asserts instead is the invariant that actually matters and that holds for EVERY
 * link: the browser's own parser resolves every surviving href to http(s), and nothing executes.
 *
 * The defect this documents the absence of is a SECOND decode — a consumer that entity-decoded the
 * rendered attribute again before navigating. The cell pins the rendered form so that stays visible.
 */
export const RELATIVE_LOOKALIKE_DESTINATION =
  `javascript&#58;globalThis.${XSS_WITNESS}='entity-colon'`

/** Every destination the fixture drives, in the order the document lists them. */
export const ALL_HOSTILE_DESTINATIONS: readonly string[] = Object.freeze([
  ...REFUSED_LINK_DESTINATIONS,
  UNPARSED_LINK_DESTINATION,
  RELATIVE_LOOKALIKE_DESTINATION,
])

/** A destination that MUST survive: the guard is an allow-list, not a refusal of everything. */
export const BENIGN_LINK_DESTINATION = 'https://example.invalid/report'

/**
 * Markdown IMAGE destinations that must never reach an `img src` (400 gap round 1).
 *
 * THE THIRD RENDERER VECTOR, and the one that needs no click. `![alt](dest)` is neither an HTML
 * block nor a link — it reaches `renderer.image`, which composed an `<img src>` out of an
 * unsanitised destination — and a browser FETCHES an `img src` the instant the entry paints. So a
 * remote destination is a beacon confirming this transcript rendered somebody's bytes inside the
 * dashboard's origin, and a `data:` destination is a payload the page then holds.
 *
 * ONE ROW, DELIBERATELY. The spelling axis is already measured exhaustively by the link list above
 * against the SAME predicate — the image guard reuses `isRenderableHref` rather than forking a
 * second parser — so a second full spelling sweep here would measure the same function twice. What
 * this row adds is the vector: that the predicate is reached from the image renderer at all.
 */
export const REFUSED_IMAGE_DESTINATIONS: readonly string[] = Object.freeze([
  'data:text/html;base64,PHNjcmlwdD4xPC9zY3JpcHQ+',
])

/** An image destination that MUST survive: the image guard is a filter, not a blanket. */
export const BENIGN_IMAGE_DESTINATION = 'https://example.invalid/shot.png'

/** The alt text every refused image carries, so a refused image can be found by its words. */
export const HOSTILE_IMAGE_ALT = 'refused image'

/** The alt text of the one image that must render. */
export const BENIGN_IMAGE_ALT = 'a screenshot'

/** The visible text every link below carries, so a refused link can be found by its words. */
export const HOSTILE_LINK_TEXT = 'click here'

/**
 * The whole fixture, as one markdown document a turn could plausibly answer with.
 *
 * ONE DOCUMENT RATHER THAN ONE PER VECTOR, because a transcript entry is one document and a guard
 * that held for an isolated string and not for the same string beside a code fence would be a guard
 * that held in the test's arrangement only.
 */
export function hostileMarkdownDocument(): string {
  return [
    '# transcript',
    '',
    'Some ordinary prose, so the renderer is genuinely rendering.',
    '',
    HOSTILE_RAW_HTML_BLOCK,
    '',
    ...ALL_HOSTILE_DESTINATIONS.map(
      (destination) => `- [${HOSTILE_LINK_TEXT}](${destination})`,
    ),
    '',
    `- [safe link](${BENIGN_LINK_DESTINATION})`,
    '',
    ...REFUSED_IMAGE_DESTINATIONS.map(
      (destination) => `- ![${HOSTILE_IMAGE_ALT}](${destination})`,
    ),
    '',
    `- ![${BENIGN_IMAGE_ALT}](${BENIGN_IMAGE_DESTINATION})`,
    '',
  ].join('\n')
}
