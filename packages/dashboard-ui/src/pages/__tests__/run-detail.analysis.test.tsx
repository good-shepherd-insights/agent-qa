// @vitest-environment jsdom
//
// THE FAILURE VIEW ON THE PAGE (406-01 · DETL-04, D-03 / D-05 / D-10).
//
// FOUR CLAIMS, ALL ABOUT WHAT A PERSON SEES AND WHEN:
//
//   1. the page reads `/analysis` once at mount and again on EVERY analysis-chip TRANSITION, and
//      never on a frame whose word did not change (D-03);
//   2. a failed member's group carries the op's sentence VERBATIM, with the provenance chip built
//      from that verdict's own producer and confidence (D-05/D-10);
//   3. a member with no verdict — a passed one — carries no block at all;
//   4. a sentence containing markup renders as a TEXT NODE, never an element (T-406-02).
//
// THE MOCK BLOCK IS `run-detail.members.test.tsx`'S, with one addition: `watchPostProcessing`
// CAPTURES its `onRead` so a cell can push frames. The real watcher constructs an `EventSource`
// and a 3 s interval against a `fetch` these cells do not stub; its own behaviour is measured in
// `run-detail.post-processing.test.tsx`.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  AnalysisGetOutput,
  RunDetailMember,
  RunDetailProjection,
  RunDetailStep,
} from "@vostride/agent-qa-schema"

import RunDetailPage from "@/pages/run-detail"
import { DETERMINISTIC_FALLBACK_LABEL, provenanceLabel } from "@/lib/analysis-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = "run-406"
/** The op's sentence, spelled once. Every assertion below compares against THIS string. */
const FLOOR_SENTENCE =
  'observed (step 0): "Error: element \\"Submit\\" not found" — root cause undetermined'

const {
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunAnalysisMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
  pushPostProcessing,
} = vi.hoisted(() => {
  // The captured `onRead`, module-level so a cell can push a frame after mount (RESEARCH
  // Pitfall 8). A watcher double that dropped its callback would make every transition cell
  // vacuous — it would assert on a channel nothing can ever send down.
  let onRead: ((read: unknown) => void) | undefined
  return {
    fetchRunMock: vi.fn(),
    fetchRunDetailMock: vi.fn(),
    fetchRunAnalysisMock: vi.fn(),
    fetchRunArtifactMock: vi.fn(),
    fetchExecutionLogsMock: vi.fn(),
    fetchAccessibilitySummaryMock: vi.fn(),
    pushPostProcessing: {
      capture: (next: ((read: unknown) => void) | undefined) => { onRead = next },
      send: (read: unknown) => { onRead?.(read) },
      reset: () => { onRead = undefined },
    },
  }
})

vi.mock("@/lib/api", () => ({
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  fetchRunAnalysis: fetchRunAnalysisMock,
  fetchRunArtifact: fetchRunArtifactMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
  triggerRun: vi.fn(),
  watchPostProcessing: (_id: string, options: { onRead: (read: unknown) => void }) => {
    pushPostProcessing.capture(options.onRead)
    return () => { pushPostProcessing.capture(undefined) }
  },
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
vi.mock("@/components/run-detail/tab-panels", () => ({
  TabPanels: () => <div data-testid="tab-panels" />,
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
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: { children: ReactNode }) => <span {...rest}>{children}</span>,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}))

function member(testIndex: number, extra: Partial<RunDetailMember> = {}): RunDetailMember {
  return { testIndex, attempts: 1, ...extra }
}

function step(testIndex: number, stepIndex: number, stepText: string): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    stepText,
    cacheStatus: "miss",
    verifierVerdict: { pass: true, reasoning: "looks right" },
    selfHealOccurred: false,
    briefDigest: `d${String(testIndex)}${String(stepIndex)}`,
    status: "passed",
    durationMs: 1000,
  }
}

/** Member 0 FAILED (it gets the verdict), member 1 PASSED (it gets nothing). */
const TWO_MEMBERS: RunDetailProjection = {
  runId: RUN_ID,
  members: [
    member(0, { name: "Checkout", outcome: "failed" }),
    member(1, { name: "Login", outcome: "passed" }),
  ],
  steps: [step(0, 0, "Click Submit"), step(1, 0, "Open login")],
  subActions: [],
  tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
}

function analysisOf(over: Partial<AnalysisGetOutput> = {}): AnalysisGetOutput {
  return {
    runId: RUN_ID,
    verdicts: [
      { perTest: 0, testId: "t_checkout", class: "unknown", producer: "deterministic-classifier", confidence: 0 },
    ],
    sentences: [{ perTest: 0, testId: "t_checkout", sentence: FLOOR_SENTENCE }],
    clusters: [],
    ...over,
  }
}

/** The read route's own frame shape — the only thing `watchPostProcessing` ever hands the page. */
const CHIP_PENDING = { kind: "read", status: { runId: RUN_ID, chips: { analysis: 'pending', curation: 'pending' } } }
const CHIP_RUNNING = { kind: "read", status: { runId: RUN_ID, chips: { analysis: 'running', curation: 'pending' } } }
const CHIP_DONE = { kind: "read", status: { runId: RUN_ID, chips: { analysis: 'done', curation: 'pending' } } }
/** The SAME analysis word, a different curation word — a frame that must trigger nothing. */
const CHIP_DONE_AGAIN = { kind: "read", status: { runId: RUN_ID, chips: { analysis: 'done', curation: 'done' } } }

function runRow(id: string) {
  return {
    id,
    name: "Checkout suite",
    filePath: "tests/checkout.yaml",
    status: "failed",
    duration: 10000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: "2026-08-28T00:00:00.000Z",
    endedAt: "2026-08-28T00:00:10.000Z",
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
    createdAt: "2026-08-28T00:00:00.000Z",
  }
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

async function renderPage() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[`/runs/${RUN_ID}`]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flushRender()
  return container
}

