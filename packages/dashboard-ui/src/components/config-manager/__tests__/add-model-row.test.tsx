// @vitest-environment jsdom

// THE CONTINUOUS ADD FLOW (429-25 · D-13, D-14, D-15, D-17, research A8 · UI-SPEC S5, E5 · PXH-CONF-03).
//
// How you connect comes first, then only that choice's fields, then the name, then Connect. The
// test runs on Connect and only a passing model is written, by the connect door alone: the page
// never writes a draft to the config file. A failure keeps everything, the typed key included, and
// only then offers Save without testing.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelList } from '@/components/config-manager/model-list'
import { ConfigAutosaveProvider, useConfigAutosave } from '@/hooks/use-config-autosave'
import {
  ApiError,
  applyConfigChanges,
  connectLLM,
  deleteAuthCredential,
  exchangePluginAuthCode,
  fetchAuthStatus,
  fetchConfig,
  fetchConfigRevision,
  fetchLLMProviders,
  fetchLiveModelCatalog,
  fetchModelCatalog,
  moveCredential,
  pollPluginAuthResult,
  startPluginAuth,
  type AuthCredentialInfo,
  type LLMProviderMetadata,
} from '@/lib/api'
import {
  ADD_FLOW_FIELD_LABELS,
  ADD_MODEL_LABEL,
  BECAME_DEFAULT_TEXT,
  CANCEL_SIGN_IN_LABEL,
  DISCARD_DRAFT_LABEL,
  CONNECTING_LABEL,
  CONNECTION_CHOICE_HINTS,
  CONNECTION_CHOICE_LABELS,
  CONNECT_FORM_LEGEND,
  CONNECT_LABEL,
  MAKE_DEFAULT_LABEL,
  NAME_RULE_ERROR,
  REPLACE_KEY_LABEL,
  SAVED_WITHOUT_TEST_TEXT,
  SAVE_WITHOUT_TESTING_LABEL,
  SIGN_IN_TIMED_OUT_TEXT,
  SIGN_IN_WAITING_LABEL,
  SIGN_IN_WAITING_TEXT,
  TEST_RESULT_TEXT,
  connectedSavedText,
  existingCredentialLine,
  nameCredentialConflictError,
  nameTakenError,
  signInFailedText,
  signInPluginMissingText,
} from '@/lib/config-copy'
import { ADD_MODEL_DRAFT_STORAGE_PREFIX } from '@/lib/add-model-draft'
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
  startPluginAuth: vi.fn(),
  pollPluginAuthResult: vi.fn(),
  exchangePluginAuthCode: vi.fn(),
  moveCredential: vi.fn(),
  deleteAuthCredential: vi.fn(),
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

let navigateTo: NavigateFunction | undefined

function LocationProbe() {
  const location = useLocation()
  navigateTo = useNavigate()
  return <div data-testid="location" data-pathname={location.pathname} data-search={location.search} />
}

function location() {
  const probe = container?.querySelector('[data-testid="location"]')
  return { pathname: probe?.getAttribute('data-pathname'), search: probe?.getAttribute('data-search') }
}

