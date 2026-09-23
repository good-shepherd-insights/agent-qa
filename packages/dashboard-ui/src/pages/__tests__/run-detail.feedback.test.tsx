// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
  NO_UNIQUE_ADDRESS_TEXT,
  PREVIEW_DEBOUNCE_MS,
  SUBMIT_REASON_NO_UNIQUE_ADDRESS,
  TEST_SWITCHER_LABEL,
  feedbackEntryLabel,
  feedbackRecordedText,
  markGlyphLabel,
  pinnedTargetText,
  switchTargetLabel,
  unsentDraftLabel,
} from '@/lib/feedback-view'
import { memberDisplayName, memberHandleLabel } from '@/lib/run-detail-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = generateRunId()
const TEST_ID = generateTestId()
const SUITE_TEST_IDS = [generateTestId(), generateTestId()] as const

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
// The select double keeps the root's value and onValueChange reachable: each item is a button that
// calls the enclosing root's handler, so a cell can pick an option without Radix's pointer model.
vi.mock('@/components/ui/select', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Root = React.createContext<((value: string) => void) | undefined>(undefined)
  return {
    Select: ({ children, value, onValueChange }: { children: ReactNode; value?: string; onValueChange?: (value: string) => void }) => (
      <Root.Provider value={onValueChange}>
        <div data-select-value={value}>{children}</div>
      </Root.Provider>
    ),
    SelectTrigger: ({ children, className: _className, ...rest }: { children: ReactNode; className?: string }) => <div {...rest}>{children}</div>,
    SelectValue: () => <span>member filter</span>,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
      const onValueChange = React.useContext(Root)
      return <button type="button" data-select-item={value} onClick={() => onValueChange?.(value)}>{children}</button>
    },
  }
})
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

function LocationProbe() {
  const location = useLocation()
  return <output data-location={`${location.pathname}${location.search}`} />
}

async function renderAt(url: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <LocationProbe />
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

function suiteDetail(member0: Partial<RunDetailMember> = {}): RunDetailProjection {
  return projection({
    members: [
      member(0, { name: 'Browse catalog', testId: SUITE_TEST_IDS[0], outcome: 'passed', marks: [], ...member0 }),
      member(1, { name: 'Pay for order', testId: SUITE_TEST_IDS[1], outcome: 'failed', marks: [] }),
    ],
    steps: [
      { ...step(0, 0, 'Open catalog'), status: 'passed', verifierVerdict: { pass: true, reasoning: '' } },
      step(1, 0, 'Submit payment'),
    ],
  })
}

describe('426-03 the header entry in a suite', () => {
  it('SUITE-HEADER-TARGET-ON-LOAD: the auto-selected first step makes member 0 the target though member 1 failed', async () => {
    fetchRunDetailMock.mockResolvedValue(suiteDetail())
    await renderAt(`/runs/${RUN_ID}`)
    const entries = container!.querySelectorAll('[data-feedback-entry="test"]')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.getAttribute('data-feedback-target')).toBe('0:run')
    expect(entry.getAttribute('data-feedback-marked')).toBe('false')
    expect(entry.getAttribute('aria-label')).toBe(
      feedbackEntryLabel({ scope: 'test', memberName: 'Browse catalog', handle: memberHandleLabel(0) }),
    )

    await click('[data-feedback-entry="test"]')
    const composer = q('[data-feedback-composer]')!
    expect(composer.getAttribute('data-feedback-target')).toBe('0:run')
    const heading = document.getElementById(composer.getAttribute('aria-labelledby')!)!
    expect(heading.textContent).toBe(`Feedback on ${memberDisplayName({ testIndex: 0, name: 'Browse catalog' })} ${memberHandleLabel(0)}`)
  })

  it('SUITE-HEADER-TARGET-ON-LOAD: a whole-test mark on the target member fills the entry', async () => {
    fetchRunDetailMock.mockResolvedValue(suiteDetail({ marks: [receipt] }))
    await renderAt(`/runs/${RUN_ID}`)
    const entry = q('[data-feedback-entry="test"]')!
    expect(entry.getAttribute('data-feedback-target')).toBe('0:run')
    expect(entry.getAttribute('data-feedback-marked')).toBe('true')
    expect(entry.getAttribute('aria-label')).toBe(
      feedbackEntryLabel({ scope: 'test', memberName: 'Browse catalog', handle: memberHandleLabel(0), markedChoice: receipt.kind }),
    )
  })

  it('ENTRY-ABSENT-WITHOUT-MARKS: a failed detail read or a target member without marks renders no entry', async () => {
    fetchRunDetailMock.mockRejectedValue(new Error('offline'))
    await renderAt(`/runs/${RUN_ID}`)
    expect(q('[data-verdict-badge]')).not.toBeNull()
    expect(container!.querySelectorAll('[data-feedback-entry]')).toHaveLength(0)
    act(() => root!.unmount())
    container!.remove()

    fetchRunDetailMock.mockReset()
    fetchRunDetailMock.mockResolvedValue(suiteDetail({ marks: undefined }))
    await renderAt(`/runs/${RUN_ID}`)
    expect(q('[data-verdict-badge]')).not.toBeNull()
    expect(container!.querySelectorAll('[data-feedback-entry]')).toHaveLength(0)
  })
})

