import { describe, expect, it } from 'vitest'

import { resolveVisionConfig } from '../vision/resolve-config.js'

describe('resolveVisionConfig', () => {
  it('takes exactly one services.vision argument', () => {
    expect(resolveVisionConfig.length).toBe(1)
  })

  it('returns empty values when shared services.vision is absent', () => {
    expect(resolveVisionConfig(undefined)).toEqual({
      screenshotSize: undefined,
      effectiveResolution: undefined,
    })
  })

  it('uses the shared services.vision sizing', () => {
    expect(resolveVisionConfig({ screenshotSize: 131072, effectiveResolution: 1024 })).toEqual({
      screenshotSize: 131072,
      effectiveResolution: 1024,
    })
  })
})