async function go(path: string) {
  await act(async () => {
    navigateTo!(path)
  })
  await flush()
  await flush()
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
  navigateTo = undefined
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

let openSpy: ReturnType<typeof vi.spyOn> | undefined

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
  vi.mocked(pollPluginAuthResult).mockResolvedValue({ status: 'pending' })
  vi.mocked(moveCredential).mockResolvedValue({ moved: true })
  vi.mocked(deleteAuthCredential).mockResolvedValue({ deleted: true })
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(async () => {
  await unmount()
  openSpy?.mockRestore()
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

const DRAFT_KEY = `${ADD_MODEL_DRAFT_STORAGE_PREFIX}${CONFIG_PATH}`

function addRows() {
  return container?.querySelectorAll('[data-model-list] > li[data-model-draft]') ?? []
}

function headingAdd() {
  return container?.querySelector<HTMLButtonElement>('[data-model-add]') ?? null
}

describe('The add row in the list (429-25 Task 3)', () => {
  it('ONE-ADD-ROW: Add model opens one add row first in the list; Add model or ?add while it is open focuses it instead', async () => {
    await mount('/config/models')
    expect(addRow()).toBeNull()
    await click(headingAdd())
    expect(addRows()).toHaveLength(1)
    expect(container!.querySelector('[data-model-list] > li')).toBe(addRow())
    expect(document.activeElement).toBe(radio(CONNECTION_CHOICES[0]))
    expect(location()).toEqual({ pathname: '/config/models', search: '' })

    await choose('openai-compatible-key')
    await type(input('model'), 'a-very-long-model-id/with-a-path/and-more-segments-than-fit-in-the-input')
    await click(headingAdd())
    expect(addRows()).toHaveLength(1)
    expect(document.activeElement).toBe(radio('openai-compatible-key'))
    expect(input('model')?.value).toBe('a-very-long-model-id/with-a-path/and-more-segments-than-fit-in-the-input')

    await go('/config/models?add')
    expect(addRows()).toHaveLength(1)
    expect(document.activeElement).toBe(radio('openai-compatible-key'))
    expect(location()).toEqual({ pathname: '/config/models', search: '' })
    expect(input('model')?.value).toBe('a-very-long-model-id/with-a-path/and-more-segments-than-fit-in-the-input')

    for (const field of ['baseURL', 'model', 'key', 'name']) {
      expect(input(field)?.className, field).toContain('w-full')
      expect(input(field)?.className, field).toContain('max-w-md')
    }
    expect(connectButton()?.parentElement?.className).toContain('flex-wrap')
    expect(addRow()!.querySelector('[data-add-step="connect"] [role="radiogroup"]')?.className).toContain('gap-2')
    expect(applyConfigChanges).not.toHaveBeenCalled()
  })

  it('ADD-DEEP-LINK: ?add opens the add row on the first choice, ?add={choice} selects it and focuses its first field, and the link is consumed', async () => {
    await mount('/config/models?add')
    expect(addRows()).toHaveLength(1)
    expect(addState()).toBe('choosing')
    expect(document.activeElement).toBe(radio(CONNECTION_CHOICES[0]))
    expect(location()).toEqual({ pathname: '/config/models', search: '' })
    await unmount()
    localStorage.clear()

    await mount('/config/models?add=gemini-key')
    expect(radio('gemini-key')?.getAttribute('aria-checked')).toBe('true')
    expect(addState()).toBe('editing')
    expect(document.activeElement).toBe(input('model'))
    expect(location()).toEqual({ pathname: '/config/models', search: '' })
    await unmount()
    localStorage.clear()

    await mount('/config/models?add=openai-compatible-key')
    expect(document.activeElement).toBe(input('baseURL'))
    await unmount()
    localStorage.clear()

    await mount('/config/models?add=not-a-choice')
    expect(addState()).toBe('choosing')
    expect(document.activeElement).toBe(radio(CONNECTION_CHOICES[0]))
  })

  it('ADD-DRAFT-RESTORED-WITHOUT-SECRETS: a reload re-opens the add row with its non-secret fields and every secret field empty', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ choice: 'openai-compatible-key', baseURL: 'https://llm.example.com/v1', model: 'gpt-5.6', name: 'gpt-5.6', nameEdited: false }),
    )
    await mount('/config/models')
    expect(addRows()).toHaveLength(1)
    expect(radio('openai-compatible-key')?.getAttribute('aria-checked')).toBe('true')
    expect(input('baseURL')?.value).toBe('https://llm.example.com/v1')
    expect(input('model')?.value).toBe('gpt-5.6')
    expect(input('name')?.value).toBe('gpt-5.6')
    expect(input('key')?.value).toBe('')

    await choose('anthropic-compatible-key')
    await type(input('baseURL'), 'https://claude.example.com')
    await type(input('model'), 'claude-sonnet-4.5')
    await click(addRow()!.querySelector<HTMLButtonElement>('[data-add-field="keyType"] [role="radio"][value="bearer-token"]'))
    await type(input('key'), TYPED_KEY)
    await type(input('name'), 'sonnet')
    await click(buttonsNamed(addRow(), 'Add header')[0])
    const [headerName, headerValue] = Array.from(addRow()!.querySelectorAll<HTMLInputElement>('[data-add-header] input'))
    await type(headerName, 'X-Team')
    await type(headerValue, 'header-secret')
    expect(storedText()).not.toContain(TYPED_KEY)
    expect(storedText()).not.toContain('header-secret')
    await unmount()

    await mount('/config/models')
    expect(radio('anthropic-compatible-key')?.getAttribute('aria-checked')).toBe('true')
    expect(input('baseURL')?.value).toBe('https://claude.example.com')
    expect(input('model')?.value).toBe('claude-sonnet-4.5')
    expect(input('name')?.value).toBe('sonnet')
    expect(addRow()!.querySelector('[data-add-field="keyType"] [role="radio"][value="bearer-token"]')?.getAttribute('aria-checked')).toBe('true')
    expect(fieldEl('key')?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.token)
    expect(input('key')?.value).toBe('')
    const restored = Array.from(addRow()!.querySelectorAll<HTMLInputElement>('[data-add-header] input'))
    expect(restored.map((item) => item.value)).toEqual(['X-Team', ''])
    expect(container!.innerHTML).not.toContain(TYPED_KEY)
    expect(container!.innerHTML).not.toContain('header-secret')
  })

  it('DISCARD-DRAFT: Discard removes the row at once with no question and focuses Add model; Escape does not discard', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mount('/config/models?add')
    await fillOpenAiCompatible()
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()

    await act(async () => {
      input('model')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    expect(addRow()).not.toBeNull()
    expect(input('key')?.value).toBe(TYPED_KEY)

    const discard = addRow()!.querySelector<HTMLButtonElement>('[data-discard-draft]')
    expect(discard?.textContent?.trim()).toBe(DISCARD_DRAFT_LABEL)
    expect(discard?.getAttribute('data-variant')).toBe('ghost')
    await click(discard)
    expect(addRow()).toBeNull()
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(document.activeElement).toBe(headingAdd())
    expect(document.activeElement?.textContent?.trim()).toBe(ADD_MODEL_LABEL)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
    expect(container!.textContent).not.toContain('Undo')
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(connectLLM).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
    await unmount()

    vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig([])) as never)
    await mount('/config/models?add')
    await click(addRow()!.querySelector<HTMLButtonElement>('[data-discard-draft]'))
    const emptyAdd = container!.querySelector('[data-models-empty] button')
    expect(emptyAdd).not.toBeNull()
    expect(document.activeElement).toBe(emptyAdd)
  })
})

