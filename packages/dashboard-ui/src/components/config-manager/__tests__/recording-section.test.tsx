// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as recordingSection from '@/components/config-manager/recording-section'
import { updateSettings } from '@/lib/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  updateSettings: vi.fn().mockResolvedValue({ updated: true }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockUpdateSettings = vi.mocked(updateSettings)
let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderSection(config: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onConfigChange = vi.fn()
  await act(async () => {
    root!.render(<recordingSection.RecordingSection config={config} onConfigChange={onConfigChange} />)
  })
  return { view: container, onConfigChange }
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

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

describe('RecordingSection', () => {
  it('RECORDING-SECTION-DEFAULT-ON: shows recording enabled when config is absent', async () => {
    const { view } = await renderSection({})
    expect(switchFor(view, 'Enabled').getAttribute('aria-checked')).toBe('true')
    expect(recordingSection.RECORDING_SECTION_DESCRIPTION).toBe(
      'Every run records video by default so each run opens with the same player. Turn it off here.',
    )
    expect(view.textContent).toContain(recordingSection.RECORDING_SECTION_DESCRIPTION)
    expect(switchFor(view, 'Keep recordings of failed tests only').getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(view.querySelector('h2')?.className).toBe('text-base font-semibold')
  })

  it('RECORDING-SECTION-EXPLICIT-OFF: respects an opt-out with the recording help', async () => {
    const { view } = await renderSection({ services: { recording: { enabled: false } } })
    expect(switchFor(view, 'Enabled').getAttribute('aria-checked')).toBe('false')
    expect(view.textContent).toContain('Record video of each test. Recordings stay on this machine.')
    expect(recordingSection.RECORDING_ENABLED_HELP).toBe(
      'Record video of each test. Recordings stay on this machine.',
    )
    expect(view.textContent).toContain(recordingSection.RECORDING_ENABLED_HELP)
  })

  it('RECORDING-SECTION-KNOB-SAVES: saves both switches together and shows the saving spinner', async () => {
    const { view, onConfigChange } = await renderSection({
      services: { recording: { enabled: false, keepFailuresOnly: true } },
    })
    const keepFailures = switchFor(view, 'Keep recordings of failed tests only')
    expect(keepFailures.getAttribute('aria-checked')).toBe('true')
    expect(recordingSection.RECORDING_KEEP_FAILURES_LABEL).toBe('Keep recordings of failed tests only')
    expect(recordingSection.RECORDING_KEEP_FAILURES_HELP).toBe(
      'Useful for CI and large suites. Passed tests then open on Frames.',
    )
    expect(view.textContent).toContain(recordingSection.RECORDING_KEEP_FAILURES_HELP)

    await act(async () => {
      switchFor(view, 'Enabled').click()
      keepFailures.click()
    })
    expect(keepFailures.getAttribute('aria-checked')).toBe('false')
    expect(mockUpdateSettings).not.toHaveBeenCalled()

    let finishSave!: (value: { updated: boolean }) => void
    mockUpdateSettings.mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    const save = Array.from(view.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes',
    )!
    expect(save).toBeDefined()
    await act(async () => save.click())
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      'services.recording': { enabled: true, keepFailuresOnly: false },
    })
    expect(save.disabled).toBe(true)
    expect(save.textContent).toBe('')
    expect(save.querySelector('.animate-spin')).not.toBeNull()
    expect(onConfigChange).not.toHaveBeenCalled()

    await act(async () => finishSave({ updated: true }))
    expect(onConfigChange).toHaveBeenCalledTimes(1)
    expect(save.disabled).toBe(false)
    expect(save.textContent).toBe('Save Changes')
  })
})
