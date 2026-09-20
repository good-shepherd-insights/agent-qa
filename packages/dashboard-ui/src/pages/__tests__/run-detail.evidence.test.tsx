// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateRunId } from '@vostride/agent-qa-ids'
import { asRunId, maskedMarker } from '@vostride/agent-qa-schema'
import type { EvidenceDocument, RunDetailStep, RunDetailSubAction, RunsEvidenceResult, StepEvidenceEntries } from '@vostride/agent-qa-schema'
import { TabA11y } from '@/components/run-detail/tab-a11y'
import { TabPanels } from '@/components/run-detail/tab-panels'
import { fromRunDetailStep } from '@/lib/display-step'
import { EVIDENCE_COPY } from '@/lib/evidence-state-view'
import RunDetailPage from '@/pages/run-detail'
import type { ExecutionLogEntry } from '@/lib/api'

vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  watchPostProcessing: () => () => {},
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: () => {} }))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runId = asRunId(generateRunId())
const sha = 'a'.repeat(64)
const present: StepEvidenceEntries['a11y'] = {
  kind: 'a11y', state: 'present', ref: { id: `a11y-evidence:${sha}`, sha },
  counts: { critical: 1, serious: 0, moderate: 0, minor: 1 },
}
function step(stepIndex = 0, a11y = present) {
  return fromRunDetailStep({
    testIndex: 0, stepIndex, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: '' },
    selfHealOccurred: false, briefDigest: '', evidence: {
      a11y,
      console: { kind: 'console', state: 'absent', reason: 'not-captured' },
      network: { kind: 'network', state: 'absent', reason: 'not-captured' },
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    },
  } satisfies RunDetailStep, [])
}
function ready(stepIndex = 0, records: Extract<EvidenceDocument, { kind: 'a11y' }>['records'] = [
  { ruleId: 'minor-rule', impact: 'minor' as const, help: 'Minor issue', description: 'minor description', helpUrl: 'https://example.com/minor', nodes: [] },
  { ruleId: 'critical-rule', impact: 'critical' as const, help: 'Critical issue', description: '<img src=x onerror=alert(1)>', helpUrl: 'https://example.com/critical', nodes: [] },
]): RunsEvidenceResult {
  return { address: { runId, testIndex: 0, stepIndex, kind: 'a11y' }, outcome: 'ready', evidence: present, document: { schemaVersion: 1, kind: 'a11y', records } }
}
function response(result: RunsEvidenceResult) {
  return { ok: true, json: async () => result } as Response
}
let container: HTMLDivElement
let root: Root
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fetchMock = vi.fn().mockResolvedValue(response(ready()))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function render(selected = step(), selectedRunId = runId) {
  await act(async () => { root.render(<TabA11y step={selected} runId={selectedRunId} />) })
  await flushRecords()
}
async function flushRecords() { await act(async () => { await vi.advanceTimersByTimeAsync(250) }) }

