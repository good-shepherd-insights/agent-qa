// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RunDetailMember,
  RunDetailMemberMark,
  RunDetailProjection,
  RunDetailStep,
} from '@vostride/agent-qa-schema'
import { RunsMarkPreviewResultSchema } from '@vostride/agent-qa-schema'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'

import RunDetailPage from '@/pages/run-detail'
import { setRunConfirmScope, type MarkPreviewRead } from '@/lib/api'
import {
  CHOICE_LABELS,
  CHOICE_MEANINGS,
  FEEDBACK_CHOICE_ORDER,
  PREVIEW_DEBOUNCE_MS,
  feedbackRecordedText,
} from '@/lib/feedback-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = generateRunId()
const TEST_ID = generateTestId()

const {
  markRunMock,
  fetchRunAnalysisMock,
  fetchRunMock,
  fetchRunDetailMock,
  fetchRunArtifactMock,
  fetchExecutionLogsMock,
  fetchMarkPreviewMock,
  fetchMarksHistoryMock,
} = vi.hoisted(() => ({
  markRunMock: vi.fn(),
  fetchRunAnalysisMock: vi.fn(),
  fetchRunMock: vi.fn(),
  fetchRunDetailMock: vi.fn(),
  fetchRunArtifactMock: vi.fn(),
  fetchExecutionLogsMock: vi.fn(),
  fetchMarkPreviewMock: vi.fn(),
  fetchMarksHistoryMock: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  markRun: markRunMock,
  fetchRun: fetchRunMock,
  fetchRunDetail: fetchRunDetailMock,
  fetchRunAnalysis: fetchRunAnalysisMock,
  fetchRunKnowledge: () => Promise.resolve({ kind: 'evidence-incomplete', runId: '' }),
  fetchRunArtifact: fetchRunArtifactMock,
  fetchExecutionLogs: fetchExecutionLogsMock,
  fetchRunEvidence: () => Promise.resolve({ kind: 'failed', error: 'not configured' }),
  fetchMarkPreview: fetchMarkPreviewMock,
  fetchMarksHistory: fetchMarksHistoryMock,
  triggerRun: vi.fn(),
  watchPostProcessing: () => () => {},
}))

vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: () => {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/page-skeleton', () => ({ DetailSkeleton: () => <div>Loading...</div> }))
vi.mock('@/components/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock('@/components/run-detail/tab-panels', () => ({
  TabPanels: ({ step }: { step: { id: string } | null }) => (
    <div data-testid="tab-panels" data-step-id={step?.id ?? ''} />
  ),
}))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span>member filter</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
// Pitfall 7: the panel double renders the props the layout cells read, JSON-encoded so a numeric
// size and a string size stay distinguishable.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children, defaultLayout }: { children: ReactNode; defaultLayout?: unknown }) => (
    <div
      data-resizable-group
      data-default-layout={defaultLayout === undefined ? undefined : JSON.stringify(defaultLayout)}
    >
      {children}
    </div>
  ),
  ResizablePanel: ({ children, id, defaultSize, minSize, maxSize }: {
    children: ReactNode
    id?: string
    defaultSize?: unknown
    minSize?: unknown
    maxSize?: unknown
  }) => (
    <div
      data-resizable-panel
      data-panel-id={id}
      data-default-size={JSON.stringify(defaultSize)}
      data-min-size={JSON.stringify(minSize)}
      data-max-size={JSON.stringify(maxSize)}
    >
      {children}
    </div>
  ),
  ResizableHandle: () => <div data-resizable-handle />,
}))
vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...rest }: { children: ReactNode }) => <span {...rest}>{children}</span>,
}))
// Pitfall 7: every prop but the variant styling passes through, so data-*, aria-* and onClick reach
// the DOM the cells read.
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, variant: _variant, size: _size, asChild: _asChild, ...rest }: {
    children: ReactNode
    variant?: string
    size?: string
    asChild?: boolean
  }) => <button type="button" {...rest}>{children}</button>,
}))

function member(testIndex: number, extra: Partial<RunDetailMember> = {}): RunDetailMember {
  return { testIndex, attempts: 1, ...extra }
}

function step(testIndex: number, stepIndex: number, stepText: string): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    stepText,
    cacheStatus: 'miss',
    verifierVerdict: { pass: false, reasoning: 'cart total differs' },
    selfHealOccurred: false,
    briefDigest: `d${String(testIndex)}${String(stepIndex)}`,
    status: 'failed',
    durationMs: 1000,
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

function runRow(id: string) {
  return {
    id,
    name: 'Checkout test',
    filePath: 'tests/checkout.yaml',
    status: 'failed',
    duration: 10000,
    attributes: {},
    environment: null,
    metadata: null,
    startedAt: '2026-09-23T00:00:00.000Z',
    endedAt: '2026-09-23T00:00:10.000Z',
    failureSummary: null,
    errorLog: null,
    memoryLog: null,
    testId: null,
    suiteId: null,
    platform: 'web',
    testFileContent: null,
    modelName: null,
    llmProvider: null,
    parentRunId: null,
    attemptNumber: 1,
    retryCount: 0,
    maxRetries: 0,
    createdAt: '2026-09-23T00:00:00.000Z',
  }
}

