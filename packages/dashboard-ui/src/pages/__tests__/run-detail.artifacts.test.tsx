// @vitest-environment jsdom

// THE FIVE FACTS, THROUGH THE WHOLE PAGE (405-11 · DETL-01/02/03, D-06, D-10, D-14, D-15,
// RESEARCH D2).
//
// Criterion 1 of this phase says reasoning, the sub-action timeline, screenshots, token usage and
// screen context "render populated". These cells are the last unit-level statement of that before
// 405-12 measures it in a real browser: they mount the PAGE, hand it one durable projection, and
// assert each of the five facts arrives at the DOM from the read rather than from a default.
//
// EVERY COPY ASSERTION IS BY CONSTANT and every URL assertion CALLS the minter. A literal sentence
// here would keep passing while the page said something else, and a literal URL would keep passing
// while the page minted a different one.

import { act, type ButtonHTMLAttributes, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { RunDetailProjection } from "@vostride/agent-qa-schema"
import { asRef, maskedMarker, MASKED_MARKER_DELIMITER } from "@vostride/agent-qa-schema"

import { displayStepsForGroups } from "@/lib/display-step"
import type { RunDetailGroup } from "@/lib/run-detail-view"
import {
  MASKED_EMAIL_LABEL,
  MASKED_SECRET_LABEL,
  SCREEN_STATE_CHANGED_LABEL,
  SCREEN_STATE_UNCHANGED_LABEL,
  TOKENS_NOT_MEASURED_LABEL,
  screenStateChip,
} from "@/lib/run-detail-view"
import { routes } from "@/lib/routes"

import RunDetailPage from "@/pages/run-detail"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const {
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
} = vi.hoisted(() => ({
  fetchRunMock: vi.fn(),
  fetchRunDetailMock: vi.fn(),
  fetchRunArtifactMock: vi.fn(),
  fetchExecutionLogsMock: vi.fn(),
  fetchAccessibilitySummaryMock: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  fetchRunArtifact: fetchRunArtifactMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
  triggerRun: vi.fn(),
  watchPostProcessing: () => () => {},
}))

vi.mock("@/hooks/use-page-title", () => ({ usePageTitle: () => {} }))
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/components/page-skeleton", () => ({ DetailSkeleton: () => <div>Loading...</div> }))
vi.mock("@/components/empty-state", () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }))

// The navbar is the run-level token line's home, so it is NOT mocked away — cell 5 reads it.
vi.mock("@/components/run-detail/step-tree", () => ({
  StepTree: ({ groups }: { groups: readonly RunDetailGroup[] }) => (
    <div data-testid="step-tree">
      {displayStepsForGroups(groups).map((step) => (
        <div key={step.id} data-step-id={step.id}>{step.name}</div>
      ))}
    </div>
  ),
}))