it('A11Y-READS-ARTIFACT reads the selected durable address and groups impacts', async () => {
  await render()
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/runs/${runId}/evidence?testIndex=0&stepIndex=0&kind=a11y`)
  expect([...container.querySelectorAll('[data-a11y-impact]')].map(node => node.getAttribute('data-a11y-impact'))).toEqual(['critical', 'minor'])
  expect(container.textContent).toContain('critical-rule')
  expect(container.querySelector('img')).toBeNull()
})

it.each(['network', 'http', 'json', 'read-error'])('A11Y-LOAD-FAILURE keeps %s failure distinct from empty', async (failure) => {
  fetchMock.mockImplementation(async () => {
    if (failure === 'network') throw new Error('offline')
    if (failure === 'read-error') return response({ address: { runId, testIndex: 0, stepIndex: 0, kind: 'a11y' }, outcome: 'read-error', code: 'storage-read-failed' })
    return { ok: failure !== 'http', status: 500, statusText: 'failed', json: async () => { throw new Error('invalid JSON') } }
  })
  await render()
  expect(container.querySelector('[data-evidence-state="failed"][data-evidence-failure="load"][role="alert"]')).not.toBeNull()
  expect(container.querySelector('[data-evidence-state="empty"]')).toBeNull()
  fetchMock.mockResolvedValue(response(ready(0, [])))
  await act(async () => { container.querySelector('button')!.click() })
  await flushRecords()
  expect(container.querySelector('[data-evidence-state="empty"]')).not.toBeNull()
})

it('A11Y-STALE-DISCARDED ignores a response after the selected address changes', async () => {
  let oldResolve!: (value: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { oldResolve = resolve }))
  await render()
  expect(container.querySelector('[data-evidence-loading][aria-busy="true"]')).not.toBeNull()
  fetchMock.mockResolvedValue(response(ready(1, [])))
  await render(step(1))
  expect(container.querySelector('[data-evidence-state="empty"]')).not.toBeNull()
  await act(async () => { oldResolve(response(ready())) })
  expect(container.querySelector('[data-evidence-state="empty"]')).not.toBeNull()
  expect(container.querySelector('[data-a11y-impact]')).toBeNull()
})

it.each(['empty', 'not-captured', 'unsupported', 'unavailable', 'failed'] as const)('A11Y-ABSENCE maps %s without fetching', async reason => {
  await render(step(0, { kind: 'a11y', state: 'absent', reason }))
  expect(container.querySelector(`[data-evidence-state="${reason}"]`)).not.toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('A11Y-NO-SELECTION uses the shared neutral state', async () => {
  await act(async () => { root.render(<TabA11y step={null} runId={runId} />) })
  expect(container.querySelector('[data-evidence-state="no-selection"][data-evidence-tone="neutral"][role="status"]')).not.toBeNull()
  expect(container.textContent).toContain(EVIDENCE_COPY.a11y['no-selection'].title)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('A11Y-NO-DEAD-FETCH mounts the page and opens A11y without calling the retired route', async () => {
  const urls: string[] = []
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    let body: unknown
    if (url.includes('/evidence?')) body = ready()
    else if (url.endsWith('/detail')) body = {
      runId, members: [{ testIndex: 0, name: 'Checkout', attempts: 1 }],
      steps: [{ testIndex: 0, stepIndex: 0, stepText: 'Check checkout', cacheStatus: 'miss',
        verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: '',
        evidence: step().evidence }], subActions: [], tokens: { measuredSteps: 0, unmeasuredSteps: 1 },
    }
    else if (url.endsWith('/analysis')) body = { runId, verdicts: [], sentences: [], clusters: [] }
    else if (url.endsWith('/knowledge')) body = { kind: 'evidence-incomplete', runId }
    else if (url.includes('/execution-logs')) body = { logs: [] }
    else if (url.endsWith('/access' + 'ibility')) return {
      ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'gone' }),
    }
    else if (url === `/api/runs/${runId}`) body = { run: {
      id: runId, name: 'Checkout', status: 'passed', platform: 'web', duration: 0,
      attributes: {}, metadata: null, startedAt: null, endedAt: null, createdAt: '2026-09-20',
    } }
    else throw new Error(`Unexpected test request: ${url}`)
    return { ok: true, json: async () => body }
  })
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[`/runs/${runId}?step=0:0&tab=a11y`]}>
      <Routes><Route path="/runs/:id" element={<RunDetailPage />} /></Routes>
    </MemoryRouter>)
  })
  await flushRecords()
  expect(urls.some(url => url.includes('/evidence?'))).toBe(true)
  expect(container.querySelector('[data-a11y-impact="critical"]')).not.toBeNull()
  expect(urls.filter(url => url.endsWith('/access' + 'ibility'))).toEqual([])
})

async function panels(tab: string, selected: ReturnType<typeof step> | null = null, allSteps = selected ? [selected] : [], onSelectStep = vi.fn()) {
  await act(async () => { root.render(<TabPanels activeTab={tab} onTabChange={() => {}}
    step={selected} subAction={null} runId={runId} allSteps={allSteps} onSelectStep={onSelectStep} />) })
  await flushRecords()
}

it('TAB-STRIP-ALWAYS-RENDERS keeps all seven tabs and Knowledge reachable with no selection', async () => {
  await panels('knowledge')
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(7)
  expect(container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe('Knowledge')
})

it('TAB-NO-SELECTION-ALL gives each evidence tab its own shared no-selection copy', async () => {
  for (const [tab, kind] of [['env', 'variables'], ['network', 'network'], ['console', 'console'], ['aria', 'aria'], ['a11y', 'a11y']] as const) {
    await panels(tab)
    expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="no-selection"]`)).not.toBeNull()
    expect(container.textContent).toContain(EVIDENCE_COPY[kind]['no-selection'].explanation)
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

