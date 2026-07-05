// RED scaffold (Wave 0, CACHE-03 / D-12). The cached value is descriptor-only:
// role + nameNormalized (+ ordinal), never a ref/selector/coordinates and never the
// step `data` value. Fails until Plan 03 creates ../value.ts. The overfit guard is a
// deep scan of the serialized value for a sentinel ref and a sentinel data value.
import { describe, expect, it } from 'vitest'

import { asRef } from '@vostride/agent-qa-schema'
import type { ElementInfo } from '@vostride/agent-qa-schema'
import type { Action } from '../../platform.js'

import { buildCachedPlanValue, toGroundedLocator } from '../value.js'

const SENTINEL_REF = 'ref-DO-NOT-STORE-9f9f'
const SENTINEL_DATA = 'order-id-should-never-persist-4242'

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    ref: asRef(overrides.ref ?? 'e1'),
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Checkout',
    nameNormalized: overrides.nameNormalized ?? 'checkout',
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
    ...overrides,
  }
}

describe('toGroundedLocator — descriptor-only projection (CACHE-03, D-12)', () => {
  it('projects an action + elements to a role+nameNormalized descriptor with no ref', () => {
    const elements = [element({ ref: SENTINEL_REF, role: 'button', name: 'Checkout', nameNormalized: 'checkout' })]
    const action = { type: 'click', ref: SENTINEL_REF } as unknown as Action

    const locator = toGroundedLocator(action, elements)

    expect(locator).toMatchObject({ role: 'button', nameNormalized: 'checkout' })
    expect(Object.hasOwn(locator, 'ref')).toBe(false)
    expect(JSON.stringify(locator)).not.toContain(SENTINEL_REF)
  })
})

describe('buildCachedPlanValue — no ref/selector/coordinates/data in the value (D-12 overfit guard)', () => {
  it('assembles a descriptor-only CachedPlanValue that omits the raw ref and step data', () => {
    const elements = [element({ ref: SENTINEL_REF, role: 'button', name: 'Checkout', nameNormalized: 'checkout' })]
    const action = { type: 'click', ref: SENTINEL_REF, data: SENTINEL_DATA } as unknown as Action

    const value = buildCachedPlanValue({
      plannedActions: [action],
      elements,
      verificationOutcome: 'passed',
    })

    expect(value.verificationOutcome).toBe('passed')
    expect(value.groundedLocator).toHaveLength(1)
    expect(value.groundedLocator[0]).toMatchObject({ role: 'button', nameNormalized: 'checkout' })

    // Deep scan: neither the sentinel ref nor the sentinel step data may survive.
    const serialized = JSON.stringify(value)
    expect(serialized).not.toContain(SENTINEL_REF)
    expect(serialized).not.toContain(SENTINEL_DATA)
  })
})
