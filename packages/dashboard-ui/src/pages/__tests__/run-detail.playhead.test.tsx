// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { asRef, type RunDetailProjection } from '@vostride/agent-qa-schema'
import { routes } from '@/lib/routes'
import RunDetailPage from '@/pages/run-detail'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { detailRead, analysisRead, executionRead } = vi.hoisted(() => ({ detailRead: vi.fn(), analysisRead: vi.fn(), executionRead: vi.fn() }))
vi.mock('@/lib/api', () => ({
  fetchRun: async () => ({ run: { id: 'run-1', name: 'Checkout run', status: 'passed', attributes: {}, platform: 'web' } }),
  fetchRunDetail: detailRead,
  fetchRunAnalysis: analysisRead,
  fetchRunKnowledge: async () => ({ kind: 'evidence-incomplete', runId: '' }),
  fetchExecutionLogs: executionRead,
  fetchRunEvidence: async () => ({ kind: 'failed', error: 'No records in this fixture' }),
  fetchRunArtifact: vi.fn(), triggerRun: vi.fn(), markRun: vi.fn(),
  watchPostProcessing: () => () => {},
}))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
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
  executionRead.mockResolvedValue({ logs: [] })
  analysisRead.mockResolvedValue({ runId: 'run-1', verdicts: [], sentences: [], clusters: [] })
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
  detail.members[0]!.recording = { state: 'present', ref: { id: `recording:${'e'.repeat(64)}`, sha: 'e'.repeat(64) }, durationMs: 10000, contentType: 'video/webm', byteLength: 100 }
  detail.subActions.forEach((sub, index) => { sub.recordingOffsetMs = index * 2000 })
  detailRead.mockResolvedValue(detail)
  return detail
}

function citedProjection(sha = '9'.repeat(64)) {
  const detail = projection()
  detail.members = [...detail.members, { testIndex: 2, name: 'Cited member', attempts: 1,
    recording: { state: 'present', ref: { id: `recording:${'e'.repeat(64)}`, sha: 'e'.repeat(64) },
      durationMs: 10000, contentType: 'video/webm', byteLength: 100 } }]
  detail.steps = [...detail.steps, { ...detail.steps[0]!, testIndex: 2, stepIndex: 3 }]
  detail.subActions = [...detail.subActions, { ...detail.subActions[0]!, testIndex: 2, stepIndex: 3, subActionIndex: 1,
    artifactRefs: [{ id: 'decision-screenshot:cited', sha: '9'.repeat(64) }] }]
  detailRead.mockResolvedValue(detail)
  analysisRead.mockResolvedValue({ runId: 'run-1', clusters: [],
    verdicts: [{ perTest: 0, testId: 't_checkout', class: 'unknown', producer: 'deterministic-classifier', confidence: 0,
      evidence: { citedSteps: [], citedArtifacts: [{ id: 'cited', sha }] } }],
    sentences: [{ perTest: 0, testId: 't_checkout', sentence: 'See screenshot' }],
  })
  return sha
}

it('CITED-JUMPS-PLAYHEAD crosses a hidden member and updates the URL', async () => {
  const sha = citedProjection()
  await render('/runs/run-1?member=0')
  click(`[data-cited-artifact="${sha}"]`)
  expect({ current: current(), query: query().toString(), lightbox: !!document.querySelector('[data-player-lightbox]') }).toEqual({ current: '2:3-1', query: 'step=2%3A3&sub=1', lightbox: false })
  expect(query().get('step')).toBe('2:3')
  expect(query().get('sub')).toBe('1')
  expect(query().has('member')).toBe(false)
  expect(frame()).toBe(routes.runArtifact('run-1', sha))
  expect(document.querySelector('[data-artifact-drawer-tab]')).toBeNull()
})

it('CITED-SWITCHES-TO-FRAMES activates Overview without storing a preference', async () => {
  const sha = citedProjection()
  localStorage.setItem('agent-qa.run-detail.player-source', 'video')
  await render('/runs/run-1?tab=network')
  click(`[data-cited-artifact="${sha}"]`)
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('frames')
  expect(query().has('tab')).toBe(false)
  expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('video')
})