const initial = projection({
  members: [member(0, { testId: TEST_ID, outcome: 'failed', marks: [] })],
  steps: [step(0, 0, 'Open cart')],
})
const receipt: RunDetailMemberMark = {
  markId: 'mark_0123456789ab',
  kind: 'false-fail',
  ordinal: 1,
  disposition: { kind: 'drafted', fix: 'fact', proposalId: 'prop_0123456789ab', proposalKind: 'knowledge' },
}
const refreshed = projection({
  ...initial,
  members: [{ ...initial.members[0]!, marks: [receipt] }],
})
const CONSEQUENCES = RunsMarkPreviewResultSchema.parse({
  kind: 'consequences',
  runId: RUN_ID,
  prospective: true,
  markKind: 'false-fail',
  member: { testIndex: 0, testId: TEST_ID },
  resolvedStep: { stepIndex: 0, reason: 'failing-step' },
  latest: { kind: 'first' },
  basis: { ledgerOrdinal: 0 },
  markedDecisionCount: 1,
  groundTruth: [],
  labels: [],
  knowledge: { servedRecordIds: [], appendsEvidence: false, records: [], evidence: { confirmed: 0, overturned: 0 } },
  draft: { kind: 'no-draftable-fix', checked: { servedRecords: 0, procedureReads: 0, assertionDrift: false } },
})

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flushRender() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

async function renderAt(url: string) {
  container = document.createElement('div')
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

function q<T extends Element = HTMLElement>(selector: string): T | null {
  return container!.querySelector<T>(selector)
}

async function click(selector: string) {
  await act(async () => { q<HTMLElement>(selector)!.click() })
  await flushRender()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

async function pickFirstChoiceAndLandPreview(read: Promise<MarkPreviewRead>) {
  fetchMarkPreviewMock.mockReturnValue(read)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await click('[data-feedback-choice] [role="radio"]')
  expect(fetchMarkPreviewMock).not.toHaveBeenCalled()
  await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS) })
  vi.useRealTimers()
  await flushRender()
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  fetchExecutionLogsMock.mockResolvedValue({ logs: [] })
  fetchRunArtifactMock.mockResolvedValue({ run: { id: RUN_ID }, artifact: null, missingSections: ['artifact'] })
  fetchRunAnalysisMock.mockResolvedValue({ runId: RUN_ID, verdicts: [], sentences: [], clusters: [] })
  fetchRunMock.mockImplementation(async (id: string) => ({ run: runRow(id) }))
  fetchRunDetailMock.mockResolvedValue(initial)
  fetchMarksHistoryMock.mockResolvedValue({ kind: 'failed', reason: 'network' })
})

