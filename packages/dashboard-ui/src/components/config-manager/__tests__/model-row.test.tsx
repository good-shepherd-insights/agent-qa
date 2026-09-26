// @vitest-environment jsdom

// A SAVED MODEL'S ROW, COMPLETED (429-24 · D-12, D-17, D-23, D-24 · UI-SPEC S4, S6, E4, E6).
//
// Deleting a model, signing out and removing a key act at once and offer Undo: no dialog, no
// question. The default model cannot be deleted from under the project, eval judges stay
// consistent, and a failure puts the row or its status word back.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelList } from '@/components/config-manager/model-list'
import { ConfigAutosaveProvider, useConfigAutosave, type ConfigAutosave } from '@/hooks/use-config-autosave'
import {
  applyConfigChanges,
  deleteAuthCredential,
  fetchAuthStatus,
  fetchConfig,
  fetchConfigRevision,
  fetchLLMProviders,
  saveCredential,
  testLLMConnection,
  undoConfigAction,
  type AuthCredentialInfo,
  type LLMProviderMetadata,
} from '@/lib/api'
import {
  ADD_MODEL_LABEL,
  DEFAULT_CANNOT_DELETE_LINE,
  DELETE_MODEL_LABEL,
  MAKE_DEFAULT_LABEL,
  REMOVE_KEY_LABEL,
  SIGN_OUT_LABEL,
  USED_AS_JUDGE_LINE,
  undoLine,
} from '@/lib/config-copy'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
  fetchAuthStatus: vi.fn(),
  fetchLLMProviders: vi.fn(),
  testLLMConnection: vi.fn(),
  deleteAuthCredential: vi.fn(),
  saveCredential: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIG_PATH = '/work/agent-qa.config.yaml'
const HOUR = 60 * 60 * 1000

const PROVIDERS: LLMProviderMetadata[] = [
  { id: 'openai-compatible', label: 'OpenAI-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key'], optional: true }, needsBaseURL: true },
  { id: 'anthropic-compatible', label: 'Anthropic-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key', 'bearer-token'], optional: true }, needsBaseURL: true },
  { id: 'gemini', label: 'Gemini', auth: { kind: 'api-key', credentialTypes: ['api-key'] }, needsBaseURL: false },
  { id: 'openai-subscription', label: 'ChatGPT plan', auth: { kind: 'oauth-plugin', mode: 'browser-poll' } },
  { id: 'anthropic-subscription', label: 'Claude plan', auth: { kind: 'oauth-plugin', mode: 'manual-code' } },
]

const LLMS = [
  { name: 'gpt-5.6', provider: 'openai-subscription', model: 'gpt-5.6' },
  { name: 'flash', provider: 'gemini', model: 'gemini-2.5-flash' },
  { name: 'router', provider: 'openai-compatible', model: 'openrouter/auto', baseURL: 'https://openrouter.ai/api/v1' },
  { name: 'sonnet', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' },
]

// The credential-status read carries no secret; SECRET is what a leak would look like.
const SECRET = 'sk-live-never-in-the-page'

function credentials(): AuthCredentialInfo[] {
  return [
    { configName: 'gpt-5.6', provider: 'openai-subscription', type: 'oauth', expires: Date.now() + HOUR, source: 'auth' },
    { configName: 'flash', provider: 'gemini', type: 'api', expires: null, source: 'auth' },
    { configName: 'router', provider: 'openai-compatible', type: 'api', expires: null, source: 'auth' },
    { configName: 'sonnet', provider: 'anthropic-subscription', type: 'oauth', expires: Date.now() - HOUR, source: 'auth' },
  ]
}

function modelsConfig(
  llms: readonly Record<string, unknown>[] = LLMS,
  defaultName: string | undefined = 'flash',
  evalConfig?: Record<string, unknown>,
) {
  return {
    registry: { llms },
    use: defaultName === undefined ? {} : { llm: defaultName },
    ...(evalConfig === undefined ? {} : { eval: evalConfig }),
  }
}

function answer(config: Record<string, unknown>) {
  return { config, provider: null, revision: 'rev-1', file: { path: CONFIG_PATH, lines: [] } }
}

let hook: ConfigAutosave | undefined

function Harness() {
  const autosave = useConfigAutosave()
  hook = autosave
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

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/config/models']}>
        <Routes>
          <Route path="/config/:tab" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    )
  })
  await flush()
}

async function unmount() {
  if (root) {
    await act(async () => root!.unmount())
  }
  root = null
  container?.remove()
  container = null
  hook = undefined
}

function rows() {
  return Array.from(container?.querySelectorAll('[data-model-list] > li[data-model-row]') ?? []) as HTMLLIElement[]
}

function row(name: string) {
  return rows().find((item) => item.getAttribute('data-model-name') === name) ?? null
}

function toggle(item: Element | null) {
  return (item?.querySelector('[data-model-row-toggle]') ?? null) as HTMLButtonElement | null
}

