// @vitest-environment jsdom
//
// THE KNOWLEDGE TAB ON THE PAGE (407-06 · LERN-01, D-03 / D-05 / D-06, closing WINDOWS #310).
//
// WHY THIS FILE EXISTS. 407-02 shipped the tab and recorded an honest gap against itself: the
// seven page doubles all resolve a FIXED `evidence-incomplete` projection, so nothing pinned the
// READ CARDINALITY (one `runs.knowledge` per run id, none on re-render) and nothing drove a
// REJECTED read all the way into `data-knowledge-state="error"`. Both claims were arguments about
// an effect's dependency list rather than assertions. This file makes them measurements.
//
// IT RENDERS THE REAL `TabPanels` AND THE REAL `TabKnowledge`. A double for either would leave the
// page→projection→tab path — the thing the gap is about — unexercised. Only the primitives that
// need a layout engine or a socket are doubled: `ScrollArea` (Radix's uses `ResizeObserver`, which
// jsdom does not have), the resizable panels, the member `Select`, the tooltip and the navbar.
// `Tabs`, `Collapsible` and `Badge` are REAL, because which tab is mounted and whether a row is
// open are exactly what these cells read.
//
// THE TAB IS SELECTED FROM THE URL, `?tab=knowledge`, which is the page's own initial-state
// spelling. Driving it by keypress would measure the shortcut map (already pinned in
// `run-detail.artifact-drawer.test.tsx`) rather than the read.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { RunKnowledgeProjection } from "@vostride/agent-qa-schema"

import RunDetailPage from "@/pages/run-detail"
import {
  ATTRIBUTION_UNKNOWN_TEXT,
  CHANNEL_EYEBROWS,
  NO_STORE_HEADING,
  READ_FAILED_HEADING,
  STORE_READ_INCOMPLETE_TEXT,
  readFailedBody,
} from "@/lib/knowledge-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = "run-407-06"

const {
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunKnowledgeMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
} = vi.hoisted(() => ({
  fetchRunMock: vi.fn(),
  fetchRunDetailMock: vi.fn(),
  fetchRunKnowledgeMock: vi.fn(),
  fetchRunArtifactMock: vi.fn(),
  fetchExecutionLogsMock: vi.fn(),
  fetchAccessibilitySummaryMock: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  fetchRunAnalysis: () => Promise.resolve({ runId: "", verdicts: [], sentences: [], clusters: [] }),
  // THE SUBJECT of this file — a real spy, so a cell can count what the page asked for.
  fetchRunKnowledge: fetchRunKnowledgeMock,
  fetchRunArtifact: fetchRunArtifactMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
  triggerRun: vi.fn(),
  // The real watcher opens an `EventSource` and a 3 s interval against a `fetch` these cells do
  // not stub; its own behaviour is measured in `run-detail.post-processing.test.tsx`.
  watchPostProcessing: () => () => {},
}))

vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: (title: string) => { document.title = title },
}))
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/page-skeleton", () => ({ DetailSkeleton: () => <div>Loading...</div> }))
vi.mock("@/components/empty-state", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock("@/components/run-detail/run-navbar", () => ({
  RunNavbar: () => <div data-testid="run-navbar">navbar</div>,
}))
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span>member filter</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

function runRow(id: string) {
  return {
    id,
    name: "Checkout suite",
    filePath: "tests/checkout.yaml",
    status: "passed",
    duration: 10000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: "2026-08-29T00:00:00.000Z",
    endedAt: "2026-08-29T00:00:10.000Z",
    failureSummary: null,
    errorLog: null,
    memoryLog: null,
    testId: null,
    suiteId: "s_suite",
    platform: "web",
    testFileContent: null,
    modelName: null,
    llmProvider: null,
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt: "2026-08-29T00:00:00.000Z",
  }
}

function detailProjection(id: string) {
  return {
    runId: id,
    members: [{ testIndex: 0, attempts: 1, name: "Checkout", outcome: "passed" as const }],
    steps: [{
      testIndex: 0,
      stepIndex: 0,
      stepText: "click checkout",
      cacheStatus: "miss" as const,
      verifierVerdict: { pass: true, reasoning: "looks right" },
      selfHealOccurred: false,
      briefDigest: "d00",
      status: "passed" as const,
      durationMs: 1000,
    }],
    subActions: [],
    tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
  }
}

/**
 * A run that really served a brief — the populated fixture 407-02 said this plan would need.
 *
 * One canary line with a committed outcome, one answered trace with a cut candidate, and a replay
 * whose guard passed: enough that the ready panel has something to be wrong about.
 */
const POPULATED: RunKnowledgeProjection = {
  kind: "ready",
  runId: RUN_ID,
  buildOrdinal: 3,
  knowledgeStore: "bound",
  steps: [{
    testId: "t_checkout",
    testIndex: 0,
    stepIndex: 0,
    stepText: "click checkout",
    served: {
      channel1: [{
        id: "rec_cart_url",
        kind: "fact",
        summary: "the cart page lives at /view_cart",
        trust: 0.9,
        status: "active",
        servedAsCanary: true,
        tier: "confirmed",
      }],
      channel2: [],
      channel3: [],
    },
    trace: {
      kind: "answered",
      trace: {
        schemaVersion: 1,
        servedLines: [{ recordId: "rec_cart_url", leg: "anchor", rank: 1, score: 1.48695 }],
        truncated: [{ recordId: "rec_cut", leg: "lexical", rank: 21, score: 0.11 }],
      },
    },
    planSource: {
      kind: "procedure-replay",
      procedureId: "p_checkout",
      guard: { checksPassed: 5, total: 5 },
    },
  }],
  curation: { status: "done" },
  learned: {
    changes: [],
    canaryAttributions: [{
      testIndex: 0,
      stepIndex: 0,
      recordId: "rec_cart_url",
      observationId: "canary-outcome:abc",
      outcome: "confirmed",
    }],
  },
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flushRender() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderAt(url: string) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })

  await flushRender()
  return container as HTMLElement
}

/**
 * Select a tab the way Radix listens for it.
 *
 * `HTMLElement.click()` alone is NOT enough: `TabsTrigger` switches on `mousedown`, so a bare
 * click leaves the tab exactly where it was — and a cardinality cell driven by a click that
 * changed nothing would pass vacuously. The `data-knowledge-state` assertions beside every call
 * are what keep that honest.
 */
async function selectTab(view: HTMLElement, label: string): Promise<void> {
  const trigger = Array.from(view.querySelectorAll('[role="tab"]'))
    .find(candidate => candidate.textContent === label)
  if (trigger === undefined) throw new Error(`no tab trigger reads ${label}`)

  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  })
  await flushRender()
}

function knowledgeState(view: HTMLElement): string | null {
  return view.querySelector("[data-knowledge-state]")?.getAttribute("data-knowledge-state") ?? null
}

beforeEach(() => {
  document.title = ""
  Element.prototype.scrollIntoView = vi.fn()
  for (const mock of [
    fetchRunMock,
    fetchRunDetailMock,
    fetchRunKnowledgeMock,
    fetchRunArtifactMock,
    fetchExecutionLogsMock,
    fetchAccessibilitySummaryMock,
  ]) {
    mock.mockReset()
  }
  fetchRunMock.mockImplementation((id: string) => Promise.resolve({ run: runRow(id) }))
  fetchRunDetailMock.mockImplementation((id: string) => Promise.resolve(detailProjection(id)))
  fetchRunKnowledgeMock.mockResolvedValue(POPULATED)
  fetchRunArtifactMock.mockResolvedValue({
    run: { id: RUN_ID },
    artifact: null,
    children: [],
    missingSections: ["artifact"],
  })
  fetchExecutionLogsMock.mockResolvedValue({ logs: [] })
  fetchAccessibilitySummaryMock.mockResolvedValue({
    enabled: null,
    total: 0,
    bySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    byRule: [],
    stepsWithViolations: 0,
    scannedSteps: 0,
    unscannedSteps: 0,
    totalSteps: 0,
  })
})

