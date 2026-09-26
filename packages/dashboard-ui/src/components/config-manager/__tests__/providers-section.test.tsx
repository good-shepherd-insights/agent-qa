// @vitest-environment jsdom

// DEVICE FARMS AS PER-KEY SECRET ROWS (429-19 Task 2 · D-08, D-09, D-23, D-24 · UI-SPEC S8, E8).
//
// registry.providers is secret wholesale, so every farm setting is a SecretValue: masked, revealed
// per click, replaced explicitly. Adding a setting or a farm is an explicit write; deleting a farm
// acts at once and offers Undo. No value is ever held editable in masked form.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProvidersSection } from '@/components/config-manager/providers-section'
import { ConfigAutosaveProvider, useConfigAutosave, type ConfigAutosave } from '@/hooks/use-config-autosave'
import { applyConfigChanges, fetchConfig, fetchConfigRevision, undoConfigAction } from '@/lib/api'
import {
  ADD_DEVICE_FARM_LABEL,
  ADD_SETTING_LABEL,
  DEVICE_FARM_FIELD_LABELS,
  DISCARD_SETTING_LABEL,
  NO_DEVICE_FARMS_TEXT,
  SAVE_SETTING_LABEL,
  SETTLE_DELAY_MS,
  deleteActionName,
  deviceFarmSettingLabel,
  replaceValueName,
  showValueName,
  undoLine,
} from '@/lib/config-copy'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
  revealConfigValue: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIG_PATH = '/work/agent-qa.config.yaml'
const MASK = '[masked]'
const TYPED = 'bs-typed-secret-4K7'

const twoFarms = {
  registry: {
    providers: {
      browserstack: { accessKey: MASK, region: MASK },
      saucelabs: { username: MASK },
    },
  },
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
      <ProvidersSection config={autosave.load.answer.config} onConfigChange={autosave.refresh} />
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
    root!.render(<Harness />)
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

function list() {
  return container?.querySelector('[data-field-list="registry.providers"]') as HTMLElement | null
}

function farmRow(name: string) {
  return (Array.from(container?.querySelectorAll('[data-device-farm]') ?? []) as HTMLElement[]).find(
    (row) => row.getAttribute('data-device-farm') === name,
  ) ?? null
}

function buttonIn(scope: ParentNode | null | undefined, text: string) {
  const buttons = Array.from(scope?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.trim() === text || button.getAttribute('aria-label') === text) ?? null
}

function inputLabelled(scope: ParentNode | null | undefined, label: string) {
  const inputs = Array.from(scope?.querySelectorAll('input') ?? []) as HTMLInputElement[]
  return inputs.find((input) => input.getAttribute('aria-label') === label) ?? null
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    element!.click()
  })
  await flush()
}