// SIGN-IN DRAFTS, EXISTING CREDENTIALS, COLLISIONS, RENAMES AND DISCARD (429-26 · D-15, D-16, D-17,
// research A3 · UI-SPEC S5, E5). A sign-in choice signs the draft name in with no save first, then
// the test runs by itself; a name that already holds this provider's credential only tests; another
// provider's credential is never touched; a draft's own sign-in follows its name, and Discard removes
// only a credential this draft created.

const AUTHORIZE_URL = 'https://auth.example/authorize'
const HOUR = 60 * 60 * 1000

function signInButton() {
  return addRow()?.querySelector<HTMLButtonElement>('[data-add-sign-in]') ?? null
}

function existingLine() {
  return addRow()?.querySelector<HTMLElement>('[data-existing-credential]') ?? null
}

function failedLine() {
  return addRow()?.querySelector('[data-test-result="failed"]')?.textContent ?? null
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
  await flush()
}

function answerSignIn(mode: 'browser-poll' | 'manual-code', created: boolean) {
  vi.mocked(startPluginAuth).mockResolvedValueOnce({ authorizeUrl: AUTHORIZE_URL, sessionId: 'session-1', mode, created })
}

function heldCredentials(...items: Array<Pick<AuthCredentialInfo, 'configName' | 'provider' | 'type'>>): AuthCredentialInfo[] {
  return items.map((item) => ({ ...item, expires: item.type === 'oauth' ? Date.now() + HOUR : null, source: 'auth-store' }))
}

