// @vitest-environment jsdom

// ONE SECRET VALUE (429-19 Task 1 · D-09, D-17 · UI-SPEC S8, E11).
//
// A secret shows the server's mask, reveals one value per explicit click, re-masks as soon as
// attention leaves, and is edited only by replacing it: the masked text is never an input value,
// so a mask can never be written back. These cells mount the real autosave hook over a mocked
// write route and a mocked reveal read.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigPathSegment } from '@vostride/agent-qa-schema'

import { SecretValue } from '@/components/config-manager/secret-value'
import {
  ConfigAutosaveProvider,
  useConfigAutosave,
  useConfigAutosaveContext,
  type ConfigAutosave,
} from '@/hooks/use-config-autosave'
import { applyConfigChanges, fetchConfig, fetchConfigRevision, revealConfigValue } from '@/lib/api'
import {
  REVEAL_FAILED_TEXT,
  SETTLE_DELAY_MS,
  hideValueName,
  keepValueName,
  replaceValueName,
  saveValueName,
  showValueName,
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
const REVEALED = 'AKIA-revealed-7Q2'
const TYPED = 'typed-new-secret-9X4'

const accessKey = {
  segments: ['registry', 'providers', 'browserstack', 'accessKey'] as ConfigPathSegment[],
  pattern: 'registry.providers.*.*',
}
const region = {
  segments: ['registry', 'providers', 'browserstack', 'region'] as ConfigPathSegment[],
  pattern: 'registry.providers.*.*',
}

const maskedConfig = {
  registry: { providers: { browserstack: { accessKey: MASK, region: MASK } } },
}

function answer(config: Record<string, unknown>) {
  return { config, provider: null, revision: 'rev-1', file: { path: CONFIG_PATH, lines: [] } }
}

let hook: ConfigAutosave | undefined
let showFields = true

function Harness({ children }: { children: ReactNode }) {
  const autosave = useConfigAutosave()
  hook = autosave
  if (autosave.load.kind !== 'ready') return null
  return <ConfigAutosaveProvider value={autosave}>{showFields ? children : null}</ConfigAutosaveProvider>
}

function Secrets() {
  const autosave = useConfigAutosaveContext()
  const maskedAt = (segments: ConfigPathSegment[]) => String(autosave.valueOf({ segments, tab: 'targets' }) ?? '')
  return (
    <div>
      <SecretValue field={accessKey} label="Access key" maskedText={maskedAt(accessKey.segments)} />
      <SecretValue field={region} label="Region" maskedText={maskedAt(region.segments)} />
      <button type="button" data-outside>
        Elsewhere
      </button>
    </div>
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function render() {
  await act(async () => {
    root!.render(
      <Harness>
        <Secrets />
      </Harness>,
    )
  })
  await flush()
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await render()
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

function groups() {
  return Array.from(container?.querySelectorAll('[data-secret-field]') ?? []) as HTMLElement[]
}

function buttonNamed(name: string) {
  const buttons = Array.from(container?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.getAttribute('aria-label') === name) ?? null
}

function eyeOf(label: string) {
  return buttonNamed(showValueName(label)) ?? buttonNamed(hideValueName(label))
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    element!.click()
  })
  await flush()
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function passwordIn(group: HTMLElement | undefined) {
  return (group?.querySelector('input[type="password"]') ?? null) as HTMLInputElement | null
}

async function reveal(label: string) {
  vi.mocked(revealConfigValue).mockResolvedValueOnce({ value: REVEALED })
  await click(eyeOf(label))
}

async function replaceAndType(label: string, value: string) {
  await click(buttonNamed(replaceValueName(label)))
  const input = passwordIn(groups()[label === 'Access key' ? 0 : 1])
  expect(input).not.toBeNull()
  await act(async () => {
    setValue(input!, value)
  })
  await flush()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function storedText() {
  const parts: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!
    parts.push(key, localStorage.getItem(key) ?? '')
  }
  return parts.join('\n')
}

function inputValues() {
  return (Array.from(document.querySelectorAll('input')) as HTMLInputElement[]).map((input) => input.value).join('\n')
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  showFields = true
  vi.mocked(fetchConfig).mockResolvedValue(answer(maskedConfig) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2' } as never)
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('SecretValue (429-19 Task 1)', () => {
  it('REVEAL-ON-CLICK-ONLY: mounting, focusing and hovering fetch nothing; one click fetches the one value by its segment path', async () => {
    await mount()

    const [first] = groups()
    expect(first).toBeDefined()
    expect(first!.getAttribute('data-field-path')).toBe(accessKey.pattern)
    expect(first!.getAttribute('data-reveal-state')).toBe('masked')
    expect(first!.querySelector('code')?.textContent).toBe(MASK)

    const eye = eyeOf('Access key')
    expect(eye).not.toBeNull()
    expect(eye!.getAttribute('aria-label')).toBe(showValueName('Access key'))
    expect(eye!.getAttribute('aria-pressed')).toBe('false')
    await act(async () => {
      eye!.focus()
      first!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      first!.dispatchEvent(new PointerEvent('pointerenter'))
      eye!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    await flush()
    expect(revealConfigValue).not.toHaveBeenCalled()

    await reveal('Access key')

    expect(revealConfigValue).toHaveBeenCalledTimes(1)
    expect(vi.mocked(revealConfigValue).mock.calls[0]![0]).toEqual(accessKey.segments)
    expect(first!.getAttribute('data-reveal-state')).toBe('revealed')
    expect(first!.querySelector('code')?.textContent).toBe(REVEALED)
    expect(first!.querySelector('code')?.className).toContain('wrap-anywhere')
    const hide = eyeOf('Access key')!
    expect(hide.getAttribute('aria-label')).toBe(hideValueName('Access key'))
    expect(hide.getAttribute('aria-pressed')).toBe('true')

    await click(hide)
    expect(first!.getAttribute('data-reveal-state')).toBe('masked')
    expect(first!.querySelector('code')?.textContent).toBe(MASK)
    expect(revealConfigValue).toHaveBeenCalledTimes(1)
  })

  it('REVEAL-ONE-VALUE: revealing one value leaves its neighbour masked and unfetched', async () => {
    await mount()

    await reveal('Access key')

    const [first, second] = groups()
    expect(first!.getAttribute('data-reveal-state')).toBe('revealed')
    expect(second!.getAttribute('data-reveal-state')).toBe('masked')
    expect(second!.querySelector('code')?.textContent).toBe(MASK)
    expect(eyeOf('Region')!.getAttribute('aria-pressed')).toBe('false')
    expect(revealConfigValue).toHaveBeenCalledTimes(1)
    for (const call of vi.mocked(revealConfigValue).mock.calls) {
      expect(call[0]).not.toEqual(region.segments)
    }
  })

  it('REMASK-ON-BLUR-TAB-HIDE: a revealed value re-masks when focus leaves its group, on unmount, on pagehide and on a hidden page', async () => {
    await mount()
    const outside = container!.querySelector('[data-outside]') as HTMLButtonElement

    await reveal('Access key')
    await act(async () => {
      buttonNamed(replaceValueName('Access key'))!.focus()
    })
    await flush()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('revealed')
    await act(async () => {
      outside.focus()
    })
    await flush()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('masked')
    expect(container!.textContent).not.toContain(REVEALED)

    await reveal('Access key')
    expect(container!.textContent).toContain(REVEALED)
    showFields = false
    await render()
    showFields = true
    await render()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('masked')
    expect(container!.textContent).not.toContain(REVEALED)

    await reveal('Access key')
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await flush()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('masked')
    expect(container!.textContent).not.toContain(REVEALED)

    await reveal('Access key')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await flush()
    visibility.mockRestore()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('masked')
    expect(container!.textContent).not.toContain(REVEALED)
  })

  it('REVEALED-NEVER-ELSEWHERE: a revealed value reaches no storage, URL, console or other element', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    await mount()

    await reveal('Access key')

    expect(groups()[0]!.querySelector('code')?.textContent).toBe(REVEALED)
    expect(storedText()).not.toContain(REVEALED)
    expect(window.location.href).not.toContain(REVEALED)
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(REVEALED)
    }
    const holders = Array.from(document.body.querySelectorAll('*')).filter(
      (element) => element.children.length === 0 && element.textContent?.includes(REVEALED),
    )
    expect(holders).toHaveLength(1)
    expect(holders[0]!.tagName).toBe('CODE')
    expect(inputValues()).not.toContain(REVEALED)
    expect(hook!.valueOf({ segments: accessKey.segments, tab: 'targets' })).toBe(MASK)
    expect(hook!.draftTabs.size).toBe(0)
    expect(hook!.status.state).toBe('idle')
  })

  it('REPLACE-VALUE-EMPTY-INPUT: Replace value shows an empty password input beside Save value and Keep current value, never the mask', async () => {
    await mount()
    await reveal('Access key')

    const replace = buttonNamed(replaceValueName('Access key'))
    expect(replace?.textContent?.trim()).toBe('Replace value')
    await click(replace)

    const input = passwordIn(groups()[0])
    expect(input).not.toBeNull()
    expect(input!.value).toBe('')
    expect(input!.value).not.toBe(MASK)
    expect(input!.getAttribute('autocomplete')).toBe('off')
    expect(inputValues()).not.toContain(MASK)
    expect(inputValues()).not.toContain(REVEALED)
    expect(container!.textContent).not.toContain(REVEALED)
    expect(buttonNamed(saveValueName('Access key'))?.textContent?.trim()).toBe('Save value')
    expect(buttonNamed(keepValueName('Access key'))?.textContent?.trim()).toBe('Keep current value')
    expect(passwordIn(groups()[1])).toBeNull()
  })

  it('REVEAL-LOADING: the eye shows a loader while its one value is fetched, and Save value shows Saving… in the status', async () => {
    await mount()
    const pending = deferred<{ value: string }>()
    vi.mocked(revealConfigValue).mockReturnValueOnce(pending.promise)

    await click(eyeOf('Access key'))

    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('loading')
    expect(eyeOf('Access key')!.querySelector('svg')?.getAttribute('class')).toContain('lucide-loader-circle')
    expect(groups()[0]!.querySelector('code')?.textContent).toBe(MASK)

    await act(async () => {
      pending.resolve({ value: REVEALED })
    })
    await flush()
    expect(groups()[0]!.getAttribute('data-reveal-state')).toBe('revealed')
    expect(eyeOf('Access key')!.querySelector('svg')?.getAttribute('class')).toContain('lucide-eye-off')

    const write = deferred<{ revision: string }>()
    vi.mocked(applyConfigChanges).mockReturnValueOnce(write.promise as never)
    await replaceAndType('Region', TYPED)
    await click(buttonNamed(saveValueName('Region')))
    expect(hook!.status.state).toBe('saving')

    await act(async () => {
      write.resolve({ revision: 'rev-2' })
    })
    await flush()
    expect(hook!.status.state).toBe('saved')
  })

  it('REVEAL-FAILED-STAYS-MASKED: a refused reveal says so and keeps the mask', async () => {
    await mount()
    vi.mocked(revealConfigValue).mockRejectedValueOnce(new Error('reveal_not_found'))

    await click(eyeOf('Access key'))

    const [first] = groups()
    expect(first!.getAttribute('data-reveal-state')).toBe('failed')
    expect(first!.querySelector('code')?.textContent).toBe(MASK)
    expect(eyeOf('Access key')!.getAttribute('aria-pressed')).toBe('false')
    expect(container!.textContent).toContain(REVEAL_FAILED_TEXT)

    await reveal('Access key')
    expect(first!.getAttribute('data-reveal-state')).toBe('revealed')
    expect(container!.textContent).not.toContain(REVEAL_FAILED_TEXT)
  })

  it('SAVE-VALUE-EXPLICIT: typing writes nothing; Save value writes one set at the path and the page shows the mask again', async () => {
    await mount()

    await replaceAndType('Access key', TYPED)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS * 3)
    })
    await flush()
    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(hook!.status.state).toBe('idle')
    expect(storedText()).not.toContain(TYPED)

    await click(buttonNamed(saveValueName('Access key')))

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'set', path: accessKey.segments, value: TYPED }]],
    ])
    expect(hook!.status.state).toBe('saved')
    expect(passwordIn(groups()[0])).toBeNull()
    expect(groups()[0]!.querySelector('code')?.textContent).toBe(MASK)
    expect(container!.textContent).not.toContain(TYPED)
    expect(inputValues()).not.toContain(TYPED)
    expect(storedText()).not.toContain(TYPED)
    expect(JSON.stringify(hook!.load.kind === 'ready' ? hook!.load.answer.config : null)).not.toContain(TYPED)
  })

  it('SAVE-VALUE-FAILURE-KEEPS-TYPED: a failed Save value keeps the typed value in the input and fails the status', async () => {
    await mount()
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(new Error('write_failed'))

    await replaceAndType('Access key', TYPED)
    await click(buttonNamed(saveValueName('Access key')))

    expect(applyConfigChanges).toHaveBeenCalledTimes(1)
    expect(hook!.status.state).toBe('failed')
    const input = passwordIn(groups()[0])
    expect(input).not.toBeNull()
    expect(input!.value).toBe(TYPED)
    expect(storedText()).not.toContain(TYPED)
  })

  it('KEEP-CURRENT-VALUE-RESTORES-FOCUS: Keep current value closes the input, forgets the typed value and focuses Replace value', async () => {
    await mount()

    await replaceAndType('Access key', TYPED)
    await click(buttonNamed(keepValueName('Access key')))

    expect(passwordIn(groups()[0])).toBeNull()
    const replace = buttonNamed(replaceValueName('Access key'))
    expect(replace).not.toBeNull()
    expect(document.activeElement).toBe(replace)
    expect(inputValues()).not.toContain(TYPED)
    expect(applyConfigChanges).not.toHaveBeenCalled()

    await click(replace)
    expect(passwordIn(groups()[0])!.value).toBe('')
  })
})
