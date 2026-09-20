// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateRunId } from '@vostride/agent-qa-ids'
import { asRunId } from '@vostride/agent-qa-schema'
import type { RunDetailStep, RunsEvidenceResult, StepEvidenceEntries } from '@vostride/agent-qa-schema'
import { TabA11y } from '@/components/run-detail/tab-a11y'
import { fromRunDetailStep } from '@/lib/display-step'
import { EVIDENCE_COPY } from '@/lib/evidence-state-view'
import RunDetailPage from '@/pages/run-detail'

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
function ready(stepIndex = 0, records = [
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
})
async function render(selected = step(), selectedRunId = runId) {
  await act(async () => { root.render(<TabA11y step={selected} runId={selectedRunId} />) })
}

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
  expect(urls.some(url => url.includes('/evidence?'))).toBe(true)
  expect(container.querySelector('[data-a11y-impact="critical"]')).not.toBeNull()
  expect(urls.filter(url => url.endsWith('/access' + 'ibility'))).toEqual([])
})
