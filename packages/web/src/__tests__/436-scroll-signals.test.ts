// C436-SCROLL-VISIBILITY (436-17 · D-24/D-25, review CR-04 and WR-06): on the web lane untilVisible
// decides target visibility by what is on screen. C436-SCROLL-REF (436-17 · D-25, review CR-03): a
// container ref scrolls and measures only the container it names. Real headless Chromium through
// WebPlatformAdapter, fixtures served from a loopback node:http server.

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
const SHORT = page('short', '<h1>Short page</h1><p>Nothing to scroll here.</p>')

const PAGES: Record<string, string> = {
  '/paragraphs': PARAGRAPHS,
  '/buttons': BUTTONS,
  '/nested': NESTED,
  '/labelled': LABELLED,
  '/short': SHORT,
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
