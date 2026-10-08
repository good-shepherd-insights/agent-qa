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

// 437-06: a WebView field. The focus probe answers editable/matches/multiline/secure/value from it,
// W3C keys and `mobile: type` act on its value, and the read-back answers `readBack` when set.
interface WebFieldModel {
  editable: boolean
  matches: boolean
  multiline: boolean
  secure: boolean
  value: string
  probeValue?: unknown
  readBack?: () => unknown
  typeThrows?: boolean
  keysThrow?: boolean
}

const WEB_CTX = 'WEBVIEW_app.shop'
const WEB_NODES = [
  { role: 'textbox', name: 'Email', bounds: { x: 10.4, y: 20.2, width: 201, height: 41 } },
  { role: 'button', name: 'Place order', bounds: { x: 10, y: 100, width: 200, height: 40 } },
].map((node) => ({ ...node, state: {}, labels: {}, attributes: {} }))

let calls: string[] = []
let field: FieldModel
let web: WebFieldModel | null = null
let ctx = 'NATIVE_APP'
let observing = false
let scripts: string[] = []
let taps: Array<{ ctx: string; move: unknown }> = []
let selectedAll = false

function newField(): FieldModel {
  return { value: '', password: false, getTextThrows: false, setValueThrows: false, focusThrows: false }
}

function newWebField(): WebFieldModel {
  return { editable: true, matches: true, multiline: false, secure: false, value: '' }
}

function webScript(source: string, args: unknown[]): unknown {
  if (observing) {
    return {
      nodes: WEB_NODES,
      viewport: { width: 400, height: 800 },
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 400, contentHeight: 800 },
      url: 'https://shop.local/checkout',
    }
  }
  scripts.push(source)
  const w = web!
  if (args.length === 2) {
    calls.push(`script:probe:${args.join(',')}`)
    return {
      editable: w.editable,
      matches: w.matches,
      multiline: w.multiline,
      secure: w.secure,
      value: 'probeValue' in w ? w.probeValue : w.value,
    }
  }
  calls.push('script:read')
  return w.readBack ? w.readBack() : w.value
}

function webKeys(k: unknown): void {
  const keys = JSON.stringify(k)
  if (keys === '["Control","a"]') selectedAll = true
  else if (keys === '["Backspace"]' && selectedAll) {
    web!.value = ''
    selectedAll = false
  } else selectedAll = false
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
    taps.push({ ctx, move: chain.move.mock.lastCall?.[0] })
    return Promise.resolve()
  })
  return {
    getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(chain),
    keys: vi.fn().mockImplementation((k: unknown) => {
      calls.push(`keys:${JSON.stringify(k)}`)
      if (web?.keysThrow) return Promise.reject(new Error('socket hang up'))
      if (web) webKeys(k)
      return Promise.resolve()
    }),
    pause: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockImplementation((command: unknown, ...rest: unknown[]) => {
      if (typeof command !== 'string' || (web && !command.startsWith('mobile:'))) {
        return Promise.resolve(webScript(String(command), rest))
      }
      const args = rest[0]
      calls.push(`execute:${command}:${JSON.stringify(args ?? null)}`)
      if (command === 'mobile: pressKey' && field.pressKeyError) {
        return Promise.reject(new Error(field.pressKeyError))
      }
      if (command === 'mobile: type' && web) {
        if (web.typeThrows) return Promise.reject(new Error('socket hang up'))
        web.value += (args as { text: string }).text
      }
      return Promise.resolve(undefined)
    }),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    switchContext: vi.fn().mockImplementation((name: string) => {
      if (!observing) calls.push(`switch:${name}`)
      ctx = name
      return Promise.resolve()
    }),
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
  scripts = []
  taps = []
  web = null
  ctx = 'NATIVE_APP'
  observing = false
  selectedAll = false
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
  const ref = await refFor(name)
  return await adapter.execute({
    type: 'fill',
    ref,
    text,
    clearMode: opts.clearMode ?? 'replace',
    submit: opts.submit ?? false,
  } as unknown as ExecAction)
}

async function refFor(name: string): Promise<string> {
  observing = true
  const state = await adapter.observe()
  observing = false
  const el = state.elements.find((e) => e.name === name)
  if (!el) throw new Error(`test fixture: element "${name}" not observed`)
  calls.length = 0
  scripts.length = 0
  taps.length = 0
  return el.ref
}

