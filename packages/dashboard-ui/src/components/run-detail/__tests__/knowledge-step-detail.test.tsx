// @vitest-environment jsdom

// THE EXPANDED STEP ROW A PERSON ACTUALLY SEES (407-06 · LERN-01, D-03/D-04/D-07/D-08, T-407-14).
//
// WHAT THIS FILE IS FOR. `tab-knowledge.test.tsx` pins the COLLAPSED row and the five page states;
// this file pins what is behind the chevron — the three channels, the per-line why-trace, the cut
// ledger, the procedure outcome and the canary attribution. They are separate files because they
// are separate subjects: the shell is about which state the tab is in, and this is about whether
// a line that was served can be explained.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-served-channel`, `data-served-as-canary`,
// `data-canary-outcome`, `data-trace-state`, `data-cut-candidates`, `data-plan-source-outcome` and
// `data-channel-show-all` are what a later Playwright cell addresses on the built bundle, so each
// is pinned here in the cheap medium first. Badge tints are NOT asserted — a cell pinning
// `bg-emerald-500/15` would go red on a palette change that broke nothing a person relies on.
//
// EVERY NO-TRACE ARM GETS ITS OWN CELL, because D-04's whole claim is that nothing silently drops.
// A step that served a line the trace cannot explain must SAY which of the three absences applies;
// three arms collapsed into one silent branch is the failure these cells exist to catch.
//
// THE COPY IS ASSERTED BY ITS EXPORTED CONSTANT (403-05 D-5), never by literal prose — except
// where a cell is deliberately pinning the SENTENCE OF RECORD from the Copywriting Contract, in
// which case the literal IS the claim.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeStepDetail } from "@/components/run-detail/knowledge-step-detail"
import { KnowledgeBriefLine } from "@/components/run-detail/knowledge-brief-line"
import {
  ATTRIBUTION_PENDING_TEXT,
  CANARY_BADGE_TEXT,
  CHANNEL_EYEBROWS,
  NOT_ATTRIBUTED_TEXT,
  PRE_TRACE_TEXT,
  PROCEDURE_HINT_DEMOTED_TEXT,
  PROCEDURE_HINT_TEXT,
  STEP_NOT_FOUND_TEXT,
  WHY_TRIGGER_TEXT,
  cutCandidatesLabel,
  showAllLinesLabel,
  traceLineText,
  type BriefLineView,
  type StepDetailView,
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

function click(element: Element | null): void {
  if (element === null) throw new Error("nothing to click")
  act(() => { (element as HTMLElement).click() })
}

/** One channel-1 line view. Everything absent unless a cell asks for it. */
function line(overrides: Partial<BriefLineView> = {}): BriefLineView {
  return {
    id: "rec_1",
    kind: "fact",
    summary: "the cart page lives at /view_cart",
    trust: 0.9,
    status: "active",
    servedAsCanary: false,
    tier: "confirmed",
    why: { kind: "answered", leg: "anchor", rank: 1, score: 1.48695 },
    ...overrides,
  }
}

function detail(overrides: Partial<StepDetailView> = {}): StepDetailView {
  return { channel1: [], channel2: [], channel3: [], ...overrides }
}

/** The `li` elements of one channel, in render order. */
function linesOf(view: HTMLElement, channel: "1" | "2" | "3"): HTMLElement[] {
  return Array.from(view.querySelectorAll(`li[data-served-channel="${channel}"]`))
}

describe("a served line carries the trace that explains it, inline (D-04)", () => {
  it("marks the line answered and reveals its leg, rank and score behind the why trigger", () => {
    const view = mount(<KnowledgeBriefLine line={line()} />)

    const li = view.querySelector("li")
    expect(li?.getAttribute("data-served-channel")).toBe("1")
    expect(li?.getAttribute("data-trace-state")).toBe("answered")

    // Closed: the answer is not on the page yet — the trigger is the whole affordance.
    expect(view.textContent).toContain(WHY_TRIGGER_TEXT)
    expect(view.textContent).not.toContain(traceLineText("anchor", 1, 1.48695))

    click(view.querySelector('[data-slot="collapsible-trigger"]'))

    expect(view.textContent).toContain("leg anchor · rank 1 · score 1.487")
    expect(view.textContent).toContain(traceLineText("anchor", 1, 1.48695))
  })

  it("renders the SHIPPED evidence-incomplete component when the artifact is gone", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ why: { kind: "no-trace", reason: "artifact-missing" } })} />,
    )

    expect(view.querySelector("li")?.getAttribute("data-trace-state")).toBe("artifact-missing")
    expect(view.querySelector('[data-evidence-state="incomplete"]')).not.toBeNull()
    // Nothing to expand: there is no answer behind a trigger that would open onto nothing.
    expect(view.textContent).not.toContain(WHY_TRIGGER_TEXT)
  })

  it("says a trace was never captured for a run that predates trace capture", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ why: { kind: "no-trace", reason: "pre-trace-run" } })} />,
    )

    expect(view.querySelector("li")?.getAttribute("data-trace-state")).toBe("pre-trace-run")
    expect(view.textContent).toContain(PRE_TRACE_TEXT)
    expect(view.querySelector('[data-evidence-state="incomplete"]')).toBeNull()
  })

  it("says no evidence was recorded for the step when the trace holds nothing for this line", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ why: { kind: "no-trace", reason: "step-not-found" } })} />,
    )

    expect(view.querySelector("li")?.getAttribute("data-trace-state")).toBe("step-not-found")
    expect(view.textContent).toContain(STEP_NOT_FOUND_TEXT)
  })
})

