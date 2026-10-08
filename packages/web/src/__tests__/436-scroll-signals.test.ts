// C436-SCROLL-VISIBILITY (436-17 · D-24/D-25, review CR-04 and WR-06): on the web lane untilVisible
// decides target visibility by what is on screen. C436-SCROLL-REF (436-17 · D-25, review CR-03): a
// container ref scrolls and measures only the container it names. C436-SCROLL-POINTER (436-18 ·
// D-24/D-25, review CR-02): a no-ref wheel is judged by the scrollers under the pointer. Real
// headless Chromium through WebPlatformAdapter, fixtures served from a loopback node:http server.

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import type { Ref } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import { buildScrollPrimitives } from '../compound-web.js'

const page = (title: string, body: string): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`

const PARAGRAPHS = page('paragraphs', Array.from({ length: 200 }, (_, i) => `<p>Paragraph ${String(i)}</p>`).join(''))
const BUTTONS = page('buttons', Array.from({ length: 200 }, (_, i) => `<p><button>Buy ${String(i)}</button></p>`).join(''))
const NESTED = page('nested', `
  <div id="list" style="height: 200px; overflow: auto; border: 1px solid #888">
    ${Array.from({ length: 30 }, (_, i) => `<div style="height: 40px">Entry ${String(i)}</div>`).join('')}
  </div>
  <p>Below the list</p>`)
const LABELLED = page('labelled', '<h1>Dialog</h1><button aria-label="Close dialog">×</button>')
const SHORT = page('short', '<h1>Short page</h1><p>Nothing to scroll here.</p><button>Do nothing</button>')
// The listbox scrolls, and so does the page around it, so a swipe on the wrong scroller shows.
const LISTBOX = page('listbox', `
  <select id="rows" multiple aria-label="Rows" style="height: 300px">
    ${Array.from({ length: 100 }, (_, i) => `<option>Row ${String(i)}</option>`).join('')}
  </select>
  <div style="height: 3000px">Page tail</div>`)
const STALE = page('stale', `
  <div id="feed" role="region" aria-label="Feed" style="height: 200px; overflow: auto">
    ${Array.from({ length: 30 }, (_, i) => `<div style="height: 40px">Post ${String(i)}</div>`).join('')}
  </div>
  <div style="height: 3000px">Page tail</div>`)

// proof-wheel.mjs: a 700 px list above a footer, so the document can scroll only 120 px.
const POINTER = page('pointer', `
  <style>body{margin:0} #list{height:700px;overflow:auto;margin:0} footer{height:120px}</style>
  <ul id="list">${Array.from({ length: 200 }, (_, i) => `<li><button>Item ${String(i)}</button></li>`).join('')}</ul>
  <footer>Footer</footer>`)

const PAGES: Record<string, string> = {
  '/pointer': POINTER,
  '/paragraphs': PARAGRAPHS,
  '/buttons': BUTTONS,
  '/nested': NESTED,
  '/labelled': LABELLED,
  '/short': SHORT,
  '/listbox': LISTBOX,
  '/stale': STALE,
}

// The web native search waits the page's default action timeout for a target that is not in the
// DOM; a short default keeps the absent-target cells quick and changes no result.
const NATIVE_SEARCH_TIMEOUT_MS = 2_000

let server: Server
let baseUrl = ''
let adapter: WebPlatformAdapter | undefined

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = PAGES[(req.url ?? '/').split('?')[0]]
    res.writeHead(html === undefined ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html ?? 'not found')
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://localhost:${String((server.address() as AddressInfo).port)}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

afterEach(async () => {
  await adapter?.cleanup()
  adapter = undefined
}, 60_000)

async function open(path: string): Promise<{ web: WebPlatformAdapter; tab: Page }> {
  const created = new WebPlatformAdapter()
  try {
    await created.setup({ platform: 'web', browser: { name: 'chromium', headless: true } })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', { cause: error })
  }
  adapter = created
  const tab = created.getPage()!
  tab.setDefaultTimeout(NATIVE_SEARCH_TIMEOUT_MS)
  await tab.goto(baseUrl + path)
  await created.observe()
  return { web: created, tab }
}

type Rect = { top: number; bottom: number; innerHeight: number }

async function rectOf(tab: Page, selector: string, index: number): Promise<Rect> {
  return tab.evaluate(([sel, i]) => {
    const g = globalThis as unknown as {
      innerHeight: number
      document: { querySelectorAll(s: string): ArrayLike<{ getBoundingClientRect(): { top: number; bottom: number } }> }
    }
    const r = g.document.querySelectorAll(sel)[i].getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, innerHeight: g.innerHeight }
  }, [selector, index] as const)
}

async function scrollY(tab: Page): Promise<number> {
  return tab.evaluate(() => (globalThis as unknown as { scrollY: number }).scrollY)
}

async function refFor(web: WebPlatformAdapter, role: string, name: string): Promise<Ref> {
  const element = (await web.observe()).elements.find((e) => e.role === role && e.name === name)
  expect(element, `${role} "${name}" is observed`).toBeDefined()
  return element!.ref
}

function untilVisible(text: string, maxSwipes: number, ref?: Ref) {
  return {
    type: 'scroll' as const,
    mode: 'untilVisible' as const,
    text,
    direction: 'down' as const,
    maxSwipes,
    retryOpposite: false,
    ...(ref ? { ref } : {}),
  }
}

describe('C436-SCROLL-VISIBILITY', () => {
  it('on-screen plain text ends found', async () => {
    const { web, tab } = await open('/paragraphs')
    const result = await web.execute(untilVisible('Paragraph 190', 3))
    expect(result.metadata?.scrollUntilVisible).toMatchObject({ outcome: 'found', endedBy: 'target-visible' })
    const rect = await rectOf(tab, 'p', 190)
    expect(rect.innerHeight).toBe(720)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(rect.innerHeight)
  }, 60_000)

  it('a named button below the fold is not found until it is on screen', async () => {
    const { web, tab } = await open('/buttons')
    const probe = buildScrollPrimitives(tab, {}, 720)
    expect(await probe.probeTargetVisible!('Buy 190')).toBe(false)
    expect(await probe.probeTargetVisible!('Buy 1')).toBe(true)
    expect(await scrollY(tab)).toBe(0)

    const result = await web.execute(untilVisible('Buy 190', 3))
    expect(result.metadata?.scrollUntilVisible).toMatchObject({ outcome: 'found', endedBy: 'target-visible' })
    expect(await scrollY(tab), 'the page actually moved').toBeGreaterThan(0)
    const rect = await rectOf(tab, 'button', 190)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(rect.innerHeight)
    expect(await probe.probeTargetVisible!('Buy 190')).toBe(true)
  }, 60_000)

  it('an element clipped by a nested scroller is not visible', async () => {
    const { tab } = await open('/nested')
    const probe = buildScrollPrimitives(tab, {}, 720)
    // Entry 10 sits 400 px down the 200 px list: inside the viewport's rectangle, outside the list's box.
    const clipped = await rectOf(tab, '#list > div', 10)
    expect(clipped.top).toBeGreaterThan(0)
    expect(clipped.bottom).toBeLessThan(clipped.innerHeight)
    expect(await probe.probeTargetVisible!('Entry 10')).toBe(false)
    expect(await probe.probeTargetVisible!('Entry 0')).toBe(true)
  }, 60_000)

  it('an aria-label-only target counts when on screen', async () => {
    const { tab } = await open('/labelled')
    const probe = buildScrollPrimitives(tab, {}, 720)
    expect(await probe.probeTargetVisible!('close dialog')).toBe(true)
  }, 60_000)

  it('a target absent from the page never ends found', async () => {
    const { web } = await open('/short')
    const result = await web.execute(untilVisible('No such text', 2))
    const meta = result.metadata?.scrollUntilVisible as { outcome: string } | undefined
    expect(meta).toBeDefined()
    expect(meta!.outcome).not.toBe('found')
  }, 60_000)
})

describe('C436-SCROLL-REF', () => {
  it('a listbox ref scrolls the listbox itself', async () => {
    const { web, tab } = await open('/listbox')
    const ref = await refFor(web, 'listbox', 'Rows')
    const result = await web.execute({
      type: 'scroll', mode: 'direction', direction: 'down', amount: 'toEnd', retryOpposite: false, ref,
    })
    expect(result.metadata?.scrollUntilVisible).toMatchObject({ outcome: 'found', endedBy: 'boundary' })
    const list = await tab.evaluate(() => {
      const el = (globalThis as unknown as {
        document: { getElementById(id: string): { scrollTop: number; scrollHeight: number; clientHeight: number } }
      }).document.getElementById('rows')
      return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
    })
    expect(list.max).toBeGreaterThan(0)
    expect(Math.abs(list.top - list.max)).toBeLessThanOrEqual(1)
    expect(await scrollY(tab), 'the window did not move').toBe(0)
  }, 60_000)

  it('a ref that no longer resolves reports unknown and moves nothing', async () => {
    const { web, tab } = await open('/stale')
    const ref = await refFor(web, 'region', 'Feed')
    await tab.evaluate(() => {
      (globalThis as unknown as { document: { getElementById(id: string): { remove(): void } } })
        .document.getElementById('feed').remove()
    })
    const result = await web.execute(untilVisible('No such post', 2, ref))
    expect(result.metadata?.scrollUntilVisible).toEqual({
      swipes: 2, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes',
    })
    expect(await scrollY(tab), 'the window did not move').toBe(0)
  }, 60_000)

  it('a resolved element with no scrollable ancestor on a page that cannot scroll is unknown, never a boundary', async () => {
    const { web, tab } = await open('/short')
    const ref = await refFor(web, 'button', 'Do nothing')
    const result = await web.execute({
      type: 'scroll', mode: 'direction', direction: 'down', amount: 'toEnd', retryOpposite: false, ref,
    })
    expect(result.metadata?.scrollUntilVisible).toEqual({
      swipes: 20, reversedOnce: false, outcome: 'unresolved', endedBy: 'max-swipes',
    })
    expect(await scrollY(tab)).toBe(0)
  }, 60_000)
})

type Extent = { top: number; max: number }

async function listExtent(tab: Page): Promise<Extent> {
  return tab.evaluate(() => {
    const el = (globalThis as unknown as {
      document: { getElementById(id: string): { scrollTop: number; scrollHeight: number; clientHeight: number } }
    }).document.getElementById('list')
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
  })
}

async function documentExtent(tab: Page): Promise<Extent> {
  return tab.evaluate(() => {
    const el = (globalThis as unknown as {
      document: { scrollingElement: { scrollTop: number; scrollHeight: number; clientHeight: number } }
    }).document.scrollingElement
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
  })
}

// The proof-wheel.mjs setup: the document already at its bottom, the pointer inside the list.
async function openPointerList(): Promise<{ web: WebPlatformAdapter; tab: Page }> {
  const opened = await open('/pointer')
  await opened.tab.evaluate(() => {
    const g = globalThis as unknown as {
      scrollTo(x: number, y: number): void
      document: { scrollingElement: { scrollHeight: number } }
    }
    g.scrollTo(0, g.document.scrollingElement.scrollHeight)
  })
  await opened.tab.mouse.click(200, 200)
  const doc = await documentExtent(opened.tab)
  expect(doc.max).toBeGreaterThan(0)
  expect(Math.abs(doc.top - doc.max), 'the document starts at its bottom').toBeLessThanOrEqual(1)
  expect((await listExtent(opened.tab)).top).toBe(0)
  return opened
}

describe('C436-SCROLL-POINTER', () => {
  it('toEnd with the pointer in a nested list follows the list to its end', async () => {
    const { web, tab } = await openPointerList()
    const result = await web.execute({
      type: 'scroll', mode: 'direction', direction: 'down', amount: 'toEnd', retryOpposite: false,
    })
    const meta = result.metadata?.scrollUntilVisible as { swipes: number } | undefined
    expect(meta).toMatchObject({ outcome: 'found', endedBy: 'boundary' })
    expect(meta!.swipes).toBeGreaterThan(1)
    const list = await listExtent(tab)
    expect(list.max).toBeGreaterThan(0)
    expect(Math.abs(list.top - list.max), 'the list reached its end').toBeLessThanOrEqual(1)
  }, 60_000)

  it('untilVisible in the nested list never ends not-found on the document boundary', async () => {
    const { web, tab } = await openPointerList()
    // The wheel under the pointer moves the list while the document sits at its bottom.
    expect(await buildScrollPrimitives(tab, {}, 720).swipeOnce('down')).toBe('moved')
    const result = await web.execute({
      type: 'scroll', mode: 'untilVisible', text: 'Item 150', direction: 'down', maxSwipes: 3, retryOpposite: false,
    })
    const meta = result.metadata?.scrollUntilVisible as { outcome: string } | undefined
    expect(meta).toBeDefined()
    expect(['found', 'unresolved']).toContain(meta!.outcome)
  }, 60_000)

  it('a wheel over the document alone keeps the document rule', async () => {
    const { web, tab } = await open('/paragraphs')
    await tab.mouse.click(200, 200)
    const result = await web.execute({
      type: 'scroll', mode: 'direction', direction: 'down', amount: 'toEnd', retryOpposite: false,
    })
    expect(result.metadata?.scrollUntilVisible).toMatchObject({ outcome: 'found', endedBy: 'boundary' })
    const doc = await documentExtent(tab)
    expect(doc.max).toBeGreaterThan(0)
    expect(Math.abs(doc.top - doc.max)).toBeLessThanOrEqual(1)
  }, 60_000)

  it('the probe leaves nothing on the page', async () => {
    const { tab } = await openPointerList()
    const fingerprint = () => tab.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelectorAll(s: string): ArrayLike<{ tagName: string; getAttributeNames(): string[]; getAttribute(n: string): string | null }> }
      }
      const attributes = Array.from(g.document.querySelectorAll('*'), (el) =>
        `${el.tagName}[${el.getAttributeNames().map((n) => `${n}=${String(el.getAttribute(n))}`).join(',')}]`)
      return { keys: Object.keys(globalThis).sort(), attributes }
    })
    const before = await fingerprint()
    expect(await buildScrollPrimitives(tab, {}, 720).swipeOnce('down')).toBe('moved')
    const after = await fingerprint()
    expect(after.keys).toEqual(before.keys)
    expect(after.attributes).toEqual(before.attributes)
  }, 60_000)
})
