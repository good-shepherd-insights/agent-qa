// @vitest-environment jsdom

// 427 · D-05, D-06, D-10 — the Knowledge used rows a reader sees. Views are built through the real
// projectKnowledgeView over schema-parsed projections, never by hand.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"

import { RunKnowledgeProjectionSchema } from "@vostride/agent-qa-schema"

import { KnowledgeUsed } from "@/components/run-detail/knowledge-used"
import { TabKnowledge } from "@/components/run-detail/tab-knowledge"
import {
  CHANNEL_EYEBROWS,
  CONTENT_ABSENCE_REASON_TEXT,
  RECORD_KIND_LABELS,
  RECORD_UNREADABLE_LEAD,
  USED_PAGE_SIZE,
  projectKnowledgeView,
  showAllRecordsLabel,
  type KnowledgeView,
  type UsedSectionView,
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

type Join = {
  recordContent?: ReturnType<typeof content>
  contentAbsence?: { reason: "not-found" | "scan-incomplete" | "not-bound" }
}

function content(summary: string, kind: string) {
  return {
    content: `body of ${summary}`,
    summary,
    kind,
    applicability: { product: "shop", scope: "shop", anchors: [], openedAtOrdinal: 1 },
    currentStatus: "active",
    currentTrust: { confirmations: 1, contradictions: 0, evidenceTokens: [], lastEventOrdinal: 1 },
  }
}

function line(id: string, summary: string, kind = "fact", join: Join = {}) {
  return { id, kind, summary, trust: 0.9, status: "active", servedAsCanary: false, tier: "confirmed", ...join }
}

interface Served {
  readonly channel1?: ReturnType<typeof line>[]
  readonly channel2?: Array<{ id: string; detailLevel: string; bodyDigest: string } & Join>
  readonly channel3?: Array<{ id: string; summary: string } & Join>
  readonly planSource?: Record<string, unknown>
}

function step(stepIndex: number, served: Served) {
  return {
    testId: "t_used",
    testIndex: 0,
    stepIndex,
    stepText: `step text ${String(stepIndex)}`,
    served: { channel1: served.channel1 ?? [], channel2: served.channel2 ?? [], channel3: served.channel3 ?? [] },
    trace: { kind: "no-trace", reason: "pre-trace-run" },
    ...(served.planSource === undefined ? {} : { planSource: served.planSource }),
  }
}

function readyView(steps: ReturnType<typeof step>[]): Extract<KnowledgeView, { state: "ready" }> {
  const projection = RunKnowledgeProjectionSchema.parse({
    kind: "ready",
    runId: "run-427-05-used",
    buildOrdinal: 1,
    knowledgeStore: "bound",
    steps,
    curation: { status: "done" },
    learned: { changes: [], canaryAttributions: [] },
  })
  const view = projectKnowledgeView({ kind: "read", projection })
  if (view.state !== "ready") throw new Error("expected a ready view")
  return view
}

function usedOf(steps: ReturnType<typeof step>[]): UsedSectionView {
  return readyView(steps).used
}

function rows(view: HTMLElement): HTMLElement[] {
  return [...view.querySelectorAll<HTMLElement>("li[data-used-record]")]
}

describe("a used row wears its record's kind (D-06)", () => {
  it("KIND-LABEL: a caution reads Caution, the unknown kind reads Open question, no known kind has no label", () => {
    const view = mount(<KnowledgeUsed view={usedOf([
      step(0, {
        channel3: [{ id: "rec_c", summary: "do not trust the banner", recordContent: content("do not trust the banner", "caution") }],
        channel1: [line("rec_u", "maybe the cart resets", "unknown"), line("rec_h", "a served line of no known kind", "hunch")],
      }),
    ])} />)

    const [unknown, noKind, caution] = rows(view)
    expect(caution?.getAttribute("data-record-kind")).toBe("caution")
    expect(caution?.querySelector('[data-slot="badge"]')?.textContent).toBe(RECORD_KIND_LABELS.caution)
    expect(unknown?.getAttribute("data-record-kind")).toBe("unknown")
    expect(unknown?.querySelector('[data-slot="badge"]')?.textContent).toBe("Open question")
    expect(noKind?.hasAttribute("data-record-kind")).toBe(false)
    expect(noKind?.querySelector('[data-slot="badge"]')).toBeNull()
  })
})

describe("a record that can no longer be read keeps its row (D-10)", () => {
  it("CONTENT-ABSENCE-KEEPS-ROW: an opened-only not-found record leads honestly and names the reason", () => {
    const view = mount(<KnowledgeUsed view={usedOf([
      step(0, { channel2: [{ id: "rec_gone", detailLevel: "full", bodyDigest: "d", contentAbsence: { reason: "not-found" } }] }),
    ])} />)

    const [row] = rows(view)
    expect(row).toBeDefined()
    expect(row?.getAttribute("data-content-absence")).toBe("not-found")
    expect(row?.querySelector("[data-row-primary]")?.textContent).toBe(RECORD_UNREADABLE_LEAD)
    expect(row?.querySelector("[data-row-absence-reason]")?.textContent).toBe(CONTENT_ABSENCE_REASON_TEXT["not-found"])
    expect([...view.querySelectorAll("*")].some(element => element.textContent === "Show full record")).toBe(false)
    expect(view.outerHTML).not.toContain("rec_gone")
  })

  it("CONTENT-ABSENCE-KEEPS-ROW: a joined row carries no absence attribute and no absence line", () => {
    const view = mount(<KnowledgeUsed view={usedOf([
      step(0, { channel1: [line("rec_ok", "the cart page lives at /view_cart", "fact", { recordContent: content("x", "fact") })] }),
    ])} />)

    const [row] = rows(view)
    expect(row?.hasAttribute("data-content-absence")).toBe(false)
    expect(row?.querySelector("[data-row-absence-reason]")).toBeNull()
  })
})

describe("the default view speaks of records, never channels (D-05)", () => {
  it("NO-CHANNEL-IN-DEFAULT-VIEW: used, effect and changes carry no channel eyebrow, name or number", () => {
    const view = mount(<TabKnowledge view={readyView([
      step(0, {
        channel1: [line("rec_a", "the cart page lives at /view_cart")],
        channel3: [{ id: "rec_b", summary: "the promo banner lies about stock" }],
        channel2: [{ id: "rec_c", detailLevel: "full", bodyDigest: "d", recordContent: content("checkout needs a login", "procedure") }],
        planSource: { kind: "procedure-replay", procedureId: "rec_p", guard: { checksPassed: 2, total: 2 } },
      }),
    ])} />)

    expect(rows(view).length).toBe(4)
    for (const section of ["used", "effect", "changes"]) {
      const text = view.querySelector(`[data-knowledge-section="${section}"]`)?.textContent ?? ""
      expect(text.length).toBeGreaterThan(0)
      for (const eyebrow of Object.values(CHANNEL_EYEBROWS)) expect(text).not.toContain(eyebrow)
      expect(text).not.toMatch(/channel/i)
    }
  })
})

describe("a long run pages its used rows (UI-SPEC S1 paging)", () => {
  it("USED-PAGING: 60 records render 50, then Show all 60 records opens a second list with the other 10", () => {
    const lines = Array.from({ length: 60 }, (_, index) => line(`rec_${String(index)}`, `record number ${String(index)}`))
    const view = mount(<KnowledgeUsed view={usedOf([step(0, { channel1: lines })])} />)

    const section = view.querySelector('[data-knowledge-section="used"]')
    const lists = () => [...(section?.querySelectorAll("ul") ?? [])]
    expect(lists().length).toBe(1)
    expect(lists()[0]?.querySelectorAll(":scope > li").length).toBe(USED_PAGE_SIZE)

    const trigger = section?.querySelector<HTMLElement>('[data-used-show-all="60"]')
    expect(trigger?.textContent).toBe(showAllRecordsLabel(60))
    act(() => { trigger?.click() })

    expect(lists().length).toBe(2)
    const rest = lists()[1]?.querySelectorAll(":scope > li")
    expect(rest?.length).toBe(10)
    expect(rest?.[9]?.querySelector("[data-row-primary]")?.textContent).toBe("record number 59")
  })

  it("USED-PAGING: exactly 50 records render one list and no trigger", () => {
    const lines = Array.from({ length: 50 }, (_, index) => line(`rec_${String(index)}`, `record number ${String(index)}`))
    const view = mount(<KnowledgeUsed view={usedOf([step(0, { channel1: lines })])} />)
    expect(view.querySelectorAll("ul").length).toBe(1)
    expect(view.querySelector("[data-used-show-all]")).toBeNull()
  })
})

describe("the heading counts records the way a person reads them", () => {
  it("USED-COUNT-LINE: 1 record, 3 records, and no count line at zero", () => {
    const one = mount(<KnowledgeUsed view={usedOf([step(0, { channel1: [line("rec_a", "a")] })])} />)
    expect(one.querySelector("[data-used-count-line]")?.textContent).toBe("1 record")
    act(() => { root?.unmount() })
    one.remove()

    const three = mount(<KnowledgeUsed view={usedOf([
      step(0, { channel1: [line("rec_a", "a")], channel3: [{ id: "rec_b", summary: "b" }] }),
      step(1, { channel2: [{ id: "rec_c", detailLevel: "full", bodyDigest: "d" }] }),
    ])} />)
    expect(three.querySelector("[data-used-count-line]")?.textContent).toBe("3 records")
    act(() => { root?.unmount() })
    three.remove()

    const zero = mount(<KnowledgeUsed view={usedOf([step(0, {})])} />)
    expect(zero.querySelector("[data-used-count-line]")).toBeNull()
    expect(zero.querySelector("[data-section-absence]")).not.toBeNull()
  })
})

describe("producer text is text (T-427-05-01)", () => {
  it("USED-HOSTILE-TEXT: a summary shaped like markup renders as text and creates no element", () => {
    const hostile = "<img src=x onerror=alert(1)>"
    const view = mount(<KnowledgeUsed view={usedOf([step(0, { channel1: [line("rec_h", hostile)] })])} />)

    expect(view.querySelector("[data-row-primary]")?.textContent).toBe(hostile)
    expect(view.querySelector("img")).toBeNull()
  })
})