it('CITED-UNMATCHED-OPENS-LIGHTBOX leaves the playhead in place', async () => {
  const sha = citedProjection('8'.repeat(64))
  await render()
  const before = current()
  click(`[data-cited-artifact="${sha}"]`)
  const lightbox = document.querySelector('[data-player-lightbox]')
  expect(lightbox).not.toBeNull()
  expect(lightbox?.textContent).toContain('has no place on the timeline')
  expect(lightbox?.querySelector('img')?.getAttribute('src')).toBe(routes.runArtifact('run-1', sha))
  expect(current()).toBe(before)
  expect(document.querySelector('[data-artifact-drawer-tab]')).toBeNull()
})

it('CITED-LIGHTBOX-FOCUS-RETURNS to the citing button', async () => {
  const sha = citedProjection('8'.repeat(64))
  await render()
  const citation = host.querySelector<HTMLButtonElement>(`[data-cited-artifact="${sha}"]`)!
  act(() => { citation.focus(); citation.click() })
  expect(document.querySelector('[data-player-lightbox]')).not.toBeNull()
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close screenshot"]')!.click() })
  expect(document.querySelector('[data-player-lightbox]')).toBeNull()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.activeElement).toBe(citation)
  const before = current()
  act(() => citation.click())
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(document.querySelector('[data-player-lightbox]')).toBeNull()
  expect(current()).toBe(before)
  expect(document.activeElement).toBe(citation)
})

function press(key: string, target: Element = document.body, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(event))
  return event
}

it.each(['ordinal', 'time'])('KEYS-ARROW-ORDER traverses addresses on the %s axis', async axis => {
  if (axis === 'time') recordedProjection()
  await render()
  child(0)
  for (const address of ['0:0-1', '0:0-2', '0:1-0']) {
    expect(press('ArrowRight').defaultPrevented).toBe(true)
    expect(current()).toBe(address)
  }
  press('ArrowLeft')
  expect(current()).toBe('0:0-2')
  expect(host.querySelector('[data-timeline-axis]')?.getAttribute('data-timeline-axis')).toBe(axis)
})

it('KEYS-ARROW-CROSSES-MEMBER walks into and back from the adjacent member', async () => {
  const detail = projection()
  detail.members = [...detail.members, { testIndex: 1, name: 'Second member', attempts: 1 }]
  detail.steps = [...detail.steps, { ...detail.steps[0]!, testIndex: 1 }]
  detail.subActions = [...detail.subActions, { ...detail.subActions[0]!, testIndex: 1 }]
  detailRead.mockResolvedValue(detail)
  await render()
  child(0, '0:1')
  press('ArrowRight')
  expect(current()).toBe('1:0-0')
  press('ArrowRight')
  expect(current()).toBe('1:0-0')
  press('ArrowLeft')
  expect(current()).toBe('0:1-0')
})

it('KEYS-V-TOGGLES-SOURCE persists only user toggles from any tab', async () => {
  await render()
  press('v')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
  expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('video')
  press('3')
  press('v')
  press('1')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('frames')
  expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('frames')
})

it('KEYS-SPACE-PLAY-PAUSE acts only on a ready Overview video', async () => {
  recordedProjection()
  await render()
  const video = host.querySelector('video')!
  let paused = true
  vi.spyOn(video, 'paused', 'get').mockImplementation(() => paused)
  const play = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; video.dispatchEvent(new Event('play')) })
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; video.dispatchEvent(new Event('pause')) })
  expect(press(' ').defaultPrevented).toBe(false)
  act(() => video.dispatchEvent(new Event('loadedmetadata')))
  expect(press(' ').defaultPrevented).toBe(true)
  expect(play).toHaveBeenCalledTimes(1)
  press(' ')
  expect(pause).toHaveBeenCalledTimes(1)
  press('3')
  expect(press(' ').defaultPrevented).toBe(false)
  press('1')
  press('v')
  expect(press(' ').defaultPrevented).toBe(false)
})

it('KEYS-IGNORED-IN-TABLIST leaves control scopes and editable inputs alone', async () => {
  await render()
  for (const role of ['tablist', 'radiogroup', 'tree', 'dialog']) {
    const control = document.createElement('div')
    control.setAttribute('role', role)
    const target = document.createElement('span')
    control.appendChild(target)
    host.appendChild(control)
    for (const key of ['ArrowLeft', 'ArrowRight', 'v', ' ']) {
      expect(press(key, target).defaultPrevented, `${role}:${key}`).toBe(false)
      expect(current()).toBe('0:0-2')
      expect(localStorage.length).toBe(0)
    }
    control.remove()
  }
  for (const tag of ['input', 'textarea', 'select']) {
    const input = document.createElement(tag)
    host.appendChild(input)
    expect(press('v', input).defaultPrevented).toBe(false)
    expect(press('ArrowRight', input).defaultPrevented).toBe(false)
    input.remove()
  }
  press('ArrowRight')
  expect(current()).toBe('0:1-0')
})

