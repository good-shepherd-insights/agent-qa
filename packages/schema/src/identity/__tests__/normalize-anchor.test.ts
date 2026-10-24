import { describe, expect, it } from 'vitest'
import type { Anchor } from '../anchor'
import { normalizeAnchor } from '../normalize-anchor'

describe('normalizeAnchor', () => {
  it('normalizes element names and roles while retaining ordinals', () => {
    const first: Anchor = { t: 'el', role: '  BUTTON ', name: ' Cart (3) ', ordinal: 2 }
    const second: Anchor = { t: 'el', role: 'button', name: 'Cart (7)', ordinal: 2 }

    expect(normalizeAnchor(first)).toEqual({
      t: 'el',
      role: 'button',
      name: 'cart',
      ordinal: 2,
    })
    expect(normalizeAnchor(first)).toEqual(normalizeAnchor(second))
  })

  it('normalizes page routes while retaining query strings', () => {
    expect(normalizeAnchor({ t: 'page', route: '  /Checkout/?Mode=FAST#receipt  ' })).toEqual({
      t: 'page',
      route: '/checkout?mode=fast',
    })
    expect(normalizeAnchor({ t: 'page', route: ' /Account   Settings/#summary ' })).toEqual({
      t: 'page',
      route: '/account settings',
    })
  })

  it('normalizes flow names through the shared accessible-name normalizer', () => {
    expect(normalizeAnchor({ t: 'flow', name: '  Add   item (42) ' })).toEqual({
      t: 'flow',
      name: 'add item',
    })
  })

  it('collapses dynamic error digit runs to one placeholder', () => {
    const first: Anchor = { t: 'error', message: ' Timeout  after 5000ms ' }
    const second: Anchor = { t: 'error', message: 'timeout after 3000ms' }

    expect(normalizeAnchor(first)).toEqual({ t: 'error', message: 'timeout after #ms' })
    expect(normalizeAnchor(first)).toEqual(normalizeAnchor(second))
  })

  it('only trims selector literals', () => {
    expect(normalizeAnchor({ t: 'selector', literal: '  [data-ID="Cart  7"]  ' })).toEqual({
      t: 'selector',
      literal: '[data-ID="Cart  7"]',
    })
  })

  it('returns platform anchors unchanged', () => {
    const anchor: Anchor = { t: 'platform', platform: 'ios' }

    expect(normalizeAnchor(anchor)).toBe(anchor)
  })

  it('is pure and idempotent for all six variants', () => {
    const anchors: Anchor[] = [
      { t: 'page', route: ' /Cart/#items ' },
      { t: 'flow', name: ' Checkout (3) ' },
      { t: 'el', role: ' BUTTON ', name: ' Cart (7) ', ordinal: 1 },
      { t: 'platform', platform: 'android' },
      { t: 'selector', literal: '  #Cart > .Item  ' },
      { t: 'error', message: ' Timed out after 3000 ms ' },
    ]
    const originals = anchors.map((anchor) => ({ ...anchor }))

    for (const anchor of anchors) {
      const once = normalizeAnchor(anchor)
      expect(normalizeAnchor(once)).toEqual(once)
    }
    expect(anchors).toEqual(originals)
  })
})
