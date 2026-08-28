// @vitest-environment jsdom

// WHO OWNS THE CHIP CLIENT (404-07 · LIFE-03/LIFE-04, D-20, 400 D-13).
//
// THE NAVBAR IS PRESENTATIONAL. It takes a view and paints it; it opens no socket, holds no timer
// and knows no run id. The page owns the client, and this file is where that ownership is measured
// rather than asserted — `watchPostProcessing` is held, and the cells count its calls, invoke its
// disposer and read what the navbar was handed. A header that fetched for itself would still paint
// correctly in a component test and would open one client per mount of a component that remounts.
//
// THIS IS ITS OWN FILE ON PURPOSE. 404-06's `run-detail.bounce.test.tsx` measures the page's ONE
// navigation decision and mocks the navbar down to a status probe; folding these cells into it
// would have made that file answer two questions and made this plan edit that plan's subject.
//
// THE PROJECTION IS REAL, NOT MOCKED. `projectPostProcessingView` is pure and total, so doubling it
// would replace the very contract that "the navbar gets the projection of the last read, and
// nothing else" is about.

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useNavigate } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import RunDetailPage from "@/pages/run-detail"
import { routes } from "@/lib/routes"
import { FAILED_REASON_ABSENT_TEXT, PENDING_POSTURE_TEXT } from "@/lib/post-processing-view"
import type { PostProcessingRead } from "@/lib/api"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = "r_chips"
const OTHER_RUN_ID = "r_chips_two"

const {
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
  watchPostProcessingMock,
  disposeMock,
  navbarProps,
} = vi.hoisted(() => ({
  fetchRunMock: vi.fn(),
  fetchRunDetailMock: vi.fn(),
  fetchRunArtifactMock: vi.fn(),
  fetchExecutionLogsMock: vi.fn(),
  fetchAccessibilitySummaryMock: vi.fn(),
  watchPostProcessingMock: vi.fn(),
  disposeMock: vi.fn(),
  navbarProps: [] as Array<{ postProcessing: unknown; hasPostProcessing: unknown }>,
}))

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    fetchRun: fetchRunMock,
    // 2026-08-28 (405-08): the page's second read, stubbed to RESOLVE. Left unstubbed it would hit
    // the real one against a `fetch` these cells do not provide, and the page would sit in its
    // could-not-load posture while the chip client under test was measured on a broken screen.
    fetchRunDetail: fetchRunDetailMock,
    // 2026-08-29 (406-01, D-04): the page's third read, stubbed to RESOLVE for the same reason —
    // the real one would reach a `fetch` these cells do not provide.
    fetchRunAnalysis: () => Promise.resolve({ runId: '', verdicts: [], sentences: [], clusters: [] }),
    fetchRunArtifact: fetchRunArtifactMock,
    fetchExecutionLogs: fetchExecutionLogsMock,
    fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
    fetchActiveExecutions: vi.fn(),
    triggerRun: vi.fn(),
    watchPostProcessing: watchPostProcessingMock,
  }
})

// The navbar becomes a PROBE rather than a stub: what it was handed is the observable, so a page
// that wired the client but forgot to pass the view down has somewhere to be caught.
vi.mock("@/components/run-detail/run-navbar", () => ({
  RunNavbar: (props: { postProcessing?: unknown; hasPostProcessing?: unknown }) => {
    navbarProps.push({ postProcessing: props.postProcessing, hasPostProcessing: props.hasPostProcessing })
    return <div data-testid="run-navbar" />
  },
}))

vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: () => {} }))
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/page-skeleton", () => ({ DetailSkeleton: () => <div data-loading /> }))
vi.mock("@/components/empty-state", () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock("@/components/run-detail/step-tree", () => ({ StepTree: () => <div /> }))
vi.mock("@/components/run-detail/tab-panels", () => ({ TabPanels: () => <div /> }))
vi.mock("@/components/run-detail/artifact-drawer", () => ({ ArtifactDrawer: () => <div /> }))
vi.mock("@/components/run-detail/hook-detail-panel", () => ({ HookDetailPanel: () => <div /> }))
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>view</span>,
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
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}))

function runRow(id: string) {
  return {
    id,
    name: "a chip probe",
    filePath: "tests/probe.test.yaml",
    status: "passed",
    duration: 1000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: "2026-08-27T00:00:00.000Z",
    endedAt: "2026-08-27T00:00:01.000Z",
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
  }
}

function statusRead(analysis: string, curation: string, extra: Record<string, unknown> = {}): PostProcessingRead {
  return {
    kind: "read",
    status: { runId: RUN_ID, chips: { analysis, curation } },
    ...extra,
  } as unknown as PostProcessingRead
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let navigateTo: ((to: string) => void) | undefined

function NavProbe() {
  navigateTo = useNavigate()
  return null
}

function unmountHost(): void {
  if (root === null) return
  const current = root
  const currentContainer = container
  root = null
  container = null
  act(() => { current.unmount() })
  currentContainer?.remove()
}

async function flushRender(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

async function renderPage(): Promise<void> {
  unmountHost()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: routes.runDetail(RUN_ID) }]}>
        <NavProbe />
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flushRender()
}