/** Push one post-processing frame and let the effects it triggers settle. */
async function push(read: unknown) {
  await act(async () => { pushPostProcessing.send(read) })
  await flushRender()
}

beforeEach(() => {
  document.title = ""
  Element.prototype.scrollIntoView = vi.fn()
  pushPostProcessing.reset()
  fetchRunMock.mockReset()
  fetchRunDetailMock.mockReset()
  fetchRunAnalysisMock.mockReset()
  fetchRunArtifactMock.mockReset()
  fetchExecutionLogsMock.mockReset()
  fetchAccessibilitySummaryMock.mockReset()

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
  fetchRunArtifactMock.mockResolvedValue({ run: { id: RUN_ID }, artifact: null, children: [], missingSections: ["artifact"] })
  fetchRunMock.mockImplementation(async (id: string) => ({ run: runRow(id) }))
  fetchRunDetailMock.mockResolvedValue(TWO_MEMBERS)
  fetchRunAnalysisMock.mockResolvedValue(analysisOf())
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  if (container) container.remove()
  container = null
  vi.clearAllMocks()
})

describe("the page re-reads analysis on chip TRANSITIONS and on nothing else (D-03)", () => {
  it("reads once at mount, again per changed chip word, and NOT on a repeated frame", async () => {
    await renderPage()
    expect(fetchRunAnalysisMock, "one read at mount").toHaveBeenCalledTimes(1)
    expect(fetchRunAnalysisMock).toHaveBeenCalledWith(RUN_ID)

    await push(CHIP_PENDING)
    expect(fetchRunAnalysisMock, "undefined → pending is a transition").toHaveBeenCalledTimes(2)

    await push(CHIP_RUNNING)
    expect(fetchRunAnalysisMock, "pending → running is a transition").toHaveBeenCalledTimes(3)

    await push(CHIP_DONE)
    expect(fetchRunAnalysisMock, "running → done is a transition").toHaveBeenCalledTimes(4)

    await push(CHIP_DONE)
    await push(CHIP_DONE_AGAIN)
    expect(
      fetchRunAnalysisMock,
      "a frame whose ANALYSIS word did not change is a trigger for nothing",
    ).toHaveBeenCalledTimes(4)
  })
})

describe("a failed member's group carries the op's sentence and its provenance (D-05/D-10)", () => {
  it("paints the sentence VERBATIM under the failed member, with the floor's provenance chip", async () => {
    const view = await renderPage()

    const block = view.querySelector('[data-member="0"] [data-verdict-block]')
    expect(block, "the failed member's group holds the block").not.toBeNull()
    expect(
      block?.querySelector("[data-verdict-sentence]")?.textContent,
      "the op's bytes, copied — the page composes no sentence",
    ).toBe(FLOOR_SENTENCE)
    expect(block?.getAttribute("data-verdict-producer")).toBe("deterministic-classifier")
    expect(block?.getAttribute("data-verdict-confidence")).toBe("0")
    expect(block?.querySelector("[data-verdict-provenance]")?.textContent)
      .toBe(DETERMINISTIC_FALLBACK_LABEL)
  })

  it("renders NO block on a member the analysis had no verdict for (a passed member)", async () => {
    const view = await renderPage()
    expect(view.querySelector('[data-member="1"]'), "member 1 is rendered").not.toBeNull()
    expect(
      view.querySelectorAll('[data-member="1"] [data-verdict-block]').length,
      "a passed member has nothing to explain, and no block is how that reads",
    ).toBe(0)
  })

  it("reads the LLM provenance off the verdict's own producer and confidence", async () => {
    fetchRunAnalysisMock.mockResolvedValue(analysisOf({
      verdicts: [
        { perTest: 0, testId: "t_checkout", class: "app_bug", producer: "analyze-run", confidence: 0.86 },
      ],
    }))
    const view = await renderPage()

    const block = view.querySelector('[data-member="0"] [data-verdict-block]')
    expect(block?.getAttribute("data-verdict-producer")).toBe("analyze-run")
    expect(block?.getAttribute("data-verdict-confidence")).toBe("0.86")
    expect(block?.querySelector("[data-verdict-provenance]")?.textContent)
      .toBe(provenanceLabel("analyze-run", 0.86))
  })

  it("renders a sentence carrying markup as TEXT, never as an element (T-406-02)", async () => {
    const hostile = '<img src=x onerror=alert(1)> observed (step 0): "boom"'
    fetchRunAnalysisMock.mockResolvedValue(analysisOf({
      sentences: [{ perTest: 0, testId: "t_checkout", sentence: hostile }],
    }))
    const view = await renderPage()

    const sentence = view.querySelector("[data-verdict-sentence]")
    expect(sentence?.textContent, "the markup is the sentence's own text").toBe(hostile)
    expect(sentence?.querySelectorAll("img").length, "no element was ever constructed").toBe(0)
    expect(view.querySelectorAll("img").length).toBe(0)
  })

  it("keeps the previous answer when a re-read rejects — a failed fetch is not a paint input", async () => {
    const view = await renderPage()
    expect(view.querySelector("[data-verdict-sentence]")?.textContent).toBe(FLOOR_SENTENCE)

    fetchRunAnalysisMock.mockRejectedValueOnce(new Error('read_failed'))
    await push(CHIP_RUNNING)

    expect(view.querySelector("[data-verdict-sentence]")?.textContent, "the last real answer stands")
      .toBe(FLOOR_SENTENCE)
  })
})
