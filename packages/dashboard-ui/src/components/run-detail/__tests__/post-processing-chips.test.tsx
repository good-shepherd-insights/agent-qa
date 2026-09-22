// @vitest-environment jsdom

// THE CHIPS A PERSON ACTUALLY SEES (404-07 · LIFE-03, D-20..D-23, T-404-01).
//
// WHY THESE CELLS RENDER INTO `document.body` THROUGH `createRoot`. That is the call `main.tsx`
// makes. A component mounted into a detached node can satisfy every query in a file like this one
// while the real mount path is broken, and the cell would never know.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-chip`, `data-chip-status`,
// `data-chip-posture`, `data-chip-facts`, `data-chip-error`, `data-chip-will-retry`,
// `data-chip-reason-absent` and `data-chips-state` are what 404-08's Playwright cells address on
// the built bundle, so every one of them is pinned here in the cheap medium first. Colours and
// badge variants are deliberately NOT asserted — a cell that pinned `bg-emerald-500/15` would go
// red on a design change that broke nothing a person relies on.
//
// THE ABSENCE CELLS ARE THE POINT. `never blank` and `never pending` are claims about elements that
// must NOT exist, and an assertion that only ever checks what IS rendered cannot see either one.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PostProcessingChips } from "@/components/run-detail/post-processing-chips"
import { RunNavbar } from "@/components/run-detail/run-navbar"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ANALYSIS_COMPLETE_NO_ISSUES_TEXT,
  CHIPS_UNAVAILABLE_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  CURATION_CHIP_TITLE,
  FAILED_REASON_ABSENT_TEXT,
  PENDING_POSTURE_TEXT,
  STAGE_INDICATOR_WORDS,
  curationChipAccessibleName,
  type PostProcessingView,
  type StageIndicatorState,
} from "@/lib/post-processing-view"
import type { RunRow } from "@/lib/api"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

// The component carries NO provider on purpose (the page owns the one at `run-detail.tsx`), so a
// real-primitive mount without this wrapper throws inside Radix before a card can ever open. The
// delay mirrors the page's `delayDuration={0}`, so a focused root opens its card in the same tick.
function mount(element: ReactElement): HTMLElement {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  act(() => { root?.render(<TooltipProvider delayDuration={0}>{element}</TooltipProvider>) })
  return container
}

/** The projection's own mapping, restated once so a loose record below need only name its word. */
const STATE_OF: Record<string, StageIndicatorState> = {
  done: "complete",
  running: "running",
  pending: "pending",
  failed: "failed",
}

/** A chips view built from two loose chip records — the projection has its own cells. */
function chipsView(analysis: Record<string, unknown>, curation: Record<string, unknown>): PostProcessingView {
  const chip = (stage: "analysis" | "curation", loose: Record<string, unknown>) => {
    const state = (loose.state as StageIndicatorState | undefined) ?? STATE_OF[loose.status as string]!
    return { state, word: STAGE_INDICATOR_WORDS[stage][state], ...loose }
  }
  return {
    kind: "chips",
    analysis: chip("analysis", analysis),
    curation: chip("curation", curation),
  } as unknown as PostProcessingView
}

function render(view: PostProcessingView | undefined): HTMLElement {
  return mount(<PostProcessingChips view={view} />)
}

function chip(host: HTMLElement, stage: "analysis" | "curation"): HTMLElement {
  const found = host.querySelector<HTMLElement>(`[data-chip="${stage}"]`)
  if (found === null) throw new Error(`no ${stage} chip rendered`)
  return found
}

describe("two chips, in the ratified order, each saying its own word", () => {
  it("renders analysis then curation, with the word in the attribute AND in the text", () => {
    const host = render(chipsView({ status: "running" }, { status: "pending" }))
    const stages = [...host.querySelectorAll("[data-chip]")].map((el) => el.getAttribute("data-chip"))
    expect(stages).toEqual(["analysis", "curation"])
    expect(chip(host, "analysis").getAttribute("data-chip-status")).toBe("running")
    // The raw word rides the attribute; the VISIBLE word is the indicator's own, and the state is
    // said again in the accessible name (D-07).
    expect(chip(host, "analysis").textContent).toContain(STAGE_INDICATOR_WORDS.analysis.running)
    expect(chip(host, "analysis").querySelector(".sr-only")?.textContent).toContain("running")
    expect(chip(host, "curation").getAttribute("data-chip-status")).toBe("pending")
    expect(chip(host, "curation").textContent).toContain("pending")
  })

  it("a running chip carries no parenthetical, no facts, no error and no absent-reason", () => {
    const host = render(chipsView({ status: "running" }, { status: "running" }))
    for (const stage of ["analysis", "curation"] as const) {
      const el = chip(host, stage)
      expect(el.querySelector("[data-chip-posture]")).toBeNull()
      expect(el.querySelector("[data-chip-facts]")).toBeNull()
      expect(el.querySelector("[data-chip-error]")).toBeNull()
      expect(el.querySelector("[data-chip-reason-absent]")).toBeNull()
    }
  })
})

