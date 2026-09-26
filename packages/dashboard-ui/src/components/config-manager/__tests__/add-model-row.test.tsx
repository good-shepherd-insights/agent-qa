// @vitest-environment jsdom

// THE CONTINUOUS ADD FLOW (429-25 · D-13, D-14, D-15, D-17, research A8 · UI-SPEC S5, E5 · PXH-CONF-03).
//
// How you connect comes first, then only that choice's fields, then the name, then Connect. The
// test runs on Connect and only a passing model is written, by the connect door alone: the page
// never writes a draft to the config file. A failure keeps everything, the typed key included, and
// only then offers Save without testing.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelList } from '@/components/config-manager/model-list'
import { ConfigAutosaveProvider, useConfigAutosave } from '@/hooks/use-config-autosave'
import {
  ApiError,
  applyConfigChanges,
  connectLLM,
  fetchAuthStatus,
  fetchConfig,
  fetchConfigRevision,
  fetchLLMProviders,
  fetchLiveModelCatalog,
  fetchModelCatalog,
  type LLMProviderMetadata,
} from '@/lib/api'
import {
  ADD_FLOW_FIELD_LABELS,
  BECAME_DEFAULT_TEXT,
  CONNECTING_LABEL,
  CONNECTION_CHOICE_HINTS,
  CONNECTION_CHOICE_LABELS,
  CONNECT_FORM_LEGEND,
  CONNECT_LABEL,
  MAKE_DEFAULT_LABEL,
  NAME_RULE_ERROR,
  SAVED_WITHOUT_TEST_TEXT,
  SAVE_WITHOUT_TESTING_LABEL,
  TEST_RESULT_TEXT,
  connectedSavedText,
  nameTakenError,
  signInPluginMissingText,
} from '@/lib/config-copy'
import { CONNECTION_CHOICES, type ConnectionChoice } from '@/lib/config-tabs'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
  fetchAuthStatus: vi.fn(),
  fetchLLMProviders: vi.fn(),
  fetchModelCatalog: vi.fn(),
  fetchLiveModelCatalog: vi.fn(),
  testLLMConnection: vi.fn(),
  connectLLM: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIG_PATH = '/work/agent-qa.config.yaml'
const TYPED_KEY = 'sk-typed-in-this-row'

const PROVIDERS: LLMProviderMetadata[] = [
  { id: 'openai-compatible', label: 'OpenAI-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key'], optional: true }, needsBaseURL: true, modelAdapter: 'openai-responses', baseURLPlaceholder: 'https://api.openai.com/v1' },
  { id: 'anthropic-compatible', label: 'Anthropic-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key', 'bearer-token'], optional: true }, needsBaseURL: true },
  { id: 'gemini', label: 'Gemini', auth: { kind: 'api-key', credentialTypes: ['api-key'] }, needsBaseURL: false },
  { id: 'openai-subscription', label: 'ChatGPT plan', auth: { kind: 'oauth-plugin', mode: 'browser-poll' }, defaultModel: 'gpt-5.6' },
  { id: 'anthropic-subscription', label: 'Claude plan', auth: { kind: 'oauth-plugin', mode: 'manual-code' }, defaultModel: 'claude-sonnet-4.5' },
]

const EXISTING = [{ name: 'flash', provider: 'gemini', model: 'gemini-2.5-flash' }]

function modelsConfig(llms: readonly Record<string, unknown>[], defaultName?: string) {
  return { registry: { llms }, use: defaultName === undefined ? {} : { llm: defaultName } }
}

function answer(config: Record<string, unknown>, revision = 'rev-1') {
  return { config, provider: null, revision, file: { path: CONFIG_PATH, lines: [] } }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location" data-pathname={location.pathname} data-search={location.search} />
}

