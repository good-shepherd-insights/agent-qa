// @vitest-environment jsdom

import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_FAVICON_HREF } from "@/hooks/use-run-status-favicon"
import { displayStepsForGroups } from "@/lib/display-step"
import type { RunDetailGroup } from "@/lib/run-detail-view"

import type { RunDetailProjection } from "@vostride/agent-qa-schema"
import { asRef } from "@vostride/agent-qa-schema"

import RunDetailPage from "@/pages/run-detail"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const {
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchActiveExecutionsMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
  useKeyboardShortcutsMock,
  latestShortcuts,
} = vi.hoisted(() => {
  let latest: Record<string, (event: KeyboardEvent) => void> | null = null
  return {
    fetchRunMock: vi.fn(),
    fetchRunDetailMock: vi.fn(),
    fetchRunArtifactMock: vi.fn(),
    fetchActiveExecutionsMock: vi.fn(),
    fetchExecutionLogsMock: vi.fn(),
    fetchAccessibilitySummaryMock: vi.fn(),
    useKeyboardShortcutsMock: vi.fn((shortcuts: Record<string, (event: KeyboardEvent) => void>) => {
      latest = shortcuts
    }),
    latestShortcuts: () => {
      if (!latest) throw new Error("useKeyboardShortcuts was not called")
      return latest
    },
  }
})

vi.mock("@/lib/api", () => ({
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  fetchRunArtifact: fetchRunArtifactMock,
  fetchActiveExecutions: fetchActiveExecutionsMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
  triggerRun: vi.fn(),
  // 2026-08-27 (404-07): run detail now subscribes a post-processing chip client on mount. This
  // whole-module mock REPLACES `@/lib/api`, so an omitted export is `undefined` at the call site
  // and every cell in this file dies before it asserts. It is a no-op DOUBLE rather than the real
  // function on purpose: the real one constructs an `EventSource` and a 3 s interval against a
  // `fetch` these cells do not stub, which is a socket and a poll inside a test about something
  // else. The client's own behaviour is measured in `run-detail.post-processing.test.tsx`.
  watchPostProcessing: () => () => {},
}))

vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: (title: string) => {
    document.title = title
  },
}))

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useKeyboardShortcuts: useKeyboardShortcutsMock,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/components/page-skeleton", () => ({
  DetailSkeleton: () => <div>Loading...</div>,
}))