function buttonsNamed(scope: ParentNode | null | undefined, text: string) {
  return (Array.from(scope?.querySelectorAll('button') ?? []) as HTMLButtonElement[]).filter(
    (button) => button.textContent?.trim() === text,
  )
}

function buttonNamed(scope: ParentNode | null | undefined, text: string) {
  return buttonsNamed(scope, text)[0] ?? null
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    element!.click()
  })
  await flush()
}

async function openModel(name: string) {
  const header = toggle(row(name))
  expect(header, name).not.toBeNull()
  if (header!.getAttribute('aria-expanded') !== 'true') await click(header)
  return row(name)!.querySelector('[data-model-panel]')
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function undoTicket(token: string) {
  return { token, expiresAt: Date.now() + 30_000 }
}

function noDialog() {
  expect(document.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
  expect(window.confirm).not.toHaveBeenCalled()
}

function status(name: string) {
  return row(name)?.getAttribute('data-model-status')
}

async function undo() {
  await act(async () => {
    await hook!.undo()
  })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig()) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2', undo: undoTicket('undo-config') } as never)
  vi.mocked(undoConfigAction).mockResolvedValue({ restored: true })
  vi.mocked(fetchAuthStatus).mockResolvedValue({ credentials: credentials() })
  vi.mocked(fetchLLMProviders).mockResolvedValue({ providers: PROVIDERS })
  vi.mocked(testLLMConnection).mockResolvedValue({ success: true })
  vi.mocked(deleteAuthCredential).mockResolvedValue({ deleted: true, undo: undoTicket('undo-credential') } as never)
  vi.mocked(saveCredential).mockResolvedValue({ saved: true, created: false } as never)
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('ModelRow explicit actions (429-24 Task 1)', () => {
  it('DELETE-MODEL-UNDO: Delete model removes the row at once in one undoable write, and Undo brings it back focused', async () => {
    await mount()
    const panel = await openModel('router')
    const write = deferred<{ revision: string; undo: { token: string; expiresAt: number } }>()
    vi.mocked(applyConfigChanges).mockReturnValueOnce(write.promise as never)
    await click(buttonNamed(panel, DELETE_MODEL_LABEL))

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'unset', path: ['registry', 'llms', { name: 'router' }] }], { undoable: true }],
    ])
    expect(row('router')).toBeNull()
    noDialog()

    await act(async () => {
      write.resolve({ revision: 'rev-2', undo: undoTicket('undo-router') })
    })
    await flush()
    expect(row('router')).toBeNull()
    expect(hook!.status.state).toBe('undo')
    expect(hook!.status.undo?.line).toBe(undoLine('delete-model', 'router'))
    expect(hook!.status.undo?.line).toBe('Deleted router')

    await undo()
    expect(undoConfigAction).toHaveBeenCalledWith('undo-router')
    expect(row('router')).not.toBeNull()
    expect(document.activeElement).toBe(toggle(row('router')))
  })

  it('DELETE-JUDGE-MODEL-UNDO: a judge model says so, its delete carries the judge changes, and Undo names it a judge', async () => {
    const config = modelsConfig(LLMS, 'flash', { judges: ['router', 'flash'] })
    vi.mocked(fetchConfig).mockResolvedValue(answer(config) as never)
    await mount()

    const panel = await openModel('router')
    expect(panel?.textContent).toContain(USED_AS_JUDGE_LINE)
    const other = await openModel('gpt-5.6')
    expect(other?.textContent).not.toContain(USED_AS_JUDGE_LINE)

    await openModel('router')
    await click(buttonNamed(row('router'), DELETE_MODEL_LABEL))
    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [
        [
          { op: 'unset', path: ['registry', 'llms', { name: 'router' }] },
          { op: 'unset', path: ['eval', 'judges'] },
          { op: 'set', path: ['eval', 'judge'], value: 'flash' },
        ],
        { undoable: true },
      ],
    ])
    expect(row('router')).toBeNull()
    expect(hook!.status.undo?.line).toBe(undoLine('delete-model', 'router', { judge: true }))
    expect(hook!.status.undo?.line).toBe('Deleted router, an eval judge')

    await undo()
    expect(undoConfigAction).toHaveBeenCalledWith('undo-config')
    expect(row('router')).not.toBeNull()
    await openModel('router')
    expect(row('router')!.textContent).toContain(USED_AS_JUDGE_LINE)
  })

  it('FOCUS-AFTER-MODEL-DELETE: focus moves to the next row, else the previous one, else Add model', async () => {
    vi.mocked(applyConfigChanges).mockReturnValue(new Promise(() => {}) as never)
    await mount()

    await openModel('gpt-5.6')
    await click(buttonNamed(row('gpt-5.6'), DELETE_MODEL_LABEL))
    expect(document.activeElement).toBe(toggle(row('flash')))

    await openModel('sonnet')
    await click(buttonNamed(row('sonnet'), DELETE_MODEL_LABEL))
    expect(document.activeElement).toBe(toggle(row('router')))
    await unmount()

    vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig([LLMS[2]], undefined)) as never)
    await mount()
    await openModel('router')
    await click(buttonNamed(row('router'), DELETE_MODEL_LABEL))
    expect(rows()).toHaveLength(0)
    expect((document.activeElement as HTMLElement | null)?.textContent?.trim()).toBe(ADD_MODEL_LABEL)
  })

  it('DEFAULT-CANNOT-DELETE: the default row offers no Delete model, only the line, and the others offer both', async () => {
    await mount()
    const panel = await openModel('flash')
    expect(panel?.textContent).toContain(DEFAULT_CANNOT_DELETE_LINE)
    expect(buttonNamed(panel, DELETE_MODEL_LABEL)).toBeNull()

    const other = await openModel('router')
    expect(other?.textContent).not.toContain(DEFAULT_CANNOT_DELETE_LINE)
    expect(buttonNamed(other, DELETE_MODEL_LABEL)).not.toBeNull()
    expect(buttonNamed(other, MAKE_DEFAULT_LABEL)).not.toBeNull()
    await unmount()

    // One model, and it is the default.
    vi.mocked(fetchConfig).mockResolvedValue(answer(modelsConfig([LLMS[1]], 'flash')) as never)
    await mount()
    const only = await openModel('flash')
    expect(only?.textContent).toContain(DEFAULT_CANNOT_DELETE_LINE)
    expect(buttonNamed(only, DELETE_MODEL_LABEL)).toBeNull()
  })

  it('SIGN-OUT-UNDO: Sign out acts at once through the credential door, and Undo restores the sign-in server-side', async () => {
    await mount()
    const panel = await openModel('gpt-5.6')
    const answered = deferred<{ deleted: boolean; undo: { token: string; expiresAt: number } }>()
    vi.mocked(deleteAuthCredential).mockReturnValueOnce(answered.promise as never)
    await click(buttonNamed(panel, SIGN_OUT_LABEL))

    expect(deleteAuthCredential).toHaveBeenCalledWith('gpt-5.6')
    expect(status('gpt-5.6')).toBe('not-connected')
    expect(applyConfigChanges).not.toHaveBeenCalled()
    noDialog()

    await act(async () => {
      answered.resolve({ deleted: true, undo: undoTicket('undo-signout') })
    })
    await flush()
    expect(hook!.status.state).toBe('undo')
    expect(hook!.status.undo?.line).toBe('Signed out of gpt-5.6')
    expect(container!.innerHTML).not.toContain('undo-signout')
    expect(container!.innerHTML).not.toContain(SECRET)

    await undo()
    expect(undoConfigAction).toHaveBeenCalledWith('undo-signout')
    expect(fetchAuthStatus).toHaveBeenCalledTimes(2)
    expect(status('gpt-5.6')).toBe('signed-in')
  })

  it('REMOVE-KEY-UNDO: Remove key acts at once, says so, and Undo puts the key back server-side', async () => {
    await mount()
    const panel = await openModel('flash')
    await click(buttonNamed(panel, REMOVE_KEY_LABEL))

    expect(deleteAuthCredential).toHaveBeenCalledWith('flash')
    expect(status('flash')).toBe('not-connected')
    expect(hook!.status.undo?.line).toBe('Removed the key for flash')
    expect(container!.innerHTML).not.toContain('undo-credential')
    noDialog()

    await undo()
    expect(undoConfigAction).toHaveBeenCalledWith('undo-credential')
    expect(status('flash')).toBe('key-saved')
  })

  it('EXPLICIT-FAILURE-RESTORES-ROW: a refused delete, sign-out or Undo puts things back and shows the failure', async () => {
    await mount()
    await openModel('router')
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(new Error('disk full'))
    await click(buttonNamed(row('router'), DELETE_MODEL_LABEL))
    expect(row('router')).not.toBeNull()
    expect(hook!.status.state).toBe('failed')

    await act(async () => {
      hook!.retry()
    })
    await flush()
    expect(row('router')).toBeNull()
    expect(hook!.status.state).toBe('undo')

    await openModel('gpt-5.6')
    vi.mocked(deleteAuthCredential).mockRejectedValueOnce(new Error('auth store locked'))
    await click(buttonNamed(row('gpt-5.6'), SIGN_OUT_LABEL))
    expect(status('gpt-5.6')).toBe('signed-in')
    expect(hook!.status.state).toBe('failed')

    // Retry runs the sign-out again.
    await act(async () => {
      hook!.retry()
    })
    await flush()
    expect(deleteAuthCredential).toHaveBeenCalledTimes(2)
    expect(status('gpt-5.6')).toBe('not-connected')
    expect(hook!.status.state).toBe('undo')

    vi.mocked(undoConfigAction).mockRejectedValueOnce(new Error('expired'))
    await undo()
    expect(hook!.status.state).toBe('failed')
    expect(status('gpt-5.6')).toBe('not-connected')
  })
})
