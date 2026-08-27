// @vitest-environment jsdom

// THE EDITOR'S RUN PANEL ON THE RUN-STREAM WIRE (405-03 · D-19).
//
// This panel was the last UI client of the legacy `/api/execution/events` projection. These cells
// bind it to the SAME wire `pages/live-run.tsx` reads: `openRunStream` frames folded through
// `reduceRunStream`. `openRunStream` is MOCKED here (unlike the live-run suite, which stubs
// `EventSource` to observe the door's URL) because what is under test is the panel's use of the
// stream — one source per run id, closed on teardown — not the door's URL composition, which the
// 403 `api.run-stream` suite already binds.
//
// THE LAST CELL IS THE RETIREMENT'S OWN. A panel that fell back to constructing its own
// `EventSource` against the retired feed would satisfy every other cell here, so the retirement is
// asserted directly: zero constructions of a URL naming the legacy path.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RunResultsPanel } from '@/components/run-results-panel'
import type { RunStreamOptions } from '@/lib/api'

import type { RunEventEnvelope, RunEventPayload, RunEventType } from '@vostride/agent-qa-schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RUN_ID = 'run-1'
const LEGACY_FEED_PATH = '/api/execution/events'

const { optionsRef, closeMock, openRunStreamMock } = vi.hoisted(() => ({
  optionsRef: { current: null as null | RunStreamOptions },
  closeMock: vi.fn(),
  openRunStreamMock: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    openRunStream: openRunStreamMock,
  }
})
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))
vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
let nextSeq = 1

function envelope(type: RunEventType, payload: unknown): RunEventEnvelope {
  return {
    seq: nextSeq++,
    ts: Date.now(),
    runId: RUN_ID,
    type,
    payload: payload as RunEventPayload,
  }
}

const stepStarted = (stepText: string, testIndex = 0, stepIndex = 0) =>
  envelope('stepStarted', { testIndex, stepIndex, stepText })

const stepFinalized = (extra: Record<string, unknown>, testIndex = 0, stepIndex = 0) =>
  envelope('stepFinalized', {
    testIndex,
    stepIndex,
    cacheStatus: 'miss',
    selfHealOccurred: false,
    briefDigest: 'd',
    ...extra,
  })

const verdict = (word: string) => envelope('verdict', { verdict: word })
const runFinished = () => envelope('runFinished', {})

function feed(...envelopes: RunEventEnvelope[]) {
  act(() => {
    for (const each of envelopes) {
      optionsRef.current?.onEvent?.(each)
      if (each.type === 'runFinished') optionsRef.current?.onFinished?.(each)
    }
  })
}

async function renderPanel(runId: string | null = RUN_ID) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(<RunResultsPanel runId={runId} onClose={() => {}} />)
  })

  return container
}

beforeEach(() => {
  nextSeq = 1
  optionsRef.current = null
  closeMock.mockReset()
  openRunStreamMock.mockReset()
  openRunStreamMock.mockImplementation((_runId: string, options: RunStreamOptions) => {
    optionsRef.current = options
    return { close: closeMock } as unknown as EventSource
  })
})

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('RunResultsPanel on the run stream', () => {
  it('opens exactly one run stream per mounted run id and closes it on teardown', async () => {
    await renderPanel()

    expect(openRunStreamMock).toHaveBeenCalledTimes(1)
    expect(openRunStreamMock.mock.calls[0]?.[0]).toBe(RUN_ID)

    act(() => root!.unmount())
    root = null

    expect(closeMock).toHaveBeenCalledTimes(1)
  })

  it('renders a running row from stepStarted and finalizes it from stepFinalized', async () => {
    const view = await renderPanel()

    feed(stepStarted('Open the page'))
    expect(view.textContent).toContain('Open the page')
    expect(view.querySelectorAll('[data-step-status="running"]')).toHaveLength(1)

    feed(stepFinalized({ status: 'passed', durationMs: 1200 }))
    expect(view.querySelectorAll('[data-step-status="passed"]')).toHaveLength(1)
    expect(view.textContent).toContain('1.2s')
  })

  it('renders the terminal badge from the verdict and marks still-running rows', async () => {
    const passing = await renderPanel()
    feed(stepStarted('Open the page'), stepFinalized({ status: 'passed', durationMs: 5 }), verdict('passed'), runFinished())
    expect(passing.textContent).toContain('Passed')
    expect(passing.textContent).not.toContain('Failed')

    act(() => root!.unmount())
    root = null
    container?.remove()

    const failing = await renderPanel()
    feed(stepStarted('Open the page'), verdict('failed'), runFinished())
    expect(failing.textContent).toContain('Failed')
    // The row never finalized on its own; the run's ending is what settles it.
    expect(failing.querySelectorAll('[data-step-status="failed"]')).toHaveLength(1)
  })

  it('renders the error posture when the stream errors before any envelope', async () => {
    const view = await renderPanel()

    act(() => {
      optionsRef.current?.onError?.(new Event('error'), { readyState: 2 } as EventSource)
    })

    expect(view.textContent).toContain('Failed')
    expect(view.textContent).not.toContain('Waiting for events')
  })

  it('never constructs an EventSource against the retired execution-events feed', async () => {
    const constructed: string[] = []
    class RecordingEventSource {
      constructor(url: string) { constructed.push(url) }
      addEventListener() {}
      close() {}
      readyState = 0
    }
    vi.stubGlobal('EventSource', RecordingEventSource)

    const view = await renderPanel()
    feed(stepStarted('Open the page'), verdict('passed'), runFinished())

    expect(view.textContent).toContain('Open the page')
    expect(constructed.filter((url) => url.includes(LEGACY_FEED_PATH))).toHaveLength(0)
  })
})