vi.mock("@/components/empty-state", () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock("@/components/run-detail/run-navbar", () => ({
  RunNavbar: () => <div data-testid="run-navbar">navbar</div>,
}))

vi.mock("@/components/run-detail/step-tree", () => ({
  // 405-08: the tree takes the member-grouped projection now, not a flat step list. The double
  // flattens it through the SAME helper the page uses, so the ids it renders are the ids the page
  // selects by — a second flattening here would let this file pass on keys nobody can click.
  StepTree: ({
    groups,
    selection,
  }: {
    groups: readonly RunDetailGroup[]
    selection: { type: string; stepId?: string; subIndex?: number } | null
  }) => {
    const selectionLabel = selection
      ? `${selection.type}:${selection.stepId ?? ""}:${selection.subIndex ?? ""}`
      : ""
    return (
      <div data-testid="step-tree" data-selection={selectionLabel}>
        {displayStepsForGroups(groups).map((step) => (
          <div key={step.id} data-step-id={step.id}>
            {step.name}
          </div>
        ))}
      </div>
    )
  },
}))

vi.mock("@/components/screenshot-viewer", () => ({
  ScreenshotViewer: ({ screenshotPath }: { screenshotPath: string }) => (
    <div data-testid="screenshot-viewer">{screenshotPath}</div>
  ),
}))

vi.mock("@/components/reasoning-pipeline", () => ({
  ReasoningPipeline: () => <div data-testid="reasoning-pipeline" />,
}))

vi.mock("@/components/healing-chain", () => ({
  HealingChain: () => <div data-testid="healing-chain" />,
}))

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>suite view</span>,
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
  Button: ({ children, ...props }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

function makeProjection(runId: string): RunDetailProjection {
  return {
    runId,
    members: [{ testIndex: 0, name: "Screenshot test", attempts: 1 }],
    steps: [
      {
        testIndex: 0,
        stepIndex: 0,
        stepText: "Compare checkout screenshots",
        cacheStatus: "miss",
        verifierVerdict: { pass: true, reasoning: "the checkout screen is up" },
        selfHealOccurred: false,
        briefDigest: "d00",
        status: "passed",
        durationMs: 1000,
      },
    ],
    subActions: [
      {
        testIndex: 0,
        stepIndex: 0,
        subActionIndex: 0,
        plan: "Need to compare screenshots",
        plannedAction: { type: "click", ref: asRef("checkout") },
        result: { success: true },
        screenStateHash: "abcdef0123456789".repeat(4),
      },
    ],
    tokens: { measuredSteps: 0, unmeasuredSteps: 1 },
  }
}

function makeRun(id: string, status = "passed") {
  return {
    id,
    name: "Screenshot run",
    filePath: "tests/screenshots.yaml",
    status,
    duration: 1000,
    tags: null,
    environment: null,
    metadata: null,
    startedAt: "2026-04-18T00:00:00.000Z",
    endedAt: "2026-04-18T00:00:01.000Z",
    source: "dashboard",
    videoPath: null,
    failureSummary: null,
    errorLog: null,
    memoryLog: null,
    testId: null,
    suiteId: null,
    platform: "web",
    testFileContent: null,
    modelName: null,
    llmProvider: null,
    parallel: false,
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt: "2026-04-18T00:00:00.000Z",
  }
}

function LocationProbe() {
  const location = useLocation()
  return (
    <div
      data-testid="location"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null

function resetFavicon() {
  document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${DEFAULT_FAVICON_HREF}">`
}

function getFaviconHref() {
  return document
    .querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
    ?.getAttribute("href")
}

function expectDefaultFavicon() {
  expect(getFaviconHref()).toBe(DEFAULT_FAVICON_HREF)
}

function expectStatusFavicon() {
  expect(getFaviconHref()).toMatch(/^data:image\/svg\+xml,/)
}

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
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/runs/:id"
            element={
              <>
                <LocationProbe />
                <RunDetailPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
  })

  await flushRender()
  return container
}

function screenshotPath(view: HTMLElement) {
  return view.querySelector('[data-testid="screenshot-viewer"]')?.textContent ?? ""
}

function expectSearchParams(
  location: HTMLElement,
  expected: Record<string, string | null>,
) {
  const params = new URLSearchParams(location.getAttribute("data-search") ?? "")
  for (const [key, value] of Object.entries(expected)) {
    expect(params.get(key)).toBe(value)
  }
}

beforeEach(() => {
  resetFavicon()
  document.title = ""
  fetchRunMock.mockReset()
  fetchRunDetailMock.mockReset()
  fetchRunArtifactMock.mockReset()
  fetchActiveExecutionsMock.mockReset()
  fetchExecutionLogsMock.mockReset()
  fetchAccessibilitySummaryMock.mockReset()
  useKeyboardShortcutsMock.mockClear()

  fetchActiveExecutionsMock.mockResolvedValue({ executions: [] })
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
  fetchRunArtifactMock.mockResolvedValue({ run: makeRun("run-1"), artifact: null, children: [], missingSections: ["artifact"] })
  fetchRunMock.mockImplementation(async (id: string) => ({ run: makeRun(id) }))
  fetchRunDetailMock.mockImplementation(async (id: string) => makeProjection(id))
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) container.remove()
  container = null
  document.head.innerHTML = ""
  vi.clearAllMocks()
})

// THE A/B SHORTCUTS, WHILE THE PAIR HAS NO PRODUCER (405-08 → 405-11).
//
// WHAT THESE CELLS USED TO PIN. `screenshotBeforePath` / `screenshotAfterPath` on a v1 sub-action
// row, fetched with the run. 405-07 deleted the path-addressed artifact routes and D-14 replaced
// them with content-addressed refs; the durable sub-action carries `artifactRefs`, and 405-11 owns
// minting a screenshot `src` from one. So there is no pair to select a SIDE of right now, and the
// honest thing to pin in the meantime is the property that must hold either way: A and B are inert
// when nothing is recorded, and they never disturb the selection or the URL. Rewriting them as
// side-selection cells against fabricated paths would pin a fiction; skipping them would leave the
// hotkeys unguarded through the seam. The side-selection assertions move to 405-11 with the
// producer.
describe("RunDetailPage screenshot shortcuts", () => {
  it("syncs the default selected step into the URL, by its member-scoped key, without repeated rewrites", async () => {
    const view = await renderAt("/runs/run-1")
    const location = view.querySelector('[data-testid="location"]') as HTMLElement

    expect(location.getAttribute("data-search")).toBe("?step=0%3A0")

    await flushRender()

    expect(location.getAttribute("data-search")).toBe("?step=0%3A0")
  })

  it("leaves A and B inert while no screenshot pair is recorded, and never shows a broken image", async () => {
    const view = await renderAt("/runs/run-1?step=0:0&sub=0")
    const location = view.querySelector('[data-testid="location"]') as HTMLElement
    const stepTree = view.querySelector('[data-testid="step-tree"]') as HTMLElement

    expect(screenshotPath(view)).toBe("")
    expect(view.querySelector("img")).toBeNull()
    expect(stepTree.getAttribute("data-selection")).toBe("subaction:0:0:0")
    expect(location.getAttribute("data-search")).toBe("?step=0%3A0&sub=0")

    await act(async () => {
      latestShortcuts().a(new KeyboardEvent("keydown", { key: "a" }))
      latestShortcuts().b(new KeyboardEvent("keydown", { key: "b" }))
    })

    expect(screenshotPath(view)).toBe("")
    expect(stepTree.getAttribute("data-selection")).toBe("subaction:0:0:0")
    expect(location.getAttribute("data-search")).toBe("?step=0%3A0&sub=0")
  })

  it("no-ops outside overview without changing the active tab URL or selected sub-action marker", async () => {
    const view = await renderAt("/runs/run-1?step=0:0&sub=0&tab=network")
    const location = view.querySelector('[data-testid="location"]') as HTMLElement
    const stepTree = view.querySelector('[data-testid="step-tree"]') as HTMLElement

    expectSearchParams(location, { step: "0:0", sub: "0", tab: "network" })
    expect(stepTree.getAttribute("data-selection")).toBe("subaction:0:0:0")

    await act(async () => {
      latestShortcuts().a(new KeyboardEvent("keydown", { key: "a" }))
      latestShortcuts().b(new KeyboardEvent("keydown", { key: "b" }))
    })

    expectSearchParams(location, { step: "0:0", sub: "0", tab: "network" })
    expect(stepTree.getAttribute("data-selection")).toBe("subaction:0:0:0")
  })
})

describe("RunDetailPage favicon lifecycle", () => {
  it("keeps the default favicon while fetchRun is unresolved", async () => {
    fetchRunMock.mockReturnValue(new Promise(() => {}))

    await renderAt("/runs/run-loading")

    expectDefaultFavicon()
  })

  it.each(["passed", "failed", "cancelled"] as const)(
    "sets a non-default favicon for loaded %s runs",
    async (status) => {
      fetchRunMock.mockImplementation(async (id: string) => ({ run: makeRun(id, status) }))

      await renderAt(`/runs/run-${status}`)

      expectStatusFavicon()
    },
  )

  it("restores the default favicon on unmount", async () => {
    fetchRunMock.mockImplementation(async (id: string) => ({ run: makeRun(id, "failed") }))

    await renderAt("/runs/run-failed")

    expectStatusFavicon()

    act(() => root!.unmount())
    root = null

    expectDefaultFavicon()
  })
})