vi.mock("@/components/screenshot-viewer", () => ({
  ScreenshotViewer: ({ src, onUnavailable }: { src: string; onUnavailable?: () => void }) => (
    <img data-testid="screenshot-viewer" src={src} onError={() => onUnavailable?.()} />
  ),
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
  Button: ({ children, ...props }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

const SHA = "a1b2c3d4".repeat(8)
const HASH_BEFORE = "1".repeat(64)
const HASH_AFTER = "2".repeat(64)

/** The planner's own sentence, carrying two markers the display seam could not restore (D-10). */
const MASKED_PLAN = `Sign in as ${maskedMarker('email')} using ${maskedMarker('secret')}`

function makeProjection(overrides: Partial<RunDetailProjection> = {}): RunDetailProjection {
  return {
    runId: "run-1",
    members: [{ testIndex: 0, name: "Checkout", attempts: 1 }],
    steps: [
      {
        testIndex: 0,
        stepIndex: 0,
        stepText: "Sign in",
        cacheStatus: "miss",
        verifierVerdict: { pass: true, reasoning: "signed in" },
        selfHealOccurred: false,
        briefDigest: "d00",
        status: "passed",
        durationMs: 1200,
        tokenUsage: { promptTokens: 800, completionTokens: 200, totalTokens: 1000 },
      },
    ],
    subActions: [
      {
        testIndex: 0,
        stepIndex: 0,
        subActionIndex: 0,
        plan: MASKED_PLAN,
        plannedAction: { type: "click", ref: asRef("submit") },
        result: { success: true },
        screenStateHash: HASH_BEFORE,
        screenStateHashAfter: HASH_AFTER,
        artifactRefs: [{ id: `decision-screenshot:${SHA}`, sha: SHA }],
      },
    ],
    tokens: {
      measuredSteps: 1,
      unmeasuredSteps: 0,
      promptTokens: 800,
      completionTokens: 200,
      totalTokens: 1000,
    },
    ...overrides,
  }
}

function makeRun() {
  return {
    id: "run-1",
    name: "Checkout run",
    filePath: "tests/checkout.yaml",
    status: "passed",
    duration: 1200,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: "2026-04-18T00:00:00.000Z",
    endedAt: "2026-04-18T00:00:01.200Z",
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
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt: "2026-04-18T00:00:00.000Z",
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

async function renderAt(url = "/runs/run-1?step=0:0&sub=0") {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/runs/:id" element={<RunDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })

  await flushRender()
  return container
}

beforeEach(() => {
  fetchRunMock.mockReset()
  fetchRunDetailMock.mockReset()
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
  fetchRunArtifactMock.mockResolvedValue({ run: makeRun(), artifact: null, children: [], missingSections: [] })
  fetchRunMock.mockImplementation(async () => ({ run: makeRun() }))
  fetchRunDetailMock.mockImplementation(async () => makeProjection())
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

describe("run detail renders the durable projection's five facts", () => {
  it("mints the decision screenshot src from the ref and marks the pane available", async () => {
    const view = await renderAt()

    expect(view.querySelector('[data-artifact-state="available"]')).not.toBeNull()
    expect(view.querySelector("img")?.getAttribute("src")).toBe(routes.runArtifact("run-1", SHA))
  })

  it("renders a visible unavailable state, and no image, for a ref flagged incomplete", async () => {
    const base = makeProjection()
    fetchRunDetailMock.mockImplementation(async () => ({
      ...base,
      subActions: [{ ...base.subActions[0], artifactRefs: [{ id: `decision-screenshot:${SHA}`, sha: SHA, evidenceIncomplete: true }] }],
    }))

    const view = await renderAt()

    expect(view.querySelector('[data-artifact-state="unavailable"]')).not.toBeNull()
    expect(view.querySelector("img")).toBeNull()
  })

  // D-10 / T-405-40. The load-bearing assertion is the last one: no marker survives into any text
  // node, so a reader can tell deliberate redaction apart from a broken page.
  it("paints the planner's masked values as typed chips and leaves no marker in the DOM", async () => {
    const view = await renderAt()

    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    expect(view.querySelector('[data-masked="secret"]')?.textContent).toContain(MASKED_SECRET_LABEL)
    expect(view.querySelector("[data-sub-action-plan]")?.textContent).toContain("Sign in as ")
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
    expect(view.textContent).not.toContain("<SECRET_")
    expect(view.textContent).not.toContain("<EMAIL_")
  })

  // RESEARCH D2. The bus carries no screen TEXT, so the honest surface is the hash pair: a short id
  // a reader can compare by eye, plus the verdict the pair implies.
  it("renders the screen-state chip and reads the pair for the changed verdict", async () => {
    const view = await renderAt()

    const chip = view.querySelector("[data-screen-state]")
    expect(chip?.getAttribute("data-screen-state")).toBe(HASH_BEFORE)
    expect(chip?.textContent).toBe(screenStateChip(HASH_BEFORE))
    expect(view.querySelector("[data-screen-state-change]")?.textContent).toBe(SCREEN_STATE_CHANGED_LABEL)
  })

  it("calls a recorded post-state identical to the pre-state unchanged", async () => {
    const base = makeProjection()
    fetchRunDetailMock.mockImplementation(async () => ({
      ...base,
      subActions: [{ ...base.subActions[0], screenStateHashAfter: HASH_BEFORE }],
    }))

    const view = await renderAt()

    expect(view.querySelector("[data-screen-state-change]")?.textContent).toBe(SCREEN_STATE_UNCHANGED_LABEL)
  })

  // D-06 in both directions, at both grains. A measured step reports its spend; an unmeasured one
  // says so rather than reporting a zero nobody measured.
  it("reports the step's own spend and the run's, from the projection", async () => {
    const view = await renderAt()

    expect(view.querySelector("[data-token-summary]")?.textContent).toContain("1 of 1 steps")
    expect(view.querySelector("[data-run-token-summary]")?.textContent).toContain("1 of 1 steps")
  })

  it("never reports a zero for a step or a run nobody measured", async () => {
    const base = makeProjection()
    const { tokenUsage: _dropped, ...unmeasuredStep } = base.steps[0]
    fetchRunDetailMock.mockImplementation(async () => ({
      ...base,
      steps: [unmeasuredStep],
      tokens: { measuredSteps: 0, unmeasuredSteps: 1 },
    }))

    const view = await renderAt()

    expect(view.querySelector("[data-token-summary]")?.textContent).toBe(TOKENS_NOT_MEASURED_LABEL)
    expect(view.querySelector("[data-run-token-summary]")?.textContent).toContain(TOKENS_NOT_MEASURED_LABEL)
    expect(view.querySelector("[data-token-summary]")?.textContent).not.toContain("0 tokens")
  })
})