it('KEYS-SPACE-STILL-ACTIVATES-BUTTON leaves native activation uncancelled', async () => {
  recordedProjection()
  await render()
  const video = host.querySelector('video')!
  const play = vi.spyOn(video, 'play').mockResolvedValue()
  act(() => video.dispatchEvent(new Event('loadedmetadata')))
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Play recording"]')!
  for (const key of [' ', 'v', 'ArrowLeft', 'ArrowRight']) {
    expect(press(key, button).defaultPrevented).toBe(false)
  }
  expect(play).not.toHaveBeenCalled()
  act(() => button.click())
  expect(play).toHaveBeenCalledTimes(1)
  press(' ')
  expect(play).toHaveBeenCalledTimes(2)
})

it('KEYS-LEGACY-MAP-UNCHANGED keeps tree navigation, tabs, drawers and escape', async () => {
  await render()
  child(0); expect(current()).toBe('0:0-0')
  press('ArrowDown'); expect(current()).toBe('0:0-1')
  press('k'); expect(current()).toBe('0:0-0')
  press('ArrowUp'); expect(current()).toBe('0:0-0')
  press('ArrowDown', document.body, true); expect(current()).toBe('0:1-0')
  press('ArrowUp', document.body, true); expect(current()).toBe('0:0-2')
  for (const [index, tab] of ['overview', 'env', 'network', 'console', 'aria', 'a11y', 'knowledge'].entries()) {
    press(String(index + 1)); expect(query().get('tab') ?? 'overview').toBe(tab)
  }
  press('m'); expect(query().get('tab')).toBe('knowledge')
  press('i'); expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  press('Escape'); expect(document.querySelector('[role="dialog"]')).toBeNull()
  press('c'); expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  press('Escape')
  press('ArrowRight'); expect(current()).toBe('0:1-0')
})

it('KEYS-LEGEND-LISTS-NEW opens the shipped legend with Shift+?', async () => {
  await render()
  press('?', document.body, true)
  const legend = host.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]')
  expect(legend).not.toBeNull()
  for (const copy of ['← →', 'Previous / next action', 'Space', 'Play / pause', 'V', 'Frames / Video']) {
    expect(legend!.textContent).toContain(copy)
  }
})

it('OVERVIEW-PREVIEW-THEN-FOOTER', async () => {
  await render()
  const player = host.querySelector('[data-player]')
  expect(player).not.toBeNull()
  const preview = player!.querySelector('[data-player-preview]')!
  const footer = player!.querySelector('[data-player-footer]')!
  expect(preview.nextElementSibling).toBe(footer)
  expect(footer.querySelector('[data-timeline]')).not.toBeNull()
  expect(player!.querySelectorAll('[data-timeline]')).toHaveLength(1)
  const reasoning = [...player!.nextElementSibling!.querySelectorAll('button')].find(button => button.textContent?.includes('Reasoning'))
  act(() => reasoning!.click())
  expect(player?.nextElementSibling?.querySelector('[data-sub-action-plan]')?.textContent).toBe('Action 3')
})

