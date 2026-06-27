// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VisionSection } from '@/components/config-manager/vision-section'
import { updateSettings } from '@/lib/api'
import { toast } from 'sonner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  updateSettings: vi.fn().mockResolvedValue({ updated: true }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockUpdateSettings = vi.mocked(updateSettings)
const mockToast = vi.mocked(toast)

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderVisionSection(config: Record<string, unknown>, onConfigChange = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(<VisionSection config={config} onConfigChange={onConfigChange} />)
  })

  return { container, onConfigChange }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function cleanupRender() {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
}

afterEach(() => {
  cleanupRender()
  vi.clearAllMocks()
})

describe('VisionSection', () => {
  it('marks sizing fields optional and saves the shared services.vision budget', async () => {
    const { container: view, onConfigChange } = await renderVisionSection({
      services: {
        vision: {
          screenshotSize: '128k',
          effectiveResolution: 512,
        },
      },
    })

    expect(view.textContent).toContain('Screenshot Size (optional)')
    expect(view.textContent).toContain('Effective Resolution (optional)')

    const screenshotSizeInput = view.querySelector('#vision-screenshot-size') as HTMLInputElement | null
    const effectiveResolutionInput = view.querySelector('#vision-effective-resolution') as HTMLInputElement | null
    expect(screenshotSizeInput).not.toBeNull()
    expect(effectiveResolutionInput).not.toBeNull()

    await act(async () => {
      setInputValue(screenshotSizeInput!, '256k')
      setInputValue(effectiveResolutionInput!, '768')
    })

    const saveButton = Array.from(view.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save Changes'),
    ) as HTMLButtonElement | undefined
    expect(saveButton).toBeDefined()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      'services.vision': {
        screenshotSize: '256k',
        effectiveResolution: 768,
      },
    })
    expect(onConfigChange).toHaveBeenCalledTimes(1)
    expect(mockToast.success).toHaveBeenCalledWith('Configuration saved')
  })
})
