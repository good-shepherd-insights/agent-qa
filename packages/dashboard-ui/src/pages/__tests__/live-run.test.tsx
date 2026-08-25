// @vitest-environment jsdom

// THE HONEST RUN-TIME SURFACE, IN A DOM (403-05 · HNST-01/02/03, LIVE-04, D-08/D-12/D-13/D-15).
//
// WHY THESE CELLS ASSERT ON `outerHTML` AND NOT ON VISIBLE TEXT. The claim HNST-01 makes is that
// nothing provisional is REACHABLE — not that nothing provisional is legible. A `title=`, an
// `aria-label`, a `data-` attribute or a `hidden` node would each satisfy "no visible text" while
// putting the model's half-finished intent one devtools click (or one screen reader) away. 403-04
// measured the same shape one layer down and found that TypeScript does not help here: the spread
// that would leak those five fields has the target type as its declared type, so excess-property
// checking never fires. The sentinels below are the same constants the reducer suite feeds, so a
// feed and an assertion cannot drift apart.
//
// WHY EVERY CLOCK IS FAKE. The pill's window is 20 s, the running row shows elapsed time and the
// preview re-mints at half its TTL. Every one of those is a cell whose verdict would otherwise
// depend on real elapsed time — the flake shape 403-03 measured, which reads exactly like a real
// defect when it fires.
//
// WHY THE PILL CELLS RUN k=5. The three liveness claims are the ones a scheduler hiccup could make
// pass once. Fresh mount per iteration, so nothing carries across.
//
// `openRunStream` IS NOT MOCKED. It composes the door's URL and enumerates the bus's event names
// from the schema; mocking it would replace the very contract these cells exist to bind. What is
// stubbed is `EventSource` itself — the browser primitive — so the URL the page asks for is the
// observable.

import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LiveRunPage from '@/pages/live-run'
import { NO_STREAM_RETRY_MS, NO_STREAM_TEXT } from '@/components/live-run/preview-pane'
import { STEPS_EMPTY_TEXT } from '@/components/live-run/step-list'
import { DID_NOT_RUN_NOTE } from '@/lib/run-stream-reducer'

import type { RunEventEnvelope, RunEventPayload, RunEventType } from '@vostride/agent-qa-schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * THE SAME TWO STRINGS THE 403-04 REDUCER SUITE FEEDS. One constant per sentinel, used for both
 * the feed and the assertion, so no edit can quietly make the cell hunt for a string nothing
 * produces — a sentinel cell that looks for the wrong needle is green forever.
 */
const SENTINEL_REASONING = 'SENTINEL-REASONING-7f3a'
const SENTINEL_ACTION = 'SENTINEL-ACTION-9c1e'

const RUN_ID = 'r1'
const BASE_TIME = 1_700_000_000_000
const TTL_MS = 300_000

/** `EventSource.readyState`, restated for a double that has no browser behind it. */
const CONNECTING = 0
const OPEN = 1
const CLOSED = 2

const {
  cancelRunMock,
  classifyRunStreamCloseMock,
  fetchLiveUrlMock,
  fetchRunMock,
  navigateMock,
} = vi.hoisted(() => ({
  cancelRunMock: vi.fn(),
  classifyRunStreamCloseMock: vi.fn(),
  fetchLiveUrlMock: vi.fn(),
  fetchRunMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('@/lib/api', async () => {
  // The ACTUAL module is spread so `openRunStream` and `RUN_EVENT_TYPES` stay real: the URL the
  // page asks for and the event names it listens on are the contract under test, not scaffolding.
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    cancelRun: cancelRunMock,
    classifyRunStreamClose: classifyRunStreamCloseMock,
    fetchLiveUrl: fetchLiveUrlMock,
    fetchRun: fetchRunMock,
  }
})
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useNavigate: () => navigateMock }
})
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}))