it('OVERVIEW-OPENS-ON-VIDEO', async () => {
  for (const timing of ['complete', 'missing-duration', 'missing-offset', 'missing-all'] as const) {
    for (const preference of [null, 'video', 'frames']) {
      act(() => root.unmount())
      root = createRoot(host)
      localStorage.clear()
      if (preference) localStorage.setItem('agent-qa.run-detail.player-source', preference)
      const detail = recordedProjection()
      if (timing === 'missing-duration' || timing === 'missing-all') {
        if (detail.members[0]!.recording?.state === 'present') delete detail.members[0]!.recording.durationMs
      }
      if (timing === 'missing-offset') delete detail.subActions[0]!.recordingOffsetMs
      if (timing === 'missing-all') detail.subActions.forEach(sub => { delete sub.recordingOffsetMs })
      await render('/runs/run-1?step=0%3A0&sub=1')
      const ordinal = timing !== 'complete'
      const source = ordinal || preference === 'frames' ? 'frames' : 'video'
      expect(host.querySelector('[data-player]')?.getAttribute('data-player-source'), `${timing}/${preference}`).toBe(source)
      expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe(preference)
      expect(current()).toBe('0:0-1')
      expect(query().get('sub')).toBe('1')
      if (source === 'video') {
        expect(host.querySelector('[data-player] img')).toBeNull()
        expect(host.querySelector('video')?.autoplay).toBe(false)
      } else {
        expect(frame()).toBe(routes.runArtifact('run-1', shas[1]!))
        expect(host.querySelector('video')).toBeNull()
      }
      if (ordinal) {
        click('[data-slot="toggle-group-item"][aria-label^="Video"]')
        const video = host.querySelector('video')!
        expect(video).not.toBeNull()
        act(() => video.dispatchEvent(new Event('loadedmetadata')))
        expect(video.currentTime).toBe(0)
        expect(host.querySelector('[data-player]')?.textContent).toContain('cannot be synchronized with the selected action')
        child(2)
        expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
        expect(video.currentTime).toBe(0)
        act(() => { video.currentTime = 8; video.dispatchEvent(new Event('timeupdate')) })
        expect(current()).toBe('0:0-2')
        expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('video')
        const frames = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="toggle-group-item"]')]
          .find(button => button.textContent === 'Frames')!
        act(() => frames.click())
        expect(frame()).toBe(routes.runArtifact('run-1', shas[2]!))
      }
    }
  }
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
  expect(current()).toBe('0:0-2')
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
  expect(host.querySelector('[data-player-caption]')?.textContent).toContain('Showing #2 of 3')
})

it('PLAYHEAD-TREE-FOLLOWS', async () => {
  await render()
  expect(current()).toBe('0:0-2')
  expect(host.querySelector('[data-playhead-row]')?.getAttribute('aria-current')).toBe('true')
  expect(host.querySelector('[data-playhead-row] > button')?.className).toContain('ring-inset')
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
  child(0)
  expect(selected()?.getAttribute('data-sub-action-id')).toBe('0:0-0')
  key('j')
  expect(current()).toBe('0:0-1')
  key('k')
  expect(current()).toBe('0:0-0')
})