afterEach(() => {
  if (root) act(() => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

describe("the page owns ONE runs.knowledge read per run id (D-05)", () => {
  it("reads exactly once for the id it was mounted at, and asks for that id", async () => {
    await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(fetchRunKnowledgeMock).toHaveBeenCalledTimes(1)
    expect(fetchRunKnowledgeMock).toHaveBeenCalledWith(RUN_ID)
  })

  it("does NOT read again when the page re-renders — a tab change is not a new run", async () => {
    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)
    expect(fetchRunKnowledgeMock).toHaveBeenCalledTimes(1)

    // A real re-render through the page's own state: selecting another tab.
    await selectTab(view, "Overview")
    // The switch really happened — Radix unmounts the inactive tab's content, so the knowledge
    // panel is GONE. Without this the assertion below would pass against a click that did nothing.
    expect(view.querySelector("[data-knowledge-state]")).toBeNull()

    await selectTab(view, "Knowledge")
    expect(view.querySelector("[data-knowledge-state]")).not.toBeNull()

    expect(fetchRunKnowledgeMock).toHaveBeenCalledTimes(1)
  })
})

describe("a rejected read is a STATE on the tab, never a skeleton that never resolves (D-06)", () => {
  it("lands the refusal on data-knowledge-state=error with the producer's own reason", async () => {
    fetchRunKnowledgeMock.mockRejectedValue(new Error("read_failed"))

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("error")
    expect(view.textContent).toContain(READ_FAILED_HEADING)
    expect(view.textContent).toContain(readFailedBody("read_failed"))
    expect(view.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("forwards a non-Error rejection as its string rather than swallowing it", async () => {
    fetchRunKnowledgeMock.mockRejectedValue("agent_host_unavailable")

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("error")
    expect(view.textContent).toContain("agent_host_unavailable")
  })

  it("keeps the tab's OWN absences on the read arm — a pruned handoff is not an error", async () => {
    fetchRunKnowledgeMock.mockResolvedValue({ kind: "evidence-incomplete", runId: RUN_ID })

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("evidence-incomplete")
  })

  it("says there is no store when the run was executed with no reader bound (D-16)", async () => {
    fetchRunKnowledgeMock.mockResolvedValue({ ...POPULATED, knowledgeStore: "unbound" })

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("empty-no-store")
    expect(view.textContent).toContain(NO_STORE_HEADING)
  })
})

describe("a populated read paints the Used half, end to end (D-03 / D-04 / D-08)", () => {
  it("derives the summary line and gives the served step its row", async () => {
    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("ready")
    expect(view.querySelector("[data-used-summary]")?.textContent)
      .toBe("1 step briefed · 1 canary line served · 1 procedure replay")

    const rowEl = view.querySelector("[data-step-index]")
    expect(rowEl?.getAttribute("data-plan-source")).toBe("procedure-replay")
    expect(rowEl?.getAttribute("data-canary-lines")).toBe("1")
  })

  it("expands the row onto the channels, the attributed canary and the replay outcome", async () => {
    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    const trigger = view.querySelector('[data-step-index] [data-slot="collapsible-trigger"]')
    await act(async () => { (trigger as HTMLElement).click() })

    expect(view.textContent).toContain(CHANNEL_EYEBROWS[1])

    const briefLine = view.querySelector('li[data-served-channel="1"]')
    expect(briefLine?.getAttribute("data-served-as-canary")).toBe("true")
    expect(briefLine?.getAttribute("data-canary-outcome")).toBe("confirmed")
    expect(briefLine?.getAttribute("data-trace-state")).toBe("answered")

    expect(view.querySelector("[data-cut-candidates]")?.getAttribute("data-cut-candidates")).toBe("1")
    expect(view.querySelector("[data-plan-source-outcome]")?.textContent).toContain("replayed 5/5")
  })
})

describe("a partial store read paints the rows it was handed AND says the read was partial (REVIEW CR-01)", () => {
  // THE OP'S OWN SANCTIONED SHAPE, crossed through the real client double, the real
  // `projectKnowledgeView` and the real `KnowledgeLearned`. `runs.knowledge` degrades its two
  // Learned enrichments INDEPENDENTLY, so a failed attribution scan beside a readable diff ships
  // a change row AND the flag. Everything below the wire must render that as a row with a stamp,
  // never as an assertion that the store could not be read.
  const PARTIAL = {
    ...POPULATED,
    learned: {
      ...POPULATED.learned,
      changes: [{
        schemaVersion: 1 as const,
        recordId: "fact-el-textbox-password-9a05ce",
        change: "confirmed" as const,
        atOrdinal: 2,
        sourceRunId: RUN_ID,
      }],
      scanIncomplete: true as const,
    },
  }

  it("lists the served change, stamps the root incomplete and prints the read note", async () => {
    fetchRunKnowledgeMock.mockResolvedValue(PARTIAL)

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("ready")

    const rows = view.querySelectorAll('li[data-record-change="confirmed"]')
    expect(rows.length).toBe(1)
    expect(rows[0]?.getAttribute("data-record-id")).toBe("fact-el-textbox-password-9a05ce")

    const learned = view.querySelector("[data-learned-state]")
    expect(learned?.getAttribute("data-learned-read")).toBe("incomplete")
    expect(view.querySelector("[data-learned-sentence]")).toBeNull()
    expect(view.querySelector("[data-learned-read-note]")?.textContent)
      .toBe(STORE_READ_INCOMPLETE_TEXT)
  })

  it("keeps a canary outcome that WAS read — a partial read does not un-answer an answered line", async () => {
    fetchRunKnowledgeMock.mockResolvedValue(PARTIAL)

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    const trigger = view.querySelector('[data-step-index] [data-slot="collapsible-trigger"]')
    await act(async () => { (trigger as HTMLElement).click() })

    expect(view.querySelector('li[data-served-channel="1"]')?.getAttribute("data-canary-outcome"))
      .toBe("confirmed")
  })

  // REVIEW WR-02 AT THE PAGE. The op ships `canaryAttributions: []` whenever the attribution scan
  // failed, so a served canary line under a settled chain has no row to join — and the word it
  // wears must be a question, not the positive claim that the store said no.
  it("says the attribution is UNKNOWN for a served canary the partial read never answered", async () => {
    fetchRunKnowledgeMock.mockResolvedValue({
      ...PARTIAL,
      learned: { ...PARTIAL.learned, canaryAttributions: [] },
    })

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    const trigger = view.querySelector('[data-step-index] [data-slot="collapsible-trigger"]')
    await act(async () => { (trigger as HTMLElement).click() })

    expect(view.querySelector('li[data-served-channel="1"]')?.getAttribute("data-canary-outcome")).toBe("unknown")
    expect(view.textContent).toContain(ATTRIBUTION_UNKNOWN_TEXT)
    expect(view.querySelector("[data-learned-state]")?.getAttribute("data-learned-read"))
      .toBe("incomplete")
  })
})

describe("the v1 Memory surface is GONE from the main pane, not guarded (407-16 · REVIEW WR-04, D-02)", () => {
  // `runs.memory_log` lost its last production writer in 407-05 (`92773959`), but the pane kept a
  // collapsible that ran `JSON.parse` on the raw column INSIDE a render function. A legacy row
  // whose bytes are truncated therefore threw during render and took the whole page with it — and
  // the block was the second surface claiming to show what a run remembered, which D-02 gave to
  // the Knowledge tab alone. Deleting it answers both at once, which is why these cells assert an
  // ABSENCE rather than a guard: a guarded block would still be a second surface.
  const memoryTriggers = (view: HTMLElement) =>
    Array.from(view.querySelectorAll("button"))
      .filter(button => (button.textContent ?? "").startsWith("Memory"))

  it("renders a legacy run whose memory-log column holds malformed bytes, and paints no v1 Memory block", async () => {
    fetchRunMock.mockImplementation((id: string) =>
      Promise.resolve({ run: { ...runRow(id), memoryLog: '{"added": 1,' } }))

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("ready")
    expect(memoryTriggers(view)).toHaveLength(0)
  })

  it("paints no v1 Memory block for a WELL-FORMED legacy row either — the block is gone, not guarded", async () => {
    fetchRunMock.mockImplementation((id: string) =>
      Promise.resolve({
        run: {
          ...runRow(id),
          memoryLog: JSON.stringify({
            added: 3, confirmed: 2, deprecated: 1, errors: [], curatorDuration: 1500,
          }),
        },
      }))

    const view = await renderAt(`/runs/${RUN_ID}?tab=knowledge`)

    expect(knowledgeState(view)).toBe("ready")
    expect(memoryTriggers(view)).toHaveLength(0)
  })
})