for (const { label, tab, kind } of [
  { label: 'VARIABLES', tab: 'env', kind: 'variables' },
  { label: 'A11Y', tab: 'a11y', kind: 'a11y' },
] as const) it(`TAB-LOAD-FAILURE-${label} retries the selected durable entry`, async () => {
  const selected = step()
  selected.evidence!.variables = { kind: 'variables', state: 'present', counts: { count: 1 } }
  fetchMock.mockRejectedValue(new Error('offline'))
  await act(async () => { root.render(<TabPanels activeTab={tab} onTabChange={() => {}}
    step={selected} subAction={null} runId={runId} allSteps={[selected]} />) })
  expect(fetchMock).not.toHaveBeenCalled()
  await flushRecords()
  expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="failed"][data-evidence-failure="load"]`)).not.toBeNull()
  expect(container.querySelector('[data-evidence-state="empty"]')).toBeNull()
  fetchMock.mockResolvedValue(response(kind === 'a11y' ? ready(0, []) : {
    address: { runId, testIndex: 0, stepIndex: 0, kind }, outcome: 'ready',
    evidence: selected.evidence!.variables, document: { schemaVersion: 1, kind, records: {} },
  }))
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-evidence-state="failed"] button')!.click() })
  await flushRecords()
  expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="empty"]`)).not.toBeNull()
})

it('A11Y-RECORDED-ELSEWHERE offers the nearest same-member later tie and selects it', async () => {
  const selected = step(2, { kind: 'a11y', state: 'absent', reason: 'not-captured' })
  const otherMember = { ...step(2), testIndex: 1 }
  const onSelectStep = vi.fn()
  await panels('a11y', selected, [step(1), selected, step(3), otherMember], onSelectStep)
  expect(container.textContent).toContain('Recorded on step 4')
  const action = container.querySelector('[data-evidence-state="not-captured"] button')!
  expect(action.textContent).toBe('Go to step 4')
  await act(async () => { (action as HTMLButtonElement).click() })
  expect(onSelectStep).toHaveBeenCalledExactlyOnceWith('0:3')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('A11Y-GROUP-ORDER keeps fixed impact ordering and stored order within a group', async () => {
  const record = { ruleId: 'first', impact: 'minor' as const, help: 'Issue', description: '', helpUrl: '', nodes: [] }
  const records = [record, { ...record, ruleId: 'critical', impact: 'critical' as const },
    { ...record, ruleId: 'second' }, { ...record, ruleId: 'moderate', impact: 'moderate' as const },
    { ...record, ruleId: 'serious', impact: 'serious' as const }]
  fetchMock.mockResolvedValue(response(ready(0, records)))
  await panels('a11y', step())
  expect([...container.querySelectorAll('[data-a11y-impact]')].map(node => node.getAttribute('data-a11y-impact'))).toEqual(['critical', 'serious', 'moderate', 'minor'])
  const minor = container.querySelector('[data-a11y-impact="minor"]')!
  expect(minor.textContent!.indexOf('first')).toBeLessThan(minor.textContent!.indexOf('second'))
  expect(minor.querySelector('h3')?.textContent).toBe('minor · 2')
})

const ariaEntry = { kind: 'aria', state: 'present', ref: { id: `aria-state:${sha}`, sha } } as const
const subAction: RunDetailSubAction = {
  testIndex: 0, stepIndex: 0, subActionIndex: 2, plan: 'Inspect',
  plannedAction: { type: 'navigate', to: 'url', url: 'https://example.com' }, result: { success: true }, screenStateHash: sha,
  ariaEvidence: ariaEntry,
}
function completeStep() {
  const selected = step()
  selected.evidence!.console = { kind: 'console', state: 'present', counts: { total: 1, errors: 0, warnings: 0 }, ref: { id: `console-evidence:${sha}`, sha } }
  selected.evidence!.network = { kind: 'network', state: 'present', counts: { total: 1, failed: 0, errored: 0 }, ref: { id: `network-evidence:${sha}`, sha } }
  return selected
}
async function evidencePanels(tab: string, selected = completeStep(), action: RunDetailSubAction | null = subAction, logs: ExecutionLogEntry[] = [], allSteps = [selected]) {
  await act(async () => { root.render(<TabPanels activeTab={tab} onTabChange={() => {}}
    step={selected} subAction={action} runId={runId} allSteps={allSteps} executionLogs={logs} />) })
  await flushRecords()
}
function documentResponse(document: EvidenceDocument): Response {
  const evidence = document.kind === 'aria' ? ariaEntry : completeStep().evidence![document.kind]
  return response({ address: { runId, testIndex: 0, stepIndex: 0, kind: document.kind, ...(document.kind === 'aria' ? { subActionIndex: 2 } : {}) }, outcome: 'ready', evidence,
    document } as RunsEvidenceResult)
}

for (const kind of ['network', 'console', 'aria'] as const) it(`TAB-LOAD-FAILURE-${kind.toUpperCase()} offers a working retry and never claims empty`, async () => {
  fetchMock.mockRejectedValue(new Error('offline'))
  await evidencePanels(kind)
  expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="failed"][data-evidence-failure="load"]`)).not.toBeNull()
  expect(container.querySelector('[data-evidence-state="empty"]')).toBeNull()
  fetchMock.mockResolvedValue(documentResponse(kind === 'aria'
    ? { schemaVersion: 1, kind, tree: '' } : { schemaVersion: 1, kind, records: [] }))
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-evidence-state="failed"] button')!.click() })
  await flushRecords()
  expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="empty"]`)).not.toBeNull()
})