describe("a canary line is marked ALWAYS, and its outcome is never blank (D-08)", () => {
  it("wears the canary marker and the attributed outcome once curation settled", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ servedAsCanary: true, canaryOutcome: "confirmed" })} />,
    )

    const li = view.querySelector("li")
    expect(li?.getAttribute("data-served-as-canary")).toBe("true")
    expect(li?.getAttribute("data-canary-outcome")).toBe("confirmed")

    const badges = Array.from(view.querySelectorAll('[data-slot="badge"]')).map(b => b.textContent)
    expect(badges).toContain(CANARY_BADGE_TEXT)
    expect(badges).toContain("confirmed")
  })

  it("says ATTRIBUTION PENDING while curation has not settled — the marker stays either way", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ servedAsCanary: true, canaryOutcome: "pending" })} />,
    )

    expect(view.querySelector("li")?.getAttribute("data-canary-outcome")).toBe("pending")
    const badges = Array.from(view.querySelectorAll('[data-slot="badge"]')).map(b => b.textContent)
    expect(badges).toEqual([CANARY_BADGE_TEXT, ATTRIBUTION_PENDING_TEXT])
  })

  it("says NOT ATTRIBUTED when the fold recorded nothing for it — never an empty slot", () => {
    const view = mount(
      <KnowledgeBriefLine line={line({ servedAsCanary: true, canaryOutcome: "not-attributed" })} />,
    )

    expect(view.querySelector("li")?.getAttribute("data-canary-outcome")).toBe("not-attributed")
    expect(view.textContent).toContain(NOT_ATTRIBUTED_TEXT)
  })

  it("leaves a non-canary line with no outcome attribute and no canary badge at all", () => {
    const view = mount(<KnowledgeBriefLine line={line()} />)

    const li = view.querySelector("li")
    expect(li?.getAttribute("data-served-as-canary")).toBe("false")
    expect(li?.hasAttribute("data-canary-outcome")).toBe(false)
    expect(view.textContent).not.toContain(CANARY_BADGE_TEXT)
  })
})

describe("the three channels are named, and an empty one says so by being empty (D-03)", () => {
  it("renders exactly the three eyebrows the Copywriting Contract spells", () => {
    const view = mount(<KnowledgeStepDetail detail={detail()} />)

    expect(view.textContent).toContain("CHANNEL 1 · BRIEF")
    expect(view.textContent).toContain("CHANNEL 2 · READ TRACES")
    expect(view.textContent).toContain("CHANNEL 3 · CAUTIONS")
    for (const eyebrow of Object.values(CHANNEL_EYEBROWS)) {
      expect(view.textContent).toContain(eyebrow)
    }
    expect(view.querySelectorAll("li").length).toBe(0)
  })

  it("paints a read trace and a caution on their own channels", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({
      channel1: [line()],
      channel2: [{ id: "rec_b", detailLevel: "full" }],
      channel3: [{ id: "rec_c", summary: "this page is slow to settle" }],
    })} />)

    expect(linesOf(view, "1").length).toBe(1)
    expect(linesOf(view, "2")[0].textContent).toContain("rec_b")
    expect(linesOf(view, "2")[0].textContent).toContain("full")
    expect(linesOf(view, "3")[0].textContent).toContain("this page is slow to settle")
  })
})

