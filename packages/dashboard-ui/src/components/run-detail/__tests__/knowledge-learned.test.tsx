// @vitest-environment jsdom

// THE LEARNED HALF A PERSON ACTUALLY SEES (407-09 · LERN-02, D-09..D-12, T-407-21/T-407-22).
//
// WHY THESE CELLS RENDER INTO `document.body` THROUGH `createRoot`. That is the call `main.tsx`
// makes. A component mounted into a detached node can satisfy every query in a file like this one
// while the real mount path is broken, and the cell would never know.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-learned-state`, `data-learned-count-line`,
// `data-record-change`, `data-record-id` and `data-pending-proposals` are what 407-11's Playwright
// cells address on the built bundle, so every one of them is pinned here in the cheap medium first.
// The two class assertions that DO appear (`text-primary` on a routed reference, `font-mono` on the
// id) pin the UI-SPEC's accent reservation and its no-wrap rule — contracts, not looks.
//
// THE ABSENCE CELLS ARE THE POINT. D-12's whole posture is that this half never renders blank and
// never renders a `0` nobody measured, and both of those are claims about elements and text that
// must NOT exist. An assertion that only ever checks what IS rendered cannot see either one.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeLearned } from "@/components/run-detail/knowledge-learned"
import { routes } from "@/lib/routes"
import {
  CHANGED_NOTHING_TEXT,
  CHANGES_NOT_AVAILABLE_TEXT,
  COUNTS_NOT_RECORDED_SENTENCE,
  CURATION_FAILED_TEXT,
  DELTAS_PENDING_TEXT,
  LEARNED_HEADING,
  REVIEW_PROPOSALS_CTA,
  pendingProposalsLine,
  type LearnedRowView,
  type LearnedView,
  type ProposalsView,
} from "@/lib/knowledge-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function mount(element: ReactElement): HTMLElement {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  // A `MemoryRouter` because a routed reference renders a `<Link>`, and a `Link` outside a router
  // throws. The unrouted arm renders a span and would pass without one — which is exactly why both
  // arms are mounted the same way here.
  act(() => { root?.render(<MemoryRouter>{element}</MemoryRouter>) })
  return container
}

function render(view: LearnedView, proposals?: ProposalsView): HTMLElement {
  return mount(<KnowledgeLearned view={view} proposals={proposals} />)
}

function stateOf(host: HTMLElement): string | null {
  return host.querySelector("[data-learned-state]")?.getAttribute("data-learned-state") ?? null
}

function rowsOf(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("li[data-record-change]")]
}

function row(overrides: Partial<LearnedRowView> = {}): LearnedRowView {
  return { kind: "confirmed", recordId: "fact-cart-page-4ccac", ...overrides }
}

