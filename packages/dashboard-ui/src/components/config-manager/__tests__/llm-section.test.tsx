// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LlmSection } from '@/components/config-manager/llm-section'
import { fetchLiveModelCatalog, fetchModelCatalog, updateSettings } from '@/lib/api'
import { toast } from 'sonner'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { modelCatalogFixture } = vi.hoisted(() => ({
  modelCatalogFixture: {
    'openai-compatible': [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', vision: false, notes: 'text-only' },
      { id: 'claude-*', label: 'Claude family', vision: true },
      { id: 'gpt-5.5', label: 'GPT-5.5', vision: true },
    ],
    'anthropic-compatible': [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', vision: true },
    ],
    gemini: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vision: true },
    ],
  },
}))

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
  fetchModelCatalog: vi.fn().mockResolvedValue({ catalog: modelCatalogFixture }),
  fetchLiveModelCatalog: vi.fn().mockResolvedValue({ models: [] }),
  testLLMConnection: vi.fn().mockResolvedValue({ success: true }),
  saveCredential: vi.fn().mockResolvedValue({ saved: true }),
  startPluginAuth: vi.fn().mockResolvedValue({ authorizeUrl: 'https://auth.example/start', sessionId: 'session-1', mode: 'manual-code' }),
  pollPluginAuthResult: vi.fn().mockResolvedValue({ status: 'pending' }),
  exchangePluginAuthCode: vi.fn().mockResolvedValue({ status: 'completed', saved: true }),
  deleteAuthCredential: vi.fn(),
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void
    value?: string
  } | null>(null)

  return {
    Select: ({ children, onValueChange, value }: any) => (
      <SelectContext.Provider value={{ onValueChange, value }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({ children, ...props }: any) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => {
      const context = React.useContext(SelectContext)
      return <span>{context?.value}</span>
    },
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const context = React.useContext(SelectContext)
      return (
        <button
          type="button"
          data-select-value={value}
          onClick={() => context?.onValueChange?.(value)}
        >
          {children}
        </button>
      )
    },
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockUpdateSettings = vi.mocked(updateSettings)
const mockFetchModelCatalog = vi.mocked(fetchModelCatalog)
const mockFetchLiveModelCatalog = vi.mocked(fetchLiveModelCatalog)
const mockToastError = vi.mocked(toast.error)

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

async function openAddLlmEditor() {
  await act(async () => {
    const addButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === 'Add Configuration',
    ) as HTMLButtonElement
    addButton.click()
  })
  await flushRender()
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function blurInput(input: HTMLInputElement) {
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

function clickSelectItem(value: string) {
  const item = document.body.querySelector(`button[data-select-value="${value}"]`) as HTMLButtonElement | null
  expect(item).not.toBeNull()
  item!.click()
}

function requiredMarkerForLabel(forId: string) {
  return document.body.querySelector(`label[for="${forId}"] span[aria-hidden="true"]`)
}

function credentialRequiredMarker() {
  const heading = Array.from(document.body.querySelectorAll('h3')).find((item) =>
    item.textContent?.includes('Credentials'),
  )
  return heading?.querySelector('span[aria-hidden="true"]') ?? null
}

function saveChangesButton() {
  const button = Array.from(document.body.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.trim() === 'Save Changes',
  ) as HTMLButtonElement | undefined
  expect(button).toBeDefined()
  return button!
}

function optionValuesFor(input: HTMLInputElement): string[] {
  const listId = input.getAttribute('list')
  expect(listId).toBeTruthy()
  const datalist = document.body.querySelector(`#${listId}`) as HTMLDataListElement | null
  expect(datalist).not.toBeNull()
  return Array.from(datalist!.querySelectorAll('option')).map((option) => option.value)
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

function configWithoutLlms() {
  return {
    registry: {
      llms: [],
    },
    use: {},
  }
}

beforeEach(() => {
  mockUpdateSettings.mockResolvedValue({ updated: true })
  mockFetchModelCatalog.mockResolvedValue({ catalog: modelCatalogFixture })
  mockFetchLiveModelCatalog.mockResolvedValue({ models: [] })
})

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
  it('marks required controls and toggles conditional markers without blocking Save on credentials', async () => {
    await renderLlmSection(configWithoutLlms())
    await openAddLlmEditor()

    const nameInput = document.body.querySelector('#config-name') as HTMLInputElement
    const providerTrigger = document.body.querySelector('#config-provider') as HTMLButtonElement
    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement

    expect(document.body.textContent).toContain('* Required')
    expect(nameInput.getAttribute('aria-required')).toBe('true')
    expect(providerTrigger.getAttribute('aria-required')).toBe('true')
    expect(modelInput.getAttribute('aria-required')).toBe('true')
    expect(baseUrlInput.getAttribute('aria-required')).toBe('true')
    expect(requiredMarkerForLabel('config-name')?.textContent).toBe('*')
    expect(requiredMarkerForLabel('config-provider')?.textContent).toBe('*')
    expect(requiredMarkerForLabel('config-model')?.textContent).toBe('*')
    expect(requiredMarkerForLabel('config-base-url')?.textContent).toBe('*')
    expect(credentialRequiredMarker()).toBeNull()
    expect(document.body.querySelector('#provider-error')).toBeNull()

    await act(async () => {
      setInputValue(nameInput, 'gemini-fast')
      setInputValue(modelInput, 'gemini-2.5-flash')
      clickSelectItem('gemini')
    })
    await flushRender()

    expect(document.body.querySelector('#config-base-url')).toBeNull()
    expect(requiredMarkerForLabel('config-base-url')).toBeNull()
    expect(credentialRequiredMarker()?.textContent).toBe('*')
    expect(saveChangesButton().disabled).toBe(false)

    await act(async () => {
      clickSelectItem('openai-compatible')
    })
    await flushRender()

    expect(document.body.querySelector('#config-base-url')?.getAttribute('aria-required')).toBe('true')
    expect(requiredMarkerForLabel('config-base-url')?.textContent).toBe('*')
    expect(credentialRequiredMarker()).toBeNull()

    await act(async () => {
      clickSelectItem('gemini')
    })
    await flushRender()

    await act(async () => {
      saveChangesButton().click()
    })
    await flushRender()

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      'registry.llms': [
        expect.objectContaining({
          name: 'gemini-fast',
          provider: 'gemini',
          model: 'gemini-2.5-flash',
        }),
      ],
    })
  })

  it('UI-DOTTED-NAME-ACCEPTED: accepts dotted names and refuses uppercase with the name rule (D-13)', async () => {
    await renderLlmSection(configWithoutLlms())
    await openAddLlmEditor()

    const nameInput = document.body.querySelector('#config-name') as HTMLInputElement

    await act(async () => {
      setInputValue(nameInput, 'gpt-5.6')
    })
    await flushRender()
    await act(async () => {
      blurInput(nameInput)
    })
    await flushRender()

    expect(document.body.querySelector('#name-error')).toBeNull()
    expect(nameInput.getAttribute('aria-describedby')).toBeNull()

    await act(async () => {
      setInputValue(nameInput, 'GPT-5')
    })
    await flushRender()
    await act(async () => {
      blurInput(nameInput)
    })
    await flushRender()

    expect(document.body.querySelector('#name-error')?.textContent).toBe(
      'Use lowercase letters, digits, hyphens and dots, starting with a letter or digit.',
    )
    expect(nameInput.getAttribute('aria-describedby')).toBe('name-error')
  })

  it('validates model as required on blur and clears the error while typing', async () => {
    await renderLlmSection(configWithoutLlms())
    await openAddLlmEditor()

    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement

    await act(async () => {
      blurInput(modelInput)
    })
    await flushRender()

    expect(document.body.textContent).toContain('Model is required.')
    expect(modelInput.getAttribute('aria-invalid')).toBe('true')
    expect(modelInput.getAttribute('aria-describedby')).toBe('model-error')
    expect(document.body.querySelector('#model-error')?.textContent).toBe('Model is required.')

    await act(async () => {
      setInputValue(modelInput, 'gpt-5.5')
    })
    await flushRender()

    expect(document.body.textContent).not.toContain('Model is required.')
    expect(modelInput.getAttribute('aria-invalid')).toBeNull()
    expect(modelInput.getAttribute('aria-describedby')).toBeNull()
  })

  it('validates Base URL as required on blur and submit for compatible providers', async () => {
    await renderLlmSection(configWithoutLlms())
    await openAddLlmEditor()

    const nameInput = document.body.querySelector('#config-name') as HTMLInputElement
    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement

    await act(async () => {
      blurInput(baseUrlInput)
    })
    await flushRender()

    expect(document.body.textContent).toContain('Base URL is required for compatible providers.')
    expect(baseUrlInput.getAttribute('aria-invalid')).toBe('true')
    expect(baseUrlInput.getAttribute('aria-describedby')).toBe('base-url-error')

    await act(async () => {
      setInputValue(baseUrlInput, 'https://openrouter.ai/api/v1')
    })
    await flushRender()

    expect(document.body.textContent).not.toContain('Base URL is required for compatible providers.')
    expect(baseUrlInput.getAttribute('aria-invalid')).toBeNull()
    expect(baseUrlInput.getAttribute('aria-describedby')).toBeNull()

    await act(async () => {
      setInputValue(baseUrlInput, '')
      setInputValue(nameInput, 'planner')
      setInputValue(modelInput, 'gpt-5.5')
    })
    await flushRender()

    await act(async () => {
      saveChangesButton().click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Base URL is required for compatible providers.')
    expect(mockUpdateSettings).not.toHaveBeenCalled()
  })

  it('binds the model input to provider-scoped catalog datalist options', async () => {
    await renderLlmSection(configWithLlm({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'gpt-5.5',
      baseURL: 'https://openrouter.ai/api/v1',
    }))
    await openFirstLlmEditor()

    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const optionValues = optionValuesFor(modelInput)

    expect(mockFetchModelCatalog).toHaveBeenCalled()
    expect(modelInput.getAttribute('list')).toBe('config-model-options-openai-compatible')
    expect(optionValues).toEqual(expect.arrayContaining(['deepseek-chat', 'claude-*', 'gpt-5.5']))
    expect(optionValues).not.toContain('gemini-2.5-flash')
  })

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

  it('silently preserves static datalist options when live OpenAI-compatible enrichment fails', async () => {
    mockFetchLiveModelCatalog.mockRejectedValueOnce(new Error('network down'))

    await renderLlmSection(configWithLlm({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'gpt-5.5',
      baseURL: ' https://openrouter.ai/api/v1 ',
    }))
    await openFirstLlmEditor()

    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement

    await act(async () => {
      blurInput(baseUrlInput)
    })
    await flushRender()

    expect(mockFetchLiveModelCatalog).toHaveBeenCalledWith({
      baseURL: 'https://openrouter.ai/api/v1',
      configName: 'planner',
    })
    expect(mockFetchLiveModelCatalog.mock.calls[0]?.[0]).not.toHaveProperty('apiKey')
    expect(optionValuesFor(modelInput)).toEqual(expect.arrayContaining(['deepseek-chat', 'gpt-5.5']))
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('merges live OpenAI-compatible catalog options', async () => {
    mockFetchLiveModelCatalog.mockResolvedValueOnce({
      models: [
        { id: 'live-local-model', label: 'Live Local Model', vision: false },
      ],
    })

    await renderLlmSection(configWithLlm({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'gpt-5.5',
      baseURL: 'https://openrouter.ai/api/v1',
    }))
    await openFirstLlmEditor()

    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement

    await act(async () => {
      blurInput(baseUrlInput)
    })
    await flushRender()

    expect(optionValuesFor(modelInput)).toEqual(expect.arrayContaining(['gpt-5.5', 'live-local-model']))
  })

  it('does not fetch live catalog options for Anthropic-compatible providers', async () => {
    await renderLlmSection(configWithLlm({
      name: 'claude-proxy',
      provider: 'anthropic-compatible',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://anthropic-proxy.example/messages',
    }))
    await openFirstLlmEditor()

    const anthropicBaseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement
    await act(async () => {
      blurInput(anthropicBaseUrlInput)
    })
    await flushRender()

    expect(mockFetchLiveModelCatalog).not.toHaveBeenCalled()
  })

  it('prefills vision from catalog matches until the user manually overrides it', async () => {
    await renderLlmSection(configWithoutLlms())
    await openAddLlmEditor()

    const modelInput = document.body.querySelector('#config-model') as HTMLInputElement
    const visionSwitch = document.body.querySelector('#config-vision') as HTMLButtonElement

    expect(visionSwitch.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      setInputValue(modelInput, 'deepseek-chat')
    })
    await flushRender()
    expect(visionSwitch.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      setInputValue(modelInput, 'claude-sonnet-4-20250514')
    })
    await flushRender()
    expect(visionSwitch.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      visionSwitch.click()
    })
    await flushRender()
    expect(visionSwitch.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      setInputValue(modelInput, 'claude-opus-4-20250514')
    })
    await flushRender()
    expect(visionSwitch.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the saved vision value authoritative in edit mode', async () => {
    await renderLlmSection(configWithLlm({
      name: 'planner',
      provider: 'openai-compatible',
      model: 'claude-sonnet-4-20250514',
      baseURL: 'https://openrouter.ai/api/v1',
      vision: false,
    }))
    await openFirstLlmEditor()

    const visionSwitch = document.body.querySelector('#config-vision') as HTMLButtonElement
    expect(visionSwitch.getAttribute('aria-checked')).toBe('false')
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
