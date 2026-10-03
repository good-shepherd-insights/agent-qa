import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// P3: iOS sessions request WDA snapshotMaxDepth 62, and a page-source read that XCTest cannot
// snapshot at that depth is re-read once at 50 before the depth goes back to 62.

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="App" label="App" x="0" y="0" width="390" height="844">
    <XCUIElementTypeStaticText label="Deep row" x="20" y="100" width="350" height="30" enabled="true" />
    <XCUIElementTypeButton label="Done" x="20" y="200" width="350" height="44" enabled="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>`

function snapshotError(message = 'Original error: kAXErrorIllegalArgument getting snapshot for element', name = 'stale element reference'): Error {
  const err = new Error(message)
  err.name = name
  return err
}

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
    getPageSource: vi.fn().mockResolvedValue(XML),
    getWindowSize: vi.fn().mockResolvedValue({ width: 390, height: 844 }),
    updateSettings: vi.fn().mockResolvedValue(undefined),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    switchContext: vi.fn().mockResolvedValue(undefined),
    takeScreenshot: vi.fn().mockResolvedValue(''),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(pointerAction),
    pause: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    _pointerAction: pointerAction,
  }
}

vi.mock('webdriverio', () => ({
  remote: vi.fn(),
}))

import { IOSPlatformAdapter } from '../adapter.js'