function Harness() {
  const autosave = useConfigAutosave()
  if (autosave.load.kind !== 'ready') return null
  return (
    <ConfigAutosaveProvider value={autosave}>
      <section data-config-section="models">
        <ModelList config={autosave.load.answer.config} onConfigChange={autosave.refresh} />
      </section>
    </ConfigAutosaveProvider>
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function mount(entry = '/config/models?add') {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="/config/:tab" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
  await flush()
}

async function unmount() {
  if (root) await act(async () => root!.unmount())
  root = null
  container?.remove()
  container = null
}

function addRow() {
  return container?.querySelector<HTMLLIElement>('[data-model-list] > li[data-model-draft]') ?? null
}

function addState() {
  return addRow()?.getAttribute('data-add-state')
}

function radios() {
  return Array.from(addRow()?.querySelectorAll<HTMLButtonElement>('[data-add-step="connect"] [role="radio"]') ?? [])
}

function radio(choice: ConnectionChoice) {
  return addRow()?.querySelector<HTMLButtonElement>(`[data-connection-choice="${choice}"] [role="radio"]`) ?? null
}

function fieldEl(name: string) {
  return addRow()?.querySelector<HTMLElement>(`[data-add-field="${name}"]`) ?? null
}

function input(name: string) {
  return fieldEl(name)?.querySelector<HTMLInputElement>('input') ?? null
}

function fieldError(name: string) {
  return fieldEl(name)?.querySelector('[data-field-error]')?.textContent ?? null
}

function buttonsNamed(scope: ParentNode | null | undefined, text: string) {
  return Array.from(scope?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(
    (button) => button.textContent?.trim() === text,
  )
}

function connectButton() {
  return addRow()?.querySelector<HTMLButtonElement>('[data-add-connect]') ?? null
}

function row(name: string) {
  return container?.querySelector<HTMLLIElement>(`[data-model-list] > li[data-model-row][data-model-name="${name}"]`) ?? null
}

async function click(element: HTMLElement | null | undefined) {
  expect(element).toBeTruthy()
  await act(async () => {
    element!.focus()
    element!.click()
  })
  await flush()
}

async function choose(choice: ConnectionChoice) {
  await click(radio(choice))
}

async function type(element: HTMLInputElement | null, value: string) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, value)
    element!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function blur(element: HTMLInputElement | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    element!.blur()
  })
  await flush()
}

