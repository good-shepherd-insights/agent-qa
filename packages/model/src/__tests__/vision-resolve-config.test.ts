import { describe, expect, it } from 'vitest'

import { resolveVisionConfig } from '../vision/resolve-config.js'

describe('resolveVisionConfig', () => {
  it('returns empty values when neither shared config nor override is present', () => {
    expect(resolveVisionConfig(undefined, undefined)).toEqual({
      screenshotSize: undefined,
      effectiveResolution: undefined,
    })
  })

  it('falls through to services.vision when override is absent', () => {
    expect(resolveVisionConfig({ screenshotSize: 262144, effectiveResolution: 768 }, undefined)).toEqual({
      screenshotSize: 262144,
      effectiveResolution: 768,
    })
  })

  it('applies visionOverride per field over services.vision', () => {
    expect(resolveVisionConfig(
      { screenshotSize: 50000, effectiveResolution: 500 },
      { screenshotSize: 99999 },
    )).toEqual({
      screenshotSize: 99999,
      effectiveResolution: 500,
    })
  })

  it('supports override-only values', () => {
    expect(resolveVisionConfig(undefined, { effectiveResolution: 1024 })).toEqual({
      screenshotSize: undefined,
      effectiveResolution: 1024,
    })
  })
})