it('HOOK-STDOUT-KEPT keeps only stdout and no-selection on the other evidence tabs', async () => {
  const selected = completeStep()
  selected.consoleLogs = [{ level: 'log', timestamp: 1, text: 'browser content must stay out' }]
  const logs = [{ id: 'hook-output', name: 'Setup', type: 'hook', phase: 'setup', status: 'passed', duration: 1, stdout: 'hook says hello' }] as ExecutionLogEntry[]
  for (const tab of ['env', 'network', 'aria', 'a11y']) {
    await evidencePanels(tab, selected, null, logs)
    expect(container.querySelector('[data-evidence-state="no-selection"]')).not.toBeNull()
  }
  await evidencePanels('console', selected, null, logs)
  expect(container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe('stdout')
  expect(container.textContent).toContain('hook says hello')
  expect(container.textContent).not.toContain('browser content must stay out')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('PRE-MILESTONE-UNAVAILABLE-ALL-TABS says not recorded on every historical evidence tab', async () => {
  const selected = completeStep()
  for (const kind of ['variables', 'network', 'console', 'a11y'] as const) {
    Object.assign(selected.evidence!, { [kind]: { kind, state: 'absent', reason: 'unavailable' } })
  }
  for (const tab of ['env', 'network', 'console', 'aria', 'a11y']) {
    await evidencePanels(tab, selected, { ...subAction, ariaEvidence: { kind: 'aria', state: 'absent', reason: 'unavailable' } })
    expect(container.querySelector('[data-evidence-state="unavailable"]')).not.toBeNull()
    expect(container.textContent).toContain('not recorded')
    expect(container.querySelector('[data-evidence-state="empty"]')).toBeNull()
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

it('ARIA-READS-SUB-ACTION renders the selected artifact as masked text, never markup', async () => {
  fetchMock.mockResolvedValue(documentResponse({ schemaVersion: 1, kind: 'aria', tree: `button ${maskedMarker('secret')} <img src=x onerror=alert(1)>` }))
  await evidencePanels('aria')
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/runs/${runId}/evidence?testIndex=0&stepIndex=0&kind=aria&subActionIndex=2`)
  expect(container.querySelector('pre')?.textContent).toContain('button')
  expect(container.querySelector('[data-masked="secret"]')).not.toBeNull()
  expect(container.querySelector('img')).toBeNull()
  await evidencePanels('aria', completeStep(), null)
  expect(container.querySelector('[data-evidence-state="no-selection"]')).not.toBeNull()
})

for (const kind of ['network', 'console'] as const) it(`RECORDS-${kind.toUpperCase()} shows exactly the selected step with masked text`, async () => {
  const selected = completeStep()
  const earlier = { ...step(0), consoleLogs: [{ level: 'log', timestamp: 0, text: 'earlier console' }],
    networkLogs: [{ url: 'https://example.com/earlier', method: 'GET', status: 200, requestHeaders: {}, responseHeaders: {}, startTime: 0, endTime: 1 }] }
  fetchMock.mockResolvedValue(documentResponse(kind === 'console'
    ? { schemaVersion: 1, kind, records: [{ level: 'error', timestamp: 1, text: `selected ${maskedMarker('secret')} <img src=x>` }] }
    : { schemaVersion: 1, kind, records: [{ url: `https://example.com/selected-${maskedMarker('secret')}`, method: 'GET', status: 200,
      requestHeaders: {}, responseHeaders: { 'content-type': 'text/html' }, body: `<img src=x> ${maskedMarker('secret')}`, startTime: 2, endTime: 3 }] }))
  await evidencePanels(kind, selected, subAction, [], [earlier, selected])
  expect(container.textContent).toContain('selected')
  expect(container.textContent).not.toContain('earlier')
  expect(container.querySelector('[data-masked="secret"]')).not.toBeNull()
  expect(container.querySelector('img')).toBeNull()
  if (kind === 'network') {
    await act(async () => { container.querySelector<HTMLTableRowElement>('tbody tr')!.click() })
    expect(container.querySelector('pre')?.textContent).toContain('<img src=x>')
    expect(container.querySelector('pre [data-masked="secret"]')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  }
})

it('A11Y-RECORDED-ELSEWHERE-PAGE selects the offered step through the page state', async () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    let body: unknown
    if (url.includes('/evidence?')) body = ready(1)
    else if (url.endsWith('/detail')) body = {
      runId, members: [{ testIndex: 0, name: 'Checkout', attempts: 1 }],
      steps: [0, 1].map(stepIndex => ({ testIndex: 0, stepIndex, stepText: `Checkout ${stepIndex}`, cacheStatus: 'miss',
        verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: '',
        evidence: step(stepIndex, stepIndex === 1 ? present : { kind: 'a11y', state: 'absent', reason: 'not-captured' }).evidence })),
      subActions: [], tokens: { measuredSteps: 0, unmeasuredSteps: 2 },
    }
    else if (url.endsWith('/analysis')) body = { runId, verdicts: [], sentences: [], clusters: [] }
    else if (url.endsWith('/knowledge')) body = { kind: 'evidence-incomplete', runId }
    else if (url.includes('/execution-logs')) body = { logs: [] }
    else if (url === `/api/runs/${runId}`) body = { run: {
      id: runId, name: 'Checkout', status: 'passed', platform: 'web', duration: 0,
      attributes: {}, metadata: null, startedAt: null, endedAt: null, createdAt: '2026-09-20',
    } }
    else throw new Error(`Unexpected test request: ${url}`)
    return { ok: true, json: async () => body }
  })
  await act(async () => { root.render(<MemoryRouter initialEntries={[`/runs/${runId}?step=0:0&tab=a11y`]}>
    <Routes><Route path="/runs/:id" element={<RunDetailPage />} /></Routes>
  </MemoryRouter>) })
  expect(container.textContent).toContain('Recorded on step 2')
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-evidence-state="not-captured"] button')!.click() })
  await flushRecords()
  expect(fetchMock).toHaveBeenCalledWith(`/api/runs/${runId}/evidence?testIndex=0&stepIndex=1&kind=a11y`)
  expect(container.querySelector('[data-a11y-impact="critical"]')).not.toBeNull()
})

