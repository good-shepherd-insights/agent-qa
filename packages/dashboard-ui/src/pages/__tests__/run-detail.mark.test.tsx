// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  RunDetailMember,
  RunDetailProjection,
  RunDetailStep,
  RunDetailSubAction,
} from "@vostride/agent-qa-schema"
import { asRef } from "@vostride/agent-qa-schema"

import RunDetailPage from "@/pages/run-detail"
import { MarkDeniedError } from "@/lib/api"
import { generateRunId, generateTestId } from "@vostride/agent-qa-ids"
const RUN_ID = generateRunId()
const TEST_ID = generateTestId()
import type { RunDetailMemberMark } from "@vostride/agent-qa-schema"
import { DID_NOT_RUN_LABEL, RUN_DETAIL_UNAVAILABLE_LABEL } from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const {
  markRunMock,
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
} = vi.hoisted(() => ({
  markRunMock: vi.fn(),
  fetchRunMock: vi.fn(),
  fetchRunDetailMock: vi.fn(),
  fetchRunArtifactMock: vi.fn(),
  fetchExecutionLogsMock: vi.fn(),
  fetchAccessibilitySummaryMock: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api")>(),
  markRun: markRunMock,
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  // 2026-08-29 (406-01, D-04): the page's THIRD read — the failure view's. This whole-module
  // mock replaces `@/lib/api`, so an omitted export is `undefined` at the call site and every
  // cell here dies before it asserts. Its own behaviour is measured in `run-detail.analysis.test.tsx`.
  fetchRunAnalysis: () => Promise.resolve({ runId: RUN_ID, verdicts: [{ perTest: 7, producer: 'deterministic-classifier', confidence: 0 }], sentences: [{ perTest: 7, sentence: 'Cart differs' }], clusters: [] }),
  fetchRunKnowledge: () => Promise.resolve({ kind: 'evidence-incomplete', runId: '' }),
  fetchRunArtifact: fetchRunArtifactMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchAccessibilitySummary: fetchAccessibilitySummaryMock,
  triggerRun: vi.fn(),
  // This whole-module mock REPLACES `@/lib/api`, so an omitted export is `undefined` at the call
  // site and every cell here dies before it asserts. The real `watchPostProcessing` constructs an
  // `EventSource` and a 3 s interval against a `fetch` these cells do not stub; its own behaviour
  // is measured in `run-detail.post-processing.test.tsx`.
  watchPostProcessing: () => () => {},
}))

vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: (title: string) => {
    document.title = title
  },
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
  TabPanels: ({ step }: { step: { id: string } | null }) => (
    <div data-testid="tab-panels" data-step-id={step?.id ?? ""} />
  ),
}))
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
// The Select double keeps the OPTIONS addressable and the change handler real, so the cell that
// asserts the filter writes the URL exercises the page's own handler rather than a stand-in.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: {
    children: ReactNode
    value: string
    onValueChange: (next: string) => void
  }) => (
    <div data-testid="member-select" data-value={value}>
      <button type="button" data-select-change onClick={(e) => {
        onValueChange((e.currentTarget as HTMLButtonElement).getAttribute("data-next") ?? "")
      }} />
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span>member filter</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <div data-select-item={value}>{children}</div>
  ),
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

function subAction(testIndex: number, stepIndex: number, subActionIndex: number): RunDetailSubAction {
  return {
    testIndex,
    stepIndex,
    subActionIndex,
    plan: `plan ${String(testIndex)}.${String(stepIndex)}.${String(subActionIndex)}`,
    plannedAction: { type: "click", ref: asRef("e1") },
    result: { success: true },
    screenStateHash: "abcdef0123456789".repeat(4),
  }
}

function projection(over: Partial<RunDetailProjection> = {}): RunDetailProjection {
  return {
    runId: RUN_ID,
    members: [],
    steps: [],
    subActions: [],
    tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
    ...over,
  }
}

const TWO_MEMBERS = projection({
  members: [member(0, { name: "Login" }), member(1, { name: "Checkout" })],
  steps: [step(0, 0, "Open login"), step(0, 1, "Submit credentials"), step(1, 0, "Open cart")],
  subActions: [subAction(0, 0, 0)],
})

function runRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: "Suite run",
    filePath: "tests/suite.yaml",
    status: "failed",
    duration: 10000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: "2026-04-18T00:00:00.000Z",
    endedAt: "2026-04-18T00:00:10.000Z",
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
    createdAt: "2026-04-18T00:00:00.000Z",
    ...over,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location" data-search={location.search} />
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

