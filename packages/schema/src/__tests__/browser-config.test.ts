import { describe, expect, it } from 'vitest'

import { browserConfigSchema } from '../config/browser'

describe('browserConfigSchema', () => {
  it('accepts a browser name with optional headless and viewport fields omitted', () => {
    expect(browserConfigSchema.safeParse({ name: 'chromium' }).success).toBe(true)
  })

  it('rejects unsupported browser names', () => {
    expect(browserConfigSchema.safeParse({ name: 'opera' }).success).toBe(false)
  })

  it('rejects unknown browser config keys', () => {
    expect(browserConfigSchema.safeParse({ name: 'chromium', unknownKey: 1 }).success).toBe(false)
  })
})