async function type(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input!, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfig).mockResolvedValue(answer(twoFarms) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2' } as never)
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('ProvidersSection (429-19 Task 2)', () => {
  it('DEVICE-FARM-PER-KEY-SECRET-ROWS: each farm is a row with its name and one SecretValue per setting showing the server mask', async () => {
    await mount()

    expect(list()).not.toBeNull()
    const browserstack = farmRow('browserstack')
    const saucelabs = farmRow('saucelabs')
    expect(browserstack).not.toBeNull()
    expect(saucelabs).not.toBeNull()
    expect(browserstack!.querySelector('.font-mono')?.textContent).toBe('browserstack')

    const secrets = Array.from(browserstack!.querySelectorAll('[data-secret-field]')) as HTMLElement[]
    expect(secrets).toHaveLength(2)
    for (const secret of secrets) {
      expect(secret.getAttribute('data-field-path')).toBe('registry.providers.*.*')
      expect(secret.getAttribute('data-reveal-state')).toBe('masked')
      expect(secret.querySelector('code')?.textContent).toBe(MASK)
    }
    expect(browserstack!.textContent).toContain('accessKey')
    expect(browserstack!.textContent).toContain('region')
    expect(buttonIn(browserstack, showValueName(deviceFarmSettingLabel('browserstack', 'accessKey')))).not.toBeNull()
    expect(buttonIn(browserstack, replaceValueName(deviceFarmSettingLabel('browserstack', 'region')))).not.toBeNull()
    expect(saucelabs!.querySelectorAll('[data-secret-field]')).toHaveLength(1)
    expect(container!.querySelectorAll('input')).toHaveLength(0)
  })

  it('ADD-SETTING-EXPLICIT: a typed key and value write nothing until Save setting, which writes one set; Discard setting writes nothing', async () => {
    await mount()
    const browserstack = farmRow('browserstack')!

    await click(buttonIn(browserstack, ADD_SETTING_LABEL))
    const key = inputLabelled(browserstack, DEVICE_FARM_FIELD_LABELS.key)
    const value = inputLabelled(browserstack, DEVICE_FARM_FIELD_LABELS.value)
    expect(key?.type).toBe('text')
    expect(value?.type).toBe('password')
    expect(value?.getAttribute('autocomplete')).toBe('off')
    await type(key, 'username')
    await type(value, TYPED)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS * 3)
    })
    await flush()
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)

    await click(buttonIn(browserstack, SAVE_SETTING_LABEL))

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'set', path: ['registry', 'providers', 'browserstack', 'username'], value: TYPED }]],
    ])
    const row = farmRow('browserstack')!
    expect(row.querySelectorAll('[data-secret-field]')).toHaveLength(3)
    expect(inputLabelled(row, DEVICE_FARM_FIELD_LABELS.value)).toBeNull()
    expect(container!.textContent).not.toContain(TYPED)
    expect(document.activeElement).toBe(buttonIn(row, ADD_SETTING_LABEL))

    await click(buttonIn(row, ADD_SETTING_LABEL))
    await type(inputLabelled(row, DEVICE_FARM_FIELD_LABELS.key), 'extra')
    await type(inputLabelled(row, DEVICE_FARM_FIELD_LABELS.value), 'discarded')
    await click(buttonIn(row, DISCARD_SETTING_LABEL))
    expect(applyConfigChanges).toHaveBeenCalledTimes(1)
    expect(inputLabelled(row, DEVICE_FARM_FIELD_LABELS.value)).toBeNull()
    expect(document.activeElement).toBe(buttonIn(row, ADD_SETTING_LABEL))
  })

  it('ADD-DEVICE-FARM-EXPLICIT: a new farm with its first setting is one explicit write of the whole entry', async () => {
    await mount()

    await click(buttonIn(container, ADD_DEVICE_FARM_LABEL))
    const draft = container!.querySelector('[data-device-farm-draft]') as HTMLElement | null
    expect(draft).not.toBeNull()
    const save = buttonIn(draft, SAVE_SETTING_LABEL)!
    expect(save.disabled).toBe(true)
    await type(inputLabelled(draft, DEVICE_FARM_FIELD_LABELS.name), 'lambdatest')
    await type(inputLabelled(draft, DEVICE_FARM_FIELD_LABELS.key), 'accessKey')
    await type(inputLabelled(draft, DEVICE_FARM_FIELD_LABELS.value), TYPED)
    expect(applyConfigChanges).not.toHaveBeenCalled()

    await click(buttonIn(draft, SAVE_SETTING_LABEL))

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'set', path: ['registry', 'providers', 'lambdatest'], value: { accessKey: TYPED } }]],
    ])
    expect(container!.querySelector('[data-device-farm-draft]')).toBeNull()
    expect(farmRow('lambdatest')?.querySelector('[data-secret-field] code')?.textContent).toBe(MASK)
    expect(container!.textContent).not.toContain(TYPED)
  })

  it('DEVICE-FARM-DELETE-UNDO: delete removes the row at once, writes an undoable unset and Undo restores it', async () => {
    await mount()
    const write = deferred<{ revision: string; undo: { token: string; expiresAt: number } }>()
    vi.mocked(applyConfigChanges).mockReturnValueOnce(write.promise as never)

    const remove = buttonIn(farmRow('browserstack'), deleteActionName('delete-device-farm', 'browserstack'))
    expect(remove?.querySelector('svg')?.getAttribute('class')).toContain('lucide-trash')
    await click(remove)

    expect(farmRow('browserstack')).toBeNull()
    expect(farmRow('saucelabs')).not.toBeNull()
    expect(applyConfigChanges).toHaveBeenCalledWith(
      [{ op: 'unset', path: ['registry', 'providers', 'browserstack'] }],
      { undoable: true },
    )

    await act(async () => {
      write.resolve({ revision: 'rev-2', undo: { token: 'tok-farm', expiresAt: Date.now() + 30_000 } })
    })
    await flush()
    expect(farmRow('browserstack')).toBeNull()
    expect(hook!.status.state).toBe('undo')
    expect(hook!.status.undo).toEqual({
      line: undoLine('delete-device-farm', 'browserstack'),
      name: 'browserstack',
      token: 'tok-farm',
    })

    vi.mocked(undoConfigAction).mockResolvedValueOnce({ restored: true, revision: 'rev-3' })
    await act(async () => {
      await hook!.undo()
    })
    await flush()
    expect(undoConfigAction).toHaveBeenCalledWith('tok-farm')
    expect(farmRow('browserstack')).not.toBeNull()
  })

  it('NO-RAW-JSON-EDITOR: no textarea, code editor, dialog, section save or Edit button renders, and an empty list says so beside Add device farm', async () => {
    await mount()

    expect(container!.querySelector('textarea')).toBeNull()
    expect(container!.querySelector('pre')).toBeNull()
    expect(container!.querySelector('[data-monaco], .monaco-editor')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(container!.querySelector('[data-config-section-shell]')).toBeNull()
    expect(buttonIn(container, 'Edit')).toBeNull()
    expect(buttonIn(container, 'Save Changes')).toBeNull()
    expect(container!.textContent).not.toMatch(/JSON/)

    await unmount()
    vi.mocked(fetchConfig).mockResolvedValue(answer({ registry: {} }) as never)
    await mount()

    expect(container!.textContent).toContain(NO_DEVICE_FARMS_TEXT)
    expect(buttonIn(container, ADD_DEVICE_FARM_LABEL)).not.toBeNull()
    expect(container!.querySelector('[data-device-farm]')).toBeNull()
  })
})
