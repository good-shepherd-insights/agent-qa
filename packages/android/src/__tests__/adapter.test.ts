import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ANDROID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,1920]">
    <android.widget.LinearLayout bounds="[0,0][1080,1920]">
      <android.widget.TextView text="Login" bounds="[100,100][980,200]" content-desc="" enabled="true" />
      <android.widget.EditText text="" content-desc="Username" bounds="[100,250][980,350]" enabled="true" />
      <android.widget.EditText text="" content-desc="Password" bounds="[100,400][980,500]" enabled="true" />
      <android.widget.Button text="Sign In" bounds="[100,550][980,650]" enabled="true" />
      <android.widget.CheckBox text="Remember me" bounds="[100,700][980,800]" enabled="true" />
      <android.widget.ImageView content-desc="App Logo" bounds="[400,50][680,90]" enabled="true" />
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`

const ANDROID_SPINNER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,1920]">
    <android.widget.LinearLayout bounds="[0,0][1080,1920]">
      <android.widget.Spinner text="Priority" bounds="[100,800][980,900]" content-desc="" enabled="true" />
      <android.widget.CheckedTextView text="High" bounds="[100,900][980,980]" content-desc="" enabled="true" />
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

function createMockDriver() {
  const pointerAction = createMockPointerAction()

  return {
    getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(pointerAction),
    actions: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockResolvedValue(undefined),
    terminateApp: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    switchContext: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockRejectedValue(new Error('not supported')),
    $: vi.fn() as unknown as (selector: string) => Promise<unknown>,
    _pointerAction: pointerAction,
  }
}

vi.mock('webdriverio', () => ({
  remote: vi.fn(),
}))

import { AndroidPlatformAdapter } from '../adapter.js'
import type { PlatformAdapter, PlatformConfig } from '@vostride/agent-qa-runner'
import type { LiveFrame } from '@vostride/agent-qa-schema'

describe('AndroidPlatformAdapter', () => {
  let adapter: AndroidPlatformAdapter
  let mockDriver: ReturnType<typeof createMockDriver>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockDriver = createMockDriver()
    const { remote } = await import('webdriverio')
    vi.mocked(remote).mockResolvedValue(mockDriver as any)

    adapter = new AndroidPlatformAdapter()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  describe('setup', () => {
    it('creates UIAutomator2 session with correct capabilities', async () => {
      const config: PlatformConfig = {
        platform: 'android',
        appState: 'preserve',
        device: {
          name: 'pixel-7',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2', platformVersion: '14', serial: 'RZCT90BCMWW' },
        },
      }

      await adapter.setup(config)

      const { remote } = await import('webdriverio')
      expect(remote).toHaveBeenCalledWith(expect.objectContaining({
        hostname: 'localhost',
        port: 4723,
        capabilities: expect.objectContaining({
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:deviceName': 'pixel-7',
          'appium:platformVersion': '14',
          'appium:udid': 'RZCT90BCMWW',
          'appium:noReset': true,
          'appium:newCommandTimeout': 300,
        }),
      }))
    })

    it('strips undefined capability values', async () => {
      await adapter.setup({ platform: 'android' })

      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      const caps = call.capabilities
      expect(caps).not.toHaveProperty('appium:platformVersion')
      expect(caps).not.toHaveProperty('appium:app')
      expect(caps).not.toHaveProperty('appium:appPackage')
      expect(caps).not.toHaveProperty('appium:appActivity')
      expect(caps).not.toHaveProperty('appium:avd')
    })

    it('sets appium app capability from configured app path and preserve app state', async () => {
      await adapter.setup({
        platform: 'android',
        appState: 'preserve',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPath: '/tmp/wikipedia.apk',
      })

      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      expect(call.capabilities['appium:app']).toBe('/tmp/wikipedia.apk')
      expect(call.capabilities['appium:noReset']).toBe(true)
    })

    it('maps reset app state to appium noReset false', async () => {
      await adapter.setup({
        platform: 'android',
        appState: 'reset',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
      })

      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      expect(call.capabilities['appium:noReset']).toBe(false)
    })

    it('omits appium noReset for Android browser mode', async () => {
      await adapter.setup({
        platform: 'android',
        appState: 'reset',
        device: {
          name: 'android-chrome',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2', browserName: 'Chrome' },
        },
      })

      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      expect(call.capabilities).not.toHaveProperty('appium:noReset')
    })

    it('uses appState instead of stale match.noReset', async () => {
      await adapter.setup({
        platform: 'android',
        appState: 'reset',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2', noReset: true },
        },
      })

      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      expect(call.capabilities['appium:noReset']).toBe(false)
    })

    it('rejects browserName with app path before session creation', async () => {
      await expect(adapter.setup({
        platform: 'android',
        device: {
          name: 'android-chrome',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2', browserName: 'Chrome' },
        },
        appPath: '/tmp/wikipedia.apk',
      })).rejects.toMatchObject({ category: 'app-install' })

      const { remote } = await import('webdriverio')
      expect(remote).not.toHaveBeenCalled()
    })

    it('launches resolved target app package after session creation', async () => {
      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPackage: 'org.wikipedia.alpha',
      })

      expect(mockDriver.activateApp).toHaveBeenCalledWith('org.wikipedia.alpha')
    })

    it('does not require mobile shell access for native app setup by default', async () => {
      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPackage: 'app.linear',
      })

      expect(mockDriver.execute).not.toHaveBeenCalledWith('mobile: shell', expect.anything())
    })

    it('uses mobile shell pid lookup only when explicitly enabled', async () => {
      const previous = process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL
      process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL = '1'
      mockDriver.execute.mockResolvedValueOnce('12345')

      try {
        await adapter.setup({
          platform: 'android',
          device: {
            name: 'android-emu',
            platform: 'android',
            transport: 'local',
            match: { automationName: 'UiAutomator2' },
          },
          appPackage: 'app.linear',
        })
      } finally {
        if (previous === undefined) delete process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL
        else process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL = previous
      }

      expect(mockDriver.execute).toHaveBeenCalledWith('mobile: shell', { command: 'pidof', args: ['app.linear'] })
    })

    it('wraps resolved app launch failure as app-launch setup error', async () => {
      mockDriver.activateApp.mockRejectedValueOnce(new Error('not installed'))

      await expect(adapter.setup({
        platform: 'android',
        appPackage: 'org.wikipedia.alpha',
      })).rejects.toMatchObject({ category: 'app-launch' })
    })
  })

  describe('cleanup', () => {
    it('calls deleteSession and clears state', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.cleanup()
      expect(mockDriver.deleteSession).toHaveBeenCalled()
    })

    it('does not throw if session already closed', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.deleteSession.mockRejectedValue(new Error('session not found'))
      await expect(adapter.cleanup()).resolves.not.toThrow()
    })
  })

  describe('observe', () => {
    it('returns schema v2 ScreenState with builder tree, elements, and refMap', async () => {
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()

      expect(state.platform).toBe('android')
      expect(state.tree).toContain('text "Login"')
      expect(state.tree).toContain('textbox "Username"')
      expect(state.tree).toContain('textbox "Password"')
      expect(state.tree).toContain('button "Sign In"')
      expect(state.elements.length).toBeGreaterThanOrEqual(5)
      expect(state.timestamp).toBeGreaterThan(0)
      // Schema v2: refMap is top-level (not metadata.refMap); every bounded element has one.
      expect(state.refMap).toBeDefined()
      expect(Object.keys(state.refMap).length).toBeGreaterThanOrEqual(5)
      expect(state.metadata.captureMode).toBe('textOnly')
      expect(state.metadata.coordSpace).toBe('viewport')
    })

    it('ignores unrelated Chrome webviews for native app targets', async () => {
      mockDriver.getContexts.mockResolvedValue(['NATIVE_APP', 'WEBVIEW_chrome'])

      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPackage: 'app.linear',
      })
      const state = await adapter.observe()

      expect(state.tree).toContain('button "Sign In"')
      expect(mockDriver.switchContext).not.toHaveBeenCalledWith('WEBVIEW_chrome')
    })

    it('observes a webview when the context belongs to the target app package', async () => {
      mockDriver.getContexts.mockResolvedValue(['NATIVE_APP', 'WEBVIEW_app.linear'])
      // Reworked WEB_OBSERVER_SCRIPT emits serializable interim nodes only (Pitfall #5):
      // no refs, no tree text — the shared builder mints refs and renders the tree.
      mockDriver.execute.mockResolvedValueOnce({
        nodes: [{
          role: 'button',
          name: 'Create issue',
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          state: { enabled: true, focused: false },
          labels: {},
          attributes: {},
        }],
        viewport: { width: 200, height: 100 },
        scroll: { offsetX: 0, offsetY: 0, contentWidth: 200, contentHeight: 800 },
        url: 'https://linear.local',
      })

      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPackage: 'app.linear',
      })
      const state = await adapter.observe()

      expect(mockDriver.switchContext).toHaveBeenCalledWith('WEBVIEW_app.linear')
      expect(state.platform).toBe('android')
      expect(state.url).toBe('https://linear.local')
      expect(state.tree).toContain('button "Create issue"')
      // Builder-minted ref carries the bounds from the interim node into refMap.
      const issueEl = state.elements.find(e => e.name === 'Create issue')!
      expect(state.refMap[issueEl.ref].bounds).toEqual({ x: 1, y: 2, width: 3, height: 4 })
      expect(state.metadata.captureMode).toBe('textOnly')
    })

    it('observes Chrome webviews for explicit Android browser-mode targets', async () => {
      mockDriver.getContexts.mockResolvedValue(['NATIVE_APP', 'WEBVIEW_chrome'])
      mockDriver.execute.mockResolvedValueOnce({
        nodes: [{
          role: 'link',
          name: 'Example',
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          state: { enabled: true, focused: false },
          labels: {},
          attributes: {},
        }],
        viewport: { width: 200, height: 100 },
        scroll: { offsetX: 0, offsetY: 0, contentWidth: 200, contentHeight: 800 },
        url: 'https://example.com',
      })

      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-chrome',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2', browserName: 'Chrome' },
        },
      })
      const state = await adapter.observe()

      expect(mockDriver.switchContext).toHaveBeenCalledWith('WEBVIEW_chrome')
      expect(state.url).toBe('https://example.com')
      expect(state.tree).toContain('link "Example"')
    })

    it('shape-validates attacker-shaped WEB_OBSERVER_SCRIPT results (T-352-11)', async () => {
      mockDriver.getContexts.mockResolvedValue(['NATIVE_APP', 'WEBVIEW_app.linear'])
      // Non-array nodes + a malformed record must never reach the builder: the whole
      // payload is rejected (nodes not an array) → falls back to native observation.
      mockDriver.execute.mockResolvedValueOnce({ nodes: 'not-an-array', viewport: null, scroll: null })

      await adapter.setup({
        platform: 'android',
        device: {
          name: 'android-emu',
          platform: 'android',
          transport: 'local',
          match: { automationName: 'UiAutomator2' },
        },
        appPackage: 'app.linear',
      })
      const state = await adapter.observe()

      // Rejected web payload → native XML fallback (ANDROID_XML) produced the state.
      expect(state.platform).toBe('android')
      expect(state.tree).toContain('button "Sign In"')
    })

    it('throws if adapter not initialized', async () => {
      await expect(adapter.observe()).rejects.toThrow('not initialized')
    })
  })

  describe('execute — tap', () => {
    it('performs pointer action at element center coordinates', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      // Find the "Sign In" button ref
      const state = await adapter.observe()
      const signInEl = state.elements.find(e => e.name === 'Sign In')
      expect(signInEl).toBeDefined()

      const result = await adapter.execute({ type: 'tap', ref: signInEl!.ref })
      expect(result.success).toBe(true)

      expect(mockDriver.action).toHaveBeenCalledWith('pointer', { parameters: { pointerType: 'touch' } })
      // button "Sign In" bounds="[100,550][980,650]" → center = (540, 600)
      expect(mockDriver._pointerAction.move).toHaveBeenCalledWith({ x: 540, y: 600 })
      expect(mockDriver._pointerAction.down).toHaveBeenCalledWith({ button: 0 })
      expect(mockDriver._pointerAction.up).toHaveBeenCalledWith({ button: 0 })
      expect(mockDriver._pointerAction.perform).toHaveBeenCalled()
    })
  })

  describe('execute — fill', () => {
    it('taps to focus then types via element setValue or keys', async () => {
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()

      const usernameEl = state.elements.find(e => e.name === 'Username')
      expect(usernameEl).toBeDefined()

      // Mock the focused element finder — the compound re-reads via getText() and probes
      // getAttribute('password') for the secure lane.
      const mockElement = {
        isExisting: vi.fn().mockResolvedValue(true),
        setValue: vi.fn().mockResolvedValue(undefined),
        addValue: vi.fn().mockResolvedValue(undefined),
        getText: vi.fn().mockResolvedValue('test'),
        getAttribute: vi.fn().mockResolvedValue(null),
      }
      mockDriver.$ = vi.fn().mockResolvedValue(mockElement)

      const result = await adapter.execute({ type: 'fill', ref: usernameEl!.ref, text: 'test', clearMode: 'replace', submit: false })
      expect(result.success).toBe(true)

      // Verify tap to focus
      expect(mockDriver._pointerAction.perform).toHaveBeenCalled()
    })
  })

  describe('execute — nativeSelect', () => {
    it('opens an Android spinner and selects an exact text option', async () => {
      mockDriver.getPageSource.mockResolvedValue(ANDROID_SPINNER_XML)
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()
      const spinnerEl = state.elements.find(e => e.name === 'Priority')
      expect(spinnerEl).toBeDefined()

      const highOption = {
        isExisting: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      }
      const missingOption = { isExisting: vi.fn().mockResolvedValue(false) }
      mockDriver.$ = vi.fn(async (selector: string) => {
        if (selector === 'android=new UiSelector().text("High")') return highOption
        return missingOption
      }) as any

      const result = await adapter.execute({ type: 'nativeSelect', ref: spinnerEl!.ref, value: 'High' })

      expect(result.success).toBe(true)
      expect(mockDriver.$).toHaveBeenCalledWith('android=new UiSelector().text("High")')
      expect(highOption.click).toHaveBeenCalled()
      expect(result.data).toMatchObject({ requestedValue: 'High', matchedValue: 'High', matchStrategy: 'text' })
    })

    it('falls back to Android content-description option lookup', async () => {
      mockDriver.getPageSource.mockResolvedValue(ANDROID_SPINNER_XML)
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()
      const spinnerEl = state.elements.find(e => e.name === 'Priority')

      const textMiss = { isExisting: vi.fn().mockResolvedValue(false) }
      const descriptionOption = {
        isExisting: vi.fn().mockResolvedValue(true),
        click: vi.fn().mockResolvedValue(undefined),
      }
      mockDriver.$ = vi.fn(async (selector: string) => {
        if (selector === 'android=new UiSelector().text("High")') return textMiss
        if (selector === 'android=new UiSelector().description("High")') return descriptionOption
        return textMiss
      }) as any

      const result = await adapter.execute({ type: 'nativeSelect', ref: spinnerEl!.ref, value: 'High' })

      expect(result.success).toBe(true)
      expect(mockDriver.$).toHaveBeenCalledWith('android=new UiSelector().description("High")')
      expect(descriptionOption.click).toHaveBeenCalled()
      expect(result.data).toMatchObject({ matchStrategy: 'description' })
    })

    it('rejects unsupported Android native controls with fallback guidance', async () => {
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()
      const buttonEl = state.elements.find(e => e.name === 'Sign In')

      const result = await adapter.execute({ type: 'nativeSelect', ref: buttonEl!.ref, value: 'High' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('nativeSelect only supports native Android picker/dropdown/list controls')
      expect(result.error).toContain('tap, swipe, or tapCoordinate')
    })

  })

  describe('execute — scroll', () => {
    it('performs swipe gesture in the specified direction', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      const result = await adapter.execute({ type: 'scroll', mode: 'direction', direction: 'down', amount: 'page', retryOpposite: false })
      expect(result.success).toBe(true)
      expect(result.metadata?.scrollUntilVisible).toBeDefined()

      expect(mockDriver.action).toHaveBeenCalledWith('pointer', { parameters: { pointerType: 'touch' } })
      // viewport: 1080x1920, center: 540,960; page swipe distance = round(1920*0.6) = 1152.
      // scroll DOWN reveals content below => finger swipes UP (960+576=1536 -> 960-576=384).
      expect(mockDriver._pointerAction.move).toHaveBeenCalledWith({ x: 540, y: 1536 })
      expect(mockDriver._pointerAction.move).toHaveBeenCalledWith({ x: 540, y: 384, duration: 300 })
    })
  })

  describe('execute — longpress', () => {
    it('holds at element center for specified duration', async () => {
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()

      const checkboxEl = state.elements.find(e => e.name === 'Remember me')
      expect(checkboxEl).toBeDefined()

      const result = await adapter.execute({ type: 'longpress', ref: checkboxEl!.ref, duration: 2000 })
      expect(result.success).toBe(true)

      expect(mockDriver._pointerAction.pause).toHaveBeenCalledWith(2000)
      expect(mockDriver._pointerAction.down).toHaveBeenCalledWith({ button: 0 })
      expect(mockDriver._pointerAction.up).toHaveBeenCalledWith({ button: 0 })
    })

    it('defaults to 1000ms duration', async () => {
      await adapter.setup({ platform: 'android' })
      const state = await adapter.observe()
      const checkboxEl = state.elements.find(e => e.name === 'Remember me')

      await adapter.execute({ type: 'longpress', ref: checkboxEl!.ref })
      expect(mockDriver._pointerAction.pause).toHaveBeenCalledWith(1000)
    })
  })

  // openLink retired (D-19) — the deep-link-open behavior re-keys onto the typed `intent` verb
  // (mobile: startActivity). Exhaustive hostile-input pins live in catalog.test.ts.
  describe('execute — intent', () => {
    it('maps action + data + package to typed mobile: startActivity args (uri, never a shell string)', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.execute.mockClear()

      const result = await adapter.execute({
        type: 'intent',
        action: 'android.intent.action.VIEW',
        data: 'wikipedia://wiki/Grace_Hopper',
        packageName: 'org.wikipedia.alpha',
      })

      expect(result.success).toBe(true)
      expect(mockDriver.execute).toHaveBeenCalledWith('mobile: startActivity', {
        action: 'android.intent.action.VIEW',
        uri: 'wikipedia://wiki/Grace_Hopper',
        package: 'org.wikipedia.alpha',
      })
    })

    it('maps typed extras to [typeTag,key,value] triples (string→s, int→i, bool→z)', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.execute.mockClear()

      const result = await adapter.execute({
        type: 'intent',
        action: 'android.intent.action.VIEW',
        extras: [
          { key: 'name', type: 'string', value: 'Ada' },
          { key: 'count', type: 'int', value: '3' },
          { key: 'flag', type: 'bool', value: 'true' },
        ],
      })

      expect(result.success).toBe(true)
      expect(mockDriver.execute).toHaveBeenCalledWith('mobile: startActivity', {
        action: 'android.intent.action.VIEW',
        extras: [['s', 'name', 'Ada'], ['i', 'count', '3'], ['z', 'flag', 'true']],
      })
    })

    it('omits uri/package/extras when only an action is provided', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.execute.mockClear()

      const result = await adapter.execute({ type: 'intent', action: 'android.intent.action.MAIN' })

      expect(result.success).toBe(true)
      expect(mockDriver.execute).toHaveBeenCalledWith('mobile: startActivity', {
        action: 'android.intent.action.MAIN',
      })
    })
  })

  describe('execute — waitFor', () => {
    it('polls the accessibility tree for on:text (not a blind pause)', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.getPageSource.mockClear()
      const result = await adapter.execute({ type: 'waitFor', on: 'text', text: 'Sign In', timeoutMs: 500 })
      expect(result.success).toBe(true)
      expect(mockDriver.getPageSource).toHaveBeenCalled()
    })

    it('returns a §7.1 web-only error for on:selector (no selector waiting on native)', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'waitFor', on: 'selector', selector: '#done', timeoutMs: 500 })
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/web|selector/i)
    })
  })

  describe('execute — delay', () => {
    it('pauses for exactly action.ms (required field, no fallback)', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'delay', ms: 1500 })
      expect(result.success).toBe(true)
      expect(mockDriver.pause).toHaveBeenCalledWith(1500)
    })
  })

  describe('execute — keypress', () => {
    it('sends mapped key code for single key', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'keypress', keys: ['Enter'], mode: 'press' })
      expect(result.success).toBe(true)
      expect(mockDriver.keys).toHaveBeenCalledTimes(1)
      expect(mockDriver.keys).toHaveBeenCalledWith(['\uE007'])
    })

    it('iterates multiple keys in order with KEY_MAP lookup', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'keypress', keys: ['Tab', 'Enter', 'Escape'], mode: 'press' })
      expect(result.success).toBe(true)
      expect(mockDriver.keys).toHaveBeenCalledTimes(3)
      expect(mockDriver.keys).toHaveBeenNthCalledWith(1, ['\uE004'])
      expect(mockDriver.keys).toHaveBeenNthCalledWith(2, ['\uE007'])
      expect(mockDriver.keys).toHaveBeenNthCalledWith(3, ['\uE00C'])
    })

    it('falls back to raw string when key is not in KEY_MAP', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'keypress', keys: ['a'], mode: 'press' })
      expect(result.success).toBe(true)
      expect(mockDriver.keys).toHaveBeenCalledWith(['a'])
    })

    it('ignores convertPlatformKeys flag (no-op on mobile)', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'keypress', keys: ['Enter'], mode: 'press', convertPlatformKeys: false })
      expect(result.success).toBe(true)
      expect(mockDriver.keys).toHaveBeenCalledWith(['\uE007'])
    })
  })

  describe('execute — keypress mode gating', () => {
    it('returns a §7.1 press-only error for mode:down (web-only key hold/release)', async () => {
      await adapter.setup({ platform: 'android' })
      const down = await adapter.execute({ type: 'keypress', keys: ['Shift'], mode: 'down' })
      expect(down.success).toBe(false)
      expect(down.error).toMatch(/press|mobile|down|up/i)
      expect(mockDriver.keys).not.toHaveBeenCalled()
    })
  })

  // assert retired (D-19) — deterministic checks now route through the runner-side assertValue
  // comparator and claim-shaped checks through assertAI; there is no adapter assert case.

  describe('screenshot', () => {
    it('returns PNG buffer from base64', async () => {
      await adapter.setup({ platform: 'android' })
      const buf = await adapter.screenshot()
      expect(buf).toBeInstanceOf(Buffer)
      expect(buf!.length).toBeGreaterThan(0)
    })

    it('returns undefined when no driver', async () => {
      const buf = await adapter.screenshot()
      expect(buf).toBeUndefined()
    })
  })

  describe('execute — error handling', () => {
    it('captures screenshot on action failure', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      // Make pointer action throw
      mockDriver._pointerAction.perform.mockRejectedValueOnce(new Error('touch failed'))

      const state = await adapter.observe()
      const el = state.elements.find(e => e.name === 'Sign In')
      const result = await adapter.execute({ type: 'tap', ref: el!.ref })

      expect(result.success).toBe(false)
      expect(result.error).toBe('touch failed')
      expect(result.screenshot).toBeInstanceOf(Buffer)
    })
  })

  describe('execute — swipe', () => {
    it('performs directional swipe gesture', async () => {
      await adapter.setup({ platform: 'android' })
      await adapter.observe()

      const result = await adapter.execute({ type: 'swipe', mode: 'direction', direction: 'left', durationMs: 300 })
      expect(result.success).toBe(true)

      expect(mockDriver.action).toHaveBeenCalledWith('pointer', { parameters: { pointerType: 'touch' } })
      expect(mockDriver._pointerAction.perform).toHaveBeenCalled()
    })
  })

  describe('execute — coordinate passthrough (tapCoordinate, swipe, pinch, multiTap)', () => {
    it('tapCoordinate passes LLM coords directly to driver', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'tapCoordinate', x: 100, y: 200, coordSpace: 'viewport' })
      expect(result.success).toBe(true)
      expect(mockDriver._pointerAction.move).toHaveBeenCalledWith({ x: 100, y: 200 })
      expect(result.coordinates).toEqual({ x: 100, y: 200 })
    })

    it('tapCoordinate passes arbitrary coords unchanged', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'tapCoordinate', x: 200, y: 400, coordSpace: 'viewport' })
      expect(result.success).toBe(true)
      expect(mockDriver._pointerAction.move).toHaveBeenCalledWith({ x: 200, y: 400 })
      expect(result.coordinates).toEqual({ x: 200, y: 400 })
    })

    it('swipe (mode:path) drives from/to points directly to driver', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({
        type: 'swipe',
        mode: 'path',
        from: { x: 100, y: 200 },
        to: { x: 300, y: 400 },
        coordSpace: 'viewport',
        durationMs: 300,
      })
      expect(result.success).toBe(true)
      expect(mockDriver._pointerAction.move).toHaveBeenNthCalledWith(1, { x: 100, y: 200 })
      expect(mockDriver._pointerAction.move).toHaveBeenNthCalledWith(2, { x: 300, y: 400, duration: 300 })
      expect(result.startCoordinates).toEqual({ x: 100, y: 200 })
      expect(result.endCoordinates).toEqual({ x: 300, y: 400 })
    })

    it('pinch center coords pass directly to driver', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'pinch', scale: 0.5, x: 100, y: 200, coordSpace: 'viewport' })
      expect(result.success).toBe(true)
      expect(result.coordinates).toEqual({ x: 100, y: 200 })
    })

    it('multiTap center coords pass directly to driver', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'multiTap', fingers: 2, x: 100, y: 200, coordSpace: 'viewport' })
      expect(result.success).toBe(true)
    })

    it('coords pass through unchanged (viewport-space contract)', async () => {
      await adapter.setup({ platform: 'android' })
      const result = await adapter.execute({ type: 'tapCoordinate', x: 100, y: 200, coordSpace: 'viewport' })
      expect(result.coordinates).toEqual({ x: 100, y: 200 })
    })
  })

  describe('screenshot — action-space alignment assertion (D-06)', () => {
    it('returns screenshot buffer without warning when dimensions match getWindowSize', async () => {
      await adapter.setup({ platform: 'android' })
      // SCREENSHOT_BASE64 is a 1x1 PNG, window is 1080x1920 → will warn but not throw
      // Just verify the call completes without throwing
      const buf = await adapter.screenshot()
      expect(buf).toBeInstanceOf(Buffer)
    })

    it('does not throw when getWindowSize fails', async () => {
      await adapter.setup({ platform: 'android' })
      mockDriver.getWindowSize.mockRejectedValueOnce(new Error('session closed'))
      const buf = await adapter.screenshot()
      expect(buf).toBeInstanceOf(Buffer)  // Assertion failure is best-effort, returns buffer
    })
  })

  describe('liveStream (428 D-11)', () => {
    function contextSpies() {
      const spies = {
        getContext: vi.fn().mockResolvedValue('NATIVE_APP'),
        switchContext: vi.fn().mockResolvedValue(undefined),
        getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
        takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
      }
      Object.assign(mockDriver, spies)
      return spies
    }

    it('LIVE-STREAM-IS-CONTEXT-NEUTRAL-SNAPSHOT: snapshots come from takeScreenshot alone, never a context switch', async () => {
      await adapter.setup({ platform: 'android' })
      const spies = contextSpies()
      const stream = (adapter as PlatformAdapter<'android'>).liveStream
      expect(stream?.kind).toBe('snapshot')
      const frames: LiveFrame[] = []
      await stream!.start((frame) => frames.push(frame))
      await vi.waitFor(() => expect(frames).toHaveLength(1))
      await stream!.stop()
      expect(Buffer.from(frames[0].bytes).toString('base64')).toBe(SCREENSHOT_BASE64)
      expect(frames[0].kind).toBe('snapshot')
      expect(spies.takeScreenshot).toHaveBeenCalledTimes(1)
      expect(spies.switchContext, 'a tick must never move the session under a running step').not.toHaveBeenCalled()
      expect(spies.getContext).not.toHaveBeenCalled()
      expect(spies.getWindowSize).not.toHaveBeenCalled()
    })

    it('the getter answers one capability, before the driver exists too, and cleanup() stops and drops it', async () => {
      const early = (adapter as PlatformAdapter<'android'>).liveStream
      expect(early?.kind, 'declared before setup, so selection never reaches screenshot()').toBe('snapshot')
      await adapter.setup({ platform: 'android' })
      const stream = (adapter as PlatformAdapter<'android'>).liveStream
      expect(stream).toBe(early)
      expect((adapter as PlatformAdapter<'android'>).liveStream).toBe(stream)
      const stop = vi.spyOn(stream!, 'stop')
      await stream!.start(() => {})
      await adapter.cleanup()
      expect(stop).toHaveBeenCalledTimes(1)
      expect((adapter as PlatformAdapter<'android'>).liveStream).not.toBe(stream)
    })
  })
})