describe('426-03 the composer names, switches and refuses its test', () => {
  it('SWITCHER-RETARGETS: choosing another test re-targets the composer and leaves the filter and selection alone', async () => {
    fetchRunDetailMock.mockResolvedValue(suiteDetail())
    await renderAt(`/runs/${RUN_ID}?member=0`)
    const location = () => q('[data-location]')!.getAttribute('data-location')
    const selectedRow = () => container!.querySelector('[aria-selected="true"]')?.textContent ?? null
    const locationBefore = location()
    const selectedBefore = selectedRow()
    expect(selectedBefore).not.toBeNull()

    await click('[data-feedback-entry="test"]')
    const composer = () => q('[data-feedback-composer]')!
    const switcher = composer().querySelector<HTMLElement>('[data-feedback-test-switcher]')!
    expect(switcher).not.toBeNull()
    const label = composer().querySelector(`label[for="${switcher.id}"]`)
    expect(label?.textContent).toBe(TEST_SWITCHER_LABEL)
    expect([...composer().querySelectorAll('[data-select-item]')].map(item => item.textContent)).toEqual([
      `${memberDisplayName({ testIndex: 0, name: 'Browse catalog' })} ${memberHandleLabel(0)}`,
      `${memberDisplayName({ testIndex: 1, name: 'Pay for order' })} ${memberHandleLabel(1)}`,
    ])

    await act(async () => { composer().querySelector<HTMLElement>('[data-select-item="1"]')!.click() })
    await flushRender()
    expect(composer().getAttribute('data-feedback-target')).toBe('1:run')
    const heading = document.getElementById(composer().getAttribute('aria-labelledby')!)!
    expect(heading.textContent).toBe(`Feedback on Pay for order ${memberHandleLabel(1)}`)
    expect(location()).toBe(locationBefore)
    expect(selectedRow()).toBe(selectedBefore)
  })

  it('SWITCHER-RETARGETS: a single-test run renders no switcher', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    await click('[data-feedback-entry="test"]')
    expect(q('[data-feedback-composer]')).not.toBeNull()
    expect(q('[data-feedback-test-switcher]')).toBeNull()
  })

  it('NO-UNIQUE-ADDRESS-REFUSAL: a member sharing its testId is refused in the composer without a request', async () => {
    const shared = suiteDetail()
    fetchRunDetailMock.mockResolvedValue({
      ...shared,
      members: shared.members.map(entry => ({ ...entry, testId: SUITE_TEST_IDS[0] })),
    })
    await renderAt(`/runs/${RUN_ID}`)
    await click('[data-feedback-entry="test"]')
    const refusal = q('[data-feedback-no-address]')
    expect(refusal, 'no refusal block at the top of the composer body').not.toBeNull()
    expect(refusal!.textContent).toContain(NO_UNIQUE_ADDRESS_TEXT)
    expect(container!.querySelectorAll('[data-feedback-choice]')).toHaveLength(3)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await click('[data-feedback-choice] [role="radio"]')
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS) })
    vi.useRealTimers()
    await flushRender()
    expect(fetchMarkPreviewMock).not.toHaveBeenCalled()
    expect(q('[data-feedback-submit-reason]')!.textContent).toBe(SUBMIT_REASON_NO_UNIQUE_ADDRESS)
    expect(q('[data-feedback-submit]')!.getAttribute('aria-disabled')).toBe('true')
  })
})