describe('iOS snapshot depth (P3)', () => {
  let adapter: IOSPlatformAdapter
  let driver: ReturnType<typeof createMockDriver>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    driver = createMockDriver()
    const { remote } = await import('webdriverio')
    vi.mocked(remote).mockResolvedValue(driver as any)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    adapter = new IOSPlatformAdapter()
  })

  afterEach(() => {
    warn.mockRestore()
    vi.restoreAllMocks()
  })

  describe('capability', () => {
    it('requests snapshotMaxDepth 62 on a local session', async () => {
      await adapter.setup({ platform: 'ios' })
      const { remote } = await import('webdriverio')
      const call = vi.mocked(remote).mock.calls[0][0] as any
      expect(call.capabilities['appium:settings[snapshotMaxDepth]']).toBe(62)
      expect(driver.updateSettings).not.toHaveBeenCalled()
    })

    it('requests it on a farm session, where the farm capabilities still win', async () => {
      const farmSession = { hostname: 'farm.test', port: 443, path: '/wd/hub', capabilities: { 'farm:token': 'x' } }
      await adapter.setup({ platform: 'ios', farmSession })
      const { remote } = await import('webdriverio')
      expect((vi.mocked(remote).mock.calls[0][0] as any).capabilities['appium:settings[snapshotMaxDepth]']).toBe(62)

      await adapter.setup({
        platform: 'ios',
        farmSession: { ...farmSession, capabilities: { 'appium:settings[snapshotMaxDepth]': 40 } },
      })
      expect((vi.mocked(remote).mock.calls[1][0] as any).capabilities['appium:settings[snapshotMaxDepth]']).toBe(40)
    })
  })

  describe('fallback', () => {
    it('re-reads once at 50 on the XCTest snapshot error, then restores 62 and logs it', async () => {
      driver.getPageSource.mockRejectedValueOnce(snapshotError()).mockResolvedValueOnce(XML)
      await adapter.setup({ platform: 'ios' })
      const state = await adapter.observe()

      expect(state.tree).toContain('text "Deep row"')
      expect(state.tree).toContain('button "Done"')
      expect(driver.getPageSource).toHaveBeenCalledTimes(2)
      expect(driver.updateSettings.mock.calls).toEqual([[{ snapshotMaxDepth: 50 }], [{ snapshotMaxDepth: 62 }]])
      const [lower, restore] = driver.updateSettings.mock.invocationCallOrder
      const [firstRead, secondRead] = driver.getPageSource.mock.invocationCallOrder
      expect(firstRead).toBeLessThan(lower)
      expect(lower).toBeLessThan(secondRead)
      expect(secondRead).toBeLessThan(restore)

      expect(warn).toHaveBeenCalledTimes(1)
      const message = String(warn.mock.calls[0][0])
      expect(message.startsWith('[ios-adapter]')).toBe(true)
      expect(message).toContain('62')
      expect(message).toContain('50')
      expect(message).not.toContain('<AppiumAUT>')
    })

    it.each([
      ['kAXErrorIllegalArgument only', snapshotError('Original error: kAXErrorIllegalArgument', 'Error')],
      ['getting snapshot only', snapshotError('Error getting snapshot for the application', 'Error')],
      ['stale element reference name only', snapshotError('An unknown server-side error occurred', 'stale element reference')],
    ])('detects the %s variant', async (_label, err) => {
      driver.getPageSource.mockRejectedValueOnce(err).mockResolvedValueOnce(XML)
      await adapter.setup({ platform: 'ios' })
      const state = await adapter.observe()
      expect(state.tree).toContain('button "Done"')
      expect(driver.getPageSource).toHaveBeenCalledTimes(2)
      expect(driver.updateSettings).toHaveBeenCalledWith({ snapshotMaxDepth: 50 })
    })

    it('propagates any other error with no retry', async () => {
      const err = new Error('invalid session id')
      driver.getPageSource.mockRejectedValue(err)
      await adapter.setup({ platform: 'ios' })
      await expect(adapter.observe()).rejects.toBe(err)
      expect(driver.getPageSource).toHaveBeenCalledTimes(1)
      expect(driver.updateSettings).not.toHaveBeenCalled()
    })

    it('retries only once when the fallback read also fails', async () => {
      driver.getPageSource.mockRejectedValue(snapshotError())
      await adapter.setup({ platform: 'ios' })
      await expect(adapter.observe()).rejects.toThrow(/kAXErrorIllegalArgument/)
      expect(driver.getPageSource).toHaveBeenCalledTimes(2)
      expect(driver.updateSettings.mock.calls).toEqual([[{ snapshotMaxDepth: 50 }], [{ snapshotMaxDepth: 62 }]])
      expect(warn).not.toHaveBeenCalled()
    })

    it('rethrows the original read error when the depth cannot be lowered', async () => {
      const err = snapshotError()
      driver.getPageSource.mockRejectedValue(err)
      driver.updateSettings.mockRejectedValue(new Error('settings not supported'))
      await adapter.setup({ platform: 'ios' })
      await expect(adapter.observe()).rejects.toBe(err)
      expect(driver.getPageSource).toHaveBeenCalledTimes(1)
    })

    it('still answers the fallback read when restoring 62 fails', async () => {
      driver.getPageSource.mockRejectedValueOnce(snapshotError()).mockResolvedValueOnce(XML)
      driver.updateSettings.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('gone'))
      await adapter.setup({ platform: 'ios' })
      const state = await adapter.observe()
      expect(state.tree).toContain('button "Done"')
    })
  })

  describe('shared reader', () => {
    it('waitFor text finds the needle in the fallback read', async () => {
      driver.getPageSource.mockRejectedValueOnce(snapshotError()).mockResolvedValueOnce(XML)
      await adapter.setup({ platform: 'ios' })
      const result = await adapter.execute({ type: 'waitFor', on: 'text', text: 'Deep row', timeoutMs: 20 })
      expect(result.success).toBe(true)
      expect(driver.getPageSource).toHaveBeenCalledTimes(2)
      // Found in the same poll, not after the poll loop treated the failed read as empty.
      expect(driver.updateSettings).toHaveBeenCalledWith({ snapshotMaxDepth: 50 })
      expect(driver.pause).not.toHaveBeenCalled()
    })

    it('a toEnd scroll completes when one interim-tree read hits the snapshot error', async () => {
      driver.getPageSource.mockRejectedValueOnce(snapshotError())
      await adapter.setup({ platform: 'ios' })
      const result = await adapter.execute({
        type: 'scroll',
        mode: 'direction',
        direction: 'down',
        amount: 'toEnd',
        retryOpposite: false,
      })
      expect(result.success).toBe(true)
      expect(driver.updateSettings).toHaveBeenCalledWith({ snapshotMaxDepth: 50 })
    })
  })
})
