import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 437 D-08..D-15, D-17: the Android fill paths against a selector-aware mocked driver. The focused
// field is a small model (value, hint, multiline, password); `driver.$` answers each focused XPath
// from it, the way UiAutomator2 answers XPath over page-source attributes (Pitfall 5).

const ANDROID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,1920]">
    <android.widget.LinearLayout bounds="[0,0][1080,1920]">
      <android.widget.EditText text="" content-desc="Username" bounds="[100,250][980,350]" enabled="true" />
      <android.widget.EditText text="" content-desc="Password" password="true" bounds="[100,400][980,500]" enabled="true" />
      <android.widget.Button text="Sign In" bounds="[100,550][980,650]" enabled="true" />
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`

const SCREENSHOT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const FOCUSED_XPATH = '//*[@focused="true"]'
const FOCUSED_HINT_XPATH = '//*[@focused="true" and @showing-hint="true"]'
const FOCUSED_MULTILINE_XPATH = '//*[@focused="true" and @multiline="true"]'
const FOCUSED_SINGLE_LINE_XPATH = '//*[@focused="true" and @multiline="false"]'
const PRESS_ENTER = 'execute:mobile: pressKey:{"keycode":66}'

interface FieldModel {
  value: string
  hint?: string
  multiline?: boolean
  password: boolean
  readBack?: () => string
  getTextThrows: boolean
  setValueThrows: boolean
  focusThrows: boolean
  pressKeyError?: string
}

let calls: string[] = []
let field: FieldModel

function newField(): FieldModel {
  return { value: '', password: false, getTextThrows: false, setValueThrows: false, focusThrows: false }
}

function showingHint(): boolean {
  return field.value === '' && field.hint !== undefined
}

function createFocusedElement() {
  return {
    isExisting: vi.fn().mockResolvedValue(true),
    setValue: vi.fn().mockImplementation((v: string) => {
      calls.push(`setValue:${v}`)
      if (field.setValueThrows) return Promise.reject(new Error('socket hang up'))
      field.value = v
      return Promise.resolve()
    }),
    addValue: vi.fn().mockImplementation((v: string) => {
      calls.push(`addValue:${v}`)
      field.value += v
      return Promise.resolve()
    }),
    getText: vi.fn().mockImplementation(() => {
      calls.push('getText')
      if (field.getTextThrows) return Promise.reject(new Error('stale element'))
      if (field.readBack) return Promise.resolve(field.readBack())
      return Promise.resolve(showingHint() ? field.hint : field.value)
    }),
    getAttribute: vi.fn().mockImplementation((name: string) => {
      calls.push(`getAttr:${name}`)
      if (name === 'password') return Promise.resolve(field.password ? 'true' : 'false')
      return Promise.reject(new Error(`attribute is unknown: ${name}`))
    }),
    clearValue: vi.fn().mockResolvedValue(undefined),
  }
}
let focused: ReturnType<typeof createFocusedElement>

function probe(matches: () => boolean) {
  return { isExisting: vi.fn().mockImplementation(() => Promise.resolve(matches())) }
}

function createMockDriver() {
  const chain: Record<string, any> = {}
  chain.move = vi.fn().mockReturnValue(chain)
  chain.down = vi.fn().mockReturnValue(chain)
  chain.up = vi.fn().mockReturnValue(chain)
  chain.pause = vi.fn().mockReturnValue(chain)
  chain.perform = vi.fn().mockImplementation(() => {
    calls.push('tap')
    return Promise.resolve()
  })
  return {
    getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(chain),
    keys: vi.fn().mockImplementation((k: unknown) => {
      calls.push(`keys:${JSON.stringify(k)}`)
      return Promise.resolve()
    }),
    pause: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockImplementation((command: string, args?: unknown) => {
      calls.push(`execute:${command}:${JSON.stringify(args ?? null)}`)
      if (command === 'mobile: pressKey' && field.pressKeyError) {
        return Promise.reject(new Error(field.pressKeyError))
      }
      return Promise.resolve(undefined)
    }),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    switchContext: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockRejectedValue(new Error('not supported')),
    $: vi.fn().mockImplementation((selector: string) => {
      calls.push(`$:${selector}`)
      if (field.focusThrows) return Promise.reject(new Error('session busy'))
      switch (selector) {
        case FOCUSED_XPATH:
          return Promise.resolve(focused)
        case FOCUSED_HINT_XPATH:
          return Promise.resolve(probe(showingHint))
        case FOCUSED_MULTILINE_XPATH:
          return Promise.resolve(probe(() => field.multiline === true))
        case FOCUSED_SINGLE_LINE_XPATH:
          return Promise.resolve(probe(() => field.multiline === false))
        default:
          return Promise.resolve(probe(() => false))
      }
    }),
  }
}

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

import { AndroidPlatformAdapter } from '../adapter.js'

type ExecAction = Parameters<AndroidPlatformAdapter['execute']>[0]

function count(prefix: string): number {
  return calls.filter((c) => c.startsWith(prefix)).length
}

let adapter: AndroidPlatformAdapter
let driver: ReturnType<typeof createMockDriver>

beforeEach(async () => {
  vi.clearAllMocks()
  calls = []
  field = newField()
  focused = createFocusedElement()
  driver = createMockDriver()
  const { remote } = await import('webdriverio')
  vi.mocked(remote).mockResolvedValue(driver as any)
  adapter = new AndroidPlatformAdapter()
  await adapter.setup({ platform: 'android' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function fill(
  name: string,
  text: string,
  opts: { clearMode?: 'replace' | 'append'; submit?: boolean } = {},
) {
  const state = await adapter.observe()
  const el = state.elements.find((e) => e.name === name)
  if (!el) throw new Error(`test fixture: element "${name}" not observed`)
  calls.length = 0
  return await adapter.execute({
    type: 'fill',
    ref: el.ref,
    text,
    clearMode: opts.clearMode ?? 'replace',
    submit: opts.submit ?? false,
  } as unknown as ExecAction)
}

describe('C437-FILL-NATIVE', () => {
  it('an unreadable read-back still sends the requested Enter once', async () => {
    field.getTextThrows = true

    const result = await fill('Username', 'hello', { submit: true })

    expect(count(PRESS_ENTER)).toBe(1)
    expect(calls.indexOf(PRESS_ENTER)).toBeGreaterThan(calls.indexOf('setValue:hello'))
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'native' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
    expect(result.metadata).not.toHaveProperty('fillReread')
  })

  it('a mismatch holds Enter', async () => {
    field.readBack = () => 'wrong'

    const result = await fill('Username', 'intended', { submit: true })

    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.error).toBe('field reads "wrong" after typing "intended" — re-observe and retry')
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'mismatch', path: 'native' })
    expect(result.metadata?.fillReread).toEqual({ expected: 'intended', actual: 'wrong' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: false, outcome: 'not-sent', reason: 'mismatch' })
  })

  it('a normalized read-back passes and submits', async () => {
    field.readBack = () => '+1 392-074-1751'

    const result = await fill('Username', '+13920741751', { submit: true })

    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'normalized', path: 'native' })
    expect(result.metadata?.fillReread).toEqual({ expected: '+13920741751', actual: '+1 392-074-1751' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
    expect(count(PRESS_ENTER)).toBe(1)
  })

  it("an empty field's hint is not its value", async () => {
    field.hint = 'Search settings'

    const appended = await fill('Username', 'abc', { clearMode: 'append' })

    expect(calls.indexOf(`$:${FOCUSED_HINT_XPATH}`)).toBeLessThan(calls.indexOf('addValue:abc'))
    expect(appended.success).toBe(true)
    expect(appended.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
    expect(appended.metadata?.fillReread).toEqual({ expected: 'abc', actual: 'abc' })

    field = { ...newField(), hint: 'Search settings' }
    focused.setValue.mockImplementation((v: string) => {
      calls.push(`setValue:${v}`)
      return Promise.resolve()
    })

    const dropped = await fill('Username', 'hello')

    expect(dropped.success).toBe(false)
    expect(dropped.metadata?.fillReread).toEqual({ expected: 'hello', actual: '' })
  })

  it('a failed Enter is recorded and not repeated', async () => {
    field.pressKeyError = 'socket hang up\n    at Request.emit (node:events)'

    const result = await fill('Username', 'hello', { submit: true })

    expect(count('execute:mobile: pressKey')).toBe(1)
    expect(count('setValue:')).toBe(1)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/typed/)
    expect(result.error).toMatch(/Enter failed/)
    expect(result.error).toMatch(/not sent again/)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'failed',
      detail: 'socket hang up',
    })
  })

  it('a secure field is never exact', async () => {
    field.password = true

    const result = await fill('Password', 'topSecretPw', { submit: true })

    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({
      verb: 'fill',
      verdict: 'unverified',
      path: 'native',
      secure: true,
    })
    expect(result.metadata?.fillReread).toEqual({ expected: '<len:11>', actual: '<len:11>' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
    expect(JSON.stringify(result)).not.toContain('topSecretPw')
  })

  it('submit false sends no Enter and records no fillSubmit', async () => {
    const result = await fill('Username', 'hello')

    expect(result.success).toBe(true)
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.metadata).not.toHaveProperty('fillSubmit')
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
  })
})
