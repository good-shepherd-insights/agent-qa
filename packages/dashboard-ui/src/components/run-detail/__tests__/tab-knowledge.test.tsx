// @vitest-environment jsdom

// THE KNOWLEDGE TAB A PERSON ACTUALLY SEES (407-02 · LERN-01, D-01/D-03/D-06/D-16, T-407-06).
//
// WHY THESE CELLS RENDER INTO `document.body` THROUGH `createRoot`. That is the call `main.tsx`
// makes. A component mounted into a detached node can satisfy every query in a file like this one
// while the real mount path is broken, and the cell would never know.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-knowledge-state`, `data-used-summary`,
// `data-step-index`, `data-test-index`, `data-plan-source`, `data-brief-lines` and
// `data-canary-lines` are what the later plans' Playwright cells address on the built bundle, so
// every one of them is pinned here in the cheap medium first. Colours and badge variants are
// deliberately NOT asserted — a cell that pinned `bg-muted/40` would go red on a design change
// that broke nothing a person relies on. The two class assertions that DO appear (`break-words`
// on the error body) pin a legibility rule the Copywriting Contract states, not a look.
//
// THE FIVE STATE CELLS ARE THE POINT. D-06 and D-16 exist because a tab that renders blank when
// its read has not landed, or when the project has no store, is indistinguishable from a tab
// whose op is broken. Each state is asserted BY ATTRIBUTE and by its own sentence, and the
// loading cell additionally asserts the absence of any text at all.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { TabKnowledge } from "@/components/run-detail/tab-knowledge"
import {
  NO_BRIEF_SERVED_TEXT,
  NO_STORE_BODY,
  NO_STORE_HEADING,
  READ_FAILED_HEADING,
  STEP_NO_BRIEF_TEXT,
  USED_HEADING,
  readFailedBody,
  type KnowledgeView,
  type StepRowView,
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
  act(() => { root?.render(element) })
  return container
}

/** One step row, ready to paint. The projection has its own cells; these build views by hand. */
function row(overrides: Partial<StepRowView> = {}): StepRowView {
  return {
    testIndex: 0,
    stepIndex: 0,
    title: "Step 1 — click checkout",
    briefLines: 2,
    canaryLines: 1,
    planSource: "none",
    facts: ["2 brief lines", "1 canary"],
    ...overrides,
  }
}

function readyView(steps: StepRowView[], summary = "1 step briefed · 1 canary line served"): KnowledgeView {
  return { state: "ready", used: { summary, steps } }
}

function stateOf(view: HTMLElement): string | null {
  return view.querySelector("[data-knowledge-state]")?.getAttribute("data-knowledge-state") ?? null
}

describe("the first read has not landed (UI-SPEC page-level states)", () => {
  it("renders three skeleton bars and NOT ONE WORD — a sentence here would be a guess", () => {
    const view = mount(<TabKnowledge view={undefined} />)

    expect(stateOf(view)).toBe("loading")
    expect(view.querySelectorAll('[data-slot="skeleton"]').length).toBe(3)
    expect(view.textContent).toBe("")
  })
})

describe("the read failed or was refused (D-06)", () => {
  it("states the failure, forwards the masked reason and points at doctor", () => {
    const error = "read_failed"
    const view = mount(<TabKnowledge view={{ state: "error", heading: READ_FAILED_HEADING, body: readFailedBody(error) }} />)

    expect(stateOf(view)).toBe("error")
    expect(view.textContent).toContain(READ_FAILED_HEADING)
    expect(view.textContent).toContain(error)
    expect(view.textContent).toContain("agent-qa doctor")
  })

  it("lets a long masked reason WRAP rather than truncate the doctor pointer away", () => {
    const view = mount(<TabKnowledge view={{ state: "error", heading: READ_FAILED_HEADING, body: readFailedBody("x".repeat(200)) }} />)

    const body = view.querySelector("p")
    expect(body).not.toBeNull()
    expect(body?.className).toContain("break-words")
    expect(body?.className).not.toContain("truncate")
  })
})

describe("the handoff was pruned (D-06)", () => {
  it("renders the SHIPPED evidence-incomplete pane rather than inventing a second wording", () => {
    const view = mount(<TabKnowledge view={{ state: "evidence-incomplete" }} />)

    expect(stateOf(view)).toBe("evidence-incomplete")
    expect(view.querySelector('[data-evidence-state="incomplete"]')).not.toBeNull()
  })
})

describe("the project has no knowledge store (D-16)", () => {
  it("says so, and says the one thing that changes it", () => {
    const view = mount(<TabKnowledge view={{ state: "empty-no-store", heading: NO_STORE_HEADING, body: NO_STORE_BODY }} />)

    expect(stateOf(view)).toBe("empty-no-store")
    expect(view.textContent).toContain(NO_STORE_HEADING)
    expect(view.textContent).toContain(NO_STORE_BODY)
  })
})

