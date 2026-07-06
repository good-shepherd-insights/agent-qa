import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Wave-0 RED scaffold — Phase 359 Plan 02, Task 2 (EXEC-01/02/03; D-05..D-08,
// D-10..D-12, Pitfall 9). Pins the ANDROID adapter fill/scroll/openApp compound
// sequences against a call-logging mocked webdriverio driver — no live Appium.
//
// RED convention: these fail on not-yet-implemented compound behavior (the current
// `case 'fill'` sets a value but never re-reads via getText(); `case 'scroll'` has
// no native `mobile: scroll` rung; `openApp` is not a handled action). They MUST NOT
// fail on compile errors — execution-shaped action literals are cast via
// `as unknown as Parameters<typeof adapter.execute>[0]`.
//
// The pre-existing adapter.test.ts and conformance.test.ts stay GREEN (standalone
// file; legacy `fill {value}` / `scroll {value}` contracts untouched).
// ---------------------------------------------------------------------------

const ANDROID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,1920]">
    <android.widget.LinearLayout bounds="[0,0][1080,1920]">
      <android.widget.TextView text="Login" bounds="[100,100][980,200]" content-desc="" enabled="true" />
      <android.widget.EditText text="" content-desc="Username" bounds="[100,250][980,350]" enabled="true" />
      <android.widget.EditText text="" content-desc="Password" password="true" bounds="[100,400][980,500]" enabled="true" />
      <android.widget.Button text="Sign In" bounds="[100,550][980,650]" enabled="true" />
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`

const SCREENSHOT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function createMockPointerAction() {
  const chain: Record<string, any> = {}
  chain.move = vi.fn().mockReturnValue(chain)
  chain.down = vi.fn().mockReturnValue(chain)
  chain.up = vi.fn().mockReturnValue(chain)
  chain.pause = vi.fn().mockReturnValue(chain)
  chain.perform = vi.fn().mockResolvedValue(undefined)
  return chain
}

// Ordered driver-call log so ordering/count pins survive implementation detail.
let calls: string[] = []

// A call-logging fake focused element. getText/getAttribute returns are configurable.
let focusedGetTextReturn: string
let focusedPasswordAttr: string | null
function createMockElement() {
  return {
    isExisting: vi.fn().mockResolvedValue(true),
    setValue: vi.fn().mockImplementation((v: string) => { calls.push(`setValue:${v}`); return Promise.resolve() }),
    addValue: vi.fn().mockImplementation((v: string) => { calls.push(`addValue:${v}`); return Promise.resolve() }),
    getText: vi.fn().mockImplementation(() => { calls.push('getText'); return Promise.resolve(focusedGetTextReturn) }),
    getAttribute: vi.fn().mockImplementation((n: string) => {
      calls.push(`getAttr:${n}`)
      return Promise.resolve(n === 'password' ? focusedPasswordAttr : null)
    }),
    clearValue: vi.fn().mockResolvedValue(undefined),
  }
}
let mockElement: ReturnType<typeof createMockElement>

// `mobile: listApps` returns a package-id-keyed map. Configurable per test.
let listAppsReturn: Record<string, Record<string, unknown>>
let listAppsThrows: boolean

function createMockDriver() {
  const pointerAction = createMockPointerAction()
  return {
    getPageSource: vi.fn().mockImplementation(() => { calls.push('getPageSource'); return Promise.resolve(ANDROID_XML) }),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(pointerAction),
    actions: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockImplementation((k: unknown) => { calls.push(`keys:${JSON.stringify(k)}`); return Promise.resolve() }),
    pause: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockImplementation((id: string) => { calls.push(`activateApp:${id}`); return Promise.resolve() }),
    terminateApp: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockImplementation((command: string, args?: unknown) => {
      calls.push(`execute:${command}:${JSON.stringify(args ?? null)}`)
      if (command === 'mobile: listApps') {
        if (listAppsThrows) return Promise.reject(new Error('listApps unavailable'))
        return Promise.resolve(listAppsReturn)
      }
      return Promise.resolve(undefined)
    }),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    switchContext: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockRejectedValue(new Error('not supported')),
    $: vi.fn().mockImplementation(() => Promise.resolve(mockElement)),
    _pointerAction: pointerAction,
  }
}

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

import { AndroidPlatformAdapter } from '../adapter.js'

type ExecAction = Parameters<AndroidPlatformAdapter['execute']>[0]

describe('AndroidPlatformAdapter compound behaviors (RED — Wave-0)', () => {
  let adapter: AndroidPlatformAdapter
  let mockDriver: ReturnType<typeof createMockDriver>

  beforeEach(async () => {
    vi.clearAllMocks()
    calls = []
    focusedGetTextReturn = ''
    focusedPasswordAttr = null
    listAppsReturn = {}
    listAppsThrows = false
    mockElement = createMockElement()
    mockDriver = createMockDriver()
    const { remote } = await import('webdriverio')
    vi.mocked(remote).mockResolvedValue(mockDriver as any)
    adapter = new AndroidPlatformAdapter()
  })

  afterEach(() => { vi.restoreAllMocks() })

  async function refFor(name: string): Promise<string> {
    const state = await adapter.observe()
    const el = state.elements.find(e => e.name === name)
    if (!el) throw new Error(`test fixture: element "${name}" not observed`)
    return el.ref
  }

  describe('EXEC-01 fill compound (D-05/D-06/D-07/D-08)', () => {
    it('replace mode types via setValue then re-reads getText() from the SAME focused handle, in order', async () => {
      await adapter.setup({ platform: 'android' })
      const ref = await refFor('Username')
      focusedGetTextReturn = 'hello'
      calls.length = 0

      const result = await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(mockElement.setValue).toHaveBeenCalledWith('hello')
      expect(mockElement.getText).toHaveBeenCalled()
      const typeIdx = calls.findIndex(c => c.startsWith('setValue:'))
      const readIdx = calls.indexOf('getText')
      expect(readIdx).toBeGreaterThan(typeIdx)
    })

    it('append mode captures prior getText() BEFORE typing and uses addValue (A1)', async () => {
      await adapter.setup({ platform: 'android' })
      const ref = await refFor('Username')
      focusedGetTextReturn = 'abc'
      calls.length = 0

      await adapter.execute({ type: 'fill', ref, text: 'XYZ', clearMode: 'append', submit: false } as unknown as ExecAction)

      expect(mockElement.addValue).toHaveBeenCalledWith('XYZ')
      const priorReadIdx = calls.indexOf('getText')
      const typeIdx = calls.findIndex(c => c.startsWith('addValue:'))
      expect(priorReadIdx).toBeGreaterThanOrEqual(0)
      expect(priorReadIdx).toBeLessThan(typeIdx)
    })

    it('submit=true presses KEYCODE_ENTER (mobile: pressKey keycode 66) AFTER the re-read (A4); submit=false does not', async () => {
      await adapter.setup({ platform: 'android' })
      const ref = await refFor('Username')
      focusedGetTextReturn = 'hello'
      calls.length = 0

      await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: true } as unknown as ExecAction)

      expect(mockDriver.execute).toHaveBeenCalledWith('mobile: pressKey', { keycode: 66 })
      const readIdx = calls.indexOf('getText')
      const enterIdx = calls.findIndex(c => c.includes('mobile: pressKey') && c.includes('66'))
      expect(enterIdx).toBeGreaterThan(readIdx)
    })

    it('mismatch yields success:false + §7.1 error + fillReread meta, single-shot typing (D-08)', async () => {
      await adapter.setup({ platform: 'android' })
      const ref = await refFor('Username')
      focusedGetTextReturn = 'wrong'

      const result = await adapter.execute({ type: 'fill', ref, text: 'intended', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/reads .* after typing .* re-observe and retry/i)
      expect(result.metadata?.fillReread).toEqual({ expected: 'intended', actual: 'wrong' })
      expect(mockElement.setValue).toHaveBeenCalledTimes(1)
      expect(mockElement.addValue).not.toHaveBeenCalled()
    })

    it('secure field (password=true) verdicts on non-emptiness and never records the raw value', async () => {
      await adapter.setup({ platform: 'android' })
      const ref = await refFor('Password')
      focusedPasswordAttr = 'true'
      focusedGetTextReturn = 'topSecretPw'

      const result = await adapter.execute({ type: 'fill', ref, text: 'topSecretPw', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(result.metadata?.fillReread).toBeDefined()
      expect(JSON.stringify(result)).not.toContain('topSecretPw')
    })
  })

  describe('EXEC-02 scroll untilVisible (Pitfall 9 selector-injection)', () => {
    it('tries native mobile: scroll with the -android uiautomator strategy FIRST', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()
      calls.length = 0

      const result = await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: 'Settings', direction: 'down', maxSwipes: 4, retryOpposite: true,
      } as unknown as ExecAction)

      expect(result.success).toBe(true)
      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeDefined()
      expect((scrollCall![1] as any).strategy).toBe('-android uiautomator')
      expect(result.metadata?.scrollUntilVisible).toBeDefined()
    })

    it('escapes quote/backslash in a hostile target inside the UiSelector source string', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: 'He said "hi" \\', direction: 'down', maxSwipes: 4, retryOpposite: false,
      } as unknown as ExecAction)

      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeDefined()
      const selector = String((scrollCall![1] as any).selector)
      // the raw quote/backslash must be backslash-escaped, never interpolated verbatim
      expect(selector).toContain('\\"')
      expect(selector).toContain('\\\\')
    })

    it('rejects a control-character target with a structured error, never interpolating it', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      const result = await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: `evil${String.fromCharCode(1)}break`, direction: 'down', maxSwipes: 4, retryOpposite: false,
      } as unknown as ExecAction)

      expect(result.success).toBe(false)
      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeUndefined()
    })
  })

  describe('EXEC-03 openApp resolution (D-10/D-11/D-12)', () => {
    it('enumerates via mobile: listApps exactly ONCE across two consecutive resolutions (session cache)', async () => {
      listAppsReturn = { 'com.google.android.calendar': {}, 'com.android.settings': {} }
      await adapter.setup({ platform: 'android' })
      calls.length = 0

      await adapter.execute({ type: 'openApp', appName: 'calendar' } as unknown as ExecAction)
      await adapter.execute({ type: 'openApp', appName: 'settings' } as unknown as ExecAction)

      const listCount = mockDriver.execute.mock.calls.filter(c => c[0] === 'mobile: listApps').length
      expect(listCount).toBe(1)
    })

    it('re-enumerates exactly once on a resolution MISS before erroring', async () => {
      listAppsReturn = { 'com.android.settings': {} }
      await adapter.setup({ platform: 'android' })

      const result = await adapter.execute({ type: 'openApp', appName: 'nonexistent-app-xyz' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      const listCount = mockDriver.execute.mock.calls.filter(c => c[0] === 'mobile: listApps').length
      expect(listCount).toBe(2)
    })

    it('launches a resolved app via activateApp(resolvedId) with openApp metadata', async () => {
      listAppsReturn = { 'com.google.android.calendar': {} }
      await adapter.setup({ platform: 'android' })

      const result = await adapter.execute({ type: 'openApp', appName: 'calendar' } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(mockDriver.activateApp).toHaveBeenCalledWith('com.google.android.calendar')
      expect(result.metadata?.openApp).toMatchObject({ resolvedId: 'com.google.android.calendar' })
    })

    it('listApps throwing with the shell env gate unset ⇒ structured error recommending bundleId, no crash', async () => {
      listAppsThrows = true
      const previous = process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL
      delete process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL
      await adapter.setup({ platform: 'android' })

      let result
      try {
        result = await adapter.execute({ type: 'openApp', appName: 'calendar' } as unknown as ExecAction)
      } finally {
        if (previous !== undefined) process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL = previous
      }

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/bundleId/i)
    })

    it('explicit {bundleId} variant skips fuzzy matching but errors when the id is not in the registry', async () => {
      listAppsReturn = { 'com.android.settings': {} }
      await adapter.setup({ platform: 'android' })

      const result = await adapter.execute({ type: 'openApp', bundleId: 'com.not.installed' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      // structured registry-validation error names the offending bundle id (not a generic throw)
      expect(result.error).toContain('com.not.installed')
      expect(mockDriver.activateApp).not.toHaveBeenCalledWith('com.not.installed')
    })

    it('unknown appName errors while naming candidate ids (top-3)', async () => {
      listAppsReturn = {
        'com.google.android.calendar': {},
        'com.android.settings': {},
        'com.android.chrome': {},
      }
      await adapter.setup({ platform: 'android' })

      const result = await adapter.execute({ type: 'openApp', appName: 'zzzzz-unknown' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/com\.(google\.android\.calendar|android\.settings|android\.chrome)/)
    })
  })
})
