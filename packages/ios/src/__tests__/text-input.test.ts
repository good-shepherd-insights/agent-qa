import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// AUTO-18 observe-to-execute text-input cells: an observed iOS screen drives fill/clearText
// through a call-logging mocked webdriverio driver (no live Appium). Elements are located by
// XCUI type + observed bounds, and keyboard focus is read from getActiveElement.

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735a1b0f2d'

type Rect = { x: number; y: number; width: number; height: number }

const RECTS: Record<string, Rect> = {
  heading: { x: 20, y: 60, width: 350, height: 30 },
  title: { x: 20, y: 100, width: 350, height: 44 },
  body: { x: 20, y: 160, width: 350, height: 120 },
  terms: { x: 20, y: 300, width: 350, height: 80 },
  send: { x: 20, y: 400, width: 350, height: 50 },
  notes: { x: 20, y: 470, width: 350, height: 120 },
}

function attrs(r: Rect): string {
  return `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`
}

const FORM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="Probe" label="Probe" x="0" y="0" width="390" height="844">
    <XCUIElementTypeOther x="0" y="0" width="390" height="844">
      <XCUIElementTypeStaticText label="Heading" ${attrs(RECTS.heading)} enabled="true" />
      <XCUIElementTypeTextField label="Title" placeholderValue="Title" ${attrs(RECTS.title)} enabled="true" />
      <XCUIElementTypeTextView label="Body" ${attrs(RECTS.body)} enabled="true" />
      <XCUIElementTypeTextView label="Terms" value="Static terms text" ${attrs(RECTS.terms)} enabled="true" />
      <XCUIElementTypeButton label="Send" ${attrs(RECTS.send)} enabled="true" />
    </XCUIElementTypeOther>
  </XCUIElementTypeApplication>
</AppiumAUT>`

const TWO_VIEWS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="Probe" label="Probe" x="0" y="0" width="390" height="844">
    <XCUIElementTypeTextView label="Body" ${attrs(RECTS.body)} enabled="true" />
    <XCUIElementTypeTextView label="Notes" ${attrs(RECTS.notes)} enabled="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>`

const SCREENSHOT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let calls: string[] = []
let lastTap: { x: number; y: number } | undefined

interface MockField {
  elementId: string
  value: string
  placeholder: string | null
  setValue: ReturnType<typeof vi.fn>
  addValue: ReturnType<typeof vi.fn>
  clearValue: ReturnType<typeof vi.fn>
  getAttribute: ReturnType<typeof vi.fn>
}

function createField(id: string, value = '', placeholder: string | null = null): MockField {
  const field: MockField = {
    elementId: id,
    value,
    placeholder,
    setValue: vi.fn().mockImplementation((v: string) => {
      calls.push(`setValue:${id}`)
      field.value = v
      return Promise.resolve()
    }),
    addValue: vi.fn().mockImplementation((v: string) => {
      calls.push(`addValue:${id}`)
      field.value += v
      return Promise.resolve()
    }),
    clearValue: vi.fn().mockImplementation(() => {
      calls.push(`clearValue:${id}`)
      field.value = ''
      return Promise.resolve()
    }),
    getAttribute: vi.fn().mockImplementation((name: string) => {
      calls.push(`getAttr:${id}:${name}`)
      if (name === 'value') return Promise.resolve(field.value === '' ? field.placeholder : field.value)
      if (name === 'placeholderValue') return Promise.resolve(field.placeholder)
      return Promise.resolve(null)
    }),
  }
  return field
}

let fields: Record<string, MockField>
let rects: Record<string, Rect>
let selectorResults: Record<string, MockField[]>
let activeElement: () => Promise<Record<string, string>>

function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

function activeByLastTap(): Promise<Record<string, string>> {
  const hit = Object.values(fields).find(f => lastTap && contains(rects[f.elementId], lastTap))
  if (!hit) return Promise.reject(new Error('no such element: no element has keyboard focus'))
  return Promise.resolve({ [W3C_ELEMENT_KEY]: hit.elementId })
}

function createMockDriver(xml: string) {
  const chain: Record<string, any> = {}
  chain.move = vi.fn().mockImplementation((p: { x: number; y: number }) => {
    calls.push(`tap:${p.x},${p.y}`)
    lastTap = p
    return chain
  })
  chain.down = vi.fn().mockReturnValue(chain)
  chain.up = vi.fn().mockReturnValue(chain)
  chain.pause = vi.fn().mockReturnValue(chain)
  chain.perform = vi.fn().mockResolvedValue(undefined)
  return {
    getPageSource: vi.fn().mockResolvedValue(xml),
    getWindowSize: vi.fn().mockResolvedValue({ width: 390, height: 844 }),
    takeScreenshot: vi.fn().mockResolvedValue(SCREENSHOT_BASE64),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(chain),
    keys: vi.fn().mockImplementation((k: unknown) => {
      calls.push(`keys:${JSON.stringify(k)}`)
      return Promise.resolve()
    }),
    pause: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn().mockResolvedValue(undefined),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP']),
    getContext: vi.fn().mockResolvedValue('NATIVE_APP'),
    switchContext: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue({ isExisting: vi.fn().mockResolvedValue(false) }),
    $$: vi.fn().mockImplementation((selector: string) => {
      calls.push(`$$:${selector}`)
      return Promise.resolve(selectorResults[selector] ?? [])
    }),
    getElementRect: vi.fn().mockImplementation((id: string) => Promise.resolve(rects[id])),
    getActiveElement: vi.fn().mockImplementation(() => activeElement()),
    _pointerAction: chain,
  }
}

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