/** The browser primitive, doubled: constructed URLs recorded, every dispatch driven by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  readyState = CONNECTING
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(handler)
    this.listeners.set(type, existing)
  }

  removeEventListener(type: string, handler: (event: Event) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler))
  }

  close(): void {
    this.closed = true
    this.readyState = CLOSED
  }

  private dispatch(type: string, event: Event): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event)
  }

  /** The socket came up. Tracked so "open and silent" is a state the page can be in. */
  open(): void {
    this.readyState = OPEN
    this.dispatch('open', new Event('open'))
  }

  emit(envelope: RunEventEnvelope): void {
    this.readyState = OPEN
    this.dispatch(
      envelope.type,
      new MessageEvent(envelope.type, { data: JSON.stringify(envelope), lastEventId: String(envelope.seq) }),
    )
  }

  /** The ONE thing a browser tells a page about any refusal: a bare, wordless error. */
  fail(readyState: number): void {
    this.readyState = readyState
    this.dispatch('error', new Event('error'))
  }
}

const sources = () => FakeEventSource.instances
const latest = (): FakeEventSource => {
  const one = FakeEventSource.instances.at(-1)
  if (one === undefined) throw new Error('no EventSource was constructed')
  return one
}

let nextSeq = 1

function envelope(type: RunEventType, payload: unknown, seq?: number): RunEventEnvelope {
  const resolved = seq ?? nextSeq
  nextSeq = Math.max(nextSeq, resolved) + 1
  return { seq: resolved, ts: Date.now(), runId: RUN_ID, type, payload: payload as RunEventPayload }
}

const runStarted = (handles?: readonly number[]) =>
  envelope('runStarted', {
    busSchemaVersion: 1,
    scope: { kind: 'suite', id: 's' },
    executionContext: 'local',
    buildOrdinal: 1,
    ...(handles === undefined ? {} : { handles: [...handles] }),
  })

const testStarted = (testIndex = 0, name = 'the member', totalSteps?: number) =>
  envelope('testStarted', { testId: `t${String(testIndex)}`, testIndex, name, totalSteps })

const stepStarted = (testIndex = 0, stepIndex = 0, stepText = 'open the page') =>
  envelope('stepStarted', { testIndex, stepIndex, stepText })

const stepFinalized = (testIndex = 0, stepIndex = 0, extra: Record<string, unknown> = {}) =>
  envelope('stepFinalized', {
    testIndex,
    stepIndex,
    cacheStatus: 'miss',
    verifierVerdict: { pass: true, reasoning: SENTINEL_REASONING },
    selfHealOccurred: false,
    briefDigest: 'd',
    durationMs: 1200,
    ...extra,
  })

/**
 * A `subActionRecorded` carrying the forbidden fields a real producer emits — the agent's plan,
 * the action it intends, its candidate targets and the result it has not verified.
 */
const subActionRecorded = (testIndex = 0, stepIndex = 0, subActionIndex = 0) =>
  envelope('subActionRecorded', {
    testIndex,
    stepIndex,
    subActionIndex,
    plan: SENTINEL_REASONING,
    plannedAction: { type: SENTINEL_ACTION, kind: 'click', target: { descriptor: SENTINEL_REASONING } },
    grounding: { candidates: [{ reasoning: SENTINEL_REASONING }] },
    result: { status: 'success', detail: SENTINEL_REASONING },
    screenStateHash: 'h1',
  })

const testFinished = (testIndex = 0, outcome = 'failed') =>
  envelope('testFinished', { testId: `t${String(testIndex)}`, testIndex, outcome, durationMs: 10 })

const heartbeat = () => envelope('heartbeat', {})
const verdict = (word = 'passed') => envelope('verdict', { verdict: word })
const runFinished = () => envelope('runFinished', { status: 'passed', durationMs: 100 })

let observedPath = ''

function LocationProbe() {
  const location = useLocation()
  useEffect(() => {
    observedPath = location.pathname
  }, [location.pathname])
  return null
}

let host: { container: HTMLDivElement; root: Root } | undefined

