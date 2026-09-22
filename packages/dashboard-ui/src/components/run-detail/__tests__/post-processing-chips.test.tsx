// @vitest-environment jsdom

// THE CHIPS A PERSON ACTUALLY SEES (404-07 · LIFE-03, D-20..D-23, T-404-01).
//
// WHY THESE CELLS RENDER INTO `document.body` THROUGH `createRoot`. That is the call `main.tsx`
// makes. A component mounted into a detached node can satisfy every query in a file like this one
// while the real mount path is broken, and the cell would never know.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-chip`, `data-chip-status`,
// `data-stage-state`, `data-chips-state`, `data-stage-card` and `data-stage-card-line` are what
// 404-08's Playwright cells address on the built bundle, so every one of them is pinned here in the
// cheap medium first. Colours are deliberately NOT asserted — a cell that pinned `text-emerald-500`
// would go red on a design change that broke nothing a person relies on. The GLYPH NAME is asserted
// instead, because shape is what carries the state once the colour is stripped out (SC2).
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
  BREAKDOWN_NOT_RECORDED_TEXT,
  CHIPS_UNAVAILABLE_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  FAILED_REASON_ABSENT_TEXT,
  OPEN_KNOWLEDGE_TAB_TEXT,
  PENDING_POSTURE_TEXT,
  POST_PROCESSING_LOADING_LABEL,
  POST_PROCESSING_UNAVAILABLE_WORD,
  STAGE_INDICATOR_WORDS,
  stageIndicatorAccessibleName,
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

/** Open a stage's card the way a keyboard reader does, and read it off the portal. */
async function cardOf(host: HTMLElement, stage: "analysis" | "curation"): Promise<HTMLElement> {
  const root = chip(host, stage)
  await act(async () => { root.focus() })
  const card = document.querySelector<HTMLElement>(`[data-stage-card="${stage}"]`)
  if (card === null) throw new Error(`no ${stage} card opened`)
  return card
}

function lineOf(card: HTMLElement, kind: string): string | undefined {
  return card.querySelector(`[data-stage-card-line="${kind}"]`)?.textContent ?? undefined
}

