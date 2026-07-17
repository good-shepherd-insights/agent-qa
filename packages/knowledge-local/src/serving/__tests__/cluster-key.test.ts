import { canonicalJson, normalizeAnchor, type Anchor } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { clusterKey } from '../cluster-key.js'

describe('Pin 2 serving cluster key', () => {
  it('collapses element ordinals while preserving role and name identity', () => {
    const first: Anchor = {
      t: 'el',
      role: ' Button ',
      name: 'Add item',
      ordinal: 1,
    }
    const third: Anchor = {
      t: 'el',
      role: 'button',
      name: 'Add item',
      ordinal: 3,
    }
    const remove: Anchor = {
      t: 'el',
      role: 'button',
      name: 'Remove item',
      ordinal: 1,
    }

    expect(clusterKey([first])).toBe(clusterKey([third]))
    expect(clusterKey([first])).not.toBe(clusterKey([remove]))
    expect(clusterKey([first])).toBe(
      canonicalJson({ t: 'el', role: 'button', name: 'add item' }),
    )
  })

  it('uses flow identity when no element exists and otherwise the normalized page route', () => {
    const flow: Anchor = { t: 'flow', name: ' Checkout ' }
    const page: Anchor = { t: 'page', route: '/Checkout/?step=1#payment' }

    expect(clusterKey([page, flow])).toBe(canonicalJson(normalizeAnchor(flow)))
    expect(clusterKey([page])).toBe('/checkout?step=1')
  })
})