function unmountHost(): void {
  if (host === undefined) return
  const current = host
  host = undefined
  act(() => { current.root.unmount() })
  current.container.remove()
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

async function mount(runId = RUN_ID): Promise<void> {
  unmountHost()
  FakeEventSource.instances = []
  nextSeq = 1
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  host = { container, root }
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/runs/${runId}/live`]}>
        <Routes>
          <Route
            path="/runs/:id/live"
            element={
              <>
                <LiveRunPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/runs/:id" element={<div data-run-detail-page />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function emit(...envelopes: readonly RunEventEnvelope[]): Promise<void> {
  const source = latest()
  await act(async () => {
    for (const one of envelopes) source.emit(one)
    await Promise.resolve()
  })
}

async function open(): Promise<void> {
  const source = latest()
  await act(async () => { source.open() })
}

async function fail(readyState: number): Promise<void> {
  const source = latest()
  await act(async () => {
    source.fail(readyState)
    await Promise.resolve()
  })
  await flush()
}

const q = (selector: string) => document.querySelector(selector)
const qa = (selector: string) => [...document.querySelectorAll(selector)]
const stepsPane = (): Element => {
  const pane = q('[data-live-pane="steps"]')
  if (pane === null) throw new Error('the steps pane does not exist')
  return pane
}
const livenessWord = () => q('[data-liveness]')?.getAttribute('data-liveness')
const lastActivitySeconds = () => Number(q('[data-liveness]')?.getAttribute('data-last-activity'))
const previewState = () => q('[data-preview-state]')?.getAttribute('data-preview-state')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_TIME)
  FakeEventSource.instances = []
  ;(globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource
  observedPath = ''
  fetchRunMock.mockResolvedValue({
    run: { id: RUN_ID, name: 'a run', status: 'running', filePath: 'tests/a.yaml' },
    steps: [],
    tests: [],
  })
  fetchLiveUrlMock.mockImplementation(async (_runId: string, handle = 0) => ({
    liveUrl: `http://x/live/${RUN_ID}?h=${String(handle)}#v1.a.b.${String(Date.now())}`,
    expiresAt: Date.now() + TTL_MS,
    handle,
    stream: { kind: 'cdp-screencast' },
  }))
  classifyRunStreamCloseMock.mockResolvedValue({ kind: 'lost' })
  cancelRunMock.mockResolvedValue({ cancelled: true })
})

afterEach(() => {
  unmountHost()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('the live page is two panes and nothing else (HNST-01, D-09)', () => {
  it('the sentinels are pinned to the exact strings the sibling suites hardcode', () => {
    // 403-04's reducer suite and 403-06's Playwright suite each spell these literally. A rename
    // here would leave three suites hunting for three different needles, and all three green.
    expect(SENTINEL_REASONING).toBe('SENTINEL-REASONING-7f3a')
    expect(SENTINEL_ACTION).toBe('SENTINEL-ACTION-9c1e')
  })

  it('renders exactly two [data-live-pane] elements, steps and preview', async () => {
    await mount()
    const panes = qa('[data-live-pane]')
    expect(panes.map((pane) => pane.getAttribute('data-live-pane'))).toEqual(['steps', 'preview'])
    expect(panes).toHaveLength(2)
  })

  it('THE SENTINEL CELL: a mid-step plan and planned action reach no corner of the document', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted(), subActionRecorded())

    // The WHOLE serialised document: text, attributes, aria-*, title and hidden nodes alike. A
    // query for visible text would pass over a `title=` leak, and a leak in a `title=` is a leak.
    const serialised = document.documentElement.outerHTML
    expect(serialised).not.toContain(SENTINEL_REASONING)
    expect(serialised).not.toContain(SENTINEL_ACTION)

    // ...and the absolute half: the envelope carrying them WAS folded, so the assertion above is
    // about a page that saw the payload, not about a page that never received one.
    const rows = qa('[data-live-pane="steps"] li')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.getAttribute('data-step-status')).toBe('running')
    expect(rows[0]?.getAttribute('data-step-ticks')).toBe('1')
    expect(JSON.stringify(subActionRecorded().payload)).toContain(SENTINEL_REASONING)
  })

  it('the step rows are inert: no click target, no link and no image inside the steps pane', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted(), subActionRecorded())

    expect([...stepsPane().querySelectorAll('a, button, [role="button"], [onclick], img')]).toEqual([])
    expect(stepsPane().querySelectorAll('li')).toHaveLength(1)
  })
})