describe("the cut ledger answers why it did NOT say something (D-04)", () => {
  it("carries the ledger size on the disclosure and the producer cap in its label", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({
      cut: {
        label: cutCandidatesLabel(3),
        lines: [
          { recordId: "rec_x", leg: "lexical", rank: 21, score: 0.11 },
          { recordId: "rec_y", leg: "dense", rank: 22, score: 0.1 },
          { recordId: "rec_z", leg: "anchor", rank: 23, score: 0.09 },
        ],
      },
    })} />)

    const disclosure = view.querySelector("[data-cut-candidates]")
    expect(disclosure?.getAttribute("data-cut-candidates")).toBe("3")
    expect(disclosure?.textContent).toContain("Cut candidates (3 of top 20)")

    click(view.querySelector('[data-cut-candidates] [data-slot="collapsible-trigger"]'))
    expect(view.textContent).toContain("rec_x")
    expect(view.textContent).toContain("rec_z")
  })

  it("renders no disclosure at all for a step whose trace could not answer", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({ channel1: [line()] })} />)

    expect(view.querySelector("[data-cut-candidates]")).toBeNull()
  })
})

describe("a replay states its guard outcome and a hint states its demotion (D-07)", () => {
  it("names the step a replay broke at and the cause the guard recorded", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({
      planSource: { kind: "procedure-replay", sentence: "broke at step 3: verifier rejection", tone: "broke" },
    })} />)

    const row = view.querySelector("[data-plan-source-outcome]")
    expect(row?.getAttribute("data-plan-source-outcome")).toBe("broke")
    expect(row?.textContent).toContain("broke at step 3: verifier rejection")
  })

  it("says replayed n/n when the guard passed", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({
      planSource: { kind: "procedure-replay", sentence: "replayed 5/5", tone: "ok" },
    })} />)

    const row = view.querySelector("[data-plan-source-outcome]")
    expect(row?.getAttribute("data-plan-source-outcome")).toBe("ok")
    expect(row?.textContent).toContain("replayed 5/5")
  })

  it("keeps a demoted hint tellable apart from an ordinary one (G-381-4)", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({
      planSource: { kind: "procedure-hint", sentence: PROCEDURE_HINT_DEMOTED_TEXT, tone: "hint" },
    })} />)

    const row = view.querySelector("[data-plan-source-outcome]")
    expect(row?.getAttribute("data-plan-source-outcome")).toBe("hint")
    expect(row?.textContent).toContain(PROCEDURE_HINT_DEMOTED_TEXT)
    expect(PROCEDURE_HINT_DEMOTED_TEXT).not.toBe(PROCEDURE_HINT_TEXT)
  })

  it("renders no plan-source row on a step whose plan no procedure touched", () => {
    const view = mount(<KnowledgeStepDetail detail={detail({ channel1: [line()] })} />)

    expect(view.querySelector("[data-plan-source-outcome]")).toBeNull()
  })
})

describe("a channel longer than the page shows a page, and offers the rest", () => {
  it("renders the first 50 of 60 behind a Show all trigger, and all 60 once it is opened", () => {
    const many = Array.from({ length: 60 }, (_, index) => line({ id: `rec_${String(index)}` }))
    const view = mount(<KnowledgeStepDetail detail={detail({ channel1: many })} />)

    expect(linesOf(view, "1").length).toBe(50)

    const trigger = view.querySelector("[data-channel-show-all]")
    expect(trigger?.textContent).toContain(showAllLinesLabel(60))
    expect(trigger?.textContent).toContain("Show all 60 lines")

    click(trigger)
    expect(linesOf(view, "1").length).toBe(60)
  })

  it("offers no Show all trigger at exactly the page size", () => {
    const many = Array.from({ length: 50 }, (_, index) => line({ id: `rec_${String(index)}` }))
    const view = mount(<KnowledgeStepDetail detail={detail({ channel1: many })} />)

    expect(linesOf(view, "1").length).toBe(50)
    expect(view.querySelector("[data-channel-show-all]")).toBeNull()
  })
})

describe("producer text reaches the DOM as TEXT, never as markup (T-407-14)", () => {
  it("renders a hostile brief summary as a text node — no element is created from it", () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const view = mount(<KnowledgeStepDetail detail={detail({ channel1: [line({ summary: hostile })] })} />)

    expect(view.querySelector("img")).toBeNull()
    expect(view.textContent).toContain(hostile)
  })

  it("renders a hostile caution summary as a text node too", () => {
    const hostile = '<script>alert(1)</script>'
    const view = mount(<KnowledgeStepDetail detail={detail({
      channel3: [{ id: "rec_c", summary: hostile }],
    })} />)

    expect(view.querySelector("script")).toBeNull()
    expect(view.textContent).toContain(hostile)
  })
})