it('PLAYHEAD-ONE-SELECTION-ONE-BOX', async () => {
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

it('TIMELINE-OVERVIEW-ONLY', async () => {
  await render()
  expect(host.querySelector('[data-overview] [data-timeline]')).not.toBeNull()
  for (let tab = 2; tab <= 7; tab++) {
    key(String(tab))
    expect(host.querySelector('[data-timeline]')).toBeNull()
  }
  key('1')
  expect(host.querySelector('[data-overview] [data-timeline]')).not.toBeNull()
  expect(host.querySelector('[data-timeline]')?.textContent).toBe('')
})

it('EVIDENCE-TAB-COUNTS remain available without timeline signals', async () => {
  const detail = projection()
  detail.steps[1]!.evidence = {
    variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    network: { kind: 'network', state: 'absent', reason: 'not-captured' },
    a11y: { kind: 'a11y', state: 'absent', reason: 'not-captured' },
    console: { kind: 'console', state: 'present', ref: { id: 'console-evidence:errors', sha: shas[0]! }, counts: { total: 2, errors: 2, warnings: 0 } },
  }
  detailRead.mockResolvedValue(detail)
  await render()
  parent('0:1')
  expect(host.querySelector('[data-step-signal]')).toBeNull()
  key('4')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:1')
  expect(current()).toBe('0:1-0')
  expect(query().get('tab')).toBe('console')
})

it('TIMELINE-MEMBER-SWITCH', async () => {
  const detail = recordedProjection()
  delete detail.subActions[0]!.recordingOffsetMs
  detailRead.mockResolvedValue({
    ...detail,
    members: [...detail.members, { testIndex: 3, name: 'Returns', attempts: 1, recording: detail.members[0]!.recording }],
    steps: [...detail.steps, { ...detail.steps[0]!, testIndex: 3 }],
    subActions: [...detail.subActions, ...detail.subActions.slice(0, 2).map(sub => ({ ...sub, testIndex: 3 }))],
  })
  await render()
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('suite')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('frames')
  press('v')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
  parent('3:0')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('frames')
  expect(localStorage.getItem('agent-qa.run-detail.player-source')).toBe('video')
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('suite')
  expect(host.querySelector('[role="slider"]')?.getAttribute('aria-label')).toContain('All tests')
  expect(host.querySelector('[role="slider"]')?.getAttribute('aria-label')).toContain('All tests')
  parent('0:1')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
  act(() => host.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(host.querySelector('[data-timeline]')?.getAttribute('data-timeline-member')).toBe('suite')
  expect(current()).toBe('3:0-0')
  expect(host.querySelector('[data-player]')?.getAttribute('data-player-source')).toBe('video')
  expect(selected()?.getAttribute('data-sub-action-id')).toBe('3:0-0')
})

it('PLAYHEAD-SCRUB-FOLLOWS-TREE-TABS-URL', async () => {
  await render()
  const track = host.querySelector<HTMLElement>('[data-timeline-track]')
  expect(track).not.toBeNull()
  track!.getBoundingClientRect = () => ({ left: 0, width: 400 }) as DOMRect
  track!.setPointerCapture = vi.fn()
  act(() => track!.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 50, bubbles: true })))
  expect(current()).toBe('0:0-0')
  expect(selected()?.getAttribute('data-sub-action-id')).toBe('0:0-0')
  expect(host.querySelectorAll('[role="treeitem"][aria-selected="true"]')).toHaveLength(1)
  expect(host.querySelectorAll('[data-playhead-row]')).toHaveLength(1)
  key('5')
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

it('UP-DOWN-STABLE-ACTION-ORDER crosses steps/members and reverses without parent detours', async () => {
  const detail = projection()
  detail.members = [...detail.members, { testIndex: 1, name: 'Second', attempts: 1 }]
  detail.steps = [...detail.steps, { ...detail.steps[0]!, testIndex: 1 }]
  detail.subActions = [...detail.subActions, ...detail.subActions.slice(0, 2).map(sub => ({ ...sub, testIndex: 1 }))]
  detailRead.mockResolvedValue(detail)
  await render()
  child(0)
  const order = ['0:0-0', '0:0-1', '0:0-2', '0:1-0', '1:0-0', '1:0-1']
  for (const address of order.slice(1)) {
    press('ArrowDown')
    expect(current()).toBe(address)
    expect(selected()?.getAttribute('data-sub-action-id')).toBe(address)
    expect(selected()?.querySelector('button')?.className).toContain('rounded-md')
  }
  press('ArrowDown')
  expect(current()).toBe(order.at(-1))
  for (const address of order.slice(0, -1).reverse()) {
    press('ArrowUp')
    expect(current()).toBe(address)
  }
  press('ArrowUp')
  expect(current()).toBe(order[0])
  press('ArrowDown', document.body, true)
  expect(selected()?.getAttribute('data-step-id')).toBe('0:1')
  press('ArrowUp', document.body, true)
  expect(selected()?.getAttribute('data-step-id')).toBe('0:0')
})

function suiteProjection() {
  const detail = recordedProjection()
  const recording = detail.members[0]!.recording!
  detail.members = [...detail.members, { testIndex: 3, name: 'Second recording', attempts: 1,
    recording: { ...recording, state: 'present', ref: { id: `recording:${'f'.repeat(64)}`, sha: 'f'.repeat(64) },
      durationMs: 20000, contentType: 'video/webm', byteLength: 100 } }]
  detail.steps = [...detail.steps, { ...detail.steps[0]!, testIndex: 3 }]
  detail.subActions = [...detail.subActions, ...detail.subActions.slice(0, 2).map((sub, index) => ({ ...sub, testIndex: 3, recordingOffsetMs: 1000 + index * 4000 }))]
  detailRead.mockResolvedValue(detail)
  return detail
}

it('SUITE-PAGE-SEEK maps global positions to the correct local recording and action', async () => {
  suiteProjection()
  await render()
  expect(host.querySelectorAll('[data-timeline]')).toHaveLength(1)
  expect(host.querySelectorAll('[data-timeline-member-span]')).toHaveLength(2)
  const track = host.querySelector<HTMLElement>('[data-timeline-track]')!
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect)
  track.setPointerCapture = vi.fn()
  act(() => track.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600 })))
  const video = host.querySelector('video')!
  act(() => video.dispatchEvent(new Event('loadedmetadata')))
  expect(video.src).toContain('f'.repeat(64))
  expect(video.currentTime).toBeCloseTo(8)
  expect(current()).toBe('3:0-1')
  expect(query().get('step')).toBe('3:0')
  expect(host.querySelector<HTMLElement>('[data-timeline-playhead]')!.style.left).toBe('60%')
  // Observation updates the pill between markers, never re-issues the 8-second seek.
  act(() => { video.currentTime = 9; video.dispatchEvent(new Event('timeupdate')) })
  expect(parseFloat(host.querySelector<HTMLElement>('[data-timeline-playhead]')!.style.left)).toBeCloseTo(190 / 3)
  expect(video.currentTime).toBe(9)
  expect(host.querySelector('video')).toBe(video)
})

