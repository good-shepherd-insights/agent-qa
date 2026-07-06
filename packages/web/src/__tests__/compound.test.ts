import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebPlatformAdapter } from '../adapter.js'

// ---------------------------------------------------------------------------
// Wave-0 RED scaffold — Phase 359 Plan 02, Task 1 (EXEC-01/02/03; D-05..D-09).
//
// These suites pin the WEB adapter fill/scroll/openApp COMPOUND behaviors before
// any adapter edit lands. They fail on not-yet-implemented compound behavior (the
// current `case 'fill'` neither re-reads via inputValue() nor understands the
// schema `Fill` shape; `case 'scroll'` has no untilVisible native rung; `openApp`
// is not a handled action). They MUST NOT fail on compile errors: execution-shaped
// action literals are cast via `as unknown as Parameters<typeof adapter.execute>[0]`
// so the cast is legal both before and after the Plan-04 Action-union flip.
//
// The pre-existing packages/web/src/__tests__/adapter.test.ts stays GREEN — this is
// a standalone file; it does not touch the legacy `fill {value}` / `scroll {value}`
// contracts that file pins.
// ---------------------------------------------------------------------------

// Ordered call log shared across the mock so ordering pins survive implementation
// detail (which method, in what order, how many times).
let calls: string[] = []
let inputValueReturn: string
let inputValueThrows: boolean
let typeAttrReturn: string | null
let evaluateReturn: unknown

function makeLocator() {
  return {
    fill: vi.fn().mockImplementation((t: string) => { calls.push(`fill:${t}`); return Promise.resolve() }),
    click: vi.fn().mockImplementation(() => { calls.push('click'); return Promise.resolve() }),
    press: vi.fn().mockImplementation((k: string) => { calls.push(`press:${k}`); return Promise.resolve() }),
    pressSequentially: vi.fn().mockImplementation((t: string) => { calls.push(`pressSeq:${t}`); return Promise.resolve() }),
    inputValue: vi.fn().mockImplementation(() => {
      calls.push('inputValue')
      if (inputValueThrows) return Promise.reject(new Error("Node is not an <input>, <textarea> or <select> element"))
      return Promise.resolve(inputValueReturn)
    }),
    getAttribute: vi.fn().mockImplementation((name: string) => {
      calls.push(`getAttr:${name}`)
      return Promise.resolve(name === 'type' ? typeAttrReturn : null)
    }),
    boundingBox: vi.fn().mockResolvedValue({ x: 50, y: 100, width: 200, height: 40 }),
    evaluate: vi.fn().mockImplementation(() => { calls.push('evaluate'); return Promise.resolve(evaluateReturn) }),
    scrollIntoViewIfNeeded: vi.fn().mockImplementation(() => { calls.push('scrollIntoViewIfNeeded'); return Promise.resolve() }),
    nth: vi.fn().mockReturnThis(),
    first: vi.fn().mockReturnThis(),
    focus: vi.fn().mockImplementation(() => { calls.push('focus'); return Promise.resolve() }),
    selectOption: vi.fn().mockResolvedValue(undefined),
  }
}

let locator: ReturnType<typeof makeLocator>

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  mouse: {
    move: vi.fn().mockResolvedValue(undefined),
    wheel: vi.fn().mockImplementation(() => { calls.push('wheel'); return Promise.resolve() }),
    click: vi.fn().mockResolvedValue(undefined),
  },
  waitForSelector: vi.fn().mockResolvedValue(undefined),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  waitForURL: vi.fn().mockResolvedValue(undefined),
  bringToFront: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
  addInitScript: vi.fn().mockResolvedValue(undefined),
  video: vi.fn().mockReturnValue(null),
  locator: vi.fn().mockReturnValue({
    ariaSnapshot: vi.fn().mockResolvedValue('- textbox "Email" [ref=e1]'),
  }),
  on: vi.fn(),
  url: vi.fn().mockReturnValue('https://example.com'),
  title: vi.fn().mockResolvedValue('Example Page'),
  viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
  getByRole: vi.fn(() => locator),
  getByText: vi.fn().mockImplementation((t: string) => { calls.push(`getByText:${t}`); return locator }),
}

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  pages: vi.fn().mockReturnValue([mockPage]),
  addInitScript: vi.fn().mockResolvedValue(undefined),
  grantPermissions: vi.fn().mockResolvedValue(undefined),
}

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}

vi.mock('playwright-core', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mockBrowser) },
  firefox: { launch: vi.fn().mockResolvedValue(mockBrowser) },
  webkit: { launch: vi.fn().mockResolvedValue(mockBrowser) },
}))

type ExecAction = Parameters<WebPlatformAdapter['execute']>[0]

async function setupWithEmailField(adapter: WebPlatformAdapter): Promise<string> {
  await adapter.setup({ platform: 'web' })
  const state = await adapter.observe()
  const el = state.elements.find(e => e.name === 'Email')
  if (!el) throw new Error('test fixture: Email textbox not observed')
  return el.ref
}

