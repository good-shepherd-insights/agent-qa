// The transcript's markdown, rendered inert (Phase 400 plan 06, T-400-19 / T-400-20).
//
// WHAT IS BEING RENDERED HERE IS UNTRUSTED. A chat transcript carries model-authored prose and op
// RESULT bytes — a page title scraped off a site under test, a failure message quoting a response
// body, a knowledge fact somebody's crawl wrote down. Any of those can be authored by whoever
// controls the thing the agent was pointed at, and this component paints them into the dashboard's
// own origin, where the API that drives a person's local agent lives.
//
// THREE VECTORS, THREE GUARDS, AND THE SHIPPED IDIOM ONLY CLOSES ONE. `ObservationMarkdown`
// overrides `renderer.html` so a raw HTML BLOCK is escaped rather than injected, and that idiom is
// copied verbatim below — it is the reviewed one and this file must not fork it. But a markdown
// LINK is not an HTML block: `[click](javascript:…)` reaches `marked`'s link renderer, which
// composes an `<a href>` out of a destination it does not sanitise. Nor is a markdown IMAGE:
// `![alt](data:…)` reaches the image renderer and becomes an `img src` the browser fetches with no
// click at all — a beacon to a remote host, or a payload the page holds. The escape leaves both
// untouched, so this file adds the other two guards, and `chat-transcript.test.tsx` drives hostile
// fixtures at all three.
//
// THE LINK GUARD IS AN ALLOW-LIST AND THAT IS THE WHOLE DESIGN. A deny-list of protocol names is a
// rule that can only refuse what somebody thought to NAME, and the history of this class is a
// history of spellings nobody named: mixed case, leading whitespace and control bytes, entity
// encodings, `data:` payloads that are inert until a browser decides otherwise. What a transcript
// link can legitimately be is small and closed — an http(s) URL, or a same-document anchor — so the
// guard states that and refuses everything else, including everything nobody has invented yet.

import { marked } from "marked"

import { cn } from "@/lib/utils"

interface ChatMarkdownProps {
  className?: string
  content: string
}

/**
 * The protocols a transcript link or image may carry.
 *
 * Relative and same-document destinations are handled separately below: they have no protocol at
 * all, so they can never be one of these, and refusing them would break every internal link the
 * entity cards want to render.
 */
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Whether this destination is safe to put in an `href`.
 *
 * PARSED, NEVER PATTERN-MATCHED. `URL` applies the same normalisation a browser applies —
 * whitespace stripping, control-character removal, case folding of the scheme — so
 * `JaVaScRiPt&#58;` and `  javascript:` reach this function as the same protocol the browser would
 * act on. A regular expression over the raw string is a second, weaker parser, and every bypass in
 * this class is a string the second parser read differently from the first.
 *
 * A destination that fails to parse against a base is either relative or malformed. Relative is
 * fine and common; malformed is refused, because an href a URL parser cannot read is one only a
 * browser's error recovery gives meaning to.
 */
function isRenderableHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed === "") return false
  if (trimmed.startsWith("#") || trimmed.startsWith("/")) return true
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(trimmed, globalThis.location?.href ?? "http://localhost/").protocol)
  } catch {
    return false
  }
}

const renderer = new marked.Renderer()

// The shipped `ObservationMarkdown` idiom, unchanged: a raw HTML block is TEXT here.
renderer.html = ({ text }) => escapeHtml(text)

/**
 * The link guard.
 *
 * A REFUSED LINK STILL RENDERS ITS TEXT, and loses only its destination. Dropping the whole node
 * would silently delete a sentence a person was reading; leaving the text with a `data-` marker
 * says a link was there and that this surface would not follow it. Nothing is invented and nothing
 * disappears.
 */
renderer.link = ({ href, title, tokens }) => {
  const text = renderer.parser.parseInline(tokens)
  if (!isRenderableHref(href)) {
    return `<span data-blocked-href="true" title="link removed: unsupported protocol">${text}</span>`
  }
  const titleAttribute = title === null || title === undefined ? "" : ` title="${escapeHtml(title)}"`
  return `<a href="${escapeHtml(href)}"${titleAttribute} rel="noreferrer noopener" target="_blank">${text}</a>`
}

/**
 * The image guard — the third renderer vector, and the one a click is not needed for.
 *
 * WHY IT IS NOT COVERED BY THE TWO ABOVE. `![alt](dest)` is neither a raw HTML block nor a link:
 * it reaches `renderer.image`, which composes an `<img src>` out of a destination nothing
 * sanitised. And an `img src` is worse than an unclicked href, because the browser FETCHES it the
 * moment the entry paints — so a remote destination is a beacon confirming that this transcript,
 * in this dashboard's origin, rendered the attacker's bytes, and a `data:` destination is a payload
 * the page then holds. Neither needs a person to do anything.
 *
 * ONE PREDICATE, NOT A SECOND ONE. `isRenderableHref` is reused verbatim — its whole argument is
 * that a second parser over the same string is where every bypass in this class lives, and forking
 * it for images would be exactly that. `#`-relative is meaningless for an image and harmless: it
 * resolves to this document, which fetches nothing interesting.
 *
 * A REFUSED IMAGE KEEPS ITS ALT TEXT, on the link guard's own stated reason: nothing is invented
 * and nothing disappears. What the reader loses is the destination, and the marker says so.
 *
 * NO DIMENSIONS ARE TAKEN FROM CONTENT. The only attributes composed here are the escaped `src`,
 * the escaped `alt`, an escaped `title` when the document carried one, and `loading="lazy"`.
 */
renderer.image = ({ href, title, text }) => {
  const alt = escapeHtml(text)
  if (!isRenderableHref(href)) {
    return `<span data-blocked-src="true" title="image removed: unsupported protocol">${alt}</span>`
  }
  const titleAttribute = title === null || title === undefined ? "" : ` title="${escapeHtml(title)}"`
  return `<img src="${escapeHtml(href)}" alt="${alt}"${titleAttribute} loading="lazy">`
}

export function ChatMarkdown({ className, content }: ChatMarkdownProps) {
  const html = marked.parse(content, {
    async: false,
    gfm: true,
    renderer,
  }) as string

  return (
    <div
      className={cn("markdown-preview text-sm text-foreground", className)}
      role="document"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}