/** What a SIGHTED reader sees on a root — the `sr-only` name is a separate claim, asserted apart. */
function visibleTextOf(el: HTMLElement): string {
  return [...el.childNodes]
    .filter((node) => !(node instanceof HTMLElement && node.classList.contains("sr-only")))
    .map((node) => node.textContent ?? "")
    .join("")
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

  it("a running chip carries no parenthetical, no facts, no error and no absent-reason", async () => {
    const host = render(chipsView(
      { status: "running", card: { outcome: "Analysis running" } },
      { status: "running", card: { outcome: "Curation running" } },
    ))
    for (const stage of ["analysis", "curation"] as const) {
      const el = chip(host, stage)
      // The detail left header chrome entirely (D-09/D-12): the root is a glyph and a word.
      expect(el.querySelectorAll("span").length).toBe(2)
      const card = await cardOf(host, stage)
      expect(lineOf(card, "note")).toBeUndefined()
      expect(lineOf(card, "retry")).toBeUndefined()
      expect(lineOf(card, "door")).toBeUndefined()
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
  it("renders the posture the projection published, verbatim", async () => {
    const queued = (stage: "Analysis" | "Curation") => ({
      status: "pending",
      card: { outcome: `${stage} queued — ${PENDING_POSTURE_TEXT.handedOff}` },
    })
    const host = render(chipsView(queued("Analysis"), queued("Curation")))
    const card = await cardOf(host, "analysis")
    expect(lineOf(card, "outcome")).toContain(PENDING_POSTURE_TEXT.handedOff)
  })

  it("renders NO posture element when the run has not said one yet", async () => {
    const host = render(chipsView(
      { status: "pending", card: { outcome: "Analysis queued" } },
      { status: "pending", card: { outcome: "Curation queued" } },
    ))
    const card = await cardOf(host, "analysis")
    expect(lineOf(card, "outcome")).toBe("Analysis queued")
    expect(chip(host, "analysis").textContent).not.toContain(PENDING_POSTURE_TEXT.handedOff)
  })
})

describe("a terminal chip says what it committed (D-21)", () => {
  it("renders curation's counts in its card, and never on the analysis card", async () => {
    const host = render(chipsView(
      { status: "done", card: { outcome: ANALYSIS_COMPLETE_NO_ISSUES_TEXT } },
      { status: "done", card: { outcome: "Curation complete — 4 added · 2 deprecated" } },
    ))
    expect(lineOf(await cardOf(host, "curation"), "outcome"))
      .toBe("Curation complete — 4 added · 2 deprecated")
    expect(lineOf(await cardOf(host, "analysis"), "outcome")).toBe(ANALYSIS_COMPLETE_NO_ISSUES_TEXT)
  })

  it("renders the counts-absent line in the SAME slot — a `done` chip is never silent about counts (D-12)", async () => {
    const host = render(chipsView(
      { status: "done" },
      { status: "done", card: { outcome: `Curation complete — ${COUNTS_NOT_RECORDED_TEXT}` } },
    ))
    expect(lineOf(await cardOf(host, "curation"), "outcome"))
      .toBe(`Curation complete — ${COUNTS_NOT_RECORDED_TEXT}`)
  })
})

// THE LEGACY COUNT SENTENCE LEAVES HEADER CHROME (D-16, PXH-RUN-04). RED under return: restore the
// old `curated N facts, deprecated M` line anywhere in the chips DOM or in a card and this goes red.
describe("`curated N facts, deprecated M` is gone from the header (D-16)", () => {
  const LEGACY = /curated \d+ facts?, deprecated/

  it("HEADER-NO-LEGACY-COUNT: neither a snapshot-bearing nor a legacy-pair read spells it", async () => {
    for (const outcome of [
      "Curation complete — 4 added · 2 deprecated",
      "Curation complete — 4 curated · 2 deprecated",
    ]) {
      const host = render(chipsView(
        { status: "done", card: { outcome: ANALYSIS_COMPLETE_NO_ISSUES_TEXT } },
        { status: "done", card: { outcome, note: BREAKDOWN_NOT_RECORDED_TEXT } },
      ))
      expect(host.textContent ?? "").not.toMatch(LEGACY)
      for (const stage of ["analysis", "curation"] as const) {
        expect((await cardOf(host, stage)).textContent ?? "").not.toMatch(LEGACY)
      }
      act(() => { root?.unmount() })
      container?.remove()
      root = undefined
      container = undefined
    }
  })
})

// THE CHIP AS A DOOR (D-01). The chip stays PRESENTATIONAL: it is handed a callback and calls it.
// It does not know a tab, a route or a run. Absent the callback it is exactly the shipped `<span>` —
// a header rendered without a page behind it must not grow an affordance that goes nowhere.
describe("the curation chip is a click-through into the Knowledge tab (D-01)", () => {
  const SETTLED_CURATION = {
    status: "done",
    card: { outcome: `Curation complete — ${COUNTS_NOT_RECORDED_TEXT}` },
  }

  function renderWithClick(onCurationClick: () => void): HTMLElement {
    return mount(
      <PostProcessingChips
        view={chipsView({ status: "done" }, SETTLED_CURATION)}
        onCurationClick={onCurationClick}
      />,
    )
  }

  it("renders the curation chip root as a button carrying the accessible name, and no native title", () => {
    const host = renderWithClick(vi.fn())
    const root = chip(host, "curation")

    expect(root.tagName).toBe("BUTTON")
    expect(root.getAttribute("type")).toBe("button")
    // A native tooltip beside a Radix one is two treatments of one concept (UI-SPEC S3).
    expect(root.getAttribute("title")).toBeNull()
    expect(root.getAttribute("aria-label")).toBe(
      stageIndicatorAccessibleName("curation", "complete", SETTLED_CURATION.card.outcome, "knowledge"),
    )
  })

  it("closes its card with the door line — the indicator itself is the control (D-10)", async () => {
    const host = renderWithClick(vi.fn())
    const card = await cardOf(host, "curation")

    expect(lineOf(card, "door")).toBe(OPEN_KNOWLEDGE_TAB_TEXT)
    expect([...card.querySelectorAll("[data-stage-card-line]")].at(-1)?.getAttribute("data-stage-card-line"))
      .toBe("door")
    expect(card.querySelector("a, button")).toBeNull()
  })

  it("keeps every data attribute on the root when it becomes a button — the contract does not move", async () => {
    const host = renderWithClick(vi.fn())
    const root = chip(host, "curation")

    expect(root.getAttribute("data-chip")).toBe("curation")
    expect(root.getAttribute("data-chip-status")).toBe("done")
    expect(root.getAttribute("data-stage-state")).toBe("complete")
    expect(lineOf(await cardOf(host, "curation"), "outcome")).toBe(SETTLED_CURATION.card.outcome)
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
  it("renders the producer's text VERBATIM and says whether the chain will try again", async () => {
    const host = render(chipsView(
      {
        status: "failed",
        card: { outcome: "Analysis failed — analysis stage blew up on step 3", retry: "Will retry" },
      },
      { status: "pending", card: { outcome: "Curation queued" } },
    ))
    const card = await cardOf(host, "analysis")
    expect(lineOf(card, "outcome")).toBe("Analysis failed — analysis stage blew up on step 3")
    expect(lineOf(card, "retry")).toBe("Will retry")
    // The reason never sits beside the indicator again (D-09): the VISIBLE root is a glyph and a
    // word. The accessible name still carries the outcome clause, which is where it belongs.
    expect(visibleTextOf(chip(host, "analysis"))).toBe(STAGE_INDICATOR_WORDS.analysis.failed)
  })

  it("renders the posture-qualified absence when nobody recorded a reason — and NO error element", async () => {
    const host = render(chipsView(
      { status: "failed", card: { outcome: `Analysis failed — ${FAILED_REASON_ABSENT_TEXT.handedOff}` } },
      { status: "pending", card: { outcome: "Curation queued" } },
    ))
    const card = await cardOf(host, "analysis")
    expect(lineOf(card, "outcome")).toBe(`Analysis failed — ${FAILED_REASON_ABSENT_TEXT.handedOff}`)
    expect(lineOf(card, "retry")).toBeUndefined()
    expect(visibleTextOf(chip(host, "analysis"))).toBe(STAGE_INDICATOR_WORDS.analysis.failed)
  })

  it("the failure text is a TEXT NODE — markup in it is escaped, never parsed (T-404-01)", async () => {
    const host = render(chipsView(
      { status: "failed", card: { outcome: "Analysis failed — <img src=x onerror=alert(1)>" } },
      { status: "pending", card: { outcome: "Curation queued" } },
    ))
    const card = await cardOf(host, "analysis")
    const outcome = card.querySelector('[data-stage-card-line="outcome"]')
    expect(outcome?.textContent).toBe("Analysis failed — <img src=x onerror=alert(1)>")
    expect(outcome?.querySelector("img")).toBeNull()
  })
})

describe("a refusal is its own state, and it is not a chip (D-23)", () => {
  it("renders ONE unavailable element naming the refusal, and zero chips", () => {
    const host = render({ kind: "unavailable", error: "job_store_schema_version", reason: "stamped by another build" })
    const state = host.querySelectorAll('[data-chips-state="unavailable"]')
    expect(state).toHaveLength(1)
    expect(state[0]!.textContent).toContain(POST_PROCESSING_UNAVAILABLE_WORD)
    expect(state[0]!.getAttribute("data-stage-state")).toBe("unavailable")
    expect(state[0]!.getAttribute("tabindex")).toBe("0")
    expect(state[0]!.getAttribute("title")).toBeNull()
    // The detail LEAVES header chrome (D-09): the root names the refusal, the card carries why.
    expect(state[0]!.textContent).not.toContain("job_store_schema_version")
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(0)
  })

  it("moves the refusal's error and reason into its card, each on its own line (D-09)", async () => {
    const host = render({ kind: "unavailable", error: "job_store_schema_version", reason: "stamped by another build" })
    const root = host.querySelector<HTMLElement>('[data-chips-state="unavailable"]')!

    await act(async () => { root.focus() })
    const card = document.querySelector('[data-stage-card="unavailable"]')
    expect(card).not.toBeNull()
    expect(card!.querySelector('[data-stage-card-line="outcome"]')?.textContent).toBe(CHIPS_UNAVAILABLE_TEXT)
    expect(card!.querySelector('[data-stage-card-line="error"]')?.textContent).toBe("job_store_schema_version")
    expect(card!.querySelector('[data-stage-card-line="reason"]')?.textContent).toBe("stamped by another build")
  })

  it("a view that has not arrived yet is `loading`, which is not `pending` and not blank", () => {
    const host = render(undefined)
    const loading = host.querySelectorAll('[data-chips-state="loading"]')
    expect(loading).toHaveLength(1)
    // An ellipsis is nothing at all to a screen reader; the wait is announced (UI-SPEC S3).
    expect(loading[0]!.getAttribute("role")).toBe("status")
    expect(loading[0]!.querySelector(".sr-only")?.textContent).toBe(POST_PROCESSING_LOADING_LABEL)
    expect(host.querySelectorAll("[data-chip]")).toHaveLength(0)
  })
})

// COLOUR IS NEVER ALONE (425 D-06, roadmap SC2). Six states, six distinguishable pairs of shape and
// word — the claim a grayscale render makes good on. `excluded` and `unavailable` share the dash
// glyph ON PURPOSE, so their words are what separate them, which this cell measures rather than
// asserts by eye.
describe("every indicator state is readable with the colour stripped out (D-06, SC2)", () => {
  /** Mount one view, read the analysis root's shape-and-word pair, unmount before the next. */
  function lookOf(loose: Record<string, unknown>): { glyph: string; words: string } {
    const host = render(chipsView(loose, loose))
    const el = chip(host, "analysis")
    const pair = {
      glyph: [...el.querySelector("svg")!.classList].find((c) => c.startsWith("lucide-")) ?? "",
      words: el.textContent ?? "",
    }
    act(() => { root?.unmount() })
    container?.remove()
    root = undefined
    container = undefined
    return pair
  }

  it("STAGE-INDICATOR-COLOUR-FREE: each state pairs a distinct glyph with a distinct word", () => {
    const pairs = new Map<string, { glyph: string; words: string }>()
    for (const state of ["complete", "running", "pending", "failed", "excluded"] as const) {
      pairs.set(state, lookOf({ status: "pending", state }))
    }

    const host = render({ kind: "unavailable", error: "e" })
    const refusal = host.querySelector<HTMLElement>('[data-chips-state="unavailable"]')!
    pairs.set("unavailable", {
      glyph: [...refusal.querySelector("svg")!.classList].find((c) => c.startsWith("lucide-")) ?? "",
      words: refusal.textContent ?? "",
    })

    expect([...pairs].map(([state, pair]) => [state, pair.glyph])).toEqual([
      ["complete", "lucide-circle-check"],
      ["running", "lucide-circle-dashed"],
      ["pending", "lucide-circle"],
      ["failed", "lucide-circle-x"],
      ["excluded", "lucide-circle-minus"],
      ["unavailable", "lucide-circle-minus"],
    ])

    // No two states share BOTH halves — the dash pair is separated by its word.
    const both = [...pairs.values()].map((pair) => `${pair.glyph}|${pair.words}`)
    expect(new Set(both).size).toBe(both.length)
  })

  it("the running glyph is the header's one piece of motion, and it respects reduced motion", () => {
    for (const state of ["complete", "running", "pending", "failed", "excluded"] as const) {
      const host = render(chipsView({ status: "pending", state }, { status: "pending", state }))
      const glyph = chip(host, "analysis").querySelector("svg")!
      expect(glyph.classList.contains("motion-safe:animate-pulse")).toBe(state === "running")
      expect(glyph.classList.contains("animate-pulse")).toBe(false)
      act(() => { root?.unmount() })
      container?.remove()
      root = undefined
      container = undefined
    }
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