const noticeText = 'This run was recorded before evidence was saved. Variables, network, console, ARIA, accessibility and video were not recorded.'

function historicalPage() {
  const selected = completeStep()
  for (const kind of ['variables', 'network', 'console', 'a11y'] as const) {
    Object.assign(selected.evidence!, { [kind]: { kind, state: 'absent', reason: 'unavailable' } })
  }
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    let body: unknown
    if (url.endsWith('/detail')) body = {
      runId: url.split('/').at(-2), members: [{ testIndex: 0, name: 'Checkout', attempts: 1, recording: { state: 'absent', reason: 'unavailable' } }],
      steps: [{ testIndex: 0, stepIndex: 0, stepText: 'Check checkout', cacheStatus: 'miss',
        verifierVerdict: { pass: true, reasoning: '' }, selfHealOccurred: false, briefDigest: '', evidence: selected.evidence }],
      subActions: [{ ...subAction, ariaEvidence: { kind: 'aria', state: 'absent', reason: 'unavailable' } }],
      tokens: { measuredSteps: 0, unmeasuredSteps: 1 },
    }
    else if (url.endsWith('/analysis')) body = { runId, verdicts: [], sentences: [], clusters: [] }
    else if (url.endsWith('/knowledge')) body = { kind: 'evidence-incomplete', runId }
    else if (url.includes('/execution-logs')) body = { logs: [] }
    else if (/\/api\/runs\/[^/]+$/.test(url)) body = { run: {
      id: url.split('/').at(-1), name: 'Checkout', status: 'passed', platform: 'web', duration: 0,
      attributes: {}, metadata: null, startedAt: null, endedAt: null, createdAt: '2026-09-20',
    } }
    else throw new Error(`Unexpected test request: ${url}`)
    return { ok: true, json: async () => body }
  })
}