afterEach(() => {
  vi.useRealTimers()
  if (root) act(() => root!.unmount())
  root = null
  if (container) container.remove()
  container = null
  setRunConfirmScope(undefined)
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('426-01 contextual feedback tracer', () => {
  it('TRACER-HEADER-ENTRY-TO-RECORDED: header entry → current preview → Send feedback → announced receipt', async () => {
    fetchRunDetailMock.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed)
    markRunMock.mockResolvedValue({ kind: 'marked', receipt })
    await renderAt(`/runs/${RUN_ID}`)

    const entries = container!.querySelectorAll('[data-feedback-entry="test"]')
    expect(entries).toHaveLength(1)
    expect(q('[data-verdict-badge]')!.nextElementSibling).toBe(entries[0])

    await click('[data-feedback-entry="test"]')
    const composer = q('[data-feedback-composer]')
    expect(composer).not.toBeNull()
    expect(composer!.getAttribute('data-feedback-scope')).toBe('test')
    expect(composer!.getAttribute('data-feedback-target')).toBe('0:run')
    const rows = [...container!.querySelectorAll('[data-feedback-choice]')]
    expect(rows.map(row => row.getAttribute('data-feedback-choice'))).toEqual([...FEEDBACK_CHOICE_ORDER.failed])
    expect(rows.map(row => row.textContent)).toEqual(FEEDBACK_CHOICE_ORDER.failed.map(kind => CHOICE_LABELS[kind] + CHOICE_MEANINGS.failed[kind]))

    const preview = deferred<MarkPreviewRead>()
    await pickFirstChoiceAndLandPreview(preview.promise)
    expect(fetchMarkPreviewMock).toHaveBeenCalledTimes(1)
    const submit = q<HTMLButtonElement>('[data-feedback-submit]')!
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    expect(submit.hasAttribute('disabled')).toBe(false)
    await click('[data-feedback-submit]')
    expect(markRunMock).not.toHaveBeenCalled()

    await act(async () => preview.resolve({ kind: 'read', result: CONSEQUENCES }))
    await flushRender()
    expect(q('[data-feedback-preview]')!.getAttribute('data-preview-state')).toBe('consequences')
    expect(q('[data-feedback-preview]')!.getAttribute('data-preview-current')).toBe('true')
    expect(q('[data-feedback-submit]')!.getAttribute('aria-disabled')).toBe('false')

    await click('[data-feedback-submit]')
    await flushRender()
    expect(markRunMock).toHaveBeenCalledTimes(1)
    const status = q('[data-feedback-status]')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
    expect(status.textContent).toBe(feedbackRecordedText(receipt.disposition))
  })

  it('PREVIEW-INPUT-EQUALS-MARK-INPUT: the preview body is the mark body with runId added and note and confirmScope removed', async () => {
    const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
    markRunMock.mockImplementation(actual.markRun)
    fetchMarkPreviewMock.mockImplementation(actual.fetchMarkPreview)
    fetchRunDetailMock.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed)
    const bodies = new Map<string, Record<string, unknown>>()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>
      bodies.set(url, body)
      return new Response(JSON.stringify(url.endsWith('/mark-preview') ? CONSEQUENCES : { kind: 'marked', receipt }))
    }))
    setRunConfirmScope('scope-x')
    await renderAt(`/runs/${RUN_ID}`)
    await click('[data-feedback-entry="test"]')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await click('[data-feedback-choice] [role="radio"]')
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS) })
    vi.useRealTimers()
    await flushRender()
    await click('[data-feedback-submit]')
    await flushRender()

    const previewBody = bodies.get(`/api/runs/${encodeURIComponent(RUN_ID)}/mark-preview`)
    const markBody = bodies.get(`/api/runs/${encodeURIComponent(RUN_ID)}/mark`)
    expect(previewBody).toBeDefined()
    expect(markBody).toBeDefined()
    expect(previewBody!.runId).toBe(RUN_ID)
    expect(markBody!.confirmScope).toBe('scope-x')
    const { runId: _runId, ...previewRest } = previewBody!
    const { note: _note, confirmScope: _scope, ...markRest } = markBody!
    expect(previewRest).toEqual(markRest)
    expect(previewRest).toEqual({ kind: FEEDBACK_CHOICE_ORDER.failed[0], testId: TEST_ID })
  })

  it('COMPOSER-IS-A-REGION: the composer is a named section and nothing on its path is a dialog', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    await click('[data-feedback-entry="test"]')
    const composer = q('[data-feedback-composer]')!
    expect(composer.tagName).toBe('SECTION')
    const headingId = composer.getAttribute('aria-labelledby')!
    const heading = document.getElementById(headingId)
    expect(heading?.tagName).toBe('H2')
    expect(composer.contains(heading)).toBe(true)
    expect(document.querySelectorAll('[role="dialog"],[aria-modal]')).toHaveLength(0)
  })

  it('CLOSED-LAYOUT-TWO-PANELS: closed renders the shipped two panels; opening adds a third with a three-key percent layout', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    const group = () => q('[data-resizable-group]')!
    const panels = () => [...container!.querySelectorAll('[data-resizable-panel]')]
    expect(panels().map(panel => [panel.getAttribute('data-default-size'), panel.getAttribute('data-min-size')]))
      .toEqual([['35', '20'], ['65', '30']])
    expect(group().hasAttribute('data-default-layout')).toBe(false)
    expect(container!.querySelectorAll('[data-resizable-handle]')).toHaveLength(1)

    await click('[data-feedback-entry="test"]')
    expect(panels().map(panel => panel.getAttribute('data-panel-id'))).toEqual(['run-tree', 'run-evidence', 'run-feedback'])
    expect(panels().slice(0, 2).map(panel => [panel.getAttribute('data-default-size'), panel.getAttribute('data-min-size')]))
      .toEqual([['35', '20'], ['65', '30']])
    expect(container!.querySelectorAll('[data-resizable-handle]')).toHaveLength(2)
    const layout = JSON.parse(group().getAttribute('data-default-layout')!) as Record<string, number>
    expect(Object.keys(layout).sort()).toEqual(['run-evidence', 'run-feedback', 'run-tree'])
    expect(Object.values(layout).reduce((sum, value) => sum + value, 0)).toBeCloseTo(100)
    expect(q('[data-panel-id="run-feedback"] [data-feedback-composer]')).not.toBeNull()
  })

  it('NO-FEEDBACK-READ-ON-MOUNT: no feedback read fires until the composer opens', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    await flushRender()
    expect(q('[data-verdict-badge]')).not.toBeNull()
    expect(fetchMarkPreviewMock).not.toHaveBeenCalled()
    expect(fetchMarksHistoryMock).not.toHaveBeenCalled()
  })
})
