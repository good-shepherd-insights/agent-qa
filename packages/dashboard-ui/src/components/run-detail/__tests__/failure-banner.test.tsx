// @vitest-environment jsdom

// THE FAILURE BANNER'S CELLS (405-14 Task 2 · DETL-02, D-10, T-405-41/42/43, WINDOWS #287).
//
// THE LOAD-BEARING ASSERTION IN EVERY RENDER CELL IS THE LAST ONE: the container's `textContent`
// carries no marker delimiter. That is the whole of what this component was changed for. The
// shipped-binary cells in `cli/src/__tests__/conformance/run-detail-failure-dom.test.ts` make the
// same claim on the artifact a person installs; these make it in milliseconds, so the invariant has
// a per-commit sample rather than only an acceptance-tier one.
//
// THE TWO STATES ARE TWO CLAIMS. A banner that painted chips in the preview and raw text once
// expanded would satisfy a single-state cell and still leak — so the toggle is CLICKED and the
// expanded state is asserted separately, exactly as the DOM cells do it.
//
// THE CLIPBOARD IS A SECOND MEDIUM A PERSON READS. What leaves this page on the clipboard is the
// sentence the reader just looked at — the PREVIEW while the banner is collapsed and the whole
// summary once it is expanded — with each marker replaced by the PUBLISHED label its chip shows.
// Copy is asserted BY CONSTANT (405-06's law); a string re-typed here would stay green while the
// chip said something else. Both copy cells assert a CONTAINMENT and an ABSENCE, because the defect
// this rule was written against was an absence that no containment could have seen: the collapsed
// banner copied the full summary, so a word past the budget — a restored credential, on the
// conformance fixture — left the page from a banner that never showed it.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MASKED_MARKER_DELIMITER, PLACEHOLDER_PATTERN, maskedMarker } from "@vostride/agent-qa-schema"

import {
  FAILURE_BANNER_PREVIEW_WORDS,
  FailureBanner,
} from "@/components/run-detail/failure-banner"
import { MASKED_EMAIL_LABEL, MASKED_SECRET_LABEL } from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}))

const EMAIL = maskedMarker("email")
const SECRET = maskedMarker("secret")

/**
 * The two ordinals this file's summary plants its markers at, and the length of that summary.
 *
 * DERIVED FROM THE PUBLISHED BUDGET, NEVER RE-TYPED (WINDOWS #292). They straddle
 * `FAILURE_BANNER_PREVIEW_WORDS` — the email two words inside it, the secret six words past it —
 * which is what makes the truncated and expanded states observably different: the email is in the
 * preview and the secret is not. Spelled as `18`/`26`/`30` against a budget of `20`, a change to
 * the budget left this fixture asserting the old one and both cells measuring nothing they claim.
 * The conformance fixture plants its own sentence against the same budget for the same reason, and
 * names it in prose because it cannot import across the package boundary.
 */
const EMAIL_ORDINAL = FAILURE_BANNER_PREVIEW_WORDS - 2
const SECRET_ORDINAL = FAILURE_BANNER_PREVIEW_WORDS + 6
const SUMMARY_WORDS = FAILURE_BANNER_PREVIEW_WORDS + 10

/** The summary's LAST word — past the budget, so no cell may find it in the preview. */
const LAST_WORD = `w${String(SUMMARY_WORDS)}`