async function renderHistorical(id: string = runId, mountKey = id) {
  await act(async () => { root.render(<MemoryRouter key={mountKey} initialEntries={[`/runs/${id}?step=0:0&sub=2`]}>
    <Routes><Route path='/runs/:id' element={<RunDetailPage />} /></Routes>
  </MemoryRouter>) })
}

it('NOTICE-NEUTRAL-STATUS names the missing evidence quietly under the header', async () => {
  historicalPage()
  await renderHistorical()
  const notice = container.querySelector('[data-run-notice]')
  expect(notice).not.toBeNull()
  expect(notice!.getAttribute('role')).toBe('status')
  expect(notice!.className).not.toContain('amber')
  expect(notice!.textContent).toBe(noticeText)
  expect(notice!.querySelector('[aria-label="Dismiss notice"]')).not.toBeNull()
  expect(notice!.previousElementSibling?.querySelector('[aria-label="Keyboard shortcuts"]')).not.toBeNull()
})

it('NOTICE-DISMISS-PER-RUN remembers only a boolean for the dismissed run this session', async () => {
  historicalPage()
  await renderHistorical()
  const dismiss = container.querySelector<HTMLButtonElement>('[data-run-notice] [aria-label="Dismiss notice"]')
  expect(dismiss).not.toBeNull()
  act(() => dismiss!.click())
  expect(container.querySelector('[data-run-notice]')).toBeNull()
  expect(sessionStorage.length).toBe(1)
  expect(sessionStorage.key(0)).toContain(runId)
  expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe('true')
  await renderHistorical(runId, 'remount')
  expect(container.querySelector('[data-run-notice]')).toBeNull()
  await renderHistorical(asRunId(generateRunId()))
  expect(container.querySelector('[data-run-notice]')).not.toBeNull()
})

it('PRE-MILESTONE-RUN-WHOLE retains the ordinal timeline, Video and five unavailable tabs', async () => {
  historicalPage()
  await renderHistorical()
  expect(container.querySelector('[data-run-notice]')?.textContent).toBe(noticeText)
  expect(container.querySelector('[data-timeline-axis]')?.getAttribute('data-timeline-axis')).toBe('ordinal')
  expect(container.querySelector('[data-player-source="frames"]')).not.toBeNull()
  const video = container.querySelector<HTMLButtonElement>('[data-player] [aria-label^="Video"]')!
  expect(video.getAttribute('aria-label')).toContain('unavailable')
  act(() => video.click())
  expect(container.querySelector('[data-evidence-kind="video"][data-evidence-state="unavailable"]')).not.toBeNull()
  for (const [tab, kind] of [['env', 'variables'], ['network', 'network'], ['console', 'console'], ['aria', 'aria'], ['a11y', 'a11y']] as const) {
    const trigger = container.querySelector<HTMLElement>(`[role="tab"][aria-controls$="-${tab}"]`)!
    expect(trigger).not.toBeNull()
    act(() => trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(container.querySelector(`[data-evidence-kind="${kind}"][data-evidence-state="unavailable"]`)).not.toBeNull()
    expect(container.querySelector(`[data-evidence-kind="${kind}"]`)?.textContent).toContain('not recorded')
  }
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/evidence?'))).toBe(false)
})
