import { describe, expect, it } from 'vitest'
import type { Anchor } from '../anchor'
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

  it('normalizes element, page, flow, and error anchors before keying them', () => {
    const anchors: Anchor[] = [
      { t: 'el', role: 'Button', name: '  Sign In ' },
      { t: 'page', route: ' /Checkout/?Mode=FAST#receipt ' },
      { t: 'flow', name: ' Checkout (42) ' },
      { t: 'error', message: ' Timeout after 5000ms ' },
    ]

    for (const anchor of anchors) {
      expect(anchorGraphNode(anchor, 'web')?.nodeId).toBe(
        anchorGraphNode(normalizeAnchor(anchor), 'web')?.nodeId,
      )
    }
  })

  it('uses normalized element identity fields and retains an explicit ordinal', () => {
    expect(
      anchorGraphNode({ t: 'el', role: ' Button ', name: ' Sign In ' }, 'web')?.naturalKey,
    ).toEqual({ role: 'button', name: 'sign in' })
    expect(
      anchorGraphNode(
        { t: 'el', role: ' Button ', name: ' Sign In ', ordinal: 2 },
        'web',
      )?.naturalKey,
    ).toEqual({ role: 'button', name: 'sign in', ordinal: 2 })
  })

  it('discriminates element nodes across web, mobile, and unresolved platforms', () => {
    const element = { t: 'el', role: 'button', name: 'sign in' } as const

    expect([
      anchorGraphNode(element, 'web')?.type,
      anchorGraphNode(element, 'android')?.type,
      anchorGraphNode(element, 'ios')?.type,
      anchorGraphNode(element)?.type,
    ]).toEqual(['web-element', 'mobile-element', 'mobile-element', 'element'])
  })

  it('discriminates page nodes across web, mobile, and unresolved platforms', () => {
    const page = { t: 'page', route: '/login' } as const

    expect([
      anchorGraphNode(page, 'web')?.type,
      anchorGraphNode(page, 'android')?.type,
      anchorGraphNode(page, 'ios')?.type,
      anchorGraphNode(page)?.type,
    ]).toEqual(['web-page', 'mobile-screen', 'mobile-screen', 'page'])
  })

  it('maps selectors only when their platform is resolved', () => {
    const selector = { t: 'selector', literal: '#sign-in' } as const

    expect([
      anchorGraphNode(selector, 'web')?.type,
      anchorGraphNode(selector, 'android')?.type,
      anchorGraphNode(selector, 'ios')?.type,
      anchorGraphNode(selector),
    ]).toEqual(['web-locator', 'android-locator', 'ios-locator', null])
  })

  it('does not project platform anchors into graph nodes', () => {
    expect(anchorGraphNode({ t: 'platform', platform: 'web' })).toBeNull()
    expect(anchorGraphNode({ t: 'platform', platform: 'android' }, 'android')).toBeNull()
  })

  it('maps every bundle kind directly to a record node type', () => {
    const kinds = ['fact', 'procedure', 'caution', 'unknown', 'policy'] as const

    for (const kind of kinds) {
      expect(recordGraphNode(kind, 'r_abc')).toEqual({
        type: kind,
        naturalKey: 'r_abc',
        nodeId: graphNodeId(kind, 'r_abc'),
      })
    }
  })

  it('includes the node type in identity when natural keys are equal', () => {
    expect(graphNodeId('flow', 'checkout')).not.toBe(graphNodeId('test', 'checkout'))
  })
})