/** A summary of {@link SUMMARY_WORDS} words carrying both markers at the ordinals above. */
function summaryOverTheBudget(): string {
  const parts: string[] = []
  for (let ordinal = 1; ordinal <= SUMMARY_WORDS; ordinal += 1) {
    if (ordinal === EMAIL_ORDINAL) parts.push(EMAIL)
    else if (ordinal === SECRET_ORDINAL) parts.push(SECRET)
    else parts.push(`w${String(ordinal)}`)
  }
  return parts.join(" ")
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(node: ReactNode): HTMLDivElement {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

function stateOf(view: HTMLDivElement): string | null {
  return view.querySelector("[data-failure-banner]")?.getAttribute("data-failure-banner-state") ?? null
}

function toggleOf(view: HTMLDivElement): HTMLButtonElement | null {
  return view.querySelector<HTMLButtonElement>("[data-failure-banner-toggle]")
}

/** The sentence the banner is actually showing — the medium `data-failure-banner-state` describes. */
function textOf(view: HTMLDivElement): string {
  return view.querySelector("[data-failure-banner-text]")?.textContent ?? ""
}

function copyOf(view: HTMLDivElement): HTMLButtonElement | null {
  return view.querySelector<HTMLButtonElement>("[data-failure-banner-copy]")
}

/** What the last copy attempt did, as the button records it — `idle`, `copied` or `failed`. */
function copyStatusOf(view: HTMLDivElement): string | null {
  return copyOf(view)?.getAttribute("data-copy-status") ?? null
}

/** What the live region is currently announcing — empty until an attempt has been made. */
function announcementOf(view: HTMLDivElement): string {
  return view.querySelector("[data-failure-banner-copy-status]")?.textContent ?? ""
}

/**
 * A clipboard the copy cells can read back.
 *
 * `navigator` IS SHARED ACROSS EVERY CELL IN THIS FILE, so the stub is torn down in `afterEach`
 * below rather than left standing. jsdom implements no `navigator.clipboard`, and a cell that
 * asserts the ABSENCE of the API — the one directly below — would silently see a previous cell's
 * leftover stub and pass while measuring nothing.
 */
function stubClipboard(): ReturnType<typeof vi.fn<(text: string) => Promise<void>>> {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  return writeText
}

/** Whatever `navigator.clipboard` was before any cell in this file touched it (jsdom: nothing). */
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")

function restoreClipboard(): void {
  if (originalClipboard === undefined) delete (navigator as { clipboard?: unknown }).clipboard
  else Object.defineProperty(navigator, "clipboard", originalClipboard)
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  restoreClipboard()
})

describe("FailureBanner", () => {
  it("paints only the markers inside the preview budget, and no delimiter, while truncated", () => {
    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)

    expect(stateOf(view)).toBe("truncated")
    // AND THE STATE IS CHECKED AGAINST THE TEXT. `truncated` was once a compile-time constant of
    // this component — derived from the toggle's `useState(false)`, so it read `truncated` on first
    // paint for every input, including one whose truncation had been deleted outright. These two
    // assertions are the fact the attribute claims: the last word of the summary is NOT on the page,
    // and the helper's ellipsis is. Without them the line above asserts `useState`.
    expect(textOf(view)).not.toContain(LAST_WORD)
    expect(textOf(view).endsWith("...")).toBe(true)
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    // The secret marker sits past the budget, so it is not in the preview at all. A chip
    // here would mean the budget was spent over something other than the parsed segments.
    expect(view.querySelector('[data-masked="secret"]')).toBeNull()
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it("shows both markers as chips once expanded, and returns to the preview when toggled back", () => {
    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)

    const toggle = toggleOf(view)
    expect(toggle).not.toBeNull()
    act(() => { toggle!.click() })

    expect(stateOf(view)).toBe("full")
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    expect(view.querySelector('[data-masked="secret"]')?.textContent).toContain(MASKED_SECRET_LABEL)
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)

    act(() => { toggleOf(view)!.click() })
    expect(stateOf(view)).toBe("truncated")
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it("offers no toggle for a summary that was never over the budget, and shows all of it", () => {
    const short = `Step 1/1 "probe" failed: ${EMAIL} and nothing else`
    const view = mount(<FailureBanner summary={short} />)

    expect(toggleOf(view)).toBeNull()
    // FULL, ON FIRST PAINT, WITH NOTHING PRESSED. Nothing was cut, so the banner is showing the
    // whole sentence — and the attribute a DOM cell reads to name which claim it is making has to
    // say so. This is the cell that reds if the state is ever derived from the toggle again.
    expect(stateOf(view)).toBe("full")
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    expect(view.querySelector("[data-failure-banner-text]")?.textContent)
      .toContain("and nothing else")
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it("writes only the PREVIEW to the clipboard while the banner is collapsed", async () => {
    const writeText = stubClipboard()

    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)
    await act(async () => { copyOf(view)!.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copyStatusOf(view)).toBe("copied")
    const written = writeText.mock.calls[0]![0]

    // WHAT WAS RENDERED, AND NOT ONE WORD MORE. The banner is showing `FAILURE_BANNER_PREVIEW_WORDS`
    // words; the secret marker and the summary's last word are both past that budget, and neither is
    // on the page. A clipboard that carries them is carrying text this reader was never shown — and
    // on the conformance fixture the word past the budget is a RESTORED CREDENTIAL, which is the
    // whole reason this cell asserts an absence rather than only the label substitution.
    expect(written).toBe(textOf(view).replace(MASKED_EMAIL_LABEL, `[${MASKED_EMAIL_LABEL}]`))
    expect(written).not.toContain(LAST_WORD)
    expect(written).not.toContain(MASKED_SECRET_LABEL)
    expect(written).toContain("w1 ")
    expect(written).toContain(`[${MASKED_EMAIL_LABEL}]`)
    expect(written.endsWith("...")).toBe(true)
    // And nothing a person could not read on the page: no marker, no placeholder.
    expect(written).not.toContain(MASKED_MARKER_DELIMITER)
    expect(new RegExp(PLACEHOLDER_PATTERN.source, "u").test(written)).toBe(false)
  })

  it("writes the whole summary once the banner has been expanded", async () => {
    const writeText = stubClipboard()

    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)
    act(() => { toggleOf(view)!.click() })
    await act(async () => { copyOf(view)!.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copyStatusOf(view)).toBe("copied")
    const written = writeText.mock.calls[0]![0]

    // EXPANDED, THE PAGE CARRIES THE WHOLE SENTENCE, SO THE CLIPBOARD DOES TOO. The rule is not
    // "copy less"; it is "copy what was rendered" — a copy button stuck on the preview would give a
    // reader a bug report missing the half of the sentence they opened the banner to read.
    expect(written).toContain(LAST_WORD)
    expect(written).toContain(`[${MASKED_EMAIL_LABEL}]`)
    expect(written).toContain(`[${MASKED_SECRET_LABEL}]`)
    expect(written).not.toContain(MASKED_MARKER_DELIMITER)
    expect(new RegExp(PLACEHOLDER_PATTERN.source, "u").test(written)).toBe(false)
  })

  // THE TWO ARMS THE GREEN TICK USED TO SWALLOW. `writeText` was called unguarded, unawaited and
  // uncaught, and `copied` was set unconditionally on the line after it — so a denied permission
  // produced an unhandled rejection AND a check mark, and a non-secure context threw a `TypeError`
  // out of the click handler. Neither arm had a cell, which is why the defect shipped.

  it("does not claim success when the clipboard write rejects", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new DOMException("Document is not focused", "NotAllowedError"))
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)
    await act(async () => { copyOf(view)!.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(copyStatusOf(view)).toBe("failed")
  })

  it("neither throws nor claims success when there is no clipboard API at all", async () => {
    // A NON-SECURE CONTEXT, WHICH IS WHAT jsdom ALREADY IS. `restoreClipboard` in `afterEach` puts
    // the property back exactly as this environment had it — absent — so this cell is measuring the
    // real shape of the API rather than a stub some earlier cell forgot to take away.
    expect((navigator as { clipboard?: unknown }).clipboard).toBeUndefined()

    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)
    await act(async () => { copyOf(view)!.click() })

    expect(copyStatusOf(view)).toBe("failed")
  })

  it("names the copy button and announces both outcomes in a live region", async () => {
    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)

    // A NAME, WHICH `title` IS NOT. `title` is a tooltip; the accessible name is what a screen
    // reader reads when the button takes focus, and without it the control announced as "button".
    expect(copyOf(view)!.getAttribute("aria-label")).toBe("Copy failure summary")

    // AND A REGION THAT IS PRESENT FROM FIRST PAINT, EMPTY. A live region inserted at the same
    // moment its text appears is frequently not announced; this one exists before the click and
    // only its contents change.
    const region = view.querySelector("[data-failure-banner-copy-status]")
    expect(region).not.toBeNull()
    expect(region!.getAttribute("aria-live")).toBe("polite")
    expect(region!.getAttribute("role")).toBe("status")
    expect(announcementOf(view)).toBe("")

    const writeText = stubClipboard()
    await act(async () => { copyOf(view)!.click() })
    expect(announcementOf(view)).toContain("copied")
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it("announces the failure too, rather than only swapping an icon", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new DOMException("Document is not focused", "NotAllowedError"))
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

    const view = mount(<FailureBanner summary={summaryOverTheBudget()} />)
    await act(async () => { copyOf(view)!.click() })

    expect(announcementOf(view)).toContain("Could not copy")
  })

  // The producer's text is a text node and nothing else (T-405-42). A cell that fed markup and
  // found no element is the only assertion that keeps it that way.
  it("renders a summary containing markup as text, never as an element", () => {
    const view = mount(<FailureBanner summary={'<img src=x onerror="alert(1)">'} />)

    expect(view.querySelector("img")).toBeNull()
    expect(view.querySelector("[data-failure-banner-text]")?.textContent)
      .toBe('<img src=x onerror="alert(1)">')
  })
})
