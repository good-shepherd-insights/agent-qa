// C438-ROW-PARSE (438 D-02, Pitfall 1): a real Chromium ai-mode snapshot parsed by
// parseAriaSnapshot and built by buildScreenState carries each row's static text. The fold adds no
// element: only `row` lines become new elements. Pages are inline snippets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildScreenState, rowTextOf } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import { parseAriaSnapshot } from '../observer.js'

const ADDRESSES_PAGE = `<!doctype html><html><body>
  <ul>
    <li>
      <p><strong>Work</strong></p>
      <p>7 Elm Street, Springfield</p>
      <button type="button">Edit label</button>
    </li>
    <li>
      <p><strong>Home</strong></p>
      <p>1 Home Street, Springfield</p>
      <button type="button">Edit label</button>
    </li>
    <li>
      <p><strong>Old</strong></p>
      <p>9 Oak Road, Springfield</p>
      <button type="button">Edit label</button>
    </li>
  </ul>
</body></html>`

const CART_PAGE = `<!doctype html><html><body>
  <table>
    <tr><th>Item</th><th>Price</th><th>Action</th></tr>
    <tr><td>Green mug</td><td>$9.00</td><td><button type="button">Remove</button></td></tr>
    <tr><td>Blue mug</td><td>$8.00</td><td><button type="button">Remove</button></td></tr>
  </table>
</body></html>`

const DROPPED_ROLES = ['paragraph', 'strong', 'text', 'generic', 'emphasis']

let adapter: WebPlatformAdapter | undefined

beforeAll(async () => {
  const created = new WebPlatformAdapter()
  try {
    await created.setup({ platform: 'web', browser: { name: 'chromium', headless: true } })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', {
      cause: error,
    })
  }
  adapter = created
}, 60_000)

afterAll(async () => {
  await adapter?.cleanup()
  adapter = undefined
}, 60_000)

async function snapshotOf(html: string): Promise<string> {
  const page = adapter!.getPage()!
  await page.setContent(html)
  return page.locator(':root').ariaSnapshot({ mode: 'ai' })
}

function build(snapshot: string): ScreenState {
  return buildScreenState({
    platform: 'web',
    nodes: parseAriaSnapshot(snapshot).nodes,
    viewport: { width: 1280, height: 720 },
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
    coordSpace: 'viewport',
    timestamp: 1700000000000,
  }).state
}

function rowLineCount(snapshot: string): number {
  return snapshot.split('\n').filter((line) => /^\s*-\s*row\b/.test(line)).length
}

function withoutRowLines(snapshot: string): string {
  return snapshot.replace(/^(\s*-\s*)row\b/gm, '$1rowgroup')
}

describe('C438-ROW-PARSE', () => {
  it('the address list yields three listitems carrying their row text', async () => {
    const state = build(await snapshotOf(ADDRESSES_PAGE))
    const items = state.elements.filter((element) => element.role === 'listitem')

    expect(items).toHaveLength(3)
    expect(items[0].text).toContain('Work')
    expect(items[0].text).toContain('7 Elm Street, Springfield')
    expect(items[1].text).toContain('Home')
    expect(items[1].text).toContain('1 Home Street, Springfield')
    expect(items[2].text).toContain('Old')
    expect(items[2].text).toContain('9 Oak Road, Springfield')
    expect(state.tree).toContain('text: "Work 7 Elm Street, Springfield"')
  }, 60_000)

  it("each Edit label's row text names its own address", async () => {
    const state = build(await snapshotOf(ADDRESSES_PAGE))
    const buttons = state.elements.filter((element) => element.name === 'Edit label')

    expect(buttons).toHaveLength(3)
    expect(rowTextOf(buttons[0], state.elements)).toContain('7 Elm Street')
    expect(rowTextOf(buttons[1], state.elements)).toContain('1 Home Street')
    expect(rowTextOf(buttons[2], state.elements)).toContain('9 Oak Road')
  }, 60_000)

  it("the cart table yields row elements and each Remove button's row names its mug", async () => {
    const state = build(await snapshotOf(CART_PAGE))
    const rows = state.elements.filter((element) => element.role === 'row')
    const removes = state.elements.filter(
      (element) => element.role === 'button' && element.name === 'Remove',
    )

    expect(rows).toHaveLength(3)
    expect(removes).toHaveLength(2)
    expect(rowTextOf(removes[0], state.elements)).toContain('Green mug')
    expect(rowTextOf(removes[0], state.elements)).not.toContain('Blue mug')
    expect(rowTextOf(removes[1], state.elements)).toContain('Blue mug')
    expect(rowTextOf(removes[1], state.elements)).not.toContain('Green mug')
  }, 60_000)

  it('no dropped line becomes an element', async () => {
    for (const html of [ADDRESSES_PAGE, CART_PAGE]) {
      const state = build(await snapshotOf(html))
      const roles = state.elements.map((element) => element.role)
      for (const dropped of DROPPED_ROLES) expect(roles).not.toContain(dropped)
    }
  }, 60_000)

  it('the element count is the count without the fold plus the row lines', async () => {
    for (const html of [ADDRESSES_PAGE, CART_PAGE]) {
      const snapshot = await snapshotOf(html)
      const withFold = parseAriaSnapshot(snapshot).nodes.length
      const withoutRows = parseAriaSnapshot(withoutRowLines(snapshot)).nodes.length
      expect(withFold).toBe(withoutRows + rowLineCount(snapshot))
    }
    expect(build(await snapshotOf(ADDRESSES_PAGE)).elements.map((element) => element.role)).toEqual(
      ['listitem', 'button', 'listitem', 'button', 'listitem', 'button'],
    )
    const cart = build(await snapshotOf(CART_PAGE)).elements.map((element) => element.role)
    expect(cart).toEqual([
      'row',
      'row', 'cell', 'cell', 'cell', 'button',
      'row', 'cell', 'cell', 'cell', 'button',
    ])
  }, 60_000)
})