function storedText(): string {
  const parts: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!
    parts.push(key, localStorage.getItem(key) ?? '')
  }
  return parts.join('\n')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function fillOpenAiCompatible(model = 'gpt-5.6') {
  await choose('openai-compatible-key')
  await type(input('baseURL'), 'https://llm.example.com/v1')
  await type(input('model'), model)
  await type(input('key'), TYPED_KEY)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig(EXISTING)) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2' } as never)
  vi.mocked(fetchAuthStatus).mockResolvedValue({ credentials: [] })
  vi.mocked(fetchLLMProviders).mockResolvedValue({ providers: PROVIDERS })
  vi.mocked(fetchModelCatalog).mockResolvedValue({ catalog: {} })
  vi.mocked(fetchLiveModelCatalog).mockResolvedValue({ models: [] })
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('AddModelRow steps (429-25 Task 2)', () => {
  it('ADD-STEPS-IN-ORDER: only How do you connect? at first, then only that choice\'s fields, the name, then Connect; a new choice clears step 2', async () => {
    await mount()
    expect(addRow()).not.toBeNull()
    expect(addState()).toBe('choosing')
    const legend = addRow()!.querySelector('[data-add-step="connect"] legend')
    expect(legend?.textContent).toBe(CONNECT_FORM_LEGEND)
    expect(radios()).toHaveLength(CONNECTION_CHOICES.length)
    expect(radios().every((item) => item.getAttribute('aria-checked') === 'false')).toBe(true)
    for (const choice of CONNECTION_CHOICES) {
      const item = addRow()!.querySelector(`[data-connection-choice="${choice}"]`)
      expect(item?.textContent).toContain(CONNECTION_CHOICE_LABELS[choice])
      const hintId = radio(choice)?.getAttribute('aria-describedby')
      expect(hintId && document.getElementById(hintId)?.textContent).toBe(CONNECTION_CHOICE_HINTS[choice])
    }
    expect(addRow()!.querySelector('[data-add-step="fields"]')).toBeNull()
    expect(addRow()!.querySelector('[data-add-step="name"]')).toBeNull()
    expect(connectButton()).toBeNull()

    await choose('openai-compatible-key')
    expect(addState()).toBe('editing')
    const steps = Array.from(addRow()!.querySelectorAll('[data-add-step]')).map((step) => step.getAttribute('data-add-step'))
    expect(steps).toEqual(['connect', 'fields', 'name'])
    const fields = Array.from(addRow()!.querySelectorAll('[data-add-step="fields"] [data-add-field]')).map((field) =>
      field.getAttribute('data-add-field'),
    )
    expect(fields).toEqual(['baseURL', 'model', 'key'])
    expect(fieldEl('baseURL')?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.baseUrl)
    expect(fieldEl('model')?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.model)
    expect(fieldEl('key')?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.apiKey)
    expect(input('key')?.type).toBe('password')
    expect(fieldEl('name')?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.name)
    const connect = connectButton()
    expect(connect?.textContent?.trim()).toBe(CONNECT_LABEL)
    expect(connect?.getAttribute('data-variant')).toBe('default')
    const order = [fieldEl('key')!, fieldEl('name')!, connect!]
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await type(input('baseURL'), 'https://llm.example.com/v1')
    await type(input('key'), TYPED_KEY)
    await choose('gemini-key')
    expect(Array.from(addRow()!.querySelectorAll('[data-add-step="fields"] [data-add-field]')).map((field) =>
      field.getAttribute('data-add-field'),
    )).toEqual(['model', 'key'])
    expect(input('key')?.value).toBe('')
    await choose('openai-compatible-key')
    expect(input('baseURL')?.value).toBe('')
    expect(input('key')?.value).toBe('')
    expect(container!.innerHTML).not.toContain(TYPED_KEY)
  })

  it('NAME-PREFILL-FOLLOWS-MODEL: the name follows the model id until it is edited', async () => {
    await mount()
    await choose('openai-compatible-key')
    await type(input('model'), 'gpt-5.6')
    expect(input('name')?.value).toBe('gpt-5.6')
    await type(input('model'), 'models/Gemini 2.5 Pro')
    expect(input('name')?.value).toBe('models-gemini-2.5-pro')
    expect(input('name')?.className).toContain('font-mono')

    await type(input('name'), 'my-model')
    await type(input('model'), 'gpt-5.7')
    expect(input('name')?.value).toBe('my-model')
  })

  it('ADD-NAME-VALIDATION: the name rule and a taken name on blur; Connect with an invalid field starts nothing and focuses it', async () => {
    await mount()
    await choose('openai-compatible-key')
    await type(input('name'), 'GPT-5')
    await blur(input('name'))
    expect(fieldError('name')).toBe(NAME_RULE_ERROR)
    expect(input('name')?.getAttribute('aria-invalid')).toBe('true')

    await type(input('name'), 'flash')
    await blur(input('name'))
    expect(fieldError('name')).toBe(nameTakenError('flash'))

    await type(input('name'), 'gpt-5.6')
    await blur(input('name'))
    expect(fieldError('name')).toBeNull()

    await click(connectButton())
    expect(connectLLM).not.toHaveBeenCalled()
    expect(fieldError('baseURL')).not.toBeNull()
    expect(fieldError('model')).not.toBeNull()
    expect(document.activeElement).toBe(input('baseURL'))

    await type(input('baseURL'), 'https://llm.example.com/v1')
    await type(input('model'), 'gpt-5.6')
    await type(input('name'), 'Bad Name')
    await click(connectButton())
    expect(connectLLM).not.toHaveBeenCalled()
    expect(fieldError('name')).toBe(NAME_RULE_ERROR)
    expect(document.activeElement).toBe(input('name'))
  })
})

