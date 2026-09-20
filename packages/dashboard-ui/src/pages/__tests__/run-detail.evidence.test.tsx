// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateRunId } from '@vostride/agent-qa-ids'
import type { RunDetailStep, RunsEvidenceResult, StepEvidenceEntries } from '@vostride/agent-qa-schema'
import { TabA11y } from '@/components/run-detail/tab-a11y'
import { fromRunDetailStep } from '@/lib/display-step'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runId = generateRunId()
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
