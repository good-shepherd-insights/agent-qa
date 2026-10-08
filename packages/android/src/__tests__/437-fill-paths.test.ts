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

  it('a multi-line field never gets Enter', async () => {
    field.multiline = true

    const result = await fill('Username', 'hello', { submit: true })

    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(true)
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'not-sent',
      reason: 'multi-line-field',
    })
    expect(result.data).toBe(
      'submit not sent: Return would add a new line in this multi-line field; tap its send or submit control',
    )
  })

  it.each([
    ['a newline', 'l1\nl2'],
    ['a carriage return', 'l1\rl2'],
  ])('line breaks into a single-line field are refused before typing (%s)', async (_label, text) => {
    field.multiline = false

    const result = await fill('Username', text, { submit: true })

    expect(count('setValue:')).toBe(0)
    expect(count('addValue:')).toBe(0)
    expect(count('keys:')).toBe(0)
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'fill: this field is single-line and the text has line breaks; nothing was typed. '
        + 'Send the text without line breaks, or use a multi-line field.',
    )
    expect(result.metadata?.fillRefusal).toEqual({
      verb: 'fill',
      cause: 'single-line-field',
      evidence: 'text-has-line-breaks',
    })
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'not-sent',
      reason: 'input-failed',
    })
    expect(result.metadata).not.toHaveProperty('fillVerdict')
  })

  it.each([
    ['multi-line text with blank lines into a multi-line field', 'line one\n\nline three\n  indented\ttab |;," end  ', true],
    ['leading and trailing spaces and tabs', '\t  lead and trail  \t', false],
    ['commas, semicolons, pipes and quotes', `a,b;c|d "q" 's'`, false],
    ['accented, CJK and emoji characters', 'é ü 中文 😀', false],
  ])('the D-08 texts are typed once and read back exact: %s', async (_label, text, multiline) => {
    field.multiline = multiline

    const result = await fill('Username', text)

    expect(calls.filter((c) => c.startsWith('setValue:'))).toEqual([`setValue:${text}`])
    expect(count('keys:')).toBe(0)
    expect(count('execute:mobile: type')).toBe(0)
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
    expect(result.metadata?.fillReread).toEqual({ expected: text, actual: text })
  })

  it('a character the path could not type is recorded as a mismatch, never hidden', async () => {
    field.readBack = () => 'é ü 中文 '

    const result = await fill('Username', 'é ü 中文 😀', { submit: true })

    expect(count('setValue:')).toBe(1)
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'mismatch', path: 'native' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: false, outcome: 'not-sent', reason: 'mismatch' })
  })
})

// The assumption-delta invariant (437 D-12): every fill delivers its text through exactly one path
// and presses Enter at most once. 437-06 adds the WebView cells and 437-07 the keyboard cells.
describe('C437-ONE-PATH', () => {
  it('a native setValue that throws is never typed again', async () => {
    field.setValueThrows = true

    const result = await fill('Username', 'hello', { submit: true })

    expect(count('setValue:')).toBe(1)
    expect(count('addValue:')).toBe(0)
    expect(count('keys:')).toBe(0)
    expect(count('execute:mobile: type')).toBe(0)
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/typing was interrupted/)
    expect(result.error).toMatch(/may hold part of the text/)
    expect(result.error).toMatch(/not typed again/)
    expect(result.error).not.toContain('hello')
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'native' })
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'not-sent',
      reason: 'input-failed',
    })
  })

  it('a native setValue that throws without a submit records no fillSubmit', async () => {
    field.setValueThrows = true

    const result = await fill('Username', 'hello')

    expect(count('keys:')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.metadata).not.toHaveProperty('fillSubmit')
  })

  it('a focus lookup that throws chooses the keyboard path before any text is delivered', async () => {
    field.focusThrows = true

    const result = await fill('Username', 'hello')

    expect(focused.setValue).not.toHaveBeenCalled()
    expect(focused.addValue).not.toHaveBeenCalled()
    expect(count('keys:') + count('execute:mobile: type')).toBe(1)
    expect(calls.findIndex((c) => c.startsWith('keys:') || c.startsWith('execute:mobile: type')))
      .toBeGreaterThan(calls.indexOf(`$:${FOCUSED_XPATH}`))
    expect(result.metadata?.fillVerdict).not.toEqual(expect.objectContaining({ path: 'native' }))
  })

  it('a replace fill run twice leaves the text once and presses Enter once per fill', async () => {
    field.value = 'stale'

    const first = await fill('Username', 'hello', { submit: true })
    const firstEnters = count('execute:mobile: pressKey')
    const second = await fill('Username', 'hello', { submit: true })
    const secondEnters = count('execute:mobile: pressKey')

    expect(field.value).toBe('hello')
    expect(focused.setValue.mock.calls).toEqual([['hello'], ['hello']])
    expect(first.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
    expect(second.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'native' })
    expect(firstEnters + secondEnters).toBe(2)
    expect(firstEnters).toBe(1)
    expect(secondEnters).toBe(1)
  })
})