// THE STEP DOOR AND THE PAGE'S DOOR COUNT (426-04 · SC1, D-04, D-06). The page auto-selects the first
// step, so on load there is the header door and the selected row's door; clearing the selection or
// selecting a hook leaves the header door alone. The shipped pills are still present in this plan and
// carry no data-feedback-entry, so they are not counted.
const SETUP_HOOK = {
  id: 'hook-setup-1', runId: RUN_ID, stepId: null, type: 'hook', name: 'Seed catalog', hookId: 'seed',
  phase: 'setup', status: 'passed', duration: 120, stdout: null, stderr: null, returnData: null,
  variables: null, createdAt: '2026-09-23T00:00:00.000Z',
}
const doors = () => container!.querySelectorAll('[data-feedback-entry]')

describe('426-04 the step door on the page', () => {
  it('TRIGGER-COUNT: two doors with a step selected, one with no selection, one with a hook selected', async () => {
    fetchExecutionLogsMock.mockResolvedValue({ logs: [SETUP_HOOK] })
    await renderAt(`/runs/${RUN_ID}`)
    expect(container!.querySelectorAll('[data-mark-kind]').length).toBeGreaterThan(0)
    expect(doors()).toHaveLength(2)
    expect([...doors()].map(door => door.getAttribute('data-feedback-entry')).sort()).toEqual(['step', 'test'])
    expect(q('[data-feedback-entry="test"]')!.getAttribute('data-feedback-target')).toBe('0:run')
    expect(q('[data-feedback-entry="step"]')!.getAttribute('data-feedback-target')).toBe('0:0')

    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await flushRender()
    expect(container!.querySelector('[aria-selected="true"]')).toBeNull()
    expect(doors()).toHaveLength(1)
    expect(q('[data-feedback-entry="test"]')).not.toBeNull()

    const hook = [...container!.querySelectorAll<HTMLButtonElement>('li[role="treeitem"] > button')]
      .find(button => button.textContent?.includes(SETUP_HOOK.name))
    expect(hook, 'no setup hook row').toBeDefined()
    await act(async () => { hook!.click() })
    await flushRender()
    expect(hook!.closest('li')!.getAttribute('aria-selected')).toBe('true')
    expect(doors()).toHaveLength(1)
    expect(q('[data-feedback-entry="test"]')).not.toBeNull()
  })

  it('STEP-TRIGGER-OPENS-STEP-TARGET: the step door opens the composer on its own step and reports itself expanded', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    const stepDoor = () => q('[data-feedback-entry="step"]')!
    expect(stepDoor().getAttribute('aria-expanded')).toBe('false')
    await click('[data-feedback-entry="step"]')
    const composer = q('[data-feedback-composer]')!
    expect(composer.getAttribute('data-feedback-scope')).toBe('step')
    expect(composer.getAttribute('data-feedback-target')).toBe('0:0')
    expect(stepDoor().getAttribute('data-feedback-target')).toBe('0:0')
    expect(stepDoor().getAttribute('aria-controls')).toBe(composer.id)
    expect(stepDoor().getAttribute('aria-expanded')).toBe('true')
    expect(q('[data-feedback-entry="test"]')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('REOPEN-DRAFT-REPREVIEWS: reopening onto an address whose draft holds a choice asks for its preview again', async () => {
    fetchMarkPreviewMock.mockResolvedValue({ kind: 'read', result: CONSEQUENCES })
    await renderAt(`/runs/${RUN_ID}`)
    const land = async (open: string) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await click(open)
      await click('[data-feedback-choice] [role="radio"]')
      await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS) })
      vi.useRealTimers()
      await flushRender()
    }
    await land('[data-feedback-entry="step"]')
    expect(q('[data-feedback-submit]')!.getAttribute('aria-disabled')).toBe('false')
    await land('[data-feedback-entry="test"]')
    expect(q('[data-feedback-composer]')!.getAttribute('data-feedback-target')).toBe('0:run')
    expect(fetchMarkPreviewMock).toHaveBeenCalledTimes(2)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await click('[data-feedback-entry="step"]')
    await act(async () => { vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS) })
    vi.useRealTimers()
    await flushRender()
    expect(q('[data-feedback-composer]')!.getAttribute('data-feedback-target')).toBe('0:0')
    expect(fetchMarkPreviewMock).toHaveBeenCalledTimes(3)
    expect(q('[data-feedback-preview]')!.getAttribute('data-preview-current')).toBe('true')
    expect(q('[data-feedback-submit]')!.getAttribute('aria-disabled')).toBe('false')
  })
})

