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
// sentence the reader just looked at, with each marker replaced by the PUBLISHED label its chip
// shows. Copy is asserted BY CONSTANT (405-06's law); a string re-typed here would stay green while
// the chip said something else.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MASKED_MARKER_DELIMITER, PLACEHOLDER_PATTERN, maskedMarker } from "@vostride/agent-qa-schema"

import { FailureBanner } from "@/components/run-detail/failure-banner"
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
 * A thirty-word summary with a marker at word 18 and another at word 26.
 *
 * THE TWO ORDINALS STRADDLE THE PUBLISHED PREVIEW BUDGET (20), which is what makes the truncated
 * and expanded states observably different: the email is inside the preview and the secret is not.
 * The conformance fixture plants its own sentence against the same budget for the same reason.
 */
function summaryOfThirtyWords(): string {
  const parts: string[] = []
  for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
    if (ordinal === 18) parts.push(EMAIL)
    else if (ordinal === 26) parts.push(SECRET)
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

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

describe("FailureBanner", () => {
  it("paints only the markers inside the preview budget, and no delimiter, while truncated", () => {
    const view = mount(<FailureBanner summary={summaryOfThirtyWords()} />)

    expect(stateOf(view)).toBe("truncated")
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    // The secret marker is word 26 — past the budget, so it is not in the preview at all. A chip
    // here would mean the budget was spent over something other than the parsed segments.
    expect(view.querySelector('[data-masked="secret"]')).toBeNull()
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it("shows both markers as chips once expanded, and returns to the preview when toggled back", () => {
    const view = mount(<FailureBanner summary={summaryOfThirtyWords()} />)

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
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    expect(view.querySelector("[data-failure-banner-text]")?.textContent)
      .toContain("and nothing else")
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it("writes the FULL summary to the clipboard with every marker replaced by its published label", () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    const view = mount(<FailureBanner summary={summaryOfThirtyWords()} />)
    const copy = view.querySelector<HTMLButtonElement>('button[title="Copy failure summary"]')
    expect(copy).not.toBeNull()
    act(() => { copy!.click() })

    expect(writeText).toHaveBeenCalledTimes(1)
    const written = writeText.mock.calls[0]![0]

    // THE WHOLE SUMMARY, not the preview: a copy button that pasted the truncated text would give a
    // reader a bug report missing the half of the sentence they opened the banner to read.
    expect(written).toContain("w30")
    expect(written).toContain(`[${MASKED_EMAIL_LABEL}]`)
    expect(written).toContain(`[${MASKED_SECRET_LABEL}]`)
    // And nothing a person could not read on the page: no marker, no placeholder.
    expect(written).not.toContain(MASKED_MARKER_DELIMITER)
    expect(new RegExp(PLACEHOLDER_PATTERN.source, "u").test(written)).toBe(false)
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
