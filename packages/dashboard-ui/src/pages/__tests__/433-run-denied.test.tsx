// @vitest-environment jsdom

// C433-RUN-DENIED-UI (Phase 433 plan 34; G-433-10, F-433-42).
//
// The dashboard's trigger refuses a run on a production target the config has not opted into with
// 403 `{ error: 'run_denied', neutralReason }`. Every Run control shows that one sentence where the
// click happened, celebrates nothing and navigates nowhere. The pages are mounted on the REAL
// `triggerRun`: only `fetch` answers, so the cells measure what the browser does with the door's
// own body. Page reads and heavy leaf components are doubled.

import { act, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { buildProductionRefusal } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RunDetailPage from '@/pages/run-detail'
import TestsPage from '@/pages/tests'
import SuiteEditorPage from '@/pages/suite-editor'
import SuiteViewerPage from '@/pages/suite-viewer'
import TestEditorPage from '@/pages/test-editor'
import TestViewerPage from '@/pages/test-viewer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SENTENCE = buildProductionRefusal(['example-web'])
const fixture = vi.hoisted(() => {
  const testId = 't_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
  const suiteId = 's_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
  const testPath = 'tests/example-passing.yaml'
  return {
    testId,
    suiteId,
    runId: 'r_denied-probe',
    testPath,
    suitePath: 'suites/example.suite.yaml',
    productionPath: 'tests/web/production.yaml',
    testContent: [`test-id: ${testId}`, 'name: Example passing', 'target: example-web', 'steps:', '  - Open the page', ''].join('\n'),
    suiteContent: [`suite-id: ${suiteId}`, 'name: Example suite', 'target: example-web', 'tests:', `  - test: ${testPath}`, ''].join('\n'),
  }
})
const { testId: TEST_ID, suiteId: SUITE_ID, runId: RUN_ID, testPath: TEST_PATH } = fixture

const harness = vi.hoisted(() => ({
  shortcuts: {} as Record<string, () => void>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

const { navbarRun, passthrough } = vi.hoisted(() => ({
  navbarRun: ({ onRun }: { onRun: (local: boolean) => void }) => (
    <button type="button" data-action="run" onClick={() => onRun(true)}>Run</button>
  ),
  passthrough: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const emptyAnalytics = { total: 0, flakyScore: 0, isFlaky: false, runs: [], trends: { passRate: 0, avgDuration: 0, totalRuns: 0, daily: [] } }
  return {
    ...actual,
    fetchTestFile: vi.fn().mockResolvedValue({ path: fixture.testPath, content: fixture.testContent }),
    fetchTestAnalytics: vi.fn().mockResolvedValue(emptyAnalytics),
    fetchSuiteFile: vi.fn().mockResolvedValue({ path: fixture.suitePath, content: fixture.suiteContent }),
    fetchSuiteAnalytics: vi.fn().mockResolvedValue({ suiteId: 's', ...emptyAnalytics }),
    fetchConfig: vi.fn().mockResolvedValue({ config: { workspace: { testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.suite.yaml'] } } }),
    fetchAuthStates: vi.fn().mockResolvedValue({ authStates: [] }),
    createLiveEditorSession: vi.fn(),
    saveLiveAuthState: vi.fn(),
    createTestFile: vi.fn(),
    updateTestFile: vi.fn(),
    validateTestContent: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    createSuiteFile: vi.fn(),
    updateSuiteFile: vi.fn(),
    validateSuiteContent: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
    purgeCache: vi.fn(),
    fetchRun: vi.fn(),
    fetchRunDetail: vi.fn(),
    fetchRunAnalysis: () => Promise.resolve({ runId: '', verdicts: [], sentences: [], clusters: [] }),
    fetchRunKnowledge: () => Promise.resolve({ kind: 'evidence-incomplete', runId: '' }),
    fetchRunArtifact: vi.fn(),
    fetchActiveExecutions: vi.fn().mockResolvedValue({ executions: [] }),
    fetchExecutionLogs: vi.fn().mockResolvedValue({ logs: [] }),
    fetchRunEvidence: () => Promise.resolve({ kind: 'failed', error: 'Evidence read not configured in this fixture' }),
    watchPostProcessing: () => () => {},
    markRun: vi.fn(),
    fetchTestFiles: vi.fn().mockResolvedValue({
      files: [
        { path: 'tests/web/login.yaml', name: 'Login flow', testId: 'test_login', modified: '2026-10-04T00:00:00.000Z', targetName: 'local-web', platform: 'web' },
        { path: fixture.productionPath, name: 'Production flow', testId: 'test_production', modified: '2026-10-04T01:00:00.000Z', targetName: 'example-web', platform: 'web' },
      ],
      targets: ['local-web', 'example-web'],
    }),
    fetchRuns: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
    deleteTestFile: vi.fn(),
  }
})

vi.mock('sonner', () => ({ toast: { success: harness.toastSuccess, error: harness.toastError } }))
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({
  useKeyboardShortcuts: (shortcuts: Record<string, () => void>) => { harness.shortcuts = shortcuts },
}))
vi.mock('@/hooks/use-run-config', () => ({ useRunConfig: () => ({ defaultRunMode: 'local', hasFarm: false, isLoading: false }) }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-variable-suggestions', () => ({ useVariableSuggestions: () => ({ suggestions: [], isLoading: false }) }))
vi.mock('@/hooks/use-target-details', () => ({ useTargetDetails: () => ({ targets: {}, globalUse: [], isLoading: false }) }))
vi.mock('@/hooks/use-live-editor', () => ({
  useLiveEditor: () => ({
    connectionState: 'idle', steps: [], setupHooks: [], teardownHooks: [], currentUrl: null,
    pendingNavigation: null, error: null, executeStepByIndex: vi.fn(), executeHookById: vi.fn(),
    cancelStep: vi.fn(), refreshPage: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), navigate: vi.fn(),
    runAll: vi.fn(), cancelRunAll: vi.fn(), terminateSession: vi.fn(), runningStepIndex: null,
    runningStepId: null, sessionId: null, isTerminated: false, sessionGone: false, deviceLogs: [],
    platform: 'web', ariaTree: null, requestAriaTree: vi.fn(), isRunningAll: false, isStoppingRunAll: false,
  }),
}))
vi.mock('@/components/product-tour', () => ({ useOptionalProductTour: () => null }))

vi.mock('@/components/test-navbar', () => ({ TestNavbar: navbarRun }))
vi.mock('@/components/suite-navbar', () => ({ SuiteNavbar: navbarRun }))
vi.mock('@/components/visual-builder', () => ({ VisualBuilder: () => <div /> }))
vi.mock('@/components/suite-visual-builder', () => ({ SuiteVisualBuilder: () => <div /> }))
vi.mock('@/components/monaco-editor', () => ({ MonacoEditor: () => <div /> }))
vi.mock('@/components/test-settings-panel', () => ({ TestSettingsPanel: () => <div /> }))
vi.mock('@/components/run-results-panel', () => ({ RunResultsPanel: () => <div /> }))
vi.mock('@/components/live-session-pane', () => ({ LiveSessionPane: () => <div /> }))
vi.mock('@/components/pass-rate-chart', () => ({ PassRateChart: () => <div /> }))
vi.mock('@/components/duration-chart', () => ({ DurationChart: () => <div /> }))
vi.mock('@/components/page-skeleton', () => ({
  EditorSkeleton: () => <div data-loading />,
  DetailSkeleton: () => <div data-loading />,
  TableSkeleton: () => <div data-loading />,
}))
vi.mock('@/components/empty-state', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('@/components/shortcut-hints', () => ({ ShortcutLegend: () => <div /> }))
vi.mock('@/components/run-detail/step-tree', () => ({ StepTree: () => <div /> }))
vi.mock('@/components/run-detail/tab-panels', () => ({ TabPanels: () => <div /> }))
vi.mock('@/components/run-detail/artifact-drawer', () => ({ ArtifactDrawer: () => <div /> }))
vi.mock('@/components/run-detail/hook-detail-panel', () => ({ HookDetailPanel: () => <div /> }))
vi.mock('@/components/run-detail/post-processing-chips', () => ({ PostProcessingChips: () => <div /> }))
vi.mock('@/components/run-detail/retrieval-rung-banner', () => ({ RetrievalRungBanner: () => <div /> }))
vi.mock('@/components/run-detail/run-usage-card', () => ({ RunUsageCard: () => <div /> }))
vi.mock('@/components/run-detail/feedback-entry', () => ({ FeedbackEntryButton: () => <div /> }))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: passthrough,
  Tooltip: passthrough,
  TooltipTrigger: passthrough,
  TooltipContent: passthrough,
}))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: passthrough,
  ResizablePanel: passthrough,
  ResizableHandle: () => <div />,
}))
vi.mock('@/components/ui/tabs', () => ({
  Tabs: passthrough,
  TabsList: passthrough,
  TabsTrigger: passthrough,
  TabsContent: passthrough,
}))
vi.mock('@/components/ui/sheet', () => ({
  Sheet: passthrough, SheetContent: passthrough, SheetHeader: passthrough, SheetTitle: passthrough, SheetDescription: passthrough,
}))
vi.mock('@/components/ui/select', () => ({
  Select: passthrough, SelectTrigger: passthrough, SelectValue: () => <span />, SelectContent: passthrough, SelectItem: passthrough,
}))
vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: passthrough, CollapsibleTrigger: passthrough, CollapsibleContent: passthrough,
}))
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: passthrough, ScrollBar: () => null }))
vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: { checked?: boolean | string; onCheckedChange?: (value: boolean) => void; 'aria-label'?: string }) => (
    <input type="checkbox" checked={checked === true} onChange={(event) => onCheckedChange?.(event.currentTarget.checked)} {...props} />
  ),
}))
vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
vi.mock('@/components/batch-action-bar', () => ({
  BatchActionBar: ({ actionSlot, selectedCount }: { actionSlot?: ReactNode; selectedCount: number }) =>
    selectedCount === 0 ? null : <div data-testid="batch-actions">{actionSlot}</div>,
}))
vi.mock('@/components/test-run-options-popover', () => ({
  TestRunOptionsPopover: ({ open, onOpenChange, onRunLocal }: { open: boolean; onOpenChange: (open: boolean) => void; onRunLocal: () => void }) => (
    <div>
      <button type="button" data-action="bulk-open" onClick={() => onOpenChange(!open)}>Run</button>
      {open ? <button type="button" data-action="bulk-run-local" onClick={onRunLocal}>Run Local</button> : null}
    </div>
  ),
}))
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, asChild: _asChild, variant: _variant, size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; asChild?: boolean; variant?: string; size?: string }) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

