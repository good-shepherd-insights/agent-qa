// @vitest-environment jsdom
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router"
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
  fetchRunAnalysisMock,
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchAccessibilitySummaryMock,
} = vi.hoisted(() => ({
  markRunMock: vi.fn(),
  fetchRunAnalysisMock: vi.fn(),
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
  fetchRunAnalysis: fetchRunAnalysisMock,
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
  const navigate = useNavigate()
  return <div data-testid="location" data-search={location.search}>
    <button data-navigate onClick={event => navigate(event.currentTarget.dataset.to!)} />
  </div>
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
  fetchRunAnalysisMock.mockReset()
  fetchRunAnalysisMock.mockResolvedValue({ runId: RUN_ID, verdicts: [{ perTest: 7, producer: 'deterministic-classifier', confidence: 0 }], sentences: [{ perTest: 7, sentence: 'Cart differs' }], clusters: [] })
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const MEMBER_SCOPE = '[data-member-mark]'
const STEP_SCOPE = '[data-step-id="7:2"]'
const ACTION_TEXT = '{"type":"click","ref":"e1"}'
async function input(selector: string, value: string) {
  await act(async () => {
    const field = container!.querySelector<HTMLTextAreaElement>(selector)!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function draft(scope: string) {
  await click(`${scope} [data-mark-kind="false-fail"]`)
  await input(`${scope} [data-mark-note]`, 'Keep this note')
  await input(`${scope} [aria-label="Corrected expectation"]`, 'Keep this expectation')
  await input(`${scope} [aria-label="Corrected action JSON"]`, ACTION_TEXT)
}
function expectDraft(scope: string, action = ACTION_TEXT) {
  expect(container!.querySelector<HTMLTextAreaElement>(`${scope} [data-mark-note]`)?.value).toBe('Keep this note')
  expect(container!.querySelector<HTMLTextAreaElement>(`${scope} [aria-label="Corrected expectation"]`)?.value).toBe('Keep this expectation')
  expect(container!.querySelector<HTMLTextAreaElement>(`${scope} [aria-label="Corrected action JSON"]`)?.value).toBe(action)
}
function refreshed(scope: string, receipt = marked): RunDetailProjection {
  return { ...initial, members: [{ ...initial.members[0], marks: [{ ...receipt, ...(scope === STEP_SCOPE ? { stepIndex: 2 } : {}) }] }] }
}
async function navigateTo(id: string) {
  container!.querySelector<HTMLButtonElement>('[data-navigate]')!.dataset.to = `/runs/${id}`
  await click('[data-navigate]')
}

describe('419-15 scoped draft lifecycle', () => {
  beforeEach(() => { fetchRunDetailMock.mockResolvedValue(initial) })
  it.each([MEMBER_SCOPE, STEP_SCOPE])('retains the full %s draft through POST and authoritative refresh', async scope => {
    const post = deferred<unknown>()
    const refresh = deferred<RunDetailProjection>()
    markRunMock.mockReturnValue(post.promise)
    fetchRunDetailMock.mockResolvedValueOnce(initial).mockReturnValueOnce(refresh.promise)
    await renderAt(`/runs/${RUN_ID}`)
    await draft(scope)
    await click(`${scope} [data-mark-submit]`)
    expectDraft(scope)
    expect(container!.querySelector(`${scope} [data-mark-status]`)?.textContent).toBe('Mark submission pending.')
    expect(container!.querySelector(`${scope} [data-mark-status]`)?.getAttribute('aria-live')).toBe('polite')
    expect(container!.querySelector(`${scope} [data-mark-status]`)?.getAttribute('aria-atomic')).toBe('true')
    await click(`${scope} [data-mark-submit]`)
    expect(markRunMock).toHaveBeenCalledTimes(1)
    await act(async () => post.resolve({ kind: 'marked', receipt: marked }))
    expectDraft(scope)
    expect(container!.textContent).not.toContain('Mark saved.')
    await act(async () => refresh.resolve(refreshed(scope)))
    expect(container!.querySelector(`${scope} [data-mark-note]`)).toBeNull()
    expect(container!.querySelector(`${scope} [data-mark-status]`)?.textContent).toBe('Mark saved. Receipt refreshed.')
    expect(container!.querySelector(`${scope} [data-mark-chip]`)?.textContent).toContain('· 2')
  })
  for (const scope of [MEMBER_SCOPE, STEP_SCOPE]) {
    it.each(['denied', 'no-channel', 'ambiguous-correction', 'run-not-found', 'transport', 'refetch', 'wrong-run', 'missing', 'wrong-member', 'wrong-step', 'wrong-id', 'wrong-ordinal', 'wrong-kind'])('retains %s on ' + scope, async failure => {
      const base = failure === 'wrong-member'
        ? { ...initial, members: [...initial.members, member(8, { testId: generateTestId(), marks: [] })] }
        : initial
      if (failure === 'denied' || failure === 'no-channel') markRunMock.mockRejectedValue(new MarkDeniedError({ reason: failure, remedies: [{ kind: 'answer-confirm' }] }))
      else if (failure === 'transport') markRunMock.mockRejectedValue(new Error('offline'))
      else if (failure === 'ambiguous-correction' || failure === 'run-not-found') markRunMock.mockResolvedValue({ kind: failure })
      else {
        markRunMock.mockResolvedValue({ kind: 'marked', receipt: marked })
        let next = refreshed(scope)
        if (failure === 'wrong-run') next = { ...next, runId: generateRunId() }
        if (failure === 'missing') next = initial
        if (failure === 'wrong-member') next = { ...base, members: [base.members[0], { ...base.members[1], marks: next.members[0].marks }] }
        if (failure === 'wrong-step') next = { ...next, members: [{ ...next.members[0], marks: [{ ...marked, stepIndex: 3 }] }] }
        if (failure === 'wrong-id') next = refreshed(scope, { ...marked, markId: 'mark_1123456789ab' })
        if (failure === 'wrong-ordinal') next = refreshed(scope, { ...marked, ordinal: 3 })
        if (failure === 'wrong-kind') next = refreshed(scope, { ...marked, kind: 'false-pass' })
        fetchRunDetailMock.mockResolvedValueOnce(base)
        if (failure === 'refetch') fetchRunDetailMock.mockRejectedValueOnce(new Error('refresh failed'))
        else fetchRunDetailMock.mockResolvedValueOnce(next)
      }
      await renderAt(`/runs/${RUN_ID}`)
      await draft(scope)
      await click(`${scope} [data-mark-submit]`)
      {
        expectDraft(scope)
        expect(container!.querySelector<HTMLButtonElement>(`${scope} [data-mark-submit]`)?.disabled).toBe(false)
        expect(container!.querySelector(`${scope} [data-mark-status]`)?.textContent).toContain('Draft retained.')
        expect(container!.querySelector(`${scope} [data-mark-denied]`)?.getAttribute('role')).toBe('alert')
      }
      expect(container!.textContent).not.toContain('Mark saved.')
    })
    it('keeps selection, invalid text and component identity until explicit cancel at ' + scope, async () => {
      await renderAt(`/runs/${RUN_ID}`)
      await draft(scope)
      await input(`${scope} [aria-label="Corrected action JSON"]`, '{')
      const field = container!.querySelector(`${scope} [aria-label="Corrected action JSON"]`)
      await click(`${scope} [data-mark-kind="false-fail"]`)
      await click(`${scope} [data-mark-kind="false-pass"]`)
      expectDraft(scope, '{')
      expect(container!.querySelector(`${scope} [aria-label="Corrected action JSON"]`)).toBe(field)
      expect(container!.querySelector(`${scope} [data-mark-kind="false-pass"]`)?.getAttribute('aria-pressed')).toBe('true')
      expect(container!.querySelector(`${scope} [data-mark-submit]`)?.textContent).toBe('Record false-pass mark')
      expect(container!.querySelector<HTMLButtonElement>(`${scope} [data-mark-submit]`)?.disabled).toBe(true)
      await click(`${scope} [data-mark-cancel]`)
      await click(`${scope} [data-mark-kind="false-fail"]`)
      expect(container!.querySelector<HTMLTextAreaElement>(`${scope} [data-mark-note]`)?.value).toBe('')
      expect(container!.querySelector<HTMLTextAreaElement>(`${scope} [aria-label="Corrected action JSON"]`)?.value).toBe('')
      expect(markRunMock).not.toHaveBeenCalled()
    })
  }
  it('clears an already-marked draft only after the matching receipt refresh', async () => {
    markRunMock.mockResolvedValue({ kind: 'already-marked', receipt: marked })
    fetchRunDetailMock.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed(MEMBER_SCOPE))
    await renderAt(`/runs/${RUN_ID}`)
    await draft(MEMBER_SCOPE)
    await click(`${MEMBER_SCOPE} [data-mark-submit]`)
    expect(container!.querySelector(`${MEMBER_SCOPE} [data-mark-note]`)).toBeNull()
    expect(container!.textContent).toContain('Mark saved. Receipt refreshed.')
  })
  it('keeps a second member draft and denial isolated across subsequent submissions', async () => {
    const secondId = generateTestId()
    fetchRunDetailMock.mockResolvedValue({ ...initial, members: [...initial.members, member(8, { testId: secondId, marks: [] })], steps: [...initial.steps, step(8, 2, 'Other cart')] })
    markRunMock.mockRejectedValueOnce(new MarkDeniedError({ reason: 'First member denied', remedies: [] }))
      .mockRejectedValueOnce(new MarkDeniedError({ reason: 'Second member denied', remedies: [] }))
    await renderAt(`/runs/${RUN_ID}`)
    const first = '[data-member="7"] [data-member-mark]'
    const second = '[data-member="8"] [data-member-mark]'
    await draft(first)
    await draft(second)
    await click(`${first} [data-mark-submit]`)
    expect(container!.querySelector(`${second} [data-mark-denied]`)).toBeNull()
    await click(`${second} [data-mark-submit]`)
    expectDraft(first)
    expectDraft(second)
    expect(container!.querySelector(`${first} [data-mark-denied]`)?.textContent).toContain('First member denied')
    expect(container!.querySelector(`${second} [data-mark-denied]`)?.textContent).toContain('Second member denied')
    expect(markRunMock.mock.calls[1][1].testId).toBe(secondId)
  })
  it('refuses an ambiguous testId without a POST and retains the selected member draft', async () => {
    fetchRunDetailMock.mockResolvedValue({ ...initial, members: [...initial.members, member(8, { testId: TEST_ID, marks: [] })] })
    await renderAt(`/runs/${RUN_ID}`)
    const scope = '[data-member="7"] [data-member-mark]'
    await draft(scope)
    await click(`${scope} [data-mark-submit]`)
    expectDraft(scope)
    expect(markRunMock).not.toHaveBeenCalled()
    expect(container!.querySelector(`${scope} [data-mark-denied]`)?.textContent).toContain('no unique mark address')
  })
  it('keeps pending and result announcements local while retaining the other draft', async () => {
    const post = deferred<unknown>()
    markRunMock.mockReturnValue(post.promise)
    await renderAt(`/runs/${RUN_ID}`)
    await draft(MEMBER_SCOPE)
    await draft(STEP_SCOPE)
    await click(`${MEMBER_SCOPE} [data-mark-submit]`)
    expect(container!.querySelector(`${STEP_SCOPE} [data-mark-status]`)?.textContent).toBe('')
    expectDraft(STEP_SCOPE)
    await act(async () => post.reject(new MarkDeniedError({ reason: 'Denied here', remedies: [] })))
    expect(container!.querySelector(`${STEP_SCOPE} [data-mark-denied]`)).toBeNull()
    expect(container!.querySelector(`${STEP_SCOPE} [data-mark-status]`)?.textContent).toBe('')
    expectDraft(MEMBER_SCOPE)
    await input(`${MEMBER_SCOPE} [data-mark-note]`, 'Edited')
    expect(container!.querySelector(`${MEMBER_SCOPE} [data-mark-status]`)?.textContent).toBe('')
    expect(container!.querySelector(`${MEMBER_SCOPE} [data-mark-denied]`)).toBeNull()
  })
  it.each(['post', 'refresh'])('ignores stale %s after A-to-B-to-A and does not release the newer guard', async boundary => {
    const oldPost = deferred<unknown>()
    const oldRefresh = deferred<RunDetailProjection>()
    const newPost = deferred<unknown>()
    const other = generateRunId()
    markRunMock.mockReturnValueOnce(oldPost.promise).mockReturnValueOnce(newPost.promise)
    fetchRunDetailMock.mockImplementation(async (id: string) => ({ ...initial, runId: id }))
    await renderAt(`/runs/${RUN_ID}`)
    await draft(MEMBER_SCOPE)
    if (boundary === 'refresh') fetchRunDetailMock.mockReturnValueOnce(oldRefresh.promise)
    await click(`${MEMBER_SCOPE} [data-mark-submit]`)
    if (boundary === 'refresh') await act(async () => oldPost.resolve({ kind: 'marked', receipt: marked }))
    await navigateTo(other)
    await navigateTo(RUN_ID)
    await draft(MEMBER_SCOPE)
    await click(`${MEMBER_SCOPE} [data-mark-submit]`)
    expect(markRunMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      if (boundary === 'post') oldPost.resolve({ kind: 'marked', receipt: marked })
      else oldRefresh.resolve(refreshed(MEMBER_SCOPE))
    })
    expectDraft(MEMBER_SCOPE)
    expect(container!.querySelector(`${MEMBER_SCOPE} [data-mark-status]`)?.textContent).toBe('Mark submission pending.')
    expect(container!.querySelector('[data-mark-chip]')).toBeNull()
    await click(`${MEMBER_SCOPE} [data-mark-submit]`)
    expect(markRunMock).toHaveBeenCalledTimes(2)
    await act(async () => newPost.resolve({ kind: 'run-not-found' }))
    expectDraft(MEMBER_SCOPE)
  })
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
  it.each(['passed', 'analysis-absent'] as const)('allows a first member false-pass with %s analysis', async state => {
    if (state === 'passed') fetchRunAnalysisMock.mockResolvedValue({ runId: RUN_ID, verdicts: [], sentences: [], clusters: [] })
    else fetchRunAnalysisMock.mockRejectedValue(new Error('analysis unavailable'))
    fetchRunDetailMock.mockResolvedValue({ ...initial, members: [{ ...initial.members[0], outcome: 'passed' }] })
    markRunMock.mockResolvedValue({ kind: 'run-not-found' })
    await renderAt(`/runs/${RUN_ID}`)
    expect(container!.querySelector('[data-verdict-sentence]')).toBeNull()
    expect(container!.querySelectorAll('[data-member-mark] [data-mark-kind]')).toHaveLength(3)
    await click('[data-member-mark] [data-mark-kind="false-pass"]')
    await click('[data-member-mark] [data-mark-submit]')
    expect(markRunMock).toHaveBeenCalledExactlyOnceWith(RUN_ID, { kind: 'false-pass', testId: TEST_ID })
    expect(container!.querySelector('[data-step-id="7:2"]')).not.toBeNull()
  })
  it('shows and replaces the standing passing-member mark independently of its step mark', async () => {
    fetchRunAnalysisMock.mockResolvedValue({ runId: RUN_ID, verdicts: [], sentences: [], clusters: [] })
    const standing = { ...marked, kind: 'false-pass' as const }
    const stepMark = { ...marked, markId: 'mark_1123456789ab', stepIndex: 2 }
    const replacement = { ...marked, markId: 'mark_2123456789ab', ordinal: 3, kind: 'confirmed-bug' as const }
    fetchRunDetailMock.mockResolvedValueOnce({ ...initial, members: [{ ...initial.members[0], outcome: 'passed', marks: [standing, stepMark] }] })
      .mockResolvedValueOnce({ ...initial, members: [{ ...initial.members[0], outcome: 'passed', marks: [replacement, stepMark] }] })
    markRunMock.mockResolvedValue({ kind: 'marked', receipt: replacement })
    await renderAt(`/runs/${RUN_ID}`)
    expect(container!.querySelector('[data-member-mark] [data-mark-chip]')?.textContent).toBe('marked false-pass by user · 2')
    await click('[data-member-mark] [data-mark-kind="confirmed-bug"]')
    await click('[data-member-mark] [data-mark-submit]')
    expect(markRunMock).toHaveBeenCalledExactlyOnceWith(RUN_ID, { kind: 'confirmed-bug', testId: TEST_ID })
    expect(container!.querySelector('[data-member-mark] [data-mark-chip]')?.textContent).toBe('marked confirmed-bug by user · 3')
    expect(container!.querySelector('[data-step-id="7:2"] [data-mark-chip]')?.textContent).toContain('false-fail')
    expect(container!.querySelector('[data-verdict-sentence]')).toBeNull()
  })
  it('omits unbound passing-member controls without analysis', async () => {
    fetchRunAnalysisMock.mockResolvedValue({ runId: RUN_ID, verdicts: [], sentences: [], clusters: [] })
    fetchRunDetailMock.mockResolvedValue({ ...initial, members: [member(7, { outcome: 'passed', testId: TEST_ID })] })
    await renderAt(`/runs/${RUN_ID}`)
    expect(container!.querySelector('[data-mark-kind]')).toBeNull()
  })
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
    expect(container!.querySelector('[data-member-mark] [data-mark-note]')).not.toBeNull()
    expect(container!.textContent).not.toContain('Mark saved.')
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