describe('426-04 the passive trace on a member header', () => {
  it('MEMBER-GLYPH: a whole-test mark puts one named glyph after the member handle and before its outcome badge', async () => {
    fetchRunDetailMock.mockResolvedValue(suiteDetail({ marks: [receipt] }))
    await renderAt(`/runs/${RUN_ID}`)
    const glyphs = container!.querySelectorAll<HTMLElement>('[data-feedback-mark-glyph="test"]')
    expect(glyphs).toHaveLength(1)
    const glyph = glyphs[0]!
    expect(glyph.closest('[data-member]')!.getAttribute('data-member')).toBe('0')
    expect(glyph.getAttribute('role')).toBe('img')
    expect(glyph.getAttribute('aria-label')).toBe(markGlyphLabel(receipt.kind))
    expect(glyph.getAttribute('data-feedback-target')).toBe('0:run')
    expect(glyph.previousElementSibling?.hasAttribute('data-member-handle')).toBe(true)
    expect(glyph.nextElementSibling?.getAttribute('data-member-outcome')).toBe('passed')
  })

  it('MEMBER-GLYPH: a single-test run has no member header, so no member glyph', async () => {
    fetchRunDetailMock.mockResolvedValue(refreshed)
    await renderAt(`/runs/${RUN_ID}`)
    expect(q('[data-feedback-entry="test"]')!.getAttribute('data-feedback-marked')).toBe('true')
    expect(container!.querySelectorAll('[data-feedback-mark-glyph="test"]')).toHaveLength(0)
  })
})

// THE COMPOSER IS A DOCKED COMPANION (426-05 · D-08, D-09). The target is pinned to what the person
// opened it for; the selection moves freely, and only an explicit act re-addresses the draft. Every
// address keeps its own draft for the page session, in page state only.
const fourSteps = projection({
  members: [member(0, { testId: TEST_ID, outcome: 'failed', marks: [] })],
  steps: [step(0, 0, 'Open cart'), step(0, 1, 'Apply coupon'), step(0, 2, 'Pay'), step(0, 3, 'See receipt')],
})
const composerTarget = () => q('[data-feedback-composer]')?.getAttribute('data-feedback-target') ?? null
const noteField = () => q<HTMLTextAreaElement>('[data-feedback-note]')

async function selectStep(address: string) {
  await click(`[data-step-id="${address}"] > button`)
}

async function typeNote(value: string) {
  const field = noteField()
  expect(field, 'no note field in the composer').not.toBeNull()
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(field, value)
    field!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flushRender()
}

async function openStep(address: string) {
  await selectStep(address)
  await click('[data-feedback-entry="step"]')
  expect(composerTarget()).toBe(address)
}