/** The run row run detail reads, with only the fields the re-run path needs. */
function runRow() {
  return {
    id: RUN_ID, name: 'Example passing', filePath: TEST_PATH, status: 'failed', duration: 1000,
    tags: null, environment: null, metadata: null, attributes: { 'agent-qa.runner': 'local' },
    startedAt: '2026-10-04T00:00:00.000Z', endedAt: '2026-10-04T00:00:01.000Z', source: 'dashboard',
    failureSummary: null, errorLog: null, memoryLog: null, testId: TEST_ID, suiteId: null,
    platform: 'web', testFileContent: null, modelName: null, llmProvider: null, parentRunId: null,
  }
}

let observedPaths: string[] = []

function LocationProbe() {
  const location = useLocation()
  observedPaths.push(location.pathname)
  return null
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let triggerCalls: unknown[] = []
/** Files the trigger starts; every other file is refused as production. */
let allowedFiles = new Set<string>()

beforeEach(async () => {
  observedPaths = []
  triggerCalls = []
  allowedFiles = new Set()
  harness.shortcuts = {}
  harness.toastSuccess.mockReset()
  harness.toastError.mockReset()
  Element.prototype.scrollIntoView = vi.fn()
  const api = await import('@/lib/api')
  vi.mocked(api.fetchRun).mockResolvedValue({ run: runRow(), steps: [], tests: [], attempts: [] } as never)
  vi.mocked(api.fetchRunDetail).mockResolvedValue({
    runId: RUN_ID, members: [], steps: [], subActions: [], tokens: { measuredSteps: 0, unmeasuredSteps: 0 },
  } as never)
  vi.mocked(api.fetchRunArtifact).mockResolvedValue({
    run: { id: RUN_ID }, artifact: null, children: [], missingSections: ['artifact'],
  } as never)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/run-readiness')) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
    }
    if (url.endsWith('/api/runs/trigger')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { file?: string }
      triggerCalls.push(body)
      if (body.file !== undefined && allowedFiles.has(body.file)) {
        return { ok: true, status: 202, statusText: 'Accepted', json: async () => ({ runId: `r_${String(triggerCalls.length)}`, status: 'queued' }) }
      }
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'run_denied', neutralReason: SENTENCE }),
      }
    }
    throw new Error(`unexpected fetch in a run-denied cell: ${url}`)
  }))
})