describe('the running row moves without inventing a phase (HNST-02, D-10)', () => {
  it('finalizing clears the motion and keeps the status word', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted())
    expect(qa('[data-step-motion]')).toHaveLength(1)

    await emit(stepFinalized(0, 0, { status: 'passed' }))
    expect(q('[data-live-pane="steps"] li')?.getAttribute('data-step-status')).toBe('passed')
    expect(qa('[data-step-motion]')).toEqual([])
  })

  it('exactly one row is in motion at a time', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 2), stepStarted(0, 0))
    await emit(stepFinalized(0, 0, { status: 'passed' }), stepStarted(0, 1, 'click the button'))

    expect(qa('[data-step-motion]')).toHaveLength(1)
    expect(qa('[data-live-pane="steps"] li').map((row) => row.getAttribute('data-step-status'))).toEqual([
      'passed',
      'running',
    ])
  })

  it('a self-heal is `healed`, never a plain pass', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted())
    await emit(stepFinalized(0, 0, { status: undefined, selfHealOccurred: true }))

    expect(q('[data-live-pane="steps"] li')?.getAttribute('data-step-status')).toBe('healed')
  })

  it('the tick count is a plain number of actions and the motion re-keys on each one', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted())
    expect(q('[data-step-motion]')?.getAttribute('data-motion-key')).toBe('0')

    await emit(subActionRecorded(0, 0, 0), subActionRecorded(0, 0, 1), subActionRecorded(0, 0, 2))

    expect(q('[data-step-ticks-label]')?.textContent).toBe('3 actions')
    expect(q('[data-live-pane="steps"] li')?.getAttribute('data-step-ticks')).toBe('3')
    expect(q('[data-step-motion]')?.getAttribute('data-motion-key')).toBe('3')
    // No phase was invented from the ticks, in any casing.
    expect(stepsPane().outerHTML.toLowerCase()).not.toMatch(/observing|planning|acting/)
  })
})

describe('the pill tells the truth about the channel (HNST-03, D-11)', () => {
  it('k=5: heartbeat-only traffic for 60 s stays `live` with a last-activity age under the window', async () => {
    for (let k = 0; k < 5; k += 1) {
      await mount()
      await open()
      await emit(runStarted())

      for (let beat = 0; beat < 6; beat += 1) {
        await advance(9_000)
        expect(livenessWord()).toBe('live')
        expect(lastActivitySeconds()).toBe(9)
        await advance(1_000)
        await emit(heartbeat())
        expect(livenessWord()).toBe('live')
        expect(lastActivitySeconds()).toBe(0)
      }
    }
  })

  it('k=5: an OPEN socket that has heard nothing for 20 s reads `lost`, not `connected`', async () => {
    for (let k = 0; k < 5; k += 1) {
      await mount()
      await open()
      // The socket is open and the run has said nothing. This is the HNST-03 lie in its purest
      // form: every page that branches on `readyState` shows a green dot here, forever.
      expect(latest().readyState).toBe(OPEN)

      await advance(19_000)
      expect(livenessWord()).toBe('connecting')

      await advance(1_000)
      expect(latest().readyState).toBe(OPEN)
      expect(livenessWord()).toBe('lost')
      expect(latest().closed).toBe(false)
    }
  })

  it('k=5: an error while the socket is dialling reads `reconnecting`', async () => {
    for (let k = 0; k < 5; k += 1) {
      await mount()
      await open()
      await emit(runStarted())
      expect(livenessWord()).toBe('live')

      await fail(CONNECTING)
      expect(livenessWord()).toBe('reconnecting')
      // The browser retries this socket itself — the page does not open a second one.
      expect(sources()).toHaveLength(1)
      expect(classifyRunStreamCloseMock).not.toHaveBeenCalled()
    }
  })

  it('the preview pane keeps its own state through every pill transition', async () => {
    await mount()
    await open()
    await emit(runStarted())
    expect(previewState()).toBe('embedded')

    await fail(CONNECTING)
    expect(livenessWord()).toBe('reconnecting')
    expect(previewState()).toBe('embedded')

    await advance(20_000)
    expect(livenessWord()).toBe('reconnecting')
    expect(previewState()).toBe('embedded')
  })
})