async function webView(model: Partial<WebFieldModel> = {}): Promise<void> {
  web = { ...newWebField(), ...model }
  driver.getContexts.mockResolvedValue(['NATIVE_APP', WEB_CTX])
  await adapter.setup({ platform: 'android', appPackage: 'app.shop' } as never)
}

async function clear(name: string) {
  const ref = await refFor(name)
  return await adapter.execute({ type: 'clearText', ref } as unknown as ExecAction)
}

const WEB_PRESS_ENTER = [
  'switch:NATIVE_APP',
  PRESS_ENTER,
  `switch:${WEB_CTX}`,
]

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

  it('a mobile: type that throws is not retried', async () => {
    await webView({ value: 'stale', typeThrows: true })

    const result = await fill('Email', 'hello', { submit: true })

    expect(count('execute:mobile: type')).toBe(1)
    expect(calls.filter((c) => c.startsWith('keys:'))).toEqual([
      'keys:["Control","a"]',
      'keys:["Backspace"]',
    ])
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(count('script:read')).toBe(0)
    expect(calls.at(-1)).toBe(`switch:${WEB_CTX}`)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/typing was interrupted/)
    expect(result.error).toMatch(/not typed again/)
    expect(result.error).not.toContain('hello')
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'webview' })
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'not-sent',
      reason: 'input-failed',
    })
  })

  it('a WebView key input that throws ends the fill before typing', async () => {
    await webView({ value: 'stale', keysThrow: true })

    const result = await fill('Email', 'hello', { submit: true })

    expect(count('keys:')).toBe(1)
    expect(count('execute:mobile: type')).toBe(0)
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'webview' })
  })

  it('a WebView clear whose key input throws is not repeated', async () => {
    await webView({ value: 'old', keysThrow: true })

    const result = await clear('Email')

    expect(count('keys:')).toBe(1)
    expect(count('script:read')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/clearText was interrupted/)
    expect(result.metadata?.fillVerdict).toEqual({
      verb: 'clearText',
      verdict: 'unverified',
      path: 'webview',
    })
  })

  it('a WebView replace fill run twice leaves the text once and presses Enter once per fill', async () => {
    await webView({ value: 'stale' })

    await fill('Email', 'hello', { submit: true })
    const firstEnters = count(PRESS_ENTER)
    await fill('Email', 'hello', { submit: true })
    const secondEnters = count(PRESS_ENTER)

    expect(web!.value).toBe('hello')
    expect(firstEnters).toBe(1)
    expect(secondEnters).toBe(1)
  })
})