afterEach(() => {
  if (root !== null) {
    const current = root
    act(() => { current.unmount() })
  }
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    await new Promise((settle) => setTimeout(settle, 0))
  })
}

async function mount(path: string, pattern: string, page: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={<><LocationProbe />{page}</>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
  await flush()
}

async function click(selector: string): Promise<void> {
  const element = container?.querySelector<HTMLElement>(selector)
  expect(element, `no control matches ${selector}`).toBeTruthy()
  await act(async () => { element!.click() })
  await flush()
}

async function press(key: string): Promise<void> {
  const shortcut = harness.shortcuts[key]
  expect(shortcut, `no ${key} shortcut is registered`).toBeTypeOf('function')
  await act(async () => { shortcut!() })
  await flush()
}

/** What the person was shown and where they were left, after one denied click. */
function shown(startPath: string): { sentenceShown: boolean; errors: string[]; successes: number; leftAt: string; triggered: number } {
  const errors = harness.toastError.mock.calls.map(([message]) => String(message))
  const inline = container?.textContent ?? ''
  return {
    sentenceShown: errors.some((message) => message.includes(SENTENCE)) || inline.includes(SENTENCE),
    errors,
    successes: harness.toastSuccess.mock.calls.length,
    leftAt: observedPaths.at(-1) ?? startPath,
    triggered: triggerCalls.length,
  }
}

function expectRefusalShown(startPath: string): void {
  const observed = shown(startPath)
  expect(observed.triggered, 'the control never reached the trigger').toBeGreaterThan(0)
  expect(observed, JSON.stringify(observed.errors)).toEqual({
    sentenceShown: true,
    errors: observed.errors,
    successes: 0,
    leftAt: startPath,
    triggered: observed.triggered,
  })
}

describe('C433-RUN-DENIED-UI: every Run control names the production refusal where the click happened', () => {
  it('C433-RUN-DENIED-UI: the test viewer’s Run', async () => {
    const path = `/tests/${TEST_ID}`
    await mount(path, '/tests/:t_id', <TestViewerPage />)
    await click('[data-action="run"]')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: the test viewer’s Run shortcut', async () => {
    const path = `/tests/${TEST_ID}`
    await mount(path, '/tests/:t_id', <TestViewerPage />)
    await press('r')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: the test editor’s Run', async () => {
    const path = `/tests/${TEST_ID}/edit`
    await mount(path, '/tests/:t_id/edit', <TestEditorPage />)
    await click('[data-action="run"]')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: the suite viewer’s Run', async () => {
    const path = `/suites/${SUITE_ID}`
    await mount(path, '/suites/:suite-id', <SuiteViewerPage />)
    await click('[data-action="run"]')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: the suite editor’s Run', async () => {
    const path = `/suites/${SUITE_ID}/edit`
    await mount(path, '/suites/:suite-id/edit', <SuiteEditorPage />)
    await click('[data-action="run"]')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: run detail’s re-run shortcut', async () => {
    const path = `/runs/${RUN_ID}`
    await mount(path, '/runs/:id', <RunDetailPage />)
    await press('r')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: run detail’s navbar re-run', async () => {
    const path = `/runs/${RUN_ID}`
    await mount(path, '/runs/:id', <RunDetailPage />)
    await click('button[aria-label="Re-run"]')
    expectRefusalShown(path)
  })

  it('C433-RUN-DENIED-UI: a bulk run names the production refusal once', async () => {
    allowedFiles = new Set(['tests/web/login.yaml'])
    await mount('/tests', '/tests', <TestsPage />)
    for (const name of ['Login flow', 'Production flow']) {
      const row = Array.from(container?.querySelectorAll('tr') ?? []).find((candidate) => candidate.textContent?.includes(name))
      const select = row?.querySelector<HTMLElement>('input[aria-label="Select row"]')
      expect(select, `no selection control on the ${name} row`).toBeTruthy()
      await act(async () => { select!.click() })
      await flush()
    }
    await click('[data-action="bulk-open"]')
    await click('[data-action="bulk-run-local"]')

    const errors = harness.toastError.mock.calls.map(([message]) => String(message))
    expect(triggerCalls.map((call) => (call as { file?: string }).file).sort()).toEqual(['tests/web/login.yaml', fixture.productionPath])
    expect({
      errors: errors.length,
      sentenceOccurrences: errors.join('\n').split(SENTENCE).length - 1,
      summary: errors[0]?.startsWith('1 runs queued, 1 failed') ?? false,
      successes: harness.toastSuccess.mock.calls.length,
      leftAt: observedPaths.at(-1),
    }, JSON.stringify(errors)).toEqual({ errors: 1, sentenceOccurrences: 1, summary: true, successes: 0, leftAt: '/tests' })
  })
})
