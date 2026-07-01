import { describe, expect, it } from 'vitest'

import { createMaskingContext, getActiveMaskingContext } from '@vostride/agent-qa-safety'

import * as surface from '../index'
import { runMaskingScope } from '../masking-scope'

describe('runMaskingScope', () => {
  it('resolves the active context only inside the scope', () => {
    const ctx = createMaskingContext()

    expect(getActiveMaskingContext()).toBeUndefined()

    runMaskingScope(ctx, () => {
      expect(getActiveMaskingContext()).toBe(ctx)
    })

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('restores the outer context across nested scopes', () => {
    const ctxA = createMaskingContext()
    const ctxB = createMaskingContext()

    runMaskingScope(ctxA, () => {
      expect(getActiveMaskingContext()).toBe(ctxA)

      runMaskingScope(ctxB, () => {
        expect(getActiveMaskingContext()).toBe(ctxB)
      })

      expect(getActiveMaskingContext()).toBe(ctxA)
    })

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('keeps concurrent async scopes isolated', async () => {
    const ctxA = createMaskingContext()
    const ctxB = createMaskingContext()

    await Promise.all([
      runMaskingScope(ctxA, async () => {
        expect(getActiveMaskingContext()).toBe(ctxA)
        await Promise.resolve()
        expect(getActiveMaskingContext()).toBe(ctxA)
      }),
      runMaskingScope(ctxB, async () => {
        expect(getActiveMaskingContext()).toBe(ctxB)
        await Promise.resolve()
        expect(getActiveMaskingContext()).toBe(ctxB)
      }),
    ])

    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('is exported from the safety-local barrel', () => {
    expect(surface.runMaskingScope).toBe(runMaskingScope)
  })
})