describe('WebPlatformAdapter compound behaviors (RED — Wave-0)', () => {
  let adapter: WebPlatformAdapter

  beforeEach(() => {
    adapter = new WebPlatformAdapter()
    calls = []
    inputValueReturn = ''
    inputValueThrows = false
    typeAttrReturn = 'text'
    evaluateReturn = undefined
    locator = makeLocator()
    vi.clearAllMocks()
  })

  describe('EXEC-01 fill compound (D-05/D-06/D-07/D-08)', () => {
    it('replace mode re-reads via inputValue() AFTER fill, and only presses Enter after the re-read when submit is true', async () => {
      const ref = await setupWithEmailField(adapter)
      inputValueReturn = 'hello'

      const result = await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: true } as unknown as ExecAction)

      expect(result.success).toBe(true)
      // Re-read from the SAME live handle after typing (D-05).
      expect(locator.inputValue).toHaveBeenCalled()
      // Enter is pressed only after the re-read (D-07).
      expect(locator.press).toHaveBeenCalledWith('Enter')
      const readIdx = calls.indexOf('inputValue')
      const enterIdx = calls.lastIndexOf('press:Enter')
      expect(enterIdx).toBeGreaterThan(readIdx)
    })

    it('replace mode with submit=false does NOT press Enter', async () => {
      const ref = await setupWithEmailField(adapter)
      inputValueReturn = 'hello'

      await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(locator.inputValue).toHaveBeenCalled()
      expect(calls).not.toContain('press:Enter')
    })

    it('append mode captures prior value FIRST, then click + End + pressSequentially; expected = prior + typed', async () => {
      const ref = await setupWithEmailField(adapter)
      // prior read returns 'abc'; after typing the field reads 'abcXYZ'
      inputValueReturn = 'abc'
      let firstRead = true
      locator.inputValue.mockImplementation(() => {
        calls.push('inputValue')
        const v = firstRead ? 'abc' : 'abcXYZ'
        firstRead = false
        return Promise.resolve(v)
      })

      const result = await adapter.execute({ type: 'fill', ref, text: 'XYZ', clearMode: 'append', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      // prior-capture BEFORE any typing (D-07)
      expect(calls[0]).toBe('inputValue')
      expect(locator.pressSequentially).toHaveBeenCalledWith('XYZ')
      expect(locator.press).toHaveBeenCalledWith('End')
      expect(result.metadata?.fillReread).toMatchObject({ expected: 'abcXYZ', actual: 'abcXYZ' })
    })

    it('mismatch yields success:false + §7.1 error + fillReread meta, with NO internal retry (D-08)', async () => {
      const ref = await setupWithEmailField(adapter)
      inputValueReturn = 'wrong'

      const result = await adapter.execute({ type: 'fill', ref, text: 'intended', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/reads .* after typing .* re-observe and retry/i)
      expect(result.metadata?.fillReread).toEqual({ expected: 'intended', actual: 'wrong' })
      // single-shot typing — no silent re-attempt (D-08)
      expect(locator.fill).toHaveBeenCalledTimes(1)
    })

    it('secure field (type=password) verdicts on non-emptiness and never records the raw value', async () => {
      const ref = await setupWithEmailField(adapter)
      typeAttrReturn = 'password'
      inputValueReturn = 'sup3rSecret'

      const result = await adapter.execute({ type: 'fill', ref, text: 'sup3rSecret', clearMode: 'replace', submit: false } as unknown as ExecAction)

      expect(result.success).toBe(true)
      // sentinel metadata present, but the raw secret is absent from the serialized result
      expect(result.metadata?.fillReread).toBeDefined()
      expect(JSON.stringify(result)).not.toContain('sup3rSecret')
    })

    it('inputValue throwing on a non-input element attempts an evaluate fallback; unreadable value ⇒ success with NO fillReread key (signal-presence law)', async () => {
      const ref = await setupWithEmailField(adapter)
      inputValueThrows = true
      evaluateReturn = undefined // nothing readable via the fallback either

      const result = await adapter.execute({ type: 'fill', ref, text: 'hello', clearMode: 'replace', submit: false } as unknown as ExecAction)

      // fallback read attempted rather than crashing (Pitfall 8)
      expect(locator.evaluate).toHaveBeenCalled()
      // never fabricate a re-read pair when nothing is readable
      expect(result.success).toBe(true)
      expect(result.metadata?.fillReread).toBeUndefined()
    })
  })

  describe('EXEC-02 scroll untilVisible', () => {
    it('runs a native getByText scrollIntoView rung FIRST and records scrollUntilVisible metadata', async () => {
      await adapter.setup({ platform: 'web' })
      await adapter.observe()

      const result = await adapter.execute({
        type: 'scroll', mode: 'untilVisible', text: 'Load more', direction: 'down', maxSwipes: 3, retryOpposite: true,
      } as unknown as ExecAction)

      expect(result.success).toBe(true)
      // native search-scroll preferred before blind wheel scrolling (§12.12)
      expect(mockPage.getByText).toHaveBeenCalledWith('Load more')
      const nativeIdx = calls.findIndex(c => c.startsWith('getByText:'))
      const wheelIdx = calls.indexOf('wheel')
      if (wheelIdx !== -1) expect(nativeIdx).toBeLessThan(wheelIdx)
      expect(result.metadata?.scrollUntilVisible).toBeDefined()
    })
  })

  describe('EXEC-03 openApp on web (D-09)', () => {
    it('returns a structured error naming navigate(url) and never navigates the page', async () => {
      await adapter.setup({ platform: 'web' })
      mockPage.goto.mockClear()

      const result = await adapter.execute({ type: 'openApp', appName: 'Gmail' } as unknown as ExecAction)

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/navigate/i)
      expect(mockPage.goto).not.toHaveBeenCalled()
    })
  })
})
