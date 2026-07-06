import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FarmWebAdapter } from '../farm-adapter.js'

const {
  mockBrowser,
  mockContext,
  mockConnect,
  mockCdpSession,
} = vi.hoisted(() => {
  const cdpSession = {
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
  }
  const page = {
    on: vi.fn(),
    context: vi.fn(() => ({
      newCDPSession: vi.fn().mockResolvedValue(cdpSession),
    })),
  }
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    grantPermissions: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockReturnValue([page]),
  }
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  }

  return {
    mockBrowser: browser,
    mockContext: context,
    mockConnect: vi.fn().mockResolvedValue(browser),
    mockCdpSession: cdpSession,
  }
})

vi.mock('playwright-core', () => ({
  chromium: { connect: mockConnect },
}))

describe('FarmWebAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: vi.fn() }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads selected auth storage state before creating the first farm page', async () => {
    const adapter = new FarmWebAdapter()

    await adapter.setup({
      platform: 'web',
      browser: {
        name: 'chromium',
        headless: true,
        viewport: { width: 1366, height: 768 },
      },
      farmSession: {
        hostname: 'hub.browserstack.com',
        port: 443,
        path: '/wd/hub',
        capabilities: {
          username: 'browserstack-user',
          accessKey: 'browserstack-key',
          testName: 'Farm Auth State',
        },
      },
      authState: {
        version: 1,
        kind: 'web',
        targetName: 'staging-web',
        stateName: 'admin',
        capturedAt: '2026-05-17T00:00:00.000Z',
        storageStatePath: '/tmp/internal/admin.json',
      },
    })

    expect(mockBrowser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      viewport: { width: 1366, height: 768 },
      storageState: '/tmp/internal/admin.json',
    }))
    expect(mockBrowser.newContext.mock.invocationCallOrder[0]).toBeLessThan(
      mockContext.newPage.mock.invocationCallOrder[0],
    )
    expect(mockCdpSession.detach).toHaveBeenCalled()

    await adapter.cleanup()
  })
})

// Compound-behavior parity (Phase 359 Plan 05, Task 3): the farm execute surface speaks the
// same fill re-read / openApp / untilVisible contracts as the primary adapter. These drive
// execute() directly against injected private fields to avoid the farm-connect lifecycle.
function makeFarmLocator(opts: { inputValue?: string; type?: string }) {
  return {
    fill: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    inputValue: vi.fn().mockResolvedValue(opts.inputValue ?? ''),
    getAttribute: vi.fn().mockResolvedValue(opts.type ?? 'text'),
    boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 10, height: 10 }),
    nth: vi.fn().mockReturnThis(),
    first: vi.fn().mockReturnThis(),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
  }
}

function makeFarmPage(locator: ReturnType<typeof makeFarmLocator>) {
  return {
    getByRole: vi.fn().mockReturnValue(locator),
    getByText: vi.fn().mockReturnValue(locator),
    goto: vi.fn().mockResolvedValue(undefined),
    mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    locator: vi.fn().mockReturnValue({ ariaSnapshot: vi.fn().mockResolvedValue('- textbox "Email"') }),
    evaluate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('x')),
  }
}

function primeAdapter(adapter: FarmWebAdapter, locator: ReturnType<typeof makeFarmLocator>) {
  const page = makeFarmPage(locator)
  ;(adapter as unknown as { page: unknown }).page = page
  ;(adapter as unknown as { lastRefs: unknown }).lastRefs = { e1: { role: 'textbox', name: 'Email' } }
  return page
}

describe('FarmWebAdapter compound behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fill re-read mismatch returns success:false with fillReread metadata (D-08, no internal retry)', async () => {
    const adapter = new FarmWebAdapter()
    const locator = makeFarmLocator({ inputValue: 'wrong' })
    primeAdapter(adapter, locator)

    const result = await adapter.execute({ type: 'fill', ref: 'e1', text: 'intended', clearMode: 'replace', submit: false } as never)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/reads .* after typing .* re-observe and retry/i)
    expect(result.metadata?.fillReread).toEqual({ expected: 'intended', actual: 'wrong' })
    expect(locator.fill).toHaveBeenCalledTimes(1)
  })

  it('openApp returns the D-09 navigate-directing structured error and never navigates', async () => {
    const adapter = new FarmWebAdapter()
    const locator = makeFarmLocator({})
    const page = primeAdapter(adapter, locator)

    const result = await adapter.execute({ type: 'openApp', appName: 'Gmail' } as never)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/navigate/i)
    expect(page.goto).not.toHaveBeenCalled()
  })

  it('untilVisible scroll rides scrollUntilVisible metadata bounded by maxSwipes', async () => {
    const adapter = new FarmWebAdapter()
    const locator = makeFarmLocator({})
    primeAdapter(adapter, locator)

    const result = await adapter.execute({
      type: 'scroll', mode: 'untilVisible', text: 'Nonexistent', direction: 'down', maxSwipes: 2, retryOpposite: false,
    } as never)

    expect(result.success).toBe(true)
    const meta = result.metadata?.scrollUntilVisible as { swipes: number; outcome: string } | undefined
    expect(meta).toBeDefined()
    expect(meta!.swipes).toBeLessThanOrEqual(2)
  })
})