/** Signs gpt-5.6 in with ChatGPT through a browser poll whose test then fails, so the draft stays. */
async function signInThenFailTest(created: boolean) {
  await choose('chatgpt-sign-in')
  answerSignIn('browser-poll', created)
  await click(signInButton())
  vi.mocked(pollPluginAuthResult).mockResolvedValueOnce({ status: 'completed', saved: true })
  vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'The plan refused the model.' })
  await advance(2000)
}

describe('AddModelRow sign-in drafts (429-26 Task 2)', () => {
  it('SIGN-IN-DRAFT-BROWSER-POLL: Sign in with Claude signs the draft name in with no save, then the test runs by itself and a pass saves it', async () => {
    await mount()
    await choose('claude-sign-in')
    expect(input('model')?.value).toBe('claude-sonnet-4.5')
    await type(input('name'), 'claude-draft')
    const button = signInButton()
    expect(button?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['claude-sign-in'])
    expect(button?.getAttribute('data-variant')).toBe('default')
    expect(button?.querySelector('svg')).not.toBeNull()
    expect(connectButton()).toBeNull()

    answerSignIn('browser-poll', true)
    await click(button)
    expect(startPluginAuth).toHaveBeenCalledWith('anthropic-subscription', 'claude-draft')
    expect(openSpy!.mock.calls[0][0]).toBe(AUTHORIZE_URL)
    expect(openSpy!.mock.calls[0][1]).toBe('_blank')
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(connectLLM).not.toHaveBeenCalled()
    expect(addState()).toBe('signing-in')
    expect(signInButton()?.textContent?.trim()).toBe(SIGN_IN_WAITING_LABEL)
    expect(signInButton()?.getAttribute('aria-disabled')).toBe('true')
    const waiting = addRow()!.querySelector('[data-sign-in-waiting]')
    expect(waiting?.textContent).toContain(SIGN_IN_WAITING_TEXT)
    const cancel = buttonsNamed(waiting, CANCEL_SIGN_IN_LABEL)
    expect(cancel).toHaveLength(1)
    expect(cancel[0].getAttribute('data-variant')).toBe('link')
    expect(input('name')?.readOnly).toBe(true)

    await advance(2000)
    expect(pollPluginAuthResult).toHaveBeenCalledWith('anthropic-subscription', 'session-1')
    expect(connectLLM).not.toHaveBeenCalled()

    const saved = modelsConfig([...EXISTING, { name: 'claude-draft', provider: 'anthropic-subscription', model: 'claude-sonnet-4.5' }])
    vi.mocked(fetchConfig).mockResolvedValue(answer(saved, 'rev-4') as never)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: true, saved: true, becameDefault: true, usedCredential: true, revision: 'rev-4' })
    vi.mocked(pollPluginAuthResult).mockResolvedValueOnce({ status: 'completed', saved: true })
    await advance(2000)
    await flush()

    expect(connectLLM).toHaveBeenCalledTimes(1)
    expect(vi.mocked(connectLLM).mock.calls[0][0]).toEqual({
      name: 'claude-draft',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4.5',
    })
    expect(addRow()).toBeNull()
    expect(row('claude-draft')?.querySelector('[data-model-landing]')?.textContent).toContain(connectedSavedText('claude-draft'))
    expect(applyConfigChanges).not.toHaveBeenCalled()
    await advance(20_000)
    expect(pollPluginAuthResult).toHaveBeenCalledTimes(2)
  })

  it('SIGN-IN-DRAFT-MANUAL-CODE: the manual mode shows Code from the sign-in page and Connect, which exchanges the code and then tests', async () => {
    await mount()
    await choose('claude-sign-in')
    answerSignIn('manual-code', true)
    await click(signInButton())

    expect(addState()).toBe('signing-in')
    const codeField = addRow()!.querySelector('[data-sign-in-code]')
    expect(codeField?.querySelector('label')?.textContent).toBe(ADD_FLOW_FIELD_LABELS.signInCode)
    const codeInput = codeField?.querySelector<HTMLInputElement>('input') ?? null
    expect(codeInput?.type).toBe('password')
    const codeConnect = codeField?.querySelector<HTMLButtonElement>('[data-sign-in-code-connect]') ?? null
    expect(codeConnect?.textContent?.trim()).toBe(CONNECT_LABEL)
    expect(codeConnect?.getAttribute('data-variant')).toBe('default')
    expect(signInButton()?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['claude-sign-in'])

    await type(codeInput, 'code-from-page')
    expect(storedText()).not.toContain('code-from-page')
    vi.mocked(exchangePluginAuthCode).mockResolvedValueOnce({ status: 'completed', saved: true })
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'The plan refused the model.' })
    await click(codeConnect)
    await flush()

    expect(exchangePluginAuthCode).toHaveBeenCalledWith('anthropic-subscription', 'session-1', 'code-from-page')
    expect(vi.mocked(connectLLM).mock.calls[0][0]).toEqual({
      name: 'claude-sonnet-4.5',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4.5',
    })
    expect(pollPluginAuthResult).not.toHaveBeenCalled()
    expect(addRow()!.querySelector('[data-sign-in-code]')).toBeNull()
    expect(container!.innerHTML).not.toContain('code-from-page')
    expect(storedText()).not.toContain('code-from-page')
  })

  it('SIGN-IN-FAILED-LINE: a sign-in failure shows signInFailedText and the button returns; a completed sign-in whose test fails offers Save without testing', async () => {
    await mount()
    await choose('chatgpt-sign-in')
    answerSignIn('browser-poll', true)
    await click(signInButton())
    vi.mocked(pollPluginAuthResult).mockResolvedValueOnce({ status: 'error', error: 'The sign-in was denied.' })
    await advance(2000)

    expect(failedLine()).toBe(signInFailedText('The sign-in was denied.'))
    expect(addState()).toBe('failed')
    expect(signInButton()?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['chatgpt-sign-in'])
    expect(signInButton()?.getAttribute('aria-disabled')).toBeNull()
    expect(connectLLM).not.toHaveBeenCalled()
    expect(buttonsNamed(addRow(), SAVE_WITHOUT_TESTING_LABEL)).toHaveLength(0)

    answerSignIn('browser-poll', true)
    await click(signInButton())
    expect(failedLine()).toBeNull()
    vi.mocked(pollPluginAuthResult).mockResolvedValueOnce({ status: 'completed', saved: true })
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'The plan refused the model.' })
    await advance(2000)

    expect(connectLLM).toHaveBeenCalledTimes(1)
    expect(failedLine()).toBe('The plan refused the model.')
    expect(buttonsNamed(addRow(), SAVE_WITHOUT_TESTING_LABEL)).toHaveLength(1)
    expect(existingLine()?.textContent).toContain(existingCredentialLine('sign-in', 'gpt-5.6'))
    expect(signInButton()).toBeNull()
    expect(connectButton()?.textContent?.trim()).toBe(CONNECT_LABEL)
  })

  it('SIGN-IN-WAITING-CANCEL-AND-TIMEOUT: Cancel sign-in returns the button with no line; five minutes without a result shows the timed-out line', async () => {
    await mount()
    await choose('chatgpt-sign-in')
    answerSignIn('browser-poll', true)
    await click(signInButton())
    await click(buttonsNamed(addRow()!.querySelector('[data-sign-in-waiting]'), CANCEL_SIGN_IN_LABEL)[0])
    expect(addState()).toBe('editing')
    expect(signInButton()?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['chatgpt-sign-in'])
    expect(addRow()!.querySelector('[data-test-result]')).toBeNull()
    await advance(10_000)
    expect(pollPluginAuthResult).not.toHaveBeenCalled()

    answerSignIn('browser-poll', true)
    await click(signInButton())
    await advance(5 * 60 * 1000)
    expect(failedLine()).toBe(SIGN_IN_TIMED_OUT_TEXT)
    expect(signInButton()?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['chatgpt-sign-in'])
    expect(connectLLM).not.toHaveBeenCalled()
  })
})

