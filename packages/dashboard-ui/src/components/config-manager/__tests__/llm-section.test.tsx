// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LlmSection } from '@/components/config-manager/llm-section'
import { updateSettings } from '@/lib/api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  updateSettings: vi.fn().mockResolvedValue({ updated: true }),
  fetchAuthStatus: vi.fn().mockResolvedValue({ credentials: [] }),
  fetchLLMProviders: vi.fn().mockResolvedValue({
    providers: [
      {
        id: 'openai-compatible',
        label: 'OpenAI-compatible',
        auth: { kind: 'api-key', credentialTypes: ['api-key'], optional: true },
        needsBaseURL: true,
        authModes: ['api-key'],
        baseURLPlaceholder: 'https://openrouter.ai/api/v1',
      },
      {
        id: 'anthropic-compatible',
        label: 'Anthropic-compatible',
        auth: { kind: 'api-key', credentialTypes: ['api-key', 'bearer-token'], optional: true },
        needsBaseURL: true,
        authModes: ['api-key', 'bearer-token'],
        baseURLPlaceholder: 'https://anthropic-proxy.example/messages',
      },
      {
        id: 'gemini',
        label: 'Gemini',
        auth: { kind: 'api-key', credentialTypes: ['api-key'] },
        needsBaseURL: false,
        authModes: ['api-key'],
      },
    ],
  }),
  testLLMConnection: vi.fn().mockResolvedValue({ success: true }),
  saveCredential: vi.fn().mockResolvedValue({ saved: true }),
  startPluginAuth: vi.fn().mockResolvedValue({ authorizeUrl: 'https://auth.example/start', sessionId: 'session-1', mode: 'manual-code' }),
  pollPluginAuthResult: vi.fn().mockResolvedValue({ status: 'pending' }),
  exchangePluginAuthCode: vi.fn().mockResolvedValue({ status: 'completed', saved: true }),
  deleteAuthCredential: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockUpdateSettings = vi.mocked(updateSettings)

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flushRender() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderLlmSection(config: Record<string, unknown>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(<LlmSection config={config} onConfigChange={vi.fn()} />)
  })
  await flushRender()

  return container
}

async function openFirstLlmEditor() {
  await act(async () => {
    ;(document.body.querySelector('button[title="Edit configuration"]') as HTMLButtonElement).click()
  })
  await flushRender()
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function configWithLlm(llm: Record<string, unknown>) {
  const name = String(llm.name ?? '')
  return {
    registry: {
      llms: [llm],
    },
    use: {
      llm: name,
    },
  }
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
  vi.clearAllMocks()
})

describe('LlmSection model-config modal', () => {
  it('saves vision and contextWindow without per-model sizing fields', async () => {
    await renderLlmSection(configWithLlm({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'openrouter/auto',
      baseURL: 'https://openrouter.ai/api/v1',
    }))
    await openFirstLlmEditor()

    const visionSwitch = document.body.querySelector('#config-vision') as HTMLButtonElement | null
    const contextWindowInput = document.body.querySelector('#config-context-window') as HTMLInputElement | null

    expect(visionSwitch?.getAttribute('role')).toBe('switch')
    expect(visionSwitch?.getAttribute('aria-checked')).toBe('true')
    expect(contextWindowInput).not.toBeNull()
    expect(document.body.querySelector('#config-effective-resolution')).toBeNull()
    expect(document.body.textContent).not.toContain('Screenshot Size')
    expect(document.body.textContent).not.toContain('Effective Resolution')

    expect(document.body.textContent).toContain('Vision (optional)')
    expect(document.body.textContent).toContain('Context Window (optional)')
    expect(document.body.textContent).toContain('Whether this model can process screenshots. Defaults on; turn off for text-only models (e.g. deepseek-chat).')
    expect(document.body.textContent).toContain('Optional context-window hint as a size string (e.g. "256k"). Leave empty to auto-detect.')

    await act(async () => {
      setInputValue(contextWindowInput!, '256k')
    })
    await flushRender()

    await act(async () => {
      const saveButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
        button.textContent?.trim() === 'Save Changes',
      ) as HTMLButtonElement
      saveButton.click()
    })
    await flushRender()

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      'registry.llms': [
        {
          name: 'planner',
          provider: 'openai-compatible',
          model: 'openrouter/auto',
          baseURL: 'https://openrouter.ai/api/v1',
          vision: true,
          contextWindow: '256k',
        },
      ],
    })

    const savedSettings = mockUpdateSettings.mock.calls[0]?.[0] as Record<string, unknown>
    const savedConfig = (savedSettings['registry.llms'] as Record<string, unknown>[])[0]
    expect(savedConfig).not.toHaveProperty('screenshotSize')
    expect(savedConfig).not.toHaveProperty('effectiveResolution')
  })

  it('marks provider headers optional with helper text for Anthropic-compatible configs', async () => {
    await renderLlmSection(configWithLlm({
      name: 'claude-proxy',
      provider: 'anthropic-compatible',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://anthropic-proxy.example/messages',
      providerHeaders: { 'anthropic-version': '2023-06-01' },
      vision: false,
      contextWindow: '200k',
    }))
    await openFirstLlmEditor()

    const visionSwitch = document.body.querySelector('#config-vision') as HTMLButtonElement | null
    const contextWindowInput = document.body.querySelector('#config-context-window') as HTMLInputElement | null

    expect(document.body.textContent).toContain('Provider Headers (optional)')
    expect(document.body.textContent).toContain('Optional non-secret headers sent with this Anthropic-compatible endpoint.')
    expect(visionSwitch?.getAttribute('aria-checked')).toBe('false')
    expect(contextWindowInput?.value).toBe('200k')
  })
})