// 437-06 (D-11): the WebView fill acts like a user through the driver. A W3C touch tap in the
// WebView context focuses the ref, a read-only probe checks the focus, W3C keys clear,
// `mobile: type` from NATIVE_APP types, a read-only script reads the value back, and one
// `mobile: pressKey 66` from NATIVE_APP submits. No script writes the field or builds a key event.
describe('C437-FILL-WEBVIEW', () => {
  const WRITES_OR_EVENTS = [
    /\.(value|innerText|textContent|innerHTML|outerHTML)\s*(\+?=)(?!=)/,
    /dispatchEvent/,
    /KeyboardEvent/,
    /InputEvent/,
    /new\s+Event\b/,
    /execCommand|setRangeText/,
  ]

  it('a replace with submit is tap, probe, Ctrl+A, Backspace, typing, read-back, one Enter, in that order', async () => {
    await webView({ value: 'stale' })

    const result = await fill('Email', 'hello', { submit: true })

    expect(calls).toEqual([
      'tap',
      'script:probe:111,41',
      'keys:["Control","a"]',
      'keys:["Backspace"]',
      'switch:NATIVE_APP',
      'execute:mobile: type:{"text":"hello"}',
      `switch:${WEB_CTX}`,
      'script:read',
      ...WEB_PRESS_ENTER,
    ])
    expect(taps).toEqual([{ ctx: WEB_CTX, move: { x: 111, y: 41, origin: 'viewport' } }])
    expect(driver.action).toHaveBeenCalledWith('pointer', { parameters: { pointerType: 'touch' } })
    expect(web!.value).toBe('hello')
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'webview' })
    expect(result.metadata?.fillReread).toEqual({ expected: 'hello', actual: 'hello' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
  })

  it('no executed script writes a value or builds a key event', async () => {
    await webView({ value: 'stale' })

    await fill('Email', 'hello', { submit: true })
    const executed = [...scripts]
    await fill('Email', ' world', { clearMode: 'append', submit: true })
    executed.push(...scripts)

    for (const source of executed) {
      for (const pattern of WRITES_OR_EVENTS) expect(source).not.toMatch(pattern)
    }
    expect(executed.length).toBeGreaterThanOrEqual(4)
  })

  it('an unreadable read-back still sends Enter once', async () => {
    await webView({ readBack: () => null })

    const result = await fill('Email', 'hello', { submit: true })

    expect(count(PRESS_ENTER)).toBe(1)
    expect(calls.indexOf(PRESS_ENTER)).toBeGreaterThan(calls.indexOf('script:read'))
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'webview' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
    expect(result.metadata).not.toHaveProperty('fillReread')
  })

  it('a mismatch holds Enter', async () => {
    await webView({ readBack: () => 'helo' })

    const result = await fill('Email', 'hello', { submit: true })

    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(false)
    expect(result.error).toBe('field reads "helo" after typing "hello" — re-observe and retry')
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'mismatch', path: 'webview' })
    expect(result.metadata?.fillSubmit).toEqual({ sent: false, outcome: 'not-sent', reason: 'mismatch' })
  })

  const FOCUS_MISS =
    'fill: the tap on e1 did not focus an editable field; nothing was typed. '
    + 'Target the input itself and try again.'

  function expectNothingTyped(): void {
    expect(count('keys:')).toBe(0)
    expect(count('execute:mobile: type')).toBe(0)
    expect(count('execute:mobile: pressKey')).toBe(0)
  }

  it('a tap that focuses body writes nothing', async () => {
    await webView({ editable: false, matches: true, value: 'kept' })

    const result = await fill('Email', 'hello', { submit: true })

    expect(calls).toEqual(['tap', 'script:probe:111,41'])
    expectNothingTyped()
    expect(web!.value).toBe('kept')
    expect(result.success).toBe(false)
    expect(result.error).toBe(FOCUS_MISS)
    expect(result.metadata?.fillRefusal).toEqual({
      verb: 'fill',
      cause: 'not-editable',
      evidence: 'no-keyboard-focus',
    })
    expect(result.metadata?.fillSubmit).toEqual({
      sent: false,
      outcome: 'not-sent',
      reason: 'input-failed',
    })
    expect(result.metadata).not.toHaveProperty('fillVerdict')
  })

  it('a tap that focuses a different editable field writes nothing', async () => {
    await webView({ editable: true, matches: false })

    const result = await fill('Email', 'hello')

    expectNothingTyped()
    expect(result.success).toBe(false)
    expect(result.error).toBe(FOCUS_MISS)
    expect(result.metadata?.fillRefusal).toEqual({
      verb: 'fill',
      cause: 'not-editable',
      evidence: 'focus-elsewhere',
    })
    expect(result.metadata).not.toHaveProperty('fillSubmit')
  })

  it('append moves the caret to the end and keeps the prior text', async () => {
    await webView({ value: 'Hello' })

    const result = await fill('Email', ' world', { clearMode: 'append' })

    expect(calls.filter((c) => c.startsWith('keys:'))).toEqual(['keys:["End"]'])
    expect(calls.indexOf('keys:["End"]')).toBeLessThan(calls.indexOf('execute:mobile: type:{"text":" world"}'))
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'webview' })
    expect(result.metadata?.fillReread).toEqual({ expected: 'Hello world', actual: 'Hello world' })

    web = { ...newWebField(), multiline: true, value: 'line one' }
    const textarea = await fill('Email', '\nline two', { clearMode: 'append' })

    expect(calls.filter((c) => c.startsWith('keys:'))).toEqual(['keys:["Control","End"]'])
    expect(textarea.metadata?.fillReread).toEqual({
      expected: 'line one\nline two',
      actual: 'line one\nline two',
    })
  })

  it('an append whose prior value is unreadable is unverified', async () => {
    await webView({ value: 'Hello', probeValue: null })

    const result = await fill('Email', ' world', { clearMode: 'append', submit: true })

    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'unverified', path: 'webview' })
    expect(count(PRESS_ENTER)).toBe(1)
  })

  it('a textarea never gets Enter', async () => {
    const text = 'line one\n\nline three\n  indented\ttab |;," end  '
    await webView({ multiline: true })

    const result = await fill('Email', text, { submit: true })

    expect(calls.filter((c) => c.startsWith('execute:mobile: type'))).toEqual([
      `execute:mobile: type:${JSON.stringify({ text })}`,
    ])
    expect(count('execute:mobile: pressKey')).toBe(0)
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'webview' })
    expect(result.metadata?.fillReread).toEqual({ expected: text, actual: text })
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
  ])('line breaks into an INPUT are refused before any key input (%s)', async (_label, text) => {
    await webView({ multiline: false, value: 'kept' })

    const result = await fill('Email', text, { submit: true })

    expectNothingTyped()
    expect(web!.value).toBe('kept')
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
  })

  it('a password field is never exact', async () => {
    await webView({ secure: true })

    const result = await fill('Email', 'topSecretPw', { submit: true })

    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({
      verb: 'fill',
      verdict: 'unverified',
      path: 'webview',
      secure: true,
    })
    expect(result.metadata?.fillSubmit).toEqual({ sent: true, outcome: 'sent' })
    expect(JSON.stringify(result)).not.toContain('topSecretPw')
  })

  it.each([
    ['leading and trailing spaces and tabs', '\t  lead and trail  \t'],
    ['commas, semicolons, pipes and quotes', `a,b;c|d "q" 's'`],
    ['accented, CJK and emoji characters', 'é ü 中文 😀'],
  ])('the single-line D-08 texts reach mobile: type exactly once: %s', async (_label, text) => {
    await webView()

    const result = await fill('Email', text)

    expect(calls.filter((c) => c.startsWith('execute:mobile: type'))).toEqual([
      `execute:mobile: type:${JSON.stringify({ text })}`,
    ])
    expect(result.success).toBe(true)
    expect(result.metadata?.fillVerdict).toEqual({ verb: 'fill', verdict: 'exact', path: 'webview' })
    expect(result.metadata?.fillReread).toEqual({ expected: text, actual: text })
  })

  it('a WebView clearText clears the named field by keys and reads it back', async () => {
    await webView({ value: 'old text' })

    const cleared = await clear('Email')

    expect(calls).toEqual([
      'tap',
      'script:probe:111,41',
      'keys:["Control","a"]',
      'keys:["Backspace"]',
      'script:read',
    ])
    expect(taps).toEqual([{ ctx: WEB_CTX, move: { x: 111, y: 41, origin: 'viewport' } }])
    expect(web!.value).toBe('')
    expect(cleared.success).toBe(true)
    expect(cleared.metadata?.fillVerdict).toEqual({ verb: 'clearText', verdict: 'exact', path: 'webview' })

    web = { ...newWebField(), value: 'x', readBack: () => 'x' }
    const left = await clear('Email')

    expect(left.success).toBe(false)
    expect(left.error).toBe('field still reads "x" after clearing — re-observe and retry')
    expect(left.metadata?.fillVerdict).toEqual({ verb: 'clearText', verdict: 'mismatch', path: 'webview' })

    web = { ...newWebField(), value: 'x', readBack: () => null }
    const unreadable = await clear('Email')

    expect(unreadable.success).toBe(true)
    expect(unreadable.metadata?.fillVerdict).toEqual({
      verb: 'clearText',
      verdict: 'unverified',
      path: 'webview',
    })

    web = { ...newWebField(), editable: false, value: 'kept' }
    const missed = await clear('Email')

    expect(count('keys:')).toBe(0)
    expect(web!.value).toBe('kept')
    expect(missed.success).toBe(false)
    expect(missed.error).toBe(
      'clearText: the tap on e1 did not focus an editable field; nothing was cleared. '
        + 'Target the input itself and try again.',
    )
    expect(missed.metadata?.fillRefusal).toEqual({
      verb: 'clearText',
      cause: 'not-editable',
      evidence: 'no-keyboard-focus',
    })
  })

  it('every WebView script in the fill and clear paths only reads', async () => {
    await webView({ value: 'Hello', multiline: true })

    await fill('Email', ' world', { clearMode: 'append', submit: true })
    const executed = [...scripts]
    await clear('Email')
    executed.push(...scripts)

    for (const source of executed) {
      for (const pattern of WRITES_OR_EVENTS) expect(source).not.toMatch(pattern)
    }
    expect(executed.length).toBeGreaterThanOrEqual(4)
  })
})
