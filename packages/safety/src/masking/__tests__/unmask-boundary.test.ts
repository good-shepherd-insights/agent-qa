import { describe, expect, it } from 'vitest'

import { createMaskingContext } from '../context'
import { unmaskForHumanOutput } from '../human-output'

describe('unmaskForHumanOutput', () => {
  it('restores originals only at the human-output boundary', () => {
    const secret = 'sk-live-abcdef0123456789'
    const ctx = createMaskingContext()
    ctx.register(secret)

    const masked = ctx.mask(`token ${secret}`)

    expect(masked).toContain('<SECRET_0>')
    expect(masked).not.toContain(secret)
    expect(unmaskForHumanOutput(ctx, masked)).toBe(`token ${secret}`)
    expect(masked).not.toContain(secret)
  })
})