describe('AddModelRow existing credentials and collisions (429-26 Task 2)', () => {
  it('EXISTING-CREDENTIAL-CONNECT-ONLY-TESTS: a name holding this provider\'s credential shows the existing line and Connect only tests; key modes offer Replace key', async () => {
    vi.mocked(fetchAuthStatus).mockResolvedValue({
      credentials: heldCredentials(
        { configName: 'claude', provider: 'anthropic-subscription', type: 'oauth' },
        { configName: 'router', provider: 'openai-compatible', type: 'api' },
      ),
    })
    await mount()
    await choose('claude-sign-in')
    await type(input('name'), 'claude')
    await blur(input('name'))
    expect(existingLine()?.textContent).toContain(existingCredentialLine('sign-in', 'claude'))
    expect(signInButton()).toBeNull()
    expect(connectButton()?.textContent?.trim()).toBe(CONNECT_LABEL)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Expired.' })
    await click(connectButton())
    expect(vi.mocked(connectLLM).mock.calls[0][0]).toEqual({
      name: 'claude',
      provider: 'anthropic-subscription',
      model: 'claude-sonnet-4.5',
    })
    expect(startPluginAuth).not.toHaveBeenCalled()
    await unmount()
    localStorage.clear()
    vi.mocked(connectLLM).mockClear()

    await mount()
    await choose('openai-compatible-key')
    await type(input('baseURL'), 'https://llm.example.com/v1')
    await type(input('model'), 'gpt-5.6')
    await type(input('name'), 'router')
    expect(input('key')).toBeNull()
    expect(existingLine()?.textContent).toContain(existingCredentialLine('key', 'router'))
    const replace = buttonsNamed(existingLine(), REPLACE_KEY_LABEL)
    expect(replace).toHaveLength(1)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Refused.' })
    await click(connectButton())
    expect(vi.mocked(connectLLM).mock.calls[0][0]).toEqual({
      name: 'router',
      provider: 'openai-compatible',
      model: 'gpt-5.6',
      baseURL: 'https://llm.example.com/v1',
    })

    await click(replace[0])
    expect(existingLine()).toBeNull()
    expect(document.activeElement).toBe(input('key'))
    await type(input('key'), TYPED_KEY)
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Refused.' })
    await click(connectButton())
    expect(vi.mocked(connectLLM).mock.calls[1][0].credential).toEqual({ type: 'api-key', secret: TYPED_KEY })
  })

  it('NAME-CONFLICT-BLOCKS: a name holding another provider\'s credential shows the conflict hint and neither Connect nor Sign in starts anything', async () => {
    vi.mocked(fetchAuthStatus).mockResolvedValue({
      credentials: heldCredentials({ configName: 'shared', provider: 'anthropic-compatible', type: 'api' }),
    })
    await mount()
    await fillOpenAiCompatible()
    await type(input('name'), 'shared')
    await blur(input('name'))
    const conflict = nameCredentialConflictError('shared', 'Anthropic-compatible')
    expect(fieldError('name')).toBe(conflict)
    expect(input('name')?.getAttribute('aria-invalid')).toBe('true')
    expect(existingLine()).toBeNull()
    await click(connectButton())
    expect(connectLLM).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input('name'))

    await choose('chatgpt-sign-in')
    expect(input('name')?.value).toBe('shared')
    await click(signInButton())
    expect(startPluginAuth).not.toHaveBeenCalled()
    expect(fieldError('name')).toBe(conflict)
    expect(connectLLM).not.toHaveBeenCalled()
    expect(moveCredential).not.toHaveBeenCalled()
    expect(deleteAuthCredential).not.toHaveBeenCalled()
  })
})

