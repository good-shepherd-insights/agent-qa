import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Wave-0 RED scaffold — Phase 359 Plan 02, Task 3 (EXEC-01/02/03; D-05..D-08,
// D-10, D-12, Pitfalls 5/7/9). Pins the iOS adapter fill/scroll/openApp compound
// sequences against a call-logging mocked webdriverio driver — no live Appium,
// no simctl/child_process (ownership contract: webdriverio only).
//
// RED convention: these fail on not-yet-implemented compound behavior (the current
// `case 'fill'` sets a value but never re-reads getAttribute('value'); `case 'scroll'`
// has no native `mobile: scroll` predicate rung; `openApp` is not a handled action).
// They MUST NOT fail on compile errors — execution-shaped action literals are cast via
// `as unknown as Parameters<typeof adapter.execute>[0]`.
//
// The pre-existing adapter.test.ts and conformance.test.ts stay GREEN (standalone
// file; legacy `fill {value}` / `scroll {value}` contracts untouched).
// ---------------------------------------------------------------------------

const IOS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="TestApp" label="TestApp" x="0" y="0" width="390" height="844">
    <XCUIElementTypeOther x="0" y="0" width="390" height="844">
      <XCUIElementTypeStaticText label="Welcome" x="50" y="100" width="290" height="40" enabled="true" />
      <XCUIElementTypeTextField label="Email" value="" x="50" y="180" width="290" height="44" enabled="true" />
      <XCUIElementTypeSecureTextField label="Password" value="" x="50" y="240" width="290" height="44" enabled="true" />
      <XCUIElementTypeButton label="Log In" x="50" y="320" width="290" height="50" enabled="true" />
    </XCUIElementTypeOther>
  </XCUIElementTypeApplication>
</AppiumAUT>`

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

// Configurable re-read for the focused text-field element.
let fieldValueReturn: string
function createMockElement() {
  return {
    isExisting: vi.fn().mockResolvedValue(true),
    setValue: vi.fn().mockImplementation((v: string) => { calls.push(`setValue:${v}`); return Promise.resolve() }),
    addValue: vi.fn().mockImplementation((v: string) => { calls.push(`addValue:${v}`); return Promise.resolve() }),
    clearValue: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockImplementation((n: string) => {
      calls.push(`getAttr:${n}`)
      return Promise.resolve(n === 'value' ? fieldValueReturn : null)
    }),
    getValue: vi.fn().mockImplementation(() => { calls.push('getValue'); return Promise.resolve(fieldValueReturn) }),
  }
}
let mockElement: ReturnType<typeof createMockElement>

// `mobile: listApps` returns a bundleId-keyed map with CFBundleName labels.
let listAppsReturn: Record<string, { CFBundleName?: string }>
let listAppsThrows: boolean
let isAppInstalledReturn: boolean

function createMockDriver() {
  const pointerAction = createMockPointerAction()
  return {
    getPageSource: vi.fn().mockImplementation(() => { calls.push('getPageSource'); return Promise.resolve(IOS_XML) }),
    getWindowSize: vi.fn().mockResolvedValue({ width: 390, height: 844 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(pointerAction),
    actions: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockImplementation((k: unknown) => { calls.push(`keys:${JSON.stringify(k)}`); return Promise.resolve() }),
    pause: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockImplementation((id: string) => { calls.push(`activateApp:${id}`); return Promise.resolve() }),
    terminateApp: vi.fn().mockResolvedValue(undefined),
    isAppInstalled: vi.fn().mockImplementation(() => { calls.push('isAppInstalled'); return Promise.resolve(isAppInstalledReturn) }),
    execute: vi.fn().mockImplementation((command: string, args?: unknown) => {
      calls.push(`execute:${command}:${JSON.stringify(args ?? null)}`)
      if (command === 'mobile: listApps') {
        if (listAppsThrows) return Promise.reject(new Error('listApps is only supported on real devices'))
        return Promise.resolve(listAppsReturn)
      }
      return Promise.resolve(undefined)
    }),
    deepLink: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockRejectedValue(new Error('not supported')),
    $: vi.fn().mockImplementation(() => Promise.resolve(mockElement)),
    $$: vi.fn().mockResolvedValue([]),
    _pointerAction: pointerAction,
  }
}

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

import { IOSPlatformAdapter } from '../adapter.js'

type ExecAction = Parameters<IOSPlatformAdapter['execute']>[0]

describe('IOSPlatformAdapter compound behaviors (RED — Wave-0)', () => {
  let adapter: IOSPlatformAdapter
  let mockDriver: ReturnType<typeof createMockDriver>

  beforeEach(async () => {
    vi.clearAllMocks()
    calls = []
    fieldValueReturn = ''
    listAppsReturn = {}
    listAppsThrows = false
    isAppInstalledReturn = false
    mockElement = createMockElement()
    mockDriver = createMockDriver()
    const { remote } = await import('webdriverio')
    vi.mocked(remote).mockResolvedValue(mockDriver as any)
    adapter = new IOSPlatformAdapter()
  })

  afterEach(() => { vi.restoreAllMocks() })

  async function refFor(name: string): Promise<string> {
    const state = await adapter.observe()
    const el = state.elements.find(e => e.name === name)
    if (!el) throw new Error(`test fixture: element "${name}" not observed`)
    return el.ref
  }

  describe('EXEC-01 fill compound (D-05/D-06/D-07/D-08)', () => {
    it('replace mode types then re-reads getAttribute("value") from the SAME handle (D-05)', async () => {
      await adapter.setup({ platform: 'ios' })
      const ref = await refFor('Email')
      fieldValueReturn = 'user@test.com'
      calls.length = 0

      const result = await adapter.execute({ type: 'fill', ref, text: 'user@test.com', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(mockElement.getAttribute).toHaveBeenCalledWith('value')
      const typeIdx = calls.findIndex(c => c.startsWith('setValue:'))
      const readIdx = calls.indexOf('getAttr:value')
      expect(readIdx).toBeGreaterThan(typeIdx)
    })

    it('append mode captures prior getAttribute("value") BEFORE typing; expected = prior + typed (D-07)', async () => {
      await adapter.setup({ platform: 'ios' })
      const ref = await refFor('Email')
      fieldValueReturn = 'abc'
      calls.length = 0

      const result = await adapter.execute({ type: 'fill', ref, text: 'XYZ', clearMode: 'append', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      const priorReadIdx = calls.indexOf('getAttr:value')
      const typeIdx = calls.findIndex(c => c.startsWith('addValue:') || c.startsWith('setValue:'))
      expect(priorReadIdx).toBeGreaterThanOrEqual(0)
      expect(priorReadIdx).toBeLessThan(typeIdx)
      expect(result.metadata?.fillReread).toMatchObject({ expected: 'abcXYZ' })
    })

    it('secure field (XCUIElementTypeSecureTextField) verdicts on non-emptiness only; raw value absent from result (D-06, Pitfall 7)', async () => {
      await adapter.setup({ platform: 'ios' })
      const ref = await refFor('Password')
      fieldValueReturn = '•••••••' // masked bullets — length may not equal typed length (A3)

      const result = await adapter.execute({ type: 'fill', ref, text: 'topSecretPw', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(result.metadata?.fillReread).toBeDefined()
      expect(JSON.stringify(result)).not.toContain('topSecretPw')
    })

    it('mismatch yields success:false + §7.1 error + fillReread meta, single-shot typing (D-08)', async () => {
      await adapter.setup({ platform: 'ios' })
      const ref = await refFor('Email')
      fieldValueReturn = 'wrong'

      const result = await adapter.execute({ type: 'fill', ref, text: 'intended', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/reads .* after typing .* re-observe and retry/i)
      expect(result.metadata?.fillReread).toEqual({ expected: 'intended', actual: 'wrong' })
      expect(mockElement.setValue).toHaveBeenCalledTimes(1)
    })

    it('submit=true delivers a return/newline AFTER the re-read (loosely pinned)', async () => {
      await adapter.setup({ platform: 'ios' })
      const ref = await refFor('Email')
      fieldValueReturn = 'hello'
      calls.length = 0

      await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: true } as unknown as ExecAction)

      const isReturnPayload = (c: string) => /\\n|\\uE007|return|enter/i.test(c)
      const readIdx = calls.indexOf('getAttr:value')
      const submitIdx = calls.findIndex(c => (c.startsWith('keys:') || c.startsWith('execute:')) && isReturnPayload(c))
      expect(submitIdx).toBeGreaterThanOrEqual(0)
      expect(submitIdx).toBeGreaterThan(readIdx)
    })
  })

  describe('EXEC-02 scroll untilVisible (Pitfall 9 selector-injection)', () => {
    it('tries native mobile: scroll with a CONTAINS predicateString FIRST (A5)', async () => {
      await adapter.setup({ platform: 'ios' })
      await adapter.observe()

      const result = await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: 'Settings', direction: 'down', maxSwipes: 4, retryOpposite: true,
      } as unknown as ExecAction)

      expect(result.success).toBe(true)
      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeDefined()
      expect(String((scrollCall![1] as any).predicateString)).toMatch(/CONTAINS/)
      expect(result.metadata?.scrollUntilVisible).toBeDefined()
    })

    it('escapes quote/backslash in a hostile target inside the predicateString', async () => {
      await adapter.setup({ platform: 'ios' })
      await adapter.observe()

      await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: 'He said "hi" \\', direction: 'down', maxSwipes: 4, retryOpposite: false,
      } as unknown as ExecAction)

      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeDefined()
      const predicate = String((scrollCall![1] as any).predicateString)
      expect(predicate).toContain('\\"')
    })

    it('rejects a control-character target with a structured error, never interpolating it', async () => {
      await adapter.setup({ platform: 'ios' })
      await adapter.observe()

      const hostile = `evil${String.fromCharCode(1)}break`
      const result = await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: hostile, direction: 'down', maxSwipes: 4, retryOpposite: false,
      } as unknown as ExecAction)

      expect(result.success).toBe(false)
      const scrollCall = mockDriver.execute.mock.calls.find(c => c[0] === 'mobile: scroll')
      expect(scrollCall).toBeUndefined()
    })
  })

  describe('EXEC-03 openApp resolution (D-10/D-12, Pitfall 5)', () => {
    it('success lane: resolves a CFBundleName label and launches via activateApp(resolvedId) with metadata', async () => {
      listAppsReturn = {
        'com.apple.mobilecal': { CFBundleName: 'Calendar' },
        'com.apple.Preferences': { CFBundleName: 'Settings' },
      }
      await adapter.setup({ platform: 'ios' })

      const result = await adapter.execute({ type: 'openApp', appName: 'Calendar' } as unknown as ExecAction)

      expect(result.success).toBe(true)
      expect(mockDriver.activateApp).toHaveBeenCalledWith('com.apple.mobilecal')
      expect(result.metadata?.openApp).toMatchObject({ resolvedId: 'com.apple.mobilecal' })
    })

    it('simulator lane: listApps throwing ⇒ appName variant returns a structured §7.1 error recommending an exact bundleId, never a crash (Pitfall 5)', async () => {
      listAppsThrows = true
      await adapter.setup({ platform: 'ios' })

      const result = await adapter.execute({ type: 'openApp', appName: 'Calendar' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/bundleId/i)
    })

    it('explicit {bundleId} with registry unavailable: invalid bundle NEVER yields success true (A2 fallback)', async () => {
      listAppsThrows = true
      isAppInstalledReturn = false
      await adapter.setup({ platform: 'ios' })

      const result = await adapter.execute({ type: 'openApp', bundleId: 'com.not.installed' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toContain('com.not.installed')
    })

    it('session cache: mobile: listApps executed exactly once across two resolutions', async () => {
      listAppsReturn = {
        'com.apple.mobilecal': { CFBundleName: 'Calendar' },
        'com.apple.Preferences': { CFBundleName: 'Settings' },
      }
      await adapter.setup({ platform: 'ios' })

      await adapter.execute({ type: 'openApp', appName: 'Calendar' } as unknown as ExecAction)
      await adapter.execute({ type: 'openApp', appName: 'Settings' } as unknown as ExecAction)

      const listCount = mockDriver.execute.mock.calls.filter(c => c[0] === 'mobile: listApps').length
      expect(listCount).toBe(1)
    })
  })
})
