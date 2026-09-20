// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { asRef, type RunDetailProjection } from '@vostride/agent-qa-schema'
import { routes } from '@/lib/routes'
import RunDetailPage from '@/pages/run-detail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { detailRead } = vi.hoisted(() => ({ detailRead: vi.fn() }))
vi.mock('@/lib/api', () => ({
  fetchRun: async () => ({ run: { id: 'run-1', name: 'Checkout run', status: 'passed', attributes: {}, platform: 'web' } }),
  fetchRunDetail: detailRead,
  fetchRunAnalysis: async () => ({ runId: '', verdicts: [], sentences: [], clusters: [] }),
  fetchRunKnowledge: async () => ({ kind: 'evidence-incomplete', runId: '' }),
  fetchExecutionLogs: async () => ({ logs: [] }),
  fetchRunEvidence: async () => ({ kind: 'failed', error: 'No records in this fixture' }),
  fetchRunArtifact: vi.fn(), triggerRun: vi.fn(), markRun: vi.fn(),
  watchPostProcessing: () => () => {},
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/run-detail/run-navbar', () => ({ RunNavbar: () => <header>Run</header> }))
vi.mock('@/components/screenshot-viewer', () => ({ ScreenshotViewer: ({ src }: { src: string }) => <img data-frame src={src} /> }))
vi.mock('@/components/run-detail/tab-aria-tree', () => ({
  TabAriaTree: ({ subAction }: { subAction?: { subActionIndex: number } }) => <div data-aria-sub={subAction?.subActionIndex} />,
}))
vi.mock('@/components/run-detail/tab-network', () => ({
  TabNetwork: ({ step }: { step?: { id: string } }) => <div data-network-step={step?.id} />,
}))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}))
vi.mock('@/components/ui/scroll-area', () => ({ ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div> }))

const shas = ['a', 'b', 'c', 'd'].map(char => char.repeat(64))
function projection(): RunDetailProjection {
  return {
    runId: 'run-1',
    members: [{ testIndex: 0, name: 'Checkout', attempts: 1 }],
    steps: [0, 1].map(stepIndex => ({
      testIndex: 0, stepIndex, stepText: `Step ${stepIndex + 1}`, cacheStatus: 'miss',
      verifierVerdict: { pass: true, reasoning: 'Complete' }, selfHealOccurred: false, briefDigest: 'digest', status: 'passed',
    })),
    subActions: [0, 1, 2, 3].map(index => ({
      testIndex: 0, stepIndex: index === 3 ? 1 : 0, subActionIndex: index === 3 ? 0 : index,
      plan: `Action ${index + 1}`, plannedAction: { type: 'click', ref: asRef(`button-${index}`) },
      screenStateHash: 'f'.repeat(64),
      result: { success: true }, artifactRefs: [{ id: `decision-screenshot:${shas[index]}`, sha: shas[index]! }],
    })),
    tokens: { measuredSteps: 0, unmeasuredSteps: 2 },
  }
}

function LocationProbe() {
  const location = useLocation()
  const type = useNavigationType()
  return <output data-location={location.search} data-navigation={type} />
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear()
  detailRead.mockResolvedValue(projection())
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
async function render(url = '/runs/run-1') {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[url]}><LocationProbe /><Routes>
      <Route path='/runs/:id' element={<RunDetailPage />} />
    </Routes></MemoryRouter>)
  })
}
function click(selector: string) {
  const element = host.querySelector<HTMLElement>(selector)
  expect(element, selector).not.toBeNull()
  act(() => element!.click())
}
function key(key: string) {
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}
function parent(step = '0:0') { click(`[data-step-id="${step}"] > button`) }
function child(index: number, step = '0:0') { click(`[data-sub-action-id="${step}-${index}"] > button`) }
function current() { return host.querySelector('[data-playhead-row]')?.getAttribute('data-sub-action-id') }
function selected() { return host.querySelector('[role="treeitem"][aria-selected="true"]') }
function query() { return new URLSearchParams(host.querySelector('[data-location]')?.getAttribute('data-location') ?? '') }
function frame() { return host.querySelector('[data-frame]')?.getAttribute('src') }

function recordedProjection() {
  const detail = projection()
  detail.members[0]!.recording = { state: 'present', ref: { id: 'recording', sha: 'e'.repeat(64) }, durationMs: 10000 }
  detail.subActions.forEach((sub, index) => { sub.recordingOffsetMs = index * 2000 })
  detailRead.mockResolvedValue(detail)
}