// THE TRACER (425-01 · D-06/D-07/D-10/D-13, UI-SPEC S3/S4). One indicator, end to end: the glyph
// and the word a person sees, the focusable root that reaches the card by keyboard, and the card's
// first line — the phase's copy cell. Every later state hangs off this anatomy.
describe("a settled analysis indicator explains itself (D-13, roadmap SC3)", () => {
  it("TRACER-PASSING-ANALYSIS-CARD: glyph plus word on a focusable root, card line 1 is the sentence", async () => {
    const host = render(chipsView(
      {
        status: "done",
        state: "complete",
        word: STAGE_INDICATOR_WORDS.analysis.complete,
        card: { outcome: ANALYSIS_COMPLETE_NO_ISSUES_TEXT },
      },
      { status: "done", state: "complete", word: STAGE_INDICATOR_WORDS.curation.complete },
    ))
    const root = chip(host, "analysis")

    expect(root.tagName).toBe("SPAN")
    expect(root.getAttribute("tabindex")).toBe("0")
    expect(root.getAttribute("data-stage-state")).toBe("complete")
    expect(root.getAttribute("data-chip-status")).toBe("done")
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    expect(root.textContent).toContain(STAGE_INDICATOR_WORDS.analysis.complete)
    expect(root.querySelector(".sr-only")?.textContent).toBe("Analysis: complete, no issues found")

    // Radix opens on focus as well as hover; the card is portalled, so it is read off `document`.
    await act(async () => { root.focus() })
    const card = document.querySelector('[data-stage-card="analysis"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector('[data-stage-card-line="outcome"]')?.textContent)
      .toBe(ANALYSIS_COMPLETE_NO_ISSUES_TEXT)
  })
})

describe("a pending chip says who is going to move it (D-22)", () => {
  it("renders the posture the projection published, verbatim", () => {
    const host = render(chipsView(
      { status: "pending", posture: PENDING_POSTURE_TEXT.handedOff },
      { status: "pending", posture: PENDING_POSTURE_TEXT.handedOff },
    ))
    const posture = chip(host, "analysis").querySelector("[data-chip-posture]")
    expect(posture?.textContent).toContain(PENDING_POSTURE_TEXT.handedOff)
  })

  it("renders NO posture element when the run has not said one yet", () => {
    const host = render(chipsView({ status: "pending" }, { status: "pending" }))
    expect(chip(host, "analysis").querySelector("[data-chip-posture]")).toBeNull()
  })
})

describe("a terminal chip says what it committed (D-21)", () => {
  it("renders curation's counts in their own element", () => {
    const host = render(chipsView({ status: "done" }, { status: "done", facts: "curated 4 facts, deprecated 2" }))
    expect(chip(host, "curation").querySelector("[data-chip-facts]")?.textContent).toBe("curated 4 facts, deprecated 2")
    expect(chip(host, "analysis").querySelector("[data-chip-facts]")).toBeNull()
  })

  it("renders the counts-absent line in the SAME slot — a `done` chip is never silent about counts (D-12)", () => {
    const host = render(chipsView({ status: "done" }, { status: "done", facts: COUNTS_NOT_RECORDED_TEXT }))
    expect(chip(host, "curation").querySelector("[data-chip-facts]")?.textContent).toBe(COUNTS_NOT_RECORDED_TEXT)
  })
})

// THE CHIP AS A DOOR (D-01). The chip stays PRESENTATIONAL: it is handed a callback and calls it.
// It does not know a tab, a route or a run. Absent the callback it is exactly the shipped `<span>` —
// a header rendered without a page behind it must not grow an affordance that goes nowhere.
describe("the curation chip is a click-through into the Knowledge tab (D-01)", () => {
  function renderWithClick(onCurationClick: () => void): HTMLElement {
    return mount(
      <PostProcessingChips
        view={chipsView({ status: "done" }, { status: "done", facts: COUNTS_NOT_RECORDED_TEXT })}
        onCurationClick={onCurationClick}
      />,
    )
  }

  it("renders the curation chip root as a button carrying the hover title and the accessible name", () => {
    const host = renderWithClick(vi.fn())
    const root = chip(host, "curation")

    expect(root.tagName).toBe("BUTTON")
    expect(root.getAttribute("type")).toBe("button")
    expect(root.getAttribute("title")).toBe(CURATION_CHIP_TITLE)
    expect(root.getAttribute("aria-label")).toBe(curationChipAccessibleName("done"))
  })

  it("keeps every data attribute on the root when it becomes a button — the contract does not move", () => {
    const host = renderWithClick(vi.fn())
    const root = chip(host, "curation")

    expect(root.getAttribute("data-chip")).toBe("curation")
    expect(root.getAttribute("data-chip-status")).toBe("done")
    expect(root.querySelector("[data-chip-facts]")?.textContent).toBe(COUNTS_NOT_RECORDED_TEXT)
  })

  it("calls the page's handler exactly once per click and never navigates itself", () => {
    const onCurationClick = vi.fn()
    const host = renderWithClick(onCurationClick)

    act(() => { chip(host, "curation").click() })

    expect(onCurationClick).toHaveBeenCalledTimes(1)
  })

  it("NEVER makes the analysis chip a button — only curation has a half of the tab to open", () => {
    const host = renderWithClick(vi.fn())
    const analysis = chip(host, "analysis")

    expect(analysis.tagName).toBe("SPAN")
    expect(analysis.getAttribute("title")).toBeNull()
    expect(analysis.getAttribute("aria-label")).toBeNull()
  })

  it("stays today's span with no title when the page passes no handler", () => {
    const host = render(chipsView({ status: "done" }, { status: "done" }))
    const root = chip(host, "curation")

    expect(root.tagName).toBe("SPAN")
    expect(root.getAttribute("title")).toBeNull()
    expect(root.getAttribute("aria-label")).toBeNull()
  })
})

describe("a failed chip is never blank (D-21 as narrowed)", () => {
  it("renders the producer's text VERBATIM and says whether the chain will try again", () => {
    const host = render(chipsView(
      { status: "failed", error: "analysis stage blew up on step 3", willRetry: true },
      { status: "pending" },
    ))
    const error = chip(host, "analysis").querySelector("[data-chip-error]")
    expect(error?.textContent).toBe("analysis stage blew up on step 3")
    expect(error?.getAttribute("data-chip-will-retry")).toBe("true")
    expect(chip(host, "analysis").querySelector("[data-chip-reason-absent]")).toBeNull()
  })

  it("renders the posture-qualified absence when nobody recorded a reason — and NO error element", () => {
    const host = render(chipsView(
      { status: "failed", reasonAbsent: FAILED_REASON_ABSENT_TEXT.handedOff },
      { status: "pending" },
    ))
    const el = chip(host, "analysis")
    expect(el.querySelector("[data-chip-reason-absent]")?.textContent).toBe(FAILED_REASON_ABSENT_TEXT.handedOff)
    expect(el.querySelector("[data-chip-error]")).toBeNull()
    expect(el.textContent).not.toBe("")
  })

  it("the failure text is a TEXT NODE — markup in it is escaped, never parsed (T-404-01)", () => {
    const host = render(chipsView(
      { status: "failed", error: "<img src=x onerror=alert(1)>" },
      { status: "pending" },
    ))
    const error = chip(host, "analysis").querySelector("[data-chip-error]")
    expect(error?.textContent).toBe("<img src=x onerror=alert(1)>")
    expect(error?.querySelector("img")).toBeNull()
  })
})

describe("a refusal is its own state, and it is not a chip (D-23)", () => {
  it("renders ONE unavailable element naming the refusal, and zero chips", () => {
    const host = render({ kind: "unavailable", error: "job_store_schema_version", reason: "stamped by another build" })
    const state = host.querySelectorAll('[data-chips-state="unavailable"]')
    expect(state).toHaveLength(1)
    expect(state[0]!.textContent).toContain(CHIPS_UNAVAILABLE_TEXT)
    expect(state[0]!.textContent).toContain("job_store_schema_version")
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(0)
  })

  it("a view that has not arrived yet is `loading`, which is not `pending` and not blank", () => {
    const host = render(undefined)
    expect(host.querySelectorAll('[data-chips-state="loading"]')).toHaveLength(1)
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The header itself: the chips sit BESIDE the verdict badge, and there is still only one badge
// ---------------------------------------------------------------------------

function runRow(status: string): RunRow {
  return {
    id: "r_header",
    name: "a header probe",
    filePath: "tests/probe.test.yaml",
    status,
    duration: 1000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: null,
    endedAt: null,
    failureSummary: null,
    errorLog: null,
    memoryLog: null,
    testId: null,
    suiteId: null,
    platform: "web",
    testFileContent: null,
    modelName: null,
    llmProvider: null,
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt: "2026-08-27T00:00:00.000Z",
  }
}

describe("RunNavbar puts the chips beside the verdict badge (D-20)", () => {
  it("renders the chips AFTER the verdict badge, and the badge still appears exactly once", () => {
    const host = mount(
      <MemoryRouter><RunNavbar
        run={runRow("passed")}
        shortcutsOpen={false}
        onToggleShortcuts={() => {}}
        hasPostProcessing
        postProcessing={chipsView({ status: "done" }, { status: "running" })}
      /></MemoryRouter>,
    )
    // The 404-06 acceptance: ONE render site for the badge, so one element carries the raw status.
    expect(host.querySelectorAll("[data-verdict-badge]")).toHaveLength(1)
    const badge = host.querySelector("[data-verdict-badge]")!
    const analysis = host.querySelector('[data-chip="analysis"]')!
    // Ordering, not counting: the badge must PRECEDE the chips in document order.
    expect(badge.compareDocumentPosition(analysis) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders no chip area at all when the header was not wired for one", () => {
    const host = mount(
      <MemoryRouter>
        <RunNavbar run={runRow("passed")} shortcutsOpen={false} onToggleShortcuts={() => {}} />
      </MemoryRouter>,
    )
    expect(host.querySelectorAll("[data-verdict-badge]")).toHaveLength(1)
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(0)
    expect(host.querySelectorAll("[data-chips-state]")).toHaveLength(0)
  })
})
