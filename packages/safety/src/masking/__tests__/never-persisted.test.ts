import { describe, expect, it } from 'vitest'

import { createMaskingContext } from '../context'

const SECRET = 'AKIAIOSFODNN7EXAMPLE'
const EMAIL = 'a@b.com'

describe('MaskingContext serialization safety', () => {
  it('exposes no registered secret or detected email through serialized context forms', () => {
    const ctx = createMaskingContext()

    ctx.register(SECRET)
    expect(ctx.mask(`token=${SECRET} mail=${EMAIL}`)).toBe('token=<SECRET_0> mail=<EMAIL_0>')

    const serializedForms = [
      JSON.stringify(ctx),
      JSON.stringify(Object.keys(ctx)),
      String(ctx),
      JSON.stringify(Object.getOwnPropertyNames(ctx)),
      JSON.stringify(Object.getOwnPropertyDescriptors(ctx)),
    ]

    expect(JSON.stringify(ctx)).toBe('{}')
    expect(() => structuredClone(ctx as object)).toThrow()
    expect(Object.prototype.hasOwnProperty.call(ctx, 'toJSON')).toBe(false)

    for (const serialized of serializedForms) {
      expect(serialized).not.toContain(SECRET)
      expect(serialized).not.toContain(EMAIL)
    }
  })
})