describe('AddModelRow renames and discard after a sign-in (429-26 Task 2)', () => {
  it('NAME-EDIT-AFTER-SIGN-IN-MOVES: a renamed draft moves the sign-in it created; a sign-in it did not create is never moved', async () => {
    await mount()
    await signInThenFailTest(true)
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}').createdCredential).toBe(true)
    await type(input('name'), 'gpt-renamed')
    expect(moveCredential).not.toHaveBeenCalled()
    await blur(input('name'))
    expect(moveCredential).toHaveBeenCalledTimes(1)
    expect(moveCredential).toHaveBeenCalledWith('gpt-5.6', 'gpt-renamed', 'openai-subscription')
    expect(existingLine()?.textContent).toContain(existingCredentialLine('sign-in', 'gpt-renamed'))
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Still refused.' })
    await click(connectButton())
    expect(vi.mocked(connectLLM).mock.calls.at(-1)?.[0]).toEqual({
      name: 'gpt-renamed',
      provider: 'openai-subscription',
      model: 'gpt-5.6',
    })
    expect(startPluginAuth).toHaveBeenCalledTimes(1)
    await unmount()
    localStorage.clear()
    vi.mocked(moveCredential).mockClear()

    await mount()
    await signInThenFailTest(false)
    await type(input('name'), 'gpt-other')
    await blur(input('name'))
    expect(moveCredential).not.toHaveBeenCalled()
    expect(existingLine()).toBeNull()
    expect(signInButton()?.textContent?.trim()).toBe(CONNECTION_CHOICE_LABELS['chatgpt-sign-in'])
  })

  it('DISCARD-REMOVES-ONLY-CREATED-CREDENTIAL: Discard removes a sign-in this draft created and never one that existed before', async () => {
    await mount()
    await signInThenFailTest(true)
    await click(addRow()!.querySelector<HTMLButtonElement>('[data-discard-draft]'))
    expect(addRow()).toBeNull()
    expect(deleteAuthCredential).toHaveBeenCalledTimes(1)
    expect(deleteAuthCredential).toHaveBeenCalledWith('gpt-5.6')
    await unmount()
    localStorage.clear()
    vi.mocked(deleteAuthCredential).mockClear()

    await mount()
    await signInThenFailTest(false)
    await click(addRow()!.querySelector<HTMLButtonElement>('[data-discard-draft]'))
    expect(addRow()).toBeNull()
    expect(deleteAuthCredential).not.toHaveBeenCalled()
    await unmount()
    localStorage.clear()

    vi.mocked(fetchAuthStatus).mockResolvedValue({
      credentials: heldCredentials({ configName: 'claude', provider: 'anthropic-subscription', type: 'oauth' }),
    })
    await mount()
    await choose('claude-sign-in')
    await type(input('name'), 'claude')
    vi.mocked(connectLLM).mockResolvedValueOnce({ success: false, errorClass: 'auth_error', message: 'Expired.' })
    await click(connectButton())
    await click(addRow()!.querySelector<HTMLButtonElement>('[data-discard-draft]'))
    expect(addRow()).toBeNull()
    expect(deleteAuthCredential).not.toHaveBeenCalled()
  })
})
