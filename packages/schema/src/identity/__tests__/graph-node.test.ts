import { describe, expect, it } from 'vitest'
import {
  anchorGraphNode,
  graphNodeId,
  recordGraphNode,
} from '../graph-node'
import { normalizeAnchor } from '../normalize-anchor'

describe('graph node identity', () => {
  it('pins the canonical type and natural-key hash', () => {
    const first = graphNodeId('flow', 'checkout')

    expect(first).toBe('2c5424ba567b3e61562c90618e05c9606b590519fb12bb2d5028efb075b3ad0d')
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(graphNodeId('flow', 'checkout')).toBe(first)
  })

  it('normalizes element anchors before keying them', () => {
    const raw = { t: 'el', role: 'Button', name: '  Sign In ' } as const

    expect(anchorGraphNode(raw, 'web')?.nodeId).toBe(
      anchorGraphNode(normalizeAnchor(raw), 'web')?.nodeId,
    )
  })

  it('discriminates element and page nodes by platform', () => {
    const element = { t: 'el', role: 'button', name: 'sign in' } as const
    const page = { t: 'page', route: '/login' } as const

    expect(anchorGraphNode(element, 'web')?.type).toBe('web-element')
    expect(anchorGraphNode(element, 'android')?.type).toBe('mobile-element')
    expect(anchorGraphNode(element)?.type).toBe('element')
    expect(anchorGraphNode(page, 'web')?.type).toBe('web-page')
    expect(anchorGraphNode(page, 'ios')?.type).toBe('mobile-screen')
    expect(anchorGraphNode(page)?.type).toBe('page')
  })

  it('keeps unresolved selectors lexical-only and ignores platform anchors', () => {
    const selector = { t: 'selector', literal: '#sign-in' } as const

    expect(anchorGraphNode(selector)).toBeNull()
    expect(anchorGraphNode(selector, 'web')?.type).toBe('web-locator')
    expect(anchorGraphNode(selector, 'android')?.type).toBe('android-locator')
    expect(anchorGraphNode(selector, 'ios')?.type).toBe('ios-locator')
    expect(anchorGraphNode({ t: 'platform', platform: 'web' })).toBeNull()
  })

  it('maps every bundle kind directly to a record node type', () => {
    const kinds = ['fact', 'procedure', 'caution', 'unknown', 'policy'] as const

    for (const kind of kinds) {
      expect(recordGraphNode(kind, 'r_abc')).toMatchObject({
        type: kind,
        naturalKey: 'r_abc',
      })
    }
  })
})
