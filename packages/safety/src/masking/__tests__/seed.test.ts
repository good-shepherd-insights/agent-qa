import { describe, expect, it } from 'vitest'

import { createMaskingContext } from '../context'
import { seedMaskingContext } from '../seed'

describe('seedMaskingContext', () => {
  it('registers secret-store, env, and auth-state known values as secrets', () => {
    const secretValue = 'sk-live-abcdef0123456789'
    const envValue = 'ghp_longenoughvalue'
    const authStateValue = 'Bearer aaaaaaaaaaaa'
    const ctx = createMaskingContext()

    seedMaskingContext(ctx, {
      secretStore: {
        forEachSecret(cb) {
          cb('API_KEY', secretValue)
        },
      },
      env: { TOKEN: envValue },
      authState: { knownSensitiveStrings: [authStateValue] },
    })

    const masked = ctx.mask(`x ${secretValue} y ${envValue} z ${authStateValue}`)

    expect(masked).not.toContain(secretValue)
    expect(masked).not.toContain(envValue)
    expect(masked).not.toContain(authStateValue)
    expect(masked.match(/<SECRET_\d+>/g)).toHaveLength(3)
  })

  it('relies on the masking context to skip short registered values', () => {
    const ctx = createMaskingContext()

    seedMaskingContext(ctx, {
      env: { X: 'ab' },
    })

    expect(ctx.mask('ab')).toBe('ab')
  })
})
