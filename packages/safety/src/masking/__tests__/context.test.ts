import { describe, expect, it } from 'vitest'

import { createMaskingContext } from '../context'

describe('MaskingContext', () => {
  it('mints stable placeholders and round-trips registered secrets plus detected emails', () => {
    const ctx = createMaskingContext()
    const input = 'use s3cr3t-value-123 and s3cr3t-value-123 for a@b.com'

    ctx.register('s3cr3t-value-123')

    const masked = ctx.mask(input)

    expect(masked).toBe('use <SECRET_0> and <SECRET_0> for <EMAIL_0>')
    expect(ctx.unmask(masked)).toBe(input)
  })

  it('is idempotent over already-minted placeholders', () => {
    const ctx = createMaskingContext()
    const input = 'send s3cr3t-value-123 to a@b.com'

    ctx.register('s3cr3t-value-123')

    const masked = ctx.mask(input)

    expect(ctx.mask(masked)).toBe(masked)
  })

  it('leaves app-authored placeholder-looking text untouched when it was never minted', () => {
    const ctx = createMaskingContext()

    expect(ctx.unmask('the app printed <SECRET_0> literally')).toBe(
      'the app printed <SECRET_0> literally',
    )
  })

  it('replaces registered values longest-first so overlapping secrets leave no plaintext fragment', () => {
    const ctx = createMaskingContext({ minRegisteredLength: 3 })

    ctx.register('abc')
    ctx.register('abcdef')

    const masked = ctx.mask('abcdef')

    expect(masked).toBe('<SECRET_1>')
    expect(masked).not.toContain('def')
  })

  it('skips empty and short registered values by default', () => {
    const ctx = createMaskingContext()

    ctx.register('')
    ctx.register('ab')

    expect(ctx.mask('ab abc')).toBe('ab abc')
  })

  it('keeps registered values scoped to one context', () => {
    const a = createMaskingContext()
    const b = createMaskingContext()

    a.register('alpha-secret')
    b.register('beta-secret')

    expect(a.mask('alpha-secret')).toBe('<SECRET_0>')
    expect(b.mask('alpha-secret')).toBe('alpha-secret')
  })

  it('dispose clears minted placeholders so nothing restores afterward', () => {
    const ctx = createMaskingContext()

    ctx.register('gone-after-dispose')
    expect(ctx.mask('gone-after-dispose')).toBe('<SECRET_0>')

    ctx.dispose()

    expect(ctx.unmask('<SECRET_0>')).toBe('<SECRET_0>')
  })
})
