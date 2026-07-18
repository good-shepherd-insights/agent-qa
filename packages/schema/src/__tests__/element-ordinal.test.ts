import { describe, expect, it } from 'vitest'

import { asRef } from '../primitives/ref'
import { elementOrdinal } from '../screen/element-ordinal'
import type { ElementInfo } from '../screen/element-info'

function element(ref: string, role: string, nameNormalized: string): ElementInfo {
  return {
    ref: asRef(ref),
    role,
    name: nameNormalized,
    nameNormalized,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

describe('elementOrdinal', () => {
  it('counts only earlier elements with the same role and normalized name', () => {
    const first = element('e1', 'button', 'retry')
    const otherRole = element('e2', 'link', 'retry')
    const otherName = element('e3', 'button', 'cancel')
    const second = element('e4', 'button', 'retry')
    const elements = [first, otherRole, otherName, second]

    expect(elementOrdinal(first, elements)).toBe(0)
    expect(elementOrdinal(second, elements)).toBe(1)
  })
})