describe("a ready panel paints the Used half from the view it was handed (D-03)", () => {
  it("heads the half, prints the derived summary, and gives every step its own row", () => {
    const steps = [
      row({ testIndex: 0, stepIndex: 0, briefLines: 3, canaryLines: 1, facts: ["3 brief lines", "1 canary"] }),
      row({ testIndex: 1, stepIndex: 4, title: "Step 5 — pay", briefLines: 1, canaryLines: 0, planSource: "procedure-replay", facts: ["1 brief line", "replay"] }),
    ]
    const view = mount(<TabKnowledge view={readyView(steps, "2 steps briefed · 1 canary line served · 1 procedure replay")} />)

    expect(stateOf(view)).toBe("ready")

    const heading = view.querySelector("h4")
    expect(heading?.textContent).toBe(USED_HEADING)

    const summary = view.querySelector("[data-used-summary]")
    expect(summary?.textContent).toBe("2 steps briefed · 1 canary line served · 1 procedure replay")

    const rows = Array.from(view.querySelectorAll("[data-step-index]"))
    expect(rows.length).toBe(2)
    expect(rows.map(r => r.getAttribute("data-step-index"))).toEqual(["0", "4"])
    expect(rows.map(r => r.getAttribute("data-test-index"))).toEqual(["0", "1"])
    expect(rows.map(r => r.getAttribute("data-plan-source"))).toEqual(["none", "procedure-replay"])
    expect(rows.map(r => r.getAttribute("data-brief-lines"))).toEqual(["3", "1"])
    expect(rows.map(r => r.getAttribute("data-canary-lines"))).toEqual(["1", "0"])
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining("Step 1 — click checkout"),
      expect.stringContaining("Step 5 — pay"),
    ])
  })

  it("opens every row CLOSED — a 200-step run is 200 one-line rows, not 200 open panes", () => {
    const view = mount(<TabKnowledge view={readyView([row(), row({ stepIndex: 1, title: "Step 2 — pay" })])} />)

    const rows = Array.from(view.querySelectorAll("[data-step-index]"))
    expect(rows.map(r => r.getAttribute("data-state"))).toEqual(["closed", "closed"])
    expect(rows.every(r => r.querySelector('[data-slot="collapsible-trigger"]') !== null)).toBe(true)
  })

  it("says a step served nothing in MUTED TEXT, never as a badge — an empty fact is not a fact", () => {
    const view = mount(<TabKnowledge view={readyView([row({ briefLines: 0, canaryLines: 0, facts: [], noBrief: true })])} />)

    const rowEl = view.querySelector("[data-step-index]") as HTMLElement
    expect(rowEl.textContent).toContain(STEP_NO_BRIEF_TEXT)
    expect(rowEl.querySelectorAll('[data-slot="badge"]').length).toBe(0)
    expect(rowEl.getAttribute("data-brief-lines")).toBe("0")
  })

  it("renders one outline badge per fact on a briefed row", () => {
    const view = mount(<TabKnowledge view={readyView([row({ facts: ["2 brief lines", "1 canary", "hint"], planSource: "procedure-hint" })])} />)

    const badges = Array.from(view.querySelectorAll('[data-slot="badge"]'))
    expect(badges.map(b => b.textContent)).toEqual(["2 brief lines", "1 canary", "hint"])
  })

  it("prints the no-brief-served sentence and NO rows when the run had no steps at all", () => {
    const view = mount(<TabKnowledge view={readyView([], NO_BRIEF_SERVED_TEXT)} />)

    expect(stateOf(view)).toBe("ready")
    expect(view.querySelector("[data-used-summary]")?.textContent).toBe(NO_BRIEF_SERVED_TEXT)
    expect(view.querySelectorAll("[data-step-index]").length).toBe(0)
  })
})

describe("producer text reaches the DOM as TEXT, never as markup (T-407-06)", () => {
  it("renders a hostile step title as a text node — no element is created from it", () => {
    const hostile = "Step 1 — <img src=x onerror=alert(1)>"
    const view = mount(<TabKnowledge view={readyView([row({ title: hostile })])} />)

    expect(view.querySelector("img")).toBeNull()
    expect(view.textContent).toContain("<img src=x onerror=alert(1)>")
  })

  it("renders a hostile masked error as a text node too", () => {
    const hostile = "<img src=x onerror=alert(1)>"
    const view = mount(<TabKnowledge view={{ state: "error", heading: READ_FAILED_HEADING, body: readFailedBody(hostile) }} />)

    expect(view.querySelector("img")).toBeNull()
    expect(view.textContent).toContain(hostile)
  })
})