it('SUITE-FILTER limits the combined rail to the displayed member', async () => {
  suiteProjection()
  await render('/runs/run-1?member=3')
  const spans = host.querySelectorAll('[data-timeline-member-span]')
  expect(spans).toHaveLength(1)
  expect(spans[0]!.getAttribute('data-timeline-member-span')).toBe('3')
})

it('UP-DOWN-EMPTY-HOOK-LOG preserves reachable non-action rows and modal/input guards', async () => {
  const detail = projection()
  detail.steps = [...detail.steps, { ...detail.steps[0]!, stepIndex: 2 }]
  detailRead.mockResolvedValue(detail)
  const log = { runId: 'run-1', type: 'hook', name: 'Setup command', status: 'passed', duration: 1,
    stdout: null, stderr: null, returnData: null, variables: null, createdAt: '' }
  executionRead.mockResolvedValue({ logs: [
    { ...log, id: 'setup', stepId: null, phase: 'setup' },
    { ...log, id: 'inline', stepId: '0', phase: 'inline' },
    { ...log, id: 'teardown', stepId: null, phase: 'teardown' },
  ] })
  await render()
  child(0)
  press('ArrowUp')
  expect(selected()?.getAttribute('data-execution-id')).toBe('inline')
  press('ArrowUp')
  expect(selected()?.textContent).toContain('Setup command')
  press('ArrowDown')
  expect(selected()?.getAttribute('data-execution-id')).toBe('inline')
  press('ArrowDown')
  expect(current()).toBe('0:0-0')
  parent('0:1')
  press('ArrowDown')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:2')
  press('ArrowDown')
  expect(selected()?.textContent).toContain('Setup command')
  press('ArrowUp')
  expect(selected()?.getAttribute('data-step-id')).toBe('0:2')
  parent('0:1')
  for (const kind of ['input', 'dialog']) {
    const element = document.createElement(kind === 'input' ? 'input' : 'div')
    if (kind === 'dialog') element.setAttribute('role', 'dialog')
    host.appendChild(element)
    expect(press('ArrowDown', element).defaultPrevented).toBe(false)
    expect(current()).toBe('0:1-0')
    element.remove()
  }
})

it('SUITE-PLAYBACK continues at local zero, then stops at a missing member without skipping it', async () => {
  const detail = suiteProjection()
  detail.members = [...detail.members, { testIndex: 5, name: 'No recording', attempts: 1, recording: { state: 'absent', reason: 'unsupported' } },
    { ...detail.members[1]!, testIndex: 7, name: 'After gap' }]
  detailRead.mockResolvedValue(detail)
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  await render()
  const first = host.querySelector('video')!
  act(() => first.dispatchEvent(new Event('loadedmetadata')))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Play recording"]')!.click())
  act(() => first.dispatchEvent(new Event('ended')))
  const second = host.querySelector('video')!
  expect(second).not.toBe(first)
  expect(second.src).toContain('f'.repeat(64))
  await act(async () => second.dispatchEvent(new Event('loadedmetadata')))
  expect(second.currentTime).toBe(0)
  expect(play).toHaveBeenCalledTimes(2)
  act(() => second.dispatchEvent(new Event('ended')))
  expect(host.querySelector('video')).toBeNull()
  expect(host.querySelector('[data-evidence-kind="video"]')?.getAttribute('data-evidence-state')).toBe('unsupported')
  expect(host.querySelector('[data-timeline-empty-member="5"]')).not.toBeNull()
  expect(host.querySelectorAll('[data-timeline-member-span]')).toHaveLength(4)
  expect(play).toHaveBeenCalledTimes(2)
  vi.restoreAllMocks()
})