describe('a stream that carried no step is never a blank pane (HNST-01 empty edge)', () => {
  it('says `waiting for the first step` while live and `did not run` once the member settles', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member'))

    expect(q('[data-steps-empty]')?.textContent).toBe(STEPS_EMPTY_TEXT)
    expect(STEPS_EMPTY_TEXT).toBe('waiting for the first step')

    await emit(testFinished(0, 'failed'))

    expect(q('[data-steps-empty]')).toBeNull()
    expect(q('[data-member-note]')?.textContent).toBe(DID_NOT_RUN_NOTE)
    expect(stepsPane().textContent).not.toContain(STEPS_EMPTY_TEXT)
  })
})

describe('the page ends where the run ends, and stays there (D-12)', () => {
  it('freezes with the verdict, ends the preview, links run detail, and neither reconnects nor navigates', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted())
    expect(sources()).toHaveLength(1)

    await emit(stepFinalized(0, 0, { status: 'passed' }), testFinished(0, 'passed'), verdict('passed'), runFinished())

    expect(q('[data-terminal-state]')?.getAttribute('data-terminal-state')).toBe('passed')
    expect(document.body.textContent).toContain('run ended')
    expect(previewState()).toBe('ended')
    expect(q('[data-live-embed]')).toBeNull()
    expect(q('[data-run-detail-link]')?.getAttribute('href')).toBe(`/runs/${RUN_ID}`)
    // Liveness is a claim about a channel; a finished run has none to make.
    expect(q('[data-liveness]')).toBeNull()

    await advance(30_000)

    expect(sources()).toHaveLength(1)
    expect(navigateMock).not.toHaveBeenCalled()
    expect(observedPath).toBe(`/runs/${RUN_ID}/live`)
    expect(classifyRunStreamCloseMock).not.toHaveBeenCalled()
  })

  it('the rows are frozen: an envelope after `runFinished` changes no status', async () => {
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted(), stepFinalized(0, 0, { status: 'passed' }))
    await emit(verdict('passed'), runFinished())

    await emit(stepStarted(0, 0, 'a late start'))

    expect(q('[data-live-pane="steps"] li')?.getAttribute('data-step-status')).toBe('passed')
  })
})

