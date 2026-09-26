// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RecordingSection } from '@/components/config-manager/recording-section'
import { ConfigAutosaveProvider, useConfigAutosave } from '@/hooks/use-config-autosave'
import { applyConfigChanges, fetchConfig, fetchConfigRevision } from '@/lib/api'
import { RECORDING_FIELD_HELP, RECORDING_FIELD_LABELS } from '@/lib/config-copy'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const API_EXPORTS = Object.keys(await vi.importActual<typeof import('@/lib/api')>('@/lib/api'))

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const ENABLED = ['services', 'recording', 'enabled']
const KEEP_FAILURES_ONLY = ['services', 'recording', 'keepFailuresOnly']

let container: HTMLDivElement | null = null
let root: Root | null = null

function Harness({ children }: { children: ReactNode }) {
  const autosave = useConfigAutosave()
  if (autosave.load.kind !== 'ready') return null
  return <ConfigAutosaveProvider value={autosave}>{children}</ConfigAutosaveProvider>
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function renderSection(config: Record<string, unknown>) {
  vi.mocked(fetchConfig).mockResolvedValue({
    config,
    provider: null,
    revision: 'rev-1',
    file: { path: '/work/agent-qa.config.yaml', lines: [] },
  } as never)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <Harness>
        <RecordingSection />
      </Harness>,
    )
  })
  await flush()
  return { view: container }
}

function switchFor(view: HTMLElement, label: string) {
  const labelElement = Array.from(view.querySelectorAll('label')).find(
    (element) => element.textContent === label,
  )
  expect(labelElement).toBeDefined()
  const control = view.querySelector<HTMLButtonElement>(`#${labelElement!.htmlFor}`)
  expect(control?.getAttribute('role')).toBe('switch')
  return control!
}

function rowOf(control: HTMLElement) {
  return control.closest('[data-field-path]')!
}

function writeCalls() {
  return vi.mocked(applyConfigChanges).mock.calls.map((call) => call[0])
}

function saveButton(view: HTMLElement) {
  return Array.from(view.querySelectorAll('button')).find((button) => button.textContent === 'Save Changes')
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2' } as never)
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('RecordingSection', () => {
  it.each([
    [undefined, true, false],
    [{}, true, false],
    [{ keepFailuresOnly: true }, true, true],
    [{ enabled: true }, true, false],
    [{ enabled: false }, false, false],
  ])('preserves authored omissions: %j shows its switches and writes nothing on focus and blur', async (recording, enabled, keepFailuresOnly) => {
    const { view } = await renderSection({ services: { recording } })

    const enabledSwitch = switchFor(view, RECORDING_FIELD_LABELS.enabled)
    const keepSwitch = switchFor(view, RECORDING_FIELD_LABELS.keepFailuresOnly)
    expect(enabledSwitch.getAttribute('aria-checked')).toBe(String(enabled))
    expect(keepSwitch.getAttribute('aria-checked')).toBe(String(keepFailuresOnly))

    await act(async () => {
      enabledSwitch.focus()
      keepSwitch.focus()
      keepSwitch.blur()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(saveButton(view)).toBeUndefined()
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(API_EXPORTS).not.toContain('updateSettings')
  })

  it('changes failures-only without persisting an unchosen enabled default', async () => {
    const { view } = await renderSection({})
    await act(async () => switchFor(view, RECORDING_FIELD_LABELS.keepFailuresOnly).click())
    await flush()

    expect(writeCalls()).toEqual([[{ op: 'set', path: KEEP_FAILURES_ONLY, value: true }]])
    expect(JSON.stringify(writeCalls())).not.toContain('enabled')
  })

  it('RECORDING-AUTOSAVES: toggling keepFailuresOnly calls applyConfigChanges once with that one leaf', async () => {
    const { view } = await renderSection({ services: { recording: { enabled: true } } })

    await act(async () => switchFor(view, RECORDING_FIELD_LABELS.keepFailuresOnly).click())
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(applyConfigChanges).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyConfigChanges).mock.calls[0]![0]).toEqual([
      { op: 'set', path: KEEP_FAILURES_ONLY, value: true },
    ])
    expect(API_EXPORTS).not.toContain('updateSettings')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('RECORDING-SECTION-DEFAULT-ON: shows recording enabled when config is absent', async () => {
    const { view } = await renderSection({})
    expect(switchFor(view, RECORDING_FIELD_LABELS.enabled).getAttribute('aria-checked')).toBe('true')
    expect(RECORDING_FIELD_HELP.enabled).toBe('Record video of each test. Recordings stay on this machine.')
    expect(view.textContent).toContain(RECORDING_FIELD_HELP.enabled)
    expect(switchFor(view, RECORDING_FIELD_LABELS.keepFailuresOnly).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(view.querySelector('h2')).toBeNull()
    expect(view.querySelector('[data-config-section-shell]')).toBeNull()
  })

  it('RECORDING-SECTION-EXPLICIT-OFF: respects an opt-out with the recording help', async () => {
    const { view } = await renderSection({ services: { recording: { enabled: false } } })
    const enabledSwitch = switchFor(view, RECORDING_FIELD_LABELS.enabled)
    expect(enabledSwitch.getAttribute('aria-checked')).toBe('false')
    expect(rowOf(enabledSwitch).getAttribute('data-field-path')).toBe('services.recording.enabled')
    expect(view.textContent).toContain('Record video of each test. Recordings stay on this machine.')
    expect(view.textContent).toContain(RECORDING_FIELD_HELP.enabled)
  })

  it('RECORDING-SECTION-KNOB-SAVES: each switch writes its own leaf at once, and a toggle during a write joins the next one', async () => {
    const { view } = await renderSection({
      services: { recording: { enabled: false, keepFailuresOnly: true } },
    })
    const keepFailures = switchFor(view, RECORDING_FIELD_LABELS.keepFailuresOnly)
    expect(keepFailures.getAttribute('aria-checked')).toBe('true')
    expect(RECORDING_FIELD_LABELS.keepFailuresOnly).toBe('Keep recordings of failed tests only')
    expect(RECORDING_FIELD_HELP.keepFailuresOnly).toBe(
      'Useful for CI and large suites. Passed tests then open on Frames.',
    )
    expect(view.textContent).toContain(RECORDING_FIELD_HELP.keepFailuresOnly)
    expect(saveButton(view)).toBeUndefined()

    let finishWrite!: (value: { revision: string }) => void
    vi.mocked(applyConfigChanges).mockReturnValueOnce(
      new Promise((resolve) => {
        finishWrite = resolve
      }) as never,
    )
    const enabledSwitch = switchFor(view, RECORDING_FIELD_LABELS.enabled)
    await act(async () => enabledSwitch.click())
    await flush()
    expect(writeCalls()).toEqual([[{ op: 'set', path: ENABLED, value: true }]])
    expect(rowOf(enabledSwitch).getAttribute('data-field-state')).toBe('saving')

    await act(async () => keepFailures.click())
    await flush()
    expect(keepFailures.getAttribute('aria-checked')).toBe('false')
    expect(applyConfigChanges).toHaveBeenCalledTimes(1)

    await act(async () => finishWrite({ revision: 'rev-2' }))
    await flush()
    expect(writeCalls()).toEqual([
      [{ op: 'set', path: ENABLED, value: true }],
      [{ op: 'set', path: KEEP_FAILURES_ONLY, value: false }],
    ])
    expect(API_EXPORTS).not.toContain('updateSettings')
  })
})