it('OVERVIEW-PLAYER-FIRST-BLOCK', async () => {
  await render()
  const player = host.querySelector('[data-player]')
  expect(player).not.toBeNull()
  expect(player?.previousElementSibling).toBeNull()
  expect(player?.nextElementSibling?.querySelector('[data-sub-action-plan]')?.textContent).toBe('Action 3')
})

it('OVERVIEW-OPENS-ON-VIDEO', async () => {
  recordedProjection()
  await render()
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
  expect(host.querySelector('[data-player] img')).toBeNull()
  expect(host.querySelector('video')?.autoplay).toBe(false)
  expect(localStorage.length).toBe(0)
})

it('OVERVIEW-FRAMES-TOGGLE-SHOWS-FRAME', async () => {
  recordedProjection()
  await render()
  const frames = [...host.querySelectorAll<HTMLButtonElement>('[data-player] button')].find(button => button.textContent === 'Frames')
  expect(frames).toBeDefined()
  act(() => frames!.click())
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('frames')
  expect(host.querySelector('[data-artifact-state="available"] img')?.getAttribute('src')).toBe(routes.runArtifact('run-1', shas[2]!))
  expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('frames')
})

it('OVERVIEW-SEEK-REACHES-PLAYER', async () => {
  recordedProjection()
  await render()
  const video = host.querySelector('video')
  expect(video).not.toBeNull()
  act(() => video!.dispatchEvent(new Event('loadedmetadata')))
  expect(video!.currentTime).toBe(4)
  const track = host.querySelector<HTMLElement>('[data-timeline-track]')!
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
  track.setPointerCapture = vi.fn()
  act(() => track.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 750 })))
  expect(video!.currentTime).toBe(7.5)
})

it('PLAYHEAD-PARENT-PARKS-LATEST-FRAME', async () => {
  await render()
  parent()
  expect(frame()).toBe(routes.runArtifact('run-1', shas[2]!))
  expect(selected()?.getAttribute('data-step-id')).toBe('0:0')
  expect(host.querySelector('[data-sub-action-id][aria-selected="true"]')).toBeNull()
})

it('PLAYHEAD-PARENT-SUBSTITUTED', async () => {
  const detail = projection()
  detail.subActions[2]!.artifactRefs![0]!.evidenceIncomplete = true
  detailRead.mockResolvedValue(detail)
  await render()
  expect(frame()).toBe(routes.runArtifact('run-1', shas[1]!))
  expect(current()).toBe('0:0-1')
})

it('PLAYHEAD-TREE-FOLLOWS', async () => {
  await render()
  expect(current()).toBe('0:0-2')
  expect(host.querySelector('[data-playhead-row]')?.getAttribute('aria-current')).toBe('true')
  expect(host.querySelector('[data-playhead-row] .bg-primary.w-0\\.5')).not.toBeNull()
})

it('PLAYHEAD-TREE-MOVES-PLAYHEAD', async () => {
  await render()
  child(0)
  expect(current()).toBe('0:0-0')
  expect(frame()).toBe(routes.runArtifact('run-1', shas[0]!))
  parent('0:1')
  expect(current()).toBe('0:1-0')
  expect(frame()).toBe(routes.runArtifact('run-1', shas[3]!))
})

it('PLAYHEAD-JK-MOVES-PLAYHEAD', async () => {
  await render()
  key('j')
  expect(current()).toBe('0:0-0')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:0')
  key('j')
  expect(current()).toBe('0:0-1')
  key('k')
  expect(current()).toBe('0:0-0')
})

it('PLAYHEAD-ONE-RING-ONE-BAR', async () => {
  await render()
  for (const move of [() => child(0), () => parent(), () => key('j'), () => parent('0:1')]) {
    move()
    expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-playhead-row]')).toHaveLength(1)
  }
  child(0, '0:1')
  expect(selected()).toBe(host.querySelector('[data-playhead-row]'))
})

it('PLAYHEAD-DRIVES-TABS', async () => {
  await render()
  key('5')
  expect(host.querySelector('[data-aria-sub]')?.getAttribute('data-aria-sub')).toBe('2')
  key('3')
  expect(host.querySelector('[data-network-step]')?.getAttribute('data-network-step')).toBe('0:0')
  child(0)
  expect(host.querySelector('[data-network-step]')?.getAttribute('data-network-step')).toBe('0:0')
  key('5')
  expect(host.querySelector('[data-aria-sub]')?.getAttribute('data-aria-sub')).toBe('0')
})