describe("an unsettled curation says so in words, never in a spinner (D-12)", () => {
  it("carries the pending word on the root and the one sentence a reader can act on", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(stateOf(host)).toBe("pending")
    expect(host.textContent).toContain(DELTAS_PENDING_TEXT)
    expect(rowsOf(host).length).toBe(0)
    expect(host.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("carries the running word with the SAME sentence — one fact is being waited on, not two", () => {
    const host = render({ state: "running", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(stateOf(host)).toBe("running")
    expect(host.textContent).toContain(DELTAS_PENDING_TEXT)
  })

  it("renders NO count line while curation is unsettled — counts come only from the frozen row", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(host.querySelector("[data-learned-count-line]")).toBeNull()
  })
})

describe("a failed curation states the consequence, not just the failure (D-12)", () => {
  it("carries the failed word and says nothing was learned — and offers no retry", () => {
    const host = render({ state: "failed", sentence: CURATION_FAILED_TEXT, rows: [] })

    expect(stateOf(host)).toBe("failed")
    expect(host.textContent).toContain(CURATION_FAILED_TEXT)
    expect(rowsOf(host).length).toBe(0)
    expect(host.querySelector("button")).toBeNull()
  })
})

describe("a settled curation with no counts says so — never a zero (D-12)", () => {
  it("carries the counts-absent word, the sentence and the fragment, with no digit anywhere", () => {
    const host = render({
      state: "counts-absent",
      countLine: "counts not recorded for this run",
      sentence: COUNTS_NOT_RECORDED_SENTENCE,
      rows: [],
    })

    expect(stateOf(host)).toBe("counts-absent")
    expect(host.textContent).toContain(COUNTS_NOT_RECORDED_SENTENCE)
    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe("counts not recorded for this run")
    expect(host.textContent).not.toContain("0")
  })
})

describe("a settled curation that changed nothing says that, and lists nothing (D-12)", () => {
  it("renders the both-zero phrase beside the heading and the changed-nothing sentence", () => {
    const host = render({
      state: "done",
      countLine: "nothing curated",
      sentence: CHANGED_NOTHING_TEXT,
      rows: [],
    })

    expect(stateOf(host)).toBe("done")
    expect(host.querySelector("[data-learned-count-line]")?.textContent).toBe("nothing curated")
    expect(host.textContent).toContain(CHANGED_NOTHING_TEXT)
    expect(rowsOf(host).length).toBe(0)
  })

  it("keeps the counts on screen when they moved but no change record reached this run", () => {
    const host = render({
      state: "done",
      countLine: "curated 3 facts, deprecated 1",
      sentence: CHANGES_NOT_AVAILABLE_TEXT,
      rows: [],
    })

    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe("curated 3 facts, deprecated 1")
    expect(host.textContent).toContain(CHANGES_NOT_AVAILABLE_TEXT)
    expect(rowsOf(host).length).toBe(0)
  })
})

describe("the record list is one addressable row per change (D-10)", () => {
  const populated: LearnedView = {
    state: "done",
    countLine: "curated 3 facts, deprecated 1",
    rows: [
      row({ kind: "promoted", recordId: "MEM-001", ref: "agentqa://memory/MEM-001" }),
      row({ kind: "deprecated", recordId: "fact-page-https-example-com-0f9a" }),
    ],
  }

  it("renders the heading, the count line and one li per change, in the projection's order", () => {
    const host = render(populated)

    expect(host.querySelector("h4")?.textContent).toBe(LEARNED_HEADING)
    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe("curated 3 facts, deprecated 1")
    expect(rowsOf(host).map((el) => el.getAttribute("data-record-change")))
      .toEqual(["promoted", "deprecated"])
    expect(rowsOf(host).map((el) => el.getAttribute("data-record-id")))
      .toEqual(["MEM-001", "fact-page-https-example-com-0f9a"])
  })

  it("renders the kind word in the row's badge as well as in its attribute", () => {
    const host = render(populated)

    expect(rowsOf(host)[0]?.textContent).toContain("promoted")
    expect(rowsOf(host)[1]?.textContent).toContain("deprecated")
  })

  it("renders the record id in a mono element on every row — the address is always readable", () => {
    const host = render(populated)

    for (const el of rowsOf(host)) {
      const id = el.querySelector("[data-record-id-text]")
      expect(id?.className).toContain("font-mono")
      expect(id?.textContent).toBe(el.getAttribute("data-record-id"))
    }
  })

  it("renders a ROUTED reference as an accent anchor with the truncation rule the SPEC states", () => {
    const host = render({
      state: "done",
      countLine: "curated 1 fact, deprecated 0",
      rows: [row({ kind: "confirmed", recordId: "TST-001", ref: "agentqa://test/TST-001", href: "/test/t_1" })],
    })

    const anchor = host.querySelector<HTMLAnchorElement>("li[data-record-change] a[data-record-ref]")
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute("href")).toBe("/test/t_1")
    expect(anchor?.textContent).toBe("agentqa://test/TST-001")
    expect(anchor?.className).toContain("text-primary")
    expect(anchor?.className).toContain("truncate")
    expect(anchor?.className).toContain("max-w-[32rem]")
  })

  it("renders an UNROUTED reference as text — this build says what, not where to click", () => {
    const host = render({
      state: "done",
      countLine: "curated 1 fact, deprecated 0",
      rows: [row({ kind: "confirmed", recordId: "MEM-001", ref: "agentqa://memory/MEM-001" })],
    })

    const ref = host.querySelector("li[data-record-change] [data-record-ref]")
    expect(ref?.tagName).toBe("SPAN")
    expect(ref?.textContent).toBe("agentqa://memory/MEM-001")
    expect(host.querySelector("li[data-record-change] a")).toBeNull()
  })

  it("renders no reference element at all for a record that has no canonical address", () => {
    const host = render({
      state: "done",
      countLine: "curated 1 fact, deprecated 0",
      rows: [row({ recordId: "fact-page-https-example-com-0f9a" })],
    })

    expect(host.querySelector("[data-record-ref]")).toBeNull()
    expect(rowsOf(host)[0]?.getAttribute("data-record-id")).toBe("fact-page-https-example-com-0f9a")
  })

  it("drops the state sentence once rows are painted — the rows ARE the answer", () => {
    const host = render(populated)

    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
  })
})

describe("the proposals line is a count and a door (D-11, T-407-22)", () => {
  const proposals: ProposalsView = {
    count: 3,
    line: pendingProposalsLine(3),
    ctaText: REVIEW_PROPOSALS_CTA,
    href: routes.chat,
  }

  it("stamps the count on the line and renders the single CTA pointing where proposals are reviewed", () => {
    const host = render({ state: "done", countLine: "nothing curated", sentence: CHANGED_NOTHING_TEXT, rows: [] }, proposals)

    const line = host.querySelector("[data-pending-proposals]")
    expect(line?.getAttribute("data-pending-proposals")).toBe("3")
    expect(line?.textContent).toContain(pendingProposalsLine(3))

    const cta = host.querySelector<HTMLAnchorElement>("a[data-review-proposals]")
    expect(cta?.textContent).toBe(REVIEW_PROPOSALS_CTA)
    // The projection's own `ctaText` and the component's import must be the SAME spelling — a
    // component rendering one while a consumer reads the other is two CTAs wearing one name.
    expect(cta?.textContent).toBe(proposals.ctaText)
    expect(cta?.getAttribute("href")).toBe(routes.chat)
  })

  it("renders NO line and NO attribute when the page passed no proposals — a zero is not news", () => {
    const host = render({ state: "done", countLine: "nothing curated", sentence: CHANGED_NOTHING_TEXT, rows: [] })

    expect(host.querySelector("[data-pending-proposals]")).toBeNull()
    expect(host.querySelector("[data-review-proposals]")).toBeNull()
  })

  it("shows the proposals line beside an unsettled half — the inbox is not this run's chain", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] }, proposals)

    expect(stateOf(host)).toBe("pending")
    expect(host.querySelector("[data-pending-proposals]")).not.toBeNull()
  })
})

describe("projection text reaches the DOM as TEXT, never as markup (T-407-21)", () => {
  it("renders a hostile record id as a text node — no element is created from it", () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const host = render({
      state: "done",
      countLine: "curated 1 fact, deprecated 0",
      rows: [row({ recordId: hostile })],
    })

    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain(hostile)
    expect(rowsOf(host)[0]?.getAttribute("data-record-id")).toBe(hostile)
  })

  it("renders a hostile reference string as a text node too — an href is never taken from one", () => {
    const hostile = 'javascript:alert(1)'
    const host = render({
      state: "done",
      countLine: "curated 1 fact, deprecated 0",
      rows: [row({ recordId: "MEM-001", ref: hostile })],
    })

    expect(host.querySelector("li[data-record-change] a")).toBeNull()
    expect(host.querySelector("[data-record-ref]")?.textContent).toBe(hostile)
  })
})