beforeEach(() => {
  document.title = ""
  Element.prototype.scrollIntoView = vi.fn()
  markRunMock.mockReset()
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
  fetchRunArtifactMock.mockResolvedValue({ run: { id: RUN_ID }, artifact: null, children: [], missingSections: ["artifact"] })
  fetchRunMock.mockImplementation(async (id: string) => ({ run: runRow(id) }))
  fetchRunDetailMock.mockResolvedValue(TWO_MEMBERS)
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) container.remove()
  container = null
  vi.clearAllMocks()
})


const initial = projection({ members: [member(7, { testId: TEST_ID, marks: [] })], steps: [step(7, 2, 'Check cart')] })
const marked: RunDetailMemberMark = { markId: 'mark_0123456789ab', kind: 'false-fail', ordinal: 2,
  disposition: { kind: 'drafted', fix: 'fact', proposalId: 'prop_0123456789ab', proposalKind: 'knowledge' } }
async function click(selector: string) {
  await act(async () => { container!.querySelector<HTMLButtonElement>(selector)!.click() })
  await flushRender()
}
async function submit() {
  await click('[data-verdict-block] [data-mark-kind="false-fail"]')
  await click('[data-verdict-block] [data-mark-submit]')
}

describe('419 page mark post/refetch', () => {
  beforeEach(() => { fetchRunDetailMock.mockResolvedValue(initial) })
  it.each(['marked', 'already-marked'])('refetches %s and paints only the returned projection', async kind => {
    markRunMock.mockResolvedValue({ kind, receipt: { ...marked, ordinal: 99 } })
    fetchRunDetailMock.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      ...initial, members: [{ ...initial.members[0], marks: [marked] }],
    })
    await renderAt(`/runs/${RUN_ID}`)
    await submit()
    expect(markRunMock).toHaveBeenCalledExactlyOnceWith(RUN_ID, { kind: 'false-fail', testId: TEST_ID })
    expect(fetchRunDetailMock).toHaveBeenCalledTimes(2)
    expect(container!.querySelector('[data-mark-chip]')?.textContent).toBe('marked false-fail by user · 2')
  })
  it('renders typed denial and remedy without a refetch or invented chip', async () => {
    markRunMock.mockRejectedValue(new MarkDeniedError({ reason: 'The safety gate denied this mark.', remedies: [{ kind: 'answer-confirm' }] }))
    await renderAt(`/runs/${RUN_ID}`)
    await submit()
    expect(container!.querySelector('[data-mark-denied]')?.textContent).toContain('The safety gate denied this mark.')
    expect(container!.querySelector('[data-remedy-kind="answer-confirm"]')?.textContent).toContain('an ask-tier op raises a confirm here')
    expect(fetchRunDetailMock).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('[data-mark-chip]')).toBeNull()
  })
  it.each(['run-not-found', 'member-not-found', 'step-not-found', 'ambiguous-address'])('does not report HTTP-success %s as marked', async kind => {
    markRunMock.mockResolvedValue({ kind })
    await renderAt(`/runs/${RUN_ID}`)
    await submit()
    expect(container!.querySelector('[data-mark-denied]')?.textContent).toBe(`Mark refused: ${kind}.`)
    expect(fetchRunDetailMock).toHaveBeenCalledTimes(1)
    expect(container!.querySelector('[data-mark-chip]')).toBeNull()
  })
  it('sends the durable step address and renders denial only at that step', async () => {
    markRunMock.mockRejectedValue(new MarkDeniedError({ reason: 'Denied', remedies: [] }))
    await renderAt(`/runs/${RUN_ID}`)
    await click('[data-mark-step="2"][data-mark-kind="confirmed-bug"]')
    await click('[data-step-id="7:2"] [data-mark-submit]')
    expect(markRunMock).toHaveBeenCalledExactlyOnceWith(RUN_ID, { kind: 'confirmed-bug', testId: TEST_ID, stepIndex: 2 })
    expect(container!.querySelector('[data-step-id="7:2"] [data-mark-denied]')).not.toBeNull()
    expect(container!.querySelector('[data-verdict-block] [data-mark-denied]')).toBeNull()
  })
  it('does not invent feedback availability for a host that omits marks', async () => {
    fetchRunDetailMock.mockResolvedValue({ ...initial, members: [member(7, { testId: TEST_ID })] })
    await renderAt(`/runs/${RUN_ID}`)
    expect(container!.querySelector('[data-mark-kind]')).toBeNull()
  })
  it('disables repeated submissions until the in-flight request settles', async () => {
    let resolve!: (value: unknown) => void
    markRunMock.mockReturnValue(new Promise(value => { resolve = value }))
    await renderAt(`/runs/${RUN_ID}`)
    await submit()
    expect([...container!.querySelectorAll<HTMLButtonElement>('[data-mark-kind]')].every(button => button.disabled)).toBe(true)
    await act(async () => resolve({ kind: 'run-not-found' }))
    expect(markRunMock).toHaveBeenCalledTimes(1)
  })
})
