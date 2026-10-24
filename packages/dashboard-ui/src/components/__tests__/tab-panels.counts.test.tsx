// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TabPanels } from '../run-detail/tab-panels'
import type { DisplayStep } from '@/lib/display-step'
import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import { EVIDENCE_COPY } from '@/lib/evidence-state-view'

vi.mock('../run-detail/tab-overview', () => ({ TabOverview: () => <div>Overview body</div> }))
vi.mock('../run-detail/tab-env', () => ({ TabEnv: () => <div>Variables body</div> }))
vi.mock('../run-detail/tab-network', () => ({ TabNetwork: () => <div>Network body</div> }))
vi.mock('../run-detail/tab-console', () => ({ TabConsole: () => <div>Console body</div> }))
vi.mock('../run-detail/tab-aria-tree', () => ({ TabAriaTree: () => <div>ARIA body</div> }))
vi.mock('../run-detail/tab-a11y', () => ({ TabA11y: () => <div>A11y body</div> }))
vi.mock('../run-detail/tab-knowledge', () => ({ TabKnowledge: () => <div>Knowledge body</div> }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const sha = 'a'.repeat(64)
const subAction = {
  testIndex: 0, stepIndex: 1, subActionIndex: 1,
  plan: 'Open page', plannedAction: { type: 'navigate', to: 'url', url: 'https://example.com' },
  result: { success: true }, screenStateHash: sha,
  ariaEvidence: { kind: 'aria', state: 'absent', reason: 'not-captured' },
} satisfies RunDetailSubAction
function step(): DisplayStep {
  return {
    id: '0:1', name: 'Open page', status: 'passed', duration: 1,
    testIndex: 0, stepIndex: 1, stepOrder: 1, rawStepOrder: 1,
    displayStepOrder: 2, displayStepTotal: 3,
    subActions: [{ ...subAction, subActionIndex: 0 }, subAction],
    evidence: {
      console: { kind: 'console', state: 'present', ref: { id: `console-evidence:${sha}`, sha }, counts: { total: 4, errors: 2, warnings: 0 } },
      network: { kind: 'network', state: 'absent', reason: 'not-captured' },
      variables: { kind: 'variables', state: 'present', counts: { count: 6 } },
      a11y: { kind: 'a11y', state: 'present', ref: { id: `a11y-evidence:${sha}`, sha }, counts: { minor: 1, moderate: 0, serious: 0, critical: 0 } },
    },
  }
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function Panels(props: Partial<ComponentProps<typeof TabPanels>>) {
  const [tab, setTab] = useState('overview')
  return <TabPanels activeTab={tab} onTabChange={setTab} step={step()} subAction={subAction} runId={null} allSteps={[]} {...props} />
}
async function render(props: Partial<ComponentProps<typeof TabPanels>> = {}) {
  await act(async () => root.render(<Panels {...props} />))
}
function trigger(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find(node => node.textContent?.startsWith(label))!
}
async function select(label: string) {
  await act(async () => trigger(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

test('STRIP-PROBLEM-LOUD-TOTAL-QUIET', async () => {
  await render()
  const problem = trigger('Console').querySelector('[data-tab-count-kind="problem"]')
  expect(problem?.getAttribute('data-tab-count')).toBe('2')
  expect(problem?.className).toContain('text-red-500')
  expect(problem?.querySelector('svg')).not.toBeNull()
  expect(trigger('Console').getAttribute('aria-label')).toBe('Console, 2 errors')
  const total = trigger('Variables').querySelector('[data-tab-count-kind="total"]')
  expect(total?.getAttribute('data-tab-count')).toBe('6')
  expect(total?.className).toContain('text-muted-foreground')
  expect(total?.querySelector('svg')).toBeNull()
  expect(trigger('A11y').querySelector('[data-tab-count-kind="problem"]')?.className).toContain('text-amber-500')
  for (const impact of ['minor', 'moderate', 'serious', 'critical'] as const) {
    const selected = step()
    const a11y = selected.evidence!.a11y
    if (a11y.state !== 'present') throw new Error('Expected present fixture')
    a11y.counts = { minor: 0, moderate: 0, serious: 0, critical: 0, [impact]: 2 }
    await render({ step: selected })
    const badge = trigger('A11y').querySelector('[data-tab-count-kind="problem"]')!
    expect(badge.getAttribute('data-tab-count')).toBe('2')
    expect(badge.className).toContain(impact === 'minor' || impact === 'moderate' ? 'text-amber-500' : 'text-red-500')
  }
})

test('STRIP-ABSENT-DIMMED-CLICKABLE', async () => {
  await render()
  const network = trigger('Network')
  expect(network.getAttribute('aria-label')).toBe(`Network — ${EVIDENCE_COPY.network['not-captured'].title}`)
  expect(network.querySelector('[data-tab-count]')).toBeNull()
  expect(network.className).toContain('opacity-60')
  expect(network.className).toContain('data-[state=active]:opacity-100')
  expect(network.disabled).toBe(false)
  await act(async () => network.focus())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(network.getAttribute('aria-label'))
  await select('Network')
  expect(network.getAttribute('aria-selected')).toBe('true')
  expect(container.querySelector('[role="tabpanel"][data-state="active"]')?.textContent).toContain('Network body')
})

test('SCOPE-LINE-STEP-VS-SUB-ACTION', async () => {
  await render()
  for (const label of ['Network', 'Variables', 'Console', 'A11y']) {
    await select(label)
    const scope = container.querySelector('[data-evidence-scope]')
    expect(scope?.getAttribute('data-evidence-scope')).toBe('step')
    expect(scope?.textContent).toBe('Step 2 of 3 · whole step')
    expect(scope?.className).toContain('tabular-nums')
  }
  for (const label of ['ARIA Tree']) {
    await select(label)
    expect(container.querySelector('[data-evidence-scope="sub-action"]')?.textContent).toBe('Sub-action #2 of 2 · step 2')
  }
  await select('Overview')
  expect(container.querySelector('[data-evidence-scope]')).toBeNull()
  await render({ step: null, subAction: null })
  expect(container.querySelector('[data-evidence-scope]')).toBeNull()
})

test('STRIP-COUNTS-FOLLOW-STEP keeps sub-action changes stable and never accumulates', async () => {
  const selected = step()
  await render({ step: selected })
  expect(trigger('Variables').getAttribute('aria-label')).toBe('Variables, 6')
  await render({ step: selected, subAction: { ...subAction, subActionIndex: 0 } })
  expect(trigger('Variables').getAttribute('aria-label')).toBe('Variables, 6')
  const next = step()
  next.evidence!.variables = { kind: 'variables', state: 'present', counts: { count: 1 } }
  await render({ step: next })
  expect(trigger('Variables').getAttribute('aria-label')).toBe('Variables, 1')
  next.evidence!.variables = { kind: 'variables', state: 'absent', reason: 'empty' }
  await render({ step: next })
  expect(trigger('Variables').querySelector('[data-tab-count]')).toBeNull()
})

test('STRIP-HOOK-STDOUT keeps hook output free of durable-step counts and scope', async () => {
  await render({ executionLogs: [{ type: 'hook', name: 'setup', status: 'passed' } as NonNullable<ComponentProps<typeof TabPanels>['executionLogs']>[number]] })
  expect(trigger('stdout').textContent).toBe('stdout')
  expect(trigger('stdout').getAttribute('aria-label')).toBeNull()
  expect(container.querySelector('[data-evidence-scope]')).toBeNull()
})