describe('426-05 the pinned target and per-address drafts', () => {
  beforeEach(() => {
    fetchRunDetailMock.mockResolvedValue(fourSteps)
    fetchMarkPreviewMock.mockResolvedValue({ kind: 'read', result: CONSEQUENCES })
  })

  it('TARGET-PINNED: selecting another step pins the target and names both; only the switch moves it', async () => {
    fetchExecutionLogsMock.mockResolvedValue({ logs: [SETUP_HOOK] })
    await renderAt(`/runs/${RUN_ID}`)
    await openStep('0:1')
    expect(q('[data-feedback-pinned]')).toBeNull()

    await selectStep('0:3')
    expect(composerTarget()).toBe('0:1')
    const pinned = q('[data-feedback-pinned]')
    expect(pinned, 'no pinned line after selecting another step').not.toBeNull()
    expect(pinned!.getAttribute('role')).toBe('note')
    expect(pinned!.textContent).toContain(pinnedTargetText({ stepIndex: 3 }, { stepIndex: 1 }))
    const switcher = pinned!.querySelector('[data-feedback-switch]')
    expect(switcher?.textContent).toBe(switchTargetLabel({ stepIndex: 3 }))

    await click('[data-feedback-switch]')
    expect(composerTarget()).toBe('0:3')
    expect(q('[data-feedback-pinned]')).toBeNull()

    const hook = [...container!.querySelectorAll<HTMLButtonElement>('li[role="treeitem"] > button')]
      .find(button => button.textContent?.includes(SETUP_HOOK.name))
    await act(async () => { hook!.click() })
    await flushRender()
    expect(hook!.closest('li')!.getAttribute('aria-selected')).toBe('true')
    expect(composerTarget()).toBe('0:3')
    expect(q('[data-feedback-pinned]')).toBeNull()
  })

  it('DRAFT-PER-ADDRESS-ROUNDTRIP: each address keeps its own choice and note', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    await openStep('0:1')
    await click('[data-feedback-choice="confirmed-bug"] [role="radio"]')
    await typeNote('the coupon field vanished')

    await selectStep('0:3')
    await click('[data-feedback-switch]')
    expect(composerTarget()).toBe('0:3')
    expect(container!.querySelectorAll('[data-feedback-choice] [role="radio"][aria-checked="true"]')).toHaveLength(0)
    expect(noteField()!.value).toBe('')
    await typeNote('receipt is fine')

    await selectStep('0:1')
    await click('[data-feedback-switch]')
    expect(composerTarget()).toBe('0:1')
    expect(q('[data-feedback-choice="confirmed-bug"] [role="radio"]')!.getAttribute('aria-checked')).toBe('true')
    expect(noteField()!.value).toBe('the coupon field vanished')
  })

  it('UNSENT-DRAFT-LINK: a waiting draft elsewhere is one link away; an empty draft has none', async () => {
    await renderAt(`/runs/${RUN_ID}`)
    await openStep('0:1')
    await typeNote('coupon rejected')
    await selectStep('0:3')
    await click('[data-feedback-switch]')

    const links = container!.querySelectorAll('[data-feedback-unsent-draft]')
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('data-feedback-unsent-draft')).toBe('0:1')
    expect(links[0]!.textContent).toBe(unsentDraftLabel({ stepIndex: 1 }))

    await click('[data-feedback-unsent-draft="0:1"]')
    expect(composerTarget()).toBe('0:1')
    expect(noteField()!.value).toBe('coupon rejected')
    expect(container!.querySelectorAll('[data-feedback-unsent-draft]')).toHaveLength(0)
  })

  it('DRAFTS-NOT-PERSISTED: a typed draft reaches neither storage nor the URL', async () => {
    localStorage.clear()
    sessionStorage.clear()
    await renderAt(`/runs/${RUN_ID}`)
    const location = () => q('[data-location]')!.getAttribute('data-location')!
    await openStep('0:1')
    const before = location()
    const searchBefore = window.location.search
    await typeNote('draft text only in memory')

    const stored = (storage: Storage) =>
      Array.from({ length: storage.length }, (_, index) => storage.key(index)!)
        .filter(key => key.includes('draft text only in memory') || (storage.getItem(key) ?? '').includes('draft text only in memory'))
    expect(stored(localStorage)).toEqual([])
    expect(stored(sessionStorage)).toEqual([])
    expect(location()).toBe(before)
    expect(location()).not.toContain('draft')
    expect(window.location.search).toBe(searchBefore)
    expect(noteField()!.value).toBe('draft text only in memory')
  })
})