/** The `onRead` the page handed the client on its Nth subscription. */
function onReadOf(call = 0): (read: PostProcessingRead) => void {
  const args = watchPostProcessingMock.mock.calls[call]
  if (args === undefined) throw new Error(`no watchPostProcessing call ${String(call)}`)
  return (args[1] as { onRead: (read: PostProcessingRead) => void }).onRead
}

function lastNavbarView(): unknown {
  const last = navbarProps.at(-1)
  if (last === undefined) throw new Error("the navbar never rendered")
  return last.postProcessing
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  navbarProps.length = 0
  navigateTo = undefined
  fetchRunMock.mockReset()
  fetchRunArtifactMock.mockReset()
  fetchExecutionLogsMock.mockReset()
  fetchAccessibilitySummaryMock.mockReset()
  watchPostProcessingMock.mockReset()
  disposeMock.mockReset()

  watchPostProcessingMock.mockReturnValue(disposeMock)
  fetchExecutionLogsMock.mockResolvedValue({ logs: [] })
  fetchRunArtifactMock.mockResolvedValue({ run: { id: RUN_ID }, artifact: null, children: [], missingSections: ["artifact"] })
  fetchAccessibilitySummaryMock.mockResolvedValue({ enabled: null, total: 0, violations: [], byImpact: {}, steps: [] })
  fetchRunMock.mockImplementation(async (id: string) => ({ run: runRow(id) }))
  fetchRunDetailMock.mockImplementation(async (id: string) => ({
    runId: id,
    members: [],
    steps: [],
    subActions: [],
    tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
  }))
})

afterEach(() => {
  unmountHost()
  vi.clearAllMocks()
})

describe("run detail owns the chip client, and hands the navbar its projection", () => {
  it("subscribes exactly ONCE for the id it was asked for", async () => {
    await renderPage()
    expect(watchPostProcessingMock).toHaveBeenCalledTimes(1)
    expect(watchPostProcessingMock.mock.calls[0]![0]).toBe(RUN_ID)
  })

  it("hands the navbar `undefined` until the first read lands, then the projected chips", async () => {
    await renderPage()
    expect(lastNavbarView()).toBeUndefined()
    expect(navbarProps.at(-1)!.hasPostProcessing).toBe(true)

    await act(async () => {
      onReadOf()(statusRead("running", "pending", { disposition: "handedOff" }))
    })
    expect(lastNavbarView()).toEqual({
      kind: "chips",
      analysis: { status: "running" },
      curation: { status: "pending", posture: PENDING_POSTURE_TEXT.handedOff },
    })
  })

  it("projects a failure with no recorded envelope into the posture-qualified absence", async () => {
    await renderPage()
    await act(async () => {
      onReadOf()(statusRead("failed", "pending", { disposition: "handedOff", failures: {} }))
    })
    expect(lastNavbarView()).toMatchObject({
      kind: "chips",
      analysis: { status: "failed", reasonAbsent: FAILED_REASON_ABSENT_TEXT.handedOff },
    })
  })

  it("hands a refusal down as the unavailable view — never as chips (D-23)", async () => {
    await renderPage()
    await act(async () => {
      onReadOf()({ kind: "unavailable", error: "function_not_bound", reason: "runs.postprocessing is not bound" })
    })
    expect(lastNavbarView()).toEqual({
      kind: "unavailable",
      error: "function_not_bound",
      reason: "runs.postprocessing is not bound",
    })
  })

  it("invokes the disposer on unmount", async () => {
    await renderPage()
    expect(disposeMock).not.toHaveBeenCalled()
    unmountHost()
    expect(disposeMock).toHaveBeenCalledTimes(1)
  })

  it("disposes and re-subscribes ONCE when the id changes, and forgets the old run's read", async () => {
    await renderPage()
    await act(async () => {
      onReadOf()(statusRead("done", "done"))
    })
    expect(lastNavbarView()).toMatchObject({ kind: "chips" })

    await act(async () => { navigateTo!(routes.runDetail(OTHER_RUN_ID)) })
    await flushRender()

    expect(disposeMock).toHaveBeenCalledTimes(1)
    expect(watchPostProcessingMock).toHaveBeenCalledTimes(2)
    expect(watchPostProcessingMock.mock.calls[1]![0]).toBe(OTHER_RUN_ID)
    // The previous run's chips must not survive the change — that would be another run's truth.
    expect(lastNavbarView()).toBeUndefined()
  })
})