import { IOSPlatformAdapter } from '../adapter.js'

type ExecAction = Parameters<IOSPlatformAdapter['execute']>[0]

const TEXT_VIEW = '-ios class chain:**/XCUIElementTypeTextView'
const TEXT_FIELD = '-ios class chain:**/XCUIElementTypeTextField'

describe('IOSPlatformAdapter text input (AUTO-18)', () => {
  let adapter: IOSPlatformAdapter
  let mockDriver: ReturnType<typeof createMockDriver>

  async function start(xml = FORM_XML): Promise<void> {
    mockDriver = createMockDriver(xml)
    const { remote } = await import('webdriverio')
    vi.mocked(remote).mockResolvedValue(mockDriver as any)
    adapter = new IOSPlatformAdapter()
    await adapter.setup({ platform: 'ios' })
  }

  async function refFor(name: string): Promise<string> {
    const state = await adapter.observe()
    const el = state.elements.find(e => e.name === name)
    if (!el) throw new Error(`test fixture: element "${name}" not observed`)
    calls.length = 0
    return el.ref
  }

  function fill(ref: string, text: string, opts: { clearMode?: 'replace' | 'append'; submit?: boolean } = {}) {
    return adapter.execute({
      type: 'fill',
      ref,
      text,
      clearMode: opts.clearMode ?? 'replace',
      submit: opts.submit ?? false,
    } as unknown as ExecAction)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    calls = []
    lastTap = undefined
    rects = { ...RECTS }
    fields = {
      title: createField('title', '', 'Title'),
      body: createField('body'),
      terms: createField('terms', 'Static terms text'),
    }
    selectorResults = {
      [TEXT_FIELD]: [fields.title],
      [TEXT_VIEW]: [fields.body, fields.terms],
    }
    activeElement = activeByLastTap
  })

  afterEach(() => { vi.restoreAllMocks() })

  describe('fill into an editable text view', () => {
    it('fills a multi-line Unicode value into Body through its own handle after a focus check', async () => {
      await start()
      const ref = await refFor('Body')
      const text = 'Line one ✓\nLine two é'

      const result = await fill(ref, text)

      expect(result.success).toBe(true)
      expect(calls.filter(c => c.startsWith('tap:'))).toEqual(['tap:195,220'])
      expect(mockDriver.getActiveElement).toHaveBeenCalled()
      expect(fields.body.setValue).toHaveBeenCalledTimes(1)
      expect(fields.body.setValue).toHaveBeenCalledWith(text)
      expect(fields.title.setValue).not.toHaveBeenCalled()
      expect(fields.title.addValue).not.toHaveBeenCalled()
      expect(fields.title.clearValue).not.toHaveBeenCalled()
      expect(fields.terms.setValue).not.toHaveBeenCalled()
      const typeIdx = calls.indexOf('setValue:body')
      const readIdx = calls.lastIndexOf('getAttr:body:value')
      expect(readIdx).toBeGreaterThan(typeIdx)
      expect(result.metadata?.fillReread).toEqual({ expected: text, actual: text })
      expect(mockDriver.keys).not.toHaveBeenCalled()
    })

    it('identifies the target by observed bounds, not by the first element of its type', async () => {
      fields = { body: createField('body'), notes: createField('notes') }
      selectorResults = { [TEXT_VIEW]: [fields.notes, fields.body] }
      await start(TWO_VIEWS_XML)
      const ref = await refFor('Notes')

      const result = await fill(ref, 'note text')

      expect(result.success).toBe(true)
      expect(fields.notes.setValue).toHaveBeenCalledWith('note text')
      expect(fields.body.setValue).not.toHaveBeenCalled()
      expect(fields.body.value).toBe('')
    })

    it('appends to Body with the prior value read first', async () => {
      fields.body.value = 'first'
      await start()
      const ref = await refFor('Body')

      const result = await fill(ref, '\nsecond', { clearMode: 'append' })

      expect(result.success).toBe(true)
      expect(fields.body.addValue).toHaveBeenCalledWith('\nsecond')
      expect(result.metadata?.fillReread).toEqual({ expected: 'first\nsecond', actual: 'first\nsecond' })
    })
  })
})