describe('AddModelRow Connect (429-25 Task 2)', () => {
  it('CONNECT-PASS-BECOMES-SAVED-ROW: a pass replaces the add row with the saved, open row, its line and focus on its header', async () => {
    await mount()
    await fillOpenAiCompatible()
    const pending = deferred<Awaited<ReturnType<typeof connectLLM>>>()
    vi.mocked(connectLLM).mockReturnValueOnce(pending.promise)
    await click(connectButton())

    expect(connectLLM).toHaveBeenCalledTimes(1)
    expect(vi.mocked(connectLLM).mock.calls[0][0]).toEqual({
      name: 'gpt-5.6',
      provider: 'openai-compatible',
      model: 'gpt-5.6',
      baseURL: 'https://llm.example.com/v1',
      credential: { type: 'api-key', secret: TYPED_KEY },
    })
    expect(addState()).toBe('connecting')
    expect(connectButton()?.textContent?.trim()).toBe(CONNECTING_LABEL)
    expect(connectButton()?.getAttribute('aria-disabled')).toBe('true')
    expect(addRow()!.querySelector('[data-test-result="testing"]')?.textContent).toBe(TEST_RESULT_TEXT.testing)
    expect(input('model')?.readOnly).toBe(true)

    const saved = modelsConfig([...EXISTING, { name: 'gpt-5.6', provider: 'openai-compatible', model: 'gpt-5.6', baseURL: 'https://llm.example.com/v1' }], 'gpt-5.6')
    vi.mocked(fetchConfig).mockResolvedValue(answer(saved, 'rev-9') as never)
    await act(async () => {
      pending.resolve({ success: true, saved: true, becameDefault: true, usedCredential: true, revision: 'rev-9' })
    })
    await flush()
    await flush()

    expect(addRow()).toBeNull()
    const savedRow = row('gpt-5.6')
    expect(savedRow?.getAttribute('data-model-open')).toBe('true')
    const line = savedRow!.querySelector('[data-model-landing]')
    expect(line?.textContent).toContain(connectedSavedText('gpt-5.6'))
    expect(line?.textContent).toContain(BECAME_DEFAULT_TEXT)
    expect(buttonsNamed(line, MAKE_DEFAULT_LABEL)).toHaveLength(0)
    expect(document.activeElement).toBe(savedRow!.querySelector('[data-model-row-toggle]'))
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(storedText()).not.toContain('gpt-5.6')
    await unmount()

    vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig(EXISTING, 'flash')) as never)
    await mount()
    await fillOpenAiCompatible('gpt-5.6')
    const kept = modelsConfig([...EXISTING, { name: 'gpt-5.6', provider: 'openai-compatible', model: 'gpt-5.6', baseURL: 'https://llm.example.com/v1' }], 'flash')
    vi.mocked(fetchConfig).mockResolvedValue(answer(kept, 'rev-10') as never)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: true, saved: true, becameDefault: false, usedCredential: true, revision: 'rev-10' })
    await click(connectButton())
    await flush()
    const other = row('gpt-5.6')!.querySelector('[data-model-landing]')
    expect(other?.textContent).toContain(connectedSavedText('gpt-5.6'))
    expect(other?.textContent).not.toContain(BECAME_DEFAULT_TEXT)
    const makeDefault = buttonsNamed(other, MAKE_DEFAULT_LABEL)
    expect(makeDefault).toHaveLength(1)
    expect(makeDefault[0].getAttribute('data-size')).toBe('xs')
    expect(makeDefault[0].getAttribute('data-variant')).toBe('outline')
  })

  it('ADD-FLOW-NO-WRITE-BEFORE-CONNECT: choosing, typing, blurring and a failed Connect never write the config file', async () => {
    await mount()
    await choose('anthropic-compatible-key')
    await type(input('baseURL'), 'https://llm.example.com')
    await blur(input('baseURL'))
    await type(input('model'), 'claude-sonnet-4.5')
    await blur(input('model'))
    await type(input('key'), TYPED_KEY)
    await blur(input('key'))
    await type(input('name'), 'sonnet')
    await blur(input('name'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await flush()
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'The key was refused.' })
    await click(connectButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    await flush()

    expect(connectLLM).toHaveBeenCalledTimes(1)
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(addRow()).not.toBeNull()
    expect(storedText()).not.toContain(TYPED_KEY)
  })

  it('CONNECT-FAIL-KEEPS-DRAFT: a failed Connect shows the server sentence and keeps every field, the typed key included', async () => {
    await mount()
    await fillOpenAiCompatible()
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'The endpoint refused the key.' })
    await click(connectButton())

    expect(addState()).toBe('failed')
    expect(addRow()!.querySelector('[data-test-result="failed"]')?.textContent).toBe('The endpoint refused the key.')
    expect(input('baseURL')?.value).toBe('https://llm.example.com/v1')
    expect(input('model')?.value).toBe('gpt-5.6')
    expect(input('key')?.value).toBe(TYPED_KEY)
    expect(input('name')?.value).toBe('gpt-5.6')
    expect(input('model')?.readOnly).toBe(false)
    expect(connectButton()?.textContent?.trim()).toBe(CONNECT_LABEL)

    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Still refused.' })
    await click(connectButton())
    expect(connectLLM).toHaveBeenCalledTimes(2)
    expect(vi.mocked(connectLLM).mock.calls[1][0].credential).toEqual({ type: 'api-key', secret: TYPED_KEY })
    expect(addRow()!.querySelector('[data-test-result="failed"]')?.textContent).toBe('Still refused.')
  })

  it('SAVE-WITHOUT-TESTING-ONLY-AFTER-FAILURE: Save without testing appears only after a failed test and saves through connect with skipTest', async () => {
    await mount()
    await fillOpenAiCompatible()
    expect(buttonsNamed(addRow(), SAVE_WITHOUT_TESTING_LABEL)).toHaveLength(0)

    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'network_error', message: 'Could not reach the endpoint.' })
    await click(connectButton())
    const save = buttonsNamed(addRow(), SAVE_WITHOUT_TESTING_LABEL)
    expect(save).toHaveLength(1)
    expect(save[0].getAttribute('data-variant')).toBe('link')

    const saved = modelsConfig([...EXISTING, { name: 'gpt-5.6', provider: 'openai-compatible', model: 'gpt-5.6', baseURL: 'https://llm.example.com/v1' }])
    vi.mocked(fetchConfig).mockResolvedValue(answer(saved, 'rev-3') as never)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: true, saved: true, becameDefault: false, usedCredential: true, revision: 'rev-3' })
    await click(save[0])
    await flush()

    expect(connectLLM).toHaveBeenCalledTimes(2)
    expect(vi.mocked(connectLLM).mock.calls[1][0]).toEqual({
      name: 'gpt-5.6',
      provider: 'openai-compatible',
      model: 'gpt-5.6',
      baseURL: 'https://llm.example.com/v1',
      credential: { type: 'api-key', secret: TYPED_KEY },
      skipTest: true,
    })
    expect(addRow()).toBeNull()
    expect(row('gpt-5.6')?.querySelector('[data-model-landing]')?.textContent).toContain(SAVED_WITHOUT_TEST_TEXT)
    expect(applyConfigChanges).not.toHaveBeenCalled()
  })

  it('a refused name from the server marks the name field and keeps the draft', async () => {
    await mount()
    await fillOpenAiCompatible()
    vi.mocked(connectLLM).mockRejectedValueOnce(new ApiError(409, 'Conflict', { error: 'name_taken' }))
    await click(connectButton())
    expect(addRow()).not.toBeNull()
    expect(fieldError('name')).toBe(nameTakenError('gpt-5.6'))
    expect(input('key')?.value).toBe(TYPED_KEY)
    expect(buttonsNamed(addRow(), SAVE_WITHOUT_TESTING_LABEL)).toHaveLength(0)
  })
})

describe('AddModelRow sign-in choices (429-25 Task 2)', () => {
  it('SIGN-IN-CHOICE-WITHOUT-PLUGIN: a sign-in choice whose plugin is not registered names the plugin to add and offers no Sign in', async () => {
    vi.mocked(fetchLLMProviders).mockResolvedValue({
      providers: PROVIDERS.filter((provider) => provider.id !== 'anthropic-subscription'),
    })
    await mount()
    await choose('claude-sign-in')
    const line = addRow()!.querySelector('[data-sign-in-plugin-missing]')
    expect(line?.textContent).toBe(signInPluginMissingText(CONNECTION_CHOICE_LABELS['claude-sign-in']))
    expect(line?.textContent).toContain('@vostride/agent-qa-subscription-auth')
    expect(buttonsNamed(addRow(), CONNECTION_CHOICE_LABELS['claude-sign-in'])).toHaveLength(0)
    expect(connectButton()).toBeNull()
    expect(input('key')).toBeNull()

    await choose('chatgpt-sign-in')
    expect(addRow()!.querySelector('[data-sign-in-plugin-missing]')).toBeNull()
    expect(input('model')?.value).toBe('gpt-5.6')
    expect(input('key')).toBeNull()
  })
})