describe('the preview is one embed or an honest sentence (LIVE-04, D-02, D-08)', () => {
  // `none` IS TWO SITUATIONS WEARING ONE WORD (403-07, gap 1), and the pane's whole honesty rests
  // on telling them apart. `startRun` publishes the session synchronously; the member's browser —
  // and therefore its screencast capability — arrives later, so the FIRST mint of an ordinary run
  // answers `none` while the run is perfectly healthy. Reading that as the D-08 declared absence
  // printed `no live preview for this target` over a run that was about to stream. The
  // discriminator is the watched member's own lifecycle, and both halves are cells.
  it('a `none` from a member whose browser is not up yet is a NOT-YET, and the pane keeps asking', async () => {
    fetchLiveUrlMock.mockResolvedValue({
      liveUrl: 'http://x/live/r1#v1.a.b',
      expiresAt: BASE_TIME + TTL_MS,
      handle: 0,
      stream: { kind: 'none' },
    })
    await mount()
    await open()
    await emit(runStarted([0]), testStarted(0, 'the member', 1))

    expect(previewState()).toBe('waiting')
    expect(q('[data-live-pane="preview"]')?.textContent).not.toContain(NO_STREAM_TEXT)
    expect(q('iframe')).toBeNull()
    expect(fetchLiveUrlMock).toHaveBeenCalledTimes(1)

    // THE POLL IS THE FIX. A pane that asked once would sit here for the whole run; the assertion
    // that matters is that the SECOND and THIRD questions get asked without anything prompting them.
    await advance(NO_STREAM_RETRY_MS)
    expect(fetchLiveUrlMock).toHaveBeenCalledTimes(2)
    await advance(NO_STREAM_RETRY_MS)
    expect(fetchLiveUrlMock).toHaveBeenCalledTimes(3)
    expect(previewState()).toBe('waiting')
    expect(q('iframe')).toBeNull()
  })

  it('a declared `none` — the member started and still has no stream — renders the sentence and no iframe', async () => {
    fetchLiveUrlMock.mockResolvedValue({
      liveUrl: 'http://x/live/r1#v1.a.b',
      expiresAt: BASE_TIME + TTL_MS,
      handle: 0,
      stream: { kind: 'none' },
    })
    await mount()
    await open()
    await emit(runStarted([0]), testStarted(0, 'the member', 1), stepStarted())

    // The member's browser IS up now — its steps are advancing — and the handle still declares
    // nothing to stream. That is the D-08 absence, and it gets the sentence rather than motion.
    await advance(NO_STREAM_RETRY_MS)

    expect(previewState()).toBe('no-stream')
    expect(q('[data-live-pane="preview"]')?.textContent).toContain(NO_STREAM_TEXT)
    expect(NO_STREAM_TEXT).toBe('no live preview for this target — steps still advance below')
    expect(q('iframe')).toBeNull()

    // AND THE SENTENCE IS TERMINAL. A retry that fired from `no-stream` would poll straight
    // through a declared absence and turn D-08 into a flicker.
    const settled = fetchLiveUrlMock.mock.calls.length
    await advance(NO_STREAM_RETRY_MS * 3)
    expect(fetchLiveUrlMock.mock.calls.length).toBe(settled)
    expect(previewState()).toBe('no-stream')
  })

  it('any non-none kind embeds identically — `mjpeg` is not a special case', async () => {
    fetchLiveUrlMock.mockResolvedValue({
      liveUrl: 'http://x/live/r1#v1.mjpeg',
      expiresAt: BASE_TIME + TTL_MS,
      handle: 0,
      stream: { kind: 'mjpeg' },
    })
    await mount()
    await open()

    expect(previewState()).toBe('embedded')
    const frame = q('[data-live-embed]')
    expect(frame?.getAttribute('src')).toBe('http://x/live/r1#v1.mjpeg')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('a roster of more than one handle offers a picker that re-mints for the chosen handle', async () => {
    await mount()
    await open()
    await emit(runStarted([0, 1]))

    const picker = q('[data-handle-picker]')
    expect(picker).not.toBeNull()
    expect(fetchLiveUrlMock.mock.calls.at(-1)).toEqual([RUN_ID, 0])

    await act(async () => {
      const select = picker as HTMLSelectElement
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(fetchLiveUrlMock.mock.calls.at(-1)).toEqual([RUN_ID, 1])
  })

  it('a single-handle run shows no picker', async () => {
    await mount()
    await open()
    await emit(runStarted([0]))

    expect(q('[data-handle-picker]')).toBeNull()
    expect(previewState()).toBe('embedded')
  })

  it('the mint is renewed silently at half its life and the frame swaps to the new url', async () => {
    await mount()
    await open()
    const first = q('[data-live-embed]')?.getAttribute('src')
    expect(fetchLiveUrlMock).toHaveBeenCalledTimes(1)

    await advance(TTL_MS / 2)

    expect(fetchLiveUrlMock).toHaveBeenCalledTimes(2)
    const second = q('[data-live-embed]')?.getAttribute('src')
    expect(second).not.toBe(first)
    expect(second).toBe(`http://x/live/${RUN_ID}?h=0#v1.a.b.${String(BASE_TIME + TTL_MS / 2)}`)
    // Silent: nothing about the swap reaches the person watching.
    expect(previewState()).toBe('embedded')
  })

  it('a refused mint names the door’s own word and shows no frame', async () => {
    fetchLiveUrlMock.mockRejectedValue(new Error('live_view_unavailable'))
    await mount()
    await open()

    expect(previewState()).toBe('unavailable')
    expect(q('[data-preview-error]')?.getAttribute('data-preview-error')).toBe('live_view_unavailable')
    expect(q('iframe')).toBeNull()
  })
})

describe('the wordless close is classified, never guessed (D-13, D-15, INVK-05)', () => {
  it('a replay floor re-attaches at the floor and says what it cost', async () => {
    classifyRunStreamCloseMock.mockResolvedValue({ kind: 'replay_floor', earliestAvailableSeq: 40 })
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), heartbeat(), envelope('heartbeat', {}, 12))
    expect(sources()).toHaveLength(1)

    await fail(CLOSED)

    expect(classifyRunStreamCloseMock).toHaveBeenCalledWith(RUN_ID, { lastEventId: 12 })
    expect(sources()).toHaveLength(2)
    expect(latest().url).toBe(`/api/run-stream/${RUN_ID}?lastEventId=39`)
    expect(q('[data-gap-marker]')?.textContent?.trim()).toBe('27 events missed (seq 13–39) — see run detail')
  })

  it('an unknown run stops retrying and routes to the durable record', async () => {
    classifyRunStreamCloseMock.mockResolvedValue({ kind: 'unknown_run' })
    await mount()
    await open()
    await emit(runStarted())

    await fail(CLOSED)

    expect(q('[data-run-over]')?.textContent?.trim()).toBe('this run is over — view run detail')
    expect(sources()).toHaveLength(1)

    await advance(30_000)
    expect(sources()).toHaveLength(1)
    expect(classifyRunStreamCloseMock).toHaveBeenCalledTimes(1)
  })

  it('a plain reattach resumes at the last seq seen, and never below it', async () => {
    classifyRunStreamCloseMock.mockResolvedValue({ kind: 'reattach' })
    await mount()
    await open()
    // The out-of-order delivery: seq 12 arrives, then seq 5. The resume point is the HIGHEST seq
    // seen, because re-delivery is idempotent here and skipping past a gap is not.
    await emit(runStarted(), envelope('heartbeat', {}, 12), envelope('heartbeat', {}, 5))

    await fail(CLOSED)

    expect(sources()).toHaveLength(2)
    expect(latest().url).toBe(`/api/run-stream/${RUN_ID}?lastEventId=12`)
    expect(q('[data-gap-marker]')).toBeNull()
  })

  it('the first attach carries no resume point at all', async () => {
    await mount()
    expect(latest().url).toBe(`/api/run-stream/${RUN_ID}`)
  })
})

describe('the bus is the truth on this page', () => {
  it('a run row the door cannot answer for is a notice, never a blocker', async () => {
    fetchRunMock.mockRejectedValue(new Error('500'))
    await mount()
    await open()
    await emit(runStarted(), testStarted(0, 'the member', 1), stepStarted())

    expect(qa('[data-live-pane]')).toHaveLength(2)
    expect(q('[data-run-meta-unavailable]')).not.toBeNull()
    expect(q('[data-live-pane="steps"] li')?.getAttribute('data-step-status')).toBe('running')
    expect(previewState()).toBe('embedded')
  })

  it('a run warning is reduced to a code and a message', async () => {
    await mount()
    await open()
    await emit(runStarted(), envelope('runWarning', { code: 'w1', message: 'a warning', context: { secret: SENTINEL_REASONING } }))

    expect(q('[data-run-notice="w1"]')?.textContent).toBe('a warning')
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL_REASONING)
  })
})