it('PLAYHEAD-URL-REPLACE', async () => {
  await render()
  parent()
  key('4')
  expect(query().get('sub')).toBe('2')
  expect(query().get('step')).toBe('0:0')
  expect(query().get('tab')).toBe('console')
  expect(host.querySelector('[data-navigation]')?.getAttribute('data-navigation')).toBe('REPLACE')
})

it('PLAYHEAD-URL-RESTORE', async () => {
  await render('/runs/run-1?step=0:0&sub=1&tab=aria')
  expect(current()).toBe('0:0-1')
  expect(host.querySelector('[data-aria-sub]')?.getAttribute('data-aria-sub')).toBe('1')
  expect(query().get('sub')).toBe('1')
})

it.each(['1junk', '-1', '99', '9007199254740992', 'NaN', ''])('PLAYHEAD-URL-MALFORMED: %s', async sub => {
  await render(`/runs/run-1?step=0:0&sub=${sub}`)
  expect(host.querySelector('[data-sub-action-id][aria-selected="true"]')).toBeNull()
  expect(host.querySelector('[data-playhead-row]')).toBeNull()
  expect(frame()).toBeUndefined()
  expect(query().has('sub')).toBe(false)
})

it('TIMELINE-VISIBLE-EVERY-TAB', async () => {
  await render()
  for (let tab = 1; tab <= 7; tab++) {
    key(String(tab))
    const timeline = host.querySelector('[data-timeline]')
    expect(timeline).not.toBeNull()
    expect(timeline!.compareDocumentPosition(host.querySelector('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  expect(host.querySelector('[data-timeline]')?.textContent).not.toContain('Checkout')
})

it('TIMELINE-BADGE-OPENS-TAB', async () => {
  const detail = projection()
  detail.steps[1]!.evidence = {
    variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    network: { kind: 'network', state: 'absent', reason: 'not-captured' },
    a11y: { kind: 'a11y', state: 'absent', reason: 'not-captured' },
    console: { kind: 'console', state: 'present', ref: { id: 'console-evidence:errors', sha: shas[0]! }, counts: { total: 2, errors: 2, warnings: 0 } },
  }
  detailRead.mockResolvedValue(detail)
  await render()
  click('[data-timeline] [data-step-signal="console"]')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:1')
  expect(current()).toBe('0:1-0')
  expect(host.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain('Console')
  expect(query().get('tab')).toBe('console')
})

it('TIMELINE-MEMBER-SWITCH', async () => {
  const detail = projection()
  detailRead.mockResolvedValue({
    ...detail,
    members: [...detail.members, { testIndex: 3, name: 'Returns', attempts: 1 }],
    steps: [...detail.steps, { ...detail.steps[0]!, testIndex: 3 }],
    subActions: [...detail.subActions, ...detail.subActions.slice(0, 2).map(sub => ({ ...sub, testIndex: 3 }))],
  })
  await render()
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('0')
  parent('3:0')
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('3')
  expect(host.querySelector('[data-timeline]')?.textContent).toContain('#3')
  expect(host.querySelector('[data-timeline]')?.textContent).toContain('Returns')
  parent('0:1')
  act(() => host.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('3')
  expect(current()).toBe('3:0-0')
  expect(selected()?.getAttribute('data-step-id')).toBe('3:0')
})

it('PLAYHEAD-SCRUB-FOLLOWS-TREE-TABS-URL', async () => {
  await render()
  const track = host.querySelector<HTMLElement>('[data-timeline-track]')
  expect(track).not.toBeNull()
  track!.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect
  track!.setPointerCapture = vi.fn()
  key('5')
  act(() => track!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 50, bubbles: true })))
  expect(current()).toBe('0:0-0')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:0')
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(1)
  expect(host.querySelectorAll('[data-playhead-row]')).toHaveLength(1)
  expect(host.querySelector('[data-aria-sub]')?.getAttribute('data-aria-sub')).toBe('0')
  expect(query().get('sub')).toBe('0')
  expect(query().get('tab')).toBe('aria')
  key('1')
  expect(frame()).toBe(routes.runArtifact('run-1', shas[0]!))
})

it('TIMELINE-FAILED-DETAIL-REPLACES-PANEL', async () => {
  detailRead.mockRejectedValue(new Error('Read failed'))
  await render()
  expect(host.querySelector('[data-timeline]')).toBeNull()
  expect(host.querySelector('[role="tablist"]')).toBeNull()
  expect(host.querySelector('[data-run-detail-error]')).not.toBeNull()
})
